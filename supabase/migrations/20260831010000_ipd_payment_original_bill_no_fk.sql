-- ============================================================================
-- IPD Migration 026: drop the FK on ipd_payments.original_bill_id
--
-- Migration 025 added ipd_payments.original_bill_id as a REFERENCES column.
-- That gave ipd_payments TWO foreign keys to ipd_bills (bill_id and
-- original_bill_id), so PostgREST could no longer choose a relationship and
-- every embed between the two tables broke at runtime:
--
--   "Could not embed because more than one relationship was found for
--    'ipd_bills' and 'ipd_payments'"
--
-- which took out billingService.listBills() (the whole IPD billing tab) and
-- collectionService's daily collections query.
--
-- Disambiguating each embed with a !constraint hint would fix those two
-- callers and leave the same trap for the next one. original_bill_id is a
-- display-only breadcrumb -- "this receipt was raised against bill X before
-- the final absorbed it" -- written solely by generate_ipd_bill(), which is
-- SECURITY DEFINER and always supplies a real bill id. Bills are superseded,
-- never hard-deleted, so nothing dangles. The constraint buys no integrity
-- worth a permanently ambiguous relationship: keep the column, drop the FK.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.ipd_payments'::regclass
       AND contype = 'f'
       AND confrelid = 'public.ipd_bills'::regclass
       AND conkey = ARRAY[(
         SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.ipd_payments'::regclass
            AND attname = 'original_bill_id'
       )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.ipd_payments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

COMMENT ON COLUMN public.ipd_payments.original_bill_id IS
  'Bill this receipt was raised against before a consolidated final bill absorbed it. Display only — deliberately NOT a foreign key, so ipd_payments keeps exactly one relationship to ipd_bills and PostgREST embeds stay unambiguous.';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- Exactly one FK from ipd_payments to ipd_bills (bill_id):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.ipd_payments'::regclass AND contype='f'
--      AND confrelid='public.ipd_bills'::regclass;
--
-- The embeds work again:
--   GET /ipd_bills?select=*,lines:ipd_bill_lines(*),payments:ipd_payments(*)
--   GET /ipd_payments?select=*,bill:ipd_bills(bill_number)
--
-- NOTE: PostgREST caches the schema. If the error persists after this runs,
-- reload the cache:  NOTIFY pgrst, 'reload schema';
