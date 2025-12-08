-- Add unique constraint to prevent duplicate bills for same visit
-- This will prevent creating multiple bills for the same visit

-- First, check if there are any duplicate bills for visits
SELECT 
  visit_id,
  COUNT(*) as bill_count,
  ARRAY_AGG(id ORDER BY created_at) as bill_ids,
  ARRAY_AGG(bill_number ORDER BY created_at) as bill_numbers
FROM public.bills
WHERE visit_id IS NOT NULL
GROUP BY visit_id
HAVING COUNT(*) > 1;

-- If duplicates exist, you'll need to manually delete them before adding the constraint
-- Then add the unique constraint:
-- ALTER TABLE public.bills ADD CONSTRAINT unique_visit_bill UNIQUE (visit_id);

-- Also add a partial unique index for bills without visits (direct billing)
-- This is commented out as it may not be needed:
-- CREATE UNIQUE INDEX idx_unique_patient_bill_date 
-- ON public.bills (patient_id, bill_date, total_amount)
-- WHERE visit_id IS NULL;
