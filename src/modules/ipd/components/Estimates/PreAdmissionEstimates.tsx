import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  Calculator, Plus, Search, X, PenLine, Printer, FileDown, Trash2, User,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { documentService, IpdDocument } from '../../services/documentService';
import type { ComposeSubject } from '../../services/documentSubject';
import { patientService } from '../../services/patientService';
import { bedService } from '../../services/bedService';
import { masterService } from '../../services/masterService';
import DocumentEditor from '../Documents/DocumentEditor';
import type { BedType, Patient, Payer, Profile, TariffPlan } from '../../types/ipd';
import { claimTab, openDocument } from '../../../../services/documentOpener';

type EstimateRow = IpdDocument & {
  patient?: { id: string; name: string; phone: string | null };
};

/**
 * Pre-admission ("free") estimates — a cost quote for a patient who has not
 * been admitted yet, which is what a family or a TPA asks for first.
 *
 * The form supplies by hand what an admission would otherwise supply from the
 * chart — patient, bed class, consultant, payer — and from there it is exactly
 * the in-admission flow: the same editor, the same Dictate panel, the same
 * "Write with AI" composer pricing against the clinic's own rate card for the
 * class being quoted.
 */
export default function PreAdmissionEstimates() {
  const { clinicId, profile } = useAuth();
  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<{ doc: IpdDocument; subject: ComposeSubject } | null>(null);

  // masters
  const [bedTypes, setBedTypes] = useState<BedType[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [plans, setPlans] = useState<TariffPlan[]>([]);

  // form
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [bedTypeId, setBedTypeId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [tariffPlanId, setTariffPlanId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    if (!clinicId) return;
    setLoading(true);
    documentService
      .listPreAdmissionEstimates(clinicId)
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [clinicId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!clinicId) return;
    Promise.all([
      bedService.listBedTypes(clinicId),
      patientService.listDoctors(clinicId),
      masterService.listPayers(clinicId),
      masterService.listTariffPlans(clinicId),
    ])
      .then(([bt, d, p, tp]) => {
        setBedTypes(bt);
        setDoctors(d);
        setPayers(p);
        setPlans(tp);
      })
      .catch((e) => toast.error(e.message));
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId || patient) return;
    const handle = setTimeout(() => {
      patientService.search(clinicId, searchTerm).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [clinicId, searchTerm, patient]);

  /** Picking a payer auto-selects its rate plan, as on the admission form */
  const handlePayerChange = (id: string) => {
    setPayerId(id);
    const payerPlan = plans.find((pl) => pl.payer_id === id);
    setTariffPlanId(id && payerPlan ? payerPlan.id : '');
  };

  const resetForm = () => {
    setPatient(null);
    setSearchTerm('');
    setResults([]);
    setBedTypeId('');
    setDoctorId('');
    setPayerId('');
    setTariffPlanId('');
    setDiagnosis('');
  };

  /** The form's answers in the shape the editor, dictation and AI all expect */
  const buildSubject = (): ComposeSubject | null => {
    if (!clinicId || !patient) return null;
    const bedType = bedTypes.find((b) => b.id === bedTypeId) ?? null;
    const doctorName = doctors.find((d) => d.id === doctorId)?.name ?? '';
    const payerName = payers.find((p) => p.id === payerId)?.name ?? null;
    return {
      clinicId,
      patientName: patient.name,
      age: patient.age ?? null,
      gender: patient.gender ?? null,
      allergies: patient.allergies ?? [],
      admissionNumber: null,
      wardBed: bedType ? `${bedType.name} (to be allotted)` : 'not allotted',
      admittedOn: null,
      dischargedOn: null,
      doctorName: doctorName.replace(/^dr\.?\s*/i, ''),
      diagnosis,
      reasonForAdmission: diagnosis,
      tariff: {
        bedTypeId: bedType?.id ?? null,
        bedTypeCode: bedType?.code ?? null,
        bedClassLabel: bedType?.name ?? 'not selected',
        roomRentServiceId: bedType?.room_rent_service_id ?? null,
        nursingServiceId: bedType?.nursing_service_id ?? null,
        tariffPlanId: tariffPlanId || null,
        payerName,
      },
    };
  };

  const create = async () => {
    const subject = buildSubject();
    if (!clinicId || !patient || !subject) {
      toast.error('Select a patient first');
      return;
    }
    if (!bedTypeId) {
      toast.error('Select the bed class being quoted — the whole estimate is priced at that class');
      return;
    }
    setCreating(true);
    try {
      const doc = await documentService.createPreAdmissionEstimate({
        clinicId,
        patient: {
          id: patient.id,
          name: patient.name,
          age: patient.age,
          gender: patient.gender,
          allergies: patient.allergies,
        },
        bedClassLabel: subject.tariff.bedClassLabel,
        doctorName: subject.doctorName,
        diagnosis,
        subjectContext: subject,
        userId: profile?.id,
      });
      toast.success('Estimate started — use "Write with AI" or type it in');
      setFormOpen(false);
      resetForm();
      setEditing({ doc, subject });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  /** Reopen a saved estimate at the class it was originally quoted against */
  const open = (row: EstimateRow) => {
    const stored = row.subject_context as ComposeSubject | null;
    const subject: ComposeSubject = stored?.tariff
      ? { ...stored, clinicId: clinicId ?? stored.clinicId }
      : {
          clinicId: clinicId ?? '',
          patientName: row.patient?.name ?? '',
          age: null, gender: null, allergies: [],
          admissionNumber: null, wardBed: 'not allotted',
          admittedOn: null, dischargedOn: null,
          doctorName: '', diagnosis: '', reasonForAdmission: '',
          tariff: {
            bedTypeId: null, bedTypeCode: null, bedClassLabel: 'not recorded',
            roomRentServiceId: null, nursingServiceId: null,
            tariffPlanId: null, payerName: null,
          },
        };
    setEditing({ doc: row, subject });
  };

  const remove = async (row: EstimateRow) => {
    if (!window.confirm(`Delete draft estimate ${row.document_number ?? ''}? This cannot be undone.`)) {
      return;
    }
    try {
      await documentService.deleteDocument(row.id);
      toast.success('Draft deleted');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const print = (row: EstimateRow) =>
    documentService
      .printDocument({ doc: row, admission: null, clinicId: clinicId! })
      .catch((e) => toast.error((e as Error).message));

  const pdf = async (row: EstimateRow) => {
    if (!clinicId) return;
    const tab = claimTab();
    try {
      await openDocument(tab, {
        entityType: 'ipd_document',
        entityId: row.id,
        variant: 'final',
        generate: () => documentService.generateDocumentPdf({ doc: row, admission: null, clinicId }),
        onComplete: () => reload(),
        onError: (e) => toast.error((e as Error).message),
      });
    } catch {
      // openDocument closes the claimed tab and reports fallback errors.
    }
  };

  if (editing) {
    return (
      <DocumentEditor
        doc={editing.doc}
        subject={editing.subject}
        admission={null}
        onClose={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setFormOpen((o) => !o)}
          className="flex items-center gap-1.5 bg-navy-700 hover:bg-navy-800 text-white text-sm px-3 py-1.5 rounded-lg"
        >
          <Plus className="w-4 h-4" /> New estimate
        </button>
        <span className="text-xs text-slate-500 max-w-2xl">
          A cost quote for a patient who is <b>not admitted yet</b> — for the family, or for a TPA
          pre-authorisation. Pick the patient, the bed class being quoted and the consultant, then
          use <b>Write with AI</b> to describe the case in one line. Charges are priced from this
          clinic&rsquo;s rate card at the selected class.
        </span>
      </div>

      {formOpen && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-3">
          {/* patient */}
          {patient ? (
            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-navy-600" />
              <span className="font-medium text-slate-800">{patient.name}</span>
              <span className="text-slate-500">
                {patient.age ? `${patient.age}y` : ''} {patient.gender ?? ''} · {patient.phone ?? '—'}
              </span>
              <button
                onClick={() => { setPatient(null); setSearchTerm(''); }}
                className="text-slate-400 hover:text-slate-700"
                title="Change patient"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search patient by name or phone…"
                className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setPatient(p); setResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <span className="ml-2 text-slate-500">
                        {p.age ? `${p.age}y` : ''} {p.gender ?? ''} · {p.phone ?? '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="text-xs text-slate-500">
              Bed class quoted *
              <select
                value={bedTypeId}
                onChange={(e) => setBedTypeId(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              >
                <option value="">Select class…</option>
                {bedTypes.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-500">
              Consultant
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              >
                <option value="">Select doctor…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-500">
              Payer / TPA
              <select
                value={payerId}
                onChange={(e) => handlePayerChange(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              >
                <option value="">Cash / self-pay</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-500">
              Tariff plan
              <select
                value={tariffPlanId}
                onChange={(e) => setTariffPlanId(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-slate-800"
              >
                <option value="">Standard rate card</option>
                {plans.map((pl) => (
                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-xs text-slate-500 block">
            Provisional diagnosis / reason
            <input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Enteric fever"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-800"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={creating || !patient}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg"
            >
              <Calculator className="w-4 h-4" />
              {creating ? 'Creating…' : 'Create & open'}
            </button>
            <button
              onClick={() => { setFormOpen(false); resetForm(); }}
              className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No pre-admission estimates yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 text-sm"
            >
              <Calculator className="w-5 h-5 text-navy-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800">
                  {r.patient?.name ?? 'Patient'}
                  <span className="ml-2 text-xs text-slate-400">{r.document_number}</span>
                </p>
                <p className="text-xs text-slate-400">
                  {format(new Date(r.created_at), 'dd MMM yyyy, HH:mm')}
                  {(r.subject_context as ComposeSubject | null)?.tariff?.bedClassLabel && (
                    <span className="ml-2">
                      · {(r.subject_context as ComposeSubject).tariff.bedClassLabel}
                    </span>
                  )}
                  {r.pdf_url && <span className="ml-2 text-emerald-600">PDF saved ✓</span>}
                </p>
              </div>
              <span
                className={`text-xs uppercase px-2 py-0.5 rounded ${
                  r.status === 'signed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {r.status}
              </span>
              <button
                onClick={() => open(r)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title={r.status === 'draft' ? 'Edit' : 'View'}
              >
                <PenLine className="w-4 h-4" />
              </button>
              <button
                onClick={() => pdf(r)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="PDF on clinic letterhead"
              >
                <FileDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => print(r)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Quick browser print"
              >
                <Printer className="w-4 h-4" />
              </button>
              {r.status === 'draft' && (
                <button
                  onClick={() => remove(r)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="Delete draft"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
