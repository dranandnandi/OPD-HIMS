-- Complete the late installation of store indents without replaying the pack
-- migration (which would overwrite newer functions and rebuild sale columns).
-- Dispatch preserves fractional stock; the new RPCs check clinic membership
-- explicitly because SECURITY DEFINER bypasses table RLS. Audit actors come
-- from the authenticated session rather than caller-supplied user IDs.
BEGIN;

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  p_user_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.user_clinic_ids() c WHERE c = p_clinic_id) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ipd_stores WHERE id = p_store_id AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'Store does not belong to this clinic';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
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

    IF NOT EXISTS (SELECT 1 FROM public.medicines_master
                    WHERE id = (v_item ->> 'medicine_id')::uuid AND clinic_id = p_clinic_id) THEN
      RAISE EXCEPTION 'Medicine does not belong to this clinic';
    END IF;

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
    v_stock numeric;
    v_sent integer := 0;
    v_outstanding integer;
  BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  p_user_id := auth.uid();
    SELECT * INTO v_indent FROM public.store_indents WHERE id = p_indent_id FOR UPDATE;
    IF v_indent.id IS NULL THEN
      RAISE EXCEPTION 'Indent not found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_clinic_ids() c WHERE c = v_indent.clinic_id) THEN
      RAISE EXCEPTION 'Not allowed for this clinic';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ipd_stores WHERE id = v_indent.store_id AND clinic_id = v_indent.clinic_id) THEN
      RAISE EXCEPTION 'Store does not belong to this clinic';
    END IF;
    IF v_indent.status IN ('received', 'cancelled') THEN
      RAISE EXCEPTION 'Indent % is already %', v_indent.indent_no, v_indent.status;
    END IF;
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
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
        RAISE EXCEPTION 'Insufficient main pharmacy stock for % (available %)', v_name, trim_scale(v_stock);
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

CREATE OR REPLACE FUNCTION public.receive_store_indent(
  p_indent_id uuid,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  p_user_id := auth.uid();
  UPDATE public.store_indents
     SET status = 'received', received_by = p_user_id, received_at = now(), updated_at = now()
   WHERE id = p_indent_id
     AND clinic_id IN (SELECT public.user_clinic_ids())
     AND status IN ('partial', 'dispatched');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a dispatched indent can be marked received';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_store_indent(
  p_indent_id uuid,
  p_reason text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  p_user_id := auth.uid();
  UPDATE public.store_indents
     SET status = 'cancelled', cancelled_by = p_user_id, cancelled_at = now(),
         cancel_reason = NULLIF(p_reason, ''), updated_at = now()
   WHERE id = p_indent_id
     AND clinic_id IN (SELECT public.user_clinic_ids())
     AND status = 'ordered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an indent that has not been dispatched can be cancelled';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mark_store_indents_seen(
  p_clinic_id uuid
) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE public.store_indents
     SET pharmacy_seen_at = now()
   WHERE clinic_id = p_clinic_id
     AND auth.uid() IS NOT NULL
     AND clinic_id IN (SELECT public.user_clinic_ids())
     AND pharmacy_seen_at IS NULL
     AND status = 'ordered';
$fn$;

-- Restore the admission guard lost when the older pack function was replayed.
CREATE OR REPLACE FUNCTION public.pharmacy_dispense_consume_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qty numeric;
BEGIN
  -- jsonb read for the same reason as above: the column is IPD-only.
  IF (to_jsonb(NEW) ->> 'admission_id') IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;

  SELECT quantity INTO v_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_qty < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock in batch (available %, requested %)', trim_scale(v_qty), trim_scale(NEW.quantity);
  END IF;

  UPDATE public.medicine_batches
     SET quantity = quantity - NEW.quantity, updated_at = now()
   WHERE id = NEW.batch_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON TABLE public.store_indents, public.store_indent_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_indents, public.store_indent_items TO authenticated;
REVOKE ALL ON FUNCTION public.create_store_indent(uuid, uuid, jsonb, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_store_indent(uuid, uuid, jsonb, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dispatch_store_indent(uuid, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_store_indent(uuid, jsonb, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_store_indent(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_store_indent(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_store_indent(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_store_indent(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_store_indents_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_store_indents_seen(uuid) TO authenticated;

COMMIT;
