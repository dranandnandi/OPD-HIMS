import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Debug: Log environment variables only in development
if (import.meta.env.DEV) {
  console.log('=== SUPABASE ENV DEBUG ===');
  console.log('VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL);
  console.log('VITE_SUPABASE_ANON_KEY:', import.meta.env.VITE_SUPABASE_ANON_KEY);
  console.log('supabaseUrl:', supabaseUrl);
  console.log('supabaseAnonKey:', supabaseAnonKey ? 'SET (length: ' + supabaseAnonKey.length + ')' : 'NOT SET');
  console.log('supabase client will be:', supabaseUrl && supabaseAnonKey ? 'CREATED' : 'NULL');
  console.log('=========================');
}

if (!supabaseUrl || !supabaseAnonKey) {
  if (import.meta.env.DEV) {
    console.error('Missing Supabase environment variables. Please check your .env file.');
    console.error('VITE_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? 'Set' : 'Missing');
  }
}

// Database type definitions
export interface Database {
  public: {
    Tables: {
      roles: {
        Row: DatabaseRole;
        Insert: Omit<DatabaseRole, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseRole, 'id' | 'created_at'>>;
      };
      profiles: {
        Row: DatabaseProfile;
        Insert: Omit<DatabaseProfile, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseProfile, 'id' | 'created_at' | 'updated_at'>>;
      };
      patients: {
        Row: DatabasePatient;
        Insert: Omit<DatabasePatient, 'id' | 'created_at' | 'last_visit'>;
        Update: Partial<Omit<DatabasePatient, 'id' | 'created_at' | 'last_visit'>>;
      };
      appointments: {
        Row: DatabaseAppointment;
        Insert: Omit<DatabaseAppointment, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseAppointment, 'id' | 'created_at' | 'updated_at'>>;
      };
      visits: {
        Row: DatabaseVisit;
        Insert: Omit<DatabaseVisit, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseVisit, 'id' | 'created_at' | 'updated_at'>>;
      };
      symptoms: {
        Row: DatabaseSymptom;
        Insert: Omit<DatabaseSymptom, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseSymptom, 'id' | 'created_at'>>;
      };
      diagnoses: {
        Row: DatabaseDiagnosis;
        Insert: Omit<DatabaseDiagnosis, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseDiagnosis, 'id' | 'created_at'>>;
      };
      prescriptions: {
        Row: DatabasePrescription;
        Insert: Omit<DatabasePrescription, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabasePrescription, 'id' | 'created_at'>>;
      };
      tests_ordered: {
        Row: DatabaseTestOrdered;
        Insert: Omit<DatabaseTestOrdered, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseTestOrdered, 'id' | 'created_at'>>;
      };
      test_results: {
        Row: DatabaseTestResult;
        Insert: Omit<DatabaseTestResult, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseTestResult, 'id' | 'created_at'>>;
      };
      bills: {
        Row: DatabaseBill;
        Insert: Omit<DatabaseBill, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseBill, 'id' | 'created_at' | 'updated_at'>>;
      };
      bill_items: {
        Row: DatabaseBillItem;
        Insert: Omit<DatabaseBillItem, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseBillItem, 'id' | 'created_at'>>;
      };
      payment_records: {
        Row: DatabasePaymentRecord;
        Insert: Omit<DatabasePaymentRecord, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabasePaymentRecord, 'id' | 'created_at'>>;
      };
      ocr_uploads: {
        Row: DatabaseOcrUpload;
        Insert: Omit<DatabaseOcrUpload, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseOcrUpload, 'id' | 'created_at'>>;
      };
      ocr_results: {
        Row: DatabaseOcrResult;
        Insert: Omit<DatabaseOcrResult, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseOcrResult, 'id' | 'created_at'>>;
      };
      clinic_settings: {
        Row: DatabaseClinicSetting;
        Insert: Omit<DatabaseClinicSetting, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseClinicSetting, 'id' | 'created_at' | 'updated_at'>>;
      };
      medicines_master: {
        Row: DatabaseMedicineMaster;
        Insert: Omit<DatabaseMedicineMaster, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseMedicineMaster, 'id' | 'created_at' | 'updated_at'>>;
      };
      tests_master: {
        Row: DatabaseTestMaster;
        Insert: Omit<DatabaseTestMaster, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseTestMaster, 'id' | 'created_at' | 'updated_at'>>;
      };
      suppliers: {
        Row: DatabaseSupplier;
        Insert: Omit<DatabaseSupplier, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseSupplier, 'id' | 'created_at' | 'updated_at'>>;
      };
      pharmacy_inward_receipts: {
        Row: DatabasePharmacyInwardReceipt;
        Insert: Omit<DatabasePharmacyInwardReceipt, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabasePharmacyInwardReceipt, 'id' | 'created_at' | 'updated_at'>>;
      };
      pharmacy_inward_items: {
        Row: DatabasePharmacyInwardItem;
        Insert: Omit<DatabasePharmacyInwardItem, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabasePharmacyInwardItem, 'id' | 'created_at'>>;
      };
      pharmacy_dispensed_items: {
        Row: DatabasePharmacyDispensedItem;
        Insert: Omit<DatabasePharmacyDispensedItem, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabasePharmacyDispensedItem, 'id' | 'created_at'>>;
      };
      stock_movement_log: {
        Row: DatabaseStockMovementLog;
        Insert: Omit<DatabaseStockMovementLog, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseStockMovementLog, 'id' | 'created_at'>>;
      };
      clinic_medicine_prices: {
        Row: DatabaseClinicMedicinePrice;
        Insert: Omit<DatabaseClinicMedicinePrice, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseClinicMedicinePrice, 'id' | 'created_at' | 'updated_at'>>;
      };
      clinic_test_prices: {
        Row: DatabaseClinicTestPrice;
        Insert: Omit<DatabaseClinicTestPrice, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<DatabaseClinicTestPrice, 'id' | 'created_at' | 'updated_at'>>;
      };
      sent_messages_log: {
        Row: DatabaseSentMessageLog;
        Insert: Omit<DatabaseSentMessageLog, 'id' | 'created_at'>;
        Update: Partial<Omit<DatabaseSentMessageLog, 'id' | 'created_at'>>;
      };
    };
  };
}

let supabase: ReturnType<typeof createClient<Database>> | null = null;

try {
  if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        debug: true,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: true
      },
      global: {
        headers: {
          'X-Client-Info': 'opd-management-app'
        }
      }
    });
  } else {
    supabase = null;
  }
} catch (error) {
  if (import.meta.env.DEV) {
    console.error('Failed to initialize Supabase client:', error);
  }
  supabase = null;
}

export { supabase };

// Database interface definitions
export interface DatabaseRole {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  created_at: string;
}

export interface DatabaseProfile {
  id: string;
  user_id?: string;
  role_id: string;
  clinic_id?: string;
  name: string;
  email: string;
  phone?: string;
  specialization?: string;
  qualification?: string;
  registration_no?: string;
  role_name: string;
  permissions: string[];
  consultation_fee?: number;
  follow_up_fee?: number;
  emergency_fee?: number;
  is_active: boolean;
  is_open_for_consultation: boolean;
  doctor_availability?: {
    [key: string]: {
      isOpen: boolean;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    };
  };
  created_at: string;
  updated_at: string;
}

export interface DatabasePatient {
  id: string;
  name: string;
  phone: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  address: string;
  emergency_contact: string;
  blood_group?: string;
  allergies?: string[];
  created_at: string;
  last_visit?: string;
  clinic_id?: string;
}

export interface DatabaseAppointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  appointment_date: string;
  duration: number;
  status: 'Scheduled' | 'Confirmed' | 'In_Progress' | 'Completed' | 'Cancelled' | 'No_Show';
  appointment_type: 'Consultation' | 'Follow_Up' | 'Emergency' | 'Routine_Checkup';
  notes?: string;
  created_at: string;
  updated_at: string;
  clinic_id?: string;
}

export interface DatabaseVisit {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  appointment_id?: string;
  date: string;
  chief_complaint?: string;
  vitals?: {
    temperature?: number;
    bloodPressure?: string;
    pulse?: number;
    weight?: number;
    height?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
  };
  advice?: string[];
  follow_up_date?: string;
  doctor_notes?: string;
  case_image_url?: string;
  created_at: string;
  updated_at: string;
  clinic_id?: string;
  clinic_settings?: any; // For joins
}

export interface DatabaseSymptom {
  id: string;
  visit_id: string;
  name: string;
  severity?: 'mild' | 'moderate' | 'severe';
  duration?: string;
  notes?: string;
  created_at: string;
}

export interface DatabaseDiagnosis {
  id: string;
  visit_id: string;
  name: string;
  icd10_code?: string;
  is_primary: boolean;
  notes?: string;
  created_at: string;
}

export interface DatabasePrescription {
  id: string;
  visit_id: string;
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  quantity?: number;
  refills?: number;
  created_at: string;
}

export interface DatabaseTestOrdered {
  id: string;
  visit_id: string;
  test_name: string;
  test_type: 'lab' | 'radiology' | 'procedure' | 'other';
  instructions?: string;
  urgency: 'routine' | 'urgent' | 'stat';
  status: 'ordered' | 'sample_collected' | 'in_progress' | 'completed' | 'cancelled';
  ordered_date: string;
  expected_date?: string;
  created_at: string;
}

export interface DatabaseTestResult {
  id: string;
  test_ordered_id: string;
  visit_id: string;
  result: string;
  normal_range?: string;
  is_abnormal: boolean;
  result_date: string;
  report_url?: string;
  notes?: string;
  created_at: string;
}

export interface DatabaseBill {
  id: string;
  visit_id: string | null;
  patient_id: string;
  bill_number: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: 'pending' | 'partial' | 'paid' | 'overdue';
  payment_method?: 'cash' | 'card' | 'upi' | 'cheque' | 'online';
  bill_date: string;
  due_date?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  clinic_id?: string;
}

export interface DatabaseBillItem {
  id: string;
  bill_id: string;
  item_type: 'consultation' | 'procedure' | 'medicine' | 'test' | 'other';
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  discount?: number;
  tax?: number;
  created_at: string;
  clinic_id?: string;
}

export interface DatabasePaymentRecord {
  id: string;
  bill_id: string;
  payment_date: string;
  payment_method: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
  amount: number;
  card_reference?: string;
  cheque_number?: string;
  bank_name?: string;
  notes?: string;
  received_by: string;
  clinic_id: string;
  created_at: string;
}

export interface DatabaseOcrUpload {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  created_at: string;
  processed_at?: string;
}

export interface DatabaseOcrResult {
  id: string;
  ocr_upload_id: string;
  raw_text: string;
  cleaned_medical_text?: string;
  extracted_data: {
    symptoms: string[];
    vitals: {
      temperature?: string;
      bloodPressure?: string;
      pulse?: string;
      weight?: string;
      height?: string;
      respiratoryRate?: string;
      oxygenSaturation?: string;
    };
    diagnoses: string[];
    prescriptions: Array<{
      medicine: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions: string;
    }>;
    testsOrdered: string[];
    advice: string[];
    chiefComplaint?: string;
    doctorNotes?: string;
  };
  confidence: number;
  processing_time: number;
  created_at: string;
  validation_report?: any;
}

export interface DatabaseClinicSetting {
  id: string;
  clinic_name: string;
  address: string;
  phone: string;
  email?: string;
  website?: string;
  logo_url?: string;
  registration_number?: string;
  tax_id?: string;
  consultation_fee: number;
  follow_up_fee: number;
  emergency_fee: number;
  appointment_duration: number;
  working_hours: {
    [key: string]: {
      isOpen: boolean;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    };
  };
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  blueticks_api_key?: string;
  enable_manual_whatsapp_send?: boolean;
  enable_blueticks_api_send?: boolean;
  enable_ai_review_suggestion?: boolean;
  enable_simple_thank_you?: boolean;
  enable_ai_thank_you?: boolean;
  enable_gmb_link_only?: boolean;
  gmb_link?: string;
}

export interface DatabaseMedicineMaster {
  id: string;
  name: string;
  generic_name?: string;
  brand_name?: string;
  category: string;
  dosage_form: string;
  strength?: string;
  manufacturer?: string;
  description?: string;
  side_effects?: string[];
  contraindications?: string[];
  current_stock: number;
  reorder_level: number;
  batch_number?: string;
  expiry_date?: string;
  clinic_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatabaseTestMaster {
  id: string;
  name: string;
  category: string;
  type: 'lab' | 'radiology' | 'procedure' | 'other';
  normal_range?: string;
  units?: string;
  description?: string;
  preparation_instructions?: string;
  clinic_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatabaseSupplier {
  id: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatabasePharmacyInwardReceipt {
  id: string;
  supplier_id?: string;
  invoice_number?: string;
  receipt_date: string;
  total_amount: number;
  uploaded_by: string;
  invoice_file_url?: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  remarks?: string;
  created_at: string;
  clinic_id?: string;
  updated_at: string;
}

export interface DatabasePharmacyInwardItem {
  id: string;
  receipt_id: string;
  medicine_id: string;
  quantity: number;
  unit_cost_price: number;
  total_cost_price: number;
  batch_number?: string;
  expiry_date?: string;
  clinic_id?: string;
  created_at: string;
}

export interface DatabasePharmacyDispensedItem {
  id: string;
  visit_id: string;
  prescription_id?: string;
  medicine_id: string;
  quantity: number;
  dispensed_by: string;
  dispense_date: string;
  selling_price_at_dispense?: number;
  total_selling_price?: number;
  batch_number?: string;
  clinic_id?: string;
  created_at: string;
}

export interface DatabaseStockMovementLog {
  id: string;
  medicine_id: string;
  movement_type: 'inward' | 'outward' | 'adjustment' | 'return';
  quantity_change: number;
  new_stock_level: number;
  reference_id?: string;
  reference_type?: string;
  moved_by: string;
  movement_date: string;
  clinic_id: string;
  remarks?: string;
  created_at: string;
}

export interface DatabaseClinicMedicinePrice {
  id: string;
  clinic_id: string;
  medicine_id: string;
  selling_price: number;
  cost_price: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseClinicTestPrice {
  id: string;
  clinic_id: string;
  test_id: string;
  price: number;
  cost: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseSentMessageLog {
  id: string;
  patient_id: string;
  visit_id?: string;
  message_type: string;
  sent_at: string;
  message_content: string;
  status: 'sent' | 'failed' | 'pending';
  delivery_method: 'manual_whatsapp' | 'blueticks_api';
  error_details?: string;
  sent_by?: string;
  created_at: string;
}