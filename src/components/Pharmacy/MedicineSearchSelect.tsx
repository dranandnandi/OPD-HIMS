import MedicineFlags from './MedicineFlags';
import React, { useMemo, useRef, useState } from 'react';
import { Search, X, MapPin } from 'lucide-react';
import { MedicineWithPrice } from '../../types';
import { packSpec, stockDisplay } from '../../utils/packUnits';

interface MedicineSearchSelectProps {
  medicines: MedicineWithPrice[];
  /** Selected medicine id ('' for none). */
  value: string;
  onChange: (medicineId: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

const MAX_RESULTS = 50;

/**
 * Type-to-search medicine picker. Replaces the plain <select>, which is
 * unusable once the master has more than a screenful of items: the pharmacist
 * types part of the name ("dala" finds DALACIN C 300 CAPS) and picks from the
 * filtered list. Matches name, generic, brand and strength, any word order.
 */
const MedicineSearchSelect: React.FC<MedicineSearchSelectProps> = ({ medicines, value, onChange, placeholder, autoFocus }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? medicines.find(m => m.id === value) : undefined;

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return medicines.slice(0, MAX_RESULTS);
    const scored = medicines
      .map(m => {
        const haystack = [m.name, m.genericName, m.brandName, m.strength]
          .filter(Boolean).join(' ').toLowerCase();
        if (!terms.every(t => haystack.includes(t))) return null;
        // Names that start with the first term sort above mid-word matches.
        return { m, score: m.name.toLowerCase().startsWith(terms[0]) ? 0 : 1 };
      })
      .filter((x): x is { m: MedicineWithPrice; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || a.m.name.localeCompare(b.m.name));
    return scored.slice(0, MAX_RESULTS).map(x => x.m);
  }, [medicines, query]);

  const pick = (m: MedicineWithPrice) => {
    onChange(m.id);
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) pick(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={open ? query : (selected ? `${selected.name}${selected.strength ? ` ${selected.strength}` : ''}` : query)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Type to search medicine…'}
          className="w-full pl-7 pr-7 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {selected && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
            title="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[320px] bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {results.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">No medicine matches "{query}". Check Medicine Master.</div>
          ) : results.map((m, i) => (
            <button
              key={m.id}
              type="button"
              // onMouseDown so the pick fires before the input's blur closes the list
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${
                i === highlight ? 'bg-blue-50' : ''
              } ${m.id === value ? 'font-semibold' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-800 truncate">{m.name}{m.strength ? ` ${m.strength}` : ''}<MedicineFlags medicine={m} /></span>
                <span className={`text-xs whitespace-nowrap ${m.currentStock > 0 ? 'text-green-700' : 'text-red-600'}`}>
                  Stock: {stockDisplay(m.currentStock, packSpec(m))}
                </span>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-2">
                {m.genericName && <span className="truncate">{m.genericName}</span>}
                {m.rackLocation && (
                  <span className="inline-flex items-center gap-0.5 text-indigo-700"><MapPin className="w-3 h-3" />{m.rackLocation}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MedicineSearchSelect;
