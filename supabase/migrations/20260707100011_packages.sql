-- ============================================================================
-- IPD Migration 011: Packages Engine (concept file §B — the revenue-critical module)
--
-- packages            : master (price, est. cost, stay days, bed/implant caps,
--                       deduction buffer, doctor-share override placeholder)
-- package_items       : inclusions/exclusions at SERVICE or CHARGE-GROUP grain,
--                       each with optional max_quantity / max_amount caps
-- admission_packages  : a package applied to an admission at an agreed price,
--                       with rolling consumed/overrun amounts
--
-- Engine (DB triggers, so every posting path is covered — UI, room-rent job, eMAR):
--  * BEFORE INSERT on charge_postings → resolve coverage:
--      exclusion beats inclusion; service-level rule beats group-level;
--      deepest group match wins; caps enforced (qty, amount, bed rate, implant total)
--  * AFTER INSERT/UPDATE → roll consumed_amount, flag overrun when the itemized
--      value of covered items exceeds the agreed price (concept: negative-margin flag)
--  * generate_ipd_bill() adds ONE package line (agreed price) to the first bill
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  package_price numeric(12,2) NOT NULL CHECK (package_price >= 0),
  estimated_cost numeric(12,2),
  default_stay_days integer,
  per_day_bed_cap numeric(12,2),      -- max covered daily room rate (BED group)
  implant_cap numeric(12,2),          -- max covered implant total
  deduction_buffer_pct numeric(5,2) NOT NULL DEFAULT 0,  -- expected TPA deduction cushion
  doctor_share_override_pct numeric(5,2),                -- used by contracts engine (Wave 2 later)
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, name)
);

CREATE TABLE IF NOT EXISTS public.package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('inclusion', 'exclusion')),
  service_id uuid REFERENCES public.services_master(id) ON DELETE CASCADE,
  charge_group_id uuid REFERENCES public.charge_groups(id) ON DELETE CASCADE,
  max_quantity numeric(8,2),          -- inclusion cap: total covered qty
  max_amount numeric(12,2),           -- inclusion cap: total covered value
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_id IS NOT NULL OR charge_group_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.admission_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  agreed_price numeric(12,2) NOT NULL CHECK (agreed_price >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'converted_to_itemized')),
  consumed_amount numeric(12,2) NOT NULL DEFAULT 0,   -- itemized value of covered postings
  overrun_amount numeric(12,2) NOT NULL DEFAULT 0,
  overrun_flagged_at timestamptz,
  billed_bill_id uuid REFERENCES public.ipd_bills(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- one active package per admission
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_package_per_admission
  ON public.admission_packages (admission_id) WHERE status = 'active';

-- record which inclusion item matched (needed for per-item cap enforcement)
ALTER TABLE public.charge_postings
  ADD COLUMN IF NOT EXISTS package_item_id uuid REFERENCES public.package_items(id) ON DELETE SET NULL;

ALTER TABLE public.charge_postings
  ADD CONSTRAINT fk_postings_package_assignment
  FOREIGN KEY (package_assignment_id) REFERENCES public.admission_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_packages_clinic ON public.packages (clinic_id);
CREATE INDEX IF NOT EXISTS idx_package_items_package ON public.package_items (package_id);
CREATE INDEX IF NOT EXISTS idx_admission_packages_admission ON public.admission_packages (admission_id);
CREATE INDEX IF NOT EXISTS idx_postings_pkg_assignment ON public.charge_postings (package_assignment_id)
  WHERE package_assignment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Coverage resolution — BEFORE INSERT on charge_postings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_package_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ap public.admission_packages%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_eligible boolean;
  v_stype public.ipd_service_type_enum;
  v_item record;
  v_covered_qty numeric;
  v_covered_amt numeric;
  v_implant_total numeric;
BEGIN
  NEW.covered_by_package := false;
  NEW.package_assignment_id := NULL;
  NEW.package_item_id := NULL;

  -- active package on this admission?
  SELECT * INTO v_ap
    FROM public.admission_packages
   WHERE admission_id = NEW.admission_id AND status = 'active'
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = v_ap.package_id;

  SELECT is_package_eligible, service_type INTO v_eligible, v_stype
    FROM public.services_master WHERE id = NEW.service_id;
  IF NOT COALESCE(v_eligible, false) THEN RETURN NEW; END IF;

  -- Rule match: exclusion beats inclusion; service rule beats group rule;
  -- among group rules the deepest path wins.
  SELECT pi.*, COALESCE(g.depth, 0) AS g_depth,
         (pi.service_id IS NOT NULL) AS is_service_rule
    INTO v_item
    FROM public.package_items pi
    LEFT JOIN public.charge_groups g ON g.id = pi.charge_group_id
   WHERE pi.package_id = v_pkg.id
     AND (
       pi.service_id = NEW.service_id
       OR (pi.charge_group_id IS NOT NULL AND
           (NEW.charge_group_path = g.path OR NEW.charge_group_path LIKE g.path || '/%'))
     )
   ORDER BY (pi.service_id IS NOT NULL) DESC,       -- service rules first
            (pi.item_kind = 'exclusion') DESC,      -- exclusion beats inclusion at same grain
            COALESCE(g.depth, 0) DESC                -- deepest group match
   LIMIT 1;

  IF NOT FOUND OR v_item.item_kind = 'exclusion' THEN
    RETURN NEW;  -- not covered: no rule, or explicitly excluded
  END IF;

  -- Bed cap: room rate above the per-day cap is not covered
  IF v_pkg.per_day_bed_cap IS NOT NULL
     AND split_part(NEW.charge_group_path, '/', 1) = 'BED'
     AND NEW.unit_rate > v_pkg.per_day_bed_cap THEN
    RETURN NEW;
  END IF;

  -- Implant cap: covered implant total must stay within cap
  IF v_pkg.implant_cap IS NOT NULL AND v_stype = 'implant' THEN
    SELECT COALESCE(SUM(cp.net_amount), 0) INTO v_implant_total
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.package_assignment_id = v_ap.id
       AND cp.status <> 'cancelled'
       AND s.service_type = 'implant';
    IF v_implant_total + NEW.net_amount > v_pkg.implant_cap THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Per-item caps (quantity / amount) on the matched inclusion
  IF v_item.max_quantity IS NOT NULL OR v_item.max_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(net_amount), 0)
      INTO v_covered_qty, v_covered_amt
      FROM public.charge_postings
     WHERE package_item_id = v_item.id AND status <> 'cancelled';
    IF v_item.max_quantity IS NOT NULL AND v_covered_qty + NEW.quantity > v_item.max_quantity THEN
      RETURN NEW;
    END IF;
    IF v_item.max_amount IS NOT NULL AND v_covered_amt + NEW.net_amount > v_item.max_amount THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.covered_by_package := true;
  NEW.package_assignment_id := v_ap.id;
  NEW.package_item_id := v_item.id;
  RETURN NEW;
END;
$$;

-- Runs AFTER the defaults trigger (alphabetical order: resolve > defaults? No —
-- PG fires BEFORE triggers alphabetically; name it to run after trg_charge_postings_defaults)
CREATE TRIGGER trg_zz_package_coverage
  BEFORE INSERT ON public.charge_postings
  FOR EACH ROW EXECUTE FUNCTION public.resolve_package_coverage();

-- ---------------------------------------------------------------------------
-- 3. Consumption rollup + overrun flag — AFTER INSERT / status change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollup_package_consumption()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ap_id uuid := COALESCE(NEW.package_assignment_id, OLD.package_assignment_id);
  v_consumed numeric;
  v_agreed numeric;
BEGIN
  IF v_ap_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(net_amount), 0) INTO v_consumed
    FROM public.charge_postings
   WHERE package_assignment_id = v_ap_id AND status <> 'cancelled';

  SELECT agreed_price INTO v_agreed FROM public.admission_packages WHERE id = v_ap_id;

  UPDATE public.admission_packages
     SET consumed_amount = v_consumed,
         overrun_amount = GREATEST(v_consumed - v_agreed, 0),
         overrun_flagged_at = CASE
           WHEN v_consumed > v_agreed AND overrun_flagged_at IS NULL THEN now()
           WHEN v_consumed <= v_agreed THEN NULL
           ELSE overrun_flagged_at
         END,
         updated_at = now()
   WHERE id = v_ap_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_package_rollup
  AFTER INSERT OR UPDATE OF status, net_amount ON public.charge_postings
  FOR EACH ROW EXECUTE FUNCTION public.rollup_package_consumption();

-- ---------------------------------------------------------------------------
-- 4. Bill integration: package charged once, at agreed price
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_ipd_bill(
  p_admission_id uuid,
  p_bill_type text DEFAULT 'interim',
  p_created_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
  v_bill_id uuid;
  v_bill_number text;
  v_deposits numeric;
  v_pkg record;
  v_pkg_total numeric := 0;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.ipd_admissions WHERE id = p_admission_id;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Admission % not found', p_admission_id;
  END IF;

  v_bill_number := public.next_document_number(v_clinic_id, 'ipd_bill');

  INSERT INTO public.ipd_bills (clinic_id, admission_id, bill_number, bill_type, created_by)
  VALUES (v_clinic_id, p_admission_id, v_bill_number, p_bill_type, p_created_by)
  RETURNING id INTO v_bill_id;

  -- Package line(s): once per admission package, at the agreed price
  FOR v_pkg IN
    SELECT ap.id, ap.agreed_price, p.name
      FROM public.admission_packages ap
      JOIN public.packages p ON p.id = ap.package_id
     WHERE ap.admission_id = p_admission_id
       AND ap.status IN ('active', 'closed')
       AND ap.billed_bill_id IS NULL
  LOOP
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, line_type, description, quantity, unit_rate, gross, discount, tax, net)
    VALUES
      (v_clinic_id, v_bill_id, 'package', v_pkg.name || ' (package)', 1,
       v_pkg.agreed_price, v_pkg.agreed_price, 0, 0, v_pkg.agreed_price);
    UPDATE public.admission_packages SET billed_bill_id = v_bill_id, updated_at = now()
     WHERE id = v_pkg.id;
    v_pkg_total := v_pkg_total + v_pkg.agreed_price;
  END LOOP;

  -- Itemized lines: pending postings NOT covered by the package
  WITH pending AS (
    SELECT cp.*, s.name AS service_name
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.admission_id = p_admission_id
       AND cp.status = 'pending'
       AND cp.covered_by_package = false
     ORDER BY cp.service_date, cp.created_at
  ), lines AS (
    INSERT INTO public.ipd_bill_lines
      (clinic_id, bill_id, charge_posting_id, line_type, description,
       quantity, unit_rate, gross, discount, tax, net,
       charge_group_id, charge_group_path)
    SELECT clinic_id, v_bill_id, id, 'charge', service_name,
           quantity, unit_rate, gross_amount, discount_amount, tax_amount, net_amount,
           charge_group_id, charge_group_path
      FROM pending
    RETURNING charge_posting_id, id
  )
  UPDATE public.charge_postings cp
     SET status = 'billed', bill_line_id = l.id, updated_at = now()
    FROM lines l
   WHERE cp.id = l.charge_posting_id;

  -- Covered postings are settled by the package line: mark them billed too
  UPDATE public.charge_postings
     SET status = 'billed', updated_at = now()
   WHERE admission_id = p_admission_id
     AND status = 'pending'
     AND covered_by_package = true
     AND package_assignment_id IN (
       SELECT id FROM public.admission_packages WHERE billed_bill_id = v_bill_id
     );

  -- Unapplied deposits
  SELECT COALESCE(SUM(CASE entry_type
           WHEN 'deposit' THEN amount
           WHEN 'refund' THEN -amount
           WHEN 'applied_to_bill' THEN -amount
         END), 0)
    INTO v_deposits
    FROM public.ipd_deposits WHERE admission_id = p_admission_id;

  UPDATE public.ipd_bills b
     SET gross_total = t.gross, discount_total = t.disc,
         tax_total = t.tax, net_total = t.net,
         package_total = v_pkg_total,
         patient_payable = t.net,
         deposits_applied = LEAST(GREATEST(v_deposits, 0), t.net),
         balance_amount = t.net - LEAST(GREATEST(v_deposits, 0), t.net),
         status = 'issued', updated_at = now()
    FROM (
      SELECT COALESCE(SUM(gross),0) gross, COALESCE(SUM(discount),0) disc,
             COALESCE(SUM(tax),0) tax, COALESCE(SUM(net),0) net
        FROM public.ipd_bill_lines WHERE bill_id = v_bill_id
    ) t
   WHERE b.id = v_bill_id;

  RETURN v_bill_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_packages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['packages', 'package_items', 'admission_packages'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

COMMIT;
