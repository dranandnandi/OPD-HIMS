-- ============================================================================
-- Helpers for the AI document composer (Documents tab → "Write with AI").
--
-- Composing an estimate needs two things the client cannot get cheaply:
--   1. the class-resolved rate for every service in the catalog, in ONE call
--      (resolve_tariff_rate is per-service; a per-row round trip is unusable);
--   2. what this clinic actually bills per patient-day, by service type, so the
--      estimate is anchored to its own history instead of a guessed number.
--
-- Both are SECURITY INVOKER, so RLS on services_master / ipd_admissions /
-- charge_postings keeps a caller inside their own clinic.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Bulk class-aware tariff resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_tariff_rates_bulk(
  p_service_ids uuid[],
  p_tariff_plan_id uuid DEFAULT NULL,
  p_bed_type_id uuid DEFAULT NULL
) RETURNS TABLE (service_id uuid, rate numeric)
LANGUAGE sql STABLE AS $$
  SELECT s.id,
         public.resolve_tariff_rate(s.id, p_tariff_plan_id, p_bed_type_id)
    FROM public.services_master s
   WHERE s.id = ANY (p_service_ids)
     AND s.is_active
$$;

GRANT EXECUTE ON FUNCTION public.resolve_tariff_rates_bulk(uuid[], uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. What this clinic really bills per patient-day, by service type
--
-- Averaged over the most recent completed admissions (optionally only those
-- that stayed in the same bed class), as total billed ÷ total patient-days.
-- Cancelled postings are excluded; package-covered ones are kept because the
-- patient is still quoted for them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ipd_daily_charge_benchmark(
  p_clinic_id uuid,
  p_bed_type_id uuid DEFAULT NULL,
  p_admissions integer DEFAULT 40
) RETURNS TABLE (
  service_type text,
  per_day_avg numeric,
  sample_admissions integer,
  sample_days numeric
)
LANGUAGE sql STABLE AS $$
  WITH adm AS (
    SELECT a.id,
           GREATEST(
             1,
             CEIL(EXTRACT(EPOCH FROM (a.discharge_datetime - a.admission_datetime)) / 86400.0)
           )::numeric AS los
      FROM public.ipd_admissions a
      LEFT JOIN public.ipd_beds b ON b.id = a.current_bed_id
     WHERE a.clinic_id = p_clinic_id
       AND a.discharge_datetime IS NOT NULL
       AND a.status IN ('discharged', 'dama', 'transferred_out')
       AND (p_bed_type_id IS NULL OR b.bed_type_id = p_bed_type_id)
     ORDER BY a.discharge_datetime DESC
     LIMIT GREATEST(1, COALESCE(p_admissions, 40))
  ),
  totals AS (
    SELECT SUM(adm.los) AS days, COUNT(*)::integer AS n FROM adm
  ),
  by_type AS (
    SELECT s.service_type::text AS service_type,
           SUM(cp.net_amount)   AS amount
      FROM public.charge_postings cp
      JOIN adm ON adm.id = cp.admission_id
      JOIN public.services_master s ON s.id = cp.service_id
     WHERE cp.status <> 'cancelled'
     GROUP BY s.service_type
  )
  SELECT by_type.service_type,
         ROUND(by_type.amount / NULLIF(totals.days, 0), 0),
         totals.n,
         totals.days
    FROM by_type CROSS JOIN totals
   WHERE totals.days > 0
   ORDER BY 2 DESC NULLS LAST
$$;

GRANT EXECUTE ON FUNCTION public.ipd_daily_charge_benchmark(uuid, uuid, integer) TO authenticated;

COMMIT;
