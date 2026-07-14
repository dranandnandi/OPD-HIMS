-- ============================================================================
-- IPD Migration 001: Charge Catalog
-- departments, charge_groups (hierarchical MIS layer), services_master,
-- payers, tariff_plans, tariff_rates
--
-- Shared Supabase project with the OPD app. Tenancy = clinic_id
-- referencing public.clinic_settings, RLS via profiles lookup (OPD pattern).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: reusable RLS predicate (same pattern the OPD app uses)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_clinic_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT clinic_id FROM public.profiles WHERE id = auth.uid() AND clinic_id IS NOT NULL;
$$;

-- ---------------------------------------------------------------------------
-- 1. departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'clinical'
    CHECK (type IN ('clinical', 'diagnostic', 'support')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

-- ---------------------------------------------------------------------------
-- 2. charge_groups — hierarchical MIS/clubbing layer (any depth)
--    path is maintained by trigger: 'INV/INV-PATH/INV-PATH-BIO'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.charge_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.charge_groups(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  path text NOT NULL DEFAULT '',
  depth integer NOT NULL DEFAULT 1,
  default_cost_center_id uuid, -- FK added in migration 013
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

-- Maintain path + depth on insert/update of parent_id or code
CREATE OR REPLACE FUNCTION public.charge_groups_maintain_path()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_path text;
  parent_depth integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := NEW.code;
    NEW.depth := 1;
  ELSE
    SELECT path, depth INTO parent_path, parent_depth
      FROM public.charge_groups WHERE id = NEW.parent_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'Parent charge group % not found', NEW.parent_id;
    END IF;
    NEW.path := parent_path || '/' || NEW.code;
    NEW.depth := parent_depth + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_charge_groups_path
  BEFORE INSERT OR UPDATE OF parent_id, code ON public.charge_groups
  FOR EACH ROW EXECUTE FUNCTION public.charge_groups_maintain_path();

-- Cascade path changes to descendants
CREATE OR REPLACE FUNCTION public.charge_groups_cascade_path()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.path IS DISTINCT FROM NEW.path THEN
    UPDATE public.charge_groups
       SET path = NEW.path || substring(path FROM length(OLD.path) + 1),
           depth = depth + (NEW.depth - OLD.depth)
     WHERE clinic_id = NEW.clinic_id
       AND path LIKE OLD.path || '/%';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_charge_groups_cascade
  AFTER UPDATE OF path ON public.charge_groups
  FOR EACH ROW EXECUTE FUNCTION public.charge_groups_cascade_path();

-- ---------------------------------------------------------------------------
-- 3. services_master — the service-code layer
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ipd_service_type_enum AS ENUM (
    'bed', 'consultation', 'lab', 'imaging', 'procedure', 'surgery',
    'pharmacy', 'consumable', 'implant', 'equipment', 'nursing', 'misc'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.services_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  service_code text NOT NULL,
  name text NOT NULL,
  charge_group_id uuid NOT NULL REFERENCES public.charge_groups(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  service_type public.ipd_service_type_enum NOT NULL DEFAULT 'misc',
  base_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  base_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_cost >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  cost_type text NOT NULL DEFAULT 'variable' CHECK (cost_type IN ('variable', 'fixed')),
  is_sharable boolean NOT NULL DEFAULT true,
  is_package_eligible boolean NOT NULL DEFAULT true,
  is_insurance_eligible boolean NOT NULL DEFAULT true,
  requires_doctor boolean NOT NULL DEFAULT false,
  external_system text CHECK (external_system IN ('lims', 'ris')),
  external_ref text,
  unit text NOT NULL DEFAULT 'unit',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, service_code)
);

-- ---------------------------------------------------------------------------
-- 4. payers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  payer_type text NOT NULL DEFAULT 'cash'
    CHECK (payer_type IN ('cash', 'tpa', 'insurer', 'corporate', 'government_scheme')),
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_deduction_buffer_pct numeric(5,2) NOT NULL DEFAULT 0,
  credit_days integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. tariff_plans + tariff_rates (payer-wise pricing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tariff_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name text NOT NULL,
  payer_id uuid REFERENCES public.payers(id) ON DELETE SET NULL,
  valid_from date,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tariff_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  tariff_plan_id uuid NOT NULL REFERENCES public.tariff_plans(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services_master(id) ON DELETE CASCADE,
  charge_group_id uuid REFERENCES public.charge_groups(id) ON DELETE CASCADE,
  rate numeric(12,2) CHECK (rate >= 0),
  multiplier numeric(6,3) CHECK (multiplier > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (service_id IS NOT NULL OR charge_group_id IS NOT NULL),
  CHECK (rate IS NOT NULL OR multiplier IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- 6. Tariff resolution: service rate > deepest charge-group rate > base_price
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tariff_rate(
  p_service_id uuid,
  p_tariff_plan_id uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base numeric;
  v_path text;
  v_rate numeric;
  v_mult numeric;
BEGIN
  SELECT s.base_price, g.path INTO v_base, v_path
    FROM public.services_master s
    JOIN public.charge_groups g ON g.id = s.charge_group_id
   WHERE s.id = p_service_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Service % not found', p_service_id;
  END IF;

  IF p_tariff_plan_id IS NULL THEN
    RETURN v_base;
  END IF;

  -- 1. Exact service rate
  SELECT r.rate, r.multiplier INTO v_rate, v_mult
    FROM public.tariff_rates r
   WHERE r.tariff_plan_id = p_tariff_plan_id AND r.service_id = p_service_id
   LIMIT 1;
  IF FOUND THEN
    RETURN COALESCE(v_rate, round(v_base * v_mult, 2));
  END IF;

  -- 2. Deepest matching charge group on the service's path
  SELECT r.rate, r.multiplier INTO v_rate, v_mult
    FROM public.tariff_rates r
    JOIN public.charge_groups g ON g.id = r.charge_group_id
   WHERE r.tariff_plan_id = p_tariff_plan_id
     AND (v_path = g.path OR v_path LIKE g.path || '/%')
   ORDER BY g.depth DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN COALESCE(v_rate, round(v_base * v_mult, 2));
  END IF;

  -- 3. Fallback
  RETURN v_base;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_departments_clinic ON public.departments (clinic_id);
CREATE INDEX IF NOT EXISTS idx_charge_groups_clinic ON public.charge_groups (clinic_id);
CREATE INDEX IF NOT EXISTS idx_charge_groups_parent ON public.charge_groups (parent_id);
CREATE INDEX IF NOT EXISTS idx_charge_groups_path ON public.charge_groups (clinic_id, path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_services_clinic ON public.services_master (clinic_id);
CREATE INDEX IF NOT EXISTS idx_services_group ON public.services_master (charge_group_id);
CREATE INDEX IF NOT EXISTS idx_services_type ON public.services_master (clinic_id, service_type);
CREATE INDEX IF NOT EXISTS idx_payers_clinic ON public.payers (clinic_id);
CREATE INDEX IF NOT EXISTS idx_tariff_plans_clinic ON public.tariff_plans (clinic_id);
CREATE INDEX IF NOT EXISTS idx_tariff_rates_plan ON public.tariff_rates (tariff_plan_id);
CREATE INDEX IF NOT EXISTS idx_tariff_rates_service ON public.tariff_rates (service_id);

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charge_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tariff_rates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'charge_groups', 'services_master',
    'payers', 'tariff_plans', 'tariff_rates'
  ] LOOP
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
