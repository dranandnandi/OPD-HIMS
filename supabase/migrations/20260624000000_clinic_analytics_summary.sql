-- Real analytics payload for the Analytics dashboard.
-- Keeps expensive grouping in Postgres and returns one JSON object to the app.
CREATE OR REPLACE FUNCTION public.get_clinic_analytics_summary(
  p_clinic_id uuid,
  p_start_date date,
  p_end_date date,
  p_bucket text DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clinic_timezone text := 'Asia/Kolkata';
  today_in_clinic date;
  range_days integer;
  comparison_start date;
  comparison_end date;
  result jsonb;
BEGIN
  IF p_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Clinic id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND clinic_id = p_clinic_id
  ) THEN
    RAISE EXCEPTION 'User is not assigned to the requested clinic';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'A valid analytics date range is required';
  END IF;

  IF p_bucket NOT IN ('day', 'month') THEN
    RAISE EXCEPTION 'Analytics bucket must be day or month';
  END IF;

  SELECT COALESCE(timezone, clinic_timezone)
  INTO clinic_timezone
  FROM public.clinic_settings
  WHERE id = p_clinic_id;

  today_in_clinic := (now() AT TIME ZONE clinic_timezone)::date;
  range_days := (p_end_date - p_start_date) + 1;
  comparison_end := p_start_date - 1;
  comparison_start := comparison_end - range_days + 1;

  WITH
  range_bounds AS (
    SELECT
      p_start_date AS start_date,
      p_end_date AS end_date,
      comparison_start AS previous_start_date,
      comparison_end AS previous_end_date,
      today_in_clinic AS today_date
  ),
  patient_metrics AS (
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(is_hidden, false) = false) AS total_patients,
      COUNT(*) FILTER (
        WHERE COALESCE(is_hidden, false) = false
          AND (created_at AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
      ) AS new_patients,
      COUNT(*) FILTER (
        WHERE COALESCE(is_hidden, false) = false
          AND (created_at AT TIME ZONE clinic_timezone)::date BETWEEN comparison_start AND comparison_end
      ) AS previous_new_patients
    FROM public.patients
    WHERE clinic_id = p_clinic_id
  ),
  visit_metrics AS (
    SELECT
      COUNT(*) FILTER (
        WHERE (date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
      ) AS total_visits,
      COUNT(*) FILTER (
        WHERE (date AT TIME ZONE clinic_timezone)::date BETWEEN comparison_start AND comparison_end
      ) AS previous_total_visits,
      COUNT(*) FILTER (
        WHERE (date AT TIME ZONE clinic_timezone)::date = today_in_clinic
      ) AS today_visits,
      COUNT(*) FILTER (
        WHERE follow_up_date IS NOT NULL
          AND (follow_up_date AT TIME ZONE clinic_timezone)::date <= today_in_clinic
      ) AS followups_due
    FROM public.visits
    WHERE clinic_id = p_clinic_id
  ),
  revenue_metrics AS (
    SELECT
      COALESCE(SUM(
        CASE
          WHEN record_type = 'payment' THEN amount
          WHEN record_type = 'adjustment' THEN amount
          WHEN record_type = 'refund' THEN -amount
          ELSE 0
        END
      ) FILTER (
        WHERE (payment_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
      ), 0) AS net_revenue,
      COALESCE(SUM(
        CASE
          WHEN record_type = 'payment' THEN amount
          WHEN record_type = 'adjustment' THEN amount
          WHEN record_type = 'refund' THEN -amount
          ELSE 0
        END
      ) FILTER (
        WHERE (payment_date AT TIME ZONE clinic_timezone)::date BETWEEN comparison_start AND comparison_end
      ), 0) AS previous_net_revenue,
      COALESCE(SUM(
        CASE
          WHEN record_type = 'payment' THEN amount
          WHEN record_type = 'adjustment' THEN amount
          WHEN record_type = 'refund' THEN -amount
          ELSE 0
        END
      ) FILTER (
        WHERE (payment_date AT TIME ZONE clinic_timezone)::date = today_in_clinic
      ), 0) AS today_revenue,
      COUNT(*) FILTER (
        WHERE record_type = 'payment'
          AND (payment_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
      ) AS payment_count
    FROM public.payment_records
    WHERE clinic_id = p_clinic_id
  ),
  outstanding_metrics AS (
    SELECT COALESCE(SUM(balance_amount), 0) AS outstanding_balance
    FROM public.bills
    WHERE clinic_id = p_clinic_id
      AND balance_amount > 0
  ),
  consultation_metrics AS (
    SELECT COALESCE(AVG(NULLIF(total_price, 0) / GREATEST(quantity, 1)), 0) AS avg_consultation_fee
    FROM public.bill_items bi
    JOIN public.bills b ON b.id = bi.bill_id
    WHERE b.clinic_id = p_clinic_id
      AND bi.item_type = 'consultation'
      AND (b.bill_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
  ),
  trend_seed AS (
    SELECT generated_date::date AS period_start
    FROM generate_series(
      CASE WHEN p_bucket = 'month' THEN date_trunc('month', p_start_date)::date ELSE p_start_date END,
      CASE WHEN p_bucket = 'month' THEN date_trunc('month', p_end_date)::date ELSE p_end_date END,
      CASE WHEN p_bucket = 'month' THEN interval '1 month' ELSE interval '1 day' END
    ) AS generated_date
  ),
  visit_trend AS (
    SELECT
      ts.period_start,
      COALESCE(COUNT(v.id), 0) AS visits
    FROM trend_seed ts
    LEFT JOIN public.visits v
      ON v.clinic_id = p_clinic_id
      AND (
        CASE
          WHEN p_bucket = 'month' THEN date_trunc('month', v.date AT TIME ZONE clinic_timezone)::date
          ELSE (v.date AT TIME ZONE clinic_timezone)::date
        END
      ) = ts.period_start
    GROUP BY ts.period_start
    ORDER BY ts.period_start
  ),
  revenue_trend AS (
    SELECT
      ts.period_start,
      COALESCE(SUM(
        CASE
          WHEN pr.record_type = 'payment' THEN pr.amount
          WHEN pr.record_type = 'adjustment' THEN pr.amount
          WHEN pr.record_type = 'refund' THEN -pr.amount
          ELSE 0
        END
      ), 0) AS revenue
    FROM trend_seed ts
    LEFT JOIN public.payment_records pr
      ON pr.clinic_id = p_clinic_id
      AND (
        CASE
          WHEN p_bucket = 'month' THEN date_trunc('month', pr.payment_date AT TIME ZONE clinic_timezone)::date
          ELSE (pr.payment_date AT TIME ZONE clinic_timezone)::date
        END
      ) = ts.period_start
    GROUP BY ts.period_start
    ORDER BY ts.period_start
  ),
  top_diagnoses AS (
    SELECT
      initcap(trim(name)) AS diagnosis_name,
      COUNT(*) AS diagnosis_count
    FROM public.diagnoses
    WHERE clinic_id = p_clinic_id
      AND NULLIF(trim(name), '') IS NOT NULL
      AND (created_at AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY lower(trim(name)), initcap(trim(name))
    ORDER BY diagnosis_count DESC, diagnosis_name
    LIMIT 5
  ),
  top_medicines AS (
    SELECT
      initcap(trim(medicine)) AS medicine_name,
      COUNT(*) AS medicine_count
    FROM public.prescriptions
    WHERE clinic_id = p_clinic_id
      AND NULLIF(trim(medicine), '') IS NOT NULL
      AND (created_at AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY lower(trim(medicine)), initcap(trim(medicine))
    ORDER BY medicine_count DESC, medicine_name
    LIMIT 5
  ),
  appointment_statuses AS (
    SELECT status::text AS appointment_status, COUNT(*) AS appointment_count
    FROM public.appointments
    WHERE clinic_id = p_clinic_id
      AND (appointment_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY status
    ORDER BY appointment_count DESC, appointment_status
  ),
  payment_methods AS (
    SELECT
      payment_method::text AS method,
      COALESCE(SUM(amount), 0) AS amount,
      COUNT(*) AS method_count
    FROM public.payment_records
    WHERE clinic_id = p_clinic_id
      AND record_type = 'payment'
      AND (payment_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY payment_method
    ORDER BY amount DESC, method
  ),
  service_categories AS (
    SELECT
      bi.item_type::text AS category,
      COALESCE(SUM(bi.total_price - COALESCE(bi.refunded_amount, 0)), 0) AS amount,
      COUNT(*) AS category_count
    FROM public.bill_items bi
    JOIN public.bills b ON b.id = bi.bill_id
    WHERE b.clinic_id = p_clinic_id
      AND (b.bill_date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY bi.item_type
    ORDER BY amount DESC, category
  ),
  peak_visit_hours AS (
    SELECT
      EXTRACT(HOUR FROM date AT TIME ZONE clinic_timezone)::integer AS hour,
      COUNT(*) AS visit_count
    FROM public.visits
    WHERE clinic_id = p_clinic_id
      AND (date AT TIME ZONE clinic_timezone)::date BETWEEN p_start_date AND p_end_date
    GROUP BY EXTRACT(HOUR FROM date AT TIME ZONE clinic_timezone)::integer
    ORDER BY visit_count DESC, hour
    LIMIT 3
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object(
      'startDate', p_start_date,
      'endDate', p_end_date,
      'previousStartDate', comparison_start,
      'previousEndDate', comparison_end,
      'bucket', p_bucket,
      'timezone', clinic_timezone
    ),
    'metrics', jsonb_build_object(
      'totalPatients', COALESCE(pm.total_patients, 0),
      'newPatients', COALESCE(pm.new_patients, 0),
      'previousNewPatients', COALESCE(pm.previous_new_patients, 0),
      'todayVisits', COALESCE(vm.today_visits, 0),
      'totalVisits', COALESCE(vm.total_visits, 0),
      'previousTotalVisits', COALESCE(vm.previous_total_visits, 0),
      'avgDailyVisits', ROUND(COALESCE(vm.total_visits, 0)::numeric / GREATEST(range_days, 1), 1),
      'followupsDue', COALESCE(vm.followups_due, 0),
      'netRevenue', COALESCE(rm.net_revenue, 0),
      'previousNetRevenue', COALESCE(rm.previous_net_revenue, 0),
      'todayRevenue', COALESCE(rm.today_revenue, 0),
      'paymentCount', COALESCE(rm.payment_count, 0),
      'outstandingBalance', COALESCE(om.outstanding_balance, 0),
      'avgConsultationFee', ROUND(COALESCE(cm.avg_consultation_fee, 0), 2)
    ),
    'visitTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('period', period_start, 'visits', visits) ORDER BY period_start)
      FROM visit_trend
    ), '[]'::jsonb),
    'revenueTrend', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('period', period_start, 'revenue', revenue) ORDER BY period_start)
      FROM revenue_trend
    ), '[]'::jsonb),
    'topDiagnoses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', diagnosis_name, 'count', diagnosis_count) ORDER BY diagnosis_count DESC, diagnosis_name)
      FROM top_diagnoses
    ), '[]'::jsonb),
    'topMedicines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', medicine_name, 'count', medicine_count) ORDER BY medicine_count DESC, medicine_name)
      FROM top_medicines
    ), '[]'::jsonb),
    'appointmentStatuses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', appointment_status, 'count', appointment_count) ORDER BY appointment_count DESC, appointment_status)
      FROM appointment_statuses
    ), '[]'::jsonb),
    'paymentMethods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount, 'count', method_count) ORDER BY amount DESC, method)
      FROM payment_methods
    ), '[]'::jsonb),
    'serviceCategories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', category, 'amount', amount, 'count', category_count) ORDER BY amount DESC, category)
      FROM service_categories
    ), '[]'::jsonb),
    'peakVisitHours', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hour', hour, 'count', visit_count) ORDER BY visit_count DESC, hour)
      FROM peak_visit_hours
    ), '[]'::jsonb)
  )
  INTO result
  FROM patient_metrics pm
  CROSS JOIN visit_metrics vm
  CROSS JOIN revenue_metrics rm
  CROSS JOIN outstanding_metrics om
  CROSS JOIN consultation_metrics cm;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_clinic_analytics_summary(uuid, date, date, text) TO authenticated;
