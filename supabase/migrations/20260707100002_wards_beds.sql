-- ============================================================================
-- IPD Migration 002: Wards & Beds
-- bed_types (tariff via room-rent service), ipd_wards, ipd_beds
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. bed_types — General / Semi-Private / Private / Deluxe / ICU / HDU / NICU
--    Daily tariff comes from room_rent_service_id -> tariff resolution,
--    so payer plans price bed days automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bed_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  room_rent_service_id uuid NOT NULL REFERENCES public.services_master(id) ON DELETE RESTRICT,
  nursing_service_id uuid REFERENCES public.services_master(id) ON DELETE SET NULL,
  is_critical_care boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

-- ---------------------------------------------------------------------------
-- 2. ipd_wards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name text NOT NULL,
  floor text,
  ward_type text NOT NULL DEFAULT 'general'
    CHECK (ward_type IN ('general', 'private', 'icu', 'hdu', 'maternity', 'pediatric', 'isolation')),
  gender_restriction text CHECK (gender_restriction IN ('male', 'female')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, name)
);

-- ---------------------------------------------------------------------------
-- 3. ipd_beds
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ipd_bed_status_enum AS ENUM (
    'available', 'occupied', 'cleaning', 'maintenance', 'reserved', 'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.ipd_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  ward_id uuid NOT NULL REFERENCES public.ipd_wards(id) ON DELETE CASCADE,
  bed_number text NOT NULL,
  bed_type_id uuid NOT NULL REFERENCES public.bed_types(id) ON DELETE RESTRICT,
  status public.ipd_bed_status_enum NOT NULL DEFAULT 'available',
  status_note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, ward_id, bed_number)
);

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bed_types_clinic ON public.bed_types (clinic_id);
CREATE INDEX IF NOT EXISTS idx_ipd_wards_clinic ON public.ipd_wards (clinic_id);
CREATE INDEX IF NOT EXISTS idx_ipd_beds_clinic ON public.ipd_beds (clinic_id);
CREATE INDEX IF NOT EXISTS idx_ipd_beds_ward ON public.ipd_beds (ward_id);
CREATE INDEX IF NOT EXISTS idx_ipd_beds_status ON public.ipd_beds (clinic_id, status);

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.bed_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_beds ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bed_types', 'ipd_wards', 'ipd_beds'] LOOP
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
