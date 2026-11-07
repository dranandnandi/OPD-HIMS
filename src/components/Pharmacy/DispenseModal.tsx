import MedicineFlags from './MedicineFlags';
import ControlledSupplyPopup from './ControlledSupplyPopup';
import ExpiryBadge from './ExpiryBadge';
import { expiryStatus, expiryDateKey } from '../../utils/pharmacyExpiry';
import { usePharmacyDate } from '../../hooks/usePharmacyDate';
import { fifoBatches, allocateFifoBatches } from '../../utils/pharmacyBatches';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Save, Plus, Trash2, AlertCircle, CheckCircle, MapPin, Printer, Receipt, FileText, Camera, Bell, User, Pencil } from 'lucide-react';
import BarcodeScanInput from './BarcodeScanInput';
import MedicineSearchSelect from './MedicineSearchSelect';
import MedicineIdentifyModal from './MedicineIdentifyModal';
import { refillReminderService, parseDurationDays } from '../../services/refillReminderService';
import { Visit, Patient, MedicineWithPrice, PharmacyDispensedItem, MedicineBatch, Bill, ControlledSaleDetails } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import { patientService } from '../../services/patientService';
import { pharmacyService, DispenseItemInput } from '../../services/pharmacyService';
import { PharmacyBillLineInput } from '../../services/billingService';
import { pharmacyInvoiceService } from '../../services/pharmacyInvoiceService';
import { useAuth } from '../Auth/useAuth';
import { computeGstLine, sumGstLines, groupByRate, GST_RATES, inr, round2 } from '../../utils/gst';
import { packSpec, toStockUnits, toDispenseUnits, unitRate, round3, fmtQty, stockDisplay } from '../../utils/packUnits';
import { resolveDispensePrice } from '../../utils/dispensePrice';
import { noSaleDiscount, saleDiscountPercent, updateSaleDiscount } from '../../utils/saleDiscount';

interface DispenseModalProps {
  /** The OPD visit being dispensed against. Omit for an over-the-counter sale. */
  visit?: Visit;
  /** Required when there is no visit: who the counter sale is billed to. */
  patient?: Patient;
  /** Called after a successful dispense. `bill` is set when a pharmacy invoice was raised. */
  onSave: (dispensedItems?: PharmacyDispensedItem[], bill?: Bill) => void;
  onClose: () => void;
}

interface DispenseLine {
  prescriptionId?: string;
  medicineId: string;
  batchId: string;
  /**
   * The number the pharmacist typed, in whichever unit the line is set to:
   * dispense units (tablets) when sellLoose, stocked units (strips) otherwise.
   * Stock, price and tax are all derived from it in lineMath().
   */
  quantity: number;
  /** True when the pack is broken open and the quantity is in dispense units. */
  sellLoose: boolean;
  /** MRP of one stocked unit — the whole pack, as printed on it. */
  unitPrice: number;
  discountPercent: number;
  applySaleDiscount: boolean;
  gstRate: number;
  originalPrescriptionName?: string;
  isMatched: boolean;
}

// Must match the payment_records CHECK constraint — 'online' is rejected
// there, which made the invoice save but the payment row silently fail.
type PaymentMethod = 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet';

const DispenseModal: React.FC<DispenseModalProps> = ({ visit, patient: patientProp, onSave, onClose }) => {
  const today = usePharmacyDate();
  const { user } = useAuth();
  const patient: Patient | undefined = visit?.patient || patientProp;
  const isCounterSale = !visit;
  // Editable copy of the customer, so an auto-named walk-in ("Customer
  // 17-Oct-2026-1") can be given their real name/number on the success screen.
  const [customer, setCustomer] = useState<Patient | undefined>(patient);
  const [custEdit, setCustEdit] = useState<{ name: string; phone: string; age: string; gender: Patient['gender'] } | null>(null);
  const [custSaving, setCustSaving] = useState(false);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<DispenseLine[]>([]);
  const initializedSale = useRef<string>();

  const [collectNow, setCollectNow] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [controlled, setControlled] = useState<ControlledSaleDetails>({
    patientName: patient?.name?.startsWith('Customer ') ? '' : patient?.name || '', patientAddress: patient?.address || '',
    prescriberName: visit?.doctor?.name || '', prescriberAddress: visit?.doctor ? user?.clinic?.address || '' : '',
    prescriptionReference: '', prescriptionDate: '', pharmacistName: user?.name || '', pharmacistRegistration: user?.registrationNo || '',
  });
  const [prescriptionChecked, setPrescriptionChecked] = useState(false);
  const [controlledAction, setControlledAction] = useState<'dispense' | 'invoice' | null>(null);
  const hasControlled = lines.some(l => {
    const m = medicines.find(m => m.id === l.medicineId);
    return l.quantity > 0 && (m?.isNrx || m?.isScheduleH1);
  });

  // Success state: invoice raised, offer print
  const [result, setResult] = useState<{ dispensed: PharmacyDispensedItem[]; bill?: Bill } | null>(null);
  const [printing, setPrinting] = useState(false);

  const [showIdentify, setShowIdentify] = useState(false);
  // Refill reminder captured with the sale. Suggested from prescription
  // duration (or quantity for chronic medicines); the pharmacist can override.
  const [refill, setRefill] = useState<{ enabled: boolean; dueDate: string; touched: boolean }>({ enabled: false, dueDate: '', touched: false });
  const [refillSaved, setRefillSaved] = useState<string | null>(null);

  const clinic = user?.clinic;
  const compositionScheme = clinic?.pharmacyGstScheme === 'composition';
  // This form enters the printed pack MRP; GST is extracted from that price.
  const pricesIncludeGst = true;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const saleKey = visit?.id ?? 'counter';
    if (loading || initializedSale.current === saleKey) return;
    initializedSale.current = saleKey;
    initializeLines();
    // Refreshing medicine data after linking a barcode must preserve entered rows.
  }, [visit, medicines, batches, loading]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [medicinesData, batchesData] = await Promise.all([
        masterDataService.getMedicines(user?.clinicId),
        pharmacyService.getBatches()
      ]);
      setMedicines(medicinesData);
      setBatches(batchesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load medicines');
      console.error('Error loading medicines:', err);
    } finally {
      setLoading(false);
    }
  };

  const batchesFor = (medicineId: string): MedicineBatch[] =>
    fifoBatches(batches, medicineId, today);

  /** First-received available batch (FIFO); expired batches are excluded. */
  const defaultBatch = (medicineId: string): MedicineBatch | undefined => batchesFor(medicineId)[0];

  const lineFromMedicine = (
    m: MedicineWithPrice | undefined,
    base: Partial<DispenseLine>
  ): DispenseLine => {
    const batch = m ? defaultBatch(m.id) : undefined;
    const spec = packSpec(m);
    return {
      prescriptionId: base.prescriptionId,
      medicineId: m?.id || '',
      batchId: batch?.id || '',
      quantity: base.quantity || 1,
      // A strip of 10 is sold by the tablet by default — that is the number
      // both the prescription and the customer talk in. The pharmacist can
      // switch the line back to whole packs.
      sellLoose: base.sellLoose ?? spec.looseCapable,
      unitPrice: resolveDispensePrice(m, batch).unitPrice,
      ...noSaleDiscount(),
      gstRate: compositionScheme ? 0 : (m?.gstRate ?? 12),
      originalPrescriptionName: base.originalPrescriptionName,
      isMatched: !!m
    };
  };

  /** Pack rules for a line's medicine, with defaults for an unset SKU. */
  const specFor = (line: DispenseLine) => packSpec(medicines.find(m => m.id === line.medicineId));

  /**
   * Everything that follows from the typed quantity. The entered number is in
   * dispense units on a loose sale, so stock moves by a fraction of a pack
   * while the price is the per-tablet rate — a half strip of a 100-rupee
   * strip of 10 is 5 tablets at 10.00, i.e. 50.00 with GST backed out of it.
   */
  const lineMath = (line: DispenseLine) => {
    const spec = specFor(line);
    const loose = line.sellLoose && spec.packSize > 1;
    const entered = Math.max(0, Number(line.quantity) || 0);
    const stockQty = loose ? toStockUnits(entered, spec.packSize) : round3(entered);
    const dispenseQty = loose ? round3(entered) : toDispenseUnits(entered, spec.packSize);
    // The invoice is written in whichever unit was typed, at the matching
    // rate, so the printed quantity times the printed rate is the amount.
    const billedQty = round3(entered);
    const billedUnitLabel = loose ? spec.dispenseUnit : spec.stockUnit;
    const billedRate = unitRate(line.unitPrice, spec.packSize, loose);
    const tax = computeGstLine({
      quantity: entered,
      unitPrice: billedRate,
      discountPercent: saleDiscountPercent(line),
      gstRate: line.gstRate,
      priceIncludesGst: pricesIncludeGst,
      interstate: false
    });
    return { spec, loose, entered, stockQty, dispenseQty, billedQty, billedUnitLabel, billedRate, tax };
  };

  const initializeLines = () => {
    const prescriptions = visit?.prescriptions || [];
    if (prescriptions.length > 0) {
      setLines(prescriptions.map(prescription => {
        let matched: MedicineWithPrice | undefined;
        if (prescription.medicineId) {
          matched = medicines.find(m => m.id === prescription.medicineId);
        }
        if (!matched) {
          const name = prescription.medicine.toLowerCase();
          matched = medicines.find(m =>
            m.name.toLowerCase() === name ||
            m.genericName?.toLowerCase() === name ||
            m.brandName?.toLowerCase() === name ||
            name.includes(m.name.toLowerCase()) ||
            m.name.toLowerCase().includes(name)
          );
        }
        return lineFromMedicine(matched, {
          prescriptionId: prescription.id,
          quantity: prescription.quantity || 1,
          originalPrescriptionName: prescription.medicine
        });
      }));
    } else {
      setLines([lineFromMedicine(undefined, {})]);
    }
  };

  const addLine = () => setLines([...lines, lineFromMedicine(undefined, {})]);
  const removeLine = (index: number) => setLines(lines.filter((_, i) => i !== index));

  /**
   * Scanned or photo-identified medicine: bump an existing line or fill/add
   * one. Scanning a pack barcode means one more of THAT pack, so the line is
   * set to whole packs and a repeat scan adds a pack's worth either way.
   */
  const addMedicineQuick = (m: MedicineWithPrice) => {
    const spec = packSpec(m);
    setLines(prev => {
      const existing = prev.findIndex(l => l.medicineId === m.id);
      if (existing >= 0) {
        return prev.map((l, i) => i === existing
          ? { ...l, quantity: round3(l.quantity + (l.sellLoose && spec.packSize > 1 ? spec.packSize : 1)) }
          : l);
      }
      const empty = prev.findIndex(l => !l.medicineId);
      const fresh = lineFromMedicine(m, { sellLoose: false });
      if (empty >= 0) return prev.map((l, i) => i === empty ? fresh : l);
      return [...prev, fresh];
    });
  };

  const reloadMedicines = async () => {
    try { setMedicines(await masterDataService.getMedicines(user?.clinicId)); } catch { /* keep current list */ }
  };

  // Suggest a refill date: longest prescription duration on the sale, or for
  // chronic medicines sold over the counter, quantity at one unit a day.
  useEffect(() => {
    if (refill.touched) return;
    let days = 0;
    let anyChronic = false;
    for (const l of lines) {
      if (!l.medicineId) continue;
      const m = medicines.find(x => x.id === l.medicineId);
      const rx = visit?.prescriptions?.find(p => p.id === l.prescriptionId);
      const rxDays = parseDurationDays(rx?.duration);
      if (m?.isChronic) anyChronic = true;
      // One dispense unit a day: 30 tablets is a month, whatever the pack.
      days = Math.max(days, rxDays, m?.isChronic ? Math.floor(lineMath(l).dispenseQty) : 0);
    }
    if (days <= 0) {
      setRefill(r => ({ ...r, enabled: false, dueDate: '' }));
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + days);
    setRefill(r => ({ ...r, enabled: anyChronic || days >= 14, dueDate: due.toISOString().slice(0, 10) }));
  }, [lines, medicines, visit, refill.touched]);

  const saveRefillReminder = async (billId?: string) => {
    if (!refill.enabled || !refill.dueDate || !patient?.id) return;
    const meds = lines.filter(l => l.medicineId && l.quantity > 0).map(l => {
      const m = medicines.find(x => x.id === l.medicineId);
      return {
        medicineId: l.medicineId,
        name: m ? [m.name, m.strength].filter(Boolean).join(' ') : 'medicine',
        quantity: lineMath(l).dispenseQty
      };
    });
    try {
      await refillReminderService.create({
        patientId: patient.id,
        billId: billId || null,
        visitId: visit?.id || null,
        medicines: meds,
        dueDate: new Date(`${refill.dueDate}T00:00:00`)
      });
      setRefillSaved(refill.dueDate);
    } catch (err) {
      console.error('Refill reminder not saved:', err);
    }
  };

  const updateLine = (index: number, patch: Partial<DispenseLine>) => {
    setLines(lines.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, ...patch };
      Object.assign(next, updateSaleDiscount(line, patch,
        patch.medicineId !== undefined && patch.medicineId !== line.medicineId));
      if (patch.medicineId !== undefined) {
        const m = medicines.find(x => x.id === patch.medicineId);
        const b = m ? defaultBatch(m.id) : undefined;
        next.batchId = b?.id || '';
        next.unitPrice = resolveDispensePrice(m, b).unitPrice;
        next.gstRate = compositionScheme ? 0 : (m?.gstRate ?? 12);
        next.sellLoose = packSpec(m).looseCapable;
        next.isMatched = !!m;
      }
      if (patch.batchId !== undefined) {
        const m = medicines.find(x => x.id === next.medicineId);
        const b = batches.find(x => x.id === patch.batchId && x.medicineId === next.medicineId);
        next.unitPrice = resolveDispensePrice(m, b).unitPrice;
      }
      // Quantity is the count of the selected unit: selecting Strip with
      // quantity 1 means one whole strip, selecting Tablet means one tablet.
      return next;
    }));
  };

  const allocateFifo = (index: number) => {
    const line = lines[index];
    const m = medicines.find(m => m.id === line.medicineId);
    if (!m) return;
    const spec = packSpec(m), reserved = new Map<string, number>();
    lines.forEach((other, i) => {
      if (i !== index && other.batchId) reserved.set(other.batchId, (reserved.get(other.batchId) || 0) + lineMath(other).stockQty);
    });
    try {
      const allocated = allocateFifoBatches(batchesFor(m.id), line.quantity, spec.packSize, line.sellLoose, reserved);
      setLines(lines.flatMap((l, i) => i === index ? allocated.map(({ batch, quantity }) => ({
        ...l, batchId: batch.id, quantity, unitPrice: resolveDispensePrice(m, batch).unitPrice,
      })) : [l]));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not allocate batches.'); }
  };

  const availableStock = (line: DispenseLine): number => {
    if (line.batchId) return batches.find(b => b.id === line.batchId)?.quantity || 0;
    const total = medicines.find(m => m.id === line.medicineId)?.currentStock || 0;
    // The pool excludes every tracked batch, including expired batches.
    return Math.max(0, total - batches.filter(b => b.medicineId === line.medicineId).reduce((sum,b) => sum + b.quantity, 0));
  };

  /** Stock is held in stocked units, so a loose quantity is converted first. */
  const stockOk = (line: DispenseLine) =>
    !line.medicineId || availableStock(line) + 1e-9 >= lineMath(line).stockQty;

  // Tax per line + invoice totals, recomputed on every edit
  const computed = useMemo(() => {
    const valid = lines.filter(l => l.medicineId && l.quantity > 0);
    const results = valid.map(l => ({ line: l, tax: lineMath(l).tax }));
    const totals = sumGstLines(results.map(r => r.tax), false);
    const byRate = groupByRate(results.map(r => ({ ...r.tax, gstRate: r.line.gstRate })));
    return { results, totals, byRate };
  }, [lines, medicines, pricesIncludeGst]);

  const validate = (): DispenseLine[] | null => {
    if (!user) {
      alert('You must be logged in to dispense medicines');
      return null;
    }
    const valid = lines.filter(l => l.medicineId && l.quantity > 0);
    if (valid.length === 0) {
      alert('Please add at least one valid medicine item');
      return null;
    }
    for (const l of valid) {
      const medicine = medicines.find(m => m.id === l.medicineId);
      const batch = batches.find(b => b.id === l.batchId);
      if ((l.batchId && !batch) || expiryStatus(l.batchId ? batch?.expiryDate : medicine?.expiryDate).kind === 'expired') {
        alert(`The selected stock for ${medicine?.name || 'this medicine'} has expired or is no longer available. Select an unexpired batch.`);
        return null;
      }
      const { spec, stockQty, loose } = lineMath(l);
      if (!loose && spec.packSize > 1 && !Number.isInteger(l.quantity)) {
        alert(`Enter whole ${spec.stockUnit.toLowerCase()}s, or select ${spec.dispenseUnit} for a loose quantity.`);
        return null;
      }
      if (!spec.allowLooseSale && stockQty % 1 !== 0) {
        const m = medicines.find(x => x.id === l.medicineId);
        alert(`${m?.name} can only be sold in whole ${spec.stockUnit.toLowerCase()}s.`);
        return null;
      }
      if (!stockOk(l)) {
        const m = medicines.find(x => x.id === l.medicineId);
        alert(
          `Insufficient stock for ${m?.name}. Available: ${stockDisplay(availableStock(l), spec)}, ` +
          `required: ${fmtQty(stockQty)} ${spec.stockUnit}` +
          (loose ? ` (${fmtQty(lineMath(l).dispenseQty)} ${spec.dispenseUnit})` : '')
        );
        return null;
      }
    }
    return valid;
  };

  const toDispenseInputs = (valid: DispenseLine[]): DispenseItemInput[] =>
    valid.map(l => {
      const m = medicines.find(x => x.id === l.medicineId);
      const b = batches.find(x => x.id === l.batchId);
      const { spec, stockQty, billedQty, billedUnitLabel, billedRate, tax: t } = lineMath(l);
      return {
        controlledSaleDetails: m?.isNrx || m?.isScheduleH1 ? { ...controlled, prescriptionVerified: prescriptionChecked } : undefined,
        visitId: visit?.id ?? null,
        prescriptionId: l.prescriptionId,
        medicineId: l.medicineId,
        // Stock always moves in stocked units; the billed pair is the line as
        // the customer sees it, so rate x quantity is the amount either way.
        quantity: stockQty,
        packSize: spec.packSize,
        billedQuantity: billedQty,
        billedUnit: billedUnitLabel,
        dispensedBy: user!.id,
        dispenseDate: new Date(),
        sellingPriceAtDispense: billedRate,
        batchNumber: b?.batchNumber || m?.batchNumber || '',
        batchId: b?.id,
        hsnCode: m?.hsnCode,
        gstRate: l.gstRate,
        mrp: b?.mrp ?? l.unitPrice,
        discountAmount: t.discount,
        taxableAmount: t.taxable,
        cgstAmount: t.cgst,
        sgstAmount: t.sgst,
        igstAmount: t.igst
      };
    });

  const handleDispenseOnly = async () => {
    const valid = validate();
    if (!valid) return;
    try {
      setSaving(true);
      const dispensed = await pharmacyService.dispenseMedicines(toDispenseInputs(valid));
      await saveRefillReminder();
      setResult({ dispensed });
    } catch (err) {
      console.error('Error dispensing medicines:', err);
      alert(err instanceof Error ? err.message : 'Failed to dispense medicines');
    } finally {
      setSaving(false);
    }
  };

  const handleDispenseAndInvoice = async () => {
    const valid = validate();
    if (!valid) return;
    if (!patient?.id) {
      alert(isCounterSale ? 'Select a customer first.' : 'This visit has no patient attached; cannot raise an invoice.');
      return;
    }

    const billLines: PharmacyBillLineInput[] = valid.map(l => {
      const m = medicines.find(x => x.id === l.medicineId)!;
      const b = batches.find(x => x.id === l.batchId);
      const { spec, stockQty, billedQty, billedUnitLabel, billedRate, tax: t } = lineMath(l);
      return {
        medicineId: m.id,
        itemName: [m.name, m.strength].filter(Boolean).join(' '),
        quantity: stockQty,
        billedQuantity: billedQty,
        packSize: spec.packSize,
        billedUnit: billedUnitLabel,
        unitPrice: billedRate,
        mrp: b?.mrp ?? l.unitPrice,
        batchId: b?.id,
        batchNumber: b?.batchNumber || m.batchNumber,
        expiryDate: b?.expiryDate || m.expiryDate,
        hsnCode: m.hsnCode,
        gstRate: l.gstRate,
        discountAmount: t.discount,
        saleDiscountPercent: saleDiscountPercent(l),
        taxableAmount: t.taxable,
        cgstAmount: t.cgst,
        sgstAmount: t.sgst,
        igstAmount: t.igst,
        totalPrice: t.total
      };
    });

    const { totals } = computed;
    try {
      setSaving(true);
      const res = await pharmacyService.dispenseAndInvoice(toDispenseInputs(valid), {
        patientId: patient.id,
        visitId: visit?.id ?? null,
        lines: billLines,
        totals: {
          discount: totals.discount,
          taxable: totals.taxable,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          roundOff: totals.roundOff,
          grandTotal: totals.grandTotal
        },
        paidAmount: collectNow ? totals.grandTotal : 0,
        paymentMethod,
        notes: notes.trim() || undefined
      });
      await saveRefillReminder(res.bill.id);
      setResult(res);
    } catch (err) {
      console.error('Error dispensing medicines:', err);
      alert(err instanceof Error ? err.message : 'Failed to dispense medicines');
    } finally {
      setSaving(false);
    }
  };

  const requestDispense = (action: 'dispense' | 'invoice') => {
    if (!validate()) return;
    if (hasControlled) {
      setControlledAction(action);
      return;
    }
    void (action === 'dispense' ? handleDispenseOnly() : handleDispenseAndInvoice());
  };

  const saveCustomer = async () => {
    if (!customer?.id || !custEdit) return;
    const name = custEdit.name.trim();
    if (!name) { alert('Enter a name'); return; }
    const digits = custEdit.phone.replace(/\D/g, '');
    if (digits && digits.length < 10) {
      alert('Enter a valid 10-digit mobile number, or leave it blank to keep the current one');
      return;
    }
    try {
      setCustSaving(true);
      const updated = await patientService.updatePatient(customer.id, {
        name,
        phone: digits ? digits.slice(-10) : customer.phone,
        age: custEdit.age ? parseInt(custEdit.age) : null,
        gender: custEdit.gender
      });
      setCustomer({ ...customer, ...updated });
      setCustEdit(null);
    } catch (err) {
      console.error('Could not update customer:', err);
      alert(err instanceof Error ? err.message : 'Could not update customer');
    } finally {
      setCustSaving(false);
    }
  };

  const handlePrint = async () => {
    if (!result?.bill || !customer || !clinic) return;
    try {
      setPrinting(true);
      const pdf = await pharmacyInvoiceService.open(result.bill.id);
      setResult(current => current?.bill ? { ...current, bill: { ...current.bill, pdfUrl: pdf.url } } : current);
    } catch (err) {
      console.error('Error generating invoice PDF:', err);
      alert(err instanceof Error ? err.message : 'Failed to generate invoice PDF');
    } finally {
      setPrinting(false);
    }
  };

  const finish = () => {
    if (result) onSave(result.dispensed, result.bill);
    onClose();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading medicines...</p>
        </div>
      </div>
    );
  }

  // ---- Success screen ----
  if (result) {
    const autoNamed = /^Customer \d{1,2}-[A-Za-z]{3}-\d{4}-\d+$/.test(customer?.name || '');
    const placeholderPhone = (customer?.phone || '').startsWith('999');
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-lg w-full p-6 space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-800">Medicines dispensed</h2>
              <p className="text-sm text-gray-600">
                {result.dispensed.length} item{result.dispensed.length === 1 ? '' : 's'} dispensed
              </p>
            </div>
          </div>

          {/* Customer card: the walk-in's saved identity, editable in place */}
          <div className={`border rounded-lg p-4 text-sm ${autoNamed ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
            {!custEdit ? (
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <User className={`w-4 h-4 mt-0.5 ${autoNamed ? 'text-amber-600' : 'text-gray-500'}`} />
                  <div>
                    <div className="font-semibold text-gray-800">{customer?.name}</div>
                    <div className="text-xs text-gray-600">
                      {placeholderPhone ? 'No mobile on file' : customer?.phone}
                      {(customer?.patientNumber || customer?.patient_number) && <> · {customer?.patientNumber || customer?.patient_number}</>}
                    </div>
                    {autoNamed && (
                      <div className="text-xs text-amber-700 mt-1">
                        Saved without a name — tell the customer this ID, or add their real name now so future sales find them.
                      </div>
                    )}
                  </div>
                </div>
                {customer?.id && (
                  <button
                    onClick={() => setCustEdit({
                      name: autoNamed ? '' : (customer?.name || ''),
                      phone: placeholderPhone ? '' : (customer?.phone || ''),
                      age: customer?.age ? String(customer.age) : '',
                      gender: customer?.gender || 'other'
                    })}
                    className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-700 hover:bg-white whitespace-nowrap"
                  >
                    <Pencil className="w-3 h-3" /> Edit customer
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-600 mb-0.5">Name</label>
                    <input autoFocus type="text" value={custEdit.name}
                      onChange={(e) => setCustEdit({ ...custEdit, name: e.target.value })}
                      placeholder={autoNamed ? customer?.name : undefined}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-0.5">Mobile</label>
                    <input type="tel" value={custEdit.phone}
                      onChange={(e) => setCustEdit({ ...custEdit, phone: e.target.value })}
                      placeholder="10 digits"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Age</label>
                      <input type="number" min="0" value={custEdit.age}
                        onChange={(e) => setCustEdit({ ...custEdit, age: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-0.5">Gender</label>
                      <select value={custEdit.gender}
                        onChange={(e) => setCustEdit({ ...custEdit, gender: e.target.value as Patient['gender'] })}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setCustEdit(null)} disabled={custSaving}
                    className="px-3 py-1 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-white disabled:opacity-50">
                    Cancel
                  </button>
                  <button onClick={saveCustomer} disabled={custSaving}
                    className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50">
                    {custSaving ? 'Saving…' : 'Save customer'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {refillSaved && (
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <Bell className="w-4 h-4" /> Refill reminder set for {new Date(`${refillSaved}T00:00:00`).toLocaleDateString('en-IN')}
            </div>
          )}

          {result.bill ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-blue-800 font-medium">Pharmacy Invoice</span>
                <span className="font-mono font-semibold text-blue-900">{result.bill.billNumber}</span>
              </div>
              <div className="flex justify-between text-blue-800">
                <span>Grand total</span><span className="font-semibold">{inr(result.bill.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-blue-800">
                <span>Status</span><span className="capitalize">{result.bill.paymentStatus}</span>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
              No invoice was raised. These items can still be added to the OPD bill.
            </div>
          )}

          <div className="flex justify-end gap-3">
            {result.bill && (
              <button
                onClick={handlePrint}
                disabled={printing}
                className="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                {printing ? 'Preparing…' : 'Print / Download Invoice'}
              </button>
            )}
            <button onClick={finish} className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { totals, byRate } = computed;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{isCounterSale ? 'Counter Sale' : 'Dispense Medicines'}</h2>
            <p className="text-sm text-gray-600">
              {isCounterSale ? 'Customer' : 'Patient'}: {patient?.name}{patient?.phone ? ` (${patient.phone})` : ''}
              {visit && <> • Visit: {new Date(visit.date).toLocaleDateString()}</>}
              {isCounterSale && <> • Over the counter, no prescription on file</>}
              {compositionScheme && <span className="ml-2 text-amber-700">• Composition scheme: bill of supply, no GST</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
          )}

          {!clinic?.gstin && !compositionScheme && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <span>Clinic GSTIN is not set. The invoice will print without it. Add it under Settings → Clinic → GST.</span>
            </div>
          )}

          {visit?.prescriptions && visit.prescriptions.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-800 mb-2">Prescribed Medicines</h3>
              <div className="space-y-1">
                {visit.prescriptions.map(p => (
                  <div key={p.id} className="text-sm text-blue-700">
                    <strong>{p.medicine}</strong> - {p.dosage} {p.frequency} for {p.duration}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scan / photo entry */}
          <div className="flex flex-col md:flex-row gap-3 md:items-start">
            <div className="flex-1">
              <BarcodeScanInput
                medicines={medicines}
                onMedicine={addMedicineQuick}
                onBarcodeAssigned={reloadMedicines}
                autoFocus={isCounterSale}
              />
            </div>
            <button
              onClick={() => setShowIdentify(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 whitespace-nowrap"
              title="Photograph the pack to identify the medicine and see substitutes in stock"
            >
              <Camera className="w-4 h-4" /> Identify by photo
            </button>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Medicines to Dispense</h3>
              <button onClick={addLine} className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm">
                <Plus className="w-4 h-4" /> Add Medicine
              </button>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const medicine = medicines.find(m => m.id === line.medicineId);
                const lineBatches = line.medicineId ? batchesFor(line.medicineId) : [];
                const batch = batches.find(b => b.id === line.batchId);
                const ok = stockOk(line);
                const { spec, loose, dispenseQty, billedRate, tax: t } = lineMath(line);

                return (
                  <div key={index} className={`border rounded-lg p-4 ${
                    line.isMatched ? 'border-green-200 bg-green-50/40' :
                    line.originalPrescriptionName ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                  }`}>
                    {line.originalPrescriptionName && (
                      <div className="mb-3 flex items-center gap-2 text-sm">
                        {line.isMatched ? (
                          <span className="flex items-center gap-1 text-green-700"><CheckCircle className="w-4 h-4" /> Matched: "{line.originalPrescriptionName}"</span>
                        ) : (
                          <span className="flex items-center gap-1 text-orange-700"><AlertCircle className="w-4 h-4" /> No match for "{line.originalPrescriptionName}" - select manually</span>
                        )}
                      </div>
                    )}

                    <div className="mb-2 flex items-center justify-between"><div><MedicineFlags medicine={medicine} /></div>
                      {lineBatches.length > 0 && <button type="button" onClick={() => allocateFifo(index)} className="text-xs text-blue-700 border rounded px-2 py-1">Allocate quantity by FIFO</button>}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">Medicine *</label>
                        <MedicineSearchSelect
                          medicines={medicines}
                          value={line.medicineId}
                          onChange={(id) => updateLine(index, { medicineId: id })}
                          placeholder="Type to search medicine…"
                        />
                      </div>

                      <div className="col-span-2 lg:col-span-1">
                        <label className="block text-xs text-gray-600 mb-1">Batch</label>
                        <select
                          value={line.batchId}
                          onChange={(e) => updateLine(index, { batchId: e.target.value })}
                          disabled={!line.medicineId}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        >
                          <option value="">{lineBatches.length ? 'Select batch' : 'No batch (pool)'}</option>
                          {lineBatches.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.batchNumber}{b.mrp != null ? ` · MRP ₹${b.mrp.toFixed(2)}` : ''} · {stockDisplay(b.quantity, spec)} left · {expiryStatus(b.expiryDate).label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">
                          Qty * {loose ? `(${spec.dispenseUnit})` : `(${spec.stockUnit})`}
                        </label>
                        <div className="flex gap-1">
                          <input
                            type="number" min="0" step="1" value={line.quantity}
                            onChange={(e) => updateLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                            className={`w-full px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 ${!ok ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                          />
                          {spec.packSize > 1 && spec.allowLooseSale && (
                            <select
                              value={loose ? 'loose' : 'pack'}
                              onChange={(e) => updateLine(index, { sellLoose: e.target.value === 'loose' })}
                              title={`1 ${spec.stockUnit} = ${fmtQty(spec.packSize)} ${spec.dispenseUnit}`}
                              className="px-1 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="loose">{spec.dispenseUnit}</option>
                              <option value="pack">{spec.stockUnit}</option>
                            </select>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">MRP / {spec.stockUnit} (₹, incl. GST)</label>
                        <input
                          type="number" min="0" step="0.01" value={line.unitPrice}
                          onChange={(e) => updateLine(index, { unitPrice: parseFloat(e.target.value) || 0 })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                        />
                        {medicine && resolveDispensePrice(medicine, batch).source === 'medicine'
                          && line.unitPrice === resolveDispensePrice(medicine, batch).unitPrice && (
                          <p className="text-[11px] text-amber-700 mt-0.5">
                            Using saved medicine price{batch ? '; batch MRP unavailable' : ''}.
                          </p>
                        )}
                        {medicine && line.unitPrice <= 0 && (
                          <p className="text-[11px] text-amber-700 mt-0.5">Enter the pack MRP to price this item.</p>
                        )}
                        {loose && (
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {inr(billedRate)} / {spec.dispenseUnit}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                          <input type="checkbox" checked={line.applySaleDiscount}
                            onChange={(e) => updateLine(index, { applySaleDiscount: e.target.checked })}
                            aria-label={`Apply customer discount for ${medicine?.name || 'this medicine'}`} />
                          Sale discount %
                        </label>
                        <input
                          type="number" min="0" max="100" step="0.5" value={line.discountPercent}
                          disabled={!line.applySaleDiscount}
                          aria-label={`Customer discount percentage for ${medicine?.name || 'this medicine'}`}
                          onWheel={(e) => e.currentTarget.blur()}
                          onChange={(e) => updateLine(index, { discountPercent: parseFloat(e.target.value) || 0 })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                        />
                        <p className="text-[11px] text-gray-500 mt-0.5">Customer discount only</p>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">GST %</label>
                        <select
                          value={line.gstRate}
                          disabled={compositionScheme}
                          onChange={(e) => updateLine(index, { gstRate: parseFloat(e.target.value) })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                        >
                          {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </div>

                      <div className="flex items-end gap-1">
                        <div className="w-full">
                          <label className="block text-xs text-gray-600 mb-1">Total (₹)</label>
                          <input type="text" readOnly value={t.total.toFixed(2)}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50 text-right" />
                        </div>
                        <button onClick={() => removeLine(index)} className="p-1 text-red-600 hover:text-red-700 mb-0.5">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {medicine && (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                        {medicine.rackLocation && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-medium">
                            <MapPin className="w-3 h-3" /> Rack {medicine.rackLocation}
                          </span>
                        )}
                        <span>
                          Available: <strong className={ok ? '' : 'text-red-600'}>{stockDisplay(availableStock(line), spec)}</strong>
                          {batch ? ' in batch' : ' total'}
                        </span>
                        {spec.packSize > 1 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-800">
                            1 {spec.stockUnit} = {fmtQty(spec.packSize)} {spec.dispenseUnit}
                          </span>
                        )}
                        {loose && line.quantity > 0 && (
                          <span>
                            Deducts <strong>{fmtQty(dispenseQty)} {spec.dispenseUnit}</strong> from stock
                          </span>
                        )}
                        {medicine.hsnCode && <span>HSN {medicine.hsnCode}</span>}
                        <span>Exp {expiryDateKey(line.batchId ? batch?.expiryDate : medicine.expiryDate) || 'Not recorded'}</span>
                        <ExpiryBadge expiryDate={line.batchId ? batch?.expiryDate : medicine.expiryDate} />
                        <span>Generic: {medicine.genericName || 'N/A'}</span>
                        {!compositionScheme && (
                          <span>Taxable {inr(t.taxable)} + CGST {inr(t.cgst)} + SGST {inr(t.sgst)}</span>
                        )}
                        {!ok && <span className="text-red-600 font-medium">Insufficient stock</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals + payment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4 text-sm">
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Receipt className="w-4 h-4" /> Invoice Summary</h4>
              {!compositionScheme && byRate.length > 0 && (
                <table className="w-full text-xs mb-3">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left py-1">Rate</th>
                      <th className="text-right py-1">Taxable</th>
                      <th className="text-right py-1">CGST</th>
                      <th className="text-right py-1">SGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRate.map(b => (
                      <tr key={b.gstRate} className="border-t border-gray-200">
                        <td className="py-1">{b.gstRate}%</td>
                        <td className="text-right">{b.taxable.toFixed(2)}</td>
                        <td className="text-right">{b.cgst.toFixed(2)}</td>
                        <td className="text-right">{b.sgst.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="space-y-1">
                <div className="flex justify-between"><span>Gross</span><span>{inr(totals.gross)}</span></div>
                {totals.discount > 0 && <div className="flex justify-between text-green-700"><span>Customer discount</span><span>- {inr(totals.discount)}</span></div>}
                <div className="flex justify-between"><span>Taxable value</span><span>{inr(totals.taxable)}</span></div>
                {!compositionScheme && (
                  <div className="flex justify-between"><span>GST (CGST + SGST)</span><span>{inr(round2(totals.cgst + totals.sgst))}</span></div>
                )}
                {totals.roundOff !== 0 && <div className="flex justify-between text-gray-500"><span>Round off</span><span>{totals.roundOff > 0 ? '+' : ''}{totals.roundOff.toFixed(2)}</span></div>}
                <div className="flex justify-between border-t border-gray-300 pt-2 text-base font-bold text-blue-700">
                  <span>Grand Total</span><span>{inr(totals.grandTotal)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm space-y-3">
              <h4 className="font-semibold text-gray-800">Payment</h4>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} className="rounded" />
                <span>Collect {inr(totals.grandTotal)} now</span>
              </label>
              {collectNow && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Method</label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="net_banking">Net Banking</option>
                    <option value="wallet">Wallet</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Invoice note</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Optional" />
              </div>
              <div className="border-t border-gray-200 pt-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={refill.enabled}
                    onChange={(e) => setRefill({ ...refill, enabled: e.target.checked, touched: true })} className="rounded" />
                  <span className="flex items-center gap-1"><Bell className="w-4 h-4 text-emerald-600" /> WhatsApp refill reminder</span>
                </label>
                {refill.enabled && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-gray-600">Medicine runs out on</label>
                    <input type="date" value={refill.dueDate} min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setRefill({ ...refill, dueDate: e.target.value, touched: true })}
                      className="px-2 py-1 border border-gray-300 rounded text-sm" />
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Suggested from the prescription duration, or from quantity for long-term medicines. The reminder is sent a few days before this date (Settings → WhatsApp).
                </p>
              </div>
              <p className="text-xs text-gray-500">
                A separate pharmacy tax invoice ({clinic?.pharmacyInvoicePrefix || 'PH'}/… series) is raised. It does not go on the OPD consultation bill.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200">
            <button onClick={onClose} className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            {!isCounterSale && (
              <button
                onClick={() => requestDispense('dispense')}
                disabled={saving || lines.some(l => !stockOk(l))}
                title="Deduct stock without raising a pharmacy invoice (items can be added to the OPD bill instead)"
                className="flex items-center gap-2 px-5 py-2 border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Dispense Only'}
              </button>
            )}
            <button
              onClick={() => requestDispense('invoice')}
              disabled={saving || lines.some(l => !stockOk(l)) || totals.grandTotal <= 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <FileText className="w-4 h-4" />
              {saving ? 'Dispensing…' : `Dispense & Raise ${compositionScheme ? 'Bill of Supply' : 'Tax Invoice'}`}
            </button>
          </div>
        </div>
      </div>

      {controlledAction && <ControlledSupplyPopup
        details={controlled}
        prescriptionChecked={prescriptionChecked}
        today={today}
        onChange={setControlled}
        onPrescriptionChecked={setPrescriptionChecked}
        onClose={() => setControlledAction(null)}
        onContinue={() => {
          const action = controlledAction;
          setControlledAction(null);
          void (action === 'dispense' ? handleDispenseOnly() : handleDispenseAndInvoice());
        }}
      />}

      {showIdentify && (
        <MedicineIdentifyModal
          medicines={medicines}
          onPick={(m) => { addMedicineQuick(m); setShowIdentify(false); }}
          onClose={() => setShowIdentify(false)}
        />
      )}
    </div>
  );
};

export default DispenseModal;
