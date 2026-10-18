-- ============================================================================
-- Pharmacy GST, batch-wise stock, purchase register, debit notes,
-- separate pharmacy invoice series, rack location.
--
-- Everything here is additive. Existing OPD billing keeps working: bills get a
-- bill_type that defaults to 'opd', medicines keep current_stock as the pool
-- total, and the old inward/dispense triggers still maintain it. Batches are a
-- layer on top: when an inward item or a dispense carries a batch_id the
-- batch quantity moves too.
--
-- GST model (regular scheme, intra-state by default):
--   * medicines_master.gst_rate / hsn_code are the defaults per SKU
--   * every inward item, dispensed item and bill line stores its own
--     taxable / cgst / sgst / igst amounts — reports only sum stored numbers
--   * selling prices are MRP-inclusive by default
--     (clinic_settings.pharmacy_prices_include_gst); tax is backed out
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Clinic-level GST identity and pharmacy invoice settings
-- ---------------------------------------------------------------------------
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS gst_state_code text,               -- '24' Gujarat, '27' Maharashtra ...
  ADD COLUMN IF NOT EXISTS drug_license_number text,
  ADD COLUMN IF NOT EXISTS pharmacy_gst_scheme text NOT NULL DEFAULT 'regular'
    CHECK (pharmacy_gst_scheme IN ('regular', 'composition')),
  ADD COLUMN IF NOT EXISTS pharmacy_prices_include_gst boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pharmacy_invoice_prefix text NOT NULL DEFAULT 'PH';

-- ---------------------------------------------------------------------------
-- 2. Suppliers: GST identity (needed for the inward register / ITC)
-- ---------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS drug_license_number text;

-- ---------------------------------------------------------------------------
-- 3. Medicine master: rack location, HSN, default GST rate
-- ---------------------------------------------------------------------------
ALTER TABLE public.medicines_master
  ADD COLUMN IF NOT EXISTS rack_location text,
  ADD COLUMN IF NOT EXISTS hsn_code text,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 12
    CHECK (gst_rate >= 0 AND gst_rate <= 100);

COMMENT ON COLUMN public.medicines_master.rack_location IS
  'Free text shelf / rack / sticker label shown to the pharmacist while dispensing.';
COMMENT ON COLUMN public.medicines_master.gst_rate IS
  'Default GST % for this SKU. Most medicines are 12; life-saving drugs 5; some consumables 18.';

-- ---------------------------------------------------------------------------
-- 4. Batch-wise stock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  expiry_date date,
  mrp numeric(12,2),
  purchase_rate numeric(12,2),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medicine_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_medicine_batches_medicine
  ON public.medicine_batches (medicine_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_medicine_batches_clinic
  ON public.medicine_batches (clinic_id);

ALTER TABLE public.medicine_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.medicine_batches;
DROP POLICY IF EXISTS tenant_write ON public.medicine_batches;
CREATE POLICY tenant_select ON public.medicine_batches FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
CREATE POLICY tenant_write ON public.medicine_batches FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_medicine_batches_updated_at ON public.medicine_batches;
CREATE TRIGGER trg_medicine_batches_updated_at
  BEFORE UPDATE ON public.medicine_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Inward receipts and items: GST input
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_inward_receipts
  ADD COLUMN IF NOT EXISTS supplier_invoice_date date,
  ADD COLUMN IF NOT EXISTS is_interstate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.pharmacy_inward_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hsn_code text,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_quantity integer NOT NULL DEFAULT 0 CHECK (free_quantity >= 0),
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total numeric(14,2) NOT NULL DEFAULT 0;

-- Before an inward item lands: find-or-create the batch and point the row at it.
-- Legacy rows without a batch number are left alone (batch_id stays NULL).
CREATE OR REPLACE FUNCTION public.pharmacy_inward_item_attach_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clinic uuid;
  v_supplier uuid;
  v_batch uuid;
BEGIN
  IF NEW.medicine_id IS NULL OR NEW.batch_number IS NULL OR btrim(NEW.batch_number) = '' THEN
    RETURN NEW;
  END IF;

  SELECT r.clinic_id, r.supplier_id INTO v_clinic, v_supplier
    FROM public.pharmacy_inward_receipts r WHERE r.id = NEW.receipt_id;
  v_clinic := COALESCE(NEW.clinic_id, v_clinic,
                       (SELECT clinic_id FROM public.medicines_master WHERE id = NEW.medicine_id));

  INSERT INTO public.medicine_batches
    (clinic_id, medicine_id, batch_number, expiry_date, mrp, purchase_rate, quantity, supplier_id)
  VALUES
    (v_clinic, NEW.medicine_id, btrim(NEW.batch_number), NEW.expiry_date, NEW.mrp,
     NEW.unit_cost_price, NEW.quantity + COALESCE(NEW.free_quantity, 0), v_supplier)
  ON CONFLICT (medicine_id, batch_number) DO UPDATE
    SET quantity      = public.medicine_batches.quantity + EXCLUDED.quantity,
        expiry_date   = COALESCE(EXCLUDED.expiry_date, public.medicine_batches.expiry_date),
        mrp           = COALESCE(EXCLUDED.mrp, public.medicine_batches.mrp),
        purchase_rate = COALESCE(EXCLUDED.purchase_rate, public.medicine_batches.purchase_rate),
        supplier_id   = COALESCE(EXCLUDED.supplier_id, public.medicine_batches.supplier_id),
        updated_at    = now()
  RETURNING id INTO v_batch;

  NEW.batch_id := v_batch;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inward_item_attach_batch ON public.pharmacy_inward_items;
CREATE TRIGGER trg_inward_item_attach_batch
  BEFORE INSERT ON public.pharmacy_inward_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_inward_item_attach_batch();

-- Replace the original stock trigger so free quantity counts, and the legacy
-- single batch/expiry columns on the master mirror the latest receipt.
CREATE OR REPLACE FUNCTION public.update_medicine_stock_on_inward()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_qty integer := NEW.quantity + COALESCE(NEW.free_quantity, 0);
BEGIN
  UPDATE public.medicines_master
     SET current_stock = current_stock + v_qty,
         batch_number  = COALESCE(NEW.batch_number, batch_number),
         expiry_date   = COALESCE(NEW.expiry_date, expiry_date)
   WHERE id = NEW.medicine_id;

  INSERT INTO public.stock_movement_log (
    clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
    reference_id, reference_type, moved_by, remarks
  )
  SELECT
    COALESCE(NEW.clinic_id, r.clinic_id), NEW.medicine_id, 'inward', v_qty, m.current_stock,
    NEW.receipt_id, 'inward_receipt', r.uploaded_by,
    CONCAT('Stock received via invoice: ', r.invoice_number,
           CASE WHEN COALESCE(NEW.free_quantity, 0) > 0
                THEN CONCAT(' (incl. ', NEW.free_quantity, ' free)') ELSE '' END)
  FROM public.medicines_master m, public.pharmacy_inward_receipts r
  WHERE m.id = NEW.medicine_id AND r.id = NEW.receipt_id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Bills: bill type, separate pharmacy series, tax totals
-- ---------------------------------------------------------------------------
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS bill_type text NOT NULL DEFAULT 'opd'
    CHECK (bill_type IN ('opd', 'pharmacy', 'ipd')),
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off numeric(8,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bills_clinic_type_date
  ON public.bills (clinic_id, bill_type, bill_date);

-- bill_number was globally unique; two clinics on the same pharmacy series
-- would collide. Make it unique per clinic instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_bill_number_key') THEN
    ALTER TABLE public.bills DROP CONSTRAINT bills_bill_number_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bills_clinic_bill_number_key
  ON public.bills (clinic_id, bill_number);

ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS medicine_id uuid REFERENCES public.medicines_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS hsn_code text,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric(12,2),
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) NOT NULL DEFAULT 0;

-- Per-clinic, per-financial-year counter for the pharmacy invoice series.
CREATE TABLE IF NOT EXISTS public.pharmacy_invoice_counters (
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  fy_label text NOT NULL,                     -- '26-27'
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, fy_label)
);
ALTER TABLE public.pharmacy_invoice_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_invoice_counters;
CREATE POLICY tenant_select ON public.pharmacy_invoice_counters FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- Indian financial year label for a date: Apr 2026 .. Mar 2027 -> '26-27'
CREATE OR REPLACE FUNCTION public.indian_fy_label(p_date date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN extract(month FROM p_date) >= 4
      THEN to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
    ELSE to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY')
  END;
$$;

-- Returns e.g. 'PH/26-27/00042'. Row-locked on the counter so concurrent
-- dispenses never share a number.
CREATE OR REPLACE FUNCTION public.next_pharmacy_bill_number(p_clinic_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy text := public.indian_fy_label((now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_prefix text;
  v_next integer;
BEGIN
  IF p_clinic_id IS NULL OR p_clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;

  SELECT COALESCE(NULLIF(btrim(pharmacy_invoice_prefix), ''), 'PH') INTO v_prefix
    FROM public.clinic_settings WHERE id = p_clinic_id;

  INSERT INTO public.pharmacy_invoice_counters (clinic_id, fy_label, last_number)
  VALUES (p_clinic_id, v_fy, 1)
  ON CONFLICT (clinic_id, fy_label) DO UPDATE
    SET last_number = public.pharmacy_invoice_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN format('%s/%s/%s', v_prefix, v_fy, lpad(v_next::text, 5, '0'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_pharmacy_bill_number(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Dispensed items: GST output + batch + bill linkage
-- ---------------------------------------------------------------------------
ALTER TABLE public.pharmacy_dispensed_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hsn_code text,
  ADD COLUMN IF NOT EXISTS gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mrp numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dispensed_items_bill ON public.pharmacy_dispensed_items (bill_id)
  WHERE bill_id IS NOT NULL;

-- Batch quantity follows the dispense. The master pool is still handled by
-- the original trigger (trigger_update_medicine_stock_on_dispense).
CREATE OR REPLACE FUNCTION public.pharmacy_dispense_consume_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qty integer;
BEGIN
  IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;

  SELECT quantity INTO v_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
  IF v_qty IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_qty < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock in batch (available %, requested %)', v_qty, NEW.quantity;
  END IF;

  UPDATE public.medicine_batches
     SET quantity = quantity - NEW.quantity, updated_at = now()
   WHERE id = NEW.batch_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispense_consume_batch ON public.pharmacy_dispensed_items;
CREATE TRIGGER trg_dispense_consume_batch
  AFTER INSERT ON public.pharmacy_dispensed_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_dispense_consume_batch();

-- ---------------------------------------------------------------------------
-- 8. Debit notes (return to supplier) — reverses ITC and stock, batch-aware
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pharmacy_debit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  debit_note_number text NOT NULL,
  note_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  against_receipt_id uuid REFERENCES public.pharmacy_inward_receipts(id) ON DELETE SET NULL,
  reason text,
  is_interstate boolean NOT NULL DEFAULT false,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  igst_amount numeric(14,2) NOT NULL DEFAULT 0,
  round_off numeric(8,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, debit_note_number)
);

CREATE TABLE IF NOT EXISTS public.pharmacy_debit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  debit_note_id uuid NOT NULL REFERENCES public.pharmacy_debit_notes(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines_master(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
  batch_number text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_rate numeric(12,2) NOT NULL DEFAULT 0,
  hsn_code text,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
  cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
  igst_amount numeric(14,2) NOT NULL DEFAULT 0,
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debit_notes_clinic_date ON public.pharmacy_debit_notes (clinic_id, note_date);
CREATE INDEX IF NOT EXISTS idx_debit_note_items_note ON public.pharmacy_debit_note_items (debit_note_id);

ALTER TABLE public.pharmacy_debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_debit_note_items ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pharmacy_debit_notes', 'pharmacy_debit_note_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_write ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write ON public.%I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

-- Debit note number: DN/26-27/00007 per clinic per FY
CREATE TABLE IF NOT EXISTS public.pharmacy_debit_note_counters (
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, fy_label)
);
ALTER TABLE public.pharmacy_debit_note_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.pharmacy_debit_note_counters;
CREATE POLICY tenant_select ON public.pharmacy_debit_note_counters FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

CREATE OR REPLACE FUNCTION public.next_debit_note_number(p_clinic_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fy text := public.indian_fy_label((now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_next integer;
BEGIN
  IF p_clinic_id IS NULL OR p_clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;
  INSERT INTO public.pharmacy_debit_note_counters (clinic_id, fy_label, last_number)
  VALUES (p_clinic_id, v_fy, 1)
  ON CONFLICT (clinic_id, fy_label) DO UPDATE
    SET last_number = public.pharmacy_debit_note_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN format('DN/%s/%s', v_fy, lpad(v_next::text, 5, '0'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_debit_note_number(uuid) TO authenticated;

-- Stock + batch + movement log on debit note item insert
CREATE OR REPLACE FUNCTION public.pharmacy_debit_note_item_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock integer;
  v_batch_qty integer;
  v_note record;
BEGIN
  SELECT current_stock INTO v_stock FROM public.medicines_master
   WHERE id = NEW.medicine_id FOR UPDATE;
  IF v_stock IS NULL THEN RAISE EXCEPTION 'Medicine not found'; END IF;
  IF v_stock < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock to return (available %, requested %)', v_stock, NEW.quantity;
  END IF;

  IF NEW.batch_id IS NOT NULL THEN
    SELECT quantity INTO v_batch_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
    IF COALESCE(v_batch_qty, 0) < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock in batch (available %, requested %)', COALESCE(v_batch_qty, 0), NEW.quantity;
    END IF;
    UPDATE public.medicine_batches SET quantity = quantity - NEW.quantity, updated_at = now()
     WHERE id = NEW.batch_id;
  END IF;

  UPDATE public.medicines_master SET current_stock = v_stock - NEW.quantity
   WHERE id = NEW.medicine_id;

  SELECT * INTO v_note FROM public.pharmacy_debit_notes WHERE id = NEW.debit_note_id;

  INSERT INTO public.stock_movement_log
    (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
     reference_id, reference_type, moved_by, movement_date, remarks)
  VALUES
    (NEW.clinic_id, NEW.medicine_id, 'return', -NEW.quantity, v_stock - NEW.quantity,
     NEW.debit_note_id, 'debit_note', v_note.created_by, now(),
     CONCAT('Return to supplier via ', v_note.debit_note_number,
            CASE WHEN v_note.reason IS NOT NULL THEN ': ' || v_note.reason ELSE '' END));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debit_note_item_stock ON public.pharmacy_debit_note_items;
CREATE TRIGGER trg_debit_note_item_stock
  AFTER INSERT ON public.pharmacy_debit_note_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_debit_note_item_stock();

-- ---------------------------------------------------------------------------
-- 9. GST report functions. All read stored amounts only; all tenant-checked.
-- ---------------------------------------------------------------------------

-- Outward supplies (pharmacy bills) grouped by GST rate, with credit notes
-- (refunded amounts) as separate negative rows. Feeds GSTR-1 B2C summary.
CREATE OR REPLACE FUNCTION public.gst_outward_summary(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  kind text, gst_rate numeric, invoice_count bigint,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH lines AS (
    SELECT bi.gst_rate, b.id AS bill_id,
           bi.taxable_amount, bi.cgst_amount, bi.sgst_amount, bi.igst_amount,
           bi.taxable_amount + bi.cgst_amount + bi.sgst_amount + bi.igst_amount AS total,
           -- refund share: refunded_amount / total_price of the line
           CASE WHEN COALESCE(bi.total_price, 0) > 0
                THEN LEAST(1, COALESCE(bi.refunded_amount, 0) / bi.total_price) ELSE 0 END AS refund_frac
      FROM public.bill_items bi
      JOIN public.bills b ON b.id = bi.bill_id
     WHERE b.clinic_id = p_clinic_id
       AND p_clinic_id IN (SELECT public.user_clinic_ids())
       AND b.bill_type = 'pharmacy'
       AND b.status <> 'cancelled'
       AND (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
  )
  SELECT 'sale'::text, gst_rate, COUNT(DISTINCT bill_id),
         ROUND(SUM(taxable_amount), 2), ROUND(SUM(cgst_amount), 2), ROUND(SUM(sgst_amount), 2),
         ROUND(SUM(igst_amount), 2), ROUND(SUM(total), 2)
    FROM lines GROUP BY gst_rate
  UNION ALL
  SELECT 'credit_note'::text, gst_rate, COUNT(DISTINCT bill_id),
         -ROUND(SUM(taxable_amount * refund_frac), 2), -ROUND(SUM(cgst_amount * refund_frac), 2),
         -ROUND(SUM(sgst_amount * refund_frac), 2), -ROUND(SUM(igst_amount * refund_frac), 2),
         -ROUND(SUM(total * refund_frac), 2)
    FROM lines WHERE refund_frac > 0 GROUP BY gst_rate
  ORDER BY 1 DESC, 2;
$$;
GRANT EXECUTE ON FUNCTION public.gst_outward_summary(uuid, date, date) TO authenticated;

-- HSN-wise outward summary (GSTR-1 table 12)
CREATE OR REPLACE FUNCTION public.gst_hsn_summary(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  hsn_code text, gst_rate numeric, quantity bigint,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(NULLIF(bi.hsn_code, ''), 'UNMAPPED'), bi.gst_rate,
         SUM(bi.quantity - COALESCE(bi.refunded_quantity, 0))::bigint,
         ROUND(SUM(bi.taxable_amount * (1 - CASE WHEN COALESCE(bi.total_price,0) > 0 THEN LEAST(1, COALESCE(bi.refunded_amount,0)/bi.total_price) ELSE 0 END)), 2),
         ROUND(SUM(bi.cgst_amount    * (1 - CASE WHEN COALESCE(bi.total_price,0) > 0 THEN LEAST(1, COALESCE(bi.refunded_amount,0)/bi.total_price) ELSE 0 END)), 2),
         ROUND(SUM(bi.sgst_amount    * (1 - CASE WHEN COALESCE(bi.total_price,0) > 0 THEN LEAST(1, COALESCE(bi.refunded_amount,0)/bi.total_price) ELSE 0 END)), 2),
         ROUND(SUM(bi.igst_amount    * (1 - CASE WHEN COALESCE(bi.total_price,0) > 0 THEN LEAST(1, COALESCE(bi.refunded_amount,0)/bi.total_price) ELSE 0 END)), 2),
         ROUND(SUM((bi.taxable_amount + bi.cgst_amount + bi.sgst_amount + bi.igst_amount)
                   * (1 - CASE WHEN COALESCE(bi.total_price,0) > 0 THEN LEAST(1, COALESCE(bi.refunded_amount,0)/bi.total_price) ELSE 0 END)), 2)
    FROM public.bill_items bi
    JOIN public.bills b ON b.id = bi.bill_id
   WHERE b.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND b.bill_type = 'pharmacy'
     AND b.status <> 'cancelled'
     AND (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
   GROUP BY 1, 2
   ORDER BY 1, 2;
$$;
GRANT EXECUTE ON FUNCTION public.gst_hsn_summary(uuid, date, date) TO authenticated;

-- Inward register: every purchase invoice and every debit note (negative) in
-- the period, with supplier GSTIN. Feeds GSTR-2B reconciliation / ITC.
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
  SELECT 'debit_note'::text, d.id, d.debit_note_number, d.note_date,
         s.name, s.gstin, d.is_interstate,
         -d.taxable_amount, -d.cgst_amount, -d.sgst_amount, -d.igst_amount, -d.grand_total
    FROM public.pharmacy_debit_notes d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
   WHERE d.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND d.note_date BETWEEN p_from AND p_to
  ORDER BY 4, 3;
$$;
GRANT EXECUTE ON FUNCTION public.gst_inward_register(uuid, date, date) TO authenticated;

-- Invoice-level outward register (B2C) for the period
CREATE OR REPLACE FUNCTION public.gst_outward_register(
  p_clinic_id uuid, p_from date, p_to date
) RETURNS TABLE (
  bill_id uuid, bill_number text, bill_date timestamptz, patient_name text, status text,
  taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric,
  round_off numeric, total_amount numeric, refunded_amount numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT b.id, b.bill_number, b.bill_date, p.name, b.status::text,
         b.taxable_amount, b.cgst_amount, b.sgst_amount, b.igst_amount,
         b.round_off, b.total_amount, b.total_refunded_amount
    FROM public.bills b
    LEFT JOIN public.patients p ON p.id = b.patient_id
   WHERE b.clinic_id = p_clinic_id
     AND p_clinic_id IN (SELECT public.user_clinic_ids())
     AND b.bill_type = 'pharmacy'
     AND (b.bill_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p_from AND p_to
   ORDER BY b.bill_date;
$$;
GRANT EXECUTE ON FUNCTION public.gst_outward_register(uuid, date, date) TO authenticated;

COMMIT;
