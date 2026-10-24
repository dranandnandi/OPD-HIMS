import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

/**
 * The pharmacy schema as it stands BEFORE the migrations under test, covering
 * only the tables they touch. Quantity columns are deliberately integer and
 * total_selling_price / total_cost_price deliberately stored generated
 * columns, so a migration has to cope with exactly what it will meet on the
 * live database. Everything runs in an in-memory PostgreSQL; nothing here
 * reads .env or connects to a deployed Supabase project.
 */
export const BASELINE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('test.uid', true)::uuid $$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

  CREATE TABLE public.clinic_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
  -- Every clinic by default. Setting test.clinic_ids to something else is how a
  -- test pretends to be signed in to a different tenant, which deleting the
  -- clinic row could not do (foreign keys hang off it).
  CREATE FUNCTION public.user_clinic_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS
    $fn$ SELECT id FROM public.clinic_settings
          WHERE COALESCE(current_setting('test.clinic_ids', true), '') = ''
             OR id::text = ANY (string_to_array(current_setting('test.clinic_ids', true), ',')) $fn$;

  CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, clinic_id uuid);
  CREATE TABLE public.suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, clinic_id uuid, is_active boolean DEFAULT true);
  CREATE TABLE public.patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
  CREATE TABLE public.visits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid);

  CREATE TYPE public.stock_movement_type_enum AS ENUM ('inward','outward','adjustment','return');

  CREATE TABLE public.medicines_master (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL, generic_name text, brand_name text, category text, dosage_form text,
    strength text, manufacturer text, description text,
    current_stock integer DEFAULT 0, reorder_level integer DEFAULT 0,
    batch_number text, expiry_date date, rack_location text, barcode text,
    is_chronic boolean DEFAULT false, hsn_code text,
    gst_rate numeric(5,2) NOT NULL DEFAULT 12,
    is_active boolean DEFAULT true,
    clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  CREATE INDEX idx_medicines_current_stock ON public.medicines_master(current_stock);

  CREATE TABLE public.clinic_medicine_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, medicine_id uuid,
    selling_price numeric, cost_price numeric);

  CREATE TABLE public.medicine_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
    medicine_id uuid NOT NULL REFERENCES public.medicines_master(id),
    batch_number text NOT NULL, expiry_date date,
    mrp numeric(12,2), purchase_rate numeric(12,2),
    quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    supplier_id uuid REFERENCES public.suppliers(id),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (medicine_id, batch_number));

  CREATE TABLE public.bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid, visit_id uuid,
    bill_number text, bill_type text NOT NULL DEFAULT 'opd',
    status text NOT NULL DEFAULT 'paid', bill_date timestamptz NOT NULL DEFAULT now(),
    total_amount numeric DEFAULT 0, taxable_amount numeric DEFAULT 0,
    cgst_amount numeric DEFAULT 0, sgst_amount numeric DEFAULT 0, igst_amount numeric DEFAULT 0,
    clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id));

  CREATE TABLE public.bill_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    item_type text DEFAULT 'other', item_name text NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price numeric NOT NULL DEFAULT 0, amount numeric NOT NULL DEFAULT 0,
    total_price numeric DEFAULT 0, discount numeric DEFAULT 0, tax numeric DEFAULT 0,
    refunded_quantity integer NOT NULL DEFAULT 0, refunded_amount numeric NOT NULL DEFAULT 0,
    last_refund_reason text, clinic_id uuid,
    medicine_id uuid REFERENCES public.medicines_master(id),
    batch_id uuid REFERENCES public.medicine_batches(id),
    batch_number text, expiry_date date, hsn_code text,
    gst_rate numeric(5,2) NOT NULL DEFAULT 0, mrp numeric(12,2),
    taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
    cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    igst_amount numeric(14,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT bill_items_refunded_qty_check CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity));

  CREATE TABLE public.pharmacy_dispensed_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid, prescription_id uuid,
    medicine_id uuid REFERENCES public.medicines_master(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    dispensed_by uuid REFERENCES public.profiles(id),
    dispense_date timestamptz NOT NULL DEFAULT now(),
    selling_price_at_dispense numeric CHECK (selling_price_at_dispense >= 0),
    total_selling_price numeric GENERATED ALWAYS AS (quantity * selling_price_at_dispense) STORED,
    batch_number text, batch_id uuid REFERENCES public.medicine_batches(id),
    bill_id uuid REFERENCES public.bills(id), hsn_code text,
    gst_rate numeric(5,2) NOT NULL DEFAULT 0, mrp numeric(12,2),
    discount_amount numeric(14,2) NOT NULL DEFAULT 0,
    taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
    cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    igst_amount numeric(14,2) NOT NULL DEFAULT 0,
    refunded_quantity integer NOT NULL DEFAULT 0,
    -- IPD link (the real FK targets ipd_admissions, which these tests do not need)
    admission_id uuid,
    clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
    created_at timestamptz DEFAULT now(),
    CONSTRAINT pharmacy_dispensed_refunded_qty_check CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity));

  CREATE TABLE public.stock_movement_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id uuid REFERENCES public.medicines_master(id),
    movement_type public.stock_movement_type_enum NOT NULL,
    quantity_change integer NOT NULL,
    new_stock_level integer NOT NULL CHECK (new_stock_level >= 0),
    reference_id uuid, reference_type text, moved_by uuid,
    movement_date timestamptz NOT NULL DEFAULT now(), remarks text,
    clinic_id uuid, created_at timestamptz DEFAULT now());

  CREATE TABLE public.pharmacy_inward_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id uuid,
    invoice_number text, receipt_date timestamptz NOT NULL DEFAULT now(),
    supplier_invoice_date date, status text DEFAULT 'completed',
    uploaded_by uuid, invoice_file_url text, remarks text,
    is_interstate boolean NOT NULL DEFAULT false,
    total_amount numeric DEFAULT 0,
    taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
    discount_amount numeric(14,2) NOT NULL DEFAULT 0,
    cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    igst_amount numeric(14,2) NOT NULL DEFAULT 0,
    round_off numeric(8,2) NOT NULL DEFAULT 0,
    grand_total numeric(14,2) NOT NULL DEFAULT 0,
    clinic_id uuid);
  CREATE TABLE public.pharmacy_inward_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id uuid REFERENCES public.pharmacy_inward_receipts(id) ON DELETE CASCADE,
    medicine_id uuid REFERENCES public.medicines_master(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_cost_price numeric NOT NULL CHECK (unit_cost_price >= 0),
    total_cost_price numeric GENERATED ALWAYS AS (quantity * unit_cost_price) STORED,
    batch_number text, expiry_date date,
    batch_id uuid REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
    hsn_code text,
    gst_rate numeric(5,2) NOT NULL DEFAULT 0, mrp numeric(12,2),
    discount_percent numeric(5,2) NOT NULL DEFAULT 0,
    discount_amount numeric(14,2) NOT NULL DEFAULT 0,
    free_quantity integer NOT NULL DEFAULT 0,
    taxable_amount numeric(14,2) NOT NULL DEFAULT 0,
    cgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    sgst_amount numeric(14,2) NOT NULL DEFAULT 0,
    igst_amount numeric(14,2) NOT NULL DEFAULT 0,
    line_total numeric(14,2) NOT NULL DEFAULT 0,
    clinic_id uuid, created_at timestamptz DEFAULT now());

  -- The real insert-time chain: find-or-create the batch, then move the pool.
  CREATE FUNCTION public.pharmacy_inward_item_attach_batch() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE v_clinic uuid; v_supplier uuid; v_batch uuid;
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
      SET quantity = public.medicine_batches.quantity + EXCLUDED.quantity,
          mrp = COALESCE(EXCLUDED.mrp, public.medicine_batches.mrp),
          purchase_rate = COALESCE(EXCLUDED.purchase_rate, public.medicine_batches.purchase_rate),
          updated_at = now()
    RETURNING id INTO v_batch;
    NEW.batch_id := v_batch;
    RETURN NEW;
  END; $fn$;
  CREATE TRIGGER trg_inward_item_attach_batch BEFORE INSERT ON public.pharmacy_inward_items
    FOR EACH ROW EXECUTE FUNCTION public.pharmacy_inward_item_attach_batch();

  CREATE FUNCTION public.update_medicine_stock_on_inward() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
  DECLARE v_qty integer := NEW.quantity + COALESCE(NEW.free_quantity, 0);
  BEGIN
    UPDATE public.medicines_master
       SET current_stock = current_stock + v_qty,
           batch_number = COALESCE(NEW.batch_number, batch_number),
           expiry_date = COALESCE(NEW.expiry_date, expiry_date)
     WHERE id = NEW.medicine_id;
    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
       reference_id, reference_type, moved_by)
    SELECT COALESCE(NEW.clinic_id, r.clinic_id), NEW.medicine_id, 'inward', v_qty, m.current_stock,
           NEW.receipt_id, 'inward_receipt', r.uploaded_by
      FROM public.medicines_master m, public.pharmacy_inward_receipts r
     WHERE m.id = NEW.medicine_id AND r.id = NEW.receipt_id;
    RETURN NEW;
  END; $fn$;
  CREATE TRIGGER trigger_update_medicine_stock_on_inward AFTER INSERT ON public.pharmacy_inward_items
    FOR EACH ROW EXECUTE FUNCTION public.update_medicine_stock_on_inward();

  CREATE TABLE public.pharmacy_debit_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, supplier_id uuid,
    debit_note_number text, reason text, created_by uuid);
  CREATE TABLE public.pharmacy_debit_note_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL,
    debit_note_id uuid NOT NULL REFERENCES public.pharmacy_debit_notes(id),
    medicine_id uuid NOT NULL REFERENCES public.medicines_master(id),
    batch_id uuid REFERENCES public.medicine_batches(id), batch_number text,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_rate numeric(12,2) NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now());

  CREATE TABLE public.ipd_stores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, name text);
  CREATE TABLE public.store_stock (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid,
    store_id uuid NOT NULL, medicine_id uuid NOT NULL,
    quantity integer NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now(),
    UNIQUE (store_id, medicine_id));
  CREATE TABLE public.store_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid,
    from_store_id uuid, to_store_id uuid, medicine_id uuid,
    quantity integer, moved_by uuid, remarks text);
  CREATE TABLE public.store_consumptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid,
    store_id uuid NOT NULL, medicine_id uuid NOT NULL, admission_id uuid,
    quantity integer NOT NULL, consumed_by uuid, remarks text,
    charge_posting_id uuid, created_at timestamptz DEFAULT now());

  -- The 2025 helpers whose integer return types the type change would break.
  CREATE FUNCTION public.get_low_stock_medicines()
  RETURNS TABLE (medicine_id uuid, medicine_name text, current_stock integer,
                 reorder_level integer, stock_difference integer) AS $fn$
  BEGIN
    RETURN QUERY
    SELECT m.id, m.name, m.current_stock, m.reorder_level,
           (m.current_stock - m.reorder_level)
      FROM public.medicines_master m
     WHERE m.is_active = true AND m.current_stock <= m.reorder_level AND m.reorder_level > 0;
  END; $fn$ LANGUAGE plpgsql;

  CREATE FUNCTION public.get_expiring_medicines(days_ahead integer DEFAULT 30)
  RETURNS TABLE (medicine_id uuid, medicine_name text, batch_number text,
                 expiry_date date, current_stock integer, days_to_expiry integer) AS $fn$
  BEGIN
    RETURN QUERY
    SELECT m.id, m.name, m.batch_number, m.expiry_date, m.current_stock,
           (m.expiry_date - CURRENT_DATE)
      FROM public.medicines_master m
     WHERE m.is_active = true AND m.expiry_date IS NOT NULL
       AND m.expiry_date <= (CURRENT_DATE + INTERVAL '1 day' * days_ahead)
       AND m.current_stock > 0;
  END; $fn$ LANGUAGE plpgsql;

  CREATE FUNCTION public.consume_from_store(
    p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
    p_quantity integer, p_admission_id uuid DEFAULT NULL,
    p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
  ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  DECLARE v_qty integer; v_id uuid;
  BEGIN
    SELECT quantity INTO v_qty FROM public.store_stock
     WHERE store_id = p_store_id AND medicine_id = p_medicine_id FOR UPDATE;
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
  END; $fn$;

  CREATE FUNCTION public.transfer_between_stores(
    p_clinic_id uuid, p_from_store uuid, p_to_store uuid, p_medicine_id uuid,
    p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
  ) RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN END; $fn$;
  CREATE TABLE public.store_indents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid, store_id uuid,
    indent_no text, status text NOT NULL DEFAULT 'pending',
    dispatched_by uuid, dispatched_at timestamptz, dispatch_remarks text,
    pharmacy_seen_at timestamptz, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.store_indent_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    indent_id uuid NOT NULL REFERENCES public.store_indents(id),
    medicine_id uuid NOT NULL, requested_qty integer NOT NULL,
    dispatched_qty integer NOT NULL DEFAULT 0, remarks text);

  -- The two stock triggers the dispense path relies on, as they stand today.
  CREATE FUNCTION public.update_medicine_stock_on_dispense() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF (SELECT current_stock FROM public.medicines_master WHERE id = NEW.medicine_id) < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock';
    END IF;
    UPDATE public.medicines_master SET current_stock = current_stock - NEW.quantity WHERE id = NEW.medicine_id;
    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level, reference_id, reference_type, moved_by)
    SELECT NEW.clinic_id, NEW.medicine_id, 'outward', -NEW.quantity, m.current_stock, NEW.id, 'dispensed_item', NEW.dispensed_by
      FROM public.medicines_master m WHERE m.id = NEW.medicine_id;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER trigger_update_medicine_stock_on_dispense
    AFTER INSERT ON public.pharmacy_dispensed_items
    FOR EACH ROW EXECUTE FUNCTION public.update_medicine_stock_on_dispense();

  CREATE FUNCTION public.pharmacy_dispense_consume_batch() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE v_qty integer;
  BEGIN
    IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;
    SELECT quantity INTO v_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
    IF v_qty < NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock in batch'; END IF;
    UPDATE public.medicine_batches SET quantity = quantity - NEW.quantity WHERE id = NEW.batch_id;
    RETURN NEW;
  END; $$;
  CREATE TRIGGER trg_dispense_consume_batch
    AFTER INSERT ON public.pharmacy_dispensed_items
    FOR EACH ROW EXECUTE FUNCTION public.pharmacy_dispense_consume_batch();

  CREATE FUNCTION public.pharmacy_debit_note_item_stock() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE v_stock integer; v_batch_qty integer; v_note record;
  BEGIN
    SELECT current_stock INTO v_stock FROM public.medicines_master WHERE id = NEW.medicine_id FOR UPDATE;
    IF v_stock < NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock to return'; END IF;
    IF NEW.batch_id IS NOT NULL THEN
      SELECT quantity INTO v_batch_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
      UPDATE public.medicine_batches SET quantity = quantity - NEW.quantity WHERE id = NEW.batch_id;
    END IF;
    UPDATE public.medicines_master SET current_stock = v_stock - NEW.quantity WHERE id = NEW.medicine_id;
    SELECT * INTO v_note FROM public.pharmacy_debit_notes WHERE id = NEW.debit_note_id;
    INSERT INTO public.stock_movement_log
      (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level, reference_id, reference_type, moved_by)
    VALUES (NEW.clinic_id, NEW.medicine_id, 'return', -NEW.quantity, v_stock - NEW.quantity,
            NEW.debit_note_id, 'debit_note', v_note.created_by);
    RETURN NEW;
  END; $$;
  CREATE TRIGGER trg_debit_note_item_stock
    AFTER INSERT ON public.pharmacy_debit_note_items
    FOR EACH ROW EXECUTE FUNCTION public.pharmacy_debit_note_item_stock();

  CREATE FUNCTION public.pharmacy_inward_item_sync_master_tax() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
  BEGIN
    IF NEW.medicine_id IS NULL THEN RETURN NEW; END IF;
    UPDATE public.medicines_master
       SET hsn_code = COALESCE(NULLIF(btrim(NEW.hsn_code), ''), hsn_code),
           gst_rate = CASE WHEN NEW.gst_rate IS NOT NULL AND NEW.gst_rate >= 0 AND NEW.gst_rate <= 28
                           THEN NEW.gst_rate ELSE gst_rate END
     WHERE id = NEW.medicine_id;
    RETURN NEW;
  END; $fn$;
  CREATE TRIGGER trg_inward_item_sync_master_tax AFTER INSERT ON public.pharmacy_inward_items
    FOR EACH ROW EXECUTE FUNCTION public.pharmacy_inward_item_sync_master_tax();

  CREATE FUNCTION public.transfer_from_main(
    p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
    p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
  ) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;

  CREATE FUNCTION public.dispatch_store_indent(
    p_indent_id uuid, p_lines jsonb, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
  ) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;

  -- Report functions the migration has to replace, with their old return types.
  CREATE FUNCTION public.gst_hsn_summary(p_clinic_id uuid, p_from date, p_to date)
    RETURNS TABLE (hsn_code text, gst_rate numeric, quantity bigint, taxable_amount numeric,
                   cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric)
    LANGUAGE sql STABLE AS $$ SELECT NULL::text, NULL::numeric, NULL::bigint, NULL::numeric,
                                     NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric $$;
  CREATE FUNCTION public.pharmacy_sales_by_medicine(p_clinic_id uuid, p_from date, p_to date)
    RETURNS TABLE (medicine_id uuid, quantity bigint) LANGUAGE sql STABLE AS
    $$ SELECT NULL::uuid, NULL::bigint $$;
  CREATE FUNCTION public.pharmacy_stock_valuation(p_clinic_id uuid)
    RETURNS TABLE (medicine_id uuid, total_quantity integer) LANGUAGE sql STABLE AS
    $$ SELECT NULL::uuid, NULL::integer $$;
  CREATE FUNCTION public.pharmacy_dead_stock(p_clinic_id uuid, p_days integer DEFAULT 90)
    RETURNS TABLE (medicine_id uuid, current_stock integer) LANGUAGE sql STABLE AS
    $$ SELECT NULL::uuid, NULL::integer $$;
  CREATE FUNCTION public.pharmacy_expired_stock(p_clinic_id uuid)
    RETURNS TABLE (batch_id uuid, quantity integer) LANGUAGE sql STABLE AS
    $$ SELECT NULL::uuid, NULL::integer $$;
  CREATE FUNCTION public.write_off_batch(p_batch_id uuid, p_reason text DEFAULT 'Expired')
    RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
  CREATE FUNCTION public.pharmacy_sales_by_user(p_clinic_id uuid, p_from date, p_to date)
    RETURNS TABLE (user_id uuid, quantity bigint) LANGUAGE sql STABLE AS
    $$ SELECT NULL::uuid, NULL::bigint $$;
`;

/** A fresh database with the pre-migration schema, plus a clinic and a user. */
export async function freshDb() {
  const db = new PGlite();
  await db.exec(BASELINE);
  const clinic = randomUUID();
  const user = randomUUID();
  await db.query('INSERT INTO public.clinic_settings (id, name) VALUES ($1, $2)', [clinic, 'Test Clinic']);
  await db.query('INSERT INTO public.profiles (id, name, clinic_id) VALUES ($1, $2, $3)', [user, 'Pharmacist', clinic]);
  // auth.uid() is what the SECURITY DEFINER functions stamp their audit rows with.
  await db.query("SELECT set_config('test.uid', $1, false)", [user]);
  return { db, clinic, user };
}

/** Apply a migration file verbatim, by name. */
export async function applyMigration(db, name) {
  const sql = await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
  await db.exec(sql);
}

/** Numeric columns come back as strings or numbers depending on the driver. */
export const n = v => Number(v);
