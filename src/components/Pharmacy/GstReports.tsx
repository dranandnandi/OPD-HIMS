import React, { useState, useEffect } from 'react';
import { Download, Percent, AlertCircle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { gstService, GstPeriodSummary } from '../../services/gstService';
import { GstOutwardSummaryRow, GstHsnSummaryRow, GstInwardRegisterRow, GstOutwardRegisterRow } from '../../types';
import { useAuth } from '../Auth/useAuth';
import { inr, toCsv, downloadCsv } from '../../utils/gst';

type Tab = 'summary' | 'outward' | 'hsn' | 'sales' | 'purchases';

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
const n2 = (n: number) => n.toFixed(2);

/**
 * GST filing pack for the pharmacy. Period defaults to the previous month
 * (what is normally being filed). Every table has a CSV export.
 */
const GstReports: React.FC = () => {
  const { user } = useAuth();
  // Default to the current month so a purchase entered today shows up at once;
  // "Last month" is one click away when filing.
  const [from, setFrom] = useState(fmt(startOfMonth(new Date())));
  const [to, setTo] = useState(fmt(endOfMonth(new Date())));
  const [tab, setTab] = useState<Tab>('summary');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<GstPeriodSummary | null>(null);
  const [outward, setOutward] = useState<GstOutwardSummaryRow[]>([]);
  const [hsn, setHsn] = useState<GstHsnSummaryRow[]>([]);
  const [sales, setSales] = useState<GstOutwardRegisterRow[]>([]);
  const [purchases, setPurchases] = useState<GstInwardRegisterRow[]>([]);

  const clinic = user?.clinic;

  useEffect(() => {
    if (user) load();
  }, [user, from, to]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const f = new Date(`${from}T00:00:00`);
      const t = new Date(`${to}T00:00:00`);
      const [s, o, h, sr, pr] = await Promise.all([
        gstService.periodSummary(f, t),
        gstService.outwardSummary(f, t),
        gstService.hsnSummary(f, t),
        gstService.outwardRegister(f, t),
        gstService.inwardRegister(f, t)
      ]);
      setSummary(s); setOutward(o); setHsn(h); setSales(sr); setPurchases(pr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GST reports');
    } finally {
      setLoading(false);
    }
  };

  const setMonth = (offset: number) => {
    const d = subMonths(new Date(), offset);
    setFrom(fmt(startOfMonth(d)));
    setTo(fmt(endOfMonth(d)));
  };

  const exportCurrent = () => {
    const stamp = `${from}-to-${to}`;
    switch (tab) {
      case 'outward':
        downloadCsv(`gstr1-b2c-rate-wise-${stamp}.csv`, toCsv(
          ['Type', 'GST Rate', 'Invoices', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
          outward.map(r => [r.kind, r.gstRate, r.invoiceCount, n2(r.taxableAmount), n2(r.cgstAmount), n2(r.sgstAmount), n2(r.igstAmount), n2(r.totalAmount)])));
        break;
      case 'hsn':
        downloadCsv(`gstr1-hsn-summary-${stamp}.csv`, toCsv(
          ['HSN', 'GST Rate', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
          hsn.map(r => [r.hsnCode, r.gstRate, r.quantity, n2(r.taxableAmount), n2(r.cgstAmount), n2(r.sgstAmount), n2(r.igstAmount), n2(r.totalAmount)])));
        break;
      case 'sales':
        downloadCsv(`pharmacy-sales-register-${stamp}.csv`, toCsv(
          ['Invoice No', 'Date', 'Patient', 'Status', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round off', 'Total', 'Refunded'],
          sales.map(r => [r.billNumber, format(r.billDate, 'dd/MM/yyyy'), r.patientName || '', r.status, n2(r.taxableAmount), n2(r.cgstAmount), n2(r.sgstAmount), n2(r.igstAmount), n2(r.roundOff), n2(r.totalAmount), n2(r.refundedAmount)])));
        break;
      case 'purchases':
        downloadCsv(`gstr2-inward-register-${stamp}.csv`, toCsv(
          ['Type', 'Document No', 'Date', 'Supplier', 'Supplier GSTIN', 'Supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
          purchases.map(r => [r.kind, r.documentNumber || '', format(r.documentDate, 'dd/MM/yyyy'), r.supplierName || '', r.supplierGstin || '', r.isInterstate ? 'Inter-state' : 'Intra-state', n2(r.taxableAmount), n2(r.cgstAmount), n2(r.sgstAmount), n2(r.igstAmount), n2(r.totalAmount)])));
        break;
      default:
        if (summary) {
          downloadCsv(`gst-summary-${stamp}.csv`, toCsv(
            ['Section', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
            [
              ['Outward supplies (sales)', n2(summary.outward.taxable), n2(summary.outward.cgst), n2(summary.outward.sgst), n2(summary.outward.igst), n2(summary.outward.total)],
              ['Credit notes (refunds)', n2(summary.outward.creditNotes.taxable), n2(summary.outward.creditNotes.cgst), n2(summary.outward.creditNotes.sgst), n2(summary.outward.creditNotes.igst), n2(summary.outward.creditNotes.total)],
              ['Inward supplies (purchases)', n2(summary.inward.taxable), n2(summary.inward.cgst), n2(summary.inward.sgst), n2(summary.inward.igst), n2(summary.inward.total)],
              ['Debit notes (returns)', n2(summary.inward.debitNotes.taxable), n2(summary.inward.debitNotes.cgst), n2(summary.inward.debitNotes.sgst), n2(summary.inward.debitNotes.igst), n2(summary.inward.debitNotes.total)],
              ['Net payable', '', n2(summary.netPayable.cgst), n2(summary.netPayable.sgst), n2(summary.netPayable.igst), n2(summary.netPayable.total)]
            ]));
        }
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'summary', label: 'Summary (GSTR-3B)' },
    { id: 'outward', label: 'Outward by rate (GSTR-1 B2C)' },
    { id: 'hsn', label: 'HSN summary (GSTR-1 T12)' },
    { id: 'sales', label: 'Sales register' },
    { id: 'purchases', label: 'Inward register (GSTR-2B / ITC)' }
  ];

  const th = 'px-3 py-3 text-xs uppercase text-gray-500';
  const tdR = 'px-3 py-2 text-right';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Percent className="w-6 h-6 text-blue-600" /> GST Reports</h2>
          <p className="text-gray-600">
            Pharmacy output tax, input credit and net liability for filing
            {clinic?.gstin && <> · GSTIN <span className="font-mono">{clinic.gstin}</span></>}
          </p>
        </div>
        <button onClick={exportCurrent} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {!clinic?.gstin && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>Clinic GSTIN is not set. Add it in Settings → Clinic → GST so invoices and exports carry it.</span>
        </div>
      )}
      {clinic?.pharmacyGstScheme === 'composition' && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm">
          Composition scheme: no output tax is charged on sales and no input credit is claimed. Use the sales register total as the quarterly turnover for CMP-08.
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMonth(1)} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Last month</button>
          <button onClick={() => setMonth(0)} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">This month</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md">
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav className="flex min-w-max">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap ${tab === t.id ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-800'}`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {error && <div className="m-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            {tab === 'summary' && summary && (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-xs uppercase text-gray-500 mb-1">Output tax (sales)</div>
                    <div className="text-2xl font-bold text-gray-800">{inr(summary.outward.cgst + summary.outward.sgst + summary.outward.igst + summary.outward.creditNotes.cgst + summary.outward.creditNotes.sgst + summary.outward.creditNotes.igst)}</div>
                    <div className="text-xs text-gray-500 mt-1">on taxable {inr(summary.outward.taxable + summary.outward.creditNotes.taxable)} net of credit notes</div>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="text-xs uppercase text-gray-500 mb-1">Input tax credit (purchases)</div>
                    <div className="text-2xl font-bold text-gray-800">{inr(summary.inward.cgst + summary.inward.sgst + summary.inward.igst + summary.inward.debitNotes.cgst + summary.inward.debitNotes.sgst + summary.inward.debitNotes.igst)}</div>
                    <div className="text-xs text-gray-500 mt-1">on taxable {inr(summary.inward.taxable + summary.inward.debitNotes.taxable)} net of debit notes</div>
                  </div>
                  <div className={`border rounded-lg p-4 ${summary.netPayable.total >= 0 ? 'border-blue-300 bg-blue-50' : 'border-green-300 bg-green-50'}`}>
                    <div className="text-xs uppercase text-gray-600 mb-1">{summary.netPayable.total >= 0 ? 'Net GST payable' : 'Excess credit carried forward'}</div>
                    <div className="text-2xl font-bold text-gray-900">{inr(Math.abs(summary.netPayable.total))}</div>
                    <div className="text-xs text-gray-600 mt-1">CGST {inr(summary.netPayable.cgst)} · SGST {inr(summary.netPayable.sgst)} · IGST {inr(summary.netPayable.igst)}</div>
                  </div>
                </div>

                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr><th className={`${th} text-left`}>Section</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th><th className={`${th} text-right`}>Total</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {[
                      ['3.1(a) Outward taxable supplies (pharmacy sales)', summary.outward],
                      ['Less: credit notes (refunds)', summary.outward.creditNotes],
                      ['4(A)(5) Inward supplies eligible for ITC (purchases)', summary.inward],
                      ['Less: debit notes (returns to supplier)', summary.inward.debitNotes]
                    ].map(([label, v]) => {
                      const s = v as { taxable: number; cgst: number; sgst: number; igst: number; total: number };
                      return (
                        <tr key={label as string}>
                          <td className="px-3 py-2">{label as string}</td>
                          <td className={tdR}>{n2(s.taxable)}</td><td className={tdR}>{n2(s.cgst)}</td><td className={tdR}>{n2(s.sgst)}</td><td className={tdR}>{n2(s.igst)}</td><td className={`${tdR} font-medium`}>{n2(s.total)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-100 font-semibold">
                      <td className="px-3 py-2">Net tax payable (output − ITC)</td>
                      <td className={tdR}></td><td className={tdR}>{n2(summary.netPayable.cgst)}</td><td className={tdR}>{n2(summary.netPayable.sgst)}</td><td className={tdR}>{n2(summary.netPayable.igst)}</td><td className={tdR}>{n2(summary.netPayable.total)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-xs text-gray-500">
                  Covers the pharmacy only. Consultation and procedure income on OPD bills is a healthcare service and is exempt from GST, so it is not included here.
                  Purchases from suppliers without a GSTIN carry no eligible ITC; check the inward register for "missing" GSTINs.
                </p>
              </div>
            )}

            {tab === 'outward' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className={`${th} text-left`}>Type</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Invoices</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th><th className={`${th} text-right`}>Total</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {outward.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No pharmacy invoices in this period</td></tr>}
                  {outward.map((r, i) => (
                    <tr key={i} className={r.kind === 'credit_note' ? 'text-red-700' : ''}>
                      <td className="px-3 py-2 capitalize">{r.kind.replace('_', ' ')}</td>
                      <td className={tdR}>{r.gstRate}%</td><td className={tdR}>{r.invoiceCount}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.cgstAmount)}</td><td className={tdR}>{n2(r.sgstAmount)}</td><td className={tdR}>{n2(r.igstAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'hsn' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className={`${th} text-left`}>HSN</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th><th className={`${th} text-right`}>Total</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {hsn.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No data</td></tr>}
                  {hsn.map((r, i) => (
                    <tr key={i} className={r.hsnCode === 'UNMAPPED' ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-2 font-mono">{r.hsnCode}{r.hsnCode === 'UNMAPPED' && <span className="ml-2 text-xs text-amber-700">set HSN on these medicines in Master Data</span>}</td>
                      <td className={tdR}>{r.gstRate}%</td><td className={tdR}>{r.quantity}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.cgstAmount)}</td><td className={tdR}>{n2(r.sgstAmount)}</td><td className={tdR}>{n2(r.igstAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'sales' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className={`${th} text-left`}>Invoice</th><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Patient</th><th className={`${th} text-left`}>Status</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Refunded</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sales.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">No pharmacy invoices in this period</td></tr>}
                  {sales.map(r => (
                    <tr key={r.billId} className={r.status === 'cancelled' ? 'text-gray-400 line-through' : ''}>
                      <td className="px-3 py-2 font-mono">{r.billNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{format(r.billDate, 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2">{r.patientName || '—'}</td>
                      <td className="px-3 py-2 capitalize">{r.status}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.cgstAmount)}</td><td className={tdR}>{n2(r.sgstAmount)}</td>
                      <td className={`${tdR} font-medium`}>{n2(r.totalAmount)}</td><td className={tdR}>{r.refundedAmount ? n2(r.refundedAmount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'purchases' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr><th className={`${th} text-left`}>Type</th><th className={`${th} text-left`}>Document</th><th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Supplier</th><th className={`${th} text-left`}>GSTIN</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>CGST</th><th className={`${th} text-right`}>SGST</th><th className={`${th} text-right`}>IGST</th><th className={`${th} text-right`}>Total</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {purchases.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No purchases in this period</td></tr>}
                  {purchases.map((r, i) => (
                    <tr key={i} className={r.kind === 'debit_note' ? 'text-red-700' : ''}>
                      <td className="px-3 py-2 capitalize">{r.kind.replace('_', ' ')}</td>
                      <td className="px-3 py-2 font-mono">{r.documentNumber}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{format(r.documentDate, 'dd MMM yyyy')}</td>
                      <td className="px-3 py-2">{r.supplierName || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.supplierGstin || <span className="text-amber-600">missing</span>}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.cgstAmount)}</td><td className={tdR}>{n2(r.sgstAmount)}</td><td className={tdR}>{n2(r.igstAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GstReports;
