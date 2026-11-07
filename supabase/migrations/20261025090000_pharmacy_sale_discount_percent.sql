BEGIN;
-- Preserve the customer's chosen sale percentage separately from supplier discounts.
-- Existing invoices stay NULL: a rounded rupee amount cannot recover the exact input.
ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS sale_discount_percent numeric
    CHECK (sale_discount_percent >= 0 AND sale_discount_percent <= 100);
COMMENT ON COLUMN public.bill_items.sale_discount_percent IS
  'Explicit customer sale discount percentage. NULL for legacy/amount-only discounts; never sourced from supplier discounts.';
NOTIFY pgrst, 'reload schema';
COMMIT;
