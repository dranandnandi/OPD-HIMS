-- ============================================================================
-- Pharmacy MIS report functions.
--
-- Read-only aggregates over data the GST/batch migration (20261012000000)
-- already stores. All are SECURITY DEFINER with an explicit tenant check so
-- they can join across tables without RLS getting in the way, and all take
-- IST calendar dates.
--
-- Plus one write: write_off_batch, for expired / damaged stock.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Sales by medicine: quantity, sales, cost and margin for the period.
-- Cost comes from the batch the line was sold from; falls back to the clinic
-- cost price when the line has no batch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_sales_by_medicine(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  medicine_id uuid, medicine_name text, category text, hsn_code text,
  quantity bigint, invoice_count bigint,
  taxable_amount numeric, tax_amount numeric, sales_amount numeric,
  cost_amount numeric, margin_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH lines AS (
    SELECT bi.medicine_id, bi.item_name, bi.bill_id,
           (bi.quantity - COALESCE(bi.refunded_quantity, 0)) AS net_qty,
           CASE WHEN COALESCE(bi.total_price, 0) > 0
                THEN 1 - LEAST(1, COALESCE(bi.refunded_amount, 0) / bi.total_price) ELSE 1 END AS keep,
           bi.taxable_amount, bi.cgst_amount + bi.sgst_amount + bi.igst_amount AS tax, bi.total_price,
           COALESCE(mb.purchase_rate, cmp.cost_price, 0) AS unit_cost
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
         SUM(l.net_qty)::bigint,
         COUNT(DISTINCT l.bill_id),
         ROUND(SUM(l.taxable_amount * l.keep), 2),
         ROUND(SUM(l.tax * l.keep), 2),
         ROUND(SUM(l.total_price * l.keep), 2),
         ROUND(SUM(l.net_qty * l.unit_cost), 2),
         ROUND(SUM(l.taxable_amount * l.keep) - SUM(l.net_qty * l.unit_cost), 2)
    FROM lines l
    LEFT JOIN public.medicines_master m ON m.id = l.medicine_id
   GROUP BY l.medicine_id, COALESCE(m.name, l.item_name), COALESCE(m.category::text, 'other'), m.hsn_code
   ORDER BY 9 DESC;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_sales_by_medicine(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Daily sales: invoices billed per day and what was actually collected by
-- payment method (refund records count negative).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_daily_sales(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  day date, invoice_count bigint, billed_amount numeric, taxable_amount numeric, tax_amount numeric,
  collected_amount numeric, by_method jsonb
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH billed AS (
    SELECT (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date AS day,
           COUNT(*) AS invoice_count,
           SUM(b.total_amount) AS billed_amount,
           SUM(b.taxable_amount) AS taxable_amount,
           SUM(b.cgst_amount + b.sgst_amount + b.igst_amount) AS tax_amount
      FROM public.bills b
     WHERE b.clinic_id = p_clinic_id
       AND p_clinic_id IN (SELECT public.user_clinic_ids())
       AND b.bill_type = 'pharmacy' AND b.status <> 'cancelled'
       AND (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
     GROUP BY 1
  ),
  collected AS (
    SELECT (pr.payment_date AT TIME ZONE 'Asia/Kolkata')::date AS day,
           COALESCE(pr.payment_method::text, 'cash') AS method,
           SUM(CASE WHEN pr.record_type::text = 'refund' THEN -pr.amount ELSE pr.amount END) AS amount
      FROM public.payment_records pr
      JOIN public.bills b ON b.id = pr.bill_id
     WHERE b.clinic_id = p_clinic_id
       AND p_clinic_id IN (SELECT public.user_clinic_ids())
       AND b.bill_type = 'pharmacy'
       AND (pr.payment_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
     GROUP BY 1, 2
  ),
  collected_day AS (
    SELECT day, SUM(amount) AS collected_amount,
           jsonb_object_agg(method, ROUND(amount, 2)) AS by_method
      FROM collected GROUP BY day
  )
  SELECT COALESCE(bd.day, cd.day),
         COALESCE(bd.invoice_count, 0),
         ROUND(COALESCE(bd.billed_amount, 0), 2),
         ROUND(COALESCE(bd.taxable_amount, 0), 2),
         ROUND(COALESCE(bd.tax_amount, 0), 2),
         ROUND(COALESCE(cd.collected_amount, 0), 2),
         COALESCE(cd.by_method, '{}'::jsonb)
    FROM billed bd
    FULL OUTER JOIN collected_day cd ON cd.day = bd.day
   ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_daily_sales(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Supplier-wise purchases (net of debit notes) for the period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_purchases_by_supplier(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  supplier_id uuid, supplier_name text, supplier_gstin text,
  invoice_count bigint, debit_note_count bigint,
  taxable_amount numeric, tax_amount numeric, total_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH docs AS (
    SELECT r.supplier_id, 'purchase' AS kind,
           r.taxable_amount, r.cgst_amount + r.sgst_amount + r.igst_amount AS tax,
           CASE WHEN r.grand_total > 0 THEN r.grand_total ELSE r.total_amount END AS total
      FROM public.pharmacy_inward_receipts r
     WHERE r.clinic_id = p_clinic_id
       AND p_clinic_id IN (SELECT public.user_clinic_ids())
       AND r.status <> 'failed'
       AND COALESCE(r.supplier_invoice_date, (r.receipt_date AT TIME ZONE 'Asia/Kolkata')::date) BETWEEN p_from AND p_to
    UNION ALL
    SELECT d.supplier_id, 'debit_note',
           -d.taxable_amount, -(d.cgst_amount + d.sgst_amount + d.igst_amount), -d.grand_total
      FROM public.pharmacy_debit_notes d
     WHERE d.clinic_id = p_clinic_id
       AND p_clinic_id IN (SELECT public.user_clinic_ids())
       AND d.note_date BETWEEN p_from AND p_to
  )
  SELECT docs.supplier_id, COALESCE(s.name, 'Unknown supplier'), s.gstin,
         COUNT(*) FILTER (WHERE kind = 'purchase'),
         COUNT(*) FILTER (WHERE kind = 'debit_note'),
         ROUND(SUM(taxable_amount), 2), ROUND(SUM(tax), 2), ROUND(SUM(total), 2)
    FROM docs
    LEFT JOIN public.suppliers s ON s.id = docs.supplier_id
   GROUP BY docs.supplier_id, s.name, s.gstin
   ORDER BY 8 DESC;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_purchases_by_supplier(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- Stock valuation right now: batch stock at purchase rate and MRP, plus any
-- pooled stock (never received with a batch number) at clinic prices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_stock_valuation(p_clinic_id uuid)
RETURNS TABLE (
  medicine_id uuid, medicine_name text, category text, rack_location text,
  batch_quantity bigint, pooled_quantity bigint, total_quantity integer,
  cost_value numeric, mrp_value numeric, earliest_expiry date
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH b AS (
    SELECT medicine_id,
           SUM(quantity) AS batch_qty,
           SUM(quantity * COALESCE(purchase_rate, 0)) AS batch_cost,
           SUM(quantity * COALESCE(mrp, 0)) AS batch_mrp,
           MIN(expiry_date) FILTER (WHERE quantity > 0) AS earliest_expiry
      FROM public.medicine_batches
     WHERE clinic_id = p_clinic_id
     GROUP BY medicine_id
  )
  SELECT m.id, m.name, COALESCE(m.category::text, 'other'), m.rack_location,
         COALESCE(b.batch_qty, 0)::bigint,
         GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0))::bigint,
         m.current_stock,
         ROUND(COALESCE(b.batch_cost, 0)
               + GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0)) * COALESCE(cmp.cost_price, 0), 2),
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
   ORDER BY 8 DESC;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_stock_valuation(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Dead stock: in stock, but not dispensed in the last N days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_dead_stock(p_clinic_id uuid, p_days integer DEFAULT 90)
RETURNS TABLE (
  medicine_id uuid, medicine_name text, category text, rack_location text,
  current_stock integer, cost_value numeric, last_sold_at timestamptz, days_idle integer
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH last_sale AS (
    SELECT medicine_id, MAX(dispense_date) AS last_sold_at
      FROM public.pharmacy_dispensed_items
     WHERE clinic_id = p_clinic_id
     GROUP BY medicine_id
  ),
  cost AS (
    SELECT medicine_id,
           CASE WHEN SUM(quantity) > 0 THEN SUM(quantity * COALESCE(purchase_rate, 0)) / SUM(quantity) END AS avg_cost
      FROM public.medicine_batches WHERE clinic_id = p_clinic_id GROUP BY medicine_id
  )
  SELECT m.id, m.name, COALESCE(m.category::text, 'other'), m.rack_location, m.current_stock,
         ROUND(m.current_stock * COALESCE(c.avg_cost, cmp.cost_price, 0), 2),
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
   ORDER BY 6 DESC;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_dead_stock(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Expired stock: batches past expiry that still hold quantity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_expired_stock(p_clinic_id uuid)
RETURNS TABLE (
  batch_id uuid, medicine_id uuid, medicine_name text, rack_location text,
  batch_number text, expiry_date date, quantity integer,
  purchase_rate numeric, mrp numeric, cost_value numeric, supplier_name text
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT mb.id, m.id, m.name, m.rack_location, mb.batch_number, mb.expiry_date, mb.quantity,
         mb.purchase_rate, mb.mrp, ROUND(mb.quantity * COALESCE(mb.purchase_rate, 0), 2), s.name
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

-- Write off a batch (expired / damaged): zero the batch, reduce the pool,
-- log an adjustment. Tenant-checked via the batch's clinic.
CREATE OR REPLACE FUNCTION public.write_off_batch(p_batch_id uuid, p_reason text DEFAULT 'Expired')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch record;
  v_stock integer;
BEGIN
  SELECT * INTO v_batch FROM public.medicine_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF v_batch.clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;
  IF v_batch.quantity <= 0 THEN RETURN 0; END IF;

  SELECT current_stock INTO v_stock FROM public.medicines_master WHERE id = v_batch.medicine_id FOR UPDATE;
  v_stock := GREATEST(0, COALESCE(v_stock, 0) - v_batch.quantity);

  UPDATE public.medicines_master SET current_stock = v_stock WHERE id = v_batch.medicine_id;
  UPDATE public.medicine_batches SET quantity = 0, updated_at = now() WHERE id = p_batch_id;

  INSERT INTO public.stock_movement_log
    (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
     reference_id, reference_type, moved_by, movement_date, remarks)
  VALUES
    (v_batch.clinic_id, v_batch.medicine_id, 'adjustment', -v_batch.quantity, v_stock,
     p_batch_id, 'batch_write_off', auth.uid(), now(),
     CONCAT('Write-off batch ', v_batch.batch_number, ': ', COALESCE(p_reason, 'Expired')));

  RETURN v_batch.quantity;
END;
$$;
GRANT EXECUTE ON FUNCTION public.write_off_batch(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Pharmacist-wise sales for the period (who dispensed what).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pharmacy_sales_by_user(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  user_id uuid, user_name text, invoice_count bigint, line_count bigint, quantity bigint,
  taxable_amount numeric, tax_amount numeric, sales_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT d.dispensed_by, COALESCE(p.name, 'Unknown'),
         COUNT(DISTINCT d.bill_id), COUNT(*),
         SUM(d.quantity - COALESCE(d.refunded_quantity, 0))::bigint,
         ROUND(SUM(d.taxable_amount), 2),
         ROUND(SUM(d.cgst_amount + d.sgst_amount + d.igst_amount), 2),
         ROUND(SUM(d.taxable_amount + d.cgst_amount + d.sgst_amount + d.igst_amount), 2)
    FROM public.pharmacy_dispensed_items d
    LEFT JOIN public.profiles p ON p.id = d.dispensed_by
   WHERE d.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND (d.dispense_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
   GROUP BY d.dispensed_by, p.name
   ORDER BY 8 DESC;
$$;
GRANT EXECUTE ON FUNCTION public.pharmacy_sales_by_user(uuid, date, date) TO authenticated;

COMMIT;
