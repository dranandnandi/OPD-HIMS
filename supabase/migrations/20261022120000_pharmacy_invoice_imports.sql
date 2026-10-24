-- Draft extraction is separate from inward items: drafts must never move stock.
BEGIN;
CREATE TABLE public.pharmacy_invoice_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  target_receipt_id uuid REFERENCES public.pharmacy_inward_receipts(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  revision integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{"pages":[]}'::jsonb,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pharmacy_invoice_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_read ON public.pharmacy_invoice_imports FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY import_create ON public.pharmacy_invoice_imports FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()) AND created_by = auth.uid() AND status = 'draft'
    AND (target_receipt_id IS NULL OR EXISTS (SELECT 1 FROM public.pharmacy_inward_receipts r WHERE r.id = target_receipt_id AND r.clinic_id = pharmacy_invoice_imports.clinic_id)));
CREATE POLICY import_edit ON public.pharmacy_invoice_imports FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()) AND status = 'draft')
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()) AND status = 'draft'
    AND (target_receipt_id IS NULL OR EXISTS (SELECT 1 FROM public.pharmacy_inward_receipts r WHERE r.id = target_receipt_id AND r.clinic_id = pharmacy_invoice_imports.clinic_id)));
GRANT SELECT, INSERT, UPDATE ON public.pharmacy_invoice_imports TO authenticated;
CREATE INDEX ON public.pharmacy_invoice_imports (clinic_id, status, updated_at DESC);

ALTER TABLE public.pharmacy_inward_items ADD COLUMN import_source_key text, ADD COLUMN import_source jsonb;
CREATE UNIQUE INDEX inward_import_source_once ON public.pharmacy_inward_items (receipt_id, import_source_key) WHERE import_source_key IS NOT NULL;
-- A supplier bill number is not globally unique across clinics/suppliers/years.
ALTER TABLE public.pharmacy_inward_receipts DROP CONSTRAINT IF EXISTS pharmacy_inward_receipts_invoice_number_key;
CREATE UNIQUE INDEX inward_supplier_bill_year ON public.pharmacy_inward_receipts
 (clinic_id, supplier_id, lower(btrim(invoice_number)),
 ((extract(year from supplier_invoice_date)::integer - CASE WHEN extract(month from supplier_invoice_date) < 4 THEN 1 ELSE 0 END)))
 WHERE supplier_id IS NOT NULL AND invoice_number IS NOT NULL AND supplier_invoice_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_pharmacy_invoice_import(p_import_id uuid, p_revision integer, p_header jsonb, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.pharmacy_invoice_imports%ROWTYPE;
  r public.pharmacy_inward_receipts%ROWTYPE;
  v_id uuid; v_supplier uuid; v_date date; v_number text; v_item jsonb;
  v_qty integer; v_free integer; v_rate numeric; v_gst numeric; v_disc numeric; v_flat numeric;
  v_taxable numeric; v_tax numeric; v_cgst numeric; v_sgst numeric; v_igst numeric;
  v_interstate boolean; v_fy integer;
BEGIN
  SELECT * INTO d FROM public.pharmacy_invoice_imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR d.clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN RAISE EXCEPTION 'Import not found or access denied'; END IF;
  -- A retry after a lost HTTP response cannot post the same stock twice.
  IF d.status = 'posted' THEN RETURN d.target_receipt_id; END IF;
  IF d.revision <> p_revision THEN RAISE EXCEPTION 'Draft changed in another session. Reload before posting.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d.payload->'pages') p WHERE p->>'status' IS DISTINCT FROM 'complete') THEN RAISE EXCEPTION 'Finish all pages before posting'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'No reviewed items'; END IF;
  v_supplier := (p_header->>'supplierId')::uuid;
  v_number := btrim(p_header->>'invoiceNumber');
  v_date := (p_header->>'invoiceDate')::date;
  v_interstate := COALESCE((p_header->>'isInterstate')::boolean, false);
  IF v_supplier IS NULL OR v_number IS NULL OR v_number = '' OR v_date IS NULL THEN RAISE EXCEPTION 'Supplier, invoice number and date are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = v_supplier AND clinic_id = d.clinic_id) THEN RAISE EXCEPTION 'Supplier access denied'; END IF;
  v_fy := extract(year from v_date)::integer - CASE WHEN extract(month from v_date) < 4 THEN 1 ELSE 0 END;
  PERFORM pg_advisory_xact_lock(hashtextextended(d.clinic_id::text || v_supplier::text || lower(v_number) || v_fy::text, 0));
  IF d.target_receipt_id IS NOT NULL THEN
    SELECT * INTO r FROM public.pharmacy_inward_receipts WHERE id = d.target_receipt_id FOR UPDATE;
    IF NOT FOUND OR r.clinic_id <> d.clinic_id OR r.supplier_id IS DISTINCT FROM v_supplier
      OR lower(btrim(r.invoice_number)) IS DISTINCT FROM lower(v_number)
      OR r.supplier_invoice_date IS DISTINCT FROM v_date THEN RAISE EXCEPTION 'Continuation must match the existing supplier, bill number and date'; END IF;
    IF r.is_interstate IS DISTINCT FROM v_interstate THEN RAISE EXCEPTION 'Tax mode differs from the existing bill'; END IF;
    v_id := r.id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.pharmacy_inward_receipts WHERE clinic_id = d.clinic_id AND supplier_id = v_supplier AND lower(btrim(invoice_number)) = lower(v_number)
      AND extract(year from supplier_invoice_date)::integer - CASE WHEN extract(month from supplier_invoice_date) < 4 THEN 1 ELSE 0 END = v_fy)
      THEN RAISE EXCEPTION 'This bill already exists. Choose Continue existing bill.'; END IF;
    INSERT INTO public.pharmacy_inward_receipts (clinic_id, supplier_id, invoice_number, supplier_invoice_date, receipt_date, uploaded_by, status, remarks, is_interstate, round_off)
    VALUES (d.clinic_id, v_supplier, v_number, v_date, now(), auth.uid(), 'completed', p_header->>'remarks', v_interstate, COALESCE((p_header->>'roundOff')::numeric, 0)) RETURNING id INTO v_id;
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.medicines_master WHERE id = (v_item->>'medicineId')::uuid AND clinic_id = d.clinic_id) THEN RAISE EXCEPTION 'Medicine access denied'; END IF;
    IF COALESCE(v_item->>'sourceKey','') = '' THEN RAISE EXCEPTION 'Missing item source'; END IF;
    IF EXISTS (SELECT 1 FROM public.pharmacy_inward_items WHERE receipt_id = v_id AND import_source_key = v_item->>'sourceKey') THEN RAISE EXCEPTION 'This page/row has already been posted to this bill'; END IF;
    IF (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric) OR (v_item->>'freeQuantity')::numeric <> trunc((v_item->>'freeQuantity')::numeric) THEN RAISE EXCEPTION 'Purchase quantities must be whole packs'; END IF;
    v_qty := (v_item->>'quantity')::integer; v_free := COALESCE((v_item->>'freeQuantity')::integer, 0);
    v_rate := (v_item->>'unitCostPrice')::numeric; v_gst := (v_item->>'gstRate')::numeric;
    v_disc := COALESCE((v_item->>'discountPercent')::numeric, 0); v_flat := COALESCE((v_item->>'discountAmount')::numeric, 0);
    IF v_qty IS NULL OR v_qty <= 0 OR v_free < 0 OR v_rate IS NULL OR v_rate < 0 OR v_gst IS NULL OR v_gst < 0 OR v_gst > 100 OR v_disc < 0 OR v_disc > 100 OR v_flat < 0 THEN RAISE EXCEPTION 'Invalid or unresolved pricing/quantity'; END IF;
    v_taxable := round(v_qty * v_rate, 2) - least(round(v_qty * v_rate, 2), round(v_qty * v_rate * v_disc / 100 + v_flat, 2));
    v_tax := round(v_taxable * v_gst / 100, 2);
    v_cgst := CASE WHEN v_interstate THEN 0 ELSE round(v_tax / 2, 2) END;
    v_sgst := CASE WHEN v_interstate THEN 0 ELSE v_tax - v_cgst END;
    v_igst := CASE WHEN v_interstate THEN v_tax ELSE 0 END;
    INSERT INTO public.pharmacy_inward_items (receipt_id, clinic_id, medicine_id, quantity, free_quantity, pack_size, unit_cost_price, batch_number, expiry_date, hsn_code, gst_rate, mrp, discount_percent, discount_amount, taxable_amount, cgst_amount, sgst_amount, igst_amount, line_total, import_source_key, import_source)
    VALUES (v_id, d.clinic_id, (v_item->>'medicineId')::uuid, v_qty, v_free, (v_item->>'packSize')::numeric, v_rate, nullif(v_item->>'batchNumber',''), nullif(v_item->>'expiryDate','')::date, v_item->>'hsnCode', v_gst, (v_item->>'mrp')::numeric, v_disc, v_flat, v_taxable, v_cgst, v_sgst, v_igst, v_taxable + v_tax, v_item->>'sourceKey', v_item->'source');
  END LOOP;
  UPDATE public.pharmacy_inward_receipts SET round_off = COALESCE((p_header->>'roundOff')::numeric, round_off) WHERE id = v_id;
  PERFORM public.resync_inward_receipt_totals(v_id);
  UPDATE public.pharmacy_invoice_imports SET status = 'posted', target_receipt_id = v_id, updated_at = now(), revision = revision + 1 WHERE id = d.id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.post_pharmacy_invoice_import(uuid, integer, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_pharmacy_invoice_import(uuid, integer, jsonb, jsonb) TO authenticated;
COMMIT;
