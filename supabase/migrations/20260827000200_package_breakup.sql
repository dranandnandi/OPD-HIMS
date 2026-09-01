-- ============================================================================
-- IPD Migration 025: Package break-up for TPA / insurance claims
--
-- A package is billed to the patient as ONE line at the agreed price. A TPA
-- claim needs the same money presented as an itemised annexure. This adds:
--
--   package_breakup_rules            optional per-package template
--                                    (Surgeon 25%, OT 15%, Anaesthesia ₹8,000 …)
--   admission_package_breakup_lines  the per-admission snapshot, so a claim
--                                    stays reproducible after tariffs change
--
-- The RESIDUAL line is never typed in. A trigger keeps it at
--
--     residual = agreed_price − SUM(net of every other line)
--
-- and re-runs on every insert / update / delete of a sibling line, and when the
-- agreed price itself changes. Add a ₹10,000 component to a ₹250,000 package
-- sitting at ₹200,000 of components and the residual drops ₹50,000 → ₹40,000 by
-- itself. The break-up therefore always totals the package price exactly.
--
-- Source of the component lines:
--   * package has template rules  → template-driven
--   * otherwise                   → built from the actual covered postings,
--                                   grouped by charge head (Investigations,
--                                   Room Rent, OT Charges …)
--
-- Charges that were never covered — exclusions, and the excess halves produced
-- by split caps — are NOT part of the break-up. They are already separate
-- patient-payable bill lines and must not be counted twice.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Package-level settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS residual_service_id uuid
    REFERENCES public.services_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS residual_label text,
  ADD COLUMN IF NOT EXISTS breakup_grain text NOT NULL DEFAULT 'charge_group'
    CHECK (breakup_grain IN ('charge_group', 'service'));

COMMENT ON COLUMN public.packages.residual_service_id IS
  'Head that absorbs the balancing figure. NULL falls back to the clinic service flagged is_package_residual.';
COMMENT ON COLUMN public.packages.residual_label IS
  'What the residual line prints as on the annexure. NULL uses the head service name.';

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
-- A template row targets EITHER a charge head (group) or one service. Head
-- grain is the common case — "Investigations", "Room Rent", "OT Charges" are
-- groups, and several of them have no service of their own to point at.
CREATE TABLE IF NOT EXISTS public.package_breakup_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services_master(id) ON DELETE CASCADE,
  charge_group_id uuid REFERENCES public.charge_groups(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('percent', 'fixed')),
  value numeric(12,2) NOT NULL CHECK (value >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bring an already-created table (service-only shape) up to the above.
ALTER TABLE public.package_breakup_rules
  ADD COLUMN IF NOT EXISTS charge_group_id uuid
    REFERENCES public.charge_groups(id) ON DELETE CASCADE;
ALTER TABLE public.package_breakup_rules ALTER COLUMN service_id DROP NOT NULL;
ALTER TABLE public.package_breakup_rules
  DROP CONSTRAINT IF EXISTS package_breakup_rules_package_id_service_id_key;
ALTER TABLE public.package_breakup_rules
  DROP CONSTRAINT IF EXISTS package_breakup_rules_target_ck;
ALTER TABLE public.package_breakup_rules
  ADD CONSTRAINT package_breakup_rules_target_ck
  CHECK (num_nonnulls(service_id, charge_group_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_breakup_rule_service
  ON public.package_breakup_rules (package_id, service_id) WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_breakup_rule_group
  ON public.package_breakup_rules (package_id, charge_group_id) WHERE charge_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.admission_package_breakup_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.admission_packages(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services_master(id) ON DELETE SET NULL,
  charge_group_id uuid REFERENCES public.charge_groups(id) ON DELETE SET NULL,
  charge_group_path text,
  description text NOT NULL,
  quantity numeric(8,2) NOT NULL DEFAULT 1,
  unit_rate numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL DEFAULT 0,
  is_residual boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'actual'
    CHECK (source IN ('actual', 'template', 'manual', 'residual')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_breakup_lines_assignment
  ON public.admission_package_breakup_lines (assignment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_residual_line_per_assignment
  ON public.admission_package_breakup_lines (assignment_id) WHERE is_residual;

CREATE INDEX IF NOT EXISTS idx_breakup_rules_package
  ON public.package_breakup_rules (package_id);

-- ---------------------------------------------------------------------------
-- 3. Which head absorbs the residual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_residual_service(p_assignment_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v_service uuid; v_clinic uuid;
BEGIN
  SELECT p.residual_service_id, ap.clinic_id INTO v_service, v_clinic
    FROM public.admission_packages ap
    JOIN public.packages p ON p.id = ap.package_id
   WHERE ap.id = p_assignment_id;

  IF v_service IS NOT NULL THEN RETURN v_service; END IF;

  SELECT id INTO v_service
    FROM public.services_master
   WHERE clinic_id = v_clinic AND is_package_residual AND is_active
   LIMIT 1;

  RETURN v_service;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The residual is always derived, never entered
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_package_residual(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_agreed numeric; v_clinic uuid; v_others numeric;
  v_resid_id uuid; v_service uuid; v_name text; v_group uuid; v_path text;
BEGIN
  SELECT agreed_price, clinic_id INTO v_agreed, v_clinic
    FROM public.admission_packages WHERE id = p_assignment_id;
  IF v_agreed IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(net), 0) INTO v_others
    FROM public.admission_package_breakup_lines
   WHERE assignment_id = p_assignment_id AND NOT is_residual;

  SELECT id INTO v_resid_id
    FROM public.admission_package_breakup_lines
   WHERE assignment_id = p_assignment_id AND is_residual;

  IF v_resid_id IS NOT NULL THEN
    UPDATE public.admission_package_breakup_lines
       SET net = v_agreed - v_others,
           unit_rate = v_agreed - v_others,
           updated_at = now()
     WHERE id = v_resid_id;
    RETURN;
  END IF;

  -- No residual row yet — create it against the configured head.
  v_service := public.fn_residual_service(p_assignment_id);
  IF v_service IS NULL THEN
    RAISE EXCEPTION
      'No residual charge head configured. Set one on the package, or flag a service with is_package_residual (seed PKG-RESID).';
  END IF;

  -- The package may override what the line PRINTS as; the head itself is
  -- still a real service so the annexure maps to a charge code.
  SELECT COALESCE(NULLIF(btrim(p.residual_label), ''), s.name), s.charge_group_id, g.path
    INTO v_name, v_group, v_path
    FROM public.services_master s
    JOIN public.charge_groups g ON g.id = s.charge_group_id
    JOIN public.admission_packages ap ON ap.id = p_assignment_id
    JOIN public.packages p ON p.id = ap.package_id
   WHERE s.id = v_service;

  INSERT INTO public.admission_package_breakup_lines
    (clinic_id, assignment_id, service_id, charge_group_id, charge_group_path,
     description, quantity, unit_rate, net, is_residual, source, sort_order)
  VALUES
    (v_clinic, p_assignment_id, v_service, v_group, v_path,
     v_name, 1, v_agreed - v_others, v_agreed - v_others, true, 'residual', 9999);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_breakup_line_residual()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- the residual row maintaining itself must not re-fire the recompute
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_residual THEN RETURN NULL; END IF;
    PERFORM public.recompute_package_residual(OLD.assignment_id);
  ELSE
    IF NEW.is_residual THEN RETURN NULL; END IF;
    PERFORM public.recompute_package_residual(NEW.assignment_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_breakup_residual ON public.admission_package_breakup_lines;
CREATE TRIGGER trg_breakup_residual
  AFTER INSERT OR UPDATE OF net OR DELETE ON public.admission_package_breakup_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_breakup_line_residual();

-- Re-negotiating the package price re-balances the residual too.
CREATE OR REPLACE FUNCTION public.trg_agreed_price_residual()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admission_package_breakup_lines WHERE assignment_id = NEW.id) THEN
    PERFORM public.recompute_package_residual(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_package_price_residual ON public.admission_packages;
CREATE TRIGGER trg_package_price_residual
  AFTER UPDATE OF agreed_price ON public.admission_packages
  FOR EACH ROW EXECUTE FUNCTION public.trg_agreed_price_residual();

-- ---------------------------------------------------------------------------
-- 5. Build the break-up
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_generate_package_breakup(p_assignment_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic uuid; v_agreed numeric; v_pkg_id uuid; v_grain text;
  v_has_template boolean; v_total numeric;
BEGIN
  SELECT ap.clinic_id, ap.agreed_price, ap.package_id, p.breakup_grain
    INTO v_clinic, v_agreed, v_pkg_id, v_grain
    FROM public.admission_packages ap
    JOIN public.packages p ON p.id = ap.package_id
   WHERE ap.id = p_assignment_id;

  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'Package assignment % not found', p_assignment_id;
  END IF;

  -- Components first, residual last. Deleting the residual first would let the
  -- trigger recreate it mid-statement and collide with uq_one_residual_line.
  DELETE FROM public.admission_package_breakup_lines
   WHERE assignment_id = p_assignment_id AND NOT is_residual;
  DELETE FROM public.admission_package_breakup_lines
   WHERE assignment_id = p_assignment_id AND is_residual;

  SELECT EXISTS (SELECT 1 FROM public.package_breakup_rules WHERE package_id = v_pkg_id)
    INTO v_has_template;

  IF v_has_template THEN
    INSERT INTO public.admission_package_breakup_lines
      (clinic_id, assignment_id, service_id, charge_group_id, charge_group_path,
       description, quantity, unit_rate, net, source, sort_order)
    -- A row targets a service OR a charge head; take the label and the group
    -- from whichever one it is.
    SELECT v_clinic, p_assignment_id,
           r.service_id,
           COALESCE(s.charge_group_id, r.charge_group_id),
           COALESCE(sg.path, cg.path),
           COALESCE(s.name, cg.name), 1,
           CASE r.mode WHEN 'percent' THEN round(v_agreed * r.value / 100, 2) ELSE r.value END,
           CASE r.mode WHEN 'percent' THEN round(v_agreed * r.value / 100, 2) ELSE r.value END,
           'template', r.sort_order
      FROM public.package_breakup_rules r
      LEFT JOIN public.services_master s ON s.id = r.service_id
      LEFT JOIN public.charge_groups sg ON sg.id = s.charge_group_id
      LEFT JOIN public.charge_groups cg ON cg.id = r.charge_group_id
     WHERE r.package_id = v_pkg_id
     ORDER BY r.sort_order, r.created_at;

  ELSIF v_grain = 'service' THEN
    INSERT INTO public.admission_package_breakup_lines
      (clinic_id, assignment_id, service_id, charge_group_id, charge_group_path,
       description, quantity, unit_rate, net, source, sort_order)
    SELECT v_clinic, p_assignment_id, s.id, cp.charge_group_id, cp.charge_group_path,
           s.name, SUM(cp.quantity),
           round(SUM(cp.net_amount) / NULLIF(SUM(cp.quantity), 0), 2),
           SUM(cp.net_amount), 'actual',
           row_number() OVER (ORDER BY cp.charge_group_path, s.name)
      FROM public.charge_postings cp
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.package_assignment_id = p_assignment_id
       AND cp.status <> 'cancelled'
     GROUP BY s.id, s.name, cp.charge_group_id, cp.charge_group_path
    HAVING SUM(cp.net_amount) > 0;

  ELSE
    -- one line per top-level charge head: Investigations, Room Rent, OT …
    INSERT INTO public.admission_package_breakup_lines
      (clinic_id, assignment_id, charge_group_id, charge_group_path,
       description, quantity, unit_rate, net, source, sort_order)
    SELECT v_clinic, p_assignment_id, g.id, g.path,
           g.name, 1, SUM(cp.net_amount), SUM(cp.net_amount), 'actual',
           row_number() OVER (ORDER BY g.code)
      FROM public.charge_postings cp
      JOIN public.charge_groups g
        ON g.clinic_id = cp.clinic_id
       AND g.code = split_part(cp.charge_group_path, '/', 1)
     WHERE cp.package_assignment_id = p_assignment_id
       AND cp.status <> 'cancelled'
     GROUP BY g.id, g.code, g.name, g.path
    HAVING SUM(cp.net_amount) > 0;
  END IF;

  -- Nothing above fired the residual trigger if there were no component lines.
  PERFORM public.recompute_package_residual(p_assignment_id);

  SELECT COALESCE(SUM(net), 0) INTO v_total
    FROM public.admission_package_breakup_lines WHERE assignment_id = p_assignment_id;

  IF round(v_total, 2) <> round(v_agreed, 2) THEN
    RAISE EXCEPTION 'Break-up totals % but the package price is % — refusing to save an unbalanced claim',
      v_total, v_agreed;
  END IF;

  RETURN v_total;
END;
$$;

-- Break-up lines built before the residual head was given an annexure-safe
-- name still carry the old wording. A rebuild would fix them; this saves it.
UPDATE public.admission_package_breakup_lines
   SET description = 'Hospital & Nursing Services', updated_at = now()
 WHERE is_residual AND description = 'Package Residual — Hospital Services';

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.package_breakup_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_package_breakup_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['package_breakup_rules', 'admission_package_breakup_lines'] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_write ON public.%I', t);
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
