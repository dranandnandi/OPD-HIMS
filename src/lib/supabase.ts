// Re-export everything from the centralized supabase client
export { supabase, type Database } from './supabaseClient';
export type {
  DatabaseRole,
  DatabaseProfile,
  DatabasePatient,
  DatabaseAppointment,
  DatabaseVisit,
  DatabaseSymptom,
  DatabaseDiagnosis,
  DatabasePrescription,
  DatabaseTestOrdered,
  DatabaseTestResult,
  DatabaseBill,
  DatabaseBillItem,
  DatabaseOcrUpload,
  DatabaseOcrResult,
  DatabaseClinicSetting,
  DatabaseMedicineMaster,
  DatabaseTestMaster,
  DatabaseSupplier,
  DatabasePharmacyInwardReceipt,
  DatabasePharmacyInwardItem,
  DatabasePharmacyDispensedItem,
  DatabaseStockMovementLog,
  DatabaseClinicMedicinePrice,
  DatabaseClinicTestPrice
} from './supabaseClient';