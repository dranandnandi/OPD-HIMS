import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RotateCcw, ShieldCheck, AlertCircle, Clock, IndianRupee,
  CheckCircle2, XCircle, Banknote, RefreshCw, Search
} from 'lucide-react';
import { format } from 'date-fns';
import { refundService, RefundQueueItem } from '../../services/refundService';
import { RefundRequest } from '../../types';
import { useAuth } from '../Auth/useAuth';

/**
 * Clinic-wide refund worklist.
 *
 * Refund requests used to be reachable only by opening the exact bill they were
 * raised against, so a pending request could sit unnoticed for days with nobody
 * told it existed. This is the one screen that answers "what is waiting on me".
 */

const STATUS_STYLES: Record<RefundRequest['status'], string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  pending_approval: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-blue-50 text-blue-800 border-blue-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const formatStatus = (status: RefundRequest['status']) =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

type TabKey = 'open' | 'history' | 'all';

const TAB_STATUSES: Record<TabKey, RefundRequest['status'][] | undefined> = {
  open: ['draft', 'pending_approval', 'approved'],
  history: ['paid', 'rejected', 'cancelled'],
  all: undefined,
};

const RefundQueue: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('open');
  const [items, setItems] = useState<RefundQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Mirrors canManageRefunds in BillModal — roleName is free text from User
  // Management, so it must be lowercased before comparing.
  const canManageRefunds = useMemo(() => {
    if (!user) return false;
    const roleName = user.roleName?.toLowerCase();
    const perms = user.permissions || [];
    return (
      roleName === 'admin' ||
      roleName === 'super_admin' ||
      perms.includes('all') ||
      perms.includes('manage_billing') ||
      perms.includes('manage_finance') ||
      perms.includes('approve_refunds')
    );
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await refundService.listRefundQueue({ statuses: TAB_STATUSES[tab] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load refund requests');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (id: string, fn: () => Promise<unknown>) => {
    setActionId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionId(null);
    }
  };

  const approve = (item: RefundQueueItem) =>
    runAction(item.id, () =>
      refundService.updateRefundRequest(item.id, { status: 'approved', approvedBy: user?.id })
    );

  const reject = (item: RefundQueueItem) => {
    const reason = window.prompt('Reason for rejecting this refund', item.reason || '');
    if (reason === null) return;
    return runAction(item.id, () =>
      refundService.updateRefundRequest(item.id, {
        status: 'rejected',
        reason: reason || item.reason,
      })
    );
  };

  const markPaid = (item: RefundQueueItem) => {
    let method = item.refundMethod;
    if (!method) {
      const entered = window.prompt(
        'Payment method (cash / card / upi / cheque / net_banking / wallet)',
        'cash'
      );
      if (!entered) return;
      method = entered.trim().toLowerCase() as RefundRequest['refundMethod'];
    }
    return runAction(item.id, () =>
      refundService.markRefundPaid(item.id, {
        amount: item.totalAmount,
        paymentMethod: method as NonNullable<RefundRequest['refundMethod']>,
        notes: item.reason,
        approvedBy: user?.id,
      })
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.patientName.toLowerCase().includes(q) ||
      i.billNumber.toLowerCase().includes(q) ||
      i.patientPhone.includes(q)
    );
  }, [items, search]);

  const awaitingApproval = items.filter((i) => i.status === 'pending_approval');
  const awaitingPayout = items.filter((i) => i.status === 'approved');
  const sum = (list: RefundQueueItem[]) => list.reduce((t, i) => t + i.totalAmount, 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-purple-600" />
            Refund Requests
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every refund raised in the clinic, so nothing waits unseen on a bill.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {!canManageRefunds && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            You can see refund requests but not act on them. Approving or paying a
            refund needs an admin or the <code>approve_refunds</code> permission.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-amber-600 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Awaiting approval
          </p>
          <p className="text-2xl font-semibold text-amber-800 mt-1">{awaitingApproval.length}</p>
          <p className="text-sm text-amber-700">{inr(sum(awaitingApproval))}</p>
        </div>
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-blue-600 flex items-center gap-1">
            <Banknote className="w-3 h-3" /> Approved, not paid
          </p>
          <p className="text-2xl font-semibold text-blue-800 mt-1">{awaitingPayout.length}</p>
          <p className="text-sm text-blue-700">{inr(sum(awaitingPayout))}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
            <IndianRupee className="w-3 h-3" /> Shown here
          </p>
          <p className="text-2xl font-semibold text-gray-800 mt-1">{filtered.length}</p>
          <p className="text-sm text-gray-600">{inr(sum(filtered))}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-200">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {([['open', 'Open'], ['history', 'Settled'], ['all', 'All']] as Array<[TabKey, string]>).map(
              ([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                    tab === key ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, bill number or phone"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-500 text-sm">Loading refund requests…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">
            {tab === 'open' ? 'Nothing is waiting — no open refund requests.' : 'No refund requests here.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((item) => (
              <div key={item.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900">{item.patientName}</span>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full border ${STATUS_STYLES[item.status]}`}
                    >
                      {formatStatus(item.status)}
                    </span>
                    <span className="text-xs text-gray-500">{item.billNumber}</span>
                  </div>
                  {item.reason && (
                    <p className="text-sm text-gray-600 mt-1 break-words">{item.reason}</p>
                  )}
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    <span>Requested {format(item.createdAt, 'dd MMM yyyy, HH:mm')}</span>
                    {item.initiatedByName && <span>by {item.initiatedByName}</span>}
                    {item.approvedAt && <span>Approved {format(item.approvedAt, 'dd MMM, HH:mm')}</span>}
                    {item.paidAt && <span>Paid {format(item.paidAt, 'dd MMM, HH:mm')}</span>}
                    {item.refundMethod && <span className="capitalize">{item.refundMethod}</span>}
                  </div>
                </div>

                <div className="text-xl font-semibold text-gray-900 lg:w-32 lg:text-right">
                  {inr(item.totalAmount)}
                </div>

                {canManageRefunds && (
                  <div className="flex flex-wrap gap-2 lg:w-64 lg:justify-end">
                    {(item.status === 'draft' || item.status === 'pending_approval') && (
                      <>
                        <button
                          onClick={() => approve(item)}
                          disabled={actionId === item.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {actionId === item.id ? 'Working…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => reject(item)}
                          disabled={actionId === item.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                    {item.status === 'approved' && (
                      <button
                        onClick={() => markPaid(item)}
                        disabled={actionId === item.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        {actionId === item.id ? 'Recording…' : 'Mark Paid'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RefundQueue;
