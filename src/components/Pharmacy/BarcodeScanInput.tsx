import React, { useState, useRef } from 'react';
import { ScanLine, Link2, X } from 'lucide-react';
import { MedicineWithPrice } from '../../types';
import { masterDataService } from '../../services/masterDataService';

interface BarcodeScanInputProps {
  medicines: MedicineWithPrice[];
  /** Fired with the matched medicine. */
  onMedicine: (medicine: MedicineWithPrice) => void;
  /** Fired after an unknown barcode was assigned to a medicine, so the caller can reload. */
  onBarcodeAssigned?: (medicine: MedicineWithPrice, barcode: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
}

/**
 * Keyboard-wedge barcode scanner input. A USB/Bluetooth scanner types the
 * digits and presses Enter; this box turns that into a medicine. Unknown
 * codes can be linked to a medicine on the spot, which is how the master gets
 * its barcodes filled in over time without a separate data-entry exercise.
 */
const BarcodeScanInput: React.FC<BarcodeScanInputProps> = ({ medicines, onMedicine, onBarcodeAssigned, autoFocus, compact }) => {
  const [value, setValue] = useState('');
  const [unknown, setUnknown] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = (code: string) => {
    const c = code.trim();
    if (!c) return;
    const hit = medicines.find(m => m.barcode && m.barcode === c);
    if (hit) {
      onMedicine(hit);
      setFlash(`${hit.name}${hit.rackLocation ? ` · Rack ${hit.rackLocation}` : ''}`);
      setTimeout(() => setFlash(null), 2000);
      setValue('');
      setUnknown(null);
      return;
    }
    // Fallback: typed a name instead of scanning
    const byName = medicines.filter(m => m.name.toLowerCase() === c.toLowerCase());
    if (byName.length === 1) {
      onMedicine(byName[0]);
      setValue('');
      return;
    }
    setUnknown(c);
    setValue('');
  };

  const handleAssign = async () => {
    if (!unknown || !assignTo) return;
    const m = medicines.find(x => x.id === assignTo);
    if (!m) return;
    try {
      setAssigning(true);
      await masterDataService.updateMedicine(m.id, { barcode: unknown });
      const updated = { ...m, barcode: unknown };
      onBarcodeAssigned?.(updated, unknown);
      onMedicine(updated);
      setUnknown(null);
      setAssignTo('');
      inputRef.current?.focus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save barcode');
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <div className="relative">
        <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 w-4 h-4" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); lookup(value); }
          }}
          placeholder="Scan barcode (or type exact name) and press Enter"
          className="w-full pl-10 pr-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50/40"
        />
        {flash && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-700 font-medium truncate max-w-[50%]">✓ {flash}</span>
        )}
      </div>

      {unknown && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm">
          <div className="flex-1 text-amber-800">
            Barcode <span className="font-mono font-semibold">{unknown}</span> is not linked to any medicine yet. Link it once and scanning will work from now on.
          </div>
          <select
            value={assignTo}
            onChange={(e) => setAssignTo(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm min-w-[220px]"
          >
            <option value="">Choose medicine…</option>
            {medicines.map(m => (
              <option key={m.id} value={m.id}>{m.name}{m.strength ? ` ${m.strength}` : ''}{m.barcode ? ' (has barcode)' : ''}</option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!assignTo || assigning}
            className="inline-flex items-center gap-1 px-3 py-1 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50"
          >
            <Link2 className="w-3 h-3" /> {assigning ? 'Linking…' : 'Link & add'}
          </button>
          <button onClick={() => setUnknown(null)} className="p-1 text-gray-500 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
};

export default BarcodeScanInput;
