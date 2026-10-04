-- ============================================================================
-- Store indents: IP Pharmacy / ward sub-store  →  Main Pharmacy requisition
--
-- Until now stock only reached a sub-store by someone PUSHING it from the IPD
-- Stores page (transfer_from_main). The main pharmacy never learned that a ward
-- wanted anything. This adds the pull side, with a status the pharmacy can be
-- notified on:
--
--   1. IP Pharmacy raises an indent   → 'ordered'    (pharmacy bell lights up)
--   2. Main pharmacy dispatches it    → 'dispatched' | 'partial' (short supply)
--      Each dispatched line does exactly what transfer_from_main does — deducts
--      the main pool, logs stock_movement_log, credits store_stock, writes a
--      store_transfers row — so the stock maths stay identical to a manual push.
--   3. The requesting store acknowledges arrival → 'received'
--
-- Pharmacy-side notification = indents in 'ordered' (unseen ones have
-- pharmacy_seen_at IS NULL). Ward-side notification = 'dispatched'/'partial'
-- indents not yet received.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_indents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  indent_no text NOT NULL,
  store_id uuid NOT NULL REFERENCES public.ipd_stores(id) ON DELETE CASCADE, -- requesting store
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'partial', 'dispatched', 'received', 'cancelled')),
  priority text NOT NULL DEFAULT 'routine'
    CHECK (priority IN ('routine', 'urgent', 'stat')),
  notes text,
  requested_by uuid REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- stamped when the pharmacy first opens the indent, so the bell can tell
  -- "new" from "already looked at"
  pharmacy_seen_at timestamptz,
  dispatched_by uuid REFERENCES public.profiles(id),
  dispatched_at timestamptz,
  dispatch_remarks text,
  received_by uuid REFERENCES public.profiles(id),
  received_at timestamptz,
  cancelled_by uuid REFERENCES public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, indent_no)
);

CREATE TABLE IF NOT EXISTS public.store_indent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  indent_id uuid NOT NULL REFERENCES public.store_indents(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE RESTRICT,
  requested_qty integer NOT NULL CHECK (requested_qty > 0),
  dispatched_qty integer NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (indent_id, medicine_id)
);

CREATE INDEX IF NOT EXISTS idx_store_indents_clinic_status
  ON public.store_indents (clinic_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_indents_store
  ON public.store_indents (store_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_indent_items_indent
  ON public.store_indent_items (indent_id);

-- ---------------------------------------------------------------------------
-- Raise an indent: header + lines in one transaction, with a per-clinic,
-- per-day serial (IND-YYMMDD-001). The advisory lock serialises the numbering
-- so two wards indenting at the same moment cannot collide.
-- p_items: [{ "medicine_id": uuid, "quantity": int, "remarks": text|null }, …]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_store_indent(
  p_clinic_id uuid,
  p_store_id uuid,
  p_items jsonb,
  p_priority text DEFAULT 'routine',
  p_notes text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_no text;
  v_seq integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_item jsonb;
  v_lines integer := 0;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one medicine to the indent';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('store_indent_no' || p_clinic_id::text));

  SELECT COUNT(*) + 1 INTO v_seq
    FROM public.store_indents
   WHERE clinic_id = p_clinic_id
     AND (requested_at AT TIME ZONE 'Asia/Kolkata')::date = v_today;

  v_no := 'IND-' || to_char(v_today, 'YYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  INSERT INTO public.store_indents
    (clinic_id, indent_no, store_id, priority, notes, requested_by)
  VALUES
    (p_clinic_id, v_no, p_store_id, COALESCE(p_priority, 'routine'), p_notes, p_user_id)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    CONTINUE WHEN COALESCE((v_item ->> 'quantity')::integer, 0) <= 0;

    INSERT INTO public.store_indent_items
      (clinic_id, indent_id, medicine_id, requested_qty, remarks)
    VALUES
      (p_clinic_id, v_id, (v_item ->> 'medicine_id')::uuid,
       (v_item ->> 'quantity')::integer, NULLIF(v_item ->> 'remarks', ''))
    ON CONFLICT (indent_id, medicine_id)
    DO UPDATE SET requested_qty = public.store_indent_items.requested_qty + EXCLUDED.requested_qty;

    v_lines := v_lines + 1;
  END LOOP;

  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Add at least one medicine with a quantity';
  END IF;

  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Dispatch against an indent from the main pharmacy pool.
-- p_lines: [{ "item_id": uuid, "quantity": int }, …] — quantity is what is
-- being sent NOW, so a short supply can be topped up by dispatching again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_store_indent(
  p_indent_id uuid,
  p_lines jsonb,
  p_user_id uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_indent public.store_indents%ROWTYPE;
  v_line jsonb;
  v_item public.store_indent_items%ROWTYPE;
  v_name text;
  v_qty integer;
  v_stock integer;
  v_sent integer := 0;
  v_outstanding integer;
BEGIN
  SELECT * INTO v_indent FROM public.store_indents WHERE id = p_indent_id FOR UPDATE;
  IF v_indent.id IS NULL THEN
    RAISE EXCEPTION 'Indent not found';
  END IF;
  IF v_indent.status IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'Indent % is already %', v_indent.indent_no, v_indent.status;
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Nothing to dispatch';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    CONTINUE WHEN v_qty <= 0;

    SELECT * INTO v_item FROM public.store_indent_items
     WHERE id = (v_line ->> 'item_id')::uuid AND indent_id = p_indent_id
     FOR UPDATE;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION 'Indent line does not belong to this indent';
    END IF;

    IF v_item.dispatched_qty + v_qty > v_item.requested_qty THEN
      RAISE EXCEPTION 'Cannot dispatch more than requested (line already at % of %)',
        v_item.dispatched_qty, v_item.requested_qty;
    END IF;

    SELECT name, current_stock INTO v_name, v_stock
      FROM public.medicines_master
     WHERE id = v_item.medicine_id AND clinic_id = v_indent.clinic_id
     FOR UPDATE;
    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'Medicine not found in the master';
    END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient main pharmacy stock for % (available %)', v_name, v_stock;
    END IF;

    UPDATE public.medicines_master
       SET current_stock = v_stock - v_qty
     WHERE id = v_item.medicine_id;

    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
       reference_type, reference_id, moved_by, movement_date, remarks)
    VALUES
      (v_indent.clinic_id, v_item.medicine_id, 'outward', -v_qty, v_stock - v_qty,
       'store_indent', p_indent_id, p_user_id, now(),
       'Indent ' || v_indent.indent_no);

    INSERT INTO public.store_stock (clinic_id, store_id, medicine_id, quantity)
    VALUES (v_indent.clinic_id, v_indent.store_id, v_item.medicine_id, v_qty)
    ON CONFLICT (store_id, medicine_id)
    DO UPDATE SET quantity = public.store_stock.quantity + EXCLUDED.quantity, updated_at = now();

    INSERT INTO public.store_transfers
      (clinic_id, from_store_id, to_store_id, medicine_id, quantity, moved_by, remarks)
    VALUES
      (v_indent.clinic_id, NULL, v_indent.store_id, v_item.medicine_id, v_qty, p_user_id,
       'Indent ' || v_indent.indent_no);

    UPDATE public.store_indent_items
       SET dispatched_qty = dispatched_qty + v_qty
     WHERE id = v_item.id;

    v_sent := v_sent + 1;
  END LOOP;

  IF v_sent = 0 THEN
    RAISE EXCEPTION 'Nothing to dispatch — enter a quantity on at least one line';
  END IF;

  SELECT COUNT(*) INTO v_outstanding
    FROM public.store_indent_items
   WHERE indent_id = p_indent_id AND dispatched_qty < requested_qty;

  UPDATE public.store_indents
     SET status = CASE WHEN v_outstanding = 0 THEN 'dispatched' ELSE 'partial' END,
         dispatched_by = p_user_id,
         dispatched_at = now(),
         dispatch_remarks = COALESCE(NULLIF(p_remarks, ''), dispatch_remarks),
         pharmacy_seen_at = COALESCE(pharmacy_seen_at, now()),
         updated_at = now()
   WHERE id = p_indent_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The requesting store acknowledges that the stock physically arrived.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_store_indent(
  p_indent_id uuid,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.store_indents
     SET status = 'received', received_by = p_user_id, received_at = now(), updated_at = now()
   WHERE id = p_indent_id
     AND status IN ('partial', 'dispatched');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a dispatched indent can be marked received';
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Cancel — only while nothing has physically moved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_store_indent(
  p_indent_id uuid,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.store_indents
     SET status = 'cancelled', cancelled_by = p_user_id, cancelled_at = now(),
         cancel_reason = NULLIF(p_reason, ''), updated_at = now()
   WHERE id = p_indent_id
     AND status = 'ordered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an indent that has not been dispatched can be cancelled';
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Mark the pharmacy's notification as read (bell badge clears).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_store_indents_seen(
  p_clinic_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.store_indents
     SET pharmacy_seen_at = now()
   WHERE clinic_id = p_clinic_id
     AND pharmacy_seen_at IS NULL
     AND status = 'ordered';
$fn$;

-- RLS — same tenant pattern as the rest of the store tables
ALTER TABLE public.store_indents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_indent_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_indents', 'store_indent_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
           USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_write'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
           USING (clinic_id IN (SELECT public.user_clinic_ids()))
           WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    END IF;
  END LOOP;
END $$;

-- Live notification: the pharmacy bell and the ward badge listen on this table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'store_indents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_indents;
  END IF;
END $$;

COMMIT;
