-- ============================================================================
-- IPD Migration 013: Bed-class dimension across ALL pricing (standard practice)
--
-- 1. tariff_rates: tariff_plan_id now NULLABLE (NULL = standard/cash rate card)
--    and gains bed_type_id (NULL = all classes). One service can carry a full
--    class-wise rate list: dressing ₹300 General / ₹500 Private / ₹800 Suite.
-- 2. bed_types.rate_multiplier: blanket class uplift used when no explicit
--    class rate exists (Private 1.25× base, Suite 1.5×) — instant class-wise
--    pricing without keying every service.
-- 3. resolve_tariff_rate(service, plan, bed_type): precedence from most to
--    least specific — plan+service+class > plan+service > plan+group+class >
--    plan+group > std+service+class > std+service > std+group+class >
--    std+group > base_price × class multiplier.
-- 4. Room-rent job posts at the class-resolved rate.
-- 5. package_class_prices: per-class package price list (TKR: Gen 1.6L / Pvt 1.9L).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1/2. Schema changes
-- ---------------------------------------------------------------------------
ALTER TABLE public.tariff_rates ALTER COLUMN tariff_plan_id DROP NOT NULL;

ALTER TABLE public.tariff_rates
  ADD COLUMN IF NOT EXISTS bed_type_id uuid REFERENCES public.bed_types(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tariff_rates_class ON public.tariff_rates (bed_type_id)
  WHERE bed_type_id IS NOT NULL;

ALTER TABLE public.bed_types
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(6,3) NOT NULL DEFAULT 1
  CHECK (rate_multiplier > 0);

CREATE TABLE IF NOT EXISTS public.package_class_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  bed_type_id uuid NOT NULL REFERENCES public.bed_types(id) ON DELETE CASCADE,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  estimated_cost numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, bed_type_id)
);

ALTER TABLE public.package_class_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON public.package_class_prices FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY tenant_write ON public.package_class_prices FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ---------------------------------------------------------------------------
-- 3. Class-aware tariff resolution
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_tariff_rate(uuid, uuid);

CREATE OR REPLACE FUNCTION public.resolve_tariff_rate(
  p_service_id uuid,
  p_tariff_plan_id uuid DEFAULT NULL,
  p_bed_type_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base numeric;
  v_path text;
  v_rate numeric;
  v_mult numeric;
  v_class_mult numeric := 1;
BEGIN
  SELECT s.base_price, g.path INTO v_base, v_path
    FROM public.services_master s
    JOIN public.charge_groups g ON g.id = s.charge_group_id
   WHERE s.id = p_service_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Service % not found', p_service_id;
  END IF;

  -- Single scored lookup across plan/standard × service/group × class/agnostic.
  -- Plan rows only considered when a plan is given; class rows only when a
  -- class is given. Most specific wins.
  SELECT r.rate, r.multiplier INTO v_rate, v_mult
    FROM public.tariff_rates r
    LEFT JOIN public.charge_groups g ON g.id = r.charge_group_id
   WHERE (r.tariff_plan_id IS NULL OR r.tariff_plan_id = p_tariff_plan_id)
     AND (r.bed_type_id IS NULL OR r.bed_type_id = p_bed_type_id)
     AND (
       r.service_id = p_service_id
       OR (r.charge_group_id IS NOT NULL AND
           (v_path = g.path OR v_path LIKE g.path || '/%'))
     )
   ORDER BY (r.tariff_plan_id IS NOT NULL) DESC,   -- plan-specific beats standard
            (r.service_id IS NOT NULL) DESC,       -- service beats group
            (r.bed_type_id IS NOT NULL) DESC,      -- class-specific beats agnostic
            COALESCE(g.depth, 0) DESC              -- deepest group
   LIMIT 1;

  IF FOUND THEN
    RETURN COALESCE(v_rate, round(v_base * v_mult, 2));
  END IF;

  -- Fallback: base price × the bed class multiplier
  IF p_bed_type_id IS NOT NULL THEN
    SELECT rate_multiplier INTO v_class_mult
      FROM public.bed_types WHERE id = p_bed_type_id;
    v_class_mult := COALESCE(v_class_mult, 1);
  END IF;

  RETURN round(v_base * v_class_mult, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Room-rent job: resolve at the occupied bed's class
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_room_rent_for_date(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT a.id AS admission_id, a.clinic_id, a.tariff_plan_id,
           b.bed_type_id,
           bt.room_rent_service_id, bt.nursing_service_id
      FROM public.ipd_admissions a
      JOIN public.ipd_bed_allocations ba
        ON ba.admission_id = a.id AND ba.to_datetime IS NULL
      JOIN public.ipd_beds b ON b.id = ba.bed_id
      JOIN public.bed_types bt ON bt.id = b.bed_type_id
     WHERE a.status = 'admitted'
       AND ba.from_datetime::date <= p_date
       AND NOT EXISTS (
         SELECT 1 FROM public.charge_postings cp
          WHERE cp.admission_id = a.id
            AND cp.source = 'room_rent_job'
            AND cp.service_date = p_date
            AND cp.service_id = bt.room_rent_service_id
            AND cp.status <> 'cancelled'
       )
  LOOP
    INSERT INTO public.charge_postings
      (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
       quantity, unit_rate, gross_amount, net_amount)
    VALUES
      (r.clinic_id, r.admission_id, r.room_rent_service_id,
       (SELECT charge_group_id FROM public.services_master WHERE id = r.room_rent_service_id),
       'room_rent_job', p_date, 1,
       public.resolve_tariff_rate(r.room_rent_service_id, r.tariff_plan_id, r.bed_type_id),
       0, 0);

    IF r.nursing_service_id IS NOT NULL THEN
      INSERT INTO public.charge_postings
        (clinic_id, admission_id, service_id, charge_group_id, source, service_date,
         quantity, unit_rate, gross_amount, net_amount)
      VALUES
        (r.clinic_id, r.admission_id, r.nursing_service_id,
         (SELECT charge_group_id FROM public.services_master WHERE id = r.nursing_service_id),
         'room_rent_job', p_date, 1,
         public.resolve_tariff_rate(r.nursing_service_id, r.tariff_plan_id, r.bed_type_id),
         0, 0);
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

COMMIT;
