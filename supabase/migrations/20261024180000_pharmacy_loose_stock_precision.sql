-- Keep fractional packs precise enough to reconstruct the entered tablet/ml
-- count. Round balances in DISPENSE units, never each sale to 0.001 packs.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pharmacy_dispensed_items DROP COLUMN total_selling_price;
ALTER TABLE public.medicines_master ALTER COLUMN current_stock TYPE numeric(26,12);
ALTER TABLE public.medicine_batches ALTER COLUMN quantity TYPE numeric(26,12);
ALTER TABLE public.pharmacy_dispensed_items
  ALTER COLUMN quantity TYPE numeric(26,12),
  ALTER COLUMN refunded_quantity TYPE numeric(26,12);
ALTER TABLE public.bill_items
  ALTER COLUMN quantity TYPE numeric(26,12),
  ALTER COLUMN refunded_quantity TYPE numeric(26,12);
ALTER TABLE public.stock_movement_log
  ALTER COLUMN quantity_change TYPE numeric(26,12),
  ALTER COLUMN new_stock_level TYPE numeric(26,12);
ALTER TABLE public.pharmacy_dispensed_items ADD COLUMN total_selling_price numeric
  GENERATED ALWAYS AS (COALESCE(billed_quantity, quantity) * selling_price_at_dispense) STORED;

-- Applies to both invoice and dispense lines, including older app versions
-- still sending 0.067 packs for one tablet from a 15-tablet strip. Whole-pack
-- entries have billed_quantity = quantity and must remain whole-pack entries.
CREATE OR REPLACE FUNCTION public.pharmacy_precise_sale_quantity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_exact numeric;
BEGIN
  IF NEW.medicine_id IS NOT NULL AND NEW.pack_size > 1
     AND NEW.billed_quantity > 0 THEN
    v_exact := round(NEW.billed_quantity / NEW.pack_size, 12);
    IF NEW.quantity = round(v_exact, 3)
       OR abs(NEW.quantity - v_exact) <= 0.000000000001 THEN
      NEW.quantity := v_exact;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_precise_sale_quantity ON public.pharmacy_dispensed_items;
CREATE TRIGGER trg_precise_sale_quantity BEFORE INSERT ON public.pharmacy_dispensed_items
FOR EACH ROW EXECUTE FUNCTION public.pharmacy_precise_sale_quantity();
DROP TRIGGER IF EXISTS trg_precise_sale_quantity ON public.bill_items;
CREATE TRIGGER trg_precise_sale_quantity BEFORE INSERT ON public.bill_items
FOR EACH ROW EXECUTE FUNCTION public.pharmacy_precise_sale_quantity();

-- A stored repeating fraction (14 / 15 packs) is rounded only for storage.
-- Reconstructing the balance in thousandths of a tablet/ml removes that
-- representation error on every movement, so the final tablet leaves zero.
-- Do not rewrite existing balances or infer historical missing stock.
CREATE OR REPLACE FUNCTION public.pharmacy_normalize_stock_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pack numeric;
BEGIN
  IF TG_TABLE_NAME = 'medicines_master' THEN
    v_pack := NEW.pack_size;
    IF v_pack > 1 THEN
      NEW.current_stock := round(round(NEW.current_stock * v_pack, 3) / v_pack, 12);
    END IF;
  ELSE
    SELECT pack_size INTO v_pack FROM public.medicines_master WHERE id = NEW.medicine_id;
    IF v_pack > 1 THEN
      NEW.quantity := round(round(NEW.quantity * v_pack, 3) / v_pack, 12);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_normalize_stock_balance ON public.medicines_master;
CREATE TRIGGER trg_normalize_stock_balance BEFORE INSERT OR UPDATE OF current_stock ON public.medicines_master
FOR EACH ROW EXECUTE FUNCTION public.pharmacy_normalize_stock_balance();
DROP TRIGGER IF EXISTS trg_normalize_stock_balance ON public.medicine_batches;
CREATE TRIGGER trg_normalize_stock_balance BEFORE INSERT OR UPDATE OF quantity ON public.medicine_batches
FOR EACH ROW EXECUTE FUNCTION public.pharmacy_normalize_stock_balance();

NOTIFY pgrst, 'reload schema';
COMMIT;
