-- Central project only. Product credentials select the product in the handler.
-- Local servers can check an authoritative tenant ID without knowing its central ID.
BEGIN;
CREATE FUNCTION public.suite_resolve_product_access(p_product text,p_tenant text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid;
BEGIN
 IF p_product NOT IN ('opd','growth','whatsapp','workforce') OR p_tenant IS NULL OR length(p_tenant) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Valid product and local tenant required';
 END IF;
 SELECT organization_id INTO v_org FROM suite_bindings WHERE product_code=p_product AND local_tenant_id=p_tenant;
 IF v_org IS NULL THEN
  RETURN jsonb_build_object('contract','suite.access.v1','managed',false,'allowed',false,
    'product_code',p_product,'local_tenant_id',p_tenant,'issued_at',now(),'refresh_by',now()+interval '5 minutes');
 END IF;
 RETURN suite_product_access(v_org,p_product,p_tenant)||jsonb_build_object('managed',true);
END $$;
REVOKE ALL ON FUNCTION public.suite_resolve_product_access(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_resolve_product_access(text,text) TO service_role;
COMMIT;
