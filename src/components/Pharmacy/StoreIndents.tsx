import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Warehouse, Truck, RefreshCw, PackageCheck, AlertTriangle, Inbox } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useAuth } from '../Auth/useAuth';
import {
  storeIndentService,
  StoreIndent,
  StoreIndentStatus,
  INDENT_STATUS_LABEL,
  INDENT_STATUS_CLASS,
  INDENT_PRIORITY_CLASS,
  OPEN_FOR_PHARMACY,
  indentTotals,
} from '../../services/storeIndentService';

type Tab = 'waiting' | 'done' | 'all';

const TAB_STATUSES: Record<Tab, StoreIndentStatus[] | undefined> = {
  waiting: OPEN_FOR_PHARMACY,
  done: ['dispatched', 'received'],
  all: undefined,
};

/**
 * The main pharmacy's side of the indent flow: every request raised by the IP
 * Pharmacy / ward sub-stores lands here, and dispatching from this screen moves
 * the stock out of the main pool into the requesting store.
 */
const StoreIndents: React.FC = () => {
  const { user } = useAuth();
  const clinicId = user?.clinicId;

  const [tab, setTab] = useState<Tab>('waiting');
  const [indents, setIndents] = useState<StoreIndent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      setError(null);
      const rows = await storeIndentService.list(clinicId, { statuses: TAB_STATUSES[tab] });
      setIndents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load indents');
    } finally {
      setLoading(false);
    }
  }, [clinicId, tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Opening this screen IS the pharmacy seeing the notification.
  useEffect(() => {
    if (clinicId) storeIndentService.markSeen(clinicId).catch(() => undefined);
  }, [clinicId]);

  // Live: a ward raising an indent should appear without a refresh.
  useEffect(() => {
    if (!clinicId) return;
    return storeIndentService.subscribe(clinicId, () => { load(); });
  }, [clinicId, load]);

  const waitingCount = useMemo(
    () => indents.filter((i) => OPEN_FOR_PHARMACY.includes(i.status)).length,
    [indents]
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view ward indents.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <Link to="/pharmacy" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <ArrowLeft className="w-4 h-4" /> Pharmacy
          </Link>
          <h2 className="text-2xl font-bold text-gray-800">Ward Indents</h2>
          <p className="text-gray-600">
            Stock requested by the IP Pharmacy and ward stores — dispatch it from the main pool.
          </p>
        </div>
        <button
          onClick={() => load()}
          className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex gap-2">
        {([
          ['waiting', `To dispatch${tab === 'waiting' && waitingCount ? ` (${waitingCount})` : ''}`],
          ['done', 'Dispatched'],
          ['all', 'All'],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading indents…</div>
      ) : indents.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">
            {tab === 'waiting' ? 'No indents waiting' : 'Nothing here yet'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Indents raised from IPD → Stores show up here the moment they are placed.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {indents.map((indent) => (
            <IndentCard key={indent.id} indent={indent} userId={user.id} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const IndentCard: React.FC<{ indent: StoreIndent; userId: string; onChanged: () => void }> = ({
  indent, userId, onChanged,
}) => {
  const totals = indentTotals(indent);
  const canDispatch = OPEN_FOR_PHARMACY.includes(indent.status);

  // How much of each line to send now — pre-filled with the outstanding
  // quantity, capped at what the main pool actually holds.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(canDispatch);

  useEffect(() => {
    const seed: Record<string, string> = {};
    for (const item of indent.items ?? []) {
      const outstanding = item.requested_qty - item.dispatched_qty;
      const available = item.medicine?.current_stock ?? 0;
      seed[item.id] = String(Math.max(0, Math.min(outstanding, available)));
    }
    setQty(seed);
  }, [indent]);

  const sendTotal = Object.values(qty).reduce((s, v) => s + (Number(v) || 0), 0);

  const dispatch = async () => {
    setBusy(true);
    try {
      await storeIndentService.dispatch({
        indentId: indent.id,
        lines: Object.entries(qty).map(([itemId, v]) => ({ itemId, quantity: Number(v) || 0 })),
        userId,
        remarks: remarks.trim() || undefined,
      });
      setRemarks('');
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div
        className="p-4 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <Warehouse className="w-5 h-5 text-blue-600" />
        <div className="min-w-0">
          <p className="font-semibold text-gray-800">
            {indent.store?.name ?? 'Store'}{' '}
            <span className="font-normal text-gray-400 text-sm">· {indent.indent_no}</span>
          </p>
          <p className="text-xs text-gray-500">
            {totals.lines} item{totals.lines === 1 ? '' : 's'} · {totals.dispatched}/{totals.requested} units sent ·
            {' '}raised {formatDistanceToNow(new Date(indent.requested_at), { addSuffix: true })}
            {indent.requester?.name ? ` by ${indent.requester.name}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {indent.priority !== 'routine' && (
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium uppercase ${INDENT_PRIORITY_CLASS[indent.priority]}`}>
              {indent.priority}
            </span>
          )}
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${INDENT_STATUS_CLASS[indent.status]}`}>
            {INDENT_STATUS_LABEL[indent.status]}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-4">
          {indent.notes && (
            <p className="text-sm text-gray-600 mb-3">
              <span className="text-gray-400">Note from ward:</span> {indent.notes}
            </p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2">Medicine</th>
                <th className="text-right">Requested</th>
                <th className="text-right">Already sent</th>
                <th className="text-right">In main pool</th>
                {canDispatch && <th className="text-right w-28">Send now</th>}
              </tr>
            </thead>
            <tbody>
              {(indent.items ?? []).map((item) => {
                const outstanding = item.requested_qty - item.dispatched_qty;
                const available = item.medicine?.current_stock ?? 0;
                const short = outstanding > available;
                return (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="py-2">
                      {item.medicine?.name} {item.medicine?.strength ?? ''}
                      {item.remarks && <span className="block text-xs text-gray-400">{item.remarks}</span>}
                    </td>
                    <td className="text-right">{item.requested_qty}</td>
                    <td className="text-right text-gray-500">{item.dispatched_qty}</td>
                    <td className={`text-right ${short ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {available}
                      {short && <AlertTriangle className="w-3.5 h-3.5 inline ml-1 -mt-0.5" />}
                    </td>
                    {canDispatch && (
                      <td className="text-right">
                        <input
                          type="number"
                          min={0}
                          max={Math.min(outstanding, available)}
                          value={qty[item.id] ?? '0'}
                          onChange={(e) => setQty({ ...qty, [item.id]: e.target.value })}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-right"
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {canDispatch ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Dispatch note (optional) — e.g. sent with ward boy Ramesh"
                className="flex-1 min-w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={dispatch}
                disabled={busy || sendTotal <= 0}
                className="flex items-center gap-2 bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <Truck className="w-4 h-4" />
                {busy ? 'Dispatching…' : `Dispatch ${sendTotal} unit${sendTotal === 1 ? '' : 's'}`}
              </button>
              {sendTotal < totals.pending && sendTotal > 0 && (
                <span className="text-xs text-amber-700">
                  Short supply — the indent stays open for the remaining {totals.pending - sendTotal}.
                </span>
              )}
            </div>
          ) : indent.status === 'cancelled' ? (
            <p className="mt-3 text-sm text-gray-500">
              Cancelled by the ward{indent.cancel_reason ? ` — ${indent.cancel_reason}` : ''}
            </p>
          ) : (
            <p className="mt-3 text-sm text-gray-500 flex items-center gap-2">
              <PackageCheck className="w-4 h-4 text-emerald-600" />
              Dispatched
              {indent.dispatched_at ? ` on ${format(new Date(indent.dispatched_at), 'dd MMM yyyy, h:mm a')}` : ''}
              {indent.dispatcher?.name ? ` by ${indent.dispatcher.name}` : ''}
              {indent.received_at
                ? ` · received by the ward on ${format(new Date(indent.received_at), 'dd MMM, h:mm a')}`
                : ' · awaiting ward acknowledgement'}
              {indent.dispatch_remarks ? ` — ${indent.dispatch_remarks}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StoreIndents;
