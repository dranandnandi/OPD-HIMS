import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Package, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { MedicineWithPrice, Supplier, MedicineBatch, PharmacyInwardReceipt } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import { pharmacyService, DebitNoteItemInput } from '../../services/pharmacyService';
import { useAuth } from '../Auth/useAuth';
import { computeGstLine, sumGstLines, GST_RATES, inr, isInterstate, stateCodeFromGstin } from '../../utils/gst';
import { packSpec, stockBreakdown } from '../../utils/packUnits';

interface ReturnToSupplierModalProps {
  onSave: () => void;
  onClose: () => void;
}

interface ReturnRow {
  medicineId: string;
  batchId: string;
  quantity: number;
  unitRate: number;
  gstRate: number;
}

const emptyRow = (): ReturnRow => ({ medicineId: '', batchId: '', quantity: 1, unitRate: 0, gstRate: 12 });

/**
 * Return to supplier = debit note. Reduces stock (and the batch), and reverses
 * the input GST on the returned goods so the inward register stays right.
 */
const ReturnToSupplierModal: React.FC<ReturnToSupplierModalProps> = ({ onSave, onClose }) => {
  const { user } = useAuth();
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<PharmacyInwardReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState('');
  const [againstReceiptId, setAgainstReceiptId] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<ReturnRow[]>([emptyRow()]);

  const clinicState = user?.clinic?.gstStateCode || stateCodeFromGstin(user?.clinic?.gstin);
  const supplier = suppliers.find(s => s.id === supplierId);
  const interstate = isInterstate(clinicState, supplier?.stateCode || stateCodeFromGstin(supplier?.gstin));

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [medicinesData, suppliersData, batchesData, receiptsData] = await Promise.all([
        masterDataService.getMedicines(user?.clinicId),
        pharmacyService.getSuppliers(),
        pharmacyService.getBatches(),
        pharmacyService.getInwardReceipts()
      ]);
      setMedicines(medicinesData.filter(m => m.currentStock > 0));
      setSuppliers(suppliersData);
      setBatches(batchesData);
      setReceipts(receiptsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const batchesFor = (medicineId: string) => batches.filter(b => b.medicineId === medicineId && b.quantity > 0);
  const supplierReceipts = receipts.filter(r => r.supplierId === supplierId);

  const updateRow = (index: number, patch: Partial<ReturnRow>) => {
    setRows(rows.map((r, i) => {
      if (i !== index) return r;
      const next = { ...r, ...patch };
      if (patch.medicineId !== undefined) {
        const m = medicines.find(x => x.id === patch.medicineId);
        const b = m ? batchesFor(m.id)[0] : undefined;
        next.batchId = b?.id || '';
        next.unitRate = b?.purchaseRate ?? m?.costPrice ?? 0;
        next.gstRate = m?.gstRate ?? 12;
      }
      if (patch.batchId) {
        const b = batches.find(x => x.id === patch.batchId);
        if (b?.purchaseRate) next.unitRate = b.purchaseRate;
      }
      return next;
    }));
  };

  const available = (r: ReturnRow) =>
    r.batchId ? (batches.find(b => b.id === r.batchId)?.quantity || 0)
              : (medicines.find(m => m.id === r.medicineId)?.currentStock || 0);

  const lineTax = (r: ReturnRow) => computeGstLine({
    quantity: r.quantity, unitPrice: r.unitRate, gstRate: r.gstRate, priceIncludesGst: false, interstate
  });

  const totals = useMemo(() => sumGstLines(rows.filter(r => r.medicineId && r.quantity > 0).map(lineTax)), [rows, interstate]);

  const handleSave = async () => {
    if (!user) return;
    if (!supplierId) { alert('Please select a supplier'); return; }
    if (!reason.trim()) { alert('Please provide a reason for the return'); return; }
    const valid = rows.filter(r => r.medicineId && r.quantity > 0);
    if (valid.length === 0) { alert('Add at least one item to return'); return; }
    for (const r of valid) {
      if (r.quantity > available(r) + 1e-9) {
        const m = medicines.find(x => x.id === r.medicineId);
        alert(`Cannot return ${r.quantity} of ${m?.name}; only ${available(r)} available${r.batchId ? ' in that batch' : ''}.`);
        return;
      }
    }

    try {
      setSaving(true);
      const items: DebitNoteItemInput[] = valid.map(r => {
        const m = medicines.find(x => x.id === r.medicineId);
        const b = batches.find(x => x.id === r.batchId);
        const t = lineTax(r);
        return {
          medicineId: r.medicineId,
          batchId: b?.id,
          batchNumber: b?.batchNumber || m?.batchNumber,
          quantity: r.quantity,
          unitRate: r.unitRate,
          hsnCode: m?.hsnCode,
          gstRate: r.gstRate,
          taxableAmount: t.taxable,
          cgstAmount: t.cgst,
          sgstAmount: t.sgst,
          igstAmount: t.igst,
          lineTotal: t.total
        };
      });
      const note = await pharmacyService.createDebitNote({
        supplierId,
        againstReceiptId: againstReceiptId || undefined,
        reason: reason.trim(),
        isInterstate: interstate,
        taxableAmount: totals.taxable,
        cgstAmount: totals.cgst,
        sgstAmount: totals.sgst,
        igstAmount: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        items
      });
      alert(`Debit note ${note.debitNoteNumber} recorded for ${inr(note.grandTotal)}. Stock reduced.`);
      onSave();
      onClose();
    } catch (err) {
      console.error('Error creating debit note:', err);
      alert(err instanceof Error ? err.message : 'Failed to record return');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading data...</p>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-600" />
            <div>
              <h2 className="text-xl font-bold">Return to Supplier (Debit Note)</h2>
              <p className="text-xs text-gray-500">Reduces stock and reverses input GST on the returned items</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
              <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setAgainstReceiptId(''); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">Select a supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` (${s.gstin})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Against Purchase Invoice</label>
              <select value={againstReceiptId} onChange={(e) => setAgainstReceiptId(e.target.value)} disabled={!supplierId}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100">
                <option value="">Not linked</option>
                {supplierReceipts.map(r => (
                  <option key={r.id} value={r.id}>{r.invoiceNumber} · {(r.supplierInvoiceDate || r.receiptDate).toLocaleDateString('en-IN')} · {inr(r.grandTotal || r.totalAmount)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Items *</label>
              <button onClick={() => setRows([...rows, emptyRow()])} className="flex items-center gap-1 text-blue-600 text-sm"><Plus className="w-4 h-4" /> Add item</button>
            </div>
            <div className="space-y-2">
              {rows.map((r, index) => {
                const m = medicines.find(x => x.id === r.medicineId);
                const t = lineTax(r);
                const over = r.medicineId && r.quantity > available(r);
                return (
                  <div key={index} className="border border-gray-200 rounded-lg p-3">
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Medicine</label>
                        <select value={r.medicineId} onChange={(e) => updateRow(index, { medicineId: e.target.value })} className={inputCls}>
                          <option value="">Select</option>
                          {medicines.map(med => <option key={med.id} value={med.id}>{med.name} (Stock: {med.currentStock})</option>)}
                        </select>
                      </div>
                      <div className="col-span-2 md:col-span-1">
                        <label className="block text-xs text-gray-600 mb-1">Batch</label>
                        <select value={r.batchId} onChange={(e) => updateRow(index, { batchId: e.target.value })} disabled={!r.medicineId} className={`${inputCls} disabled:bg-gray-100`}>
                          <option value="">Pool</option>
                          {r.medicineId && batchesFor(r.medicineId).map(b => (
                            <option key={b.id} value={b.id}>
                              {b.batchNumber} ({stockBreakdown(b.quantity, packSpec(medicines.find(m => m.id === r.medicineId)))})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Qty</label>
                        <input type="number" min="1" step="1" value={r.quantity} onChange={(e) => updateRow(index, { quantity: parseInt(e.target.value) || 0 })}
                          className={`${inputCls} ${over ? 'border-red-300 bg-red-50' : ''}`} />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Rate (ex-GST)</label>
                        <input type="number" min="0" step="0.01" value={r.unitRate} onChange={(e) => updateRow(index, { unitRate: parseFloat(e.target.value) || 0 })} className={inputCls} />
                      </div>
                      <div className="flex items-end gap-1">
                        <div className="w-full">
                          <label className="block text-xs text-gray-600 mb-1">GST %</label>
                          <select value={r.gstRate} onChange={(e) => updateRow(index, { gstRate: parseFloat(e.target.value) })} className={inputCls}>
                            {GST_RATES.map(g => <option key={g} value={g}>{g}%</option>)}
                          </select>
                        </div>
                        <button onClick={() => setRows(rows.filter((_, i) => i !== index))} className="p-1 text-red-600 mb-0.5"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    {m && (
                      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-4">
                        <span>Available {available(r)}</span>
                        <span>Taxable {inr(t.taxable)} · Tax {inr(t.cgst + t.sgst + t.igst)} · Total {inr(t.total)}</span>
                        {over && <span className="text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> exceeds available</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Return *</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., near expiry, damaged in transit, wrong item supplied" />
          </div>

          <div className="bg-gray-50 rounded-lg p-3 text-sm grid grid-cols-2 md:grid-cols-5 gap-2">
            <div><div className="text-gray-500">Taxable</div><div className="font-semibold">{inr(totals.taxable)}</div></div>
            {interstate
              ? <div><div className="text-gray-500">IGST reversed</div><div className="font-semibold">{inr(totals.igst)}</div></div>
              : <>
                  <div><div className="text-gray-500">CGST reversed</div><div className="font-semibold">{inr(totals.cgst)}</div></div>
                  <div><div className="text-gray-500">SGST reversed</div><div className="font-semibold">{inr(totals.sgst)}</div></div>
                </>}
            <div><div className="text-gray-500">Round off</div><div className="font-semibold">{totals.roundOff.toFixed(2)}</div></div>
            <div><div className="text-gray-500">Debit note value</div><div className="font-bold text-orange-700">{inr(totals.grandTotal)}</div></div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>This reduces stock immediately and cannot be undone. The debit note appears in the purchase register and GST inward report as a negative entry.</span>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave}
              disabled={saving || !supplierId || !reason.trim() || totals.grandTotal <= 0 || rows.some(r => r.medicineId && r.quantity > available(r) + 1e-9)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              <Save className="w-4 h-4" />
              {saving ? 'Processing...' : 'Record Debit Note'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReturnToSupplierModal;
