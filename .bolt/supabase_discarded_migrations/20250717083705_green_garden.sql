/*
  # Billing Automation Triggers

  This migration creates database triggers to automatically handle billing calculations
  and maintain data consistency for financial operations.

  ## Triggers Created:
  1. Auto-calculate bill totals when bill items are inserted/updated/deleted
  2. Update payment status based on paid amount
  3. Auto-generate bill numbers
  4. Validate payment amounts
*/

-- Function to calculate bill totals
CREATE OR REPLACE FUNCTION calculate_bill_totals()
RETURNS TRIGGER AS $$
DECLARE
  bill_id_to_update UUID;
  subtotal DECIMAL(10,2);
  total_discount DECIMAL(10,2);
  total_tax DECIMAL(10,2);
  final_total DECIMAL(10,2);
  current_paid DECIMAL(10,2);
  new_balance DECIMAL(10,2);
  new_status TEXT;
BEGIN
  -- Determine which bill to update
  IF TG_OP = 'DELETE' THEN
    bill_id_to_update := OLD.bill_id;
  ELSE
    bill_id_to_update := NEW.bill_id;
  END IF;

  -- Calculate totals from bill items
  SELECT 
    COALESCE(SUM(total_price), 0),
    COALESCE(SUM(discount), 0),
    COALESCE(SUM(tax), 0)
  INTO subtotal, total_discount, total_tax
  FROM bill_items 
  WHERE bill_id = bill_id_to_update;

  -- Calculate final total
  final_total := subtotal - total_discount + total_tax;

  -- Get current paid amount
  SELECT paid_amount INTO current_paid
  FROM bills 
  WHERE id = bill_id_to_update;

  -- Calculate new balance
  new_balance := final_total - COALESCE(current_paid, 0);

  -- Determine payment status
  IF current_paid >= final_total THEN
    new_status := 'paid';
  ELSIF current_paid > 0 THEN
    new_status := 'partial';
  ELSIF final_total > 0 AND (
    SELECT bill_date FROM bills WHERE id = bill_id_to_update
  ) < CURRENT_DATE - INTERVAL '30 days' THEN
    new_status := 'overdue';
  ELSE
    new_status := 'pending';
  END IF;

  -- Update the bill
  UPDATE bills 
  SET 
    total_amount = final_total,
    balance_amount = new_balance,
    payment_status = new_status,
    updated_at = NOW()
  WHERE id = bill_id_to_update;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update payment status when paid amount changes
CREATE OR REPLACE FUNCTION update_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  new_balance DECIMAL(10,2);
  new_status TEXT;
BEGIN
  -- Calculate new balance
  new_balance := NEW.total_amount - NEW.paid_amount;

  -- Determine payment status
  IF NEW.paid_amount >= NEW.total_amount THEN
    new_status := 'paid';
  ELSIF NEW.paid_amount > 0 THEN
    new_status := 'partial';
  ELSIF NEW.total_amount > 0 AND NEW.bill_date < CURRENT_DATE - INTERVAL '30 days' THEN
    new_status := 'overdue';
  ELSE
    new_status := 'pending';
  END IF;

  -- Update the record
  NEW.balance_amount := new_balance;
  NEW.payment_status := new_status;
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate bill numbers
CREATE OR REPLACE FUNCTION generate_bill_number()
RETURNS TRIGGER AS $$
DECLARE
  year_month TEXT;
  sequence_num INTEGER;
  new_bill_number TEXT;
BEGIN
  -- Only generate if bill_number is not provided
  IF NEW.bill_number IS NULL OR NEW.bill_number = '' THEN
    -- Get year and month
    year_month := TO_CHAR(COALESCE(NEW.bill_date, NOW()), 'YYYYMM');
    
    -- Get next sequence number for this month
    SELECT COALESCE(MAX(
      CAST(
        SUBSTRING(bill_number FROM 'BILL-' || year_month || '-([0-9]+)') 
        AS INTEGER
      )
    ), 0) + 1
    INTO sequence_num
    FROM bills 
    WHERE bill_number LIKE 'BILL-' || year_month || '-%';
    
    -- Generate new bill number
    new_bill_number := 'BILL-' || year_month || '-' || LPAD(sequence_num::TEXT, 4, '0');
    
    NEW.bill_number := new_bill_number;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to validate payment amounts
CREATE OR REPLACE FUNCTION validate_payment_amounts()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure paid amount is not negative
  IF NEW.paid_amount < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- Ensure total amount is not negative
  IF NEW.total_amount < 0 THEN
    RAISE EXCEPTION 'Total amount cannot be negative';
  END IF;

  -- Warn if paid amount exceeds total (but allow for overpayments)
  IF NEW.paid_amount > NEW.total_amount + 100 THEN -- Allow small overpayments
    RAISE WARNING 'Paid amount (%) significantly exceeds total amount (%)', 
      NEW.paid_amount, NEW.total_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers

-- Trigger to recalculate bill totals when bill items change
DROP TRIGGER IF EXISTS trigger_calculate_bill_totals ON bill_items;
CREATE TRIGGER trigger_calculate_bill_totals
  AFTER INSERT OR UPDATE OR DELETE ON bill_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_bill_totals();

-- Trigger to update payment status when bill amounts change
DROP TRIGGER IF EXISTS trigger_update_payment_status ON bills;
CREATE TRIGGER trigger_update_payment_status
  BEFORE UPDATE ON bills
  FOR EACH ROW
  WHEN (OLD.paid_amount IS DISTINCT FROM NEW.paid_amount OR 
        OLD.total_amount IS DISTINCT FROM NEW.total_amount)
  EXECUTE FUNCTION update_payment_status();

-- Trigger to auto-generate bill numbers
DROP TRIGGER IF EXISTS trigger_generate_bill_number ON bills;
CREATE TRIGGER trigger_generate_bill_number
  BEFORE INSERT ON bills
  FOR EACH ROW
  EXECUTE FUNCTION generate_bill_number();

-- Trigger to validate payment amounts
DROP TRIGGER IF EXISTS trigger_validate_payment_amounts ON bills;
CREATE TRIGGER trigger_validate_payment_amounts
  BEFORE INSERT OR UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION validate_payment_amounts();

-- Function to mark bills as overdue (to be called by a scheduled job)
CREATE OR REPLACE FUNCTION mark_overdue_bills()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE bills 
  SET 
    payment_status = 'overdue',
    updated_at = NOW()
  WHERE 
    payment_status IN ('pending', 'partial') 
    AND bill_date < CURRENT_DATE - INTERVAL '30 days'
    AND balance_amount > 0;
    
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get billing summary for a date range
CREATE OR REPLACE FUNCTION get_billing_summary(
  start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  total_bills INTEGER,
  total_amount DECIMAL(10,2),
  paid_amount DECIMAL(10,2),
  pending_amount DECIMAL(10,2),
  overdue_amount DECIMAL(10,2),
  collection_rate DECIMAL(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_bills,
    COALESCE(SUM(b.total_amount), 0) as total_amount,
    COALESCE(SUM(b.paid_amount), 0) as paid_amount,
    COALESCE(SUM(CASE WHEN b.payment_status = 'pending' THEN b.balance_amount ELSE 0 END), 0) as pending_amount,
    COALESCE(SUM(CASE WHEN b.payment_status = 'overdue' THEN b.balance_amount ELSE 0 END), 0) as overdue_amount,
    CASE 
      WHEN SUM(b.total_amount) > 0 THEN 
        ROUND((SUM(b.paid_amount) / SUM(b.total_amount) * 100)::DECIMAL, 2)
      ELSE 0 
    END as collection_rate
  FROM bills b
  WHERE b.bill_date BETWEEN start_date AND end_date;
END;
$$ LANGUAGE plpgsql;