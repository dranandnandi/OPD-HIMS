/*
  # Analytics Views for OPD Management System

  This migration creates SQL views to pre-aggregate data for analytics dashboards,
  making frontend queries simpler and faster.

  ## Views Created:
  1. monthly_patient_stats - Monthly patient registration and visit statistics
  2. doctor_performance - Doctor-wise performance metrics
  3. revenue_analytics - Revenue breakdown by time periods
  4. popular_diagnoses - Most common diagnoses with trends
  5. prescription_analytics - Medicine prescription patterns
  6. appointment_analytics - Appointment scheduling and completion rates
*/

-- Monthly Patient Statistics View
CREATE OR REPLACE VIEW monthly_patient_stats AS
SELECT 
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as new_patients,
  COUNT(*) FILTER (WHERE gender = 'male') as male_patients,
  COUNT(*) FILTER (WHERE gender = 'female') as female_patients,
  AVG(age) as average_age,
  COUNT(DISTINCT CASE WHEN last_visit IS NOT NULL THEN id END) as returning_patients
FROM patients
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- Monthly Visit Statistics View
CREATE OR REPLACE VIEW monthly_visit_stats AS
SELECT 
  DATE_TRUNC('month', date) as month,
  COUNT(*) as total_visits,
  COUNT(DISTINCT patient_id) as unique_patients,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_visit_duration_minutes,
  COUNT(*) FILTER (WHERE follow_up_date IS NOT NULL) as visits_with_followup
FROM visits
GROUP BY DATE_TRUNC('month', date)
ORDER BY month DESC;

-- Doctor Performance View
CREATE OR REPLACE VIEW doctor_performance AS
SELECT 
  p.id as doctor_id,
  p.name as doctor_name,
  p.specialization,
  COUNT(v.id) as total_visits,
  COUNT(DISTINCT v.patient_id) as unique_patients,
  AVG(EXTRACT(EPOCH FROM (v.updated_at - v.created_at))/60) as avg_consultation_time,
  COUNT(v.id) FILTER (WHERE v.follow_up_date IS NOT NULL) as followup_visits_scheduled,
  COUNT(DISTINCT DATE(v.date)) as active_days
FROM profiles p
LEFT JOIN visits v ON p.id = v.doctor_id
WHERE p.role_id IN (SELECT id FROM roles WHERE name = 'doctor')
GROUP BY p.id, p.name, p.specialization
ORDER BY total_visits DESC;

-- Revenue Analytics View
CREATE OR REPLACE VIEW revenue_analytics AS
SELECT 
  DATE_TRUNC('month', bill_date) as month,
  COUNT(*) as total_bills,
  SUM(total_amount) as total_revenue,
  SUM(paid_amount) as collected_revenue,
  SUM(balance_amount) as pending_revenue,
  AVG(total_amount) as avg_bill_amount,
  COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_bills,
  COUNT(*) FILTER (WHERE payment_status = 'pending') as pending_bills,
  COUNT(*) FILTER (WHERE payment_status = 'overdue') as overdue_bills
FROM bills
GROUP BY DATE_TRUNC('month', bill_date)
ORDER BY month DESC;

-- Popular Diagnoses View
CREATE OR REPLACE VIEW popular_diagnoses AS
SELECT 
  d.name as diagnosis_name,
  d.icd10_code,
  COUNT(*) as frequency,
  COUNT(DISTINCT d.visit_id) as unique_visits,
  COUNT(DISTINCT v.patient_id) as unique_patients,
  DATE_TRUNC('month', v.date) as month
FROM diagnoses d
JOIN visits v ON d.visit_id = v.id
GROUP BY d.name, d.icd10_code, DATE_TRUNC('month', v.date)
ORDER BY frequency DESC;

-- Prescription Analytics View
CREATE OR REPLACE VIEW prescription_analytics AS
SELECT 
  pr.medicine,
  COUNT(*) as prescription_count,
  COUNT(DISTINCT pr.visit_id) as unique_visits,
  COUNT(DISTINCT v.patient_id) as unique_patients,
  pr.frequency,
  pr.duration,
  DATE_TRUNC('month', v.date) as month
FROM prescriptions pr
JOIN visits v ON pr.visit_id = v.id
GROUP BY pr.medicine, pr.frequency, pr.duration, DATE_TRUNC('month', v.date)
ORDER BY prescription_count DESC;

-- Appointment Analytics View
CREATE OR REPLACE VIEW appointment_analytics AS
SELECT 
  DATE_TRUNC('month', appointment_date) as month,
  COUNT(*) as total_appointments,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_appointments,
  COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_appointments,
  COUNT(*) FILTER (WHERE status = 'no_show') as no_show_appointments,
  appointment_type,
  AVG(duration) as avg_duration,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'completed')::numeric / 
    NULLIF(COUNT(*), 0) * 100, 2
  ) as completion_rate
FROM appointments
GROUP BY DATE_TRUNC('month', appointment_date), appointment_type
ORDER BY month DESC, appointment_type;

-- Patient Age Demographics View
CREATE OR REPLACE VIEW patient_demographics AS
SELECT 
  CASE 
    WHEN age < 18 THEN 'Under 18'
    WHEN age BETWEEN 18 AND 30 THEN '18-30'
    WHEN age BETWEEN 31 AND 50 THEN '31-50'
    WHEN age BETWEEN 51 AND 70 THEN '51-70'
    ELSE 'Over 70'
  END as age_group,
  gender,
  COUNT(*) as patient_count,
  ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM patients) * 100, 2) as percentage
FROM patients
WHERE age IS NOT NULL
GROUP BY 
  CASE 
    WHEN age < 18 THEN 'Under 18'
    WHEN age BETWEEN 18 AND 30 THEN '18-30'
    WHEN age BETWEEN 31 AND 50 THEN '31-50'
    WHEN age BETWEEN 51 AND 70 THEN '51-70'
    ELSE 'Over 70'
  END,
  gender
ORDER BY age_group, gender;

-- Test Ordering Analytics View
CREATE OR REPLACE VIEW test_analytics AS
SELECT 
  t.test_name,
  t.test_type,
  COUNT(*) as times_ordered,
  COUNT(DISTINCT t.visit_id) as unique_visits,
  COUNT(DISTINCT v.patient_id) as unique_patients,
  t.urgency,
  COUNT(*) FILTER (WHERE t.status = 'completed') as completed_tests,
  DATE_TRUNC('month', v.date) as month
FROM tests_ordered t
JOIN visits v ON t.visit_id = v.id
GROUP BY t.test_name, t.test_type, t.urgency, DATE_TRUNC('month', v.date)
ORDER BY times_ordered DESC;

-- Daily Operations Summary View
CREATE OR REPLACE VIEW daily_operations AS
SELECT 
  DATE(v.date) as operation_date,
  COUNT(DISTINCT v.id) as total_visits,
  COUNT(DISTINCT v.patient_id) as unique_patients,
  COUNT(DISTINCT a.id) as total_appointments,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'completed') as completed_appointments,
  COALESCE(SUM(b.total_amount), 0) as daily_revenue,
  COALESCE(SUM(b.paid_amount), 0) as daily_collections,
  COUNT(DISTINCT pr.id) as prescriptions_given,
  COUNT(DISTINCT t.id) as tests_ordered
FROM visits v
LEFT JOIN appointments a ON DATE(a.appointment_date) = DATE(v.date)
LEFT JOIN bills b ON b.visit_id = v.id
LEFT JOIN prescriptions pr ON pr.visit_id = v.id
LEFT JOIN tests_ordered t ON t.visit_id = v.id
GROUP BY DATE(v.date)
ORDER BY operation_date DESC;

-- OCR Usage Analytics View
CREATE OR REPLACE VIEW ocr_analytics AS
SELECT 
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as total_uploads,
  COUNT(*) FILTER (WHERE status = 'completed') as successful_uploads,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_uploads,
  AVG(file_size) as avg_file_size,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'completed')::numeric / 
    NULLIF(COUNT(*), 0) * 100, 2
  ) as success_rate
FROM ocr_uploads
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- Create indexes for better performance on views
CREATE INDEX IF NOT EXISTS idx_visits_date_month ON visits (DATE_TRUNC('month', date));
CREATE INDEX IF NOT EXISTS idx_bills_date_month ON bills (DATE_TRUNC('month', bill_date));
CREATE INDEX IF NOT EXISTS idx_appointments_date_month ON appointments (DATE_TRUNC('month', appointment_date));
CREATE INDEX IF NOT EXISTS idx_patients_created_month ON patients (DATE_TRUNC('month', created_at));

-- Grant access to views for authenticated users
GRANT SELECT ON monthly_patient_stats TO authenticated;
GRANT SELECT ON monthly_visit_stats TO authenticated;
GRANT SELECT ON doctor_performance TO authenticated;
GRANT SELECT ON revenue_analytics TO authenticated;
GRANT SELECT ON popular_diagnoses TO authenticated;
GRANT SELECT ON prescription_analytics TO authenticated;
GRANT SELECT ON appointment_analytics TO authenticated;
GRANT SELECT ON patient_demographics TO authenticated;
GRANT SELECT ON test_analytics TO authenticated;
GRANT SELECT ON daily_operations TO authenticated;
GRANT SELECT ON ocr_analytics TO authenticated;