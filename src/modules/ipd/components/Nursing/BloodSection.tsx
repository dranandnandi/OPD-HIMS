import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Droplets, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { bloodService, BloodRequest, BLOOD_COMPONENTS } from '../../services/bloodService';
import { patientService } from '../../services/patientService';
import type { Profile } from '../../types/ipd';

interface Props {
  admissionId: string;
  readOnly: boolean;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const STATUS_STYLE: Record<BloodRequest['status'], string> = {
  requested: 'bg-amber-100 text-amber-700',
  received: 'bg-blue-100 text-blue-700',
  cross_checked: 'bg-violet-100 text-violet-700',
  transfused: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-400',
};

export default function BloodSection({ admissionId, readOnly }: Props) {
  const { clinicId, profile } = useAuth();
  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [showForm, setShowForm] = useState(false);
  // new-demand form
  const [component, setComponent] = useState<BloodRequest['component']>('prbc');
  const [group, setGroup] = useState('');
  const [units, setUnits] = useState('1');
  const [urgency, setUrgency] = useState<BloodRequest['urgency']>('routine');
  const [indication, setIndication] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    bloodService.listRequests(admissionId).then(setRequests).catch((e) => toast.error(e.message));
  }, [admissionId]);

  useEffect(() => {
    reload();
    if (clinicId) patientService.listDoctors(clinicId).then(setStaff).catch(() => setStaff([]));
  }, [reload, clinicId]);

  const createDemand = async () => {
    if (!clinicId) return;
    setBusy('new');
    try {
      await bloodService.createRequest({
        clinicId,
        admissionId,
        component,
        bloodGroup: group || undefined,
        units: Math.max(1, Number(units) || 1),
        urgency,
        indication: indication.trim() || undefined,
        userId: profile?.id,
      });
      toast.success('Blood demand raised');
      setShowForm(false);
      setGroup(''); setUnits('1'); setUrgency('routine'); setIndication('');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const received = async (r: BloodRequest) => {
    const bag = prompt('Bag / unit number from the blood bank:');
    if (!bag?.trim()) return;
    const bank = prompt('Blood bank name (optional):') ?? undefined;
    setBusy(r.id);
    try {
      await bloodService.markReceived({ request: r, bagNumber: bag.trim(), bloodBank: bank?.trim() || undefined, userId: profile?.id });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const checked = async (r: BloodRequest) => {
    if (!confirm(`Confirm bedside check for bag ${r.bag_number ?? ''}: patient identity, blood group and bag label verified?`)) return;
    setBusy(r.id);
    try {
      await bloodService.markChecked({ request: r, userId: profile?.id });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const transfused = async (r: BloodRequest, witnessedById: string, reaction: boolean) => {
    let reactionNotes: string | undefined;
    if (reaction) {
      reactionNotes = prompt('Describe the transfusion reaction:') ?? undefined;
      if (!reactionNotes?.trim()) return;
    }
    setBusy(r.id);
    try {
      await bloodService.markTransfused({
        request: r,
        witnessedById: witnessedById || undefined,
        reaction,
        reactionNotes,
        userId: profile?.id,
      });
      toast.success(reaction ? 'Transfusion recorded WITH reaction' : 'Transfusion recorded');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (r: BloodRequest) => {
    const reason = prompt('Cancel reason:');
    if (!reason?.trim()) return;
    setBusy(r.id);
    try {
      await bloodService.cancel({ request: r, reason: reason.trim(), userId: profile?.id });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const componentLabel = (c: string) => BLOOD_COMPONENTS.find((b) => b.value === c)?.label ?? c;
  const who = (p?: { name: string | null } | null) => p?.name ?? '—';

  return (
    <div>
      {!readOnly && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3">
          {showForm ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={component} onChange={(e) => setComponent(e.target.value as BloodRequest['component'])}
                className="border border-slate-300 rounded-lg px-2 py-1.5">
                {BLOOD_COMPONENTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <select value={group} onChange={(e) => setGroup(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5">
                <option value="">Group?</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)}
                className="w-16 border border-slate-300 rounded-lg px-2 py-1.5" title="Units" />
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as BloodRequest['urgency'])}
                className={`border rounded-lg px-2 py-1.5 ${urgency === 'emergency' ? 'border-red-400 text-red-600' : 'border-slate-300'}`}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
              <input value={indication} onChange={(e) => setIndication(e.target.value)}
                placeholder="Indication (Hb 6.2, active bleeding…)"
                className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-1.5" />
              <button onClick={createDemand} disabled={busy === 'new'}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5">
                {busy === 'new' ? 'Raising…' : 'Raise demand'}
              </button>
              <button onClick={() => setShowForm(false)} className="text-slate-500 border border-slate-300 rounded-lg px-3 py-1.5">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded-lg">
              <Plus className="w-4 h-4" /> New blood demand
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className={`bg-white rounded-xl border p-4 text-sm ${r.reaction ? 'border-red-300' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Droplets className="w-4 h-4 text-red-600" />
              <b className="text-slate-800">
                {r.units} × {componentLabel(r.component)} {r.blood_group ?? ''}
              </b>
              {r.urgency !== 'routine' && (
                <span className={`text-xs uppercase rounded px-1.5 py-0.5 ${r.urgency === 'emergency' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {r.urgency}
                </span>
              )}
              <span className={`text-xs uppercase rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status]}`}>
                {r.status.replace(/_/g, ' ')}
              </span>
              {r.reaction && <span className="text-xs uppercase bg-red-100 text-red-700 rounded px-1.5 py-0.5">⚠ reaction</span>}
              <span className="flex-1" />
              {!readOnly && r.status !== 'transfused' && r.status !== 'cancelled' && (
                <button onClick={() => cancel(r)} className="text-xs text-slate-400 underline">cancel</button>
              )}
            </div>

            {r.indication && <p className="text-slate-500 mb-2">Indication: {r.indication}</p>}

            {/* step log — demand → came → checked → given (signed) */}
            <ol className="text-xs text-slate-500 space-y-1 mb-2">
              <li>① Demanded {format(new Date(r.requested_at), 'dd MMM HH:mm')} — <b>{who(r.requester)}</b></li>
              {r.received_at && (
                <li>② Received {format(new Date(r.received_at), 'dd MMM HH:mm')} — <b>{who(r.receiver)}</b>
                  {r.bag_number ? ` · bag ${r.bag_number}` : ''}{r.blood_bank ? ` · ${r.blood_bank}` : ''}</li>
              )}
              {r.checked_at && (
                <li>③ Bedside check {format(new Date(r.checked_at), 'dd MMM HH:mm')} — <b>{who(r.checker)}</b></li>
              )}
              {r.transfused_at && (
                <li>④ Transfused {format(new Date(r.transfused_at), 'dd MMM HH:mm')} — given by <b>{who(r.transfuser)}</b>
                  {r.witnessed_by ? <> · witnessed by <b>{who(r.witness)}</b></> : ''}</li>
              )}
              {r.status === 'cancelled' && <li className="text-slate-400">✕ Cancelled — {r.cancelled_reason}</li>}
              {r.reaction && r.reaction_notes && <li className="text-red-600">⚠ Reaction: {r.reaction_notes}</li>}
            </ol>

            {!readOnly && r.status === 'requested' && (
              <button onClick={() => received(r)} disabled={busy === r.id}
                className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5">
                Bag received from blood bank
              </button>
            )}
            {!readOnly && r.status === 'received' && (
              <button onClick={() => checked(r)} disabled={busy === r.id}
                className="text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5">
                Bedside check done (identity + group verified)
              </button>
            )}
            {!readOnly && r.status === 'cross_checked' && (
              <TransfuseControls
                staff={staff}
                busy={busy === r.id}
                onConfirm={(witnessId, reaction) => transfused(r, witnessId, reaction)}
              />
            )}
          </div>
        ))}
        {requests.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
            No blood demands for this admission.
          </div>
        )}
      </div>
    </div>
  );
}

function TransfuseControls({
  staff, busy, onConfirm,
}: {
  staff: Profile[]; busy: boolean;
  onConfirm: (witnessId: string, reaction: boolean) => void;
}) {
  const [witnessId, setWitnessId] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={witnessId} onChange={(e) => setWitnessId(e.target.value)}
        className="text-sm border border-slate-300 rounded-lg px-2 py-1.5">
        <option value="">Witness (second signature)…</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button onClick={() => onConfirm(witnessId, false)} disabled={busy || !witnessId}
        className="text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5"
        title="Requires a witness for the double signature">
        Transfused — sign
      </button>
      <button onClick={() => onConfirm(witnessId, true)} disabled={busy || !witnessId}
        className="text-sm border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-lg px-3 py-1.5">
        Transfused with reaction
      </button>
    </div>
  );
}
