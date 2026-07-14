-- ============================================================================
-- IPD Migration 012: Bed-class-scoped package caps
-- A package item (inclusion/exclusion + caps) can now be scoped to a bed class:
--   TKR package → INV inclusion max ₹4,000 (General), ₹6,000 (Private), ₹9,000 (Suite)
-- NULL bed_type_id = applies to all classes (backward compatible).
-- The coverage engine prefers the item matching the patient's CURRENT bed class,
-- and cap accounting sums across sibling class-variants of the same rule so a
-- mid-stay class transfer cannot double the allowance.
-- ============================================================================

BEGIN;

ALTER TABLE public.package_items
  ADD COLUMN IF NOT EXISTS bed_type_id uuid REFERENCES public.bed_types(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_package_items_bed_type ON public.package_items (bed_type_id)
  WHERE bed_type_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Coverage resolution v2: bed-class aware
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_package_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ap public.admission_packages%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_eligible boolean;
  v_stype public.ipd_service_type_enum;
  v_bed_type_id uuid;
  v_item record;
  v_covered_qty numeric;
  v_covered_amt numeric;
  v_implant_total numeric;
BEGIN
  NEW.covered_by_package := false;
  NEW.package_assignment_id := NULL;
  NEW.package_item_id := NULL;

  SELECT * INTO v_ap
    FROM public.admission_packages
   WHERE admission_id = NEW.admission_id AND status = 'active'
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = v_ap.package_id;

  SELECT is_package_eligible, service_type INTO v_eligible, v_stype
    FROM public.services_master WHERE id = NEW.service_id;
  IF NOT COALESCE(v_eligible, false) THEN RETURN NEW; END IF;

  -- patient's current bed class (open allocation)
  SELECT b.bed_type_id INTO v_bed_type_id
    FROM public.ipd_bed_allocations ba
    JOIN public.ipd_beds b ON b.id = ba.bed_id
   WHERE ba.admission_id = NEW.admission_id AND ba.to_datetime IS NULL
   LIMIT 1;

  -- Rule match precedence:
  --   1. bed-class-specific item beats class-agnostic (NULL) item
  --   2. service rule beats group rule
  --   3. exclusion beats inclusion at the same grain
  --   4. deepest group path wins
  -- Items scoped to a DIFFERENT bed class are ignored entirely.
  SELECT pi.*, COALESCE(g.depth, 0) AS g_depth
    INTO v_item
    FROM public.package_items pi
    LEFT JOIN public.charge_groups g ON g.id = pi.charge_group_id
   WHERE pi.package_id = v_pkg.id
     AND (pi.bed_type_id IS NULL OR pi.bed_type_id = v_bed_type_id)
     AND (
       pi.service_id = NEW.service_id
       OR (pi.charge_group_id IS NOT NULL AND
           (NEW.charge_group_path = g.path OR NEW.charge_group_path LIKE g.path || '/%'))
     )
   ORDER BY (pi.bed_type_id IS NOT NULL) DESC,
            (pi.service_id IS NOT NULL) DESC,
            (pi.item_kind = 'exclusion') DESC,
            COALESCE(g.depth, 0) DESC
   LIMIT 1;

  IF NOT FOUND OR v_item.item_kind = 'exclusion' THEN
    RETURN NEW;
  END IF;

  -- Bed cap: room rate above the per-day cap is not covered
  IF v_pkg.per_day_bed_cap IS NOT NULL
     AND split_part(NEW.charge_group_path, '/', 1) = 'BED'
     AND NEW.unit_rate > v_pkg.per_day_bed_cap THEN
    RETURN NEW;
  END IF;

  -- Implant cap
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

  -- Per-item caps. Consumption is summed across ALL class-variants of the same
  -- rule target (same service / same group in this package), so transferring
  -- from General to Private mid-stay continues the same allowance at the new cap.
  IF v_item.max_quantity IS NOT NULL OR v_item.max_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(cp.quantity), 0), COALESCE(SUM(cp.net_amount), 0)
      INTO v_covered_qty, v_covered_amt
      FROM public.charge_postings cp
     WHERE cp.status <> 'cancelled'
       AND cp.package_item_id IN (
         SELECT id FROM public.package_items sib
          WHERE sib.package_id = v_pkg.id
            AND sib.item_kind = 'inclusion'
            AND COALESCE(sib.service_id::text, '') = COALESCE(v_item.service_id::text, '')
            AND COALESCE(sib.charge_group_id::text, '') = COALESCE(v_item.charge_group_id::text, '')
       );
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

COMMIT;
