-- Add missing updated_at column to bills table
-- Created: August 21, 2025

-- Add updated_at column to bills table
ALTER TABLE public.bills 
ADD COLUMN updated_at timestamp with time zone DEFAULT now();

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_bills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at on bill updates
CREATE TRIGGER trigger_bills_updated_at
  BEFORE UPDATE ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION update_bills_updated_at();
