BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.medicines_master ADD COLUMN IF NOT EXISTS merged_into uuid;
CREATE TABLE public.pharmacy_product_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinic_settings(id),
  source_id uuid NOT NULL UNIQUE,
  target_id uuid NOT NULL,
  source_snapshot jsonb NOT NULL,
  target_snapshot jsonb NOT NULL,
  source_price jsonb,
  target_price jsonb,
  reason text NOT NULL,
  merged_by uuid NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pharmacy_product_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY pharmacy_merge_read ON public.pharmacy_product_merges FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
REVOKE ALL ON public.pharmacy_product_merges FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pharmacy_product_merges TO authenticated;

CREATE FUNCTION public.merge_pharmacy_products(p_source_id uuid,p_target_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE clinic uuid; source public.medicines_master%ROWTYPE; target public.medicines_master%ROWTYPE;
  ref record; audit_id uuid; source_price jsonb; target_price jsonb;
  source_mrp numeric; target_mrp numeric; source_max numeric; target_max numeric;
  source_count bigint; target_count bigint; source_known bigint; target_known bigint;
BEGIN
  clinic := public.require_pharmacy_clinic();
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id=p_target_id THEN RAISE EXCEPTION 'Select two different products'; END IF;
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Enter a merge reason (5–1000 characters)'; END IF;
  -- Stable ordering also serializes simultaneous merges of overlapping pairs.
  PERFORM 1 FROM public.medicines_master WHERE id IN (p_source_id,p_target_id) ORDER BY id FOR UPDATE;
  SELECT * INTO source FROM public.medicines_master WHERE id=p_source_id;
  SELECT * INTO target FROM public.medicines_master WHERE id=p_target_id;
  IF source.id IS NULL OR target.id IS NULL OR source.clinic_id IS DISTINCT FROM clinic OR target.clinic_id IS DISTINCT FROM clinic
    THEN RAISE EXCEPTION 'Both products must belong to your clinic'; END IF;
  IF source.merged_into=p_target_id THEN RETURN p_target_id; END IF; -- Safe retry.
  IF NOT source.is_active OR NOT target.is_active OR source.merged_into IS NOT NULL OR target.merged_into IS NOT NULL
    THEN RAISE EXCEPTION 'Only active, unmerged products can be merged'; END IF;
  IF coalesce(source.pack_size,1)<>coalesce(target.pack_size,1)
    OR lower(coalesce(source.stock_unit,''))<>lower(coalesce(target.stock_unit,''))
    OR lower(coalesce(source.dispense_unit,''))<>lower(coalesce(target.dispense_unit,''))
    OR coalesce(source.allow_loose_sale,true)<>coalesce(target.allow_loose_sale,true)
    OR lower(coalesce(source.strength,''))<>lower(coalesce(target.strength,''))
    OR source.dosage_form IS DISTINCT FROM target.dosage_form
    OR lower(coalesce(source.manufacturer,''))<>lower(coalesce(target.manufacturer,''))
    OR source.gst_rate IS DISTINCT FROM target.gst_rate
    THEN RAISE EXCEPTION 'Strength, dosage form, manufacturer, GST and pack rules must match before merging'; END IF;
  IF EXISTS(SELECT 1 FROM public.medicine_batches a JOIN public.medicine_batches b USING(batch_number)
    WHERE a.medicine_id=source.id AND b.medicine_id=target.id)
    THEN RAISE EXCEPTION 'These products share a batch number. Review the duplicate batch before merging'; END IF;
  -- A selling price may include a discount: it is never evidence of pack MRP.
  -- Be conservative if any recorded lot has an unknown or different MRP.
  PERFORM 1 FROM public.medicine_batches WHERE medicine_id IN (source.id,target.id) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.pharmacy_inward_items WHERE medicine_id IN (source.id,target.id) ORDER BY id FOR UPDATE;
  SELECT min(mrp),max(mrp),count(*),count(mrp) INTO source_mrp,source_max,source_count,source_known
    FROM (SELECT mrp FROM public.medicine_batches WHERE medicine_id=source.id
      UNION ALL SELECT mrp FROM public.pharmacy_inward_items WHERE medicine_id=source.id) prices;
  SELECT min(mrp),max(mrp),count(*),count(mrp) INTO target_mrp,target_max,target_count,target_known
    FROM (SELECT mrp FROM public.medicine_batches WHERE medicine_id=target.id
      UNION ALL SELECT mrp FROM public.pharmacy_inward_items WHERE medicine_id=target.id) prices;
  IF source_count=0 OR target_count=0 OR source_known<>source_count OR target_known<>target_count
    OR source_mrp IS NULL OR target_mrp IS NULL OR source_mrp<=0 OR target_mrp<=0
    THEN RAISE EXCEPTION 'Record and verify the pack MRP for both products before merging'; END IF;
  IF source_mrp<>source_max OR target_mrp<>target_max OR source_mrp<>target_mrp
    THEN RAISE EXCEPTION 'Only products with the same recorded pack MRP can be merged. Different MRPs must stay separate'; END IF;
  -- Returned purchase lines are intentionally immutable; never bypass that guard.
  IF EXISTS(SELECT 1 FROM public.pharmacy_inward_items i JOIN public.pharmacy_debit_note_items d ON d.inward_item_id=i.id
    WHERE i.medicine_id=source.id) THEN RAISE EXCEPTION 'The duplicate has supplier returns; its purchase history must be reconciled before merging'; END IF;

  SELECT to_jsonb(p) INTO source_price FROM public.clinic_medicine_prices p WHERE p.medicine_id=source.id AND p.clinic_id=clinic;
  SELECT to_jsonb(p) INTO target_price FROM public.clinic_medicine_prices p WHERE p.medicine_id=target.id AND p.clinic_id=clinic;
  INSERT INTO public.pharmacy_product_merges(clinic_id,source_id,target_id,source_snapshot,target_snapshot,source_price,target_price,reason,merged_by)
    VALUES(clinic,source.id,target.id,to_jsonb(source),to_jsonb(target),source_price,target_price,btrim(p_reason),auth.uid()) RETURNING id INTO audit_id;
  IF target_price IS NOT NULL THEN
    DELETE FROM public.clinic_medicine_prices WHERE medicine_id=source.id AND clinic_id=clinic;
  ELSE
    UPDATE public.clinic_medicine_prices SET medicine_id=target.id WHERE medicine_id=source.id AND clinic_id=clinic;
  END IF;

  -- Preserve line IDs, quantities, prices and batch IDs. Do not coalesce batches
  -- or rewrite immutable supply snapshots. Any unique-key collision (including
  -- ward store balances) rolls the whole transaction back for manual review.
  FOR ref IN
    SELECT ns.nspname,tab.relname,att.attname
    FROM pg_constraint c JOIN pg_class tab ON tab.oid=c.conrelid
    JOIN pg_namespace ns ON ns.oid=tab.relnamespace
    JOIN pg_attribute att ON att.attrelid=c.conrelid AND att.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.medicines_master'::regclass
      AND array_length(c.conkey,1)=1 AND ns.nspname='public'
      AND tab.relname NOT IN ('clinic_medicine_prices','medicine_generic_name_reviews')
    ORDER BY tab.relname,att.attname
  LOOP
    EXECUTE format('UPDATE %I.%I SET %I=$1 WHERE %I=$2',ref.nspname,ref.relname,ref.attname,ref.attname)
      USING target.id,source.id;
  END LOOP;
  -- Barcode uniqueness requires releasing the alias barcode first.
  UPDATE public.medicines_master SET current_stock=0,is_active=false,merged_into=target.id,barcode=NULL,updated_at=now() WHERE id=source.id;
  UPDATE public.medicines_master SET current_stock=target.current_stock+source.current_stock,
    is_nrx=target.is_nrx OR source.is_nrx,is_schedule_h1=target.is_schedule_h1 OR source.is_schedule_h1,
    barcode=coalesce(nullif(target.barcode,''),source.barcode),updated_at=now() WHERE id=target.id;
  -- These accounting helpers exist on installations with scheme-cost support.
  IF to_regprocedure('public.refresh_pharmacy_pool_cost(uuid)') IS NOT NULL THEN
    -- Preserve the opening pool's acquisition value as well as received lines.
    UPDATE public.medicines_master SET
      opening_pool_quantity=coalesce(source.opening_pool_quantity,0)+coalesce(target.opening_pool_quantity,0),
      opening_pool_value=coalesce(source.opening_pool_value,0)+coalesce(target.opening_pool_value,0)
      WHERE id=target.id;
    PERFORM public.refresh_pharmacy_pool_cost(target.id);
  END IF;
  RETURN target.id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Duplicate batch or store balance prevents this merge. Review the conflicting records first; nothing was changed';
END; $$;
REVOKE ALL ON FUNCTION public.merge_pharmacy_products(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_pharmacy_products(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.guard_merged_pharmacy_product() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE merged uuid;
BEGIN
  SELECT merged_into INTO merged FROM public.medicines_master WHERE id=NEW.medicine_id FOR UPDATE;
  IF merged IS NOT NULL THEN RAISE EXCEPTION 'This product was merged. Refresh and select the retained product'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_merged_pharmacy_product() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_merged_product BEFORE INSERT OR UPDATE OF medicine_id ON public.pharmacy_inward_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_merged_pharmacy_product();
CREATE TRIGGER guard_merged_product BEFORE INSERT OR UPDATE OF medicine_id ON public.pharmacy_dispensed_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_merged_pharmacy_product();
CREATE TRIGGER guard_merged_product BEFORE INSERT OR UPDATE OF medicine_id ON public.bill_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_merged_pharmacy_product();
CREATE TRIGGER guard_merged_product BEFORE INSERT OR UPDATE OF medicine_id ON public.medicine_batches
  FOR EACH ROW EXECUTE FUNCTION public.guard_merged_pharmacy_product();

-- Stale stock-adjustment/store clients must not restock the retired alias.
CREATE FUNCTION public.guard_merged_product_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.merged_into IS NOT NULL AND NEW.current_stock<>0 THEN
    RAISE EXCEPTION 'This product was merged. Refresh and select the retained product';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_merged_product_balance() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_merged_balance BEFORE INSERT OR UPDATE ON public.medicines_master
  FOR EACH ROW EXECUTE FUNCTION public.guard_merged_product_balance();
NOTIFY pgrst,'reload schema';
COMMIT;
