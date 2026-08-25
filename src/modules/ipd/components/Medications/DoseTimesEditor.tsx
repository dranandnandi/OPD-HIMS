import { Plus, X } from 'lucide-react';
import { formatDoseTime, normaliseTimes } from '../../services/medicationService';

interface Props {
  times: string[];
  onChange: (times: string[]) => void;
  /** shown under the row — 'Given at 8:00 AM, 8:00 PM' */
  showPreview?: boolean;
  disabled?: boolean;
  max?: number;
}

/**
 * The clock times a drug is actually given at.
 *
 * Ward orders are written as times, not as codes — "Inj. Monosef 1 g IV 12
 * hourly at 8 PM and 8 AM", "Inj. Dynapar 8 hourly at 11 AM, 7 PM and 3 AM".
 * The frequency code only seeds this list; what the prescriber leaves here is
 * what the eMAR is built from.
 */
export default function DoseTimesEditor({
  times, onChange, showPreview = true, disabled = false, max = 12,
}: Props) {
  const setAt = (i: number, value: string) => {
    const next = [...times];
    next[i] = value;
    onChange(next);
  };

  const removeAt = (i: number) => onChange(times.filter((_, idx) => idx !== i));

  const add = () => {
    if (times.length >= max) return;
    // next slot an hour on from the last, so adding is one click not two
    const last = times[times.length - 1];
    const [h, m] = (last ?? '08:00').split(':').map(Number);
    const next = `${String((h + 1) % 24).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
    onChange([...times, next]);
  };

  const valid = normaliseTimes(times);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500 mr-0.5">Dose times</span>
        {times.map((t, i) => (
          <span key={i} className="flex items-center gap-0.5 bg-slate-50 border border-slate-300 rounded-lg pl-1.5">
            <input
              type="time"
              value={t}
              disabled={disabled}
              onChange={(e) => setAt(i, e.target.value)}
              className="bg-transparent text-sm text-slate-800 py-1 w-[92px] outline-none disabled:text-slate-400"
            />
            {times.length > 1 && !disabled && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove this time"
                className="p-1 text-slate-400 hover:text-red-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        ))}
        {!disabled && times.length < max && (
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1 text-xs text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-2 py-1.5 hover:bg-blue-100"
          >
            <Plus className="w-3.5 h-3.5" /> Add time
          </button>
        )}
      </div>
      {showPreview && (
        <p className="text-xs text-slate-400 mt-1">
          {valid.length === 0
            ? 'Set at least one time — nothing will be scheduled otherwise.'
            : `Given at ${valid.map(formatDoseTime).join(', ')} each day.`}
        </p>
      )}
    </div>
  );
}
