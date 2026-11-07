import MedicineFlags from './MedicineFlags';
import React, { useState, useEffect } from 'react';
import { Download, ChevronDown, ChevronRight, FileText, RotateCcw, Plus, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { PharmacyInwardReceipt, PharmacyInwardItem, PharmacyDebitNote } from '../../types';
import { pharmacyService } from '../../services/pharmacyService';
import { useAuth } from '../Auth/useAuth';
import { inr, toCsv, downloadCsv } from '../../utils/gst';
import InwardLineCorrectionModal from './InwardLineCorrectionModal';
import ReturnToSupplierModal from './ReturnToSupplierModal';
import { purchaseNetValue } from '../../utils/supplierReturns';

const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Purchase register: every supplier invoice and debit note in a period with
 * its GST split. This is the book a CA asks for when reconciling GSTR-2B.
 */
const PurchaseRegister: React.FC = () => {
  const { user } = useAuth();
  const [from, setFrom] = useState(fmtDate(startOfMonth(new Date())));
  const [to, setTo] = useState(fmtDate(endOfMonth(new Date())));
  const [receipts, setReceipts] = useState<PharmacyInwardReceipt[]>([]);
  const [debitNotes, setDebitNotes] = useState<PharmacyDebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creditReturn, setCreditReturn] = useState<PharmacyDebitNote | null>(null);
  const [tab, setTab] = useState<'purchases' | 'returns'>('purchases');
  // The line being put right after a bad scan, with the invoice it belongs to.
  const [correcting, setCorrecting] = useState<{ receipt: PharmacyInwardReceipt; item: PharmacyInwardItem } | null>(null);

  useEffect(() => {
    if (user) load();
  }, [user, from, to]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const range = { from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59`) };
      const [r, d] = await Promise.all([
        pharmacyService.getInwardReceipts(range),
        pharmacyService.getDebitNotes(range)
      ]);
      setReceipts(r);
      setDebitNotes(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchase register');
    } finally {
      setLoading(false);
    }
  };

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const rTotals = {
    taxable: sum(receipts.map(r => r.taxableAmount || 0)),
    cgst: sum(receipts.map(r => r.cgstAmount || 0)),
    sgst: sum(receipts.map(r => r.sgstAmount || 0)),
    igst: sum(receipts.map(r => r.igstAmount || 0)),
    total: sum(receipts.map(r => r.grandTotal || r.totalAmount || 0))
  };
  const dTotals = {
    taxable: sum(debitNotes.map(d => d.taxableAmount)),
    cgst: sum(debitNotes.map(d => d.cgstAmount)),
    sgst: sum(debitNotes.map(d => d.sgstAmount)),
    igst: sum(debitNotes.map(d => d.igstAmount)),
    total: sum(debitNotes.map(d => d.grandTotal))
  };

  const exportCsv = () => {
    if (tab === 'purchases') {
      const rows = receipts.map(r => [
        format(r.supplierInvoiceDate || r.receiptDate, 'dd/MM/yyyy'), r.invoiceNumber || '', r.supplier?.name || '', r.supplier?.gstin || '',
        r.isInterstate ? 'IGST' : 'CGST+SGST', r.taxableAmount?.toFixed(2), r.cgstAmount?.toFixed(2), r.sgstAmount?.toFixed(2),
        r.igstAmount?.toFixed(2), (r.grandTotal || r.totalAmount).toFixed(2), r.inwardItems?.length || 0
      ]);
      downloadCsv(`purchase-register-${from}-to-${to}.csv`, toCsv(
        ['Invoice Date', 'Invoice No', 'Supplier', 'Supplier GSTIN', 'Supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Items'], rows));
    } else {
      const rows = debitNotes.map(d => [
        format(d.creditDate ? new Date(`${d.creditDate}T12:00:00`) : d.noteDate, 'dd/MM/yyyy'), d.debitNoteNumber, d.supplier?.name || '', d.supplier?.gstin || '', d.reason || '',
        d.taxableAmount.toFixed(2), d.cgstAmount.toFixed(2), d.sgstAmount.toFixed(2), d.igstAmount.toFixed(2), d.grandTotal.toFixed(2), d.creditType || 'gst_credit', d.creditReference || '', d.creditDate || '',
        (d.items || []).reduce((s, i) => s + (i.paidQuantity || 0), 0), (d.items || []).reduce((s, i) => s + (i.freeQuantity || 0), 0),
        (d.items || []).reduce((s, i) => s + Number(i.quantity), 0)
      ]);
      downloadCsv(`debit-notes-${from}-to-${to}.csv`, toCsv(
        ['Date', 'Debit Note No', 'Supplier', 'Supplier GSTIN', 'Reason', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Credit treatment', 'Supplier credit reference', 'Credit date', 'Paid packs', 'Free packs', 'Total returned packs'], rows));
    }
  };

  const exportLinesCsv = () => {
    const rows = receipts.flatMap(r => (r.inwardItems || []).map(i => [
      r.invoiceNumber || '', r.supplier?.name || '', i.medicine?.name || i.medicineId, i.batchNumber || '',
      i.quantity, i.freeQuantity || 0, i.quantity + (i.freeQuantity || 0), i.packSize || 1,
      i.unitCostPrice.toFixed(2), (purchaseNetValue(i) / (i.quantity + (i.freeQuantity || 0))).toFixed(4),
      i.discountPercent || 0, i.gstRate || 0, purchaseNetValue(i).toFixed(2), (i.lineTotal ?? i.totalCostPrice).toFixed(2),
    ]));
    downloadCsv(`purchase-lines-${from}-to-${to}.csv`, toCsv(
      ['Invoice', 'Supplier', 'Medicine', 'Batch', 'Paid packs', 'Free packs', 'Received packs', 'Units per pack',
       'Invoice rate ex-GST', 'Effective cost per pack ex-GST', 'Purchase discount %', 'GST %', 'Taxable', 'Line total'], rows));
  };

  const toggle = (id: string) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Purchase Register</h2>
          <p className="text-gray-600">Supplier invoices and returns. Credits use the supplier credit date; pending returns use the return date.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/pharmacy/inward" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> New Purchase
          </Link>
          {tab === 'purchases' && <button onClick={exportLinesCsv} className="border border-gray-300 px-3 py-2 rounded-lg text-sm">Lines CSV</button>}
          <button onClick={exportCsv} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setTab('purchases')} className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm ${tab === 'purchases' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            <FileText className="w-4 h-4" /> Purchases ({receipts.length})
          </button>
          <button onClick={() => setTab('returns')} className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm ${tab === 'returns' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            <RotateCcw className="w-4 h-4" /> Debit Notes ({debitNotes.length})
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
      ) : tab === 'purchases' ? (
        <div className="bg-white rounded-lg shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left w-8"></th>
                <th className="px-3 py-3 text-left">Invoice Date</th>
                <th className="px-3 py-3 text-left">Invoice No</th>
                <th className="px-3 py-3 text-left">Supplier</th>
                <th className="px-3 py-3 text-left">GSTIN</th>
                <th className="px-3 py-3 text-right">Taxable</th>
                <th className="px-3 py-3 text-right">CGST</th>
                <th className="px-3 py-3 text-right">SGST</th>
                <th className="px-3 py-3 text-right">IGST</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {receipts.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No purchases in this period</td></tr>
              )}
              {receipts.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.id)}>
                    <td className="px-3 py-3 text-gray-400">{expanded[r.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{format(r.supplierInvoiceDate || r.receiptDate, 'dd MMM yyyy')}</td>
                    <td className="px-3 py-3 font-medium">{r.invoiceNumber}</td>
                    <td className="px-3 py-3">{r.supplier?.name || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.supplier?.gstin || <span className="text-amber-600">missing</span>}</td>
                    <td className="px-3 py-3 text-right">{(r.taxableAmount || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{(r.cgstAmount || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{(r.sgstAmount || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{(r.igstAmount || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{(r.grandTotal || r.totalAmount).toFixed(2)}</td>
                  </tr>
                  {expanded[r.id] && (
                    <tr className="bg-gray-50">
                      <td colSpan={10} className="px-6 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="text-left py-1">Medicine</th><th className="text-left py-1">HSN</th><th className="text-left py-1">Batch</th>
                              <th className="text-left py-1">Expiry</th><th className="text-right py-1">Paid</th><th className="text-right py-1">Free</th><th className="text-right py-1">Received</th><th className="text-right py-1">Effective cost</th>
                              <th className="text-right py-1">MRP</th><th className="text-right py-1">Rate</th><th className="text-right py-1">Disc%</th>
                              <th className="text-right py-1">GST%</th><th className="text-right py-1">Taxable</th><th className="text-right py-1">Tax</th><th className="text-right py-1">Total</th>
                              <th className="text-right py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {(r.inwardItems || []).map(i => (
                              <tr key={i.id} className="border-t border-gray-200">
                                <td className="py-1">{i.medicine?.name || i.medicineId}<MedicineFlags medicine={i.medicine} /></td>
                                {/* Only the HSN the supplier's invoice carried. Falling back to
                                    the master's current HSN would make an old purchase appear to
                                    change every time someone corrects the medicine. */}
                                <td className="py-1" title={i.hsnCode ? undefined : 'This purchase invoice carried no HSN for the line'}>
                                  {i.hsnCode || '—'}
                                </td>
                                <td className="py-1">{i.batchNumber || '—'}</td>
                                <td className="py-1">{i.expiryDate ? format(i.expiryDate, 'MM/yy') : '—'}</td>
                                <td className="py-1 text-right">{i.quantity}</td>
                                <td className="py-1 text-right">{i.freeQuantity || 0}</td>
                                <td className="py-1 text-right">{i.quantity + (i.freeQuantity || 0)}</td>
                                <td className="py-1 text-right" title="Net invoice value spread across paid and free packs, excluding GST">{(purchaseNetValue(i) / (i.quantity + (i.freeQuantity || 0))).toFixed(2)}</td>
                                <td className="py-1 text-right">{i.mrp?.toFixed(2) || '—'}</td>
                                <td className="py-1 text-right">{i.unitCostPrice.toFixed(2)}</td>
                                <td className="py-1 text-right">{i.discountPercent || 0}</td>
                                <td className="py-1 text-right">{i.gstRate ?? 0}</td>
                                <td className="py-1 text-right">{(i.taxableAmount ?? i.totalCostPrice).toFixed(2)}</td>
                                <td className="py-1 text-right">{((i.cgstAmount || 0) + (i.sgstAmount || 0) + (i.igstAmount || 0)).toFixed(2)}</td>
                                <td className="py-1 text-right font-medium">{(i.lineTotal ?? i.totalCostPrice).toFixed(2)}</td>
                                <td className="py-1 text-right">
                                  <button
                                    onClick={() => setCorrecting({ receipt: r, item: i })}
                                    title="Correct this line — the scan read the invoice wrong"
                                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.remarks && <p className="mt-2 text-xs text-gray-500">Remarks: {r.remarks}</p>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            {receipts.length > 0 && (
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-right">Totals</td>
                  <td className="px-3 py-3 text-right">{rTotals.taxable.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{rTotals.cgst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{rTotals.sgst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{rTotals.igst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{rTotals.total.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <div className="px-4 py-3 text-sm text-gray-600 border-t">
            Input tax credit for the period: <strong>{inr(rTotals.cgst + rTotals.sgst + rTotals.igst)}</strong>
            {dTotals.total > 0 && <> less debit notes <strong>{inr(dTotals.cgst + dTotals.sgst + dTotals.igst)}</strong></>}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left w-8"></th>
                <th className="px-3 py-3 text-left">Document date</th>
                <th className="px-3 py-3 text-left">Debit Note</th>
                <th className="px-3 py-3 text-left">Supplier</th>
                <th className="px-3 py-3 text-left">Reason</th>
                <th className="px-3 py-3 text-right">Taxable</th>
                <th className="px-3 py-3 text-right">CGST</th>
                <th className="px-3 py-3 text-right">SGST</th>
                <th className="px-3 py-3 text-right">IGST</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {debitNotes.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No returns in this period</td></tr>
              )}
              {debitNotes.map(d => (
                <React.Fragment key={d.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggle(d.id)}>
                    <td className="px-3 py-3 text-gray-400">{expanded[d.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{format(d.creditDate ? new Date(`${d.creditDate}T12:00:00`) : d.noteDate, 'dd MMM yyyy')}</td>
                    <td className="px-3 py-3 font-medium font-mono">{d.debitNoteNumber}</td>
                    <td className="px-3 py-3">{d.supplier?.name || '—'}</td>
                    <td className="px-3 py-3 text-gray-600 max-w-xs truncate">{d.reason}</td>
                    <td className="px-3 py-3 text-right">{d.taxableAmount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{d.cgstAmount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{d.sgstAmount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{d.igstAmount.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{d.grandTotal.toFixed(2)}</td>
                  </tr>
                  {expanded[d.id] && (
                    <tr className="bg-gray-50">
                      <td colSpan={10} className="px-6 py-3">
                        <p className="mb-2 text-xs">Stock returned: {format(d.noteDate, 'dd MMM yyyy')} | {d.creditType === 'stock_only' ? 'Supplier credit pending / no credit' : d.creditType === 'commercial_credit' ? 'Commercial credit, no GST adjustment' : 'GST credit'}
                          {d.creditReference && <> | Supplier reference: {d.creditReference} | Date: {d.creditDate}</>}
                        </p>
                        {d.creditType === 'stock_only' && d.items?.every(i => i.inwardItemId) && <button className="mb-3 text-blue-600 text-sm underline" onClick={() => setCreditReturn(d)}>Record supplier credit</button>}
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr><th className="text-left py-1">Medicine</th><th className="text-left py-1">Batch</th><th className="text-right py-1">Paid / Free</th><th className="text-right py-1">Total packs</th><th className="text-right py-1">Rate</th><th className="text-right py-1">GST%</th><th className="text-right py-1">Taxable</th><th className="text-right py-1">Total</th></tr>
                          </thead>
                          <tbody>
                            {(d.items || []).map(i => (
                              <tr key={i.id} className="border-t border-gray-200">
                                <td className="py-1">{i.medicine?.name || i.medicineId}<MedicineFlags medicine={i.medicine} /></td>
                                <td className="py-1">{i.batchNumber || '—'}</td>
                                <td className="py-1 text-right">{i.inwardItemId ? `${i.paidQuantity || 0} / ${i.freeQuantity || 0}` : "Legacy: not split"}</td>
                                <td className="py-1 text-right">{i.quantity}</td>
                                <td className="py-1 text-right">{i.unitRate.toFixed(2)}</td>
                                <td className="py-1 text-right">{i.gstRate}</td>
                                <td className="py-1 text-right">{i.taxableAmount.toFixed(2)}</td>
                                <td className="py-1 text-right font-medium">{i.lineTotal.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            {debitNotes.length > 0 && (
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-right">Totals</td>
                  <td className="px-3 py-3 text-right">{dTotals.taxable.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{dTotals.cgst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{dTotals.sgst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{dTotals.igst.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{dTotals.total.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {creditReturn && <ReturnToSupplierModal existingReturn={creditReturn} onSave={() => { setCreditReturn(null); load(); }} onClose={() => setCreditReturn(null)} />}
      {correcting && (
        <InwardLineCorrectionModal
          receipt={correcting.receipt}
          item={correcting.item}
          onSaved={() => { setCorrecting(null); load(); }}
          onClose={() => setCorrecting(null)}
        />
      )}
    </div>
  );
};

export default PurchaseRegister;
