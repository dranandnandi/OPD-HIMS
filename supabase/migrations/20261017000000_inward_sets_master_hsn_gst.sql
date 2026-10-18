-- ============================================================================
-- The distributor's invoice is the authority on a medicine's HSN and GST rate.
-- Every inward line that carries them updates the medicine master, so a SKU
-- created at the default 12% is corrected to 5% the moment it is purchased
-- at 5%, and the next sale is taxed correctly.
--
-- Also back-fills masters that still have no HSN from their latest purchase.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pharmacy_inward_item_sync_master_tax()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.medicine_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.medicines_master
     SET hsn_code = COALESCE(NULLIF(btrim(NEW.hsn_code), ''), hsn_code),
         gst_rate = CASE WHEN NEW.gst_rate IS NOT NULL AND NEW.gst_rate >= 0 AND NEW.gst_rate <= 28
                         THEN NEW.gst_rate ELSE gst_rate END
   WHERE id = NEW.medicine_id
     AND (
       COALESCE(NULLIF(btrim(NEW.hsn_code), ''), hsn_code) IS DISTINCT FROM hsn_code
       OR (NEW.gst_rate IS NOT NULL AND NEW.gst_rate IS DISTINCT FROM gst_rate)
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inward_item_sync_master_tax ON public.pharmacy_inward_items;
CREATE TRIGGER trg_inward_item_sync_master_tax
  AFTER INSERT ON public.pharmacy_inward_items
  FOR EACH ROW EXECUTE FUNCTION public.pharmacy_inward_item_sync_master_tax();

-- Back-fill from the most recent purchase line that carried tax details.
WITH latest AS (
  SELECT DISTINCT ON (i.medicine_id)
         i.medicine_id, NULLIF(btrim(i.hsn_code), '') AS hsn_code, i.gst_rate
    FROM public.pharmacy_inward_items i
   WHERE i.medicine_id IS NOT NULL
     AND (NULLIF(btrim(i.hsn_code), '') IS NOT NULL OR i.gst_rate > 0)
   ORDER BY i.medicine_id, i.created_at DESC
)
UPDATE public.medicines_master m
   SET hsn_code = COALESCE(m.hsn_code, l.hsn_code),
       gst_rate = CASE WHEN l.gst_rate > 0 THEN l.gst_rate ELSE m.gst_rate END
  FROM latest l
 WHERE l.medicine_id = m.id
   AND (m.hsn_code IS NULL OR (l.gst_rate > 0 AND l.gst_rate IS DISTINCT FROM m.gst_rate));

COMMIT;
