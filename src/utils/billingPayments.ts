import type { Bill, Profile } from '../types';
import { hasModuleAccess } from './modulePermissions';

// Collecting an outstanding balance belongs to Billing access, independently
// of the permission to change the invoice's items, prices or discounts.
export const canReceiveBillPayment = (
  user: Pick<Profile, 'roleName' | 'permissions'> | null | undefined,
  bill: Pick<Bill, 'paymentStatus' | 'balanceAmount'> & Partial<Pick<Bill, 'billType'>>,
): boolean => (hasModuleAccess(user, 'opd_billing') || (bill.billType === 'pharmacy' && hasModuleAccess(user, 'pharmacy'))) &&
  ['pending', 'partial', 'overdue'].includes(bill.paymentStatus) &&
  bill.balanceAmount > 0;

export const validateBillPayment = (
  bill: Pick<Bill, 'paymentStatus' | 'balanceAmount'>,
  amount: number,
): string | null => {
  if (!['pending', 'partial', 'overdue'].includes(bill.paymentStatus) || bill.balanceAmount <= 0) {
    return 'This bill is already settled or cancelled. Refresh the billing list.';
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Payment amount must be greater than 0';
  }
  if (amount > bill.balanceAmount) {
    return `Payment amount cannot exceed the current balance of ₹${bill.balanceAmount.toLocaleString('en-IN')}`;
  }
  return null;
};
