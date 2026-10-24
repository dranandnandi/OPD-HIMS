-- ============================================================================
-- Fallout audit of the pack/dispense-unit change: three things the stocked-unit
-- rework exposed, none of which the counter itself would ever hit.
--
-- 1. IPD rows in pharmacy_dispensed_items move stock TWICE. The eMAR and
--    ward-store code manage stock themselves (a manual pool update, or the
--    consume_from_store RPC) and then insert their dispensed row — but the
--    AFTER INSERT trigger from 2025 deducts the main pool again. A given dose
--    cost the pool two units, and a ward issue drained the main pool for stock
--    that had already left it when it was transferred to the ward. With
--    fractional units arriving on these rows, the double hit would follow
--    them, so the trigger now leaves admission-linked rows alone.
--
-- 2. Two 2025 helper functions declare current_stock as integer in their
--    return type. RETURN QUERY does not coerce, so the moment current_stock
--    became numeric they would fail with "structure of query does not match"
--    for any caller. Nothing in the app calls them today, but they sit on the
--    database for scripts and older builds, so they are fixed, not dropped.
--
-- 3. Ward stores could only hold whole packs. A nurse giving one tablet from
--    the ward shelf is consuming a fraction of a strip, exactly like the
--    counter selling one loose — so store stock becomes numeric(14,3) the same
--    way the main pool did. Transfers and indents still move whole packs; it
--    is only consumption that may now take a part of one.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The dispense trigger keeps its hands off admission-linked rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_medicine_stock_on_dispense()
RETURNS TRIGGER AS $$
BEGIN
    -- IPD rows (eMAR doses, ward-store issues) account for their own stock:
    -- the eMAR path updates the pool itself and keeps its movement id on the
    -- administration row, and a ward issue draws on store_stock, which left
    -- the main pool when it was transferred. Touching the pool again here
    -- deducted every IPD dose twice.
    -- Read through jsonb on purpose: admission_id only exists where the IPD
    -- module is installed, and a bare NEW.admission_id would make this trigger
    -- fail on the first counter sale of a database without it.
    IF (to_jsonb(NEW) ->> 'admission_id') IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF (SELECT current_stock FROM public.medicines_master WHERE id = NEW.medicine_id) < NEW.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for medicine ID: %. Available: %, Requested: %',
            NEW.medicine_id,
            trim_scale((SELECT current_stock FROM public.medicines_master WHERE id = NEW.medicine_id)),
            trim_scale(NEW.quantity);
    END IF;

    UPDATE public.medicines_master
    SET current_stock = current_stock - NEW.quantity
    WHERE id = NEW.medicine_id;

    INSERT INTO public.stock_movement_log (
        clinic_id,
        medicine_id,
        movement_type,
        quantity_change,
        new_stock_level,
        reference_id,
        reference_type,
        moved_by,
        remarks
    )
    SELECT
        COALESCE(NEW.clinic_id, m.clinic_id),
        NEW.medicine_id,
        'outward',
        -NEW.quantity,
        m.current_stock,
        NEW.id,
        'dispensed_item',
        NEW.dispensed_by,
        CONCAT('Medicine dispensed for visit ID: ', NEW.visit_id)
    FROM public.medicines_master m
    WHERE m.id = NEW.medicine_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The batch trigger gets the same guard for symmetry. IPD rows carry no
-- batch_id today, so it already no-ops on them, but that is an accident of
-- the inserts rather than a property of the trigger.
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

-- ---------------------------------------------------------------------------
-- 2. Legacy helpers whose integer return types would now error at runtime
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_low_stock_medicines();
CREATE FUNCTION public.get_low_stock_medicines()
RETURNS TABLE (
    medicine_id uuid,
    medicine_name text,
    current_stock numeric,
    reorder_level integer,
    stock_difference numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.name,
        m.current_stock,
        m.reorder_level,
        (m.current_stock - m.reorder_level) as stock_difference
    FROM public.medicines_master m
    WHERE m.is_active = true
    AND m.current_stock <= m.reorder_level
    AND m.reorder_level > 0
    ORDER BY (m.current_stock - m.reorder_level) ASC;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS public.get_expiring_medicines(integer);
CREATE FUNCTION public.get_expiring_medicines(days_ahead integer DEFAULT 30)
RETURNS TABLE (
    medicine_id uuid,
    medicine_name text,
    batch_number text,
    expiry_date date,
    current_stock numeric,
    days_to_expiry integer
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.name,
        m.batch_number,
        m.expiry_date,
        m.current_stock,
        (m.expiry_date - CURRENT_DATE) as days_to_expiry
    FROM public.medicines_master m
    WHERE m.is_active = true
    AND m.expiry_date IS NOT NULL
    AND m.expiry_date <= (CURRENT_DATE + INTERVAL '1 day' * days_ahead)
    AND m.current_stock > 0
    ORDER BY m.expiry_date ASC;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Ward stores may hold a broken pack
-- ---------------------------------------------------------------------------
-- The sub-store module (20260707100017) is optional and absent on the live
-- clinic. All of this section is skipped where its tables do not exist; if the
-- module is installed later, re-run this migration so consumption goes numeric.
DO $guard$
BEGIN
  IF to_regclass('public.store_stock') IS NULL THEN
    RAISE NOTICE 'sub-store module not installed - ward-store changes skipped';
    RETURN;
  END IF;

  EXECUTE $exec$
ALTER TABLE public.store_stock
  ALTER COLUMN quantity TYPE numeric(14,3);
ALTER TABLE public.store_consumptions
  ALTER COLUMN quantity TYPE numeric(14,3);
ALTER TABLE public.store_transfers
  ALTER COLUMN quantity TYPE numeric(14,3);

COMMENT ON COLUMN public.store_stock.quantity IS
  'Stocked units in the sub-store; fractional once a pack has been broken for a dose. Transfers in are whole packs.';

-- Consumption may now take a fraction of a pack (one tablet of a ward strip),
-- so the parameter and the locals go numeric. The old integer signature is
-- dropped so PostgREST has exactly one function to bind to.
DROP FUNCTION IF EXISTS public.consume_from_store(uuid, uuid, uuid, integer, uuid, uuid, text);
CREATE FUNCTION public.consume_from_store(
  p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
  p_quantity numeric, p_admission_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_qty numeric;
  v_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Consumption quantity must be more than zero';
  END IF;

  SELECT quantity INTO v_qty FROM public.store_stock
   WHERE store_id = p_store_id AND medicine_id = p_medicine_id
   FOR UPDATE;
  IF COALESCE(v_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient store stock (available %)', trim_scale(COALESCE(v_qty, 0));
  END IF;

  UPDATE public.store_stock SET quantity = quantity - p_quantity, updated_at = now()
   WHERE store_id = p_store_id AND medicine_id = p_medicine_id;

  INSERT INTO public.store_consumptions
    (clinic_id, store_id, medicine_id, admission_id, quantity, consumed_by, remarks)
  VALUES (p_clinic_id, p_store_id, p_medicine_id, p_admission_id, p_quantity, p_user_id, p_remarks)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.consume_from_store(uuid, uuid, uuid, numeric, uuid, uuid, text) TO authenticated;

-- Same numeric local for the store-to-store move: it reads a balance that may
-- now be fractional, even though what it moves is still whole packs.
CREATE OR REPLACE FUNCTION public.transfer_between_stores(
  p_clinic_id uuid, p_from_store uuid, p_to_store uuid, p_medicine_id uuid,
  p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_qty numeric;
BEGIN
  SELECT quantity INTO v_qty FROM public.store_stock
   WHERE store_id = p_from_store AND medicine_id = p_medicine_id
   FOR UPDATE;
  IF COALESCE(v_qty, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock in source store (available %)', trim_scale(COALESCE(v_qty, 0));
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
$fn$;
  $exec$;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 4. A mis-read batch number can be corrected on the batch
--
-- The batch number is identity: it is what a drug recall is matched against,
-- so a wrong one is dangerous, not merely untidy. Renaming fixes the batch and
-- every row that denormalised the old text off it — the purchase lines (the
-- register should match the supplier's invoice), and the dispense/bill lines
-- (the recall trail should name the real batch; the paper already printed is
-- wrong either way, the record should hold the truth). The change is noted in
-- the stock ledger with a zero movement so it is never silent.
--
-- Renaming onto a number another batch of the same medicine already uses is
-- refused: that is a merge of two stock pots, which is a manual job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_medicine_batch(
  p_batch_id uuid,
  p_new_number text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch public.medicine_batches;
  v_new text := btrim(COALESCE(p_new_number, ''));
  v_old text;
  v_stock numeric;
BEGIN
  IF v_new = '' THEN
    RAISE EXCEPTION 'Batch number cannot be blank';
  END IF;

  SELECT * INTO v_batch FROM public.medicine_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_batch.clinic_id NOT IN (SELECT public.user_clinic_ids()) THEN
    RAISE EXCEPTION 'Not allowed for this clinic';
  END IF;
  IF v_batch.batch_number = v_new THEN
    RETURN to_jsonb(v_batch);
  END IF;
  IF EXISTS (SELECT 1 FROM public.medicine_batches
              WHERE medicine_id = v_batch.medicine_id AND batch_number = v_new AND id <> p_batch_id) THEN
    RAISE EXCEPTION
      'Batch % already exists for this medicine — merging two batches is a manual stock adjustment, not a rename',
      v_new;
  END IF;

  v_old := v_batch.batch_number;

  UPDATE public.medicine_batches
     SET batch_number = v_new, updated_at = now()
   WHERE id = p_batch_id
  RETURNING * INTO v_batch;

  -- Rows that copied the old text when they were written follow the batch they
  -- point at. Rows matched only by text (no batch_id) are left alone: they may
  -- genuinely be a different batch that happened to share the misreading.
  UPDATE public.pharmacy_inward_items    SET batch_number = v_new WHERE batch_id = p_batch_id;
  UPDATE public.pharmacy_dispensed_items SET batch_number = v_new WHERE batch_id = p_batch_id;
  UPDATE public.bill_items               SET batch_number = v_new WHERE batch_id = p_batch_id;
  UPDATE public.pharmacy_debit_note_items SET batch_number = v_new WHERE batch_id = p_batch_id;
  UPDATE public.medicines_master
     SET batch_number = v_new
   WHERE id = v_batch.medicine_id AND batch_number = v_old;

  SELECT current_stock INTO v_stock FROM public.medicines_master WHERE id = v_batch.medicine_id;
  INSERT INTO public.stock_movement_log
    (clinic_id, medicine_id, movement_type, quantity_change, new_stock_level,
     reference_id, reference_type, moved_by, movement_date, remarks)
  VALUES
    (v_batch.clinic_id, v_batch.medicine_id, 'adjustment', 0, GREATEST(0, COALESCE(v_stock, 0)),
     p_batch_id, 'batch_rename', auth.uid(), now(),
     CONCAT('Batch ', v_old, ' renamed to ', v_new,
            CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN ': ' || p_reason ELSE '' END));

  RETURN to_jsonb(v_batch);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rename_medicine_batch(uuid, text, text) TO authenticated;

COMMIT;
