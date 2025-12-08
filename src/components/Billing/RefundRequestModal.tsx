import React, { useEffect, useMemo, useState } from 'react';
import { X, RefreshCw, ShieldCheck, AlertCircle } from 'lucide-react';
import { Bill, RefundRequest } from '../../types';
import { refundService } from '../../services/refundService';
import { format } from 'date-fns';
import { useAuth } from '../Auth/useAuth';

interface RefundRequestModalProps {
  bill: Bill;
  onClose: () => void;
  onRequestCreated?: () => void;
}

const methodOptions: Array<{ value: RefundRequest['refundMethod']; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'net_banking', label: 'Net Banking' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'wallet', label: 'Wallet' }
];

const statusColors: Record<RefundRequest['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-700'
};

const RefundRequestModal: React.FC<RefundRequestModalProps> = ({ bill, onClose, onRequestCreated }) => {
  const { user } = useAuth();
  const refundableAmount = useMemo(() => Math.max(bill.paidAmount - bill.totalRefundedAmount, 0), [bill]);

  const [amount, setAmount] = useState(refundableAmount);
  const [method, setMethod] = useState<RefundRequest['refundMethod']>('cash');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const canManageRefunds = Boolean(
    user && (
      user.roleName === 'admin' ||
      user.roleName === 'super_admin' ||
      user.permissions?.includes('manage_billing') ||
      user.permissions?.includes('manage_finance') ||
      user.permissions?.includes('approve_refunds')
    )
  );

  const loadRequests = async () => {
    setListLoading(true);
    try {
      const data = await refundService.listRefundRequests({ billId: bill.id });
      setRequests(data);
    } catch (err) {
      console.error('Failed to load refund requests', err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [bill.id]);

  useEffect(() => {
    setAmount(refundableAmount);
  }, [refundableAmount]);

  const refreshRequests = async () => {
    await loadRequests();
    onRequestCreated?.();
  };

  const handleApprove = async (request: RefundRequest) => {
    if (!canManageRefunds) return;
    setActionLoading(request.id);
    setError(null);
    try {
      await refundService.updateRefundRequest(request.id, {
        status: 'approved',
        approvedBy: user?.id
      });
      await refreshRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve refund request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (request: RefundRequest) => {
    if (!canManageRefunds) return;
    const rejectionReason = window.prompt('Add reason for rejection', request.reason || '') || request.reason;
    setActionLoading(request.id);
    setError(null);
    try {
      await refundService.updateRefundRequest(request.id, {
        status: 'rejected',
        reason: rejectionReason || undefined
      });
      await refreshRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject refund request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkPaid = async (request: RefundRequest) => {
    if (!canManageRefunds) return;
    let paymentMethod = request.refundMethod;
    if (!paymentMethod) {
      const promptValue = window.prompt('Enter payment method (cash/card/upi/cheque/net_banking/wallet)', 'cash');
      if (!promptValue) {
        return;
      }
      paymentMethod = promptValue as RefundRequest['refundMethod'];
    }
    if (!paymentMethod) {
      setError('Payment method is required to mark refund as paid.');
      return;
    }

    setActionLoading(request.id);
    setError(null);
    try {
      await refundService.markRefundPaid(request.id, {
        amount: request.totalAmount,
        paymentMethod,
        notes: request.reason,
        approvedBy: user?.id
      });
      await refreshRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark refund as paid');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0) {
      setError('Refund amount must be greater than zero.');
      return;
    }
    if (amount > refundableAmount) {
      setError('Refund amount cannot exceed paid amount.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await refundService.createRefundRequest({
        billId: bill.id,
        patientId: bill.patientId,
        sourceType: 'bill',
        totalAmount: amount,
        refundMethod: method,
        reason: reason || undefined
      });
      await refreshRequests();
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit refund request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-gray-100">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-sm text-gray-500">Bill #{bill.billNumber}</p>
            <h3 className="text-xl font-semibold text-gray-900">Request Refund</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="p-6 border-r border-gray-100">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-gray-700">Refund Amount</label>
                <div className="mt-1 relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-500">₹</span>
                  <input
                    type="number"
                    min={0}
                    max={refundableAmount}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="pl-7 pr-3 py-2 w-full border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Available refundable amount: ₹{refundableAmount.toLocaleString('en-IN')}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Refund Method</label>
                <select
                  value={method || ''}
                  onChange={(e) => setMethod(e.target.value as RefundRequest['refundMethod'])}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                >
                  {methodOptions.map((option) => (
                    <option key={option.value} value={option.value || ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Reason</label>
                <textarea
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="Provide context for finance approval"
                />
              </div>

              <button
                type="submit"
                disabled={loading || refundableAmount <= 0}
                className="w-full bg-blue-600 text-white py-2 rounded-lg flex items-center justify-center gap-2 disabled:bg-gray-300"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Refund Request'
                )}
              </button>
            </form>
          </div>

          <div className="p-6 bg-gray-50 rounded-b-2xl lg:rounded-bl-none lg:rounded-r-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500">Current Status</p>
                <p className="text-2xl font-semibold text-gray-900 capitalize">{bill.refundStatus.replace(/_/g, ' ')}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Total Refunded</p>
                <p className="text-xl font-semibold text-emerald-600">₹{bill.totalRefundedAmount.toLocaleString('en-IN')}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
              <ShieldCheck className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">Finance Approval Workflow</p>
                <p className="text-xs text-gray-500">Refunds require approval before payout to keep audit trails clean.</p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700">Existing Requests</h4>
                <button onClick={loadRequests} className="text-xs text-blue-600 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {listLoading && <p className="text-sm text-gray-500">Loading...</p>}
                {!listLoading && requests.length === 0 && (
                  <p className="text-sm text-gray-500">No refund requests yet.</p>
                )}
                {requests.map((request) => (
                  <div key={request.id} className="bg-white rounded-lg border border-gray-200 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[request.status]}`}>
                        {request.status.replace('_', ' ')}
                      </span>
                      <span className="text-gray-500">₹{request.totalAmount.toLocaleString('en-IN')}</span>
                    </div>
                    {request.reason && (
                      <p className="mt-2 text-gray-600 line-clamp-2">{request.reason}</p>
                    )}
                    <div className="mt-2 text-xs text-gray-500 flex justify-between">
                      <span>Requested: {format(new Date(request.createdAt), 'dd MMM, HH:mm')}</span>
                      {request.paidAt && <span>Paid: {format(new Date(request.paidAt), 'dd MMM')}</span>}
                    </div>
                    {canManageRefunds && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {(request.status === 'draft' || request.status === 'pending_approval') && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(request)}
                              disabled={actionLoading === request.id}
                              className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 disabled:opacity-60"
                            >
                              {actionLoading === request.id ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(request)}
                              disabled={actionLoading === request.id}
                              className="px-3 py-1 rounded-full bg-red-100 text-red-700 disabled:opacity-60"
                            >
                              {actionLoading === request.id ? 'Working…' : 'Reject'}
                            </button>
                          </>
                        )}
                        {(request.status === 'approved' || request.status === 'pending_approval') && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaid(request)}
                            disabled={actionLoading === request.id}
                            className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 disabled:opacity-60"
                          >
                            {actionLoading === request.id ? 'Recording…' : 'Mark Paid'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RefundRequestModal;
