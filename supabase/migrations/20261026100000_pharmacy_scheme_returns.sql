BEGIN;

-- Supplier invoice rates stay unchanged. Cost is the net acquisition value
-- spread across ALL received packs, including scheme packs.
ALTER TABLE public.pharmacy_inward_items ADD COLUMN effective_unit_cost numeric
  GENERATED ALWAYS AS (
    (CASE WHEN line_total > 0 OR taxable_amount > 0 OR discount_percent = 100
      THEN taxable_amount ELSE greatest(0, quantity * unit_cost_price
        - discount_amount - quantity * unit_cost_price * discount_percent / 100) END)
    / NULLIF(quantity + free_quantity, 0)) STORED;
ALTER TABLE public.medicine_batches ADD COLUMN effective_cost numeric;
ALTER TABLE public.medicine_batches ADD COLUMN opening_cost_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.medicine_batches ADD COLUMN opening_cost_value numeric NOT NULL DEFAULT 0;
ALTER TABLE public.bill_items ADD COLUMN cost_price_at_sale numeric;
ALTER TABLE public.medicines_master ADD COLUMN effective_pool_cost numeric;
ALTER TABLE public.medicines_master ADD COLUMN opening_pool_quantity numeric NOT NULL DEFAULT 0;
ALTER TABLE public.medicines_master ADD COLUMN opening_pool_value numeric NOT NULL DEFAULT 0;

ALTER TABLE public.pharmacy_debit_notes
  ADD COLUMN credit_type text NOT NULL DEFAULT 'gst_credit'
    CHECK (credit_type IN ('gst_credit', 'commercial_credit', 'stock_only')),
  ADD COLUMN credit_reference text,
  ADD COLUMN credit_date date,
  ADD COLUMN credit_recorded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN credit_recorded_at timestamptz;
ALTER TABLE public.pharmacy_debit_note_items
  ADD COLUMN inward_item_id uuid REFERENCES public.pharmacy_inward_items(id) ON DELETE RESTRICT,
  ADD COLUMN paid_quantity numeric NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0),
  ADD COLUMN free_quantity numeric NOT NULL DEFAULT 0 CHECK (free_quantity >= 0),
  ADD COLUMN credit_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  ADD CONSTRAINT supplier_return_quantity_split CHECK
    (inward_item_id IS NULL OR quantity = paid_quantity + free_quantity);
CREATE UNIQUE INDEX pharmacy_return_source_once ON public.pharmacy_debit_note_items(debit_note_id, inward_item_id);
CREATE INDEX pharmacy_return_source ON public.pharmacy_debit_note_items(inward_item_id);

-- Keep retries idempotent even when the response is lost after committing.
CREATE TABLE public.pharmacy_operation_requests (
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, request_id)
);
ALTER TABLE public.pharmacy_operation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_operation_requests FROM PUBLIC, anon, authenticated;

-- Historical unidentified opening stock keeps its previous cost basis.
UPDATE public.medicine_batches b SET
  opening_cost_quantity = greatest(0, b.quantity - COALESCE((SELECT sum(i.quantity + i.free_quantity)
    FROM public.pharmacy_inward_items i WHERE i.batch_id = b.id), 0)),
  effective_cost = b.purchase_rate;
UPDATE public.medicine_batches SET opening_cost_value = opening_cost_quantity * COALESCE(purchase_rate, 0);
UPDATE public.medicines_master m SET opening_pool_quantity = greatest(0, current_stock
  - COALESCE((SELECT sum(quantity) FROM public.medicine_batches b WHERE b.medicine_id=m.id),0)
  - COALESCE((SELECT sum(quantity+free_quantity) FROM public.pharmacy_inward_items i WHERE i.medicine_id=m.id AND i.batch_id IS NULL),0));
UPDATE public.medicines_master m SET opening_pool_value=opening_pool_quantity * COALESCE(
  (SELECT cost_price FROM public.clinic_medicine_prices p WHERE p.medicine_id=m.id AND p.clinic_id=m.clinic_id),0);

CREATE FUNCTION public.refresh_pharmacy_pool_cost(p_medicine_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_qty numeric; v_value numeric;
BEGIN
  SELECT sum(greatest(0,i.quantity+i.free_quantity-COALESCE(r.qty,0))),
    sum(greatest(0,i.quantity+i.free_quantity-COALESCE(r.qty,0))*i.effective_unit_cost)
    INTO v_qty,v_value FROM public.pharmacy_inward_items i
    LEFT JOIN LATERAL (SELECT sum(quantity) qty FROM public.pharmacy_debit_note_items d WHERE d.inward_item_id=i.id) r ON true
    WHERE i.medicine_id=p_medicine_id AND i.batch_id IS NULL;
  UPDATE public.medicines_master SET effective_pool_cost=COALESCE(
    (COALESCE(v_value,0)+opening_pool_value)/NULLIF(COALESCE(v_qty,0)+opening_pool_quantity,0),effective_pool_cost)
    WHERE id=p_medicine_id;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_pharmacy_pool_cost(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.refresh_pharmacy_batch_cost(p_batch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_qty numeric; v_value numeric;
BEGIN
  IF p_batch_id IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.medicine_batches WHERE id = p_batch_id FOR UPDATE;
  SELECT sum(greatest(0, i.quantity + i.free_quantity - COALESCE(r.qty,0))),
         sum(greatest(0, i.quantity + i.free_quantity - COALESCE(r.qty,0)) * i.effective_unit_cost)
    INTO v_qty, v_value
    FROM public.pharmacy_inward_items i
    LEFT JOIN LATERAL (SELECT sum(d.quantity) qty FROM public.pharmacy_debit_note_items d
      WHERE d.inward_item_id = i.id) r ON true
    WHERE i.batch_id = p_batch_id;
  UPDATE public.medicine_batches SET effective_cost =
    COALESCE((COALESCE(v_value,0) + opening_cost_value)
      / NULLIF(COALESCE(v_qty,0) + opening_cost_quantity,0), effective_cost, purchase_rate,0)
    WHERE id = p_batch_id;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_pharmacy_batch_cost(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.pharmacy_refresh_acquisition_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.refresh_pharmacy_batch_cost(OLD.batch_id);
    IF OLD.batch_id IS NULL THEN PERFORM public.refresh_pharmacy_pool_cost(OLD.medicine_id); END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.refresh_pharmacy_batch_cost(NEW.batch_id);
    IF NEW.batch_id IS NULL THEN PERFORM public.refresh_pharmacy_pool_cost(NEW.medicine_id); END IF;
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER zz_inward_effective_cost AFTER INSERT OR UPDATE OR DELETE ON public.pharmacy_inward_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_refresh_acquisition_cost();
CREATE TRIGGER zz_return_effective_cost AFTER INSERT ON public.pharmacy_debit_note_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_refresh_acquisition_cost();
DO $$ DECLARE b record; BEGIN
  FOR b IN SELECT id FROM public.medicine_batches LOOP PERFORM public.refresh_pharmacy_batch_cost(b.id); END LOOP;
  FOR b IN SELECT id FROM public.medicines_master LOOP PERFORM public.refresh_pharmacy_pool_cost(b.id); END LOOP;
END; $$;

CREATE FUNCTION public.pharmacy_snapshot_sale_cost() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.medicine_id IS NOT NULL THEN
    SELECT COALESCE(b.effective_cost, b.purchase_rate,
      CASE WHEN NEW.batch_id IS NULL THEN m.effective_pool_cost END,p.cost_price,0) INTO NEW.cost_price_at_sale
      FROM public.medicines_master m
      LEFT JOIN public.medicine_batches b ON b.id = NEW.batch_id AND b.medicine_id = m.id AND b.clinic_id = m.clinic_id
      LEFT JOIN public.clinic_medicine_prices p ON p.medicine_id = m.id AND p.clinic_id = m.clinic_id
      WHERE m.id = NEW.medicine_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER pharmacy_sale_cost_snapshot BEFORE INSERT ON public.bill_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_snapshot_sale_cost();

-- Do not let later purchase edits invalidate already-returned quantities or credits.
CREATE FUNCTION public.pharmacy_guard_returned_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pharmacy_debit_note_items WHERE inward_item_id = OLD.id) THEN
    RAISE EXCEPTION 'This purchase line has supplier returns and cannot be edited or deleted.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER pharmacy_guard_returned_purchase BEFORE UPDATE OR DELETE ON public.pharmacy_inward_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_guard_returned_purchase();

CREATE FUNCTION public.save_pharmacy_supplier_return(p_clinic_id uuid, p_request_id uuid, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.pharmacy_inward_receipts%ROWTYPE;
  v_source public.pharmacy_inward_items%ROWTYPE;
  v_note public.pharmacy_debit_notes%ROWTYPE;
  v_previous public.pharmacy_operation_requests%ROWTYPE;
  v_line jsonb; v_id uuid; v_note_id uuid; v_settle boolean;
  v_type text := p_payload->>'creditType';
  v_paid numeric; v_free numeric; v_credit numeric; v_taxable numeric;
  v_cgst numeric; v_sgst numeric; v_igst numeric; v_base numeric;
  v_used_paid numeric; v_used_free numeric; v_used_credit numeric;
  v_used_cgst numeric; v_used_sgst numeric; v_used_igst numeric;
  v_stock numeric; v_batch_stock numeric; v_credit_date date;
BEGIN
  IF auth.uid() IS NULL OR p_clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not authorised for this clinic';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clinic_id::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM public.pharmacy_operation_requests
    WHERE clinic_id = p_clinic_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.payload <> p_payload THEN RAISE EXCEPTION 'Request already used with different details'; END IF;
    RETURN v_previous.result_id;
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('gst_credit','commercial_credit','stock_only') THEN
    RAISE EXCEPTION 'Choose the supplier credit treatment';
  END IF;
  IF NULLIF(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Return reason is required'; END IF;
  IF v_type <> 'stock_only' THEN
    IF NULLIF(btrim(p_payload->>'creditReference'),'') IS NULL THEN RAISE EXCEPTION 'Supplier credit reference is required'; END IF;
    v_credit_date := (p_payload->>'creditDate')::date;
    IF v_credit_date IS NULL OR v_credit_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Valid supplier credit date is required'; END IF;
  END IF;
  SELECT * INTO v_receipt FROM public.pharmacy_inward_receipts
    WHERE id = (p_payload->>'receiptId')::uuid AND clinic_id = p_clinic_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.supplier_id IS DISTINCT FROM (p_payload->>'supplierId')::uuid THEN
    RAISE EXCEPTION 'Select a purchase invoice belonging to this supplier and clinic';
  END IF;
  IF v_credit_date < COALESCE(v_receipt.supplier_invoice_date,(v_receipt.receipt_date AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RAISE EXCEPTION 'Supplier credit date cannot precede the purchase invoice';
  END IF;
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Add at least one purchase line';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT x->>'inwardItemId') FROM jsonb_array_elements(p_payload->'items') x) THEN
    RAISE EXCEPTION 'A purchase line may appear only once';
  END IF;
  v_note_id := NULLIF(p_payload->>'noteId','')::uuid;
  v_settle := v_note_id IS NOT NULL;
  IF v_settle THEN
    SELECT * INTO v_note FROM public.pharmacy_debit_notes WHERE id = v_note_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND OR v_note.credit_type <> 'stock_only' OR v_type = 'stock_only'
      OR v_note.against_receipt_id IS DISTINCT FROM v_receipt.id
      OR v_note.supplier_id IS DISTINCT FROM v_receipt.supplier_id THEN
      RAISE EXCEPTION 'Only a pending supplier credit on this purchase can be settled';
    END IF;
    IF (SELECT count(*) FROM public.pharmacy_debit_note_items WHERE debit_note_id = v_note_id)
      <> jsonb_array_length(p_payload->'items') THEN RAISE EXCEPTION 'Return quantities cannot be changed when recording credit'; END IF;
  ELSE
    INSERT INTO public.pharmacy_debit_notes
      (clinic_id,supplier_id,debit_note_number,against_receipt_id,reason,is_interstate,created_by,credit_type,note_date)
    VALUES (p_clinic_id,v_receipt.supplier_id,public.next_debit_note_number(p_clinic_id),v_receipt.id,
      btrim(p_payload->>'reason'),v_receipt.is_interstate,auth.uid(),v_type,(now() AT TIME ZONE 'Asia/Kolkata')::date) RETURNING id INTO v_note_id;
  END IF;
  -- Stable lock order, also shared by concurrent returns on the same invoice.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'inwardItemId' LOOP
    SELECT * INTO v_source FROM public.pharmacy_inward_items
      WHERE id = (v_line->>'inwardItemId')::uuid AND receipt_id = v_receipt.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Return line is not on the selected purchase invoice'; END IF;
    IF EXISTS (SELECT 1 FROM public.pharmacy_debit_note_items d JOIN public.pharmacy_debit_notes h ON h.id = d.debit_note_id
      WHERE d.inward_item_id IS NULL AND h.clinic_id = p_clinic_id AND h.supplier_id = v_receipt.supplier_id
        AND d.medicine_id = v_source.medicine_id AND d.batch_id IS NOT DISTINCT FROM v_source.batch_id) THEN
      RAISE EXCEPTION 'An older unallocated return exists for this medicine/batch. Reconcile it before creating another return.';
    END IF;
    v_paid := (v_line->>'paidQuantity')::numeric; v_free := (v_line->>'freeQuantity')::numeric;
    v_credit := round((v_line->>'creditAmount')::numeric,2);
    IF v_paid IS NULL OR v_free IS NULL OR v_credit IS NULL OR v_paid < 0 OR v_free < 0 OR v_paid + v_free <= 0
      OR v_paid <> trunc(v_paid) OR v_free <> trunc(v_free) OR v_credit < 0
      OR v_paid::text IN ('NaN','Infinity') OR v_free::text IN ('NaN','Infinity') OR v_credit::text IN ('NaN','Infinity') THEN
      RAISE EXCEPTION 'Return whole packs with non-negative paid/free quantities and credit';
    END IF;
    SELECT COALESCE(sum(paid_quantity),0),COALESCE(sum(free_quantity),0),COALESCE(sum(credit_amount),0),
      COALESCE(sum(cgst_amount),0),COALESCE(sum(sgst_amount),0),COALESCE(sum(igst_amount),0)
      INTO v_used_paid,v_used_free,v_used_credit,v_used_cgst,v_used_sgst,v_used_igst
      FROM public.pharmacy_debit_note_items WHERE inward_item_id = v_source.id AND debit_note_id <> v_note_id;
    IF v_paid + v_used_paid > v_source.quantity OR v_free + v_used_free > v_source.free_quantity THEN
      RAISE EXCEPTION 'Paid or free return exceeds the remaining purchased quantity';
    END IF;
    v_base := round(v_source.effective_unit_cost * (v_source.quantity + v_source.free_quantity),2);
    -- Commercial credits may include the original tax in their agreed amount,
    -- without reversing GST. Reserve their proportional share of purchase value.
    SELECT COALESCE(sum(CASE WHEN h.credit_type='commercial_credit' THEN
        d.credit_amount * v_base / NULLIF(v_base+v_source.cgst_amount+v_source.sgst_amount+v_source.igst_amount,0)
      ELSE d.credit_amount END),0) INTO v_used_credit
      FROM public.pharmacy_debit_note_items d JOIN public.pharmacy_debit_notes h ON h.id=d.debit_note_id
      WHERE d.inward_item_id=v_source.id AND d.debit_note_id<>v_note_id;
    IF (v_type='commercial_credit' AND v_credit > round((v_base-v_used_credit)
          * (v_base+v_source.cgst_amount+v_source.sgst_amount+v_source.igst_amount)/NULLIF(v_base,0),2))
      OR (v_type<>'commercial_credit' AND v_credit > round(v_base-v_used_credit,2))
      OR (v_base=0 AND v_credit>0) THEN RAISE EXCEPTION 'Credit exceeds the remaining net purchase value'; END IF;
    IF v_type = 'stock_only' AND v_credit <> 0 THEN RAISE EXCEPTION 'Pending credit returns must have zero credit'; END IF;
    v_taxable := CASE WHEN v_type = 'gst_credit' THEN v_credit ELSE 0 END;
    -- Use original invoice tax amounts, never today's medicine tax rate.
    -- Cumulative rounding makes the final partial return reconcile to the paise.
    SELECT COALESCE(sum(taxable_amount),0) INTO v_stock FROM public.pharmacy_debit_note_items
      WHERE inward_item_id = v_source.id AND debit_note_id <> v_note_id;
    v_cgst := CASE WHEN v_base > 0 AND v_type = 'gst_credit' THEN greatest(0,round((v_stock+v_credit)*v_source.cgst_amount/v_base,2)-v_used_cgst) ELSE 0 END;
    v_sgst := CASE WHEN v_base > 0 AND v_type = 'gst_credit' THEN greatest(0,round((v_stock+v_credit)*v_source.sgst_amount/v_base,2)-v_used_sgst) ELSE 0 END;
    v_igst := CASE WHEN v_base > 0 AND v_type = 'gst_credit' THEN greatest(0,round((v_stock+v_credit)*v_source.igst_amount/v_base,2)-v_used_igst) ELSE 0 END;
    IF v_settle THEN
      UPDATE public.pharmacy_debit_note_items SET credit_amount=v_credit,taxable_amount=v_taxable,
        cgst_amount=v_cgst,sgst_amount=v_sgst,igst_amount=v_igst,line_total=v_credit+v_cgst+v_sgst+v_igst
        WHERE debit_note_id=v_note_id AND inward_item_id=v_source.id AND paid_quantity=v_paid AND free_quantity=v_free;
      IF NOT FOUND THEN RAISE EXCEPTION 'Return quantities cannot be changed when recording credit'; END IF;
    ELSE
      SELECT current_stock INTO v_stock FROM public.medicines_master
        WHERE id=v_source.medicine_id AND clinic_id=p_clinic_id FOR UPDATE;
      IF NOT FOUND OR v_stock < v_paid+v_free THEN RAISE EXCEPTION 'Insufficient medicine stock to return'; END IF;
      IF v_source.batch_id IS NOT NULL THEN
        SELECT quantity INTO v_batch_stock FROM public.medicine_batches
          WHERE id=v_source.batch_id AND medicine_id=v_source.medicine_id AND clinic_id=p_clinic_id FOR UPDATE;
        IF NOT FOUND OR v_batch_stock < v_paid+v_free THEN RAISE EXCEPTION 'Insufficient stock in the purchase batch'; END IF;
      ELSE
        SELECT v_stock-COALESCE(sum(quantity),0) INTO v_batch_stock FROM public.medicine_batches WHERE medicine_id=v_source.medicine_id;
        IF v_batch_stock < v_paid+v_free THEN RAISE EXCEPTION 'Insufficient unbatched stock to return'; END IF;
      END IF;
      INSERT INTO public.pharmacy_debit_note_items
        (clinic_id,debit_note_id,inward_item_id,medicine_id,batch_id,batch_number,quantity,paid_quantity,free_quantity,
         unit_rate,hsn_code,gst_rate,credit_amount,taxable_amount,cgst_amount,sgst_amount,igst_amount,line_total)
      VALUES (p_clinic_id,v_note_id,v_source.id,v_source.medicine_id,v_source.batch_id,v_source.batch_number,
        v_paid+v_free,v_paid,v_free,COALESCE(v_base/NULLIF(v_source.quantity,0),0),v_source.hsn_code,v_source.gst_rate,
        v_credit,v_taxable,v_cgst,v_sgst,v_igst,v_credit+v_cgst+v_sgst+v_igst);
      -- Existing insert trigger updates stock, batch and movement log exactly once.
    END IF;
  END LOOP;
  UPDATE public.pharmacy_debit_notes SET credit_type=v_type,
    credit_reference=CASE WHEN v_type<>'stock_only' THEN btrim(p_payload->>'creditReference') END,
    credit_date=v_credit_date,credit_recorded_by=CASE WHEN v_type<>'stock_only' THEN auth.uid() END,
    credit_recorded_at=CASE WHEN v_type<>'stock_only' THEN now() END,
    taxable_amount=t.taxable,cgst_amount=t.cgst,sgst_amount=t.sgst,igst_amount=t.igst,
    round_off=0,grand_total=t.total
    FROM (SELECT sum(taxable_amount) taxable,sum(cgst_amount) cgst,sum(sgst_amount) sgst,
      sum(igst_amount) igst,sum(line_total) total FROM public.pharmacy_debit_note_items WHERE debit_note_id=v_note_id) t
    WHERE id=v_note_id;
  INSERT INTO public.pharmacy_operation_requests VALUES (p_clinic_id,p_request_id,p_payload,v_note_id,now());
  RETURN v_note_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_pharmacy_supplier_return(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pharmacy_supplier_return(uuid,uuid,jsonb) TO authenticated;
-- All browser writes go through the atomic, tenant-checked function. Read RLS stays intact.
REVOKE INSERT, UPDATE, DELETE ON public.pharmacy_debit_notes, public.pharmacy_debit_note_items FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.adjust_pharmacy_stock(p_clinic_id uuid,p_request_id uuid,p_medicine_id uuid,
  p_batch_id uuid,p_quantity_change numeric,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stock numeric; v_batch numeric; v_batch_number text; v_id uuid; v_payload jsonb; v_previous public.pharmacy_operation_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN RAISE EXCEPTION 'Not authorised for this clinic'; END IF;
  p_quantity_change := round(p_quantity_change,12);
  IF p_request_id IS NULL OR p_quantity_change IS NULL OR p_quantity_change=0
    OR p_quantity_change::text IN ('NaN','Infinity','-Infinity') OR NULLIF(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Provide a nonzero quantity, reason and request ID'; END IF;
  v_payload := jsonb_build_object('operation','adjust_stock','medicine',p_medicine_id,'batch',p_batch_id,'quantity',p_quantity_change,'reason',p_reason);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_clinic_id::text || p_request_id::text,0));
  SELECT * INTO v_previous FROM public.pharmacy_operation_requests WHERE clinic_id=p_clinic_id AND request_id=p_request_id;
  IF FOUND THEN
    IF v_previous.payload<>v_payload THEN RAISE EXCEPTION 'Request already used with different details'; END IF;
    RETURN v_previous.result_id;
  END IF;
  SELECT current_stock INTO v_stock FROM public.medicines_master WHERE id=p_medicine_id AND clinic_id=p_clinic_id FOR UPDATE;
  IF NOT FOUND OR v_stock+p_quantity_change<0 THEN RAISE EXCEPTION 'Medicine not found or insufficient stock'; END IF;
  IF p_batch_id IS NOT NULL THEN
    SELECT quantity,batch_number INTO v_batch,v_batch_number FROM public.medicine_batches
      WHERE id=p_batch_id AND medicine_id=p_medicine_id AND clinic_id=p_clinic_id FOR UPDATE;
    IF NOT FOUND OR v_batch+p_quantity_change<0 THEN RAISE EXCEPTION 'Invalid batch or insufficient batch stock'; END IF;
    UPDATE public.medicine_batches SET quantity=quantity+p_quantity_change,updated_at=now() WHERE id=p_batch_id;
  ELSE
    SELECT v_stock-COALESCE(sum(quantity),0) INTO v_batch FROM public.medicine_batches WHERE medicine_id=p_medicine_id;
    IF v_batch+p_quantity_change<0 THEN RAISE EXCEPTION 'Select a batch; unbatched stock is insufficient'; END IF;
    IF p_quantity_change>0 AND EXISTS(SELECT 1 FROM public.medicine_batches WHERE medicine_id=p_medicine_id) THEN
      RAISE EXCEPTION 'Select the batch for this stock increase'; END IF;
  END IF;
  UPDATE public.medicines_master SET current_stock=current_stock+p_quantity_change,updated_at=now() WHERE id=p_medicine_id
    RETURNING current_stock INTO v_stock;
  INSERT INTO public.stock_movement_log(clinic_id,medicine_id,movement_type,quantity_change,new_stock_level,
    reference_id,reference_type,moved_by,remarks)
    VALUES(p_clinic_id,p_medicine_id,'adjustment',p_quantity_change,v_stock,p_batch_id,'manual_adjustment',auth.uid(),
      COALESCE('[Batch '||v_batch_number||'] ','[Unbatched] ')||btrim(p_reason)) RETURNING id INTO v_id;
  INSERT INTO public.pharmacy_operation_requests VALUES(p_clinic_id,p_request_id,v_payload,v_id,now());
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.adjust_pharmacy_stock(uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_pharmacy_stock(uuid,uuid,uuid,uuid,numeric,text) TO authenticated;

  CREATE OR REPLACE FUNCTION public.pharmacy_sales_by_medicine(
    p_clinic_id uuid, p_from date, p_to date
  ) RETURNS TABLE (
    medicine_id uuid, medicine_name text, category text, hsn_code text,
    quantity numeric, stock_unit text, pack_size numeric, dispense_unit text, invoice_count bigint,
    taxable_amount numeric, tax_amount numeric, sales_amount numeric,
    cost_amount numeric, margin_amount numeric
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    WITH lines AS (
      SELECT bi.medicine_id, bi.item_name, bi.bill_id,
            GREATEST(0, bi.quantity - COALESCE(bi.refunded_quantity, 0)) AS net_qty,
            CASE WHEN COALESCE(bi.total_price, 0) > 0
                  THEN 1 - LEAST(1, COALESCE(bi.refunded_amount, 0) / bi.total_price) ELSE 1 END AS keep,
            bi.taxable_amount, bi.cgst_amount + bi.sgst_amount + bi.igst_amount AS tax, bi.total_price,
            COALESCE(bi.cost_price_at_sale, mb.purchase_rate, cmp.cost_price, 0) AS unit_cost
        FROM public.bill_items bi
        JOIN public.bills b ON b.id = bi.bill_id
        LEFT JOIN public.medicine_batches mb ON mb.id = bi.batch_id
        LEFT JOIN public.clinic_medicine_prices cmp
              ON cmp.medicine_id = bi.medicine_id AND cmp.clinic_id = b.clinic_id
      WHERE b.clinic_id = p_clinic_id
        AND p_clinic_id IN (SELECT public.user_clinic_ids())
        AND b.bill_type = 'pharmacy'
        AND b.status <> 'cancelled'
        AND (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
    )
    SELECT l.medicine_id,
          COALESCE(m.name, l.item_name),
          COALESCE(m.category::text, 'other'),
          m.hsn_code,
          ROUND(SUM(l.net_qty), 3),
          COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
          COALESCE(m.pack_size, 1),
          COALESCE(NULLIF(m.dispense_unit, ''), 'Unit'),
          COUNT(DISTINCT l.bill_id),
          ROUND(SUM(l.taxable_amount * l.keep), 2),
          ROUND(SUM(l.tax * l.keep), 2),
          ROUND(SUM(l.total_price * l.keep), 2),
          ROUND(SUM(l.net_qty * l.unit_cost), 2),
          ROUND(SUM(l.taxable_amount * l.keep) - SUM(l.net_qty * l.unit_cost), 2)
      FROM lines l
      LEFT JOIN public.medicines_master m ON m.id = l.medicine_id
    GROUP BY l.medicine_id, COALESCE(m.name, l.item_name), COALESCE(m.category::text, 'other'),
              m.hsn_code, COALESCE(NULLIF(m.stock_unit, ''), 'Pack'), COALESCE(m.pack_size, 1),
              COALESCE(NULLIF(m.dispense_unit, ''), 'Unit')
    ORDER BY 12 DESC;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_sales_by_medicine(uuid, date, date) TO authenticated;

  CREATE OR REPLACE FUNCTION public.pharmacy_stock_valuation(p_clinic_id uuid)
  RETURNS TABLE (
    medicine_id uuid, medicine_name text, category text, rack_location text,
    batch_quantity numeric, pooled_quantity numeric, total_quantity numeric,
    pack_size numeric, stock_unit text, dispense_unit text,
    cost_value numeric, mrp_value numeric, earliest_expiry date
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    WITH b AS (
      SELECT medicine_id,
            SUM(quantity) AS batch_qty,
            SUM(quantity * COALESCE(effective_cost, purchase_rate, 0)) AS batch_cost,
            SUM(quantity * COALESCE(mrp, 0)) AS batch_mrp,
            MIN(expiry_date) FILTER (WHERE quantity > 0) AS earliest_expiry
        FROM public.medicine_batches
      WHERE clinic_id = p_clinic_id
      GROUP BY medicine_id
    )
    SELECT m.id, m.name, COALESCE(m.category::text, 'other'), m.rack_location,
          ROUND(COALESCE(b.batch_qty, 0), 3),
          ROUND(GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0)), 3),
          ROUND(m.current_stock, 3),
          m.pack_size,
          COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
          COALESCE(NULLIF(m.dispense_unit, ''), 'Unit'),
          ROUND(COALESCE(b.batch_cost, 0)
                + GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0)) * COALESCE(m.effective_pool_cost, cmp.cost_price, 0), 2),
          ROUND(COALESCE(b.batch_mrp, 0)
                + GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0)) * COALESCE(cmp.selling_price, 0), 2),
          COALESCE(b.earliest_expiry, m.expiry_date)
      FROM public.medicines_master m
      LEFT JOIN b ON b.medicine_id = m.id
      LEFT JOIN public.clinic_medicine_prices cmp ON cmp.medicine_id = m.id AND cmp.clinic_id = m.clinic_id
    WHERE m.clinic_id = p_clinic_id
      AND p_clinic_id IN (SELECT public.user_clinic_ids())
      AND m.is_active = true
      AND m.current_stock > 0
    ORDER BY 11 DESC;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_stock_valuation(uuid) TO authenticated;

  CREATE OR REPLACE FUNCTION public.pharmacy_dead_stock(p_clinic_id uuid, p_days integer DEFAULT 90)
  RETURNS TABLE (
    medicine_id uuid, medicine_name text, category text, rack_location text,
    current_stock numeric, stock_unit text, cost_value numeric,
    last_sold_at timestamptz, days_idle integer
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    WITH last_sale AS (
      SELECT medicine_id, MAX(dispense_date) AS last_sold_at
        FROM public.pharmacy_dispensed_items
      WHERE clinic_id = p_clinic_id
      GROUP BY medicine_id
    ),
    cost AS (
      SELECT medicine_id,
            CASE WHEN SUM(quantity) > 0 THEN SUM(quantity * COALESCE(effective_cost, purchase_rate, 0)) / SUM(quantity) END AS avg_cost
        FROM public.medicine_batches WHERE clinic_id = p_clinic_id GROUP BY medicine_id
    )
    SELECT m.id, m.name, COALESCE(m.category::text, 'other'), m.rack_location,
          ROUND(m.current_stock, 3),
          COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
          ROUND(m.current_stock * COALESCE(c.avg_cost, m.effective_pool_cost, cmp.cost_price, 0), 2),
          ls.last_sold_at,
          COALESCE((now()::date - ls.last_sold_at::date), (now()::date - m.created_at::date))::integer
      FROM public.medicines_master m
      LEFT JOIN last_sale ls ON ls.medicine_id = m.id
      LEFT JOIN cost c ON c.medicine_id = m.id
      LEFT JOIN public.clinic_medicine_prices cmp ON cmp.medicine_id = m.id AND cmp.clinic_id = m.clinic_id
    WHERE m.clinic_id = p_clinic_id
      AND p_clinic_id IN (SELECT public.user_clinic_ids())
      AND m.is_active = true
      AND m.current_stock > 0
      AND (ls.last_sold_at IS NULL OR ls.last_sold_at < now() - make_interval(days => p_days))
    ORDER BY 7 DESC;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_dead_stock(uuid, integer) TO authenticated;

  CREATE OR REPLACE FUNCTION public.pharmacy_expired_stock(p_clinic_id uuid)
  RETURNS TABLE (
    batch_id uuid, medicine_id uuid, medicine_name text, rack_location text,
    batch_number text, expiry_date date, quantity numeric, stock_unit text,
    purchase_rate numeric, mrp numeric, cost_value numeric, supplier_name text
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT mb.id, m.id, m.name, m.rack_location, mb.batch_number, mb.expiry_date,
          ROUND(mb.quantity, 3), COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
          COALESCE(mb.effective_cost, mb.purchase_rate), mb.mrp, ROUND(mb.quantity * COALESCE(mb.effective_cost, mb.purchase_rate, 0), 2), s.name
      FROM public.medicine_batches mb
      JOIN public.medicines_master m ON m.id = mb.medicine_id
      LEFT JOIN public.suppliers s ON s.id = mb.supplier_id
    WHERE mb.clinic_id = p_clinic_id
      AND p_clinic_id IN (SELECT public.user_clinic_ids())
      AND mb.quantity > 0
      AND mb.expiry_date IS NOT NULL
      AND mb.expiry_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY mb.expiry_date;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_expired_stock(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.gst_inward_register(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  kind text, document_id uuid, document_number text, document_date date,
  supplier_name text, supplier_gstin text, is_interstate boolean,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT 'purchase'::text, r.id, r.invoice_number,
         COALESCE(r.supplier_invoice_date, (r.receipt_date AT TIME ZONE 'Asia/Kolkata')::date),
         s.name, s.gstin, r.is_interstate,
         r.taxable_amount, r.cgst_amount, r.sgst_amount, r.igst_amount,
         CASE WHEN r.grand_total > 0 THEN r.grand_total ELSE r.total_amount END
    FROM public.pharmacy_inward_receipts r
    LEFT JOIN public.suppliers s ON s.id = r.supplier_id
   WHERE r.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND r.status <> 'failed'
     AND COALESCE(r.supplier_invoice_date, (r.receipt_date AT TIME ZONE 'Asia/Kolkata')::date) BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'debit_note'::text, d.id, COALESCE(d.credit_reference, d.debit_note_number), COALESCE(d.credit_date, d.note_date),
         s.name, s.gstin, d.is_interstate,
         -d.taxable_amount, -d.cgst_amount, -d.sgst_amount, -d.igst_amount, -d.grand_total
    FROM public.pharmacy_debit_notes d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
   WHERE d.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND d.credit_type = 'gst_credit'
     AND COALESCE(d.credit_date, d.note_date) BETWEEN p_from AND p_to
  ORDER BY 4, 3;
$$;
GRANT EXECUTE ON FUNCTION public.gst_inward_register(uuid, date, date) TO authenticated;


CREATE FUNCTION public.pharmacy_stock_value_total(p_clinic_id uuid) RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path=public STABLE AS $$
 SELECT COALESCE(sum(cost_value),0) FROM public.pharmacy_stock_valuation(p_clinic_id);
$$;
REVOKE ALL ON FUNCTION public.pharmacy_stock_value_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pharmacy_stock_value_total(uuid) TO authenticated;

COMMIT;
