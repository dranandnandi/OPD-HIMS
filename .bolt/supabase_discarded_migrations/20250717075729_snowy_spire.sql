```sql
-- Create roles table
CREATE TABLE public.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name text NOT NULL UNIQUE,
    description text,
    created_at timestamp with time zone DEFAULT now()
);

-- Insert default roles
INSERT INTO public.roles (role_name, description) VALUES
('admin', 'Administrator with full access'),
('doctor', 'Medical doctor with patient and visit management access'),
('receptionist', 'Receptionist with patient registration and appointment management access');

-- Create profiles table (linked to auth.users)
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL UNIQUE,
    full_name text,
    role_id uuid REFERENCES public.roles(id),
    created_at timestamp with time zone DEFAULT now()
);

-- Set up RLS for profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to view profiles" ON public.profiles
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert their own profile" ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow authenticated users to update their own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id);


-- Create patients table
CREATE TABLE public.patients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text NOT NULL UNIQUE,
    age integer,
    gender text CHECK (gender IN ('male', 'female', 'other')),
    address text,
    emergency_contact text,
    blood_group text,
    allergies text[],
    created_at timestamp with time zone DEFAULT now(),
    last_visit timestamp with time zone
);

-- Add indexes for common searches
CREATE INDEX idx_patients_name ON public.patients USING btree (name);
CREATE INDEX idx_patients_phone ON public.patients USING btree (phone);

-- Set up RLS for patients table
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on patients" ON public.patients
FOR ALL USING (auth.role() = 'authenticated');


-- Create appointments table
CREATE TABLE public.appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, -- Doctor can be null if not assigned
    appointment_date timestamp with time zone NOT NULL,
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

-- Add indexes for appointments
CREATE INDEX idx_appointments_patient_id ON public.appointments USING btree (patient_id);
CREATE INDEX idx_appointments_doctor_id ON public.appointments USING btree (doctor_id);
CREATE INDEX idx_appointments_date ON public.appointments USING btree (appointment_date);

-- Set up RLS for appointments table
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on appointments" ON public.appointments
FOR ALL USING (auth.role() = 'authenticated');


-- Create visits table
CREATE TABLE public.visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    visit_date timestamp with time zone NOT NULL DEFAULT now(),
    chief_complaint text,
    vitals jsonb, -- temperature, bloodPressure, pulse, weight, height
    doctor_notes text,
    follow_up_date timestamp with time zone,
    case_image_url text,
    created_at timestamp with time zone DEFAULT now()
);

-- Add indexes for visits
CREATE INDEX idx_visits_patient_id ON public.visits USING btree (patient_id);
CREATE INDEX idx_visits_visit_date ON public.visits USING btree (visit_date);

-- Set up RLS for visits table
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on visits" ON public.visits
FOR ALL USING (auth.role() = 'authenticated');


-- Create symptoms table
CREATE TABLE public.symptoms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    symptom_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for symptoms
CREATE INDEX idx_symptoms_visit_id ON public.symptoms USING btree (visit_id);

-- Set up RLS for symptoms table
ALTER TABLE public.symptoms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on symptoms" ON public.symptoms
FOR ALL USING (auth.role() = 'authenticated');


-- Create diagnoses table
CREATE TABLE public.diagnoses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    diagnosis_text text NOT NULL,
    icd10_code text,
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for diagnoses
CREATE INDEX idx_diagnoses_visit_id ON public.diagnoses USING btree (visit_id);

-- Set up RLS for diagnoses table
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on diagnoses" ON public.diagnoses
FOR ALL USING (auth.role() = 'authenticated');


-- Create medicines_master table
CREATE TABLE public.medicines_master (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    generic_name text,
    unit text, -- e.g., 'mg', 'ml', 'tablet', 'capsule'
    description text,
    created_at timestamp with time zone DEFAULT now()
);

-- Set up RLS for medicines_master table
ALTER TABLE public.medicines_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to view medicines_master" ON public.medicines_master
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow admin to manage medicines_master" ON public.medicines_master
FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role_id = (SELECT id FROM public.roles WHERE role_name = 'admin')));


-- Create prescriptions table
CREATE TABLE public.prescriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    medicine_id uuid REFERENCES public.medicines_master(id) ON DELETE SET NULL, -- Optional link to master
    medicine_name text NOT NULL, -- Store name directly for flexibility
    dosage text,
    frequency text, -- e.g., 'OD', 'BD', 'TID', 'QID', 'PRN'
    duration text,
    instructions text,
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for prescriptions
CREATE INDEX idx_prescriptions_visit_id ON public.prescriptions USING btree (visit_id);

-- Set up RLS for prescriptions table
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on prescriptions" ON public.prescriptions
FOR ALL USING (auth.role() = 'authenticated');


-- Create tests_master table
CREATE TABLE public.tests_master (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    description text,
    price numeric,
    created_at timestamp with time zone DEFAULT now()
);

-- Set up RLS for tests_master table
ALTER TABLE public.tests_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to view tests_master" ON public.tests_master
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow admin to manage tests_master" ON public.tests_master
FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role_id = (SELECT id FROM public.roles WHERE role_name = 'admin')));


-- Create tests_ordered table
CREATE TABLE public.tests_ordered (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    test_id uuid REFERENCES public.tests_master(id) ON DELETE SET NULL, -- Optional link to master
    test_name text NOT NULL, -- Store name directly for flexibility
    notes text,
    ordered_at timestamp with time zone DEFAULT now()
);

-- Add index for tests_ordered
CREATE INDEX idx_tests_ordered_visit_id ON public.tests_ordered USING btree (visit_id);

-- Set up RLS for tests_ordered table
ALTER TABLE public.tests_ordered ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on tests_ordered" ON public.tests_ordered
FOR ALL USING (auth.role() = 'authenticated');


-- Create test_results table
CREATE TABLE public.test_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_ordered_id uuid NOT NULL REFERENCES public.tests_ordered(id) ON DELETE CASCADE,
    result_text text,
    result_json jsonb, -- For structured results
    report_url text, -- URL to uploaded report in storage
    result_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for test_results
CREATE INDEX idx_test_results_test_ordered_id ON public.test_results USING btree (test_ordered_id);

-- Set up RLS for test_results table
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on test_results" ON public.test_results
FOR ALL USING (auth.role() = 'authenticated');


-- Create bills table
CREATE TABLE public.bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL, -- Can be null if bill is not tied to a specific visit
    patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    bill_date timestamp with time zone NOT NULL DEFAULT now(),
    total_amount numeric NOT NULL DEFAULT 0,
    paid_amount numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partially_paid', 'cancelled')),
    created_at timestamp with time zone DEFAULT now()
);

-- Add indexes for bills
CREATE INDEX idx_bills_patient_id ON public.bills USING btree (patient_id);
CREATE INDEX idx_bills_visit_id ON public.bills USING btree (visit_id);
CREATE INDEX idx_bills_date ON public.bills USING btree (bill_date);

-- Set up RLS for bills table
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on bills" ON public.bills
FOR ALL USING (auth.role() = 'authenticated');


-- Create bill_items table
CREATE TABLE public.bill_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    item_description text NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price numeric NOT NULL DEFAULT 0,
    amount numeric NOT NULL DEFAULT 0, -- quantity * unit_price
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for bill_items
CREATE INDEX idx_bill_items_bill_id ON public.bill_items USING btree (bill_id);

-- Set up RLS for bill_items table
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on bill_items" ON public.bill_items
FOR ALL USING (auth.role() = 'authenticated');


-- Create ocr_uploads table
CREATE TABLE public.ocr_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
    visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
    file_url text NOT NULL, -- URL to the uploaded image/file in storage
    file_name text NOT NULL,
    uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploaded_at timestamp with time zone DEFAULT now(),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed'))
);

-- Add indexes for ocr_uploads
CREATE INDEX idx_ocr_uploads_patient_id ON public.ocr_uploads USING btree (patient_id);
CREATE INDEX idx_ocr_uploads_visit_id ON public.ocr_uploads USING btree (visit_id);

-- Set up RLS for ocr_uploads table
ALTER TABLE public.ocr_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on ocr_uploads" ON public.ocr_uploads
FOR ALL USING (auth.role() = 'authenticated');


-- Create ocr_results table
CREATE TABLE public.ocr_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ocr_upload_id uuid NOT NULL REFERENCES public.ocr_uploads(id) ON DELETE CASCADE,
    raw_text text,
    extracted_data_json jsonb, -- Structured data from NLP (symptoms, drugs, notes, etc.)
    processed_at timestamp with time zone DEFAULT now(),
    status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
    created_at timestamp with time zone DEFAULT now()
);

-- Add index for ocr_results
CREATE INDEX idx_ocr_results_ocr_upload_id ON public.ocr_results USING btree (ocr_upload_id);

-- Set up RLS for ocr_results table
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users on ocr_results" ON public.ocr_results
FOR ALL USING (auth.role() = 'authenticated');


-- Create clinic_settings table
CREATE TABLE public.clinic_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_name text NOT NULL,
    address text,
    phone text,
    email text,
    logo_url text,
    appointment_config jsonb,
    consultation_fee numeric,
    updated_at timestamp with time zone DEFAULT now()
);

-- Set up RLS for clinic_settings table
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to view clinic_settings" ON public.clinic_settings
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow admin to manage clinic_settings" ON public.clinic_settings
FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role_id = (SELECT id FROM public.roles WHERE role_name = 'admin')));


-- Trigger function to update patient's last_visit on new visit
CREATE OR REPLACE FUNCTION public.update_patient_last_visit()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.patients
    SET last_visit = NEW.visit_date
    WHERE id = NEW.patient_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call update_patient_last_visit function after insert on visits
CREATE TRIGGER trigger_update_patient_last_visit
AFTER INSERT ON public.visits
FOR EACH ROW
EXECUTE FUNCTION public.update_patient_last_visit();

-- Optional: Function to create a new profile for new auth users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optional: Trigger to call handle_new_user function on auth.users inserts
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

```