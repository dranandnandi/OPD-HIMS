import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Ban, AlertTriangle, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { admissionService, AdmissionActivity } from '../../services/admissionService';
import type { Admission } from '../../types/ipd';

interface Props {
  admission: Admission;
  onClose: () => void;
  /** cancelled — record kept, caller reloads */
  onCancelled: () => void;
  /** deleted — record is gone, caller navigates away */
  onDeleted: () => void;
}

const REASONS = [
  'Wrong entry / duplicate admission',
  'Patient did not turn up',
  'Patient refused admission',
  'Admitted under the wrong patient file',
  'Wrong bed / re-admitted correctly',
  'Other',
];

export default function CancelAdmissionModal({ admission, onClose, onCancelled, onDeleted }: Props) {
  const { profile, isAdmin } = useAuth();
  const [activity, setActivity] = useState<AdmissionActivity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [mode, setMode] = useState<'cancel' | 'delete'>('cancel');
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    admissionService
      .getActivity(admission.id)
      .then(setActivity)
      .catch((e) => setLoadError((e as Error).message));
  }, [admission.id]);

  const canDelete = isAdmin && !!activity?.isEmpty;
  const blocked = !!activity?.hasFinancials;

  const recorded = activity
    ? ([
        ['charge(s)', activity.charges],
        ['bill(s)', activity.bills],
        ['deposit entry(ies)', activity.deposits],
        ['order(s)', activity.orders],
        ['medication order(s)', activity.medications],
        ['vitals / nursing note(s)', activity.nursing],
        ['document(s)', activity.documents],
        ['insurance record(s)', activity.claims],
      ] as const).filter(([, n]) => n > 0)
    : [];

  const submit = async () => {
    const fullReason = details.trim() ? `${reason} — ${details.trim()}` : reason;
    setSaving(true);
    try {
      if (mode === 'delete') {
        await admissionService.deleteAdmission(admission.id);
        toast.success(`Admission ${admission.admission_number} deleted`);
        onDeleted();
      } else {
        await admissionService.cancel({
          admissionId: admission.id,
          reason: fullReason,
          userId: profile?.id,
          userName: profile?.name ?? undefined,
        });
        toast.success('Admission cancelled — bed released');
        onCancelled();
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const confirmOk = mode === 'cancel' || confirmText.trim() === admission.admission_number;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Ban className="w-4 h-4 text-red-600" /> Cancel admission — {admission.patient?.name}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-500 mb-3">
          {admission.admission_number}
          {admission.current_bed
            ? ` · ${admission.current_bed.ward?.name ?? ''} / Bed ${admission.current_bed.bed_number}`
            : ''}
        </p>

        {loadError && <p className="text-sm text-red-600 mb-3">{loadError}</p>}
        {!activity && !loadError && (
          <p className="text-sm text-slate-500 mb-3">Checking what is recorded on this file…</p>
        )}

        {blocked && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-3 text-sm text-red-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Cannot cancel — money has already moved.</p>
              {activity!.bills > 0 && <p>• {activity!.bills} live bill(s) — cancel them first.</p>}
              {activity!.depositsHeld > 0 && (
                <p>• ₹{activity!.depositsHeld.toLocaleString('en-IN')} deposit held — refund it first.</p>
              )}
              <p className="mt-1">If the patient really was treated, use Discharge instead.</p>
            </div>
          </div>
        )}

        {!blocked && recorded.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm text-amber-800">
            <p className="font-medium">This file already has data recorded:</p>
            <p>{recorded.map(([label, n]) => `${n} ${label}`).join(' · ')}</p>
            <p className="text-xs mt-1">
              Cancelling voids the unbilled charges and keeps the rest on record.
            </p>
          </div>
        )}

        <label className="block text-sm mb-3">
          <span className="text-slate-600">Reason *</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={blocked}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm disabled:bg-slate-100"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm mb-3">
          <span className="text-slate-600">Details (optional)</span>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
            disabled={blocked}
            placeholder="e.g. Duplicate of ADM-000241 created by mistake"
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm disabled:bg-slate-100"
          />
        </label>

        {!blocked && (
          <div className="space-y-2 mb-4">
            <label className="flex gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'cancel'}
                onChange={() => setMode('cancel')}
                className="mt-1"
              />
              <span>
                <b>Cancel admission</b> — frees the bed, voids unbilled charges and keeps the
                record as <i>cancelled</i> (visible under Past patients).
              </span>
            </label>
            <label
              className={`flex gap-2 text-sm cursor-pointer ${canDelete ? 'text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}
              title={
                !isAdmin
                  ? 'Only admins can delete an admission record'
                  : activity && !activity.isEmpty
                    ? 'Data is already recorded on this file — cancel it instead'
                    : ''
              }
            >
              <input
                type="radio"
                checked={mode === 'delete'}
                onChange={() => setMode('delete')}
                disabled={!canDelete}
                className="mt-1"
              />
              <span>
                <b>Delete permanently</b> — removes the admission record entirely. The patient's
                own record and OPD history are not touched.
              </span>
            </label>
          </div>
        )}

        {mode === 'delete' && (
          <label className="block text-sm mb-4">
            <span className="text-red-700">
              This cannot be undone. Type <b>{admission.admission_number}</b> to confirm:
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={admission.admission_number}
              className="mt-1 w-full border border-red-300 rounded-lg px-2 py-2 text-sm"
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg">
            Keep admission
          </button>
          <button
            onClick={submit}
            disabled={saving || blocked || !activity || !confirmOk}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg"
          >
            {mode === 'delete' ? <Trash2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
            {saving
              ? mode === 'delete' ? 'Deleting…' : 'Cancelling…'
              : mode === 'delete' ? 'Delete permanently' : 'Cancel admission'}
          </button>
        </div>
      </div>
    </div>
  );
}
