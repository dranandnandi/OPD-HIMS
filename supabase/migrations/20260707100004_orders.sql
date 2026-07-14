-- ============================================================================
-- IPD Migration 004: Orders backbone
-- One spine for everything a doctor orders: services, lab (LIMS bridge),
-- imaging, procedures. Medications have their own flow in 006.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ipd_orders (header)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  ordered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_datetime timestamptz NOT NULL DEFAULT now(),
  priority text NOT NULL DEFAULT 'routine'
    CHECK (priority IN ('routine', 'urgent', 'stat')),
  clinical_notes text,
  status text NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. ipd_order_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.ipd_orders(id) ON DELETE CASCADE,
  admission_id uuid NOT NULL REFERENCES public.ipd_admissions(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services_master(id) ON DELETE RESTRICT,
  quantity numeric(8,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  performing_doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scheduled_for timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent_external', 'resulted', 'done', 'cancelled')),
  external_order_ref text,          -- LIMS order id after hims-order-create call
  result_ref jsonb,                 -- result summary/link from hims-report-callback
  charge_posting_id uuid,           -- FK added in migration 007
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. ipd_order_events (status audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ipd_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.ipd_order_items(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id),
  event_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 4. Order sets (per specialty quick-pick bundles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  name text NOT NULL,
  specialty text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, name)
);

CREATE TABLE IF NOT EXISTS public.order_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  order_set_id uuid NOT NULL REFERENCES public.order_sets(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services_master(id) ON DELETE CASCADE,
  default_qty numeric(8,2) NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_admission ON public.ipd_orders (admission_id);
CREATE INDEX IF NOT EXISTS idx_orders_clinic_status ON public.ipd_orders (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.ipd_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_admission ON public.ipd_order_items (admission_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON public.ipd_order_items (clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_order_events_item ON public.ipd_order_events (order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_set_items_set ON public.order_set_items (order_set_id);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ipd_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipd_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_set_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ipd_orders', 'ipd_order_items', 'ipd_order_events',
    'order_sets', 'order_set_items'
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
