-- ============================================================================
-- Correcting a saved purchase, and re-pricing stock already on the shelf.
--
-- A purchase invoice is read by the AI parser and reviewed before it is saved,
-- but a wrong rate, GST% or quantity that slips through used to be permanent:
-- pharmacy_inward_items was insert-only, so the purchase register and the ITC
-- in it stayed wrong for ever.
--
-- A mis-parse is a DATA ENTRY error, not a commercial event. The supplier's
-- invoice has not changed, no goods are moving, and nothing is owed back — so
-- it is corrected in place to match the document the supplier actually sent,
-- not papered over with a debit note (that would claim a return that never
-- happened and break the GSTR-2B match). Every correction is kept in
-- pharmacy_inward_corrections with the before/after of the line, so the edit
-- is auditable rather than silent.
--
-- Tax stays computed in the app (src/utils/gst.ts) and stored per line, as it
-- is everywhere else; correct_inward_item() takes the recomputed amounts and
-- is responsible only for what SQL has to own atomically: moving stock by the
-- quantity delta, keeping the batch and the receipt header in step, and
-- refusing a correction that would drive stock negative.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_inward_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  receipt_id uuid REFERENCES public.pharmacy_inward_receipts(id) ON DELETE CASCADE,
  -- Kept as a plain uuid, not a FK: a deleted line's audit row must survive it.
  item_id uuid NOT NULL,
  medicine_id uuid REFERENCES public.medicines_master(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('correct', 'delete')),
  reason text,
  before_row jsonb NOT NULL,
  after_row jsonb,
  corrected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inward_corrections_receipt
  ON public.pharmacy_inward_corrections (receipt_id, corrected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inward_corrections_clinic
  ON public.pharmacy_inward_corrections (clinic_id, corrected_at DESC);

ALTER TABLE public.pharmacy_inward_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_inward_corrections;
DROP POLICY IF EXISTS tenant_write ON public.pharmacy_inward_corrections;
CREATE POLICY tenant_select ON public.pharmacy_inward_corrections FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY tenant_write ON public.pharmacy_inward_corrections FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

COMMENT ON TABLE public.pharmacy_inward_corrections IS
  'Before/after of every purchase-line correction or removal, so a GST-relevant edit is never silent.';

-- ---------------------------------------------------------------------------
-- 2. Receipt header follows its lines
--
-- The header carries the totals the inward register and the ITC figure read,
-- so after any line change it is re-summed from the lines rather than patched.
-- round_off is preserved: it is the supplier's rounding, not ours to recompute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resync_inward_receipt_totals(p_receipt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record;
  v_round numeric;
BEGIN
  SELECT COALESCE(SUM(taxable_amount), 0) AS taxable,
         COALESCE(SUM(cgst_amount), 0)    AS cgst,
         COALESCE(SUM(sgst_amount), 0)    AS sgst,
         COALESCE(SUM(igst_amount), 0)    AS igst,
         COALESCE(SUM(line_total), 0)     AS line_total,
         -- Rates are GST-exclusive, so what was knocked off the gross is the
         -- distance from quantity x rate down to the stored taxable.
         COALESCE(SUM(GREATEST(0, quantity * unit_cost_price - taxable_amount)), 0) AS discount
    INTO t
    FROM public.pharmacy_inward_items
   WHERE receipt_id = p_receipt_id;

  SELECT COALESCE(round_off, 0) INTO v_round
    FROM public.pharmacy_inward_receipts WHERE id = p_receipt_id;

  UPDATE public.pharmacy_inward_receipts
     SET taxable_amount = ROUND(t.taxable, 2),
         discount_amount = ROUND(t.discount, 2),
         cgst_amount    = ROUND(t.cgst, 2),
         sgst_amount    = ROUND(t.sgst, 2),
         igst_amount    = ROUND(t.igst, 2),
         grand_total    = ROUND(t.line_total + COALESCE(v_round, 0), 2),
         total_amount   = ROUND(t.line_total + COALESCE(v_round, 0), 2)
   WHERE id = p_receipt_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resync_inward_receipt_totals(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Correct a saved purchase line
--
-- p_patch carries only the keys being changed. Quantities are what move stock;
-- the money columns are passed in already computed by src/utils/gst.ts:
--   quantity, free_quantity, pack_size, unit_cost_price, mrp, discount_percent,
--   discount_amount, gst_rate, hsn_code, expiry_date,
--   taxable_amount, cgst_amount, sgst_amount, igst_amount, line_total
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_inward_item(
  p_item_id uuid,
  p_patch jsonb,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.pharmacy_inward_items;
  v_new public.pharmacy_inward_items;
  v_clinic uuid;
  v_old_units numeric;
  v_new_units numeric;
  v_delta numeric;
  v_stock numeric;
  v_batch_qty numeric;
  v_name text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Nothing to correct';
  END IF;

  SELECT * INTO v_old FROM public.pharmacy_inward_items WHERE id = p_item_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Purchase line not found';
  END IF;

  v_clinic := COALESCE(
    v_old.clinic_id,
    (SELECT clinic_id FROM public.pharmacy_inward_receipts WHERE id = v_old.receipt_id),
    (SELECT clinic_id FROM public.medicines_master WHERE id = v_old.medicine_id));
  IF v_clinic IS NULL OR v_clinic NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;

  -- Received units are the paid quantity plus whatever came free.
  v_old_units := v_old.quantity + COALESCE(v_old.free_quantity, 0);
  v_new_units := COALESCE((p_patch ->> 'quantity')::numeric, v_old.quantity)
               + COALESCE((p_patch ->> 'free_quantity')::numeric, COALESCE(v_old.free_quantity, 0));
  IF COALESCE((p_patch ->> 'quantity')::numeric, v_old.quantity) <= 0 THEN
    RAISE EXCEPTION 'Corrected quantity must be more than zero — remove the line instead';
  END IF;
  v_delta := v_new_units - v_old_units;

  -- Stock first: a correction that would make the pool or the batch negative is
  -- refused outright, because the difference has already been sold.
  SELECT name, current_stock INTO v_name, v_stock
    FROM public.medicines_master WHERE id = v_old.medicine_id FOR UPDATE;
  IF v_delta <> 0 THEN
    IF v_stock IS NULL THEN
      RAISE EXCEPTION 'Medicine not found in the master';
    END IF;
    IF v_stock + v_delta < 0 THEN
      RAISE EXCEPTION
        'Cannot reduce % to % units: only % in stock, the rest has already been issued',
        v_name, trim_scale(v_new_units), trim_scale(v_stock);
    END IF;

    IF v_old.batch_id IS NOT NULL THEN
      SELECT quantity INTO v_batch_qty FROM public.medicine_batches
       WHERE id = v_old.batch_id FOR UPDATE;
      IF COALESCE(v_batch_qty, 0) + v_delta < 0 THEN
        RAISE EXCEPTION
          'Cannot reduce batch % to % units: only % left in it',
          v_old.batch_number, trim_scale(v_new_units), trim_scale(COALESCE(v_batch_qty, 0));
      END IF;
      UPDATE public.medicine_batches
         SET quantity = quantity + v_delta, updated_at = now()
       WHERE id = v_old.batch_id;
    END IF;

    UPDATE public.medicines_master
       SET current_stock = v_stock + v_delta
     WHERE id = v_old.medicine_id;

    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
       reference_id, reference_type, moved_by, movement_date, remarks)
    VALUES
      (v_clinic, v_old.medicine_id, 'adjustment', v_delta, v_stock + v_delta,
       v_old.receipt_id, 'inward_correction', auth.uid(), now(),
       CONCAT('Purchase line corrected from ', trim_scale(v_old_units), ' to ', trim_scale(v_new_units),
              ' units', CASE WHEN p_reason IS NOT NULL THEN ': ' || p_reason ELSE '' END));
  END IF;

  UPDATE public.pharmacy_inward_items SET
    quantity         = COALESCE((p_patch ->> 'quantity')::numeric, quantity),
    free_quantity    = COALESCE((p_patch ->> 'free_quantity')::integer, free_quantity),
    pack_size        = COALESCE((p_patch ->> 'pack_size')::numeric, pack_size),
    unit_cost_price  = COALESCE((p_patch ->> 'unit_cost_price')::numeric, unit_cost_price),
    mrp              = COALESCE((p_patch ->> 'mrp')::numeric, mrp),
    discount_percent = COALESCE((p_patch ->> 'discount_percent')::numeric, discount_percent),
    discount_amount  = COALESCE((p_patch ->> 'discount_amount')::numeric, discount_amount),
    gst_rate         = COALESCE((p_patch ->> 'gst_rate')::numeric, gst_rate),
    hsn_code         = COALESCE(NULLIF(p_patch ->> 'hsn_code', ''), hsn_code),
    expiry_date      = COALESCE((p_patch ->> 'expiry_date')::date, expiry_date),
    taxable_amount   = COALESCE((p_patch ->> 'taxable_amount')::numeric, taxable_amount),
    cgst_amount      = COALESCE((p_patch ->> 'cgst_amount')::numeric, cgst_amount),
    sgst_amount      = COALESCE((p_patch ->> 'sgst_amount')::numeric, sgst_amount),
    igst_amount      = COALESCE((p_patch ->> 'igst_amount')::numeric, igst_amount),
    line_total       = COALESCE((p_patch ->> 'line_total')::numeric, line_total)
  WHERE id = p_item_id
  RETURNING * INTO v_new;

  -- The batch carries the money that later sales and valuation read, so a
  -- corrected rate or MRP has to reach it too, or the margin on everything
  -- sold from this batch stays wrong.
  IF v_new.batch_id IS NOT NULL THEN
    UPDATE public.medicine_batches
       SET mrp           = COALESCE(v_new.mrp, mrp),
           purchase_rate = COALESCE(v_new.unit_cost_price, purchase_rate),
           expiry_date   = COALESCE(v_new.expiry_date, expiry_date),
           updated_at    = now()
     WHERE id = v_new.batch_id;
  END IF;

  -- The master's HSN and GST rate were set from this line when it was saved
  -- (trg_inward_item_sync_master_tax), so a wrong parse corrupted them. The
  -- correction has to undo that, which is the whole point of correcting it.
  -- Pack size mirrors the insert trigger: it only fills a master still at the
  -- default 1 — the line's value may just be carried over, and clobbering a
  -- pack size the pharmacist configured would be a new corruption.
  UPDATE public.medicines_master
     SET hsn_code = COALESCE(NULLIF(btrim(v_new.hsn_code), ''), hsn_code),
         gst_rate = CASE WHEN v_new.gst_rate IS NOT NULL AND v_new.gst_rate >= 0 AND v_new.gst_rate <= 28
                         THEN v_new.gst_rate ELSE gst_rate END,
         pack_size = CASE WHEN v_new.pack_size IS NOT NULL AND v_new.pack_size > 0 AND pack_size = 1
                          THEN v_new.pack_size ELSE pack_size END
   WHERE id = v_new.medicine_id;

  PERFORM public.resync_inward_receipt_totals(v_new.receipt_id);

  INSERT INTO public.pharmacy_inward_corrections
    (clinic_id, receipt_id, item_id, medicine_id, action, reason,
     before_row, after_row, corrected_by)
  VALUES
    (v_clinic, v_old.receipt_id, p_item_id, v_old.medicine_id, 'correct', p_reason,
     to_jsonb(v_old), to_jsonb(v_new), auth.uid());

  RETURN to_jsonb(v_new);
END;
$$;
GRANT EXECUTE ON FUNCTION public.correct_inward_item(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Remove a purchase line the parser invented
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_inward_item(
  p_item_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.pharmacy_inward_items;
  v_clinic uuid;
  v_units numeric;
  v_stock numeric;
  v_batch_qty numeric;
  v_name text;
BEGIN
  SELECT * INTO v_old FROM public.pharmacy_inward_items WHERE id = p_item_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Purchase line not found';
  END IF;

  v_clinic := COALESCE(
    v_old.clinic_id,
    (SELECT clinic_id FROM public.pharmacy_inward_receipts WHERE id = v_old.receipt_id),
    (SELECT clinic_id FROM public.medicines_master WHERE id = v_old.medicine_id));
  IF v_clinic IS NULL OR v_clinic NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;

  v_units := v_old.quantity + COALESCE(v_old.free_quantity, 0);

  SELECT name, current_stock INTO v_name, v_stock
    FROM public.medicines_master WHERE id = v_old.medicine_id FOR UPDATE;
  IF v_stock IS NOT NULL THEN
    IF v_stock - v_units < 0 THEN
      RAISE EXCEPTION
        'Cannot remove this line: it brought in % units of % but only % are left',
        trim_scale(v_units), v_name, trim_scale(v_stock);
    END IF;

    IF v_old.batch_id IS NOT NULL THEN
      SELECT quantity INTO v_batch_qty FROM public.medicine_batches
       WHERE id = v_old.batch_id FOR UPDATE;
      IF COALESCE(v_batch_qty, 0) - v_units < 0 THEN
        RAISE EXCEPTION
          'Cannot remove this line: batch % only has % of the % units it brought in',
          v_old.batch_number, trim_scale(COALESCE(v_batch_qty, 0)), trim_scale(v_units);
      END IF;
      UPDATE public.medicine_batches
         SET quantity = quantity - v_units, updated_at = now()
       WHERE id = v_old.batch_id;
    END IF;

    UPDATE public.medicines_master SET current_stock = v_stock - v_units
     WHERE id = v_old.medicine_id;

    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
       reference_id, reference_type, moved_by, movement_date, remarks)
    VALUES
      (v_clinic, v_old.medicine_id, 'adjustment', -v_units, v_stock - v_units,
       v_old.receipt_id, 'inward_correction', auth.uid(), now(),
       CONCAT('Purchase line removed', CASE WHEN p_reason IS NOT NULL THEN ': ' || p_reason ELSE '' END));
  END IF;

  INSERT INTO public.pharmacy_inward_corrections
    (clinic_id, receipt_id, item_id, medicine_id, action, reason,
     before_row, after_row, corrected_by)
  VALUES
    (v_clinic, v_old.receipt_id, p_item_id, v_old.medicine_id, 'delete', p_reason,
     to_jsonb(v_old), NULL, auth.uid());

  DELETE FROM public.pharmacy_inward_items WHERE id = p_item_id;

  PERFORM public.resync_inward_receipt_totals(v_old.receipt_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_inward_item(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Re-price stock already on the shelf
--
-- MRP and expiry reach a batch only from the purchase that created it, so a
-- mis-parsed MRP could not be corrected at all: the counter reads MRP from the
-- batch, not from the clinic price list, so editing the master changed nothing
-- for stock in hand.
--
-- The purchase rate is deliberately NOT editable here. It is the cost side of
-- a GST document and of the margin on everything already sold from the batch,
-- so it is only ever changed by correcting the purchase line it came from,
-- where the change is audited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_batch_pricing(
  p_batch_id uuid,
  p_mrp numeric DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_clear_expiry boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.medicine_batches;
BEGIN
  SELECT * INTO v_batch FROM public.medicine_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_batch.clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;
  IF p_mrp IS NOT NULL AND p_mrp < 0 THEN
    RAISE EXCEPTION 'MRP cannot be negative';
  END IF;

  UPDATE public.medicine_batches
     SET mrp = COALESCE(p_mrp, mrp),
         expiry_date = CASE WHEN p_clear_expiry THEN NULL ELSE COALESCE(p_expiry_date, expiry_date) END,
         updated_at = now()
   WHERE id = p_batch_id
  RETURNING * INTO v_batch;

  RETURN to_jsonb(v_batch);
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_batch_pricing(uuid, numeric, date, boolean) TO authenticated;

COMMIT;
