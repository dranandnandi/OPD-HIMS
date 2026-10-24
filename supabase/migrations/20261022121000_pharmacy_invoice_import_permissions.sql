-- Supabase projects can grant new objects directly to anon through default
-- privileges. Revoking PUBLIC alone does not remove those explicit grants.
BEGIN;
REVOKE ALL ON TABLE public.pharmacy_invoice_imports FROM anon;
REVOKE ALL ON FUNCTION public.post_pharmacy_invoice_import(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_pharmacy_invoice_import(uuid, integer, jsonb, jsonb) TO authenticated;
COMMIT;
