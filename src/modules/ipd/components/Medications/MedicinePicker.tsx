import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { medicationService, MedicineOption, medicineLabel } from '../../services/medicationService';

interface Props {
  clinicId: string;
  /** free-text value, used when nothing is picked from the formulary */
  value: string;
  selected: MedicineOption | null;
  onChange: (text: string) => void;
  onSelect: (medicine: MedicineOption | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Medicine field with a browsable formulary dropdown — clicking the field (or
 * the chevron) lists what the pharmacy master has without typing anything;
 * typing filters it; anything not in the list can still be entered free text.
 */
export default function MedicinePicker({
  clinicId, value, selected, onChange, onSelect, placeholder, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<MedicineOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = selected ? '' : value;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      medicationService
        .searchMedicines(clinicId, term)
        .then((rows) => { if (!cancelled) { setOptions(rows); setActive(0); } })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, term ? 250 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [clinicId, term, open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = (m: MedicineOption) => {
    onSelect(m);
    onChange('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      pick(options[active]);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`}>
      <input
        ref={inputRef}
        value={selected ? medicineLabel(selected) : value}
        onChange={(e) => { onSelect(null); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? 'Medicine (from pharmacy master, or free text)…'}
        className="w-full border border-slate-300 rounded-lg pl-3 pr-8 py-1.5 text-sm"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}
        title="Show available medicines"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <ul className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {options.map((m, i) => (
            <li
              key={m.id}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
              className={`px-3 py-1.5 text-sm cursor-pointer flex justify-between gap-2 ${
                i === active ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <span className="truncate">
                {m.name} {m.strength ?? ''}
                {m.dosage_form && <span className="text-xs text-slate-400 ml-1">{m.dosage_form}</span>}
              </span>
              <span className={`text-xs shrink-0 ${m.current_stock > 0 ? 'text-slate-400' : 'text-red-500 font-medium'}`}>
                {m.current_stock > 0 ? `stock ${m.current_stock}` : 'out of stock — to purchase'}
              </span>
            </li>
          ))}
          {options.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-400">
              {loading
                ? 'Loading medicines…'
                : term
                  ? 'No match in the pharmacy master — the typed name is used as free text'
                  : 'No medicines in the pharmacy master yet — type a name to order free text'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
