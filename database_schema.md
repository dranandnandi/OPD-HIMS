# Database Schema

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

## Tables Overview

This database follows a clinic-based multi-tenant architecture where:
- **Organizations** = Abstract organizational units (newly added)
- **Clinic Settings** = Actual clinic/medical practice entities
- **Profiles** = User accounts linked to clinics and organizations

## Key Tables

### Core Organization & User Management
- `organizations` - Abstract organizational entities
- `clinic_settings` - Actual clinic/medical practice settings
- `profiles` - User profiles linked to both clinics and organizations
- `roles` - User role definitions

### Patient Management
- `patients` - Patient records
- `visits` - Patient visits/consultations
- `appointments` - Appointment scheduling

### Medical Records
- `diagnoses` - Medical diagnoses per visit
- `symptoms` - Symptoms recorded per visit
- `prescriptions` - Medication prescriptions
- `tests_ordered` - Laboratory/diagnostic tests ordered
- `test_results` - Test results and reports

### Pharmacy & Inventory
- `medicines_master` - Master medicine catalog
- `pharmacy_inward_receipts` - Medicine purchase receipts
- `pharmacy_inward_items` - Individual items in purchase receipts
- `pharmacy_dispensed_items` - Medicines dispensed to patients
- `stock_movement_log` - Stock movement tracking
- `stock_alerts` - Low stock and expiry alerts
- `suppliers` - Medicine suppliers

### Billing
- `bills` - Patient bills
- `bill_items` - Individual bill line items

### Pricing
- `clinic_medicine_prices` - Medicine prices per clinic
- `clinic_test_prices` - Test prices per clinic

### Communication
- `sent_messages_log` - WhatsApp/SMS message logs

### OCR & Document Processing
- `ocr_uploads` - Uploaded documents for OCR
- `ocr_results` - OCR processing results

---

## Full Schema

```sql
CREATE TABLE public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  doctor_id uuid,
  appointment_date timestamp with time zone NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'Scheduled'::appointment_status_enum CHECK (status = ANY (ARRAY['Scheduled'::appointment_status_enum, 'Confirmed'::appointment_status_enum, 'In_progress'::appointment_status_enum, 'Completed'::appointment_status_enum, 'Cancelled'::appointment_status_enum, 'No_show'::appointment_status_enum])),
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  duration integer,
  appointment_type USER-DEFINED DEFAULT 'Consultation'::appointment_type_enum,
  updated_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT appointments_pkey PRIMARY KEY (id),
  CONSTRAINT appointments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.profiles(id),
  CONSTRAINT appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id),
  CONSTRAINT appointments_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.bill_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  item_type USER-DEFINED DEFAULT 'other'::bill_item_type_enum,
  total_price numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  tax numeric DEFAULT 0,
  clinic_id uuid,
  CONSTRAINT bill_items_pkey PRIMARY KEY (id),
  CONSTRAINT bill_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT bill_items_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.bills(id)
);

CREATE TABLE public.bills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  bill_date timestamp with time zone DEFAULT now(),
  visit_id uuid,
  bill_number text UNIQUE,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric DEFAULT (total_amount - paid_amount),
  status USER-DEFINED NOT NULL DEFAULT 'pending'::bill_payment_status_enum,
  notes text,
  payment_method text,
  clinic_id uuid,
  CONSTRAINT bills_pkey PRIMARY KEY (id),
  CONSTRAINT bills_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT bills_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT bills_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id)
);

CREATE TABLE public.clinic_medicine_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  medicine_id uuid NOT NULL,
  selling_price numeric NOT NULL CHECK (selling_price >= 0::numeric),
  cost_price numeric NOT NULL CHECK (cost_price >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT clinic_medicine_prices_pkey PRIMARY KEY (id),
  CONSTRAINT clinic_medicine_prices_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT clinic_medicine_prices_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id)
);

CREATE TABLE public.clinic_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_name text NOT NULL,
  address text,
  phone text,
  email text,
  logo_url text,
  appointment_config jsonb,
  consultation_fee numeric,
  updated_at timestamp with time zone DEFAULT now(),
  website text,
  registration_number text,
  tax_id text,
  follow_up_fee numeric,
  emergency_fee numeric,
  appointment_duration integer,
  working_hours jsonb,
  currency text,
  timezone text,
  created_at timestamp with time zone DEFAULT now(),
  enable_manual_whatsapp_send boolean DEFAULT true,
  enable_blueticks_api_send boolean DEFAULT false,
  enable_ai_review_suggestion boolean DEFAULT true,
  enable_simple_thank_you boolean DEFAULT true,
  enable_ai_thank_you boolean DEFAULT true,
  gmb_link text,
  blueticks_api_key text,
  enable_gmb_link_only boolean DEFAULT true,
  CONSTRAINT clinic_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.clinic_test_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  test_id uuid NOT NULL,
  price numeric NOT NULL CHECK (price >= 0::numeric),
  cost numeric NOT NULL CHECK (cost >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT clinic_test_prices_pkey PRIMARY KEY (id),
  CONSTRAINT clinic_test_prices_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT clinic_test_prices_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests_master(id)
);

CREATE TABLE public.diagnoses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  name text NOT NULL,
  icd10_code text,
  created_at timestamp with time zone DEFAULT now(),
  is_primary boolean DEFAULT false,
  notes text,
  clinic_id uuid,
  CONSTRAINT diagnoses_pkey PRIMARY KEY (id),
  CONSTRAINT diagnoses_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT diagnoses_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id)
);

CREATE TABLE public.medicines_master (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  generic_name text,
  unit text,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  brand_name text,
  category USER-DEFINED,
  dosage_form USER-DEFINED,
  strength text,
  manufacturer text,
  side_effects ARRAY,
  contraindications ARRAY,
  is_active boolean DEFAULT true,
  current_stock integer DEFAULT 0,
  reorder_level integer DEFAULT 0,
  batch_number text,
  expiry_date date,
  clinic_id uuid NOT NULL,
  CONSTRAINT medicines_master_pkey PRIMARY KEY (id),
  CONSTRAINT medicines_master_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.ocr_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ocr_upload_id uuid NOT NULL,
  raw_text text,
  extracted_data jsonb,
  processed_at timestamp with time zone DEFAULT now(),
  status USER-DEFINED NOT NULL DEFAULT 'success'::ocr_result_status_enum CHECK (status = ANY (ARRAY['success'::ocr_result_status_enum, 'partial'::ocr_result_status_enum, 'failed'::ocr_result_status_enum])),
  created_at timestamp with time zone DEFAULT now(),
  confidence numeric,
  processing_time integer,
  cleaned_medical_text text,
  validation_report jsonb,
  clinic_id uuid,
  CONSTRAINT ocr_results_pkey PRIMARY KEY (id),
  CONSTRAINT ocr_results_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT ocr_results_ocr_upload_id_fkey FOREIGN KEY (ocr_upload_id) REFERENCES public.ocr_uploads(id)
);

CREATE TABLE public.ocr_uploads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid,
  visit_id uuid,
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  status USER-DEFINED NOT NULL DEFAULT 'uploaded'::ocr_upload_status_enum CHECK (status = ANY (ARRAY['uploaded'::ocr_upload_status_enum, 'processing'::ocr_upload_status_enum, 'completed'::ocr_upload_status_enum, 'failed'::ocr_upload_status_enum])),
  file_size integer,
  mime_type text,
  processed_at timestamp with time zone,
  clinic_id uuid,
  CONSTRAINT ocr_uploads_pkey PRIMARY KEY (id),
  CONSTRAINT ocr_uploads_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id),
  CONSTRAINT ocr_uploads_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT ocr_uploads_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id),
  CONSTRAINT ocr_uploads_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id)
);

CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  departments ARRAY DEFAULT ARRAY[]::text[],
  advisory_types ARRAY DEFAULT ARRAY['consultation'::text, 'follow-up'::text, 'emergency'::text],
  round_types ARRAY DEFAULT ARRAY['morning'::text, 'evening'::text],
  follow_up_types ARRAY DEFAULT ARRAY['7-days'::text, '15-days'::text, '30-days'::text],
  max_users integer DEFAULT 50,
  current_users integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);

CREATE TABLE public.patients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  age integer,
  gender USER-DEFINED CHECK (gender = ANY (ARRAY['male'::gender_enum, 'female'::gender_enum, 'other'::gender_enum])),
  address text,
  emergency_contact text,
  blood_group text,
  allergies ARRAY,
  created_at timestamp with time zone DEFAULT now(),
  last_visit timestamp with time zone,
  referred_by text,
  clinic_id uuid,
  CONSTRAINT patients_pkey PRIMARY KEY (id),
  CONSTRAINT patients_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.pharmacy_dispensed_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid,
  prescription_id uuid,
  medicine_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  dispensed_by uuid,
  dispense_date timestamp with time zone NOT NULL DEFAULT now(),
  selling_price_at_dispense numeric CHECK (selling_price_at_dispense >= 0::numeric),
  total_selling_price numeric DEFAULT ((quantity)::numeric * selling_price_at_dispense),
  batch_number text,
  created_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT pharmacy_dispensed_items_pkey PRIMARY KEY (id),
  CONSTRAINT pharmacy_dispensed_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT pharmacy_dispensed_items_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT pharmacy_dispensed_items_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id),
  CONSTRAINT pharmacy_dispensed_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id),
  CONSTRAINT pharmacy_dispensed_items_dispensed_by_fkey FOREIGN KEY (dispensed_by) REFERENCES public.profiles(id)
);

CREATE TABLE public.pharmacy_inward_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  receipt_id uuid,
  medicine_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost_price numeric NOT NULL CHECK (unit_cost_price >= 0::numeric),
  total_cost_price numeric DEFAULT ((quantity)::numeric * unit_cost_price),
  batch_number text,
  expiry_date date,
  created_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT pharmacy_inward_items_pkey PRIMARY KEY (id),
  CONSTRAINT pharmacy_inward_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.pharmacy_inward_receipts(id),
  CONSTRAINT pharmacy_inward_items_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT pharmacy_inward_items_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id)
);

CREATE TABLE public.pharmacy_inward_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  supplier_id uuid,
  invoice_number text UNIQUE,
  receipt_date timestamp with time zone NOT NULL DEFAULT now(),
  total_amount numeric DEFAULT 0,
  uploaded_by uuid,
  invoice_file_url text,
  status USER-DEFINED DEFAULT 'uploaded'::inward_receipt_status_enum,
  remarks text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT pharmacy_inward_receipts_pkey PRIMARY KEY (id),
  CONSTRAINT pharmacy_inward_receipts_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT pharmacy_inward_receipts_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id),
  CONSTRAINT pharmacy_inward_receipts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id)
);

CREATE TABLE public.prescriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  medicine_id uuid,
  medicine text NOT NULL,
  dosage text,
  frequency text,
  duration text,
  instructions text,
  created_at timestamp with time zone DEFAULT now(),
  quantity integer,
  refills integer,
  clinic_id uuid,
  CONSTRAINT prescriptions_pkey PRIMARY KEY (id),
  CONSTRAINT prescriptions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT prescriptions_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id),
  CONSTRAINT prescriptions_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL UNIQUE,
  name text,
  role_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  old_id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id uuid,
  user_id uuid DEFAULT auth.uid(),
  phone text,
  specialization text,
  qualification text,
  registration_no text,
  is_active boolean DEFAULT true,
  updated_at timestamp with time zone DEFAULT now(),
  consultation_fee numeric CHECK (consultation_fee >= 0::numeric),
  follow_up_fee numeric CHECK (follow_up_fee >= 0::numeric),
  emergency_fee numeric CHECK (emergency_fee >= 0::numeric),
  role_name text,
  permissions ARRAY DEFAULT '{}'::text[],
  doctor_availability jsonb,
  is_open_for_consultation boolean DEFAULT false,
  organization_id uuid,
  auth_id uuid,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT profiles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT profiles_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id),
  CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);

CREATE TABLE public.roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  permissions ARRAY DEFAULT '{}'::text[],
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sent_messages_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  visit_id uuid,
  message_type text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  message_content text NOT NULL,
  status text NOT NULL DEFAULT 'sent'::text,
  delivery_method text NOT NULL,
  error_details text,
  sent_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT sent_messages_log_pkey PRIMARY KEY (id),
  CONSTRAINT sent_messages_log_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id),
  CONSTRAINT sent_messages_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.profiles(id),
  CONSTRAINT sent_messages_log_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT sent_messages_log_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id)
);

CREATE TABLE public.stock_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id uuid,
  alert_type USER-DEFINED NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_resolved boolean DEFAULT false,
  clinic_id uuid,
  CONSTRAINT stock_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT fk_medicine FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id),
  CONSTRAINT stock_alerts_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id),
  CONSTRAINT stock_alerts_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.stock_movement_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  medicine_id uuid,
  movement_type USER-DEFINED NOT NULL,
  quantity_change integer NOT NULL,
  new_stock_level integer NOT NULL CHECK (new_stock_level >= 0),
  reference_id uuid,
  reference_type text,
  moved_by uuid,
  movement_date timestamp with time zone NOT NULL DEFAULT now(),
  remarks text,
  created_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT stock_movement_log_pkey PRIMARY KEY (id),
  CONSTRAINT stock_movement_log_moved_by_fkey FOREIGN KEY (moved_by) REFERENCES public.profiles(id),
  CONSTRAINT stock_movement_log_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT stock_movement_log_medicine_id_fkey FOREIGN KEY (medicine_id) REFERENCES public.medicines_master(id)
);

CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  contact_person text,
  phone text,
  email text,
  address text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  clinic_id uuid,
  CONSTRAINT suppliers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.symptoms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  severity USER-DEFINED,
  duration text,
  notes text,
  clinic_id uuid,
  CONSTRAINT symptoms_pkey PRIMARY KEY (id),
  CONSTRAINT symptoms_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT symptoms_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.test_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  test_ordered_id uuid NOT NULL,
  result text,
  result_json jsonb,
  report_url text,
  result_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  normal_range text,
  is_abnormal boolean DEFAULT false,
  visit_id uuid,
  clinic_id uuid,
  CONSTRAINT test_results_pkey PRIMARY KEY (id),
  CONSTRAINT test_results_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT test_results_test_ordered_id_fkey FOREIGN KEY (test_ordered_id) REFERENCES public.tests_ordered(id),
  CONSTRAINT test_results_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id)
);

CREATE TABLE public.tests_master (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  category USER-DEFINED,
  type USER-DEFINED DEFAULT 'lab'::test_type_enum,
  normal_range text,
  units text,
  preparation_instructions text,
  is_active boolean DEFAULT true,
  CONSTRAINT tests_master_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tests_ordered (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL,
  test_id uuid,
  testName text NOT NULL,
  notes text,
  ordered_at timestamp with time zone DEFAULT now(),
  test_type USER-DEFINED DEFAULT 'lab'::test_type_enum,
  instructions text,
  urgency USER-DEFINED DEFAULT 'routine'::test_urgency_enum,
  status USER-DEFINED DEFAULT 'ordered'::test_status_enum,
  ordered_date timestamp with time zone DEFAULT now(),
  expected_date timestamp with time zone,
  clinic_id uuid,
  CONSTRAINT tests_ordered_pkey PRIMARY KEY (id),
  CONSTRAINT tests_ordered_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.visits(id),
  CONSTRAINT tests_ordered_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT tests_ordered_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests_master(id)
);

CREATE TABLE public.visits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  date timestamp with time zone DEFAULT now(),
  chief_complaint text,
  symptoms ARRAY,
  vitals jsonb,
  diagnosis ARRAY,
  prescriptions ARRAY,
  advice ARRAY,
  follow_up_date timestamp with time zone,
  doctor_notes text,
  case_image_url text,
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  doctor_id uuid,
  visit_date timestamp with time zone DEFAULT now(),
  appointment_id uuid,
  clinic_id uuid,
  CONSTRAINT visits_pkey PRIMARY KEY (id),
  CONSTRAINT visits_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinic_settings(id),
  CONSTRAINT visits_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id),
  CONSTRAINT visits_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.profiles(id),
  CONSTRAINT visits_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id)
);
```
