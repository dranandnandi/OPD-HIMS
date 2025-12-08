-- Fix payment trigger to not explicitly set balance_amount
-- The balance_amount column is auto-calculated by the database
-- Created: August 21, 2025

-- Drop the existing trigger function and recreate it without balance_amount update
DROP FUNCTION IF EXISTS update_bill_paid_amount() CASCADE;

-- Create updated function that doesn't try to set balance_amount
CREATE OR REPLACE FUNCTION update_bill_paid_amount()
RETURNS TRIGGER AS $$
DECLARE
  target_bill_id uuid;
  total_paid numeric;
  bill_total numeric;
BEGIN
  -- Get the bill ID from the operation
  target_bill_id := COALESCE(NEW.bill_id, OLD.bill_id);
  
  -- Calculate total paid amount for this bill
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM payment_records 
  WHERE bill_id = target_bill_id;
  
  -- Get bill total amount
  SELECT total_amount INTO bill_total
  FROM bills 
  WHERE id = target_bill_id;
  
  -- Update bill with new paid amount and status (let balance_amount auto-calculate)
  UPDATE bills 
  SET 
    paid_amount = total_paid,
    status = CASE 
      WHEN total_paid >= bill_total THEN 'paid'::bill_payment_status_enum
      WHEN total_paid > 0 THEN 'partial'::bill_payment_status_enum
      ELSE 'pending'::bill_payment_status_enum
    END,
    updated_at = now()
  WHERE id = target_bill_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Recreate the triggers
CREATE TRIGGER trigger_update_bill_paid_amount_insert
  AFTER INSERT ON payment_records
  FOR EACH ROW
  EXECUTE FUNCTION update_bill_paid_amount();

CREATE TRIGGER trigger_update_bill_paid_amount_update
  AFTER UPDATE ON payment_records
  FOR EACH ROW
  EXECUTE FUNCTION update_bill_paid_amount();

CREATE TRIGGER trigger_update_bill_paid_amount_delete
  AFTER DELETE ON payment_records
  FOR EACH ROW
  EXECUTE FUNCTION update_bill_paid_amount();
