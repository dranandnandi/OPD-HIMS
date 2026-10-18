import React, { useState, useEffect } from 'react';
import { X, Search, UserPlus, ShoppingCart, Phone, ArrowRight } from 'lucide-react';
import { Patient, PharmacyDispensedItem, Bill } from '../../types';
import { patientService } from '../../services/patientService';
import DispenseModal from './DispenseModal';

interface CounterSaleModalProps {
  onClose: () => void;
  /** Called after a sale is completed (stock changed, invoice possibly raised). */
  onSaved?: (dispensed?: PharmacyDispensedItem[], bill?: Bill) => void;
}

/**
 * Over-the-counter sale: no visit, no prescription. Pick an existing patient
 * (or register a walk-in with just a name and phone), then the normal
 * dispense-and-invoice flow runs against that patient.
 */
const CounterSaleModal: React.FC<CounterSaleModalProps> = ({ onClose, onSaved }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState({ name: '', phone: '', age: '', gender: 'male' as Patient['gender'] });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const found = await patientService.searchPatients(q, 15);
        if (!cancelled) setResults(found);
      } catch (err) {
        console.error('Patient search failed:', err);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  /** "16-Oct-2026" — the date part of auto-generated walk-in names. */
  const walkInDateLabel = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`;
  };

  /**
   * Next free "Customer 16-Oct-2026-N" name for today, by counting what is
   * already registered. A collision only matters within one clinic on one
   * day, so a name search is enough — no sequence table needed.
   */
  const nextWalkInName = async (): Promise<string> => {
    const prefix = `Customer ${walkInDateLabel()}-`;
    try {
      const existing = await patientService.searchPatients(prefix, 100);
      const maxSerial = existing.reduce((max, p) => {
        if (!p.name?.toLowerCase().startsWith(prefix.toLowerCase())) return max;
        const n = parseInt(p.name.slice(prefix.length), 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 0);
      return `${prefix}${maxSerial + 1}`;
    } catch {
      // Search failed: fall back to a timestamp suffix so the sale still goes through.
      return `${prefix}${Date.now().toString().slice(-4)}`;
    }
  };

  const registerWalkIn = async (useTyped: boolean) => {
    const typedName = useTyped ? quick.name.trim() : '';
    const typedDigits = useTyped ? quick.phone.replace(/\D/g, '') : '';
    if (typedDigits && typedDigits.length < 10) {
      alert('Enter a valid 10-digit mobile number, or leave it blank');
      return;
    }
    try {
      setSaving(true);
      const created = await patientService.addPatient({
        name: typedName || await nextWalkInName(),
        // Placeholder 999… number when no mobile is given, so the record is
        // valid but clearly not a real contact (no WhatsApp goes anywhere).
        phone: typedDigits ? typedDigits.slice(-10) : `999${Date.now().toString().slice(-7)}`,
        age: useTyped && quick.age ? parseInt(quick.age) : null,
        gender: useTyped ? quick.gender : 'other',
        address: null
      });
      setPatient(created);
    } catch (err) {
      console.error('Could not register walk-in customer:', err);
      alert(err instanceof Error ? err.message : 'Could not register customer');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdd = () => registerWalkIn(true);

  if (patient) {
    return (
      <DispenseModal
        patient={patient}
        onSave={(items, bill) => onSaved?.(items, bill)}
        onClose={onClose}
      />
    );
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold">Counter Sale</h2>
              <p className="text-xs text-gray-500">Over-the-counter sale without a visit. Who is buying?</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-5">
          {!showQuickAdd ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or mobile number"
                  className={`${inputCls} pl-10`}
                />
              </div>

              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {searching && <div className="p-4 text-sm text-gray-500">Searching…</div>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <div className="p-4 text-sm text-gray-500">No patient found for "{query}".</div>
                )}
                {!searching && query.trim().length < 2 && (
                  <div className="p-4 text-sm text-gray-500">Type at least two characters to search existing patients.</div>
                )}
                {results.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setPatient(p)}
                    className="w-full text-left p-3 hover:bg-blue-50 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-medium text-gray-800">{p.name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <Phone className="w-3 h-3" /> {p.phone}
                        {p.age ? <span>· {p.age} yrs</span> : null}
                        <span className="capitalize">· {p.gender}</span>
                        {(p.patientNumber || p.patient_number) && <span>· {p.patientNumber || p.patient_number}</span>}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => { setShowQuickAdd(true); setQuick(q => ({ ...q, name: /\d/.test(query) ? '' : query.trim(), phone: /^\d+$/.test(query.trim()) ? query.trim() : '' })); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-blue-400 text-blue-700 rounded-lg hover:bg-blue-50"
                >
                  <UserPlus className="w-4 h-4" /> New walk-in customer
                </button>
                <button
                  onClick={() => registerWalkIn(false)}
                  disabled={saving}
                  title={`Saved as "Customer ${walkInDateLabel()}-1, -2, …" with a 999… placeholder number`}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-gray-400 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  <ShoppingCart className="w-4 h-4" /> {saving ? 'Saving…' : 'Sale without name'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input autoFocus type="text" value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} className={inputCls}
                    placeholder={`Blank = "Customer ${walkInDateLabel()}-1" (auto-numbered)`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                  <input type="tel" value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} className={inputCls} placeholder="10 digits (blank = 999… placeholder)" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                    <input type="number" min="0" value={quick.age} onChange={(e) => setQuick({ ...quick, age: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                    <select value={quick.gender} onChange={(e) => setQuick({ ...quick, gender: e.target.value as Patient['gender'] })} className={inputCls}>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                A patient record is created so the invoice has a name and the sale shows in their history. If they visit later, the same record is used.
                Leave the name blank and the sale is saved as "Customer {walkInDateLabel()}-1" (numbered through the day) with a 999… placeholder mobile.
              </p>
              <div className="flex justify-between">
                <button onClick={() => setShowQuickAdd(false)} className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Back to search</button>
                <button onClick={handleQuickAdd} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <UserPlus className="w-4 h-4" /> {saving ? 'Saving…' : 'Register & continue'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CounterSaleModal;
