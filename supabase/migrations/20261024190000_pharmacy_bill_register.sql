BEGIN;
CREATE OR REPLACE FUNCTION public.pharmacy_bill_register(
  p_clinic_id uuid, p_search text DEFAULT '', p_status text DEFAULT 'all',
  p_source text DEFAULT 'all', p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL, p_page integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH matching AS MATERIALIZED (
    SELECT b.*, jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone,
      'patient_number', p.patient_number, 'age', p.age, 'gender', p.gender,
      'address', p.address, 'created_at', p.created_at) AS patients
    FROM public.bills b LEFT JOIN public.patients p ON p.id = b.patient_id
    WHERE b.clinic_id = p_clinic_id AND b.bill_type = 'pharmacy'
      AND (COALESCE(p_status, 'all') = 'all' OR b.status::text = p_status)
      AND (COALESCE(p_source, 'all') = 'all'
        OR (p_source = 'counter' AND b.visit_id IS NULL)
        OR (p_source = 'visit' AND b.visit_id IS NOT NULL))
      AND (p_from IS NULL OR b.bill_date >= p_from)
      AND (p_to IS NULL OR b.bill_date < p_to)
      AND (COALESCE(btrim(p_search), '') = ''
        OR strpos(lower(b.bill_number), lower(btrim(p_search))) > 0
        OR strpos(lower(COALESCE(p.name, '')), lower(btrim(p_search))) > 0
        OR strpos(COALESCE(p.phone, ''), btrim(p_search)) > 0)
  ), paged AS (
    SELECT * FROM matching ORDER BY bill_date DESC, id DESC
      LIMIT 25 OFFSET GREATEST(0, COALESCE(p_page, 0)) * 25
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM matching),
    'sales', (SELECT COALESCE(sum(total_amount), 0) FROM matching WHERE status::text <> 'cancelled'),
    'outstanding', (SELECT COALESCE(sum(balance_amount), 0) FROM matching WHERE status::text <> 'cancelled'),
    'bills', COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY bill_date DESC, id DESC) FROM paged), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.pharmacy_bill_register(uuid,text,text,text,timestamptz,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pharmacy_bill_register(uuid,text,text,text,timestamptz,timestamptz,integer) TO authenticated;
CREATE INDEX IF NOT EXISTS idx_pharmacy_bill_register ON public.bills (clinic_id, bill_date DESC, id DESC) WHERE bill_type = 'pharmacy';
NOTIFY pgrst, 'reload schema';
COMMIT;
