import React, { useState, useEffect, useRef } from 'react';
import { Save, Trash2, Plus, CheckCircle, AlertCircle, Eye, X, Search } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { getCurrentProfile } from '../../services/profileService';
import { Supplier, MedicineWithPrice } from '../../types';
import { computeGstLine, sumGstLines, GST_RATES, inr, isInterstate, stateCodeFromGstin } from '../../utils/gst';
import { parsePackSize } from '../../utils/packUnits';

import type { InvoiceData, InvoiceLine, ImportDraft } from '../../types/pharmacyImport';
import type { PharmacyInwardReceipt } from '../../types';
import { pharmacyImportService } from '../../services/pharmacyImportService';
import { possibleDuplicateLines, normalizeInvoiceNumber, invoiceHeaderReview } from '../../utils/pharmacyImport';

type ReviewLine = InvoiceLine & { id?: string; medicineId?: string; isMatched?: boolean; confidence?: number; rateUnknown?: boolean };
function reviewLine(medicine: ReviewLine) {
  return {
    ...medicine, id: medicine.id || crypto.randomUUID(),
    sourceKey: medicine.sourceKey || `manual:${crypto.randomUUID()}`,
    medicineName: medicine.medicineName || '', quantity: medicine.quantity ?? 0,
    unitCostPrice: medicine.unitCostPrice ?? 0,
    rateUnknown: medicine.rateUnknown ?? medicine.unitCostPrice == null,
    totalCostPrice: medicine.totalCostPrice ?? null,
    batchNumber: medicine.batchNumber || '', expiryDate: medicine.expiryDate || '',
    manufacturer: medicine.manufacturer || '', strength: medicine.strength || '', packSize: medicine.packSize || '',
    hsnCode: medicine.hsnCode || '', gstRate: medicine.gstRate ?? null,
    mrp: medicine.mrp ?? null, discountPercent: medicine.discountPercent ?? null,
    discountAmount: medicine.discountAmount ?? null, freeQuantity: medicine.freeQuantity ?? 0,
    medicineId: medicine.medicineId || '', isMatched: medicine.isMatched || false,
    confidence: medicine.confidence || 0,
  };
}

interface InvoiceReviewModalProps {
  extractedData: InvoiceData;
  rawText: string;
  fileName: string;
  importDraft: ImportDraft;
  existingReceipt?: PharmacyInwardReceipt;
  incomplete?: boolean;
  onSaveDraft: (snapshot: NonNullable<ImportDraft['payload']['review']>) => Promise<ImportDraft>;
  onComplete: () => void;
  onClose: () => void;
}

const InvoiceReviewModal: React.FC<InvoiceReviewModalProps> = ({
  extractedData,
  rawText,
  fileName,
  importDraft, existingReceipt, incomplete, onSaveDraft,
  onComplete,
  onClose
}) => {
  const { user } = useAuth();
  const headerRef = useRef<HTMLDivElement>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [itemSearchTerm, setItemSearchTerm] = useState('');

  const [acknowledged, setAcknowledged] = useState(false);
  const [headerResolution, setHeaderResolution] = useState(importDraft.payload.review?.headerResolution || '');
  const [draftSaving, setDraftSaving] = useState(false);
  const initialHeader = {
    supplierId: existingReceipt?.supplierId || '',
    supplierName: extractedData.invoiceInfo.supplierName || '',
    supplierGstin: extractedData.invoiceInfo.supplierGstin || '',
    invoiceNumber: existingReceipt?.invoiceNumber || extractedData.invoiceInfo.invoiceNumber || '',
    invoiceDate: existingReceipt?.supplierInvoiceDate?.toISOString().slice(0, 10) || extractedData.invoiceInfo.invoiceDate || '',
    totalAmount: extractedData.invoiceInfo.totalAmount,
    extractedTaxable: extractedData.invoiceInfo.taxableAmount ?? null,
    extractedTax: [extractedData.invoiceInfo.cgstAmount, extractedData.invoiceInfo.sgstAmount, extractedData.invoiceInfo.igstAmount].some(v => v != null)
      ? (extractedData.invoiceInfo.cgstAmount || 0) + (extractedData.invoiceInfo.sgstAmount || 0) + (extractedData.invoiceInfo.igstAmount || 0) : null,
    roundOff: extractedData.invoiceInfo.roundOff ?? existingReceipt?.roundOff ?? null,
    remarks: `Imported from ${fileName}`
  };
  const [invoiceInfo, setInvoiceInfo] = useState({ ...initialHeader, ...(importDraft.payload.review?.invoiceInfo || {}) } as typeof initialHeader);
  const clinicState = user?.clinic?.gstStateCode || stateCodeFromGstin(user?.clinic?.gstin);
  const [medicineItems, setMedicineItems] = useState(() =>
    ((importDraft.payload.review?.medicineItems || extractedData.medicines) as ReviewLine[]).map(reviewLine)
  );
  const saveDraft = async () => {
    setDraftSaving(true);
    try { await onSaveDraft({ invoiceInfo, medicineItems, headerResolution }); onClose(); }
    catch (error) { alert(error instanceof Error ? error.message : 'Could not save draft'); }
    finally { setDraftSaving(false); }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Auto-match medicines with master data
    matchMedicinesWithMaster();
  }, [medicines]);

  useEffect(() => { setAcknowledged(false); }, [medicineItems, invoiceInfo]);

  const loadData = async () => {
    try {
      setLoading(true);
      const clinicId = user?.clinicId;
      const [suppliersData, medicinesData] = await Promise.all([
        pharmacyService.getSuppliers(),
        masterDataService.getMedicines(clinicId)
      ]);
      
      setSuppliers(suppliersData);
      setMedicines(medicinesData);

      // Auto-select supplier: GSTIN is exact, name is fuzzy
      const byGstin = invoiceInfo.supplierGstin
        ? suppliersData.find(s => s.gstin && s.gstin.toUpperCase() === invoiceInfo.supplierGstin.toUpperCase())
        : undefined;
      const matchedSupplier = byGstin || (invoiceInfo.supplierName
        ? suppliersData.find(s =>
            s.name.toLowerCase().includes(invoiceInfo.supplierName.toLowerCase()) ||
            invoiceInfo.supplierName.toLowerCase().includes(s.name.toLowerCase()))
        : undefined);
      if (matchedSupplier && !invoiceInfo.supplierId) {
        setInvoiceInfo(prev => ({ ...prev, supplierId: matchedSupplier.id }));
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const matchMedicinesWithMaster = () => {
    setMedicineItems(prev => prev.map(item => {
      if (item.medicineId) return item;
      const matchedMedicine = medicines.find(m => 
        m.name.toLowerCase() === item.medicineName.toLowerCase() ||
        m.brandName?.toLowerCase() === item.medicineName.toLowerCase()
      );

      if (matchedMedicine) {
        return {
          ...item,
          medicineId: matchedMedicine.id,
          hsnCode: item.hsnCode || matchedMedicine.hsnCode || '',
          gstRate: item.gstRate, // Missing invoice tax must be reviewed, never silently defaulted.
          isMatched: true,
          confidence: 0.9
        };
      }

      return item;
    }));
  };

  const filteredMedicineItems = medicineItems.filter(item =>
    item.medicineName.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.manufacturer?.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.batchNumber?.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.strength?.toLowerCase().includes(itemSearchTerm.toLowerCase())
  );

  const addMedicineItem = () => {
    const newItem = reviewLine({ medicineName: '', quantity: 1, unitCostPrice: 0, totalCostPrice: null,
      batchNumber: null, expiryDate: null, manufacturer: null, strength: null, packSize: null });
    setMedicineItems([...medicineItems, newItem]);
  };

  const updateMedicineItem = (index: number, field: string, value: any) => {
    setMedicineItems(prev => prev.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        // Keep printed amounts intact so corrections can be reconciled.
        if (field === 'medicineName') { updatedItem.medicineId = ''; updatedItem.isMatched = false; }
        if (field === 'unitCostPrice') updatedItem.rateUnknown = false;
        
        return updatedItem;
      }
      return item;
    }));
  };

  const removeMedicineItem = (index: number) => {
    setMedicineItems(prev => prev.filter((_, i) => i !== index));
  };

  const selectedSupplier = suppliers.find(s => s.id === invoiceInfo.supplierId);
  const interstate = existingReceipt?.isInterstate ?? isInterstate(clinicState, selectedSupplier?.stateCode || stateCodeFromGstin(selectedSupplier?.gstin || invoiceInfo.supplierGstin));

  const lineTax = (item: { quantity: number; unitCostPrice: number; discountPercent?: number | null; discountAmount?: number | null; gstRate?: number | null }) =>
    computeGstLine({
      quantity: item.quantity, unitPrice: item.unitCostPrice, discountPercent: item.discountPercent || 0,
      discountAmount: item.discountAmount || 0, gstRate: item.gstRate ?? 0, priceIncludesGst: false, interstate
    });

  const newTotals = sumGstLines(medicineItems.map(lineTax), false);
  const combinedSubtotal = newTotals.subtotal + (existingReceipt ? (existingReceipt.grandTotal ?? existingReceipt.totalAmount) - (existingReceipt.roundOff || 0) : 0);
  const roundOff = invoiceInfo.roundOff ?? Math.round((Math.round(combinedSubtotal) - combinedSubtotal) * 100) / 100;
  const invoiceTotals = {
    ...newTotals,
    taxable: newTotals.taxable + (existingReceipt?.taxableAmount || 0),
    cgst: newTotals.cgst + (existingReceipt?.cgstAmount || 0),
    sgst: newTotals.sgst + (existingReceipt?.sgstAmount || 0),
    igst: newTotals.igst + (existingReceipt?.igstAmount || 0),
    roundOff, grandTotal: Math.round((combinedSubtotal + roundOff) * 100) / 100
  };
  const calculateTotalAmount = () => invoiceTotals.grandTotal;
  const extractedGrand = invoiceInfo.totalAmount;
  const totalMismatch = extractedGrand != null && Math.abs(extractedGrand - invoiceTotals.grandTotal) > 1;
  const taxMismatch = invoiceInfo.extractedTax != null && Math.abs(invoiceInfo.extractedTax - invoiceTotals.cgst - invoiceTotals.sgst - invoiceTotals.igst) > 1;
  const taxableMismatch = invoiceInfo.extractedTaxable != null && Math.abs(invoiceInfo.extractedTaxable - invoiceTotals.taxable) > 1;
  const duplicateRows = possibleDuplicateLines(medicineItems);
  const existingDuplicates = existingReceipt?.inwardItems?.some(old => medicineItems.some(item =>
    item.medicineId === old.medicineId && item.batchNumber === (old.batchNumber || '') && item.quantity === old.quantity && item.unitCostPrice === old.unitCostPrice));
  const headerReview = invoiceHeaderReview(importDraft.payload.pages, {
    supplierId: invoiceInfo.supplierId, supplierGstin: selectedSupplier?.gstin || invoiceInfo.supplierGstin,
    invoiceNumber: invoiceInfo.invoiceNumber, invoiceDate: invoiceInfo.invoiceDate,
  });
  const headerNeedsReview = headerReview.conflicts.length > 0 || !!existingReceipt && (
    (!!extractedData.invoiceInfo.invoiceNumber && normalizeInvoiceNumber(extractedData.invoiceInfo.invoiceNumber) !== normalizeInvoiceNumber(existingReceipt.invoiceNumber)) ||
    (!!extractedData.invoiceInfo.invoiceDate && extractedData.invoiceInfo.invoiceDate !== existingReceipt.supplierInvoiceDate?.toISOString().slice(0, 10)) ||
    (!!extractedData.invoiceInfo.supplierGstin && !!existingReceipt.supplier?.gstin && extractedData.invoiceInfo.supplierGstin !== existingReceipt.supplier.gstin));
  const continuationConflict = headerNeedsReview && headerResolution !== headerReview.signature;
  const unresolved = medicineItems.some(item => !item.medicineName.trim() || !Number.isInteger(item.quantity) || item.quantity <= 0 ||
    item.rateUnknown || !Number.isFinite(item.unitCostPrice) || item.unitCostPrice < 0 || item.gstRate == null || !Number.isFinite(item.gstRate) || item.gstRate < 0 || item.gstRate > 100 ||
    !Number.isInteger(item.freeQuantity) || item.freeQuantity < 0 || (item.discountPercent != null && (item.discountPercent < 0 || item.discountPercent > 100)) ||
    (item.discountAmount != null && item.discountAmount < 0));
  const blockers = [
    ...(!invoiceInfo.supplierId ? ['Select the supplier in Invoice Information.'] : []),
    ...(!invoiceInfo.invoiceNumber.trim() ? ['Enter the supplier invoice number.'] : []),
    ...(!invoiceInfo.invoiceDate ? ['Enter the invoice date.'] : []),
    ...(!medicineItems.length ? ['Add at least one medicine.'] : []),
    ...(incomplete ? ['Some pages are unfinished. Save the draft and retry those pages.'] : []),
    ...(unresolved ? ['Some items have missing or invalid names, quantities, rates, GST or discounts.'] : []),
    ...(continuationConflict ? ['Confirm the supplier, invoice number and date for all pages below.'] : []),
    ...(!acknowledged ? ['Tick the final review confirmation below.'] : []),
  ];
  const handleSave = async () => {
    if (!user || !invoiceInfo.supplierId || !invoiceInfo.invoiceNumber.trim() || !invoiceInfo.invoiceDate) { alert('Supplier, bill number and date are required.'); return; }
    if (incomplete || unresolved || !medicineItems.length || continuationConflict) { alert('Resolve unfinished pages, missing GST/quantity, and bill conflicts before posting.'); return; }
    if (!acknowledged) { alert('Review the extracted fields and reconciliation warnings, then confirm below.'); return; }
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) return;
    setSaving(true);
    try {
      const latest = await pharmacyImportService.get(importDraft.id);
      if (latest.status === 'posted') { onComplete(); return; }
      if (latest.revision !== importDraft.revision) throw new Error('Draft changed. Reopen it before posting.');
      const processed = [...medicineItems];
      for (let i = 0; i < processed.length; i++) {
        const item = processed[i];
        if (!item.medicineId) {
          // Exact names only: fuzzy first-result matching can post stock to a different medicine.
          const matches = await masterDataService.searchMedicines(item.medicineName.trim());
          const exact = matches.find(m => m.name.trim().toLowerCase() === item.medicineName.trim().toLowerCase());
          if (exact) processed[i] = { ...item, medicineId: exact.id, isMatched: true };
          else {
            const created = await masterDataService.upsertMasterDataAndPrice('medicine', {
              name: item.medicineName.trim(), genericName: item.medicineName.trim(), brandName: item.medicineName.trim(),
              category: 'other', dosageForm: 'other', strength: item.strength || null, manufacturer: item.manufacturer || null,
              description: `Created from invoice ${invoiceInfo.invoiceNumber}`, sideEffects: [], contraindications: [], currentStock: 0,
              reorderLevel: 10, hsnCode: item.hsnCode || null, gstRate: item.gstRate!, isActive: true
            }, { sellingPrice: item.mrp ?? 0, costPrice: item.unitCostPrice }, profile.clinicId);
            processed[i] = { ...item, medicineId: created.itemId, isMatched: true };
          }
        }
      }
      setMedicineItems(processed);
      const saved = await onSaveDraft({ invoiceInfo, medicineItems: processed, headerResolution });
      await pharmacyImportService.post(saved, { ...invoiceInfo, isInterstate: interstate, roundOff }, processed.map(item => ({
        ...item, packSize: parsePackSize(item.packSize), source: { file: item.sourceFile, page: item.sourcePage, serialNumber: item.serialNumber,
          rack: item.rack, oldMrp: item.oldMrp, printedGross: item.totalCostPrice, printedTaxable: item.taxableAmount, printedNet: item.netAmount,
          warnings: item.warnings, reviewAcknowledged: true }
      })));
      alert(`${processed.length} items added to ${invoiceInfo.invoiceNumber}. Existing stock was not reposted.`);
      onComplete();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading suppliers and medicines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Review Extracted Invoice Data</h2>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-gray-600">File: {fileName}</span>
              <span className="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700">
                Verify against supplier bill
              </span>
              {rawText && <button
                onClick={() => setShowRawText(!showRawText)}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Eye className="w-4 h-4" />
                {showRawText ? 'Hide' : 'Show'} Raw Text
              </button>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving || draftSaving}
            aria-label="Close invoice review"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <fieldset disabled={saving || draftSaving} className="p-6 space-y-6 min-w-0">
          {/* Raw Text Display */}
          {showRawText && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-2">Raw OCR Text</h3>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {rawText}
              </pre>
            </div>
          )}

          {/* Invoice Information */}
          <div ref={headerRef} className="bg-blue-50 border border-blue-200 rounded-lg p-4 scroll-mt-28">
            <h3 className="font-medium text-blue-800 mb-4">Invoice Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                <select
                  disabled={!!existingReceipt}
                  value={invoiceInfo.supplierId}
                  onChange={(e) => {
                    const supplier = suppliers.find(s => s.id === e.target.value);
                    setInvoiceInfo({ ...invoiceInfo, supplierId: e.target.value, supplierName: supplier?.name || '', supplierGstin: supplier?.gstin || '' });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {invoiceInfo.supplierName && !invoiceInfo.supplierId && (
                  <p className="text-xs text-orange-600 mt-1">
                    Extracted: "{invoiceInfo.supplierName}" - Please select matching supplier
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
                <input
                  type="text"
                  disabled={!!existingReceipt}
                  value={invoiceInfo.invoiceNumber}
                  onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter supplier invoice number"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Required: use the number printed on the supplier bill
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
                <input
                  type="date"
                  disabled={!!existingReceipt}
                  value={invoiceInfo.invoiceDate}
                  onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grand Total (₹, incl. GST)</label>
                <input
                  type="number"
                  value={calculateTotalAmount()}
                  readOnly
                  className={`w-full px-3 py-2 border rounded-lg bg-gray-50 ${totalMismatch ? 'border-amber-400' : 'border-gray-300'}`}
                />
                {totalMismatch && (
                  <p className="text-xs text-amber-700 mt-1">Invoice shows ₹{extractedGrand?.toFixed(2)}. Check rates, GST % and discounts.</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className={`px-2 py-1 rounded ${interstate ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>
                {interstate ? 'Inter-state: IGST' : 'Intra-state: CGST + SGST'}
              </span>
              {invoiceInfo.supplierGstin && <span className="font-mono text-gray-600">Invoice GSTIN {invoiceInfo.supplierGstin}</span>}
              {selectedSupplier && !selectedSupplier.gstin && (
                <span className="text-amber-700">Selected supplier has no GSTIN saved{invoiceInfo.supplierGstin ? ' — add it in Suppliers to claim input credit' : ''}.</span>
              )}
              <span className="text-gray-600">Taxable {inr(invoiceTotals.taxable)} · GST {inr(invoiceTotals.cgst + invoiceTotals.sgst + invoiceTotals.igst)}</span>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 p-4 text-sm space-y-2">
            {existingReceipt && <p>Previously posted: {existingReceipt.inwardItems?.length || 0} items / {inr(existingReceipt.totalAmount)}. Totals below include the existing bill plus these new items.</p>}
            {incomplete && <p className="text-red-700">Some pages are unfinished. Save this draft and retry those pages.</p>}
            {headerNeedsReview && <div className="border border-amber-300 rounded-lg p-3 space-y-2">
              <p className="font-semibold">Confirm which invoice these pages belong to</p>
              <p>Extraction found different header values. Select the actual seller and correct bill number/date in Invoice Information. Confirm below only if every page belongs to this bill.</p>
              <details><summary className="cursor-pointer">Compare extracted headers by page</summary>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs mt-2"><thead><tr><th>Page</th><th>Supplier</th><th>GSTIN</th><th>Bill number</th><th>Date</th></tr></thead>
                  <tbody>{importDraft.payload.pages.map(p => <tr key={p.key}><td>{p.page}</td><td>{p.data?.invoiceInfo.supplierName || 'Unknown'}</td><td>{p.data?.invoiceInfo.supplierGstin || 'Unknown'}</td><td>{p.data?.invoiceInfo.invoiceNumber || 'Unknown'}</td><td>{p.data?.invoiceInfo.invoiceDate || 'Unknown'}</td></tr>)}</tbody>
                </table></div>
              </details>
              <p>{continuationConflict ? 'Confirmation needed beside the Finalize button.' : 'Header differences reviewed for the selected invoice.'}</p>
            </div>}
            {(totalMismatch || taxMismatch || taxableMismatch) && <p>Printed totals differ. Printed taxable: {invoiceInfo.extractedTaxable ?? 'unknown'}; tax: {invoiceInfo.extractedTax ?? 'unknown'}; grand total: {extractedGrand ?? 'unknown'}. Check missing rows, discounts, tax and rounding.</p>}
            {duplicateRows.length > 0 && <p>Possible repeated rows: {duplicateRows.join(', ')}. Verify before keeping them; legitimate batches are never automatically deleted.</p>}
            {existingDuplicates && <p>Some new rows resemble items already on this bill. Remove any overlapping uploads.</p>}
            <details><summary className="cursor-pointer">Extraction notes ({extractedData.warnings?.length || 0})</summary>{extractedData.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}</details>
            {unresolved && <p className="text-red-700">Resolve blank GST, product names or invalid quantities/rates before posting.</p>}
            <label className="block">Invoice round off <input type="number" step="0.01" className="border rounded px-2 py-1" value={invoiceInfo.roundOff ?? ''} placeholder={roundOff.toFixed(2)} onChange={e => setInvoiceInfo({ ...invoiceInfo, roundOff: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <p>Review confirmations and any remaining blockers are beside the Finalize button at the bottom.</p>
          </div>
          {/* Medicine Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                Medicine Items ({filteredMedicineItems.length} of {medicineItems.length})
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Filter items..."
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <button
                  onClick={addMedicineItem}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {filteredMedicineItems.map((item) => {
                // Find the original index in the full medicineItems array
                const originalIndex = medicineItems.findIndex(originalItem => originalItem.id === item.id);
                
                return (
                <div key={item.id} className={`border rounded-lg p-4 ${
                  item.isMatched ? 'border-green-200 bg-green-50' : 'border-gray-200'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {item.isMatched ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-orange-600" />
                      )}
                      <span className="text-sm font-medium">
                        {item.isMatched ? 'Matched with master data' : 'No match found - manual entry'}
                      </span>
                    </div>
                    <button
                      onClick={() => removeMedicineItem(originalIndex)}
                      className="p-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-xs text-gray-600 mb-3 space-y-1">
                    <p>{item.sourceFile || 'Manual entry'} {item.sourcePage ? `- page ${item.sourcePage}` : ''} | Sr {item.serialNumber || '-'} | Rack {item.rack || '-'} | Old MRP {item.oldMrp ?? '-'}</p>
                    <p>Printed amount {item.totalCostPrice ?? '-'} | Taxable {item.taxableAmount ?? '-'} | Net {item.netAmount ?? '-'}
                      {item.netAmount != null && Math.abs(item.netAmount - lineTax(item).total) > 0.05 ? ' - differs from calculated line total' : ''}</p>
                    {item.rateUnknown && <p className="text-red-700">Purchase rate could not be read. Enter the printed rate.</p>}
                    {(item.mrp == null || item.discountPercent == null && item.discountAmount == null) && <p className="text-amber-700">MRP or discount is unreadable/not printed. Verify; a blank discount is treated as none for calculation.</p>}
                    {item.warnings?.map((w, i) => <p className="text-amber-700" key={i}>{w}</p>)}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Medicine Name *</label>
                      <input
                        type="text"
                        value={item.medicineName}
                        onChange={(e) => updateMedicineItem(originalIndex, 'medicineName', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Medicine name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateMedicineItem(originalIndex, 'quantity', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Rate (₹, ex-GST) *</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitCostPrice}
                        onChange={(e) => updateMedicineItem(originalIndex, 'unitCostPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Line Total (₹, incl. GST)</label>
                      <input
                        type="number"
                        value={lineTax(item).total}
                        readOnly
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">MRP (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.mrp ?? ''}
                        onChange={(e) => updateMedicineItem(originalIndex, 'mrp', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">GST %</label>
                      <select
                        value={item.gstRate ?? ''}
                        onChange={(e) => updateMedicineItem(originalIndex, 'gstRate', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Missing - select GST</option>
                        {item.gstRate != null && !GST_RATES.some(r => r === item.gstRate) && <option value={item.gstRate}>{item.gstRate}% (printed)</option>}
                        {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">HSN</label>
                      <input
                        type="text"
                        value={item.hsnCode}
                        onChange={(e) => updateMedicineItem(originalIndex, 'hsnCode', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="3004"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Disc %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={item.discountPercent ?? ''}
                        onChange={(e) => updateMedicineItem(originalIndex, 'discountPercent', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Disc ₹</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discountAmount ?? ''}
                        onChange={(e) => updateMedicineItem(originalIndex, 'discountAmount', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Free Qty</label>
                      <input
                        type="number"
                        min="0"
                        value={item.freeQuantity}
                        onChange={(e) => updateMedicineItem(originalIndex, 'freeQuantity', parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Pack (1x10 / 10'S)</label>
                      <input
                        type="text"
                        value={item.packSize || ''}
                        onChange={(e) => updateMedicineItem(originalIndex, 'packSize', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="as printed on the invoice"
                      />
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {parsePackSize(item.packSize) ? `read as ${parsePackSize(item.packSize)} loose units per pack` : 'teaches the master its pack size'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                      <input
                        type="text"
                        value={item.batchNumber}
                        onChange={(e) => updateMedicineItem(originalIndex, 'batchNumber', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Expiry Date</label>
                      <input
                        type="date"
                        value={item.expiryDate}
                        onChange={(e) => updateMedicineItem(originalIndex, 'expiryDate', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Manufacturer</label>
                      <input
                        type="text"
                        value={item.manufacturer}
                        onChange={(e) => updateMedicineItem(originalIndex, 'manufacturer', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Strength</label>
                      <input
                        type="text"
                        value={item.strength}
                        onChange={(e) => updateMedicineItem(originalIndex, 'strength', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., 500mg"
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-3">
              <div><div className="text-gray-500">Taxable</div><div className="font-semibold">{inr(invoiceTotals.taxable)}</div></div>
              {interstate
                ? <div><div className="text-gray-500">IGST</div><div className="font-semibold">{inr(invoiceTotals.igst)}</div></div>
                : <>
                    <div><div className="text-gray-500">CGST</div><div className="font-semibold">{inr(invoiceTotals.cgst)}</div></div>
                    <div><div className="text-gray-500">SGST</div><div className="font-semibold">{inr(invoiceTotals.sgst)}</div></div>
                  </>}
              <div><div className="text-gray-500">Round off</div><div className="font-semibold">{invoiceTotals.roundOff.toFixed(2)}</div></div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-gray-800">Grand Total (incl. GST):</span>
              <span className="text-xl font-bold text-blue-600">₹{calculateTotalAmount().toLocaleString()}</span>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {medicineItems.filter(item => item.isMatched).length} of {medicineItems.length} medicines matched with master data
              {itemSearchTerm && (
                <span className="ml-2 text-blue-600">• Showing {filteredMedicineItems.length} filtered items</span>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea
              value={invoiceInfo.remarks}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, remarks: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Additional notes about this invoice..."
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
            <button type="button" className="text-blue-700 underline" onClick={() => headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Edit supplier / bill details</button>
            {headerNeedsReview && <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" disabled={!invoiceInfo.supplierId || !invoiceInfo.invoiceNumber.trim() || !invoiceInfo.invoiceDate}
                checked={headerResolution === headerReview.signature}
                onChange={e => { setHeaderResolution(e.target.checked ? headerReview.signature : ''); setAcknowledged(false); }} />
              <span>I verified that all {importDraft.payload.pages.length} pages belong to <strong>{selectedSupplier?.name || 'the selected supplier'}</strong> (GSTIN: {selectedSupplier?.gstin || invoiceInfo.supplierGstin || 'not recorded'}), invoice <strong>{invoiceInfo.invoiceNumber || '(required)'}</strong>, dated <strong>{invoiceInfo.invoiceDate || '(required)'}</strong>. Use these details despite the extraction differences.</span>
            </label>}
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I checked all pages, item count, MRP, GST, discounts, totals and any duplicate warnings against the supplier bill.</label>
            {blockers.length > 0 ? <div role="status" className="text-red-700"><p className="font-semibold">Before finalizing:</p><ul className="list-disc pl-5">{blockers.map(reason => <li key={reason}>{reason}</li>)}</ul></div> : <p role="status" className="text-green-700">Ready to finalize {medicineItems.length} items.</p>}
          </div>
          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            {!invoiceInfo.supplierId && (
              <div className="flex items-center gap-2 text-orange-600 text-sm mr-4">
                <AlertCircle className="w-4 h-4" />
                <span>Please select a supplier to enable save</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button disabled={saving || draftSaving} onClick={saveDraft} className="px-4 py-2 border rounded-lg">{draftSaving ? 'Saving...' : 'Save draft / add Part 2'}</button>
            <button
              onClick={handleSave}
              disabled={saving || draftSaving || blockers.length > 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Finalize & post new items'}
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
};

export default InvoiceReviewModal;
