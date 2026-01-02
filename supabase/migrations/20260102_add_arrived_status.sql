-- Migration: Add 'Arrived' status to appointments
-- This allows tracking when patients physically arrive at the clinic

-- Add 'Arrived' to appointment status check constraint
ALTER TABLE appointments 
  DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check 
  CHECK (status IN (
    'Scheduled', 
    'Confirmed', 
    'Arrived',        -- NEW STATUS: Patient is in waiting room
    'In_Progress', 
    'Completed', 
    'Cancelled', 
    'No_Show'
  ));

-- Add comment for documentation
COMMENT ON CONSTRAINT appointments_status_check ON appointments IS 
  'Valid appointment statuses: Scheduled (default), Confirmed (patient confirmed), Arrived (patient in waiting room), In_Progress (consultation started), Completed, Cancelled, No_Show';
