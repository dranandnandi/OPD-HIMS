import type { MedicineMaster } from '../types';
import type { InvoiceLine } from '../types/pharmacyImport';

const key = (value?: string | null) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
/** MRP and batch never identify a medicine. Never silently pick the first duplicate. */
export function invoiceMedicineMatches(line: Pick<InvoiceLine, 'medicineName' | 'strength' | 'manufacturer'>, medicines: MedicineMaster[]): MedicineMaster[] {
  return medicines.filter(m => key(m.name) === key(line.medicineName) &&
    (!key(line.strength) || !key(m.strength) || key(line.strength) === key(m.strength)) &&
    (!key(line.manufacturer) || !key(m.manufacturer) || key(line.manufacturer) === key(m.manufacturer)));
}
