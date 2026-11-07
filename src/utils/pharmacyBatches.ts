import type { MedicineBatch } from '../types';
import { round3, roundStock, toDispenseUnits } from './packUnits';
import { expiryDateKey } from './pharmacyExpiry';

/** Available batches in receipt order, excluding expired stock; MRP is never pooled. */
export function fifoBatches(batches: MedicineBatch[], medicineId: string, today: string): MedicineBatch[] {
  return batches.filter(b => b.medicineId === medicineId && b.quantity > 0 &&
    (!b.expiryDate || (expiryDateKey(b.expiryDate) ?? '') >= today))
    .sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** Split an entered count, retaining each batch's price and excluding other cart reservations. */
export function allocateFifoBatches(batches: MedicineBatch[], quantity: number, packSize: number, loose: boolean,
  reserved = new Map<string, number>()): { batch: MedicineBatch; quantity: number }[] {
  let remaining = round3(quantity);
  if (remaining <= 0) throw new Error('Enter a positive quantity first.');
  const allocations: { batch: MedicineBatch; quantity: number }[] = [];
  for (const batch of batches) {
    const available = Math.max(0, roundStock(batch.quantity - (reserved.get(batch.id) || 0)));
    const count = loose ? toDispenseUnits(available, packSize) : Math.floor(available + 1e-9);
    const take = round3(Math.min(remaining, count));
    if (take <= 0) continue;
    allocations.push({ batch, quantity: take });
    remaining = round3(remaining - take);
    if (remaining === 0) return allocations;
  }
  throw new Error('Not enough unexpired batch stock for this quantity.');
}
