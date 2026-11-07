import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { PharmacyDebitNote, PharmacyInwardReceipt, MedicineBatch, Supplier, SupplierCreditType } from '../../types';
import { pharmacyService, SupplierReturnInput } from '../../services/pharmacyService';
import { inr } from '../../utils/gst';
import { supplierReturnPreview, purchaseNetValue } from '../../utils/supplierReturns';

interface Props { onSave: () => void; onClose: () => void; existingReturn?: PharmacyDebitNote }
interface Row { inwardItemId: string; paidQuantity: number; freeQuantity: number; creditAmount: number }
const blank = (): Row => ({ inwardItemId: '', paidQuantity: 0, freeQuantity: 0, creditAmount: 0 });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const creditLabels = { stock_only: 'Credit pending / no credit', gst_credit: 'Supplier credit with GST adjustment', commercial_credit: 'Commercial credit (no GST adjustment)' };

const ReturnToSupplierModal: React.FC<Props> = ({ onSave, onClose, existingReturn }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<PharmacyInwardReceipt[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [returns, setReturns] = useState<PharmacyDebitNote[]>([]);
  const [supplierId, setSupplierId] = useState(existingReturn?.supplierId || '');
  const [receiptId, setReceiptId] = useState(existingReturn?.againstReceiptId || '');
  const [reason, setReason] = useState(existingReturn?.reason || '');
  const [creditType, setCreditType] = useState<SupplierCreditType>(existingReturn ? 'gst_credit' : 'stock_only');
  const [creditReference, setCreditReference] = useState('');
  const [creditDate, setCreditDate] = useState(today);
  const [rows, setRows] = useState<Row[]>(existingReturn?.items?.map(i => ({
    inwardItemId: i.inwardItemId || '', paidQuantity: i.paidQuantity || 0, freeQuantity: i.freeQuantity || 0, creditAmount: 0,
  })) || [blank()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const request = useRef<{ id: string; payload?: SupplierReturnInput }>({ id: crypto.randomUUID() });
  useEffect(() => { let active = true;
    Promise.all([pharmacyService.getSuppliers(), pharmacyService.getInwardReceipts(), pharmacyService.getDebitNotes(), pharmacyService.getBatches(undefined, true)])
      .then(([s, r, d, b]) => { if (active) { setSuppliers(s); setReceipts(r); setReturns(d); setBatches(b); } })
      .catch(e => { if (active) setError(e.message || 'Could not load purchases'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const receipt = receipts.find(r => r.id === receiptId);
  const sources = receipt?.inwardItems || [];
  const prior = (id: string) => returns.filter(d => d.id !== existingReturn?.id).flatMap(d => d.items || []).filter(i => i.inwardItemId === id);
  const update = (index: number, patch: Partial<Row>) => setRows(rs => rs.map((r, i) => i === index ? { ...r, ...patch } : r));
  const preview = (r: Row) => supplierReturnPreview(sources.find(i => i.id === r.inwardItemId), r, creditType, prior(r.inwardItemId));
  const total = rows.reduce((sum, r) => sum + preview(r).total, 0);
  const save = async () => {
    if (saving) return;
    try {
      setSaving(true); setError('');
      if (!request.current.payload) {
        if (!receiptId || !supplierId || !reason.trim() || !rows.length || rows.some(r => !r.inwardItemId || r.paidQuantity + r.freeQuantity <= 0)) {
          throw new Error('Select an invoice, enter a reason and add quantities to return.');
        }
        if (new Set(rows.map(r => r.inwardItemId)).size !== rows.length) throw new Error('Select each purchase line only once.');
        if (creditType !== 'stock_only' && (!creditReference.trim() || !creditDate)) throw new Error('Enter the supplier credit reference and date.');
        request.current.payload = { requestId: request.current.id, noteId: existingReturn?.id, supplierId, receiptId,
          reason: reason.trim(), creditType, creditReference, creditDate,
          items: rows.map(r => ({ ...r, creditAmount: creditType === 'stock_only' ? 0 : r.creditAmount })) };
        setSubmitted(true);
      }
      await pharmacyService.createDebitNote(request.current.payload);
      onSave(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save return');
      if ((e as { requestRejected?: boolean })?.requestRejected || !request.current.payload) {
        request.current = { id: crypto.randomUUID() }; setSubmitted(false);
      }
    }
    finally { setSaving(false); }
  };
  const cls = 'w-full border border-gray-300 rounded px-2 py-2 text-sm disabled:bg-gray-100';
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto">
      <div className="flex justify-between p-5 border-b"><div>
        <h2 className="text-xl font-bold">{existingReturn ? 'Record supplier credit' : 'Return to supplier'}</h2>
        <p className="text-sm text-gray-600">{existingReturn ? 'Stock was already returned. Recording credit will not move it again.' : 'Select the original purchase and return paid and scheme packs separately.'}</p>
      </div><button aria-label="Close" disabled={saving} onClick={onClose}><X /></button></div>
      <div className="p-5 space-y-4">
        {error && <p role="alert" className="bg-red-50 text-red-700 p-3 rounded">{error}</p>}
        {loading ? <p>Loading purchases and previous returns...</p> : <>
          <fieldset disabled={saving || submitted} className="space-y-4 disabled:opacity-70">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm">Supplier<select className={cls} value={supplierId} disabled={!!existingReturn}
                onChange={e => { setSupplierId(e.target.value); setReceiptId(''); setRows([blank()]); }}>
                <option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
              <label className="text-sm">Purchase invoice<select className={cls} value={receiptId} disabled={!supplierId || !!existingReturn}
                onChange={e => { setReceiptId(e.target.value); setRows([blank()]); }}>
                <option value="">Select original invoice</option>{receipts.filter(r => r.supplierId === supplierId).map(r =>
                  <option key={r.id} value={r.id}>{r.invoiceNumber} | {r.receiptDate.toLocaleDateString('en-IN')}</option>)}
              </select></label>
            </div>
            <label className="block text-sm">Supplier credit<select className={cls} value={creditType} onChange={e => setCreditType(e.target.value as SupplierCreditType)}>
              {Object.entries(creditLabels).filter(([key]) => !existingReturn || key !== 'stock_only').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            {creditType !== 'stock_only' && <div className="grid md:grid-cols-2 gap-3">
              <label className="text-sm">Supplier credit reference<input className={cls} value={creditReference} onChange={e => setCreditReference(e.target.value)} /></label>
              <label className="text-sm">Supplier credit date<input type="date" className={cls} max={today()} value={creditDate} onChange={e => setCreditDate(e.target.value)} /></label>
            </div>}
            <p className="text-xs bg-blue-50 p-3 rounded">10 paid + 2 scheme packs means 12 packs in stock. Returning the full lot normally credits only the 10 invoiced packs. Match the credit amount to the supplier's document. GST comes from the original purchase.</p>
            {rows.map((r, index) => {
              const source = sources.find(i => i.id === r.inwardItemId);
              const previous = prior(r.inwardItemId);
              const paidLeft = (source?.quantity || 0) - previous.reduce((s, i) => s + (i.paidQuantity || 0), 0);
              const freeLeft = (source?.freeQuantity || 0) - previous.reduce((s, i) => s + (i.freeQuantity || 0), 0);
              const t = preview(r);
              return <div key={index} className="border rounded p-3 space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <label className="text-xs col-span-2">Purchase line / batch<select className={cls} disabled={!!existingReturn || !receiptId} value={r.inwardItemId}
                    onChange={e => update(index, { inwardItemId: e.target.value, paidQuantity: 0, freeQuantity: 0, creditAmount: 0 })}>
                    <option value="">Select purchase line</option>{sources.map(i => <option key={i.id} value={i.id}>{i.medicine?.name || i.medicineId} | {i.batchNumber || 'Unbatched'}</option>)}
                  </select></label>
                  <label className="text-xs">Paid packs returned<input className={cls} type="number" min="0" step="1" max={paidLeft} disabled={!!existingReturn} value={r.paidQuantity}
                    onChange={e => { const paidQuantity = Number(e.target.value); update(index, { paidQuantity,
                      creditAmount: source ? Math.round(purchaseNetValue(source) / source.quantity * paidQuantity * 100) / 100 : 0 }); }} /></label>
                  <label className="text-xs">Free packs returned<input className={cls} type="number" min="0" step="1" max={freeLeft} disabled={!!existingReturn} value={r.freeQuantity}
                    onChange={e => update(index, { freeQuantity: Number(e.target.value) })} /></label>
                  <label className="text-xs">{creditType === 'commercial_credit' ? 'Agreed credit (INR)' : 'Credit before GST (INR)'}<input className={cls} type="number" min="0" step="0.01"
                    disabled={creditType === 'stock_only'} value={creditType === 'stock_only' ? 0 : r.creditAmount} onChange={e => update(index, { creditAmount: Number(e.target.value) })} /></label>
                  <div className="flex items-end gap-2"><span className="text-sm">Total {r.paidQuantity + r.freeQuantity} packs</span>
                    {!existingReturn && <button aria-label="Remove return line" onClick={() => setRows(rs => rs.filter((_, i) => i !== index))}><Trash2 className="w-4 h-4 text-red-600" /></button>}</div>
                </div>
                {source && <p className="text-xs text-gray-600">Remaining entitlement: {paidLeft} paid + {freeLeft} free packs (also subject to current stock).
                  {source.batchId && <> | Current batch stock: {batches.find(b => b.id === source.batchId)?.quantity ?? 0} packs</>}
                  {' '}GST {source.gstRate ?? 0}% | Tax credit {inr(t.cgst + t.sgst + t.igst)} | Credit total {inr(t.total)}
                  {' '}<button className="text-blue-600 underline" onClick={() => update(index, { creditAmount: Math.round(purchaseNetValue(source) / source.quantity * r.paidQuantity * 100) / 100 })}>Use paid-pack credit</button></p>}
              </div>;
            })}
            {!existingReturn && <button className="text-blue-600 text-sm flex items-center gap-1" disabled={!receiptId} onClick={() => setRows(rs => [...rs, blank()])}><Plus size={16} />Add purchase line</button>}
            <label className="block text-sm">Reason<textarea className={cls} value={reason} disabled={!!existingReturn} onChange={e => setReason(e.target.value)} /></label>
          </fieldset>
          <p className="font-semibold">Supplier credit total: {inr(total)}</p>
          <p className="text-xs text-gray-600">{creditType === 'stock_only' ? 'Stock moves now with no purchase or GST credit. You can record the supplier credit later from Purchase Register > Debit Notes.' : creditType === 'commercial_credit' ? 'This records a commercial credit without reducing input GST.' : 'GST credit is recorded against the supplier credit date. The original purchase invoice stays intact.'}</p>
          {submitted && error && <p className="text-xs text-amber-700">Retry uses the same request to prevent duplicate stock movement. To correct rejected details, close and reopen after checking the return register.</p>}
          <div className="flex justify-end gap-3"><button className="px-4 py-2 border rounded" disabled={saving} onClick={onClose}>Close</button>
            <button className="px-4 py-2 bg-orange-600 text-white rounded disabled:opacity-50" disabled={saving || !receipt || !rows.length}
              onClick={save}>{saving ? 'Saving...' : submitted ? 'Retry same request' : existingReturn ? 'Save supplier credit' : 'Record return'}</button></div>
        </>}
      </div>
    </div>
  </div>;
};
export default ReturnToSupplierModal;
