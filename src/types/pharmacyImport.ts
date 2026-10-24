export interface InvoiceLine {
  medicineName: string;
  quantity: number | null;
  unitCostPrice: number | null;
  totalCostPrice: number | null;
  batchNumber: string | null;
  expiryDate: string | null;
  manufacturer: string | null;
  strength: string | null;
  packSize: string | null;
  hsnCode?: string | null;
  gstRate?: number | null;
  mrp?: number | null;
  oldMrp?: number | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
  freeQuantity?: number | null;
  taxableAmount?: number | null;
  netAmount?: number | null;
  rack?: string | null;
  serialNumber?: string | null;
  sourceKey?: string;
  sourcePage?: number;
  sourceFile?: string;
  warnings?: string[];
}
export interface InvoiceData {
  invoiceInfo: {
    supplierName: string | null;
    supplierGstin?: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    taxableAmount?: number | null;
    cgstAmount?: number | null;
    sgstAmount?: number | null;
    igstAmount?: number | null;
    roundOff?: number | null;
    totalAmount: number | null;
  };
  medicines: InvoiceLine[];
  warnings?: string[];
}
export interface ImportPage {
  key: string;
  fileHash: string;
  fileName: string;
  page: number;
  status: 'pending' | 'complete' | 'failed';
  error?: string;
  data?: InvoiceData;
  model?: string;
}
export interface ImportDraft {
  id: string;
  clinic_id: string;
  target_receipt_id: string | null;
  status: 'draft' | 'posted';
  revision: number;
  payload: {
    pages: ImportPage[];
    data?: InvoiceData;
    review?: { invoiceInfo: Record<string, unknown>; medicineItems: Record<string, unknown>[]; headerResolution?: string };
  };
  updated_at: string;
}
