-- ============================================================================
-- IPD Migration 023: Package caps that SPLIT instead of dropping the charge
--
-- Until now every package cap was all-or-nothing per posting: a ₹6,000 lab
-- charge against a ₹2,000 pathology cap with ₹1,500 already consumed fell
-- ENTIRELY outside the package, leaving ₹500 of allowance permanently unused.
--
-- Now each inclusion rule carries a cap_mode:
--   'split' (default) — the package absorbs the remaining allowance and the
--                       excess is carved into a sibling patient-payable charge
--   'block'           — previous behaviour, the whole charge falls out
--
-- Same rule governs packages.per_day_bed_cap and packages.implant_cap.
--
-- The split produces TWO charge_postings rows, so every row stays cleanly
-- covered-or-not and nothing downstream (bill generation, consumption rollup,
-- the ward charge list, the PDF) has to learn about fractional coverage.
--
-- Split styles, chosen so each printed line reads correctly:
--   qty_cap     → split the UNITS, unit_rate preserved on both halves
--   bed_cap     → split the RATE, days preserved on both halves
--                 (₹6,000/day x 4 against a ₹5,000 cap → 4 x ₹5,000 covered,
--                  4 x ₹1,000 to the patient)
--   amount_cap  → split the MONEY: the covered half keeps the quantity (cap
--   implant_cap   accounting reads it), the patient-visible excess half is a
--                 single readable line
--
-- The pre-split row is stored on the child as split_origin jsonb, so
-- re-applying rules can merge the halves back exactly, whatever the style.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.charge_postings
  ADD COLUMN IF NOT EXISTS split_parent_id uuid
    REFERENCES public.charge_postings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS split_reason text
    CHECK (split_reason IN ('amount_cap', 'qty_cap', 'bed_cap', 'implant_cap')),
  ADD COLUMN IF NOT EXISTS split_origin jsonb;

COMMENT ON COLUMN public.charge_postings.split_origin IS
  'On a split CHILD: the parent row as it was before the split, for exact merge-back.';

CREATE INDEX IF NOT EXISTS idx_postings_split_parent
  ON public.charge_postings (split_parent_id) WHERE split_parent_id IS NOT NULL;

-- NULL cap_mode = inherit the package default
ALTER TABLE public.package_items
  ADD COLUMN IF NOT EXISTS cap_mode text CHECK (cap_mode IN ('split', 'block'));

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS default_cap_mode text NOT NULL DEFAULT 'split'
    CHECK (default_cap_mode IN ('split', 'block'));

-- ---------------------------------------------------------------------------
-- 2. Coverage resolver v3 — returns the RUPEE VALUE the package absorbs
--    0            → not covered
--    net_amount   → fully covered
--    0 < x < net  → partial, caller must split
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_resolve_coverage(uuid, uuid, uuid, text, numeric, numeric, numeric);

CREATE FUNCTION public.fn_resolve_coverage(
  p_admission_id uuid,
  p_posting_id uuid,          -- excluded from cap sums (may be the row itself)
  p_service_id uuid,
  p_charge_group_path text,
  p_quantity numeric,
  p_net_amount numeric,
  p_unit_rate numeric,
  OUT o_covered boolean,
  OUT o_assignment_id uuid,
  OUT o_item_id uuid,
  OUT o_covered_amount numeric,
  OUT o_cap_reason text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_ap public.admission_packages%ROWTYPE;
  v_pkg public.packages%ROWTYPE;
  v_eligible boolean;
  v_stype public.ipd_service_type_enum;
  v_bed_type_id uuid;
  v_item record;
  v_cap_mode text;
  v_allow numeric;
  v_reason text := NULL;
  v_head numeric;
  v_covered_qty numeric;
  v_covered_amt numeric;
  v_implant_total numeric;
BEGIN
  o_covered := false; o_assignment_id := NULL; o_item_id := NULL;
  o_covered_amount := 0; o_cap_reason := NULL;

  SELECT * INTO v_ap
    FROM public.admission_packages
   WHERE admission_id = p_admission_id AND status = 'active'
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = v_ap.package_id;

  SELECT is_package_eligible, service_type INTO v_eligible, v_stype
    FROM public.services_master WHERE id = p_service_id;
  IF NOT COALESCE(v_eligible, false) THEN RETURN; END IF;

  -- patient's current bed class (open allocation)
  SELECT b.bed_type_id INTO v_bed_type_id
    FROM public.ipd_bed_allocations ba
    JOIN public.ipd_beds b ON b.id = ba.bed_id
   WHERE ba.admission_id = p_admission_id AND ba.to_datetime IS NULL
   LIMIT 1;

  -- Rule match precedence: bed-class-specific > service rule > exclusion at the
  -- same grain > deepest group path. Items scoped to another class are ignored.
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

  -- A zero-value posting has nothing to apportion; cover it and stop.
  IF COALESCE(p_net_amount, 0) <= 0 THEN
    o_covered := true; o_covered_amount := 0;
    o_assignment_id := v_ap.id; o_item_id := v_item.id;
    RETURN;
  END IF;

  v_cap_mode := COALESCE(v_item.cap_mode, v_pkg.default_cap_mode, 'split');
  v_allow := p_net_amount;

  -- Bed-rate cap: the package covers up to per_day_bed_cap per day
  IF v_pkg.per_day_bed_cap IS NOT NULL
     AND split_part(p_charge_group_path, '/', 1) = 'BED'
     AND p_unit_rate > v_pkg.per_day_bed_cap THEN
    v_head := round(v_pkg.per_day_bed_cap * p_quantity, 2);
    IF v_head < v_allow THEN v_allow := v_head; v_reason := 'bed_cap'; END IF;
  END IF;

  -- Implant cap: covered implant value across the whole assignment
  IF v_pkg.implant_cap IS NOT NULL AND v_stype = 'implant' THEN
    SELECT COALESCE(SUM(cp.net_amount), 0) INTO v_implant_total
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.package_assignment_id = v_ap.id
       AND cp.status <> 'cancelled'
       AND cp.id IS DISTINCT FROM p_posting_id
       AND s.service_type = 'implant';
    v_head := GREATEST(v_pkg.implant_cap - v_implant_total, 0);
    IF v_head < v_allow THEN v_allow := v_head; v_reason := 'implant_cap'; END IF;
  END IF;

  -- Per-rule caps. Consumption sums across ALL bed-class variants of the same
  -- rule target, so a mid-stay class transfer continues the same allowance.
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

    IF v_item.max_quantity IS NOT NULL THEN
      v_head := GREATEST(v_item.max_quantity - v_covered_qty, 0);
      IF v_head < p_quantity THEN
        v_head := round(p_net_amount * (v_head / p_quantity), 2);  -- value of the units that fit
        IF v_head < v_allow THEN v_allow := v_head; v_reason := 'qty_cap'; END IF;
      END IF;
    END IF;

    IF v_item.max_amount IS NOT NULL THEN
      v_head := GREATEST(v_item.max_amount - v_covered_amt, 0);
      IF v_head < v_allow THEN v_allow := v_head; v_reason := 'amount_cap'; END IF;
    END IF;
  END IF;

  IF v_allow <= 0 THEN RETURN; END IF;                                     -- allowance exhausted
  IF v_allow < p_net_amount AND v_cap_mode = 'block' THEN RETURN; END IF;  -- all-or-nothing

  IF v_allow >= p_net_amount THEN
    v_allow := p_net_amount; v_reason := NULL;                             -- fully covered
  END IF;

  o_covered := true;
  o_covered_amount := v_allow;
  o_cap_reason := v_reason;
  o_assignment_id := v_ap.id;
  o_item_id := v_item.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The split itself
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_split_posting(
  p_posting_id uuid,
  p_covered_amount numeric,
  p_cap_reason text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  p public.charge_postings%ROWTYPE;
  v_ratio numeric;
  c_qty numeric; c_rate numeric; c_gross numeric; c_disc numeric;
  c_net numeric; c_tax numeric; c_cost numeric;
  x_qty numeric; x_rate numeric; x_gross numeric; x_disc numeric;
  x_net numeric; x_tax numeric; x_cost numeric;
  v_origin jsonb;
  v_base text;
  v_child uuid;
BEGIN
  SELECT * INTO p FROM public.charge_postings WHERE id = p_posting_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p.split_parent_id IS NOT NULL THEN RETURN NULL; END IF;      -- never split a child
  IF p.status <> 'pending' THEN RETURN NULL; END IF;              -- billed rows are final
  IF p_covered_amount IS NULL OR p_covered_amount <= 0 THEN RETURN NULL; END IF;
  IF p_covered_amount >= p.net_amount THEN RETURN NULL; END IF;   -- nothing to split

  SELECT COALESCE(p.description, s.name) INTO v_base
    FROM public.services_master s WHERE s.id = p.service_id;

  v_origin := jsonb_build_object(
    'quantity', p.quantity, 'unit_rate', p.unit_rate, 'gross_amount', p.gross_amount,
    'discount_amount', p.discount_amount, 'net_amount', p.net_amount,
    'tax_amount', p.tax_amount, 'cost_snapshot', p.cost_snapshot,
    'description', p.description);

  v_ratio := p_covered_amount / p.net_amount;

  -- Money is authoritative: the covered half is exactly the allowance.
  c_net  := round(p_covered_amount, 2);
  x_net  := round(p.net_amount - c_net, 2);
  c_disc := round(p.discount_amount * v_ratio, 2);
  x_disc := round(p.discount_amount - c_disc, 2);
  c_gross := c_net + c_disc;                     -- keeps CHECK (net = gross - discount)
  x_gross := x_net + x_disc;
  c_tax  := round(p.tax_amount * v_ratio, 2);
  x_tax  := round(p.tax_amount - c_tax, 2);
  c_cost := round(p.cost_snapshot * v_ratio, 2);
  x_cost := round(p.cost_snapshot - c_cost, 2);

  -- A quantity below 0.02 cannot be divided into two rows that both satisfy
  -- CHECK (quantity > 0), so fall back to the money split.
  IF p_cap_reason = 'qty_cap' AND p.quantity >= 0.02 THEN
    -- split the units, rate preserved
    c_qty := round(p.quantity * v_ratio, 2);
    IF c_qty < 0.01 THEN c_qty := 0.01; END IF;
    IF c_qty > p.quantity - 0.01 THEN c_qty := round(p.quantity - 0.01, 2); END IF;
    x_qty := round(p.quantity - c_qty, 2);
    c_rate := p.unit_rate;
    x_rate := p.unit_rate;
  ELSIF p_cap_reason = 'bed_cap' THEN
    -- split the rate, days preserved on both halves
    c_qty := p.quantity;
    x_qty := p.quantity;
    c_rate := round(c_gross / NULLIF(c_qty, 0), 2);
    x_rate := round(x_gross / NULLIF(x_qty, 0), 2);
  ELSE
    -- money split: covered half keeps the quantity (per-rule qty accounting
    -- reads it); the patient-visible excess is one readable line
    c_qty := p.quantity;
    c_rate := round(c_gross / NULLIF(c_qty, 0), 2);
    x_qty := 1;
    x_rate := x_gross;
  END IF;

  UPDATE public.charge_postings
     SET quantity = c_qty, unit_rate = c_rate, gross_amount = c_gross,
         discount_amount = c_disc, net_amount = c_net, tax_amount = c_tax,
         cost_snapshot = c_cost,
         split_reason = p_cap_reason,
         description = v_base || ' (within package limit)',
         updated_at = now()
   WHERE id = p.id;

  INSERT INTO public.charge_postings
    (clinic_id, admission_id, service_id, source, source_ref, service_date,
     quantity, unit_rate, gross_amount, discount_amount, net_amount, tax_amount,
     cost_snapshot, ordering_doctor_id, performing_doctor_id, status, description,
     split_parent_id, split_reason, split_origin, created_by)
  VALUES
    (p.clinic_id, p.admission_id, p.service_id, p.source, p.source_ref, p.service_date,
     x_qty, x_rate, x_gross, x_disc, x_net, x_tax,
     x_cost, p.ordering_doctor_id, p.performing_doctor_id, p.status,
     v_base || ' (above package limit)',
     p.id, p_cap_reason, v_origin, p.created_by)
  RETURNING id INTO v_child;

  RETURN v_child;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: resolve coverage. Split children are never re-resolved.
CREATE OR REPLACE FUNCTION public.resolve_package_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF NEW.split_parent_id IS NOT NULL THEN
    NEW.covered_by_package := false;
    NEW.package_assignment_id := NULL;
    NEW.package_item_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public.fn_resolve_coverage(
    NEW.admission_id, NULL, NEW.service_id, NEW.charge_group_path,
    NEW.quantity, NEW.net_amount, NEW.unit_rate);

  NEW.covered_by_package := r.o_covered;
  NEW.package_assignment_id := r.o_assignment_id;
  NEW.package_item_id := r.o_item_id;
  RETURN NEW;
END;
$$;

-- AFTER INSERT: carve out the excess when coverage was partial.
-- Re-resolving with p_posting_id = NEW.id excludes the row from its own cap
-- sums, so it reproduces exactly what the BEFORE trigger decided.
CREATE OR REPLACE FUNCTION public.trg_split_capped_posting()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF NEW.split_parent_id IS NOT NULL THEN RETURN NULL; END IF;
  IF NOT NEW.covered_by_package THEN RETURN NULL; END IF;
  IF NEW.status <> 'pending' THEN RETURN NULL; END IF;

  SELECT * INTO r FROM public.fn_resolve_coverage(
    NEW.admission_id, NEW.id, NEW.service_id, NEW.charge_group_path,
    NEW.quantity, NEW.net_amount, NEW.unit_rate);

  IF r.o_covered AND r.o_covered_amount > 0 AND r.o_covered_amount < NEW.net_amount THEN
    PERFORM public.fn_split_posting(NEW.id, r.o_covered_amount, r.o_cap_reason);
  END IF;
  RETURN NULL;
END;
$$;

-- Name sorts after trg_package_rollup so the rollup re-runs on the split's
-- UPDATE/INSERT and lands on the corrected consumption.
DROP TRIGGER IF EXISTS trg_zzz_package_split ON public.charge_postings;
CREATE TRIGGER trg_zzz_package_split
  AFTER INSERT ON public.charge_postings
  FOR EACH ROW EXECUTE FUNCTION public.trg_split_capped_posting();

-- Cancelling a parent cancels its excess half.
CREATE OR REPLACE FUNCTION public.trg_cascade_split_cancel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.charge_postings
       SET status = 'cancelled',
           cancelled_reason = COALESCE(cancelled_reason, 'Parent charge cancelled'),
           updated_at = now()
     WHERE split_parent_id = NEW.id AND status <> 'cancelled';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_split_cancel_cascade ON public.charge_postings;
CREATE TRIGGER trg_split_cancel_cascade
  AFTER UPDATE OF status ON public.charge_postings
  FOR EACH ROW EXECUTE FUNCTION public.trg_cascade_split_cancel();

-- ---------------------------------------------------------------------------
-- 5. Merge-back, so re-applying rules is idempotent
--
-- Without this, "Re-evaluate rules" would re-resolve halves as if they were
-- whole charges and double-count consumption. Only PENDING pairs are merged —
-- anything billed is final.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_split_postings(p_admission_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT c.id, c.split_parent_id, c.split_origin
      FROM public.charge_postings c
      JOIN public.charge_postings p ON p.id = c.split_parent_id
     WHERE c.admission_id = p_admission_id
       AND c.split_parent_id IS NOT NULL
       AND c.split_origin IS NOT NULL
       AND c.status = 'pending'
       AND p.status = 'pending'
  LOOP
    UPDATE public.charge_postings
       SET quantity        = (r.split_origin->>'quantity')::numeric,
           unit_rate       = (r.split_origin->>'unit_rate')::numeric,
           gross_amount    = (r.split_origin->>'gross_amount')::numeric,
           discount_amount = (r.split_origin->>'discount_amount')::numeric,
           net_amount      = (r.split_origin->>'net_amount')::numeric,
           tax_amount      = (r.split_origin->>'tax_amount')::numeric,
           cost_snapshot   = (r.split_origin->>'cost_snapshot')::numeric,
           description     = r.split_origin->>'description',
           split_reason    = NULL,
           updated_at      = now()
     WHERE id = r.split_parent_id;

    DELETE FROM public.charge_postings WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Re-apply pass v2 — merge back, re-resolve, re-split
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reapply_package_coverage(p_admission_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  res record;
  v_changed integer := 0;
  v_ap_id uuid;
  v_consumed numeric; v_agreed numeric;
BEGIN
  PERFORM public.merge_split_postings(p_admission_id);

  FOR r IN
    SELECT id, service_id, charge_group_path, quantity, net_amount, unit_rate
      FROM public.charge_postings
     WHERE admission_id = p_admission_id
       AND status = 'pending'
       AND split_parent_id IS NULL
     ORDER BY service_date, created_at
  LOOP
    SELECT * INTO res FROM public.fn_resolve_coverage(
      p_admission_id, r.id, r.service_id, r.charge_group_path,
      r.quantity, r.net_amount, r.unit_rate);

    UPDATE public.charge_postings
       SET covered_by_package = res.o_covered,
           package_assignment_id = res.o_assignment_id,
           package_item_id = res.o_item_id,
           updated_at = now()
     WHERE id = r.id
       AND (covered_by_package IS DISTINCT FROM res.o_covered
            OR package_assignment_id IS DISTINCT FROM res.o_assignment_id
            OR package_item_id IS DISTINCT FROM res.o_item_id);
    IF FOUND THEN v_changed := v_changed + 1; END IF;

    IF res.o_covered AND res.o_covered_amount > 0 AND res.o_covered_amount < r.net_amount THEN
      PERFORM public.fn_split_posting(r.id, res.o_covered_amount, res.o_cap_reason);
      v_changed := v_changed + 1;
    END IF;
  END LOOP;

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

COMMIT;
