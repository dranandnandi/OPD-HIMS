import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { collectionService, CollectionEntry } from '../../services/collectionService';

const inr = (n: number) =>
  `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', upi: 'UPI', cheque: 'Cheque',
  net_banking: 'Net banking', wallet: 'Wallet', neft: 'NEFT',
};

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'custom';

const toDateInput = (d: Date) => format(d, 'yyyy-MM-dd');

function presetRange(p: Preset): { from: string; to: string } {
  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return toDateInput(d);
  };
  switch (p) {
    case 'today': return { from: day(0), to: day(0) };
    case 'yesterday': return { from: day(-1), to: day(-1) };
    case '7d': return { from: day(-6), to: day(0) };
    case 'month':
      return { from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to: day(0) };
    default: return { from: day(0), to: day(0) };
  }
}

export default function CollectionsTab() {
  const { clinicId } = useAuth();
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(presetRange('today').from);
  const [to, setTo] = useState(presetRange('today').to);
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      const r = presetRange(p);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  useEffect(() => {
    if (!clinicId || !from || !to) return;
    setLoading(true);
    // local-midnight bounds; `to` is inclusive → query < next midnight
    const fromISO = new Date(`${from}T00:00:00`).toISOString();
    const toEnd = new Date(`${to}T00:00:00`);
    toEnd.setDate(toEnd.getDate() + 1);
    collectionService
      .getCollections(clinicId, fromISO, toEnd.toISOString())
      .then((rows) => { setEntries(rows); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId, from, to]);

  // ---- analysis -------------------------------------------------------------
  const analysis = useMemo(() => {
    const gross = entries.filter((e) => !e.isRefund).reduce((s, e) => s + e.amount, 0);
    const refunds = entries.filter((e) => e.isRefund).reduce((s, e) => s + e.amount, 0); // negative
    const net = gross + refunds;

    const modes = [...new Set(entries.map((e) => e.method))]
      .sort((a, b) => Object.keys(METHOD_LABEL).indexOf(a) - Object.keys(METHOD_LABEL).indexOf(b));

    interface UserRow {
      userName: string;
      byMode: Record<string, number>;
      deposits: number;
      billPayments: number;
      refunds: number;
      total: number;
      receipts: number;
    }
    const users = new Map<string, UserRow>();
    for (const e of entries) {
      const key = e.userId ?? e.userName;
      let u = users.get(key);
      if (!u) {
        u = { userName: e.userName, byMode: {}, deposits: 0, billPayments: 0, refunds: 0, total: 0, receipts: 0 };
        users.set(key, u);
      }
      u.byMode[e.method] = (u.byMode[e.method] ?? 0) + e.amount;
      if (e.isRefund) u.refunds += e.amount;
      else if (e.source === 'deposit') u.deposits += e.amount;
      else u.billPayments += e.amount;
      u.total += e.amount;
      u.receipts += 1;
    }
    const userRows = [...users.values()].sort((a, b) => b.total - a.total);

    const byDay = new Map<string, number>();
    for (const e of entries) {
      const d = format(new Date(e.receivedAt), 'yyyy-MM-dd');
      byDay.set(d, (byDay.get(d) ?? 0) + e.amount);
    }
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, net]) => ({ date, net }));
    const maxDay = Math.max(...days.map((d) => Math.abs(d.net)), 1);

    const modeTotals: Record<string, number> = {};
    for (const e of entries) modeTotals[e.method] = (modeTotals[e.method] ?? 0) + e.amount;

    return { gross, refunds, net, modes, userRows, days, maxDay, modeTotals };
  }, [entries]);

  const exportXlsx = () => {
    const sheetRows = entries.map((e) => ({
      Time: format(new Date(e.receivedAt), 'dd-MM-yyyy HH:mm'),
      Receipt: e.receiptNumber,
      Patient: e.patientName,
      Admission: e.admissionNumber,
      'Collected by': e.userName,
      Source: e.source === 'deposit' ? 'Deposit' : 'Bill payment',
      Type: e.isRefund ? 'Refund' : 'Collection',
      Mode: METHOD_LABEL[e.method] ?? e.method,
      Amount: e.amount,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Collections');
    XLSX.writeFile(wb, `ipd-collections-${from}-to-${to}.xlsx`);
  };

  return (
    <div>
      {/* filter row */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-2">
        {(['today', 'yesterday', '7d', 'month'] as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => pickPreset(p)}
            className={`text-sm px-3 py-1.5 rounded-lg ${
              preset === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === '7d' ? 'Last 7 days' : 'This month'}
          </button>
        ))}
        <span className="mx-1 text-slate-200">|</span>
        <input
          type="date" value={from} max={to}
          onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date" value={to} min={from} max={toDateInput(new Date())}
          onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
        />
        <div className="flex-1" />
        <button
          onClick={exportXlsx}
          disabled={entries.length === 0}
          className="flex items-center gap-1.5 text-sm border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-400">Collected</p>
              <p className="text-lg font-bold text-slate-800">{inr(analysis.gross)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-400">Refunds</p>
              <p className="text-lg font-bold text-red-600">{analysis.refunds < 0 ? inr(analysis.refunds) : '—'}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-400">Net collection</p>
              <p className="text-lg font-bold text-emerald-700">{inr(analysis.net)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-400">Receipts</p>
              <p className="text-lg font-bold text-slate-800">{entries.length}</p>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              No collections in this period.
            </div>
          ) : (
            <>
              {/* user × mode matrix */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-2.5">Collected by</th>
                      {analysis.modes.map((m) => (
                        <th key={m} className="px-4 py-2.5 text-right">{METHOD_LABEL[m] ?? m}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right">Deposits</th>
                      <th className="px-4 py-2.5 text-right">Bill payments</th>
                      <th className="px-4 py-2.5 text-right">Refunds</th>
                      <th className="px-4 py-2.5 text-right">Net total</th>
                      <th className="px-4 py-2.5 text-right">Receipts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.userRows.map((u) => (
                      <tr key={u.userName} className="border-b border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-700">{u.userName}</td>
                        {analysis.modes.map((m) => (
                          <td key={m} className="px-4 py-2.5 text-right text-slate-600">
                            {u.byMode[m] ? inr(u.byMode[m]) : <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right text-slate-600">{u.deposits ? inr(u.deposits) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{u.billPayments ? inr(u.billPayments) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right text-red-600">{u.refunds ? inr(u.refunds) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{inr(u.total)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{u.receipts}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-700">Total</td>
                      {analysis.modes.map((m) => (
                        <td key={m} className="px-4 py-2.5 text-right font-semibold text-slate-700">
                          {inr(analysis.modeTotals[m] ?? 0)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-700">
                        {inr(analysis.userRows.reduce((s, u) => s + u.deposits, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-700">
                        {inr(analysis.userRows.reduce((s, u) => s + u.billPayments, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                        {analysis.refunds < 0 ? inr(analysis.refunds) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-900">{inr(analysis.net)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{entries.length}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* daily trend — shown only for multi-day ranges */}
              {analysis.days.length > 1 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
                  <p className="text-sm font-semibold text-slate-700 mb-3">Net collection by day</p>
                  <div className="space-y-1.5">
                    {analysis.days.map((d) => (
                      <div key={d.date} className="flex items-center gap-3 text-sm">
                        <span className="w-24 shrink-0 text-slate-500">
                          {format(new Date(`${d.date}T00:00:00`), 'dd MMM (EEE)')}
                        </span>
                        <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded ${d.net >= 0 ? 'bg-blue-600' : 'bg-red-400'}`}
                            style={{ width: `${(Math.abs(d.net) / analysis.maxDay) * 100}%` }}
                          />
                        </div>
                        <span className="w-28 shrink-0 text-right font-medium text-slate-700">{inr(d.net)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* receipt log */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="px-4 py-2.5">Time</th>
                      <th className="px-4 py-2.5">Receipt</th>
                      <th className="px-4 py-2.5">Patient</th>
                      <th className="px-4 py-2.5">Collected by</th>
                      <th className="px-4 py-2.5">Source</th>
                      <th className="px-4 py-2.5">Mode</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={`${e.source}-${e.id}`} className="border-b border-slate-100">
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                          {format(new Date(e.receivedAt), 'dd MMM HH:mm')}
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-700">{e.receiptNumber}</td>
                        <td className="px-4 py-2">
                          {e.patientName}
                          <span className="block text-xs text-slate-400">{e.admissionNumber}</span>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{e.userName}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {e.source === 'deposit' ? 'Deposit' : 'Bill payment'}
                          {e.isRefund && (
                            <span className="ml-1.5 text-xs uppercase bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                              refund
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{METHOD_LABEL[e.method] ?? e.method}</td>
                        <td className={`px-4 py-2 text-right font-medium ${e.isRefund ? 'text-red-600' : 'text-slate-800'}`}>
                          {inr(e.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
