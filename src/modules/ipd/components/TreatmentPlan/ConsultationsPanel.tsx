import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Users, Plus, Check, Ban, IndianRupee } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { treatmentPlanService } from '../../services/treatmentPlanService';
import { patientService } from '../../services/patientService';
import { chargeService } from '../../services/chargeService';
import type { Admission, IpdConsultation, Profile } from '../../types/ipd';

interface Props {
  admission: Admission;
  consultations: IpdConsultation[];
  readOnly: boolean;
  onChange: () => void;
}

const URGENCY_STYLE: Record<string, string> = {
  routine: 'bg-slate-100 text-slate-500',
  urgent: 'bg-amber-100 text-amber-700',
  stat: 'bg-red-100 text-red-700',
};

/** Cross / referral opinions asked for during the stay, with the consultant's
    note recorded back against the request. */
export default function ConsultationsPanel({ admission, consultations, readOnly, onChange }: Props) {
  const { clinicId, profile } = useAuth();
  const [adding, setAdding] = useState(false);
  const [specialty, setSpecialty] = useState('');
  const [external, setExternal] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<IpdConsultation['urgency']>('routine');
  const [saving, setSaving] = useState(false);
  const [opinionFor, setOpinionFor] = useState<string | null>(null);
  const [opinion, setOpinion] = useState('');
  const [seenBy, setSeenBy] = useState('');
  const [doctors, setDoctors] = useState<Profile[]>([]);
  // billable consultation service + the rate resolved for this admission's tariff
  const [billService, setBillService] = useState<{ id: string; name: string; base_price: number } | null>(null);
  const [billRate, setBillRate] = useState('');
  const [postCharge, setPostCharge] = useState(true);

  useEffect(() => {
    if (!clinicId) return;
    patientService.listDoctors(clinicId).then(setDoctors).catch(() => setDoctors([]));
    treatmentPlanService
      .getConsultationService(clinicId)
      .then(async (svc) => {
        setBillService(svc);
        if (!svc) return;
        try {
          const rate = await chargeService.resolveRate(
            svc.id, admission.tariff_plan_id, admission.current_bed?.bed_type_id ?? null
          );
          setBillRate(String(rate));
        } catch {
          setBillRate(String(svc.base_price));
        }
      })
      .catch(() => setBillService(null));
  }, [clinicId, admission.tariff_plan_id, admission.current_bed?.bed_type_id]);

  const request = async () => {
    if (!clinicId) return;
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    setSaving(true);
    try {
      await treatmentPlanService.requestConsultation({
        clinicId,
        admissionId: admission.id,
        specialty: specialty.trim() || null,
        doctorId: doctorId || null,
        externalDoctorName: external.trim() || null,
        reason: reason.trim(),
        urgency,
        userId: profile?.id,
      });
      toast.success('Consultation requested');
      setSpecialty(''); setExternal(''); setDoctorId(''); setReason(''); setUrgency('routine');
      setAdding(false);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openOpinion = (c: IpdConsultation) => {
    setOpinionFor(c.id);
    setOpinion('');
    setSeenBy(c.doctor_id ?? '');
    setPostCharge(!!billService);
  };

  const saveOpinion = async (c: IpdConsultation) => {
    if (!opinion.trim()) return;
    const rate = Number(billRate);
    if (postCharge && billService && !Number.isFinite(rate)) {
      toast.error('Enter a valid consultation charge');
      return;
    }
    try {
      await treatmentPlanService.recordOpinion({
        consultationId: c.id,
        opinion: opinion.trim(),
        userId: profile?.id,
        doctorId: seenBy || null,
        billing: postCharge && billService && clinicId
          ? {
            clinicId,
            admissionId: admission.id,
            serviceId: billService.id,
            unitRate: rate,
            description: `Cross consultation${c.specialty ? ` — ${c.specialty}` : ''}`,
          }
          : undefined,
      });
      toast.success(
        postCharge && billService
          ? `Opinion recorded — ₹${rate.toFixed(2)} posted to the bill`
          : 'Opinion recorded'
      );
      setOpinionFor(null);
      setOpinion('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const cancel = async (c: IpdConsultation) => {
    const why = prompt('Cancel this consultation — reason?');
    if (why === null) return;
    try {
      await treatmentPlanService.cancelConsultation(c.id, why || 'Cancelled');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = consultations.filter((c) => c.status === 'requested').length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-semibold text-slate-800">
          Cross consultations
          {pending > 0 && (
            <span className="ml-2 text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              {pending} awaiting opinion
            </span>
          )}
        </span>
        {!readOnly && (
          <button
            onClick={() => setAdding((a) => !a)}
            className="ml-auto flex items-center gap-1 text-xs border border-slate-300 text-slate-600 rounded-lg px-2 py-1 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Request opinion
          </button>
        )}
      </div>

      {adding && !readOnly && (
        <div className="flex flex-wrap gap-2 mb-3 border border-slate-200 rounded-lg p-2.5 bg-slate-50">
          <input value={specialty} onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Specialty" className="w-40 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
            title="In-house consultant" className="w-44 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">In-house consultant…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>Dr. {d.name?.replace(/^dr\.?\s*/i, '')}</option>
            ))}
          </select>
          <input value={external} onChange={(e) => setExternal(e.target.value)}
            placeholder="Or outside consultant" className="w-44 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for the opinion" className="flex-1 min-w-48 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <select value={urgency} onChange={(e) => setUrgency(e.target.value as IpdConsultation['urgency'])}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
          </select>
          <button onClick={request} disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg">
            {saving ? 'Requesting…' : 'Request'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {consultations.map((c) => (
          <div key={c.id} className="border border-slate-100 rounded-lg p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-800 capitalize">
                {c.specialty ?? 'Consultation'}
                {c.external_doctor_name ? ` — ${c.external_doctor_name}` : ''}
                {c.doctor?.name ? ` — Dr. ${c.doctor.name.replace(/^dr\.?\s*/i, '')}` : ''}
              </span>
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${URGENCY_STYLE[c.urgency]}`}>
                {c.urgency}
              </span>
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                c.status === 'seen' ? 'bg-emerald-100 text-emerald-700'
                  : c.status === 'cancelled' ? 'bg-slate-100 text-slate-400'
                    : 'bg-amber-100 text-amber-700'
              }`}>
                {c.status}
              </span>
              <span className="text-xs text-slate-400">
                {format(new Date(c.requested_at), 'dd MMM, HH:mm')}
              </span>
              {c.charge_posting_id && (
                <span
                  title="Consultation charge posted to the running bill"
                  className="flex items-center gap-0.5 text-[10px] uppercase font-semibold bg-navy-50 text-navy-700 border border-navy-200 px-1.5 py-0.5 rounded"
                >
                  <IndianRupee className="w-3 h-3" /> billed
                </span>
              )}
              {!readOnly && c.status === 'requested' && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => openOpinion(c)}
                    className="flex items-center gap-1 text-xs border border-emerald-300 text-emerald-700 rounded-lg px-2 py-1 hover:bg-emerald-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Record opinion
                  </button>
                  <button
                    onClick={() => cancel(c)}
                    className="p-1 text-slate-400 hover:text-red-600"
                    title="Cancel request"
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
            <p className="text-slate-600 mt-1">{c.reason}</p>
            {c.opinion && (
              <p className="text-slate-700 mt-1 bg-emerald-50 border border-emerald-100 rounded p-2">
                <span className="text-slate-400">Opinion</span>
                {c.seen_at ? <span className="text-xs text-slate-400"> · {format(new Date(c.seen_at), 'dd MMM, HH:mm')}</span> : null}
                <br />
                {c.opinion}
              </p>
            )}
            {c.cancelled_reason && (
              <p className="text-xs text-slate-400 mt-1">Cancelled — {c.cancelled_reason}</p>
            )}

            {opinionFor === c.id && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={opinion}
                  onChange={(e) => setOpinion(e.target.value)}
                  rows={2}
                  placeholder="Consultant's opinion / advice…"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={seenBy}
                    onChange={(e) => setSeenBy(e.target.value)}
                    title="Consultant who saw the patient (bill line is attributed to them)"
                    className="w-48 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="">Seen by…</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>Dr. {d.name?.replace(/^dr\.?\s*/i, '')}</option>
                    ))}
                  </select>

                  {billService ? (
                    <>
                      <label className="flex items-center gap-1.5 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={postCharge}
                          onChange={(e) => setPostCharge(e.target.checked)}
                        />
                        Bill {billService.name}
                      </label>
                      {postCharge && (
                        <input
                          type="number"
                          value={billRate}
                          onChange={(e) => setBillRate(e.target.value)}
                          title="Consultation charge"
                          className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        />
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-amber-700">
                      No consultation service in the catalog — add CONS-CROSS in Masters to bill this.
                    </span>
                  )}

                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => setOpinionFor(null)}
                      className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveOpinion(c)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-1.5 rounded-lg"
                    >
                      Save{postCharge && billService ? ` & bill ₹${Number(billRate || 0).toFixed(0)}` : ''}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {consultations.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-4">
            No cross consultations requested for this admission.
          </p>
        )}
      </div>
    </div>
  );
}
