import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, ArrowRightLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { bedService } from '../../services/bedService';
import { chargeService } from '../../services/chargeService';
import type { Admission, Bed, BedAllocation } from '../../types/ipd';

interface Props {
  admission: Admission;
  onClose: () => void;
  onDone: () => void;
}

const reasons: BedAllocation['reason'][] = [
  'upgrade', 'downgrade', 'icu_shift', 'stepdown', 'patient_request', 'operational',
];

export default function TransferBedModal({ admission, onClose, onDone }: Props) {
  const { clinicId, profile } = useAuth();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [toBedId, setToBedId] = useState('');
  const [reason, setReason] = useState<BedAllocation['reason']>('operational');
  const [notes, setNotes] = useState('');
  const [newRate, setNewRate] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clinicId) return;
    bedService
      .listBeds(clinicId)
      .then((all) => setBeds(all.filter((b) => b.status === 'available')))
      .catch((e) => toast.error(e.message));
  }, [clinicId]);

  const bedsByWard = useMemo(() => {
    const map = new Map<string, Bed[]>();
    for (const b of beds) {
      const w = b.ward?.name ?? 'Ward';
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(b);
    }
    return [...map.entries()];
  }, [beds]);

  // Resolve the new bed's daily rate for the admission's tariff plan (rate snapshot)
  useEffect(() => {
    const bed = beds.find((b) => b.id === toBedId);
    const rentServiceId = bed?.bed_type?.room_rent_service_id;
    if (!rentServiceId) {
      setNewRate(null);
      return;
    }
    chargeService
      .resolveRate(rentServiceId, admission.tariff_plan_id, bed?.bed_type_id ?? null)
      .then(setNewRate)
      .catch(() => setNewRate(null));
  }, [toBedId, beds, admission.tariff_plan_id]);

  const transfer = async () => {
    if (!clinicId || !toBedId) return;
    setSaving(true);
    try {
      await bedService.transferBed({
        clinicId,
        admissionId: admission.id,
        toBedId,
        reason,
        rateSnapshot: newRate ?? undefined,
        notes: notes.trim() || undefined,
        userId: profile?.id,
      });
      toast.success('Bed transferred');
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-600" /> Transfer Bed
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-3">
          Current: <b className="text-slate-700">
            {admission.current_bed
              ? `${admission.current_bed.ward?.name} / ${admission.current_bed.bed_number}`
              : '—'}
          </b>
        </p>

        <label className="block text-sm mb-3">
          <span className="text-slate-600">New bed *</span>
          <select
            value={toBedId}
            onChange={(e) => setToBedId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
          >
            <option value="">Select available bed…</option>
            {bedsByWard.map(([ward, wardBeds]) => (
              <optgroup key={ward} label={ward}>
                {wardBeds.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bed_number} — {b.bed_type?.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block text-sm mb-3">
          <span className="text-slate-600">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as BedAllocation['reason'])}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
          >
            {reasons.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm mb-3">
          <span className="text-slate-600">Notes (clinical reason, condition on shift…)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Post-op day 2, hemodynamically stable — stepped down from ICU"
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
          />
        </label>

        {newRate !== null && (
          <p className="text-sm text-slate-500 mb-3">
            New daily room rate: <b className="text-slate-700">₹{newRate.toFixed(2)}</b>
            <span className="text-xs text-slate-400 block">
              Room rent from tomorrow posts at this rate; today's rent follows your day-count rule.
            </span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg">
            Cancel
          </button>
          <button
            onClick={transfer}
            disabled={!toBedId || saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {saving ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
