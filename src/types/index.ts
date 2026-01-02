export interface Patient {
  id: string;
  name: string;
  phone: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  address: string;
  emergency_contact?: string;
  blood_group?: string;
  allergies?: string[];
  referred_by?: string;
  createdAt: Date;
  lastVisit?: Date;
}

export * from './whatsapp';

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  createdAt: Date;
}

export interface Profile {
  id: string;
  userId?: string;
  roleId: string; // Keep for reference to roles table
  clinicId?: string;
  name: string;
  email: string;
  phone?: string;
  specialization?: string;
  qualification?: string;
  registrationNo?: string;
  roleName: string; // Denormalized from roles table
  permissions: string[]; // Denormalized from roles table
  consultationFee?: number;
  followUpFee?: number;
  emergencyFee?: number;
  isActive: boolean;
  isOpenForConsultation: boolean;
  doctorAvailability?: {
    [key: string]: {
      isOpen: boolean;
      startTime: string;
      endTime: string;
      breakStart?: string;
      breakEnd?: string;
    };
  };
  createdAt: Date;
  updatedAt: Date;
  role?: Role; // Only populated when explicitly joined
  clinic?: ClinicSetting;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentDate: Date;
  duration: number;
  status: 'Scheduled' | 'Confirmed' | 'Arrived' | 'In_Progress' | 'Completed' | 'Cancelled' | 'No_Show';
  appointmentType: 'Consultation' | 'Follow_Up' | 'Emergency' | 'Routine_Checkup';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  patient?: Patient;
  doctor?: Profile;
}

// Physical Examination Types
export interface ExaminationField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'toggle' | 'textarea';
  value: string | boolean;
  options?: string[];
  placeholder?: string;
}

export interface ExaminationSection {
  id: string;
  title: string;
  fields: ExaminationField[];
}

export interface PhysicalExamination {
  sections: ExaminationSection[];
  aiGenerated?: boolean;
  specialization?: string;
  generatedAt?: Date;
}

// Voice Transcript Types
export interface VoiceTranscript {
  id: string;
  visitId: string;
  transcript: string;
  extractedData?: {
    symptoms?: Array<{
      name: string;
      location?: string | null;
      duration?: string | null;
      severity?: 'mild' | 'moderate' | 'severe' | null;
      pattern?: string | null;
      character?: string | null;
      associatedSymptoms?: string[] | null;
      aggravatingFactors?: string | null;
      relievingFactors?: string | null;
    }>;
    vitals?: {
      temperature?: string | null;
      bloodPressure?: string | null;
      pulse?: string | null;
      weight?: string | null;
      height?: string | null;
      oxygenSaturation?: string | null;
      respiratoryRate?: string | null;
    };
    examination?: {
      general?: string | null;
      abdomen?: string | null;
      cardiovascular?: string | null;
      respiratory?: string | null;
      neurological?: string | null;
      localExamination?: string | null;
      other?: Record<string, string>;
    };
    diagnoses?: Array<{
      name: string;
      icd10Code?: string | null;
      isPrimary?: boolean;
      notes?: string | null;
    } | string>;
    prescriptions?: Array<{
      medicine: string;
      dosage?: string | null;
      frequency?: string | null;
      duration?: string | null;
      instructions?: string | null;
      route?: string | null;
    }>;
    testsOrdered?: Array<{
      testName: string;
      testType?: 'lab' | 'imaging' | 'procedure';
      urgency?: 'routine' | 'urgent';
      instructions?: string | null;
    }>;
    advice?: string[];
    followUp?: {
      duration?: string | null;
      instructions?: string | null;
      warningSignsToWatch?: string[] | null;
    };
  };
  suggestedDiagnoses?: Array<{
    name: string;
    likelihood?: 'high' | 'medium' | 'low';
    reasoning?: string;
  }>;
  chiefComplaint?: string;
  confidence?: {
    transcription?: number;
    extraction?: number;
  };
  syncStatus: 'pending' | 'synced' | 'failed';
  deviceId?: string;
  createdAt: Date;
  syncedAt?: Date;
}

export interface Visit {
  id: string;
  patientId: string;
  doctorId: string | null;
  appointmentId?: string;
  date: Date;
  chiefComplaint: string;
  symptoms: Symptom[];
  vitals: {
    temperature?: number;
    bloodPressure?: string;
    pulse?: number;
    weight?: number;
    height?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
  };
  physicalExamination?: PhysicalExamination;
  diagnoses: Diagnosis[];
  prescriptions: Prescription[];
  testsOrdered: TestOrdered[];
  testResults: TestResult[];
  advice: string[];
  adviceLanguage?: string;
  adviceRegional?: string;
  followUpDate?: Date;
  doctorNotes: string;
  caseImageUrl?: string;
  pdf_url?: string; // URL to the stored display PDF in Supabase Storage
  pdf_generated_at?: Date; // Timestamp of display PDF generation
  print_pdf_url?: string; // URL to grayscale print version for letterhead
  print_pdf_generated_at?: Date; // Timestamp of print PDF generation
  createdAt: Date;
  updatedAt: Date;
  patient?: Patient;
  doctor?: Profile;
}

export interface Symptom {
  id: string;
  visitId: string;
  name: string;
  severity?: 'mild' | 'moderate' | 'severe';
  duration?: string;
  notes?: string;
  createdAt: Date;
}

export interface Diagnosis {
  id: string;
  visitId: string;
  name: string;
  icd10Code?: string;
  isPrimary: boolean;
  notes?: string;
  createdAt: Date;
}

export interface Prescription {
  id: string;
  visitId: string;
  medicineId?: string;
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  quantity?: number;
  refills?: number;
  createdAt: Date;
}

export interface TestOrdered {
  id: string;
  visitId: string;
  testName: string;
  testType: 'lab' | 'radiology' | 'procedure' | 'other';
  instructions?: string;
  urgency: 'routine' | 'urgent' | 'stat';
  status: 'ordered' | 'sample_collected' | 'in_progress' | 'completed' | 'cancelled';
  orderedDate: Date;
  expectedDate?: Date;
  createdAt: Date;
}

export interface TestResult {
  id: string;
  testOrderedId: string;
  visitId: string;
  result: string;
  normalRange?: string;
  isAbnormal: boolean;
  resultDate: Date;
  reportUrl?: string;
  notes?: string;
  createdAt: Date;
  testOrdered?: TestOrdered;
}

export type PaymentRecordType = 'payment' | 'refund' | 'adjustment';

export interface PaymentRecord {
  id: string;
  billId: string;
  paymentDate: Date;
  paymentMethod: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
  amount: number;
  cardReference?: string;
  chequeNumber?: string;
  bankName?: string;
  notes?: string;
  receivedBy: string;
  receivedByProfile?: Profile;
  recordType: PaymentRecordType;
  refundRequestId?: string;
  reason?: string;
  approvedBy?: string;
  createdAt: Date;
}

export interface Bill {
  id: string;
  visitId: string | null;
  patientId: string;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: 'pending' | 'partial' | 'paid' | 'overdue';
  paymentMethod?: 'cash' | 'card' | 'upi' | 'cheque' | 'online';
  billDate: Date;
  dueDate?: Date;
  notes?: string;
  totalRefundedAmount: number;
  refundStatus: 'not_requested' | 'pending' | 'partial' | 'refunded';
  lastRefundAt?: Date;
  refundNotes?: string;
  pdfUrl?: string; // URL to the stored display PDF in Supabase Storage
  printPdfUrl?: string; // URL to grayscale print version for letterhead
  createdAt: Date;
  updatedAt: Date;
  billItems: BillItem[];
  paymentRecords?: PaymentRecord[];
  refundRequests?: RefundRequest[];
  patient?: Patient;
  visit?: Visit;
}

export interface DailyPaymentSummary {
  date: Date;
  cash: number;
  card: number;
  upi: number;
  cheque: number;
  net_banking: number;
  wallet: number;
  total: number;
  transactionCount: number;
  paymentBreakdown: {
    method: string;
    amount: number;
    count: number;
  }[];
}

export interface EnhancedDailyReport {
  date: Date;
  totalCollection: number;
  transactionCount: number;
  averageTransactionValue: number;
  outstandingBalance: number;

  // Payment method breakdown
  paymentMethods: {
    method: string;
    amount: number;
    count: number;
    percentage: number;
  }[];

  // Service category breakdown
  serviceCategories: {
    category: 'consultation' | 'procedure' | 'medicine' | 'test' | 'other';
    amount: number;
    count: number;
    percentage: number;
  }[];

  // Peak hours analysis
  peakHours: {
    hour: number;
    amount: number;
    count: number;
  }[];

  // Daily trend
  hourlyBreakdown: {
    hour: string;
    amount: number;
    transactions: number;
  }[];
}

export interface BillItem {
  id: string;
  billId: string;
  itemType: 'consultation' | 'procedure' | 'medicine' | 'test' | 'other';
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount?: number;
  tax?: number;
  refundedQuantity?: number;
  refundedAmount?: number;
  lastRefundReason?: string;
  createdAt: Date;
}

export interface RefundRequest {
  id: string;
  billId: string;
  patientId: string;
  clinicId: string;
  sourceType: 'bill' | 'pharmacy_dispense';
  totalAmount: number;
  refundMethod?: 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';
  reason?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  initiatedBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
  paidAt?: Date;
  metadata?: Record<string, any>;
  inventoryActions?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OcrUpload {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  processedAt?: Date;
}

export interface OCRValidationReport {
  isValid: boolean;
  missingFields: string[];
  errors: string[];
  recommendations: string[];
  qualityScore: number;
  completenessScore: number;
  accuracyScore: number;
  details: {
    symptomsValidation: { found: number; issues: string[] };
    vitalsValidation: { found: number; issues: string[] };
    diagnosesValidation: { found: number; issues: string[] };
    prescriptionsValidation: { found: number; issues: string[] };
    adviceValidation: { found: number; issues: string[] };
  };
}

export interface OcrResult {
  id: string;
  ocrUploadId: string;
  rawText: string;
  cleanedMedicalText?: string;
  extractedData: {
    symptoms: Array<Omit<Symptom, 'id' | 'visitId' | 'createdAt'>>;
    vitals: {
      temperature?: string;
      bloodPressure?: string;
      pulse?: string;
      weight?: string;
      height?: string;
      respiratoryRate?: string;
      oxygenSaturation?: string;
    };
    diagnoses: Array<Omit<Diagnosis, 'id' | 'visitId' | 'createdAt'>>;
    prescriptions: Array<Omit<Prescription, 'id' | 'visitId' | 'createdAt'>>;
    testsOrdered: Array<Omit<TestOrdered, 'id' | 'visitId' | 'createdAt'>>;
    advice: string[];
    chiefComplaint?: string;
    doctorNotes?: string;
  };
  confidence: number;
  processingTime: number;
  createdAt: Date;
  validationReport?: OCRValidationReport;
}

export interface ClinicSetting {
  id: string;
  clinicName: string;
  address: string;
  phone: string;
  email?: string;
  website?: string;
  logoUrl?: string;
  registrationNumber?: string;
  taxId?: string;
  consultationFee: number;
  followUpFee: number;
  emergencyFee: number;
  appointmentDuration: number;
  workingHours: {
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
  createdAt: Date;
  updatedAt: Date;
  blueticksApiKey?: string;
  // PDF Settings
  pdfHeaderUrl?: string;
  pdfFooterUrl?: string;
  pdfMargins?: string;
  pdfPrintMargins?: string;
  // WhatsApp and AI Review Settings
  enableManualWhatsappSend?: boolean;
  enableBlueticksApiSend?: boolean;
  enableAiReviewSuggestion?: boolean;
  enableSimpleThankYou?: boolean;
  enableAiThankYou?: boolean;
  enableGmbLinkOnly?: boolean;
  gmbLink?: string;
  // WhatsApp Message Templates
  whatsappTemplates?: {
    visit_prescription?: string;
    invoice_generated?: string;
    appointment_reminder?: string;
    appointment_confirmation?: string;
    thank_you?: string;
  };
  // Prescription Frequencies
  prescriptionFrequencies?: Array<{
    code: string;
    label: string;
    timesPerDay: number | null;
  }>;
  // Appointment Types
  appointmentTypes?: Array<{
    id: string;
    label: string;
    duration: number;
    color: string;
    fee?: number;
  }>;
}

export interface Review {
  id: string;
  patientId: string;
  patientName: string;
  contactNumber: string;
  appointmentDate: string;
  treatment?: string;
  aiReviewText?: string;
  aiReviewFirstMessageSent?: boolean;
  visitId?: string;
  doctorId?: string;
  doctorName?: string;
  createdAt: Date;
  updatedAt: Date;
  // Message tracking fields
  followUpSent?: boolean;
  thankYouSent?: boolean;
  lastMessageSentAt?: Date;
}

export interface ReviewRequestTemplate {
  id: string;
  name: string;
  templateType: 'ai_integrated' | 'simple_thank_you' | 'ai_second' | 'follow_up' | 'gmb_link_only';
  messageTemplate: string;
  description: string;
}

export interface MedicineMaster {
  id: string;
  name: string;
  genericName?: string;
  brandName?: string;
  category: string;
  dosageForm: string;
  strength?: string;
  manufacturer?: string;
  description?: string;
  sideEffects?: string[];
  contraindications?: string[];
  currentStock: number;
  reorderLevel: number;
  batchNumber?: string;
  expiryDate?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestMaster {
  id: string;
  name: string;
  category: string;
  type: 'lab' | 'radiology' | 'procedure' | 'other';
  normalRange?: string;
  units?: string;
  description?: string;
  preparationInstructions?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsData {
  totalPatients: number;
  todayVisits: number;
  totalVisits: number;
  topDiagnoses: { name: string; count: number }[];
  topMedicines: { name: string; count: number }[];
  monthlyVisits: { month: string; visits: number }[];
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PharmacyInwardReceipt {
  id: string;
  supplierId?: string;
  invoiceNumber?: string;
  receiptDate: Date;
  totalAmount: number;
  uploadedBy: string;
  invoiceFileUrl?: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
  supplier?: Supplier;
  inwardItems?: PharmacyInwardItem[];
}

export interface PharmacyInwardItem {
  id: string;
  receiptId: string;
  medicineId: string;
  quantity: number;
  unitCostPrice: number;
  totalCostPrice: number;
  batchNumber?: string;
  expiryDate?: Date;
  createdAt: Date;
  medicine?: MedicineMaster;
}

export interface PharmacyDispensedItem {
  id: string;
  visitId: string;
  prescriptionId?: string;
  medicineId: string;
  quantity: number;
  dispensedBy: string;
  dispenseDate: Date;
  sellingPriceAtDispense?: number;
  totalSellingPrice?: number;
  batchNumber?: string;
  originalPrescriptionName?: string;
  isMatched?: boolean;
  refundedQuantity?: number;
  refundRequestId?: string;
  createdAt: Date;
  medicine?: MedicineMaster;
  dispensedByProfile?: Profile;
}

export interface StockMovementLog {
  id: string;
  medicineId: string;
  movementType: 'inward' | 'outward' | 'adjustment' | 'return';
  quantityChange: number;
  newStockLevel: number;
  referenceId?: string;
  referenceType?: string;
  movedBy: string;
  movementDate: Date;
  remarks?: string;
  createdAt: Date;
  medicine?: MedicineMaster;
  movedByProfile?: Profile;
}

export interface StockAlert {
  id: string;
  medicineId: string;
  alertType: 'low_stock' | 'expiring_soon';
  message: string;
  createdAt: Date;
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  medicine?: MedicineMaster;
}

export interface ClinicMedicinePrice {
  id: string;
  clinicId: string;
  medicineId: string;
  sellingPrice: number;
  costPrice: number;
  createdAt: Date;
  updatedAt: Date;
  medicine?: MedicineMaster;
  clinic?: ClinicSetting;
}

export interface ClinicTestPrice {
  id: string;
  clinicId: string;
  testId: string;
  price: number;
  cost: number;
  createdAt: Date;
  updatedAt: Date;
  test?: TestMaster;
  clinic?: ClinicSetting;
}

export interface MedicineWithPrice extends MedicineMaster {
  sellingPrice?: number;
  costPrice?: number;
}

export interface TestWithPrice extends TestMaster {
  price?: number;
  cost?: number;
}

export interface SentMessageLog {
  id: string;
  patientId: string;
  visitId?: string;
  messageType: string;
  sentAt: Date;
  messageContent: string;
  status: 'sent' | 'failed' | 'pending';
  deliveryMethod: 'manual_whatsapp' | 'blueticks_api';
  errorDetails?: string;
  sentBy?: string;
  createdAt: Date;
}

export interface AppointmentType {
  id: string;
  label: string;
  duration: number;
  color: string;
  feeType: 'consultation' | 'followup' | 'emergency' | 'custom';
  customFee?: number; // Only used when feeType is 'custom'
}