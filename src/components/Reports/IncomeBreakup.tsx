import React, { useState, useEffect, useMemo } from 'react';
import {
  IndianRupee, Download, TrendingUp, Wallet, AlertCircle,
  Stethoscope, Layers, Info, RefreshCw
} from 'lucide-react';
import { incomeService, IncomeBreakup as IncomeBreakupData } from '../../services/incomeService';

type Preset = 'this_month' | 'last_month' | 'this_fy' | 'custom';

const toInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const fromInput = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/** Indian financial year runs April to March. */
const presetRange = (preset: Preset): { from: Date; to: Date } => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  switch (preset) {
    case 'last_month':
      return { from: new Date(year, month - 1, 1), to: new Date(year, month, 0) };
    case 'this_fy': {
      const fyStartYear = month >= 3 ? year : year - 1;
      return { from: new Date(fyStartYear, 3, 1), to: today };
    }
    case 'this_month':
    default:
      return { from: new Date(year, month, 1), to: today };
  }
};

const METHOD_LABEL: { [key: string]: string } = {
  cash: 'Cash', card: 'Card', upi: 'UPI', cheque: 'Cheque',
  net_banking: 'Net Banking', wallet: 'Wallet', neft: 'NEFT', unknown: 'Unrecorded',
};

const IncomeBreakup: React.FC = () => {
  const [preset, setPreset] = useState<Preset>('this_month');
  const initial = presetRange('this_month');
  const [from, setFrom] = useState<Date>(initial.from);
  const [to, setTo] = useState<Date>(initial.to);
  const [data, setData] = useState<IncomeBreakupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const pickPreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') {
      const range = presetRange(next);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await incomeService.getIncomeBreakup(from, to));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load income break-up');
      console.error('Error loading income break-up:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const currency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const rangeLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fmt.format(from)} — ${fmt.format(to)}`;
  }, [from, to]);

  // xlsx is a heavy dependency; pull it only when someone actually exports.
  const exportXlsx = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { Figure: 'Income billed (gross)', Amount: data.billed.gross },
        { Figure: 'Less: discounts', Amount: -data.billed.discount },
        { Figure: 'Income billed (net)', Amount: data.billed.net },
        { Figure: 'Less: refunds against bills', Amount: -data.refunds.total },
        { Figure: 'Net income for period', Amount: data.billed.net - data.refunds.total },
        { Figure: '', Amount: '' },
        { Figure: 'OPD billed (net)', Amount: data.billed.opdNet },
        { Figure: 'IPD billed (net)', Amount: data.billed.ipdNet },
        { Figure: '', Amount: '' },
        { Figure: 'Received - OPD bill payments', Amount: data.received.opdBillPayments },
        { Figure: 'Received - IPD bill payments', Amount: data.received.ipdBillPayments },
        { Figure: 'Received - IPD advances (not income)', Amount: data.received.ipdDeposits },
        { Figure: 'Received - refunds paid out', Amount: data.received.refundsPaidOut },
        { Figure: 'Net cash received', Amount: data.received.net },
        { Figure: '', Amount: '' },
        { Figure: 'Outstanding OPD (as at now)', Amount: data.outstanding.opd },
        { Figure: 'Outstanding IPD (as at now)', Amount: data.outstanding.ipd },
      ]), 'Summary');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        data.heads.map((head) => ({
          Head: head.label,
          'OPD gross': head.opdGross,
          'OPD discount': head.opdDiscount,
          'OPD net': head.opdNet,
          'IPD gross': head.ipdGross,
          'IPD discount': head.ipdDiscount,
          'IPD net': head.ipdNet,
          'Total net': head.net,
        }))
      ), 'By Head');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        data.doctors.map((doctor) => ({
          Doctor: doctor.doctorName,
          OPD: doctor.opd,
          IPD: doctor.ipd,
          Total: doctor.total,
        }))
      ), 'By Doctor');

      XLSX.writeFile(wb, `income-breakup-${toInput(from)}-to-${toInput(to)}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const netIncome = data ? data.billed.net - data.refunds.total : 0;
  const headTotal = data ? data.heads.reduce((sum, head) => sum + head.net, 0) : 0;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">

        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-1">Income Break-up</h1>
            <p className="text-gray-600">
              What the clinic earned, by module and by head — OPD and IPD together
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => void exportXlsx()}
              disabled={!data || exporting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Preparing…' : 'Export'}
            </button>
          </div>
        </div>

        {/* Period */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            {([
              ['this_month', 'This month'],
              ['last_month', 'Last month'],
              ['this_fy', 'This financial year'],
              ['custom', 'Custom'],
            ] as Array<[Preset, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => pickPreset(key)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  preset === key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}

            <div className="flex items-center gap-2 ml-auto">
              <input
                type="date"
                value={toInput(from)}
                onChange={(e) => { setPreset('custom'); setFrom(fromInput(e.target.value)); }}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={toInput(to)}
                onChange={(e) => { setPreset('custom'); setTo(fromInput(e.target.value)); }}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="mt-2 text-sm font-medium text-gray-900">{rangeLabel}</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Could not load the report</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="animate-pulse grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
          </div>
        )}

        {data && !loading && (
          <>
            {/* Headline */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl p-6 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-emerald-100 text-sm font-medium">Income earned</p>
                    <p className="text-3xl font-bold">{currency(netIncome)}</p>
                    <p className="text-emerald-100 text-sm mt-1">
                      {data.billCount.opd + data.billCount.ipd} bills raised
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-emerald-200" />
                </div>
                <div className="mt-4 pt-3 border-t border-emerald-400 border-opacity-40 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-emerald-100">OPD</p>
                    <p className="font-semibold">{currency(data.billed.opdNet)}</p>
                  </div>
                  <div>
                    <p className="text-emerald-100">IPD</p>
                    <p className="font-semibold">{currency(data.billed.ipdNet)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Cash received</p>
                    <p className="text-3xl font-bold">{currency(data.received.net)}</p>
                    <p className="text-blue-100 text-sm mt-1">Money in, not income earned</p>
                  </div>
                  <Wallet className="w-8 h-8 text-blue-200" />
                </div>
                <div className="mt-4 pt-3 border-t border-blue-400 border-opacity-40 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-blue-100">Against bills</p>
                    <p className="font-semibold">
                      {currency(data.received.opdBillPayments + data.received.ipdBillPayments)}
                    </p>
                  </div>
                  <div>
                    <p className="text-blue-100">Advances</p>
                    <p className="font-semibold">{currency(data.received.ipdDeposits)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-6 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-orange-100 text-sm font-medium">Outstanding</p>
                    <p className="text-3xl font-bold">{currency(data.outstanding.total)}</p>
                    <p className="text-orange-100 text-sm mt-1">As at now, all periods</p>
                  </div>
                  <IndianRupee className="w-8 h-8 text-orange-200" />
                </div>
                <div className="mt-4 pt-3 border-t border-orange-400 border-opacity-40 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-orange-100">OPD</p>
                    <p className="font-semibold">{currency(data.outstanding.opd)}</p>
                  </div>
                  <div>
                    <p className="text-orange-100">IPD</p>
                    <p className="font-semibold">{currency(data.outstanding.ipd)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Gross to net */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Gross to Net</h3>
              <div className="space-y-2 max-w-lg">
                {[
                  ['Billed gross', data.billed.gross, false],
                  ['Less: discounts allowed', -data.billed.discount, true],
                  ['Billed net', data.billed.net, false],
                  ['Less: refunds against bills', -data.refunds.total, true],
                ].map(([label, amount, isDeduction], index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between py-2 ${
                      index < 3 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <span className={`text-sm ${isDeduction ? 'text-gray-500 pl-4' : 'text-gray-700'}`}>
                      {label as string}
                    </span>
                    <span className={`text-sm font-semibold tabular-nums ${
                      isDeduction ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {currency(amount as number)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-3 border-t-2 border-gray-200">
                  <span className="font-semibold text-gray-900">Net income for the period</span>
                  <span className="text-lg font-bold text-emerald-700 tabular-nums">
                    {currency(netIncome)}
                  </span>
                </div>
              </div>
            </div>

            {/* By head */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Income by Head</h3>
                  <p className="text-xs text-gray-500">
                    OPD line types mapped onto the IPD charge-group tree
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Head</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">OPD</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">IPD</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total net</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Share</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.heads.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                          No bills were raised in this period.
                        </td>
                      </tr>
                    )}
                    {data.heads.map((head) => {
                      const share = headTotal > 0 ? (head.net / headTotal) * 100 : 0;
                      return (
                        <tr key={head.code} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">{head.label}</td>
                          <td className="px-6 py-4 text-sm text-right text-gray-700 tabular-nums">
                            {head.opdNet === 0 ? '—' : currency(head.opdNet)}
                          </td>
                          <td className="px-6 py-4 text-sm text-right text-gray-700 tabular-nums">
                            {head.ipdNet === 0 ? '—' : currency(head.ipdNet)}
                          </td>
                          <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900 tabular-nums">
                            {currency(head.net)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-600 h-2 rounded-full"
                                  style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
                                />
                              </div>
                              <span className="text-sm text-gray-600 tabular-nums w-12 text-right">
                                {share.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {data.heads.length > 0 && (
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td className="px-6 py-3 text-sm font-semibold text-gray-900">Total</td>
                        <td className="px-6 py-3 text-sm text-right font-semibold text-gray-900 tabular-nums">
                          {currency(data.billed.opdNet)}
                        </td>
                        <td className="px-6 py-3 text-sm text-right font-semibold text-gray-900 tabular-nums">
                          {currency(data.billed.ipdNet)}
                        </td>
                        <td className="px-6 py-3 text-sm text-right font-semibold text-gray-900 tabular-nums">
                          {currency(data.billed.net)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* By doctor */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-8">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Income by Doctor</h3>
                  <p className="text-xs text-gray-500">
                    OPD by the visit's doctor; IPD by the performing doctor on each bill line
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Doctor</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">OPD</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">IPD</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.doctors.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                          No income could be attributed to a doctor in this period.
                        </td>
                      </tr>
                    )}
                    {data.doctors.map((doctor) => (
                      <tr key={doctor.doctorId ?? 'none'} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{doctor.doctorName}</td>
                        <td className="px-6 py-4 text-sm text-right text-gray-700 tabular-nums">
                          {doctor.opd === 0 ? '—' : currency(doctor.opd)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-gray-700 tabular-nums">
                          {doctor.ipd === 0 ? '—' : currency(doctor.ipd)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900 tabular-nums">
                          {currency(doctor.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payer split + receipts by method */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Self-pay vs Credit</h3>
                <p className="text-xs text-gray-500 mb-4">
                  IPD only — OPD has no payer field, so every OPD rupee counts as self-pay
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-700">IPD — payer / TPA expected</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">
                      {currency(data.payerSplit.payerExpected)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-700">IPD — patient payable</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">
                      {currency(data.payerSplit.patientPayable)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm text-gray-700">OPD — self-pay</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">
                      {currency(data.billed.opdNet)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Receipts by Mode</h3>
                <p className="text-xs text-gray-500 mb-4">
                  All money in across OPD, IPD bills and advances, net of refunds
                </p>
                <div className="space-y-2">
                  {data.received.byMethod.length === 0 && (
                    <p className="text-sm text-gray-500">No receipts in this period.</p>
                  )}
                  {data.received.byMethod.map((row) => (
                    <div key={row.method} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-gray-700">
                        {METHOD_LABEL[row.method] || row.method}
                      </span>
                      <span className="text-sm font-semibold text-gray-900 tabular-nums">
                        {currency(row.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* How to read this */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 space-y-2">
                <p className="font-semibold">How to read this report</p>
                <p>
                  <b>Income earned</b> is what was billed in the period. <b>Cash received</b> is money
                  that moved in the period — the two are different figures and will not agree.
                  IPD advances are counted as cash received but are <b>not</b> income until billed
                  against.
                </p>
                <p>
                  Income comes from bill lines only. Pharmacy is a head inside each module, not a
                  module of its own — dispensing records are stock movements and are deliberately
                  not added in.
                </p>
                <p>
                  OPD medicine dispensed but never billed does not appear here, because OPD
                  dispensing carries no link back to the bill.
                </p>
                {(data.excluded.provisional > 0 || data.excluded.superseded > 0 || data.excluded.cancelled > 0) && (
                  <p>
                    Excluded from the IPD figures in this period:{' '}
                    {data.excluded.provisional} provisional (interim){', '}
                    {data.excluded.superseded} superseded by a final bill{', '}
                    {data.excluded.cancelled} cancelled.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default IncomeBreakup;
