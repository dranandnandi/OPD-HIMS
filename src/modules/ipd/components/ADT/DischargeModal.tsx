import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, LogOut, AlertTriangle, MessageCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { admissionService } from '../../services/admissionService';
import { billingService } from '../../services/billingService';
import type { NoteAuditFinding, NoteAuditRun } from '../../services/billingService';
import { ipdWhatsappService } from '../../services/whatsappService';
import type { Admission, DischargeChecklist } from '../../types/ipd';

interface Props {
  admission: Admission;
  /** pending (unbilled) charge count — shown as a warning */
  unbilledCount: number;
  /** total outstanding balance across issued bills */
  outstandingBalance: number;
  onClose: () => void;
  onDone: () => void;
}

type ChecklistKey =
  | 'bill_cleared' | 'summary_signed' | 'meds_reconciled'
  | 'implants_documented' | 'followup_booked';

const checklistItems: Array<{ key: ChecklistKey; label: string }> = [
  { key: 'bill_cleared', label: 'Final bill generated & cleared' },
  { key: 'summary_signed', label: 'Discharge summary signed' },
  { key: 'meds_reconciled', label: 'Discharge medications reconciled' },
  { key: 'implants_documented', label: 'Implants/consumables documented' },
  { key: 'followup_booked', label: 'Follow-up appointment booked' },
];

const dischargeTypes: Array<NonNullable<Admission['discharge_type']>> = [
  'routine', 'dama', 'referred', 'expired', 'absconded',
];

const resolutions = [
  ['matched', 'Already matched'], ['package', 'In package'],
  ['non_chargeable', 'Non-chargeable'], ['not_performed', 'Not performed'],
  ['duplicate', 'Duplicate'], ['ignored', 'Ignore'],
] as const;
const reasonRequired = ['non_chargeable', 'not_performed', 'duplicate', 'ignored'];

const isOpen = (f: NoteAuditFinding) => !f.status || f.status === 'unresolved';

export default function DischargeModal({
  admission, unbilledCount, outstandingBalance, onClose, onDone,
}: Props) {
  const { clinicId, profile } = useAuth();
  const [checklist, setChecklist] = useState<Partial<DischargeChecklist>>({});
  const [dischargeType, setDischargeType] =
    useState<NonNullable<Admission['discharge_type']>>('routine');
  const [saving, setSaving] = useState(false);
  // The discharge audit run held for this attempt. Findings are decided right
  // here, so the next click discharges instead of re-running the audit and
  // raising the very same items again.
  const [auditRun, setAuditRun] = useState<NoteAuditRun | null>(null);
  const patientPhone = admission.patient?.phone || admission.attendant_phone || '';
  const [sendWhatsApp, setSendWhatsApp] = useState(Boolean(patientPhone));

  useEffect(() => {
    admissionService
      .getChecklist(admission.id)
      .then((c) => c && setChecklist(c))
      .catch(() => undefined);
  }, [admission.id]);

  const toggle = async (key: ChecklistKey) => {
    if (!clinicId) return;
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    try {
      await admissionService.upsertChecklist({
        clinicId,
        admissionId: admission.id,
        patch: { [key]: next[key] },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const allChecked = checklistItems.every((i) => checklist[i.key]);
  // Hard lock: no discharge of ANY type while money is pending
  const billingLocked = unbilledCount > 0 || outstandingBalance > 0;
  const findings = auditRun?.findings ?? [];
  const openFindings = findings.filter(isOpen);

  const resolveFinding = async (finding: NoteAuditFinding, status: string) => {
    if (!finding.id) return;
    const needsReason = reasonRequired.includes(status);
    const reason = needsReason ? window.prompt('Reason (required):') : null;
    if (needsReason && !reason?.trim()) return;
    try {
      await billingService.resolveNoteFinding(finding.id, status, reason, profile?.id);
      setAuditRun((run) => run && {
        ...run,
        findings: (run.findings ?? []).map((f) => (f.id === finding.id ? { ...f, status } : f)),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const discharge = async () => {
    setSaving(true);
    try {
      if (!clinicId) throw new Error('Clinic context is unavailable');
      let run = auditRun;
      if (!run) {
        run = await billingService.runNoteAudit({
          clinicId, admissionId: admission.id, runType: 'discharge', userId: profile?.id,
        });
        setAuditRun(run);
      }
      const open = (run.findings ?? []).filter(isOpen);
      if (open.length > 0) {
        toast(`${open.length} note-audit item(s) need a decision below`, { icon: '📋' });
        return;
      }
      await admissionService.discharge({ admissionId: admission.id, dischargeType });
      toast.success('Patient discharged');

      // Discharge message on WhatsApp — fire-and-forget, never blocks discharge.
      if (sendWhatsApp && patientPhone && clinicId && profile?.id) {
        ipdWhatsappService
          .sendDischargeMessage({ clinicId, userId: profile.id, admission })
          .then(() => toast.success('Discharge message sent on WhatsApp'))
          .catch(() => toast('WhatsApp discharge message could not be sent', { icon: '⚠️' }));
      }

      onDone();
      onClose();
    } catch (e) {
      const message = (e as Error).message;
      // Notes changed after the held run — the next click must audit again.
      if (/fresh discharge billing audit/i.test(message)) setAuditRun(null);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <LogOut className="w-4 h-4 text-red-600" /> Discharge — {admission.patient?.name}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {billingLocked && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-3 text-sm text-red-800 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Discharge locked — clear billing first.</p>
              {unbilledCount > 0 && <p>• {unbilledCount} unbilled charge(s) — generate a bill.</p>}
              {outstandingBalance > 0 && <p>• Outstanding balance ₹{outstandingBalance.toFixed(2)} — record payment (or write off).</p>}
            </div>
          </div>
        )}

        {findings.length > 0 && (
          <div className={`rounded-lg border p-3 mb-3 ${openFindings.length ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
            <p className={`text-sm font-semibold mb-2 ${openFindings.length ? 'text-amber-800' : 'text-emerald-800'}`}>
              {openFindings.length
                ? `Note audit — choose an option for ${openFindings.length} item(s)`
                : 'Note audit — every item decided'}
            </p>
            <div className="space-y-2">
              {findings.map((f) => (
                <div key={f.id ?? `${f.source_id}-${f.service_id}`} className="border-b border-amber-100 pb-2 last:border-0">
                  <p className="text-sm text-slate-700">
                    <b>{f.service_name}</b> · {f.source_date} · documented {f.documented_quantity}, charged {f.charged_quantity}
                  </p>
                  {f.source_excerpt && <p className="text-xs text-slate-500 mt-0.5">“{f.source_excerpt}”</p>}
                  {isOpen(f) ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {resolutions.map(([value, label]) => (
                        <button key={value} onClick={() => resolveFinding(f, value)}
                          className="text-xs bg-white border border-slate-300 rounded px-2 py-1 hover:bg-slate-50">
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-700 mt-1">Resolved: {String(f.status).replace(/_/g, ' ')}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              To bill an item instead, add the charge in Charges — otherwise pick a reason and continue.
            </p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {checklistItems.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!checklist[key]}
                onChange={() => toggle(key)}
                className="rounded"
              />
              {label}
            </label>
          ))}
        </div>

        {patientPhone && (
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="rounded"
            />
            <MessageCircle className="w-4 h-4 text-green-600" />
            Send discharge message on WhatsApp ({patientPhone})
          </label>
        )}

        <label className="block text-sm mb-4">
          <span className="text-slate-600">Discharge type</span>
          <select
            value={dischargeType}
            onChange={(e) => setDischargeType(e.target.value as typeof dischargeType)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm"
          >
            {dischargeTypes.map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg">
            Cancel
          </button>
          <button
            onClick={discharge}
            disabled={saving || billingLocked || openFindings.length > 0 || (!allChecked && dischargeType === 'routine')}
            title={
              billingLocked
                ? 'Billing must be cleared before discharge'
                : openFindings.length > 0
                  ? 'Choose an option for each note-audit item above'
                  : !allChecked && dischargeType === 'routine'
                    ? 'Complete the checklist for a routine discharge'
                    : ''
            }
            className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg"
          >
            {saving ? 'Checking & discharging…'
              : billingLocked ? 'Locked — dues pending'
                : openFindings.length > 0 ? `Decide ${openFindings.length} audit item(s)`
                  : 'Discharge'}
          </button>
        </div>
      </div>
    </div>
  );
}
