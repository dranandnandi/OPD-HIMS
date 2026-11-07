import type { PharmacyInwardItem, PharmacyDebitNoteItem, SupplierCreditType } from '../types';

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function purchaseNetValue(item: PharmacyInwardItem): number {
  if (item.effectiveUnitCost != null) return money(item.effectiveUnitCost * (item.quantity + (item.freeQuantity || 0)));
  if ((item.lineTotal || 0) > 0 || (item.taxableAmount || 0) > 0 || item.discountPercent === 100) return item.taxableAmount || 0;
  const gross = item.quantity * item.unitCostPrice;
  return money(Math.max(0, gross - ((item.discountAmount || 0) + gross * (item.discountPercent || 0) / 100)));
}

/** Preview only; the database revalidates and calculates every amount. */
export function supplierReturnPreview(item: PharmacyInwardItem | undefined,
  row: { creditAmount: number }, creditType: SupplierCreditType, previous: PharmacyDebitNoteItem[] = []) {
  const zero = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  if (!item || creditType === 'stock_only') return zero;
  const credit = money(Math.max(0, row.creditAmount));
  if (creditType === 'commercial_credit') return { ...zero, total: credit };
  const base = purchaseNetValue(item);
  const priorTaxable = previous.reduce((sum, i) => sum + i.taxableAmount, 0);
  const tax = (key: 'cgstAmount' | 'sgstAmount' | 'igstAmount') => base > 0
    ? money(Math.max(0, money((priorTaxable + credit) * (item[key] || 0) / base) - previous.reduce((s, i) => s + i[key], 0))) : 0;
  const cgst = tax('cgstAmount'), sgst = tax('sgstAmount'), igst = tax('igstAmount');
  return { taxable: credit, cgst, sgst, igst, total: money(credit + cgst + sgst + igst) };
}
