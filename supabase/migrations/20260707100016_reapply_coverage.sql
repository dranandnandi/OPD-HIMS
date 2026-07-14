-- ============================================================================
-- IPD Migration 016: Re-apply package coverage to existing unbilled charges
--
-- Until now coverage was resolved only at posting time, so assigning a package
-- to an already-admitted patient left earlier pending charges uncovered.
-- Now:
--   * the coverage decision is extracted into fn_resolve_coverage(), used by
--     BOTH the posting trigger and the new re-apply pass
--   * assigning a package fires reapply_package_coverage(admission): every
--     PENDING, unbilled charge is re-evaluated in chronological order
--     (caps consume in posting order), then consumption/overrun recomputed.
--   * BILLED charges are never touched — issued bills stay final.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared coverage resolver (logic identical to migration 012's trigger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_resolve_coverage(
  p_admission_id uuid,
  p_posting_id uuid,          -- excluded from cap sums (may be the row itself)
  p_service_id uuid,
  p_charge_group_path text,
  p_quantity numeric,
  p_net_amount numeric,
  p_unit_rate numeric,
  OUT o_covered boolean,
  OUT o_assignment_id uuid,
  OUT o_item_id uuid
)
LANGUAGE plpgsql AS $$
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
  o_covered := false; o_assignment_id := NULL; o_item_id := NULL;

  SELECT * INTO v_ap
    FROM public.admission_packages
   WHERE admission_id = p_admission_id AND status = 'active'
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = v_ap.package_id;

  SELECT is_package_eligible, service_type INTO v_eligible, v_stype
    FROM public.services_master WHERE id = p_service_id;
  IF NOT COALESCE(v_eligible, false) THEN RETURN; END IF;

  SELECT b.bed_type_id INTO v_bed_type_id
    FROM public.ipd_bed_allocations ba
    JOIN public.ipd_beds b ON b.id = ba.bed_id
   WHERE ba.admission_id = p_admission_id AND ba.to_datetime IS NULL
   LIMIT 1;

  SELECT pi.*, COALESCE(g.depth, 0) AS g_depth
    INTO v_item
    FROM public.package_items pi
    LEFT JOIN public.charge_groups g ON g.id = pi.charge_group_id
   WHERE pi.package_id = v_pkg.id
     AND (pi.bed_type_id IS NULL OR pi.bed_type_id = v_bed_type_id)
     AND (
       pi.service_id = p_service_id
       OR (pi.charge_group_id IS NOT NULL AND
           (p_charge_group_path = g.path OR p_charge_group_path LIKE g.path || '/%'))
     )
   ORDER BY (pi.bed_type_id IS NOT NULL) DESC,
            (pi.service_id IS NOT NULL) DESC,
            (pi.item_kind = 'exclusion') DESC,
            COALESCE(g.depth, 0) DESC
   LIMIT 1;

  IF NOT FOUND OR v_item.item_kind = 'exclusion' THEN RETURN; END IF;

  IF v_pkg.per_day_bed_cap IS NOT NULL
     AND split_part(p_charge_group_path, '/', 1) = 'BED'
     AND p_unit_rate > v_pkg.per_day_bed_cap THEN
    RETURN;
  END IF;

  IF v_pkg.implant_cap IS NOT NULL AND v_stype = 'implant' THEN
    SELECT COALESCE(SUM(cp.net_amount), 0) INTO v_implant_total
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.package_assignment_id = v_ap.id
       AND cp.status <> 'cancelled'
       AND cp.id IS DISTINCT FROM p_posting_id
       AND s.service_type = 'implant';
    IF v_implant_total + p_net_amount > v_pkg.implant_cap THEN RETURN; END IF;
  END IF;

  IF v_item.max_quantity IS NOT NULL OR v_item.max_amount IS NOT NULL THEN
    SELECT COALESCE(SUM(cp.quantity), 0), COALESCE(SUM(cp.net_amount), 0)
      INTO v_covered_qty, v_covered_amt
      FROM public.charge_postings cp
     WHERE cp.status <> 'cancelled'
       AND cp.id IS DISTINCT FROM p_posting_id
       AND cp.package_item_id IN (
         SELECT id FROM public.package_items sib
          WHERE sib.package_id = v_pkg.id
            AND sib.item_kind = 'inclusion'
            AND COALESCE(sib.service_id::text, '') = COALESCE(v_item.service_id::text, '')
            AND COALESCE(sib.charge_group_id::text, '') = COALESCE(v_item.charge_group_id::text, '')
       );
    IF v_item.max_quantity IS NOT NULL AND v_covered_qty + p_quantity > v_item.max_quantity THEN RETURN; END IF;
    IF v_item.max_amount IS NOT NULL AND v_covered_amt + p_net_amount > v_item.max_amount THEN RETURN; END IF;
  END IF;

  o_covered := true;
  o_assignment_id := v_ap.id;
  o_item_id := v_item.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Posting trigger now delegates to the shared resolver
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_package_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_covered boolean; v_assignment uuid; v_item uuid;
BEGIN
  SELECT o_covered, o_assignment_id, o_item_id
    INTO v_covered, v_assignment, v_item
    FROM public.fn_resolve_coverage(
      NEW.admission_id, NULL, NEW.service_id, NEW.charge_group_path,
      NEW.quantity, NEW.net_amount, NEW.unit_rate);
  NEW.covered_by_package := v_covered;
  NEW.package_assignment_id := v_assignment;
  NEW.package_item_id := v_item;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-apply pass over pending charges + trigger on package assignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reapply_package_coverage(p_admission_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_covered boolean; v_assignment uuid; v_item uuid;
  v_changed integer := 0;
  v_ap_id uuid;
  v_consumed numeric; v_agreed numeric;
BEGIN
  FOR r IN
    SELECT id, service_id, charge_group_path, quantity, net_amount, unit_rate
      FROM public.charge_postings
     WHERE admission_id = p_admission_id
       AND status = 'pending'
     ORDER BY service_date, created_at
  LOOP
    SELECT o_covered, o_assignment_id, o_item_id
      INTO v_covered, v_assignment, v_item
      FROM public.fn_resolve_coverage(
        p_admission_id, r.id, r.service_id, r.charge_group_path,
        r.quantity, r.net_amount, r.unit_rate);

    UPDATE public.charge_postings
       SET covered_by_package = v_covered,
           package_assignment_id = v_assignment,
           package_item_id = v_item,
           updated_at = now()
     WHERE id = r.id
       AND (covered_by_package IS DISTINCT FROM v_covered
            OR package_assignment_id IS DISTINCT FROM v_assignment
            OR package_item_id IS DISTINCT FROM v_item);
    IF FOUND THEN v_changed := v_changed + 1; END IF;
  END LOOP;

  -- recompute consumption/overrun on the active assignment
  SELECT id, agreed_price INTO v_ap_id, v_agreed
    FROM public.admission_packages
   WHERE admission_id = p_admission_id AND status = 'active'
   LIMIT 1;
  IF v_ap_id IS NOT NULL THEN
    SELECT COALESCE(SUM(net_amount), 0) INTO v_consumed
      FROM public.charge_postings
     WHERE package_assignment_id = v_ap_id AND status <> 'cancelled';
    UPDATE public.admission_packages
       SET consumed_amount = v_consumed,
           overrun_amount = GREATEST(v_consumed - v_agreed, 0),
           overrun_flagged_at = CASE
             WHEN v_consumed > v_agreed AND overrun_flagged_at IS NULL THEN now()
             WHEN v_consumed <= v_agreed THEN NULL
             ELSE overrun_flagged_at END,
           updated_at = now()
     WHERE id = v_ap_id;
  END IF;

  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_reapply_on_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.reapply_package_coverage(NEW.admission_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_package_assigned_reapply ON public.admission_packages;
CREATE TRIGGER trg_package_assigned_reapply
  AFTER INSERT ON public.admission_packages
  FOR EACH ROW EXECUTE FUNCTION public.trg_reapply_on_assignment();

COMMIT;
