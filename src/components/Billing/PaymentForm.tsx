import React, { useState } from 'react';
import { CreditCard, DollarSign, Smartphone, FileText, Building, Wallet, Save, X } from 'lucide-react';
import { paymentService } from '../../services/paymentService';
import { PaymentRecord } from '../../types';

interface PaymentFormProps {
  billId: string;
  billAmount: number;
  paidAmount: number;
  onPaymentRecorded: (payment: PaymentRecord) => void;
  onCancel: () => void;
}

const PaymentForm: React.FC<PaymentFormProps> = ({
  billId,
  billAmount,
  paidAmount,
  onPaymentRecorded,
  onCancel
}) => {
  const [formData, setFormData] = useState({
    amount: billAmount - paidAmount, // Default to remaining balance
    paymentMethod: 'cash' as 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet',
    cardReference: '',
    chequeNumber: '',
    bankName: '',
    notes: '',
    paymentDate: new Date().toISOString().split('T')[0] // Today's date
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingBalance = billAmount - paidAmount;

  const paymentMethods = [
    { value: 'cash', label: 'Cash', icon: <DollarSign className="w-4 h-4" /> },
    { value: 'card', label: 'Card', icon: <CreditCard className="w-4 h-4" /> },
    { value: 'upi', label: 'UPI', icon: <Smartphone className="w-4 h-4" /> },
    { value: 'cheque', label: 'Cheque', icon: <FileText className="w-4 h-4" /> },
    { value: 'net_banking', label: 'Net Banking', icon: <Building className="w-4 h-4" /> },
    { value: 'wallet', label: 'Wallet', icon: <Wallet className="w-4 h-4" /> }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.amount <= 0) {
      setError('Payment amount must be greater than 0');
      return;
    }
    
    if (formData.amount > remainingBalance) {
      setError(`Payment amount cannot exceed remaining balance of ₹${remainingBalance}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payment = await paymentService.recordPayment({
        billId,
        amount: formData.amount,
        paymentMethod: formData.paymentMethod,
        cardReference: formData.cardReference || undefined,
        chequeNumber: formData.chequeNumber || undefined,
        bankName: formData.bankName || undefined,
        notes: formData.notes || undefined,
        paymentDate: new Date(formData.paymentDate)
      });

      onPaymentRecorded(payment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Record Payment</h3>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-2 text-sm text-gray-600">
            <p>Bill Amount: {formatCurrency(billAmount)}</p>
            <p>Paid Amount: {formatCurrency(paidAmount)}</p>
            <p className="font-semibold">Remaining: {formatCurrency(remainingBalance)}</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Payment Amount */}
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
              Payment Amount *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500">₹</span>
              </div>
              <input
                type="number"
                id="amount"
                min="0"
                max={remainingBalance}
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                className="block w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Method *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, paymentMethod: method.value as any })}
                  className={`p-3 rounded-lg border-2 transition-colors ${
                    formData.paymentMethod === method.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {method.icon}
                    <span className="text-sm font-medium">{method.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Payment Date */}
          <div>
            <label htmlFor="paymentDate" className="block text-sm font-medium text-gray-700 mb-1">
              Payment Date *
            </label>
            <input
              type="date"
              id="paymentDate"
              value={formData.paymentDate}
              onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Card Reference (for card/UPI payments) */}
          {(formData.paymentMethod === 'card' || formData.paymentMethod === 'upi') && (
            <div>
              <label htmlFor="cardReference" className="block text-sm font-medium text-gray-700 mb-1">
                {formData.paymentMethod === 'card' ? 'Card Reference' : 'UPI Reference'}
              </label>
              <input
                type="text"
                id="cardReference"
                value={formData.cardReference}
                onChange={(e) => setFormData({ ...formData, cardReference: e.target.value })}
                placeholder={formData.paymentMethod === 'card' ? 'Last 4 digits or reference' : 'UPI Transaction ID'}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Cheque Details */}
          {formData.paymentMethod === 'cheque' && (
            <>
              <div>
                <label htmlFor="chequeNumber" className="block text-sm font-medium text-gray-700 mb-1">
                  Cheque Number
                </label>
                <input
                  type="text"
                  id="chequeNumber"
                  value={formData.chequeNumber}
                  onChange={(e) => setFormData({ ...formData, chequeNumber: e.target.value })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="bankName" className="block text-sm font-medium text-gray-700 mb-1">
                  Bank Name
                </label>
                <input
                  type="text"
                  id="bankName"
                  value={formData.bankName}
                  onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </>
          )}

          {/* Net Banking Details */}
          {formData.paymentMethod === 'net_banking' && (
            <div>
              <label htmlFor="bankName" className="block text-sm font-medium text-gray-700 mb-1">
                Bank Name
              </label>
              <input
                type="text"
                id="bankName"
                value={formData.bankName}
                onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes (Optional)
            </label>
            <textarea
              id="notes"
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional payment details..."
              className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Record Payment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentForm;
