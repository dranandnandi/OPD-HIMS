-- ============================================================================
-- IPD Migration 017: Multi-store inventory
--
-- Model: the OPD pharmacy stock (medicines_master.current_stock) is the
-- MAIN PHARMACY pool. Sub-stores (IP Pharmacy, Dialysis Ward Store, OT Store,
-- ward stores) hold their own per-medicine stock in store_stock.
--
--   * transfer_from_main(store, medicine, qty): main pool → sub-store
--     (deducts medicines_master.current_stock + logs stock_movement_log,
--      credits store_stock)
--   * transfer_between_stores(from, to, medicine, qty): sub → sub
--   * consume_from_store(store, medicine, qty, admission): deducts the store,
--     records pharmacy_dispensed_items (admission-linked) — the patient charge
--     is posted by the app so package rules & bill description apply.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ipd_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,                 -- 'IP Pharmacy', 'Dialysis Ward Store', 'OT Store'
  ward_id uuid REFERENCES public.ipd_wards(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);

CREATE TABLE IF NOT EXISTS public.store_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ipd_stores(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, medicine_id)
);

CREATE TABLE IF NOT EXISTS public.store_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  from_store_id uuid REFERENCES public.ipd_stores(id) ON DELETE SET NULL, -- NULL = main pharmacy pool
  to_store_id uuid REFERENCES public.ipd_stores(id) ON DELETE SET NULL,   -- NULL = back to main
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  moved_by uuid REFERENCES public.profiles(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_store_id IS DISTINCT FROM to_store_id)
);

CREATE TABLE IF NOT EXISTS public.store_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ipd_stores(id) ON DELETE RESTRICT,
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE RESTRICT,
  admission_id uuid REFERENCES public.ipd_admissions(id) ON DELETE SET NULL, -- NULL = ward general use
  quantity integer NOT NULL CHECK (quantity > 0),
  charge_posting_id uuid REFERENCES public.charge_postings(id) ON DELETE SET NULL,
  consumed_by uuid REFERENCES public.profiles(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stores_clinic ON public.ipd_stores (clinic_id);
CREATE INDEX IF NOT EXISTS idx_store_stock_store ON public.store_stock (store_id);
CREATE INDEX IF NOT EXISTS idx_store_transfers_clinic ON public.store_transfers (clinic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_consumptions_store ON public.store_consumptions (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_consumptions_admission ON public.store_consumptions (admission_id)
  WHERE admission_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Transfer: main pharmacy pool → sub-store (atomic, stock-checked)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_from_main(
  p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
  p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock integer;
BEGIN
  SELECT current_stock INTO v_stock
    FROM public.medicines_master
   WHERE id = p_medicine_id AND clinic_id = p_clinic_id
   FOR UPDATE;
  IF v_stock IS NULL THEN RAISE EXCEPTION 'Medicine not found'; END IF;
  IF v_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient main pharmacy stock (available %)', v_stock;
  END IF;

  UPDATE public.medicines_master
     SET current_stock = v_stock - p_quantity
   WHERE id = p_medicine_id;

  INSERT INTO public.stock_movement_log
    (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
     reference_type, moved_by, movement_date, remarks)
  VALUES
    (p_clinic_id, p_medicine_id, 'outward', -p_quantity, v_stock - p_quantity,
     'store_transfer', p_user_id, now(),
     COALESCE(p_remarks, 'Transfer to sub-store'));

  INSERT INTO public.store_stock (clinic_id, store_id, medicine_id, quantity)
  VALUES (p_clinic_id, p_store_id, p_medicine_id, p_quantity)
  ON CONFLICT (store_id, medicine_id)
  DO UPDATE SET quantity = public.store_stock.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.store_transfers
    (clinic_id, from_store_id, to_store_id, medicine_id, quantity, moved_by, remarks)
  VALUES (p_clinic_id, NULL, p_store_id, p_medicine_id, p_quantity, p_user_id, p_remarks);
END;
$$;

-- ---------------------------------------------------------------------------
-- Transfer: sub-store → sub-store
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_between_stores(
  p_clinic_id uuid, p_from_store uuid, p_to_store uuid, p_medicine_id uuid,
  p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty integer;
BEGIN
  SELECT quantity INTO v_qty FROM public.store_stock
   WHERE store_id = p_from_store AND medicine_id = p_medicine_id
   FOR UPDATE;
  IF COALESCE(v_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in source store (available %)', COALESCE(v_qty, 0);
  END IF;

  UPDATE public.store_stock SET quantity = quantity - p_quantity, updated_at = now()
   WHERE store_id = p_from_store AND medicine_id = p_medicine_id;

  INSERT INTO public.store_stock (clinic_id, store_id, medicine_id, quantity)
  VALUES (p_clinic_id, p_to_store, p_medicine_id, p_quantity)
  ON CONFLICT (store_id, medicine_id)
  DO UPDATE SET quantity = public.store_stock.quantity + EXCLUDED.quantity, updated_at = now();

  INSERT INTO public.store_transfers
    (clinic_id, from_store_id, to_store_id, medicine_id, quantity, moved_by, remarks)
  VALUES (p_clinic_id, p_from_store, p_to_store, p_medicine_id, p_quantity, p_user_id, p_remarks);
END;
$$;

-- ---------------------------------------------------------------------------
-- Consume from a store (optionally chargeable to an admission).
-- Returns the consumption id; the app posts the patient charge and
-- writes pharmacy_dispensed_items so OPD pharmacy reports stay complete.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_from_store(
  p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
  p_quantity integer, p_admission_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty integer;
  v_id uuid;
BEGIN
  SELECT quantity INTO v_qty FROM public.store_stock
   WHERE store_id = p_store_id AND medicine_id = p_medicine_id
   FOR UPDATE;
  IF COALESCE(v_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient store stock (available %)', COALESCE(v_qty, 0);
  END IF;

  UPDATE public.store_stock SET quantity = quantity - p_quantity, updated_at = now()
   WHERE store_id = p_store_id AND medicine_id = p_medicine_id;

  INSERT INTO public.store_consumptions
    (clinic_id, store_id, medicine_id, admission_id, quantity, consumed_by, remarks)
  VALUES (p_clinic_id, p_store_id, p_medicine_id, p_admission_id, p_quantity, p_user_id, p_remarks)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- RLS
ALTER TABLE public.ipd_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_consumptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ipd_stores', 'store_stock', 'store_transfers', 'store_consumptions'] LOOP
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
