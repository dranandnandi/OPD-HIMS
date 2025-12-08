-- Add payment records table for enhanced payment tracking and daily reconciliation
-- Created: August 21, 2025

-- Create payment records table
CREATE TABLE public.payment_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL,
  payment_date timestamp with time zone DEFAULT now(),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'upi', 'cheque', 'net_banking', 'wallet')),
  amount numeric NOT NULL CHECK (amount > 0),
  card_reference text,           -- For card/upi reference numbers
  cheque_number text,           -- For cheque numbers
  bank_name text,               -- For cheque/bank transfers
  notes text,
  received_by uuid,             -- Staff member who received payment
  clinic_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT payment_records_pkey PRIMARY KEY (id),
  CONSTRAINT payment_records_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE,
  CONSTRAINT payment_records_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.profiles(id),
  CONSTRAINT payment_records_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

-- Add indexes for better performance
CREATE INDEX idx_payment_records_bill_id ON public.payment_records(bill_id);
CREATE INDEX idx_payment_records_payment_date ON public.payment_records(payment_date);
CREATE INDEX idx_payment_records_clinic_id ON public.payment_records(clinic_id);
CREATE INDEX idx_payment_records_payment_method ON public.payment_records(payment_method);

-- Create function to automatically update bill paid amount when payments are added/updated/deleted
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
  
  -- Update bill with new paid amount and status
  UPDATE bills 
  SET 
    paid_amount = total_paid,
    balance_amount = bill_total - total_paid,
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

-- Create triggers to automatically update bill amounts
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

-- Create function for daily reconciliation reports
CREATE OR REPLACE FUNCTION get_daily_payment_summary(
  p_clinic_id uuid,
  p_date date
)
RETURNS TABLE (
  payment_method text,
  total_amount numeric,
  transaction_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.payment_method,
    COALESCE(SUM(pr.amount), 0) as total_amount,
    COUNT(pr.id) as transaction_count
  FROM payment_records pr
  WHERE pr.clinic_id = p_clinic_id
    AND DATE(pr.payment_date) = p_date
  GROUP BY pr.payment_method
  ORDER BY pr.payment_method;
END;
$$ LANGUAGE plpgsql;

-- Add RLS (Row Level Security) policies
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see payment records from their clinic
CREATE POLICY "payment_records_clinic_isolation" ON public.payment_records
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Grant permissions
GRANT ALL ON public.payment_records TO authenticated;
