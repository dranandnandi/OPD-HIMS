import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Ban } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { admissionService } from '../services/admissionService';
import { bedService } from '../services/bedService';
import { billingService } from '../services/billingService';
import CancelAdmissionModal from '../components/ADT/CancelAdmissionModal';
import type { Admission, Bed } from '../types/ipd';

export default function CensusPage() {
  const { clinicId, isAdmin } = useAuth();
  const [view, setView] = useState<'current' | 'past'>('current');
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [dues, setDues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Admission | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!clinicId) return;
    setLoading(true);
    Promise.all([
      view === 'current' ? admissionService.listActive(clinicId) : admissionService.listPast(clinicId),
      bedService.listBeds(clinicId),
    ])
      .then(([a, b]) => {
        setAdmissions(a);
        setBeds(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));

    // dues alert: unbilled + bill balance − deposits per admitted patient
    if (view === 'current') {
      billingService
        .getBillingOverview(clinicId)
        .then((rows) => {
          const map: Record<string, number> = {};
          for (const r of rows) {
            map[r.admissionId] = Math.max(r.unbilledCharges + r.billBalance - r.depositsHeld, 0);
          }
          setDues(map);
        })
        .catch(() => setDues({}));
    }
  }, [clinicId, view, refreshKey]);

  // ward-wise occupancy cards
  const wardStats = useMemo(() => {
    const map = new Map<string, { total: number; occupied: number; available: number }>();
    for (const bed of beds) {
      const ward = bed.ward?.name ?? 'Unassigned';
      const s = map.get(ward) ?? { total: 0, occupied: 0, available: 0 };
      s.total += 1;
      if (bed.status === 'occupied') s.occupied += 1;
      if (bed.status === 'available') s.available += 1;
      map.set(ward, s);
    }
    return [...map.entries()];
  }, [beds]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-slate-800">
          Inpatient Census
          {!loading && (
            <span className="ml-2 text-sm font-normal text-slate-500">
              {admissions.length} admitted
            </span>
          )}
        </h1>
        <Link
          to="/ipd/admissions/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg"
        >
          New Admission
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* Current / Past toggle */}
      <div className="flex gap-1 mb-4">
        {(['current', 'past'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm capitalize ${
              view === v ? 'bg-navy-700 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {v === 'current' ? 'Admitted' : 'Past patients'}
          </button>
        ))}
      </div>

      {/* Ward-wise occupancy */}
      {!loading && view === 'current' && wardStats.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {wardStats.map(([ward, s]) => {
            const pct = s.total > 0 ? Math.round((s.occupied / s.total) * 100) : 0;
            return (
              <div key={ward} className="bg-white rounded-xl border border-slate-200 p-3 min-w-40">
                <p className="text-xs text-slate-400">{ward}</p>
                <p className="text-lg font-bold text-slate-800">
                  {s.occupied}<span className="text-sm font-normal text-slate-400">/{s.total} occupied</span>
                </p>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-emerald-700 mt-1">{s.available} available</p>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : admissions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          {view === 'current'
            ? 'No active admissions.'
            : 'No past patients yet.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Admission #</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">{view === 'current' ? 'Bed' : 'Status'}</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Admitted</th>
                <th className="px-4 py-3">{view === 'current' ? 'Type' : 'Discharged'}</th>
                {view === 'current' && isAdmin && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {admissions.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/ipd/admissions/${a.id}`} className="text-blue-600 hover:underline font-medium">
                      {a.admission_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {a.patient?.name}
                    <span className="text-slate-400 ml-1">
                      {a.patient?.age ? `${a.patient.age}y` : ''} {a.patient?.gender?.[0]?.toUpperCase() ?? ''}
                    </span>
                    {view === 'current' && (dues[a.id] ?? 0) > 0 && (
                      <span
                        title="Charges exceed deposits — collect deposit or bill"
                        className="ml-2 text-[10px] font-semibold text-red-700 bg-red-100 rounded-full px-2 py-0.5"
                      >
                        ⚠ ₹{(dues[a.id] ?? 0).toLocaleString('en-IN')} due
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {view === 'current' ? (
                      a.current_bed
                        ? `${a.current_bed.ward?.name ?? ''} / ${a.current_bed.bed_number}`
                        : '—'
                    ) : (
                      <span className={`text-xs uppercase px-2 py-0.5 rounded ${
                        a.status === 'discharged' ? 'bg-emerald-100 text-emerald-700'
                        : a.status === 'expired' ? 'bg-slate-200 text-slate-600'
                        : a.status === 'cancelled' ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                      }`}>
                        {a.status.replace('_', ' ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{a.admitting_doctor?.name ?? '—'}</td>
                  <td className="px-4 py-3">{format(new Date(a.admission_datetime), 'dd MMM, HH:mm')}</td>
                  <td className="px-4 py-3 capitalize">
                    {view === 'current'
                      ? a.admission_type.replace('_', ' ')
                      : a.discharge_datetime
                        ? format(new Date(a.discharge_datetime), 'dd MMM, HH:mm')
                        : '—'}
                  </td>
                  {view === 'current' && isAdmin && (
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setCancelTarget(a)}
                        title="Cancel this admission (wrong entry) — releases the bed"
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelTarget && (
        <CancelAdmissionModal
          admission={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => setRefreshKey((k) => k + 1)}
          onDeleted={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
