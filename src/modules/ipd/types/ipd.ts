// ============================================================================
// IPD domain types — mirror supabase/migrations 001–007
// ============================================================================

// --- Shared / reused OPD entities (subset of columns the IPD app touches) ---

export interface Patient {
  id: string;
  clinic_id: string | null;
  name: string;
  phone: string;
  age: number | null;
  gender: 'male' | 'female' | 'other' | null;
  address: string | null;
  blood_group: string | null;
  allergies: string[] | null;
  abha_number: string | null;
}

export interface Profile {
  id: string;
  clinic_id: string | null;
  name: string | null;
  email: string;
  role_name: string | null;
  specialization: string | null;
  permissions: string[];
  is_active: boolean | null;
}

// --- 001: Charge catalog -----------------------------------------------------

export type ServiceType =
  | 'bed' | 'consultation' | 'lab' | 'imaging' | 'procedure' | 'surgery'
  | 'pharmacy' | 'consumable' | 'implant' | 'equipment' | 'nursing' | 'misc';

export interface Department {
  id: string;
  clinic_id: string;
  code: string;
  name: string;
  type: 'clinical' | 'diagnostic' | 'support';
  is_active: boolean;
}

export interface ChargeGroup {
  id: string;
  clinic_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  path: string;
  depth: number;
  default_cost_center_id: string | null;
  is_active: boolean;
}

export interface ServiceMaster {
  id: string;
  clinic_id: string;
  service_code: string;
  name: string;
  charge_group_id: string;
  department_id: string | null;
  service_type: ServiceType;
  base_price: number;
  base_cost: number;
  tax_rate: number;
  cost_type: 'variable' | 'fixed';
  is_sharable: boolean;
  is_package_eligible: boolean;
  is_insurance_eligible: boolean;
  requires_doctor: boolean;
  external_system: 'lims' | 'ris' | null;
  external_ref: string | null;
  unit: string;
  /** template auto-offered when this service is posted (consent, OT note…) */
  document_template_id?: string | null;
  is_active: boolean;
}

export interface Payer {
  id: string;
  clinic_id: string;
  code: string | null;
  name: string;
  payer_type: 'cash' | 'tpa' | 'insurer' | 'corporate' | 'government_scheme';
  default_deduction_buffer_pct: number;
  credit_days: number;
  contact_person: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  gst_number: string | null;
  address: string | null;
  default_discount_percent: number;
  credit_limit: number;
  credit_used: number;
  billing_mode: 'standard' | 'monthly';
  is_active: boolean;
}

export interface TariffPlan {
  id: string;
  clinic_id: string;
  name: string;
  payer_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

export interface TariffRate {
  id: string;
  clinic_id: string;
  tariff_plan_id: string;
  service_id: string | null;
  charge_group_id: string | null;
  rate: number | null;
  multiplier: number | null;
}

// --- 002: Wards & beds -------------------------------------------------------

export type BedStatus =
  | 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved' | 'blocked';

export interface BedType {
  id: string;
  clinic_id: string;
  code: string;
  name: string;
  room_rent_service_id: string;
  nursing_service_id: string | null;
  rate_multiplier: number;
  is_critical_care: boolean;
  is_active: boolean;
}

export interface Ward {
  id: string;
  clinic_id: string;
  name: string;
  floor: string | null;
  ward_type: 'general' | 'private' | 'icu' | 'hdu' | 'maternity' | 'pediatric' | 'isolation';
  gender_restriction: 'male' | 'female' | null;
  is_active: boolean;
}

export interface Bed {
  id: string;
  clinic_id: string;
  ward_id: string;
  bed_number: string;
  bed_type_id: string;
  status: BedStatus;
  status_note: string | null;
  is_active: boolean;
  // joined
  ward?: Ward;
  bed_type?: BedType;
}

// --- 003: ADT ----------------------------------------------------------------

export type AdmissionStatus =
  | 'admitted' | 'discharged' | 'dama' | 'transferred_out' | 'expired' | 'cancelled';

export type AdmissionType = 'planned' | 'emergency' | 'transfer_in' | 'daycare' | 'mlc';

export interface Admission {
  id: string;
  clinic_id: string;
  admission_number: string;
  patient_id: string;
  admitting_doctor_id: string;
  treating_doctor_id: string | null;
  current_bed_id: string | null;
  admission_datetime: string;
  admission_type: AdmissionType;
  source_visit_id: string | null;
  provisional_diagnosis: string | null;
  icd10_codes: string[];
  reason_for_admission: string | null;
  payer_id: string | null;
  tariff_plan_id: string | null;
  coverage_id: string | null;
  estimated_cost: number | null;
  estimated_stay_days: number | null;
  is_mlc: boolean;
  mlc_number: string | null;
  status: AdmissionStatus;
  discharge_datetime: string | null;
  discharge_type: 'routine' | 'dama' | 'referred' | 'expired' | 'absconded' | null;
  attendant_name: string | null;
  attendant_phone: string | null;
  attendant_relation: string | null;
  notes: string | null;
  // joined
  patient?: Patient;
  admitting_doctor?: Profile;
  current_bed?: Bed;
}

export interface BedAllocation {
  id: string;
  clinic_id: string;
  admission_id: string;
  bed_id: string;
  from_datetime: string;
  to_datetime: string | null;
  reason: 'admission' | 'upgrade' | 'downgrade' | 'icu_shift' | 'stepdown' | 'patient_request' | 'operational';
  rate_snapshot: number | null;
  notes?: string | null;
  // joined
  bed?: Bed;
  creator?: { name: string | null } | null;
}

export interface DischargeChecklist {
  id: string;
  clinic_id: string;
  admission_id: string;
  bill_cleared: boolean;
  summary_signed: boolean;
  meds_reconciled: boolean;
  implants_documented: boolean;
  followup_booked: boolean;
  cleared_by: string | null;
  cleared_at: string | null;
}

// --- 004: Orders ---------------------------------------------------------------

export interface IpdOrder {
  id: string;
  clinic_id: string;
  admission_id: string;
  ordered_by: string;
  order_datetime: string;
  priority: 'routine' | 'urgent' | 'stat';
  clinical_notes: string | null;
  status: 'placed' | 'in_progress' | 'completed' | 'cancelled';
  treatment_plan_id?: string | null;
  items?: IpdOrderItem[];
}

export interface IpdOrderItem {
  id: string;
  clinic_id: string;
  order_id: string;
  admission_id: string;
  service_id: string;
  quantity: number;
  performing_doctor_id: string | null;
  scheduled_for: string | null;
  status: 'pending' | 'sent_external' | 'resulted' | 'done' | 'cancelled';
  external_order_ref: string | null;
  result_ref: Record<string, unknown> | null;
  charge_posting_id: string | null;
  cancelled_reason?: string | null;
  created_at?: string;
  // joined
  service?: ServiceMaster;
  parent_order?: Pick<IpdOrder, 'id' | 'order_datetime' | 'priority' | 'clinical_notes' | 'status'> & {
    ordered_by?: string;
    treatment_plan_id?: string | null;
    doctor?: { name: string | null } | null;
  };
  reports?: IpdReport[];
}

// --- 025: Treatment plan, consultations, diet, reports -------------------------

export interface TreatmentPlan {
  id: string;
  clinic_id: string;
  admission_id: string;
  plan_date: string;          // yyyy-MM-dd
  recorded_at: string;
  doctor_id: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  advice: string | null;
  voice_transcript: string | null;
  status: 'active' | 'superseded';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  doctor?: { id: string; name: string | null } | null;
}

export interface IpdConsultation {
  id: string;
  clinic_id: string;
  admission_id: string;
  treatment_plan_id: string | null;
  specialty: string | null;
  doctor_id: string | null;
  external_doctor_name: string | null;
  reason: string;
  urgency: 'routine' | 'urgent' | 'stat';
  status: 'requested' | 'seen' | 'cancelled';
  opinion: string | null;
  charge_posting_id: string | null;
  requested_by: string | null;
  requested_at: string;
  seen_by: string | null;
  seen_at: string | null;
  cancelled_reason: string | null;
  // joined
  doctor?: { id: string; name: string | null } | null;
}

export type DietType =
  | 'normal' | 'soft' | 'liquid' | 'semi_solid' | 'diabetic' | 'renal' | 'cardiac'
  | 'low_salt' | 'high_protein' | 'low_fat' | 'bland' | 'pediatric' | 'npo' | 'other';

export type DietRoute = 'oral' | 'ryles_tube' | 'peg' | 'npo' | 'tpn';

export type MealSlot =
  | 'early_morning' | 'breakfast' | 'mid_morning' | 'lunch' | 'evening' | 'dinner' | 'bedtime';

export interface DietOrder {
  id: string;
  clinic_id: string;
  admission_id: string;
  treatment_plan_id: string | null;
  diet_type: DietType;
  route: DietRoute;
  calories_kcal: number | null;
  protein_g: number | null;
  fluid_restriction_ml: number | null;
  special_instructions: string | null;
  restrictions: string | null;
  start_date: string;
  end_date: string | null;
  status: 'active' | 'stopped';
  ordered_by: string | null;
  stopped_reason: string | null;
  created_at: string;
}

export interface DietChartEntry {
  id: string;
  clinic_id: string;
  admission_id: string;
  diet_order_id: string | null;
  entry_date: string;
  meal: MealSlot;
  items: string | null;
  status: 'planned' | 'served' | 'refused' | 'withheld';
  intake_percent: number | null;
  notes: string | null;
  served_by: string | null;
  served_at: string | null;
  created_at: string;
}

export interface IpdReport {
  id: string;
  clinic_id: string;
  admission_id: string;
  order_item_id: string | null;
  report_type: 'pathology' | 'radiology' | 'cardiology' | 'other';
  title: string;
  report_date: string;
  performed_at: string | null;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  findings: string | null;
  impression: string | null;
  is_abnormal: boolean;
  status: 'filed' | 'reviewed';
  reviewed_by: string | null;
  reviewed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
  // joined
  order_item?: { id: string; service?: { name: string } | null } | null;
}

// --- 005: Nursing --------------------------------------------------------------

export interface Vitals {
  id: string;
  clinic_id: string;
  admission_id: string;
  recorded_at: string;
  recorded_by: string | null;
  temperature: number | null;
  pulse: number | null;
  resp_rate: number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  spo2: number | null;
  pain_score: number | null;
  gcs: number | null;
  blood_sugar: number | null;
  weight_kg: number | null;
  extra: Record<string, unknown>;
}

export interface NursingNote {
  id: string;
  clinic_id: string;
  admission_id: string;
  note_type: 'nursing' | 'doctor_round' | 'progress' | 'handover' | 'procedure';
  note: string;
  voice_transcript_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface NursingTask {
  id: string;
  clinic_id: string;
  admission_id: string;
  task: string;
  due_at: string | null;
  recurrence: string | null;
  status: 'pending' | 'done' | 'skipped';
  done_by: string | null;
  done_at: string | null;
  /** set when this row is one occurrence of a standing monitoring order */
  monitoring_order_id?: string | null;
  category?: 'general' | 'monitoring' | 'observation' | 'intake_output' | 'procedure';
  /** how late it may run before the alert bar calls it missed */
  grace_minutes?: number;
  // joined
  monitoring_order?: MonitoringOrder;
}

/**
 * A standing observation order — "TPR, BP every 30 min", "watch for abdominal
 * distension", "chart urine output hourly". Expanded into NursingTask
 * occurrences the way a MedicationOrder expands into schedule slots.
 */
export interface MonitoringOrder {
  id: string;
  clinic_id: string;
  admission_id: string;
  title: string;
  kind: 'vitals' | 'observation' | 'intake_output' | 'custom';
  /** vitals columns this order expects charted (kind = 'vitals') */
  fields: string[];
  interval_minutes: number;
  start_at: string;
  end_at: string | null;
  instructions: string | null;
  grace_minutes: number;
  status: 'active' | 'stopped' | 'completed';
  stopped_reason: string | null;
  ordered_by: string | null;
  created_at: string;
}

export interface IntakeOutput {
  id: string;
  clinic_id: string;
  admission_id: string;
  recorded_at: string;
  io_type: 'intake' | 'output';
  route: string;
  volume_ml: number;
  notes: string | null;
}

// --- 006: Medications / eMAR ----------------------------------------------------

export interface MedicationOrder {
  id: string;
  clinic_id: string;
  admission_id: string;
  medicine_id: string | null;
  medicine_name: string;
  dose: string | null;
  route: string | null;
  frequency_code: string;
  start_at: string;
  end_at: string | null;
  instructions: string | null;
  ordered_by: string | null;
  status: 'active' | 'held' | 'stopped' | 'completed';
  stopped_reason: string | null;
  treatment_plan_id?: string | null;
  /** HH:MM clock times this order is actually given at, as the doctor wrote it
      ("8 PM and 8 AM"). Null on legacy orders expanded from frequency defaults. */
  dose_times?: string[] | null;
  /** how late a due dose may run before the alert bar calls it missed */
  grace_minutes?: number;
}

export interface MedicationScheduleSlot {
  id: string;
  clinic_id: string;
  medication_order_id: string;
  admission_id: string;
  scheduled_at: string;
  status: 'due' | 'given' | 'held' | 'missed' | 'refused';
  // joined
  medication_order?: MedicationOrder;
}

export interface MedicationAdministration {
  id: string;
  clinic_id: string;
  schedule_id: string;
  admission_id: string;
  administered_by: string | null;
  administered_at: string;
  status: 'given' | 'held' | 'refused' | 'wasted';
  reason: string | null;
  wristband_scanned: boolean;
  med_barcode_scanned: boolean;
  stock_movement_id: string | null;
}

// --- 007: Billing core -----------------------------------------------------------

export type ChargeSource =
  | 'room_rent_job' | 'order' | 'emar' | 'ot' | 'pharmacy' | 'manual' | 'package_engine';

export interface ChargePosting {
  id: string;
  clinic_id: string;
  admission_id: string;
  service_id: string;
  charge_group_id: string;
  charge_group_path: string;
  source: ChargeSource;
  source_ref: string | null;
  service_date: string;
  quantity: number;
  unit_rate: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  tax_amount: number;
  cost_snapshot: number;
  ordering_doctor_id: string | null;
  performing_doctor_id: string | null;
  package_assignment_id: string | null;
  covered_by_package: boolean;
  status: 'pending' | 'billed' | 'cancelled';
  bill_line_id: string | null;
  description?: string | null;
  // joined
  service?: ServiceMaster;
  performing_doctor?: { id: string; name: string | null } | null;
}

export interface Deposit {
  id: string;
  clinic_id: string;
  admission_id: string;
  receipt_number: string;
  amount: number;
  entry_type: 'deposit' | 'refund' | 'applied_to_bill';
  payment_method: string | null;
  reference: string | null;
  received_by: string | null;
  applied_bill_id: string | null;
  received_at: string;
}

export interface IpdBill {
  id: string;
  clinic_id: string;
  admission_id: string;
  bill_number: string;
  bill_type: 'interim' | 'final' | 'supplementary';
  bill_datetime: string;
  gross_total: number;
  discount_total: number;
  tax_total: number;
  net_total: number;
  package_total: number;
  payer_expected: number;
  patient_payable: number;
  deposits_applied: number;
  paid_amount: number;
  balance_amount: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'settled' | 'cancelled';
  pdf_url: string | null;
  lines?: IpdBillLine[];
  payments?: IpdPayment[];
}

export interface IpdBillLine {
  id: string;
  clinic_id: string;
  bill_id: string;
  charge_posting_id: string | null;
  line_type: 'charge' | 'package' | 'adjustment';
  description: string;
  quantity: number;
  unit_rate: number;
  gross: number;
  discount: number;
  tax: number;
  net: number;
  charge_group_id: string | null;
  charge_group_path: string | null;
}

export interface IpdPayment {
  id: string;
  clinic_id: string;
  bill_id: string;
  receipt_number: string;
  amount: number;
  payer_kind: 'patient' | 'tpa' | 'insurer' | 'corporate';
  payment_method: string;
  reference: string | null;
  record_type: 'payment' | 'refund';
  received_by: string | null;
  received_at: string;
}
