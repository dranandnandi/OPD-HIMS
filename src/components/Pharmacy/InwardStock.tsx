import MedicineFlags from './MedicineFlags';
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Save, Trash2, Bot, FileText, AlertCircle, Camera } from 'lucide-react';
import BarcodeScanInput from './BarcodeScanInput';
import MedicineIdentifyModal, { IdentifiedMedicine } from './MedicineIdentifyModal';
import { Supplier, MedicineWithPrice } from '../../types';
import { getCurrentProfile } from '../../services/profileService';
import { pharmacyService, InwardItemInput } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { useAuth } from '../Auth/useAuth';
import { Link } from 'react-router-dom';
import { computeGstLine, sumGstLines, GST_RATES, inr, isInterstate, stateCodeFromGstin } from '../../utils/gst';
import { packSpec, fmtQty } from '../../utils/packUnits';

interface ItemRow {
  medicineId: string;
  batchNumber: string;
  expiryDate: string;      // yyyy-mm-dd
  quantity: number;
  freeQuantity: number;
  mrp: number;
  unitCostPrice: number;   // GST-exclusive purchase rate
  discountPercent: number;
  discountAmount: number;  // flat rupee discount on the line
  gstRate: number;
  /** Loose units in one purchased pack, as the invoice states it (1x10 -> 10). */
  packSize: number;
}

const emptyRow = (): ItemRow => ({
  medicineId: '', batchNumber: '', expiryDate: '', quantity: 0, freeQuantity: 0,
  mrp: 0, unitCostPrice: 0, discountPercent: 0, discountAmount: 0, gstRate: 12, packSize: 1
});

const today = () => new Date().toISOString().split('T')[0];

const InwardStock: React.FC = () => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNumber: '',
    supplierInvoiceDate: today(),
    receiptDate: today(),
    remarks: ''
  });
  const [items, setItems] = useState<ItemRow[]>([emptyRow()]);
  const [showIdentify, setShowIdentify] = useState(false);

  /** Scanned / identified medicine -> fill the first empty row or add one, with pack details when known. */
  const addRowFor = (m: MedicineWithPrice, info?: IdentifiedMedicine) => {
    const row: ItemRow = {
      ...emptyRow(),
      medicineId: m.id,
      gstRate: m.gstRate ?? 12,
      packSize: packSpec(m).packSize,
      mrp: info?.mrp ?? m.sellingPrice ?? 0,
      unitCostPrice: m.costPrice ?? 0,
      batchNumber: info?.batchNumber ?? '',
      expiryDate: info?.expiryDate ?? ''
    };
    setItems(prev => {
      const empty = prev.findIndex(r => !r.medicineId);
      if (empty >= 0) return prev.map((r, i) => i === empty ? row : r);
      return [...prev, row];
    });
  };

  const reloadMedicines = async () => {
    try { setMedicines(await masterDataService.getMedicines(user?.clinicId)); } catch { /* keep list */ }
  };

  const clinicState = user?.clinic?.gstStateCode || stateCodeFromGstin(user?.clinic?.gstin);
  const supplier = suppliers.find(s => s.id === formData.supplierId);
  const supplierState = supplier?.stateCode || stateCodeFromGstin(supplier?.gstin);
  const interstate = isInterstate(clinicState, supplierState);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [suppliersData, medicinesData] = await Promise.all([
        pharmacyService.getSuppliers(),
        masterDataService.getMedicines(user?.clinicId)
      ]);
      setSuppliers(suppliersData);
      setMedicines(medicinesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (index: number, patch: Partial<ItemRow>) => {
    setItems(items.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row, ...patch };
      if (patch.medicineId !== undefined) {
        const m = medicines.find(x => x.id === patch.medicineId);
        next.gstRate = m?.gstRate ?? 12;
        next.packSize = packSpec(m).packSize;
        if (!next.mrp && m?.sellingPrice) next.mrp = m.sellingPrice;
        if (!next.unitCostPrice && m?.costPrice) next.unitCostPrice = m.costPrice;
      }
      return next;
    }));
  };

  const lineTax = (row: ItemRow) => computeGstLine({
    quantity: row.quantity, unitPrice: row.unitCostPrice, discountPercent: row.discountPercent,
    discountAmount: row.discountAmount, gstRate: row.gstRate, priceIncludesGst: false, interstate
  });

  const totals = useMemo(() => sumGstLines(
    items.filter(r => r.medicineId && r.quantity > 0).map(lineTax)
  ), [items, interstate]);

  const resetForm = () => {
    setFormData({ supplierId: '', invoiceNumber: '', supplierInvoiceDate: today(), receiptDate: today(), remarks: '' });
    setItems([emptyRow()]);
  };

  const handleSave = async () => {
    if (!user) { alert('You must be logged in to save inward stock'); return; }
    if (!formData.supplierId) { alert('Please select a supplier'); return; }
    if (!formData.invoiceNumber.trim()) { alert('Please enter the supplier invoice number'); return; }

    const validRows = items.filter(r => r.medicineId && r.quantity > 0 && r.unitCostPrice > 0);
    if (validRows.length === 0) {
      alert('Please add at least one item with medicine, quantity and purchase rate');
      return;
    }
    const missingBatch = validRows.filter(r => !r.batchNumber.trim());
    if (missingBatch.length > 0 && !confirm(`${missingBatch.length} item(s) have no batch number. They will go into the pooled stock without batch tracking. Continue?`)) {
      return;
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) { alert('User not assigned to a clinic.'); return; }

    try {
      setSaving(true);
      const inwardItems: InwardItemInput[] = validRows.map(r => {
        const m = medicines.find(x => x.id === r.medicineId);
        const t = lineTax(r);
        return {
          medicineId: r.medicineId,
          quantity: r.quantity,
          unitCostPrice: r.unitCostPrice,
          batchNumber: r.batchNumber.trim() || undefined,
          expiryDate: r.expiryDate ? new Date(r.expiryDate) : undefined,
          hsnCode: m?.hsnCode,
          gstRate: r.gstRate,
          packSize: r.packSize > 0 ? r.packSize : undefined,
          mrp: r.mrp || undefined,
          discountPercent: r.discountPercent,
          discountAmount: r.discountAmount,
          freeQuantity: r.freeQuantity,
          taxableAmount: t.taxable,
          cgstAmount: t.cgst,
          sgstAmount: t.sgst,
          igstAmount: t.igst,
          lineTotal: t.total
        };
      });

      await pharmacyService.createInwardReceipt({
        supplierId: formData.supplierId,
        invoiceNumber: formData.invoiceNumber.trim(),
        receiptDate: new Date(formData.receiptDate),
        supplierInvoiceDate: new Date(formData.supplierInvoiceDate),
        totalAmount: totals.grandTotal,
        uploadedBy: user.id,
        invoiceFileUrl: '',
        status: 'completed',
        remarks: formData.remarks,
        isInterstate: interstate,
        taxableAmount: totals.taxable,
        discountAmount: totals.discount,
        cgstAmount: totals.cgst,
        sgstAmount: totals.sgst,
        igstAmount: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal
      }, inwardItems);

      // Keep the clinic price list current: MRP becomes the selling price,
      // the purchase rate the cost price.
      for (const r of validRows) {
        if (r.mrp > 0) {
          try {
            await masterDataService.setClinicMedicinePrice(profile.clinicId, r.medicineId, r.mrp, r.unitCostPrice);
          } catch (e) {
            console.warn('Could not update clinic price for medicine', r.medicineId, e);
          }
        }
      }

      alert(`Purchase saved. ${inwardItems.length} item(s) added to stock. GST input ${inr(totals.cgst + totals.sgst + totals.igst)} recorded.`);
      resetForm();
      await loadData();
    } catch (err) {
      console.error('Error saving inward stock:', err);
      alert(err instanceof Error ? err.message : 'Failed to save inward stock');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <div className="flex items-center justify-center py-12"><p className="text-gray-600">Please log in to manage inward stock.</p></div>;
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button onClick={loadData} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Retry</button>
      </div>
    );
  }

  const inputCls = 'w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Purchase Entry (Inward Stock)</h2>
          <p className="text-gray-600">Record a supplier invoice with batch, MRP and GST input</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pharmacy/purchases" className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
            <FileText className="w-4 h-4" /> Purchase Register
          </Link>
          <Link to="/pharmacy/invoice-upload" className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">
            <Bot className="w-4 h-4" /> Process Invoice with AI
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Header */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Supplier Invoice</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
              <select value={formData.supplierId} onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="">Select a supplier</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` (${s.gstin})` : ''}</option>)}
              </select>
              {supplier && !supplier.gstin && (
                <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Supplier has no GSTIN; input credit cannot be claimed on this invoice.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Invoice No *</label>
              <input type="text" value={formData.invoiceNumber} onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="As printed on the invoice" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date *</label>
              <input type="date" value={formData.supplierInvoiceDate} onChange={(e) => setFormData({ ...formData, supplierInvoiceDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-500 mt-1">Decides which GST period the input credit falls in.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Received On</label>
              <input type="date" value={formData.receiptDate} onChange={(e) => setFormData({ ...formData, receiptDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className={`px-2 py-1 rounded ${interstate ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
              {interstate ? 'Inter-state supply: IGST' : 'Intra-state supply: CGST + SGST'}
            </span>
            {!clinicState && <span className="text-amber-700">Clinic state code not set in Settings; assuming intra-state.</span>}
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Additional notes..." />
          </div>
        </div>

        {/* Items */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Items</h3>
            <button onClick={() => setItems([...items, emptyRow()])} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-3 mb-4">
            <div className="flex-1">
              <BarcodeScanInput medicines={medicines} onMedicine={(m) => addRowFor(m)} onBarcodeAssigned={reloadMedicines} />
            </div>
            <button onClick={() => setShowIdentify(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 whitespace-nowrap"
              title="Photograph the pack: picks the medicine, reads batch, expiry and MRP, or creates a new master entry">
              <Camera className="w-4 h-4" /> Identify by photo
            </button>
          </div>

          <div className="space-y-3">
            {items.map((row, index) => {
              const m = medicines.find(x => x.id === row.medicineId);
              const t = lineTax(row);
              return (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-12 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">Medicine *</label>
                      <select value={row.medicineId} onChange={(e) => updateItem(index, { medicineId: e.target.value })} className={inputCls}>
                        <option value="">Select medicine</option>
                        {medicines.map(med => <option key={med.id} value={med.id}>{med.name}{med.strength ? ` ${med.strength}` : ''}{med.isNrx ? ' [NRx]' : ''}{med.isScheduleH1 ? ' [H1]' : ''}</option>)}
                      </select>
                      <MedicineFlags medicine={m} />
                      {m && <p className="text-xs text-gray-500 mt-1">HSN {m.hsnCode || '—'}{m.rackLocation ? ` · Rack ${m.rackLocation}` : ''}</p>}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Batch No</label>
                      <input type="text" value={row.batchNumber} onChange={(e) => updateItem(index, { batchNumber: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Expiry</label>
                      <input type="date" value={row.expiryDate} onChange={(e) => updateItem(index, { expiryDate: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Paid qty * ({packSpec(m).stockUnit}s)</label>
                      <input type="number" min="1" value={row.quantity} onChange={(e) => updateItem(index, { quantity: parseInt(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Pack of</label>
                      <input
                        type="number" min="1" step="0.001" value={row.packSize}
                        onChange={(e) => updateItem(index, { packSize: parseFloat(e.target.value) || 1 })}
                        title={`Loose ${packSpec(m).dispenseUnit.toLowerCase()}s in one ${packSpec(m).stockUnit.toLowerCase()} — the "1x10" on the invoice`}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Free (scheme)</label>
                      <input type="number" min="0" value={row.freeQuantity} onChange={(e) => updateItem(index, { freeQuantity: parseInt(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">MRP / {packSpec(m).stockUnit} (₹)</label>
                      <input type="number" min="0" step="0.01" value={row.mrp} onChange={(e) => updateItem(index, { mrp: parseFloat(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Rate / {packSpec(m).stockUnit} (₹, ex-GST) *</label>
                      <input type="number" min="0" step="0.01" value={row.unitCostPrice} onChange={(e) => updateItem(index, { unitCostPrice: parseFloat(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Disc %</label>
                      <input type="number" min="0" max="100" step="0.5" value={row.discountPercent} onChange={(e) => updateItem(index, { discountPercent: parseFloat(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Disc ₹</label>
                      <input type="number" min="0" step="0.01" value={row.discountAmount} onChange={(e) => updateItem(index, { discountAmount: parseFloat(e.target.value) || 0 })} className={inputCls} />
                    </div>
                    <div className="flex items-end gap-1">
                      <div className="w-full">
                        <label className="block text-xs text-gray-600 mb-1">GST %</label>
                        <select value={row.gstRate} onChange={(e) => updateItem(index, { gstRate: parseFloat(e.target.value) })} className={inputCls}>
                          {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </div>
                      <button onClick={() => setItems(items.filter((_, i) => i !== index))} className="p-1 text-red-600 hover:text-red-700 mb-0.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {row.medicineId && row.quantity > 0 && (
                    <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-x-4">
                      <span>Received: {row.quantity} paid + {row.freeQuantity} free = {row.quantity + row.freeQuantity} {packSpec(m).stockUnit}s</span>
                      <span>Effective cost / {packSpec(m).stockUnit} (ex-GST): {inr(t.taxable / (row.quantity + row.freeQuantity))}</span>
                      <span>Taxable {inr(t.taxable)}</span>
                      {interstate ? <span>IGST {inr(t.igst)}</span> : <span>CGST {inr(t.cgst)} · SGST {inr(t.sgst)}</span>}
                      <span className="font-medium text-gray-800">Line total {inr(t.total)}</span>
                      {row.mrp > 0 && row.unitCostPrice > 0 && (
                        <span className="text-green-700">Margin on MRP {(((row.mrp - (t.taxable / (row.quantity + row.freeQuantity)) * (1 + row.gstRate / 100)) / row.mrp) * 100).toFixed(1)}%</span>
                      )}
                      {row.packSize > 1 && (
                        <span>
                          {fmtQty((row.quantity + row.freeQuantity) * row.packSize)} {packSpec(m).dispenseUnit.toLowerCase()}s in all
                          {row.mrp > 0 && ` · ${inr(row.mrp / row.packSize)} per ${packSpec(m).dispenseUnit.toLowerCase()}`}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Totals */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><div className="text-gray-500">Taxable</div><div className="font-semibold">{inr(totals.taxable)}</div></div>
            <div><div className="text-gray-500">Discount</div><div className="font-semibold">{inr(totals.discount)}</div></div>
            {interstate ? (
              <div><div className="text-gray-500">IGST</div><div className="font-semibold">{inr(totals.igst)}</div></div>
            ) : (
              <>
                <div><div className="text-gray-500">CGST</div><div className="font-semibold">{inr(totals.cgst)}</div></div>
                <div><div className="text-gray-500">SGST</div><div className="font-semibold">{inr(totals.sgst)}</div></div>
              </>
            )}
            <div><div className="text-gray-500">Round off</div><div className="font-semibold">{totals.roundOff.toFixed(2)}</div></div>
            <div><div className="text-gray-500">Grand Total</div><div className="font-bold text-blue-700 text-lg">{inr(totals.grandTotal)}</div></div>
          </div>
          <p className="text-xs text-gray-500 mt-2">Check the grand total against the printed invoice before saving. Input credit = {inr(totals.cgst + totals.sgst + totals.igst)}.</p>
        </div>

        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save Purchase'}
          </button>
        </div>
      </div>

      {showIdentify && (
        <MedicineIdentifyModal
          medicines={medicines}
          allowCreate
          onPick={(m, info) => { addRowFor(m, info); setShowIdentify(false); }}
          onCreated={async (m, info) => { await reloadMedicines(); addRowFor(m, info); setShowIdentify(false); }}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
};

export default InwardStock;
