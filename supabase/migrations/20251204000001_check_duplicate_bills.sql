-- Check for duplicate bills for the same patient on the same date
SELECT 
  patient_id,
  bill_date,
  total_amount,
  status as payment_status,
  COUNT(*) as count,
  ARRAY_AGG(bill_number ORDER BY bill_date) as bill_numbers,
  ARRAY_AGG(id ORDER BY bill_date) as bill_ids
FROM public.bills
WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
  AND bill_date >= '2025-12-04'
GROUP BY patient_id, bill_date, total_amount, status
HAVING COUNT(*) > 1
ORDER BY bill_date DESC;

-- Also check if there are bills with the same bill_number
SELECT 
  bill_number,
  COUNT(*) as count,
  ARRAY_AGG(id ORDER BY bill_date) as bill_ids,
  ARRAY_AGG(status ORDER BY bill_date) as statuses
FROM public.bills
WHERE clinic_id = 'e9106ae7-98b5-44a5-9f57-98c480b34f30'
GROUP BY bill_number
HAVING COUNT(*) > 1;
