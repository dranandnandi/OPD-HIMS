export interface SaleDiscountSelection {
  applySaleDiscount: boolean;
  discountPercent: number;
}

/** Customer discounts are an explicit sale choice, never a supplier-price default. */
export const noSaleDiscount = (): SaleDiscountSelection => ({ applySaleDiscount: false, discountPercent: 0 });

export function saleDiscountPercent(selection: Partial<SaleDiscountSelection>): number {
  if (selection.applySaleDiscount !== true) return 0;
  const percent = Number(selection.discountPercent);
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

export function updateSaleDiscount(
  current: SaleDiscountSelection,
  patch: Partial<SaleDiscountSelection>,
  medicineChanged = false,
): SaleDiscountSelection {
  if (medicineChanged) return noSaleDiscount();
  const selection = { ...current, ...patch };
  return { applySaleDiscount: selection.applySaleDiscount === true, discountPercent: saleDiscountPercent(selection) };
}
