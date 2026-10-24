  -- ============================================================================
  -- Stocked unit vs dispense unit.
  --
  -- Until now stock was counted in whole "units" with no statement of what a
  -- unit is. In a real pharmacy the unit you buy, stock and price is a PACK
  -- (a strip, a bottle, a vial) while the unit you hand over the counter is a
  -- TABLET / ml / piece. One strip of 10 tablets with an MRP of 100 is one
  -- stocked unit; selling 5 tablets is selling 0.5 of a stocked unit for 50,
  -- with GST backed out of that 50.
  --
  -- Model:
  --   * medicines_master.pack_size  = dispense units in one stocked unit (10)
  --     medicines_master.stock_unit / dispense_unit = the labels ('Strip', 'Tablet')
  --     medicines_master.allow_loose_sale = may a part pack be broken open
  --   * every stock quantity becomes numeric(14,3), i.e. stocked units can be
  --     fractional. 2.5 strips means two strips and a half-strip loose.
  --   * a sale row keeps TWO numbers. quantity is always in stocked units and is
  --     what stock, valuation and every report move by. billed_quantity /
  --     billed_unit / unit_price describe the line as the invoice prints it:
  --     "5 Tablet at 10.00" for a broken strip, "2 Strip at 100.00" for two whole
  --     ones. unit_price is therefore per BILLED unit, while mrp stays the pack
  --     MRP, which is what the law requires printed. billed_quantity x unit_price
  --     always equals the line's gross, whichever unit was used.
  --   * pack_size is snapshotted on the sale row so an old invoice still reads
  --     correctly after the master is edited.
  --
  -- Everything is additive: pack_size defaults to 1, so a SKU nobody has
  -- touched behaves exactly as before and quantity == billed_quantity.
  --
  -- Purchases, returns to supplier and sub-store transfers stay in whole packs
  -- (you do not buy half a strip), so those quantity columns stay integer.
  -- ============================================================================

  BEGIN;

  -- ---------------------------------------------------------------------------
  -- 1. Medicine master: pack size and unit labels
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.medicines_master
    ADD COLUMN IF NOT EXISTS pack_size numeric(12,3) NOT NULL DEFAULT 1
      CHECK (pack_size > 0),
    ADD COLUMN IF NOT EXISTS stock_unit text,
    ADD COLUMN IF NOT EXISTS dispense_unit text,
    ADD COLUMN IF NOT EXISTS allow_loose_sale boolean NOT NULL DEFAULT true;

  COMMENT ON COLUMN public.medicines_master.pack_size IS
    'Dispense units in one stocked unit: 10 for a strip of 10 tablets. 1 means the stocked unit is the dispense unit.';
  COMMENT ON COLUMN public.medicines_master.stock_unit IS
    'Label for the unit that is purchased, stocked and carries the MRP: Strip, Bottle, Vial, Box. Defaults to "Pack" when blank.';
  COMMENT ON COLUMN public.medicines_master.dispense_unit IS
    'Label for the unit handed to the customer: Tablet, Capsule, ml. Defaults to "Unit" when blank.';
  COMMENT ON COLUMN public.medicines_master.allow_loose_sale IS
    'False for a SKU that may only leave in full packs (ampoules, sealed bottles) — the counter then refuses a part quantity.';

  -- ---------------------------------------------------------------------------
  -- 2. Stock quantities become fractional.
  --
  -- total_selling_price is a stored generated column over quantity, so it has
  -- to go before the type change and comes back in step 4 over the billed
  -- quantity (the price is per billed unit).
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.pharmacy_dispensed_items DROP COLUMN IF EXISTS total_selling_price;

  ALTER TABLE public.medicines_master
    ALTER COLUMN current_stock TYPE numeric(14,3);

  ALTER TABLE public.medicine_batches
    ALTER COLUMN quantity TYPE numeric(14,3);

  ALTER TABLE public.pharmacy_dispensed_items
    ALTER COLUMN quantity TYPE numeric(14,3),
    ALTER COLUMN refunded_quantity TYPE numeric(14,3);

  ALTER TABLE public.bill_items
    ALTER COLUMN quantity TYPE numeric(14,3),
    ALTER COLUMN refunded_quantity TYPE numeric(14,3);

  ALTER TABLE public.stock_movement_log
    ALTER COLUMN quantity_change TYPE numeric(14,3),
    ALTER COLUMN new_stock_level TYPE numeric(14,3);

  -- ---------------------------------------------------------------------------
  -- 3. Sale rows carry the billed line alongside the stocked-unit quantity
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.pharmacy_dispensed_items
    ADD COLUMN IF NOT EXISTS pack_size numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
    ADD COLUMN IF NOT EXISTS billed_quantity numeric(14,3),
    ADD COLUMN IF NOT EXISTS billed_unit text;

  ALTER TABLE public.bill_items
    ADD COLUMN IF NOT EXISTS pack_size numeric(12,3) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
    ADD COLUMN IF NOT EXISTS billed_quantity numeric(14,3),
    ADD COLUMN IF NOT EXISTS billed_unit text;

  COMMENT ON COLUMN public.pharmacy_dispensed_items.quantity IS
    'Stocked units consumed, fractional on a loose sale: 0.5 for 5 tablets out of a strip of 10. All stock and reporting is in this unit.';
  COMMENT ON COLUMN public.pharmacy_dispensed_items.billed_quantity IS
    'The quantity as charged, in billed_unit: 5 when 5 tablets were sold loose, 2 when two whole strips were.';
  COMMENT ON COLUMN public.pharmacy_dispensed_items.billed_unit IS
    'Unit that billed_quantity and selling_price_at_dispense are both in: the dispense unit on a loose sale, the stocked unit otherwise.';
  COMMENT ON COLUMN public.pharmacy_dispensed_items.selling_price_at_dispense IS
    'Rate per billed_unit: per tablet (MRP / pack_size) on a loose sale, per pack otherwise.';
  COMMENT ON COLUMN public.bill_items.billed_quantity IS
    'Quantity as printed on the invoice, in billed_unit. quantity stays in stocked units for stock and valuation.';
  COMMENT ON COLUMN public.bill_items.billed_unit IS
    'Unit that billed_quantity and unit_price are both in, so quantity x rate always equals the line amount.';

  -- Old rows were whole stocked units sold one-for-one.
  UPDATE public.pharmacy_dispensed_items
    SET billed_quantity = quantity
  WHERE billed_quantity IS NULL;

  UPDATE public.bill_items
    SET billed_quantity = quantity
  WHERE billed_quantity IS NULL;

  -- ---------------------------------------------------------------------------
  -- 4. Line value follows the billed quantity
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.pharmacy_dispensed_items
    ADD COLUMN total_selling_price numeric
      GENERATED ALWAYS AS (COALESCE(billed_quantity, quantity) * selling_price_at_dispense) STORED;

  -- ---------------------------------------------------------------------------
  -- 5. plpgsql locals that hold a stock level must be numeric now, or a
  --    fractional balance is silently rounded on the way in and written back
  --    whole (2.5 strips would become 3 and then 2).
  -- ---------------------------------------------------------------------------
  CREATE OR REPLACE FUNCTION public.pharmacy_dispense_consume_batch()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_qty numeric;
  BEGIN
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

  CREATE OR REPLACE FUNCTION public.pharmacy_debit_note_item_stock()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_stock numeric;
    v_batch_qty numeric;
    v_note record;
  BEGIN
    SELECT current_stock INTO v_stock FROM public.medicines_master
    WHERE id = NEW.medicine_id FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Medicine not found'; END IF;
    IF v_stock < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock to return (available %, requested %)', trim_scale(v_stock), trim_scale(NEW.quantity);
    END IF;

    IF NEW.batch_id IS NOT NULL THEN
      SELECT quantity INTO v_batch_qty FROM public.medicine_batches WHERE id = NEW.batch_id FOR UPDATE;
      IF COALESCE(v_batch_qty, 0) < NEW.quantity THEN
        RAISE EXCEPTION 'Insufficient stock in batch (available %, requested %)', trim_scale(COALESCE(v_batch_qty, 0)), trim_scale(NEW.quantity);
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

  -- The sub-store module (migrations 20260707100017 and 20260903000000) is not
  -- on every database; the live clinic runs without it. Its functions are only
  -- recreated where their tables exist — and if those migrations are applied
  -- LATER, they recreate the old integer-local versions, so this migration must
  -- be re-run after them to restore the numeric-safe bodies.
  DO $guard$
  BEGIN
    IF to_regclass('public.store_stock') IS NULL THEN
      RAISE NOTICE 'sub-store module not installed - transfer_from_main left alone';
    ELSE
      EXECUTE $exec$
  CREATE OR REPLACE FUNCTION public.transfer_from_main(
    p_clinic_id uuid, p_store_id uuid, p_medicine_id uuid,
    p_quantity integer, p_user_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL
  ) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_stock numeric;
  BEGIN
    SELECT current_stock INTO v_stock
      FROM public.medicines_master
    WHERE id = p_medicine_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Medicine not found'; END IF;
    IF v_stock < p_quantity THEN
      RAISE EXCEPTION 'Insufficient main pharmacy stock (available %)', trim_scale(v_stock);
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
      $exec$;
    END IF;
  END
  $guard$;

  -- Indent dispatch sends whole packs, but the pool it draws from may hold a
  -- broken pack, so the balance it reads and writes back has to be numeric.
  DO $guard$
  BEGIN
    IF to_regclass('public.store_indents') IS NULL THEN
      RAISE NOTICE 'indent module not installed - dispatch_store_indent left alone';
    ELSE
      EXECUTE $exec$
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
      $exec$;
    END IF;
  END
  $guard$;

  -- ---------------------------------------------------------------------------
  -- 6. Report functions: quantity columns were bigint / integer, which would
  --    round a half strip away. Return types change, so each is dropped first.
  -- ---------------------------------------------------------------------------
  DROP FUNCTION IF EXISTS public.gst_hsn_summary(uuid, date, date);
  CREATE FUNCTION public.gst_hsn_summary(
    p_clinic_id uuid, p_from date, p_to date
  ) RETURNS TABLE (
    hsn_code text, gst_rate numeric, quantity numeric,
    taxable_amount numeric, cgst_amount numeric, sgst_amount numeric, igst_amount numeric, total_amount numeric
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    -- Quantity is in stocked units throughout, so half a strip counts as 0.5 and
    -- rows for the same HSN stay addable whatever unit they were sold in.
    SELECT COALESCE(NULLIF(bi.hsn_code, ''), 'UNMAPPED'), bi.gst_rate,
          ROUND(SUM(GREATEST(0, bi.quantity - COALESCE(bi.refunded_quantity, 0))), 3),
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

  -- Quantity sold is reported in stocked units, which is the unit cost, MRP and
  -- stock are all in, so a part pack shows as 0.5 and rows stay addable.
  DROP FUNCTION IF EXISTS public.pharmacy_sales_by_medicine(uuid, date, date);
  CREATE FUNCTION public.pharmacy_sales_by_medicine(
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

  DROP FUNCTION IF EXISTS public.pharmacy_stock_valuation(uuid);
  CREATE FUNCTION public.pharmacy_stock_valuation(p_clinic_id uuid)
  RETURNS TABLE (
    medicine_id uuid, medicine_name text, category text, rack_location text,
    batch_quantity numeric, pooled_quantity numeric, total_quantity numeric,
    pack_size numeric, stock_unit text, dispense_unit text,
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
          ROUND(COALESCE(b.batch_qty, 0), 3),
          ROUND(GREATEST(0, m.current_stock - COALESCE(b.batch_qty, 0)), 3),
          ROUND(m.current_stock, 3),
          m.pack_size,
          COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
          COALESCE(NULLIF(m.dispense_unit, ''), 'Unit'),
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
    ORDER BY 11 DESC;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_stock_valuation(uuid) TO authenticated;

  DROP FUNCTION IF EXISTS public.pharmacy_dead_stock(uuid, integer);
  CREATE FUNCTION public.pharmacy_dead_stock(p_clinic_id uuid, p_days integer DEFAULT 90)
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
            CASE WHEN SUM(quantity) > 0 THEN SUM(quantity * COALESCE(purchase_rate, 0)) / SUM(quantity) END AS avg_cost
        FROM public.medicine_batches WHERE clinic_id = p_clinic_id GROUP BY medicine_id
    )
    SELECT m.id, m.name, COALESCE(m.category::text, 'other'), m.rack_location,
          ROUND(m.current_stock, 3),
          COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
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
    ORDER BY 7 DESC;
  $$;
  GRANT EXECUTE ON FUNCTION public.pharmacy_dead_stock(uuid, integer) TO authenticated;

  DROP FUNCTION IF EXISTS public.pharmacy_expired_stock(uuid);
  CREATE FUNCTION public.pharmacy_expired_stock(p_clinic_id uuid)
  RETURNS TABLE (
    batch_id uuid, medicine_id uuid, medicine_name text, rack_location text,
    batch_number text, expiry_date date, quantity numeric, stock_unit text,
    purchase_rate numeric, mrp numeric, cost_value numeric, supplier_name text
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT mb.id, m.id, m.name, m.rack_location, mb.batch_number, mb.expiry_date,
          ROUND(mb.quantity, 3), COALESCE(NULLIF(m.stock_unit, ''), 'Pack'),
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

  DROP FUNCTION IF EXISTS public.write_off_batch(uuid, text);
  CREATE FUNCTION public.write_off_batch(p_batch_id uuid, p_reason text DEFAULT 'Expired')
  RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_batch record;
    v_stock numeric;
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

  DROP FUNCTION IF EXISTS public.pharmacy_sales_by_user(uuid, date, date);
  CREATE FUNCTION public.pharmacy_sales_by_user(
    p_clinic_id uuid, p_from date, p_to date
  ) RETURNS TABLE (
    user_id uuid, user_name text, invoice_count bigint, line_count bigint, quantity numeric,
    taxable_amount numeric, tax_amount numeric, sales_amount numeric
  ) LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT d.dispensed_by, COALESCE(p.name, 'Unknown'),
          COUNT(DISTINCT d.bill_id), COUNT(*),
          ROUND(SUM(GREATEST(0, d.quantity - COALESCE(d.refunded_quantity, 0))), 3),
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

  -- ---------------------------------------------------------------------------
  -- 7. A purchase line states the pack it was bought in, so the master learns
  --    its pack size from the distributor's invoice the same way it already
  --    learns HSN and GST rate. Only fills a blank: an explicit pack size the
  --    pharmacist set is never overwritten.
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.pharmacy_inward_items
    ADD COLUMN IF NOT EXISTS pack_size numeric(12,3) CHECK (pack_size IS NULL OR pack_size > 0);

  COMMENT ON COLUMN public.pharmacy_inward_items.pack_size IS
    'Dispense units in one purchased pack, as printed on the distributor invoice (10 for 1x10 tablets).';

  CREATE OR REPLACE FUNCTION public.pharmacy_inward_item_sync_master_tax()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    IF NEW.medicine_id IS NULL THEN RETURN NEW; END IF;

    UPDATE public.medicines_master
      SET hsn_code = COALESCE(NULLIF(btrim(NEW.hsn_code), ''), hsn_code),
          gst_rate = CASE WHEN NEW.gst_rate IS NOT NULL AND NEW.gst_rate >= 0 AND NEW.gst_rate <= 28
                          THEN NEW.gst_rate ELSE gst_rate END,
          pack_size = CASE WHEN NEW.pack_size IS NOT NULL AND NEW.pack_size > 0 AND pack_size = 1
                            THEN NEW.pack_size ELSE pack_size END
    WHERE id = NEW.medicine_id
      AND (
        COALESCE(NULLIF(btrim(NEW.hsn_code), ''), hsn_code) IS DISTINCT FROM hsn_code
        OR (NEW.gst_rate IS NOT NULL AND NEW.gst_rate IS DISTINCT FROM gst_rate)
        OR (NEW.pack_size IS NOT NULL AND NEW.pack_size > 0 AND pack_size = 1)
      );
    RETURN NEW;
  END;
  $$;

  COMMIT;
