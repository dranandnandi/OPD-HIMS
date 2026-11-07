import type { MedicineBatch, MedicineWithPrice } from '../types';
import { roundStock } from './packUnits';

export const pharmacyDate = (date = new Date()): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function expiryDateKey(value?: Date | string | null): string | null {
  if (!value) return null;
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value
    : Number.isFinite(new Date(value).getTime()) ? pharmacyDate(new Date(value)) : null;
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date ? date : null;
}

/** SQL expiry dates remain valid through that calendar day, using India time. */
export function expiryStatus(value?: Date | string | null, now = new Date()) {
  const date = expiryDateKey(value);
  const days = date === null ? null : Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${pharmacyDate(now)}T00:00:00Z`)) / 86400000);
  if (days === null) return { kind: 'unknown', days, label: 'Expiry not recorded', color: 'bg-gray-100 text-gray-700' } as const;
  if (days < 0) return { kind: 'expired', days, label: 'Expired', color: 'bg-red-100 text-red-800' } as const;
  if (days === 0) return { kind: 'critical', days, label: 'Expires today', color: 'bg-orange-100 text-orange-900' } as const;
  if (days <= 7) return { kind: 'critical', days, label: `Expires in ${days} day${days === 1 ? '' : 's'}`, color: 'bg-orange-100 text-orange-900' } as const;
  if (days <= 30) return { kind: 'soon', days, label: `Expires in ${days} days`, color: 'bg-yellow-100 text-yellow-900' } as const;
  return { kind: 'good', days, label: `Expires in ${days} days`, color: 'bg-green-100 text-green-800' } as const;
}

export interface ExpiryLot {
  id: string;
  medicine: MedicineWithPrice;
  quantity: number;
  batchNumber?: string;
  expiryDate?: Date;
}

/** Batch dates are authoritative. Master expiry applies only to residual pooled stock. */
export function buildExpiryLots(medicines: MedicineWithPrice[], batches: MedicineBatch[]): ExpiryLot[] {
  const byMedicine = new Map<string, MedicineBatch[]>();
  for (const batch of batches) if (batch.quantity > 0) {
    const list = byMedicine.get(batch.medicineId) || [];
    list.push(batch); byMedicine.set(batch.medicineId, list);
  }
  return medicines.flatMap(medicine => {
    const rows = byMedicine.get(medicine.id) || [];
    const lots: ExpiryLot[] = rows.map(batch => ({ id: batch.id, medicine, quantity: batch.quantity,
      batchNumber: batch.batchNumber, expiryDate: batch.expiryDate }));
    const pooled = roundStock(medicine.currentStock - rows.reduce((sum, batch) => sum + batch.quantity, 0));
    if (pooled > 0) lots.push({ id: `pool:${medicine.id}`, medicine, quantity: pooled,
      batchNumber: medicine.batchNumber, expiryDate: medicine.expiryDate });
    return lots;
  });
}

export function expiryWithin(value: Date | string | undefined, daysAhead: number, now = new Date(), includeExpired = false) {
  const { days } = expiryStatus(value, now);
  return days !== null && days <= daysAhead && (includeExpired || days >= 0);
}
