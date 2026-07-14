-- ============================================================================
-- IPD Migration 019: OPD ↔ IPD price link + one-way auto-sync
--
-- Decision: the two catalogs stay separate (OPD's tests_master is a GLOBAL
-- clinical catalog wired into the OPD EMR; IPD's services_master is the
-- clinic-scoped charge-code price book). Instead of a risky merge, imported
-- services carry a hard link (external_system='opd_test', external_ref=test id)
-- and a trigger keeps prices flowing OPD → IPD automatically:
-- change a test's price in the OPD app and the linked IPD service updates.
-- ============================================================================

BEGIN;

-- 1. Allow the new link type (original CHECK only had lims/ris)
ALTER TABLE public.services_master
  DROP CONSTRAINT IF EXISTS services_master_external_system_check;
ALTER TABLE public.services_master
  ADD CONSTRAINT services_master_external_system_check
  CHECK (external_system IN ('lims', 'ris', 'opd_test'));

-- 2. Backfill: link already-imported OPD tests (created by the import button
--    before this migration) by exact name match
UPDATE public.services_master s
   SET external_system = 'opd_test',
       external_ref = t.id::text
  FROM public.tests_master t
 WHERE s.external_system IS NULL
   AND s.service_code LIKE '%-OP%'
   AND lower(s.name) = lower(t.name);

-- 3. One-way price sync: OPD price change → linked IPD service
CREATE OR REPLACE FUNCTION public.sync_opd_test_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.services_master
     SET base_price = NEW.price,
         base_cost = COALESCE(NEW.cost, base_cost),
         updated_at = now()
   WHERE clinic_id = NEW.clinic_id
     AND external_system = 'opd_test'
     AND external_ref = NEW.test_id::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_opd_test_price ON public.clinic_test_prices;
CREATE TRIGGER trg_sync_opd_test_price
  AFTER INSERT OR UPDATE OF price, cost ON public.clinic_test_prices
  FOR EACH ROW EXECUTE FUNCTION public.sync_opd_test_price();

COMMIT;
