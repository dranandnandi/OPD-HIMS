/*
  # Pharmacy Module Phase 1 - Database Schema

  1. New Tables
    - `suppliers` - Supplier/vendor information
    - `pharmacy_inward_receipts` - Stock receipt records
    - `pharmacy_inward_items` - Individual items in each receipt
    - `pharmacy_dispensed_items` - Medicines dispensed to patients
    - `stock_movement_log` - Audit trail for all stock movements

  2. Schema Updates
    - Enhanced `medicines_master` with inventory fields
    - Added ENUM types for better data integrity
    - Implemented triggers for automatic stock management

  3. Security
    - Enable RLS on all new tables
    - Add policies for authenticated users
    - Proper foreign key constraints
*/

-- Create ENUM types for better data integrity
CREATE TYPE public.inward_receipt_status_enum AS ENUM ('uploaded', 'processing', 'completed', 'failed');
CREATE TYPE public.stock_movement_type_enum AS ENUM ('inward', 'outward', 'adjustment', 'return');

-- Update medicines_master table with inventory fields
ALTER TABLE public.medicines_master
ADD COLUMN IF NOT EXISTS current_stock INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reorder_level INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_price NUMERIC,
ADD COLUMN IF NOT EXISTS selling_price NUMERIC,
ADD COLUMN IF NOT EXISTS batch_number TEXT,
ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Create suppliers table
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create pharmacy_inward_receipts table
CREATE TABLE IF NOT EXISTS public.pharmacy_inward_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES public.suppliers(id),
    invoice_number TEXT UNIQUE,
    receipt_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    total_amount NUMERIC DEFAULT 0,
    uploaded_by UUID REFERENCES public.profiles(id),
    invoice_file_url TEXT,
    status inward_receipt_status_enum DEFAULT 'uploaded',
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create pharmacy_inward_items table
CREATE TABLE IF NOT EXISTS public.pharmacy_inward_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID REFERENCES public.pharmacy_inward_receipts(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES public.medicines_master(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost_price NUMERIC NOT NULL CHECK (unit_cost_price >= 0),
    total_cost_price NUMERIC GENERATED ALWAYS AS (quantity * unit_cost_price) STORED,
    batch_number TEXT,
    expiry_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create pharmacy_dispensed_items table
CREATE TABLE IF NOT EXISTS public.pharmacy_dispensed_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID REFERENCES public.visits(id) ON DELETE CASCADE,
    prescription_id UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
    medicine_id UUID REFERENCES public.medicines_master(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    dispensed_by UUID REFERENCES public.profiles(id),
    dispense_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    selling_price_at_dispense NUMERIC CHECK (selling_price_at_dispense >= 0),
    total_selling_price NUMERIC GENERATED ALWAYS AS (quantity * selling_price_at_dispense) STORED,
    batch_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create stock_movement_log table
CREATE TABLE IF NOT EXISTS public.stock_movement_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID REFERENCES public.medicines_master(id),
    movement_type stock_movement_type_enum NOT NULL,
    quantity_change INTEGER NOT NULL,
    new_stock_level INTEGER NOT NULL CHECK (new_stock_level >= 0),
    reference_id UUID, -- Can refer to receipt_id, dispensed_item_id, etc.
    reference_type TEXT, -- 'inward_receipt', 'dispensed_item', 'adjustment', etc.
    moved_by UUID REFERENCES public.profiles(id),
    movement_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_medicines_current_stock ON public.medicines_master(current_stock);
CREATE INDEX IF NOT EXISTS idx_medicines_reorder_level ON public.medicines_master(reorder_level);
CREATE INDEX IF NOT EXISTS idx_medicines_expiry_date ON public.medicines_master(expiry_date);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(name);
CREATE INDEX IF NOT EXISTS idx_inward_receipts_supplier ON public.pharmacy_inward_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inward_receipts_date ON public.pharmacy_inward_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_inward_items_receipt ON public.pharmacy_inward_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_inward_items_medicine ON public.pharmacy_inward_items(medicine_id);
CREATE INDEX IF NOT EXISTS idx_dispensed_items_visit ON public.pharmacy_dispensed_items(visit_id);
CREATE INDEX IF NOT EXISTS idx_dispensed_items_medicine ON public.pharmacy_dispensed_items(medicine_id);
CREATE INDEX IF NOT EXISTS idx_dispensed_items_date ON public.pharmacy_dispensed_items(dispense_date);
CREATE INDEX IF NOT EXISTS idx_stock_movement_medicine ON public.stock_movement_log(medicine_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_date ON public.stock_movement_log(movement_date);

-- Enable Row Level Security
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_inward_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_inward_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_dispensed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all authenticated users to manage suppliers" 
ON public.suppliers FOR ALL 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to manage inward receipts" 
ON public.pharmacy_inward_receipts FOR ALL 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to manage inward items" 
ON public.pharmacy_inward_items FOR ALL 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to manage dispensed items" 
ON public.pharmacy_dispensed_items FOR ALL 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to view stock movement log" 
ON public.stock_movement_log FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow all authenticated users to insert stock movement log" 
ON public.stock_movement_log FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Function to update medicine stock on inward item insert
CREATE OR REPLACE FUNCTION update_medicine_stock_on_inward()
RETURNS TRIGGER AS $$
BEGIN
    -- Update current stock
    UPDATE public.medicines_master
    SET current_stock = current_stock + NEW.quantity
    WHERE id = NEW.medicine_id;

    -- Log the movement
    INSERT INTO public.stock_movement_log (
        medicine_id, 
        movement_type, 
        quantity_change, 
        new_stock_level, 
        reference_id, 
        reference_type,
        moved_by, 
        remarks
    )
    SELECT 
        NEW.medicine_id, 
        'inward', 
        NEW.quantity, 
        m.current_stock, 
        NEW.receipt_id, 
        'inward_receipt',
        r.uploaded_by, 
        CONCAT('Stock received via invoice: ', r.invoice_number)
    FROM public.medicines_master m, public.pharmacy_inward_receipts r
    WHERE m.id = NEW.medicine_id AND r.id = NEW.receipt_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update medicine stock on dispensed item insert
CREATE OR REPLACE FUNCTION update_medicine_stock_on_dispense()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if sufficient stock is available
    IF (SELECT current_stock FROM public.medicines_master WHERE id = NEW.medicine_id) < NEW.quantity THEN
        RAISE EXCEPTION 'Insufficient stock for medicine ID: %. Available: %, Requested: %', 
            NEW.medicine_id, 
            (SELECT current_stock FROM public.medicines_master WHERE id = NEW.medicine_id), 
            NEW.quantity;
    END IF;

    -- Update current stock
    UPDATE public.medicines_master
    SET current_stock = current_stock - NEW.quantity
    WHERE id = NEW.medicine_id;

    -- Log the movement
    INSERT INTO public.stock_movement_log (
        medicine_id, 
        movement_type, 
        quantity_change, 
        new_stock_level, 
        reference_id, 
        reference_type,
        moved_by, 
        remarks
    )
    SELECT 
        NEW.medicine_id, 
        'outward', 
        -NEW.quantity, 
        m.current_stock, 
        NEW.id, 
        'dispensed_item',
        NEW.dispensed_by, 
        CONCAT('Medicine dispensed for visit ID: ', NEW.visit_id)
    FROM public.medicines_master m
    WHERE m.id = NEW.medicine_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trigger_update_medicine_stock_on_inward
    AFTER INSERT ON public.pharmacy_inward_items
    FOR EACH ROW EXECUTE FUNCTION update_medicine_stock_on_inward();

CREATE TRIGGER trigger_update_medicine_stock_on_dispense
    AFTER INSERT ON public.pharmacy_dispensed_items
    FOR EACH ROW EXECUTE FUNCTION update_medicine_stock_on_dispense();

-- Create updated_at triggers
CREATE TRIGGER trigger_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_inward_receipts_updated_at
    BEFORE UPDATE ON public.pharmacy_inward_receipts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get low stock medicines
CREATE OR REPLACE FUNCTION get_low_stock_medicines()
RETURNS TABLE (
    medicine_id UUID,
    medicine_name TEXT,
    current_stock INTEGER,
    reorder_level INTEGER,
    stock_difference INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.name,
        m.current_stock,
        m.reorder_level,
        (m.current_stock - m.reorder_level) as stock_difference
    FROM public.medicines_master m
    WHERE m.is_active = true 
    AND m.current_stock <= m.reorder_level
    AND m.reorder_level > 0
    ORDER BY (m.current_stock - m.reorder_level) ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to get expiring medicines (within next 30 days)
CREATE OR REPLACE FUNCTION get_expiring_medicines(days_ahead INTEGER DEFAULT 30)
RETURNS TABLE (
    medicine_id UUID,
    medicine_name TEXT,
    batch_number TEXT,
    expiry_date DATE,
    current_stock INTEGER,
    days_to_expiry INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.name,
        m.batch_number,
        m.expiry_date,
        m.current_stock,
        (m.expiry_date - CURRENT_DATE) as days_to_expiry
    FROM public.medicines_master m
    WHERE m.is_active = true 
    AND m.expiry_date IS NOT NULL
    AND m.expiry_date <= (CURRENT_DATE + INTERVAL '1 day' * days_ahead)
    AND m.current_stock > 0
    ORDER BY m.expiry_date ASC;
END;
$$ LANGUAGE plpgsql;

-- Insert some sample suppliers for testing
INSERT INTO public.suppliers (name, contact_person, phone, email, address) VALUES
('MedSupply India Pvt Ltd', 'Rajesh Kumar', '9876543210', 'rajesh@medsupply.com', '123 Medical Street, Mumbai, Maharashtra 400001'),
('PharmaCorp Solutions', 'Priya Sharma', '9876543211', 'priya@pharmacorp.com', '456 Health Avenue, Delhi, Delhi 110001'),
('HealthCare Distributors', 'Mohammed Ali', '9876543212', 'ali@healthcare.com', '789 Wellness Road, Bangalore, Karnataka 560001')
ON CONFLICT (name) DO NOTHING;

-- Update existing medicines with sample inventory data
UPDATE public.medicines_master 
SET 
    current_stock = CASE 
        WHEN name ILIKE '%paracetamol%' THEN 500
        WHEN name ILIKE '%amoxicillin%' THEN 200
        WHEN name ILIKE '%omeprazole%' THEN 150
        WHEN name ILIKE '%metformin%' THEN 300
        WHEN name ILIKE '%amlodipine%' THEN 250
        ELSE 100
    END,
    reorder_level = CASE 
        WHEN name ILIKE '%paracetamol%' THEN 50
        WHEN name ILIKE '%amoxicillin%' THEN 20
        WHEN name ILIKE '%omeprazole%' THEN 15
        WHEN name ILIKE '%metformin%' THEN 30
        WHEN name ILIKE '%amlodipine%' THEN 25
        ELSE 10
    END,
    cost_price = CASE 
        WHEN name ILIKE '%paracetamol%' THEN 2.50
        WHEN name ILIKE '%amoxicillin%' THEN 15.00
        WHEN name ILIKE '%omeprazole%' THEN 8.00
        WHEN name ILIKE '%metformin%' THEN 3.00
        WHEN name ILIKE '%amlodipine%' THEN 5.00
        ELSE 10.00
    END,
    selling_price = CASE 
        WHEN name ILIKE '%paracetamol%' THEN 5.00
        WHEN name ILIKE '%amoxicillin%' THEN 25.00
        WHEN name ILIKE '%omeprazole%' THEN 15.00
        WHEN name ILIKE '%metformin%' THEN 6.00
        WHEN name ILIKE '%amlodipine%' THEN 10.00
        ELSE 20.00
    END
WHERE current_stock IS NULL OR current_stock = 0;