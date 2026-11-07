import React, { useMemo, useState } from 'react';
import { X, Save, AlertTriangle, Trash2, History } from 'lucide-react';
import { PharmacyInwardItem, PharmacyInwardReceipt } from '../../types';
import { pharmacyService, InwardItemCorrection } from '../../services/pharmacyService';
import { computeGstLine, GST_RATES, inr } from '../../utils/gst';
import { fmtQty } from '../../utils/packUnits';

interface InwardLineCorrectionModalProps {
  receipt: PharmacyInwardReceipt;
  item: PharmacyInwardItem;
  onSaved: () => void;
  onClose: () => void;
}

/**
 * Correct a purchase line that was saved with the wrong numbers — almost
 * always because the AI mis-read the supplier's invoice.
 *
 * The point of reference is the paper invoice in the pharmacist's hand, so the
 * form shows what is on file and what it will become, including how much stock
 * moves. Tax is recomputed here with the same `computeGstLine` the original
 * entry used, so the stored amounts stay consistent with the rest of the books.
 */
const InwardLineCorrectionModal: React.FC<InwardLineCorrectionModalProps> = ({
  receipt, item, onSaved, onClose
}) => {
  const interstate = !!receipt.isInterstate;
  const name = item.medicine?.name || 'this line';

  const [form, setForm] = useState({
    quantity: item.quantity,
    freeQuantity: item.freeQuantity ?? 0,
    packSize: item.packSize ?? 1,
    unitCostPrice: item.unitCostPrice,
    mrp: item.mrp ?? 0,
    discountPercent: item.discountPercent ?? 0,
    discountAmount: item.discountAmount ?? 0,
    gstRate: item.gstRate ?? 0,
    hsnCode: item.hsnCode ?? '',
    expiryDate: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : ''
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Purchase rates are quoted GST-exclusive, so tax is added on top — the same
  // direction as the original entry in InwardStock.
  const tax = useMemo(() => computeGstLine({
    quantity: form.quantity,
    unitPrice: form.unitCostPrice,
    discountPercent: form.discountPercent,
    discountAmount: form.discountAmount,
    gstRate: form.gstRate,
    priceIncludesGst: false,
    interstate
  }), [form, interstate]);

  const oldUnits = item.quantity + (item.freeQuantity ?? 0);
  const newUnits = (Number(form.quantity) || 0) + (Number(form.freeQuantity) || 0);
  const stockDelta = newUnits - oldUnits;
  const oldTotal = item.lineTotal ?? item.totalCostPrice;

  const save = async () => {
    if (!form.quantity || form.quantity <= 0) {
      alert('Quantity must be more than zero. Use "Remove line" if the line should not be there at all.');
      return;
    }
    const patch: InwardItemCorrection = {
      quantity: form.quantity,
      freeQuantity: form.freeQuantity,
      packSize: form.packSize,
      unitCostPrice: form.unitCostPrice,
      mrp: form.mrp || undefined,
      discountPercent: form.discountPercent,
      discountAmount: form.discountAmount,
      gstRate: form.gstRate,
      hsnCode: form.hsnCode,
      expiryDate: form.expiryDate ? new Date(`${form.expiryDate}T00:00:00Z`) : null,
      taxableAmount: tax.taxable,
      cgstAmount: tax.cgst,
      sgstAmount: tax.sgst,
      igstAmount: tax.igst,
      lineTotal: tax.total
    };
    try {
      setSaving(true);
      await pharmacyService.correctInwardItem(item.id, patch, reason);
      onSaved();
    } catch (err) {
      console.error('Could not correct the purchase line:', err);
      alert(err instanceof Error ? err.message : 'Could not correct the purchase line');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      setSaving(true);
      await pharmacyService.deleteInwardItem(item.id, reason);
      onSaved();
    } catch (err) {
      console.error('Could not remove the purchase line:', err);
      alert(err instanceof Error ? err.message : 'Could not remove the purchase line');
    } finally {
      setSaving(false);
    }
  };

  // A bad parse can leave a rate that is not one of the five legal slabs, and
  // this form is where it gets fixed, so the odd value has to be selectable
  // until the pharmacist replaces it.
  const rateOptions = GST_RATES.includes(form.gstRate as typeof GST_RATES[number])
    ? [...GST_RATES]
    : [...GST_RATES, form.gstRate].sort((a, b) => a - b);

  const inputCls = 'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500';
  const num = (v: string) => parseFloat(v) || 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-6 border-b sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold">Correct purchase line</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {name} on invoice {receipt.invoiceNumber || '—'}
              {receipt.supplier?.name ? ` from ${receipt.supplier.name}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Enter what the supplier's invoice actually says. The input tax credit on this purchase, the
              batch's MRP and cost, and the medicine's GST rate all follow the change, and the difference in
              quantity is added to or taken off stock. Every correction is kept with your name against it.
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Paid qty (packs) *</label>
              <input type="number" min="1" value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: num(e.target.value) })} className={inputCls} />
              <p className="text-[11px] text-gray-500 mt-0.5">was {fmtQty(item.quantity)}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Free (scheme)</label>
              <input type="number" min="0" value={form.freeQuantity}
                onChange={(e) => setForm({ ...form, freeQuantity: num(e.target.value) })} className={inputCls} />
              <p className="text-[11px] text-gray-500 mt-0.5">was {fmtQty(item.freeQuantity ?? 0)}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Pack of</label>
              <input type="number" min="1" step="0.001" value={form.packSize}
                onChange={(e) => setForm({ ...form, packSize: num(e.target.value) || 1 })} className={inputCls} />
              <p className="text-[11px] text-gray-500 mt-0.5">loose units per pack</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Expiry</label>
              <input type="date" value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className={inputCls} />
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Rate / pack (₹, ex-GST) *</label>
              <input type="number" min="0" step="0.01" value={form.unitCostPrice}
                onChange={(e) => setForm({ ...form, unitCostPrice: num(e.target.value) })} className={inputCls} />
              <p className="text-[11px] text-gray-500 mt-0.5">was {item.unitCostPrice.toFixed(2)}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">MRP / pack (₹)</label>
              <input type="number" min="0" step="0.01" value={form.mrp}
                onChange={(e) => setForm({ ...form, mrp: num(e.target.value) })} className={inputCls} />
              <p className="text-[11px] text-gray-500 mt-0.5">was {item.mrp?.toFixed(2) ?? '—'}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Disc %</label>
              <input type="number" min="0" max="100" step="0.5" value={form.discountPercent}
                onChange={(e) => setForm({ ...form, discountPercent: num(e.target.value) })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Disc ₹</label>
              <input type="number" min="0" step="0.01" value={form.discountAmount}
                onChange={(e) => setForm({ ...form, discountAmount: num(e.target.value) })} className={inputCls} />
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">HSN</label>
              <input type="text" value={form.hsnCode}
                onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">GST %</label>
              <select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: num(e.target.value) })} className={inputCls}>
                {rateOptions.map(r => (
                  <option key={r} value={r}>
                    {r}%{GST_RATES.includes(r as typeof GST_RATES[number]) ? '' : ' (not a GST slab)'}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-0.5">was {item.gstRate ?? 0}%</p>
            </div>
            <div className="col-span-2 md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Batch</label>
              <input type="text" readOnly value={item.batchNumber || '—'}
                className={`${inputCls} bg-gray-50 text-gray-500`} />
              <p className="text-[11px] text-gray-500 mt-0.5">
                A wrong batch number is corrected on the batch itself: Stock Report → Batches → pencil.
                That fixes it on every line that came from the batch, this one included.
              </p>
            </div>
          </div>

          {/* What this will do, before it does it. */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm space-y-2">
            <h4 className="font-semibold text-gray-800">What changes</h4>
            <p className="text-xs text-gray-600">Total received: {newUnits} packs. Effective cost per pack (ex-GST): {inr(newUnits > 0 ? tax.taxable / newUnits : 0)}. If free stock was already added manually, reconcile that adjustment before adding it here.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-gray-500">Line total</div>
                <div className="font-medium">
                  {inr(oldTotal)} <span className="text-gray-400">→</span> {inr(tax.total)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{interstate ? 'IGST' : 'CGST + SGST'}</div>
                <div className="font-medium">
                  {interstate ? inr(tax.igst) : `${inr(tax.cgst)} + ${inr(tax.sgst)}`}
                  <span className="text-gray-500 text-xs"> on {inr(tax.taxable)}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Stock</div>
                <div className={`font-medium ${stockDelta === 0 ? 'text-gray-600' : stockDelta > 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {stockDelta === 0
                    ? 'unchanged'
                    : `${stockDelta > 0 ? '+' : ''}${fmtQty(stockDelta)} pack${Math.abs(stockDelta) === 1 ? '' : 's'}`}
                </div>
              </div>
            </div>
            {stockDelta < 0 && (
              <p className="text-xs text-amber-800">
                Taking stock back off the shelf. If that much is no longer there — because it has been
                dispensed — the correction will be refused and nothing will change.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. GST read as 18% by the scan; invoice says 5%"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <History className="w-3 h-3" /> Stored with the before and after values.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-6 border-t sticky bottom-0 bg-white">
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-red-700 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> Remove line
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-red-700">
                Remove it and take its {fmtQty(oldUnits)} pack{oldUnits === 1 ? '' : 's'} off stock?
              </span>
              <button onClick={remove} disabled={saving}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {saving ? 'Removing…' : 'Yes, remove'}
              </button>
              <button onClick={() => setConfirmDelete(false)} disabled={saving}
                className="px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InwardLineCorrectionModal;
