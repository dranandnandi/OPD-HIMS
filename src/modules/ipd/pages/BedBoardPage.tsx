import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { bedService } from '../services/bedService';
import type { Bed, BedStatus } from '../types/ipd';

const statusStyles: Record<BedStatus, string> = {
  available: 'bg-emerald-100 border-emerald-400 text-emerald-800',
  occupied: 'bg-blue-100 border-blue-400 text-blue-800',
  cleaning: 'bg-amber-100 border-amber-400 text-amber-800',
  maintenance: 'bg-slate-200 border-slate-400 text-slate-600',
  reserved: 'bg-violet-100 border-violet-400 text-violet-800',
  blocked: 'bg-red-100 border-red-400 text-red-800',
};

// statuses staff can set by hand (occupied is controlled by admissions/transfers)
const manualStatuses: BedStatus[] = ['available', 'cleaning', 'maintenance', 'reserved', 'blocked'];

export default function BedBoardPage() {
  const { clinicId } = useAuth();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBed, setActiveBed] = useState<Bed | null>(null);

  const reload = useCallback(() => {
    if (!clinicId) return;
    bedService
      .listBeds(clinicId)
      .then(setBeds)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId]);

  useEffect(reload, [reload]);

  const byWard = useMemo(() => {
    const map = new Map<string, Bed[]>();
    for (const bed of beds) {
      const wardName = bed.ward?.name ?? 'Unassigned';
      if (!map.has(wardName)) map.set(wardName, []);
      map.get(wardName)!.push(bed);
    }
    return [...map.entries()];
  }, [beds]);

  const setStatus = async (bed: Bed, status: BedStatus) => {
    try {
      await bedService.setBedStatus(bed.id, status);
      toast.success(`Bed ${bed.bed_number} → ${status}`);
      setActiveBed(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleBedClick = (bed: Bed) => {
    if (bed.status === 'occupied') {
      toast('Occupied — freed automatically on transfer/discharge (then shows "cleaning").', { icon: '🛏' });
      return;
    }
    setActiveBed(bed);
  };

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Bed Board</h1>
      <p className="text-xs text-slate-400 mb-4">
        Click a bed to change its status — e.g. mark a cleaned bed <b>available</b>.
      </p>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {activeBed && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setActiveBed(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-800">
                Bed {activeBed.bed_number} — {activeBed.ward?.name}
              </h2>
              <button onClick={() => setActiveBed(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              {activeBed.bed_type?.name} · currently <b className="capitalize">{activeBed.status}</b>
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {manualStatuses.filter((s) => s !== activeBed.status).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(activeBed, s)}
                  className={`text-sm capitalize rounded-lg border px-3 py-2 text-left ${statusStyles[s]}`}
                >
                  Mark {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : byWard.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No beds configured yet. Add wards and beds under Masters.
        </div>
      ) : (
        byWard.map(([wardName, wardBeds]) => (
          <div key={wardName} className="mb-6">
            <h2 className="text-sm font-medium text-slate-600 mb-2">
              {wardName}
              <span className="ml-2 text-slate-400">
                {wardBeds.filter((b) => b.status === 'available').length}/{wardBeds.length} free
              </span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {wardBeds.map((bed) => (
                <button
                  key={bed.id}
                  onClick={() => handleBedClick(bed)}
                  className={`border rounded-lg p-2 text-center text-xs font-medium cursor-pointer hover:ring-2 hover:ring-navy-300 ${statusStyles[bed.status]}`}
                  title={`${bed.bed_type?.name ?? ''} — click to change status`}
                >
                  <div className="text-sm">{bed.bed_number}</div>
                  <div className="opacity-75 capitalize">{bed.status}</div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
