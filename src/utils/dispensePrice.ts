import type { MedicineBatch, MedicineWithPrice } from '../types';

const positivePrice = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : undefined;
};

/** Prices are for a whole stocked pack; loose-unit conversion happens at billing. */
export function resolveDispensePrice(
  medicine?: Pick<MedicineWithPrice, 'id' | 'sellingPrice'>,
  batch?: Pick<MedicineBatch, 'medicineId' | 'mrp'>,
): { unitPrice: number; source: 'batch' | 'medicine' | 'missing' } {
  if (!medicine) return { unitPrice: 0, source: 'missing' };
  const mrp = batch?.medicineId === medicine.id ? positivePrice(batch.mrp) : undefined;
  if (mrp !== undefined) return { unitPrice: mrp, source: 'batch' };
  const savedPrice = positivePrice(medicine.sellingPrice);
  if (savedPrice !== undefined) return { unitPrice: savedPrice, source: 'medicine' };
  return { unitPrice: 0, source: 'missing' };
}
