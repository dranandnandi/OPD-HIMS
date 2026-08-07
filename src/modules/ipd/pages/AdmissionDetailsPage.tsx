import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Printer, FilePlus, ReceiptText, ArrowRightLeft, LogOut, FileDown, Sparkles, Mic, Trash2, Loader2, AlertTriangle, CheckCircle2, Ban } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { admissionService, MlcDetails } from '../services/admissionService';
import { chargeService } from '../services/chargeService';
import { billingService, BillAudit } from '../services/billingService';
import { patientService } from '../services/patientService';
import { printAdmissionLabels } from '../utils/labelGenerator';
import { documentService } from '../services/documentService';
import PatientDocumentsPanel from '../../../components/Patients/PatientDocumentsPanel';
import TransferBedModal from '../components/ADT/TransferBedModal';
import DischargeModal from '../components/ADT/DischargeModal';
import CancelAdmissionModal from '../components/ADT/CancelAdmissionModal';
import NursingTab from '../components/Nursing/NursingTab';
import DocumentsTab from '../components/Documents/DocumentsTab';
import MedicationsTab from '../components/Medications/MedicationsTab';
import TreatmentPlanTab from '../components/TreatmentPlan/TreatmentPlanTab';
import OrdersTab from '../components/Orders/OrdersTab';
import InsuranceClaimsTab from '../components/Insurance/InsuranceClaimsTab';
import { packageService, AdmissionPackage } from '../services/packageService';
import type { Admission, BedAllocation, ChargePosting, Deposit, IpdBill, Profile, ServiceMaster } from '../types/ipd';

type Tab =
  | 'overview' | 'plan' | 'orders' | 'timeline' | 'nursing' | 'meds'
  | 'charges' | 'deposits' | 'billing' | 'audit' | 'insurance' | 'documents';

const TABS: Tab[] = [
  'overview', 'plan', 'orders', 'nursing', 'meds', 'timeline',
  'charges', 'deposits', 'billing', 'audit', 'insurance', 'documents',
];

const TAB_LABELS: Partial<Record<Tab, string>> = {
  plan: 'Treatment Plan',
  orders: 'Orders & Reports',
  timeline: 'OPD History',
  audit: 'Bill Audit',
  insurance: 'TPA / Insurance',
};

type OpdVisit = Awaited<ReturnType<typeof patientService.listVisits>>[number];

// chart tabs beyond overview/history are permission-gated (shared OPD RBAC)
const TAB_PERMISSIONS: Partial<Record<Tab, string>> = {
  plan: 'ipd_clinical',
  orders: 'ipd_clinical',
  nursing: 'ipd_clinical',
  meds: 'ipd_clinical',
  charges: 'ipd_charges',
  deposits: 'ipd_billing',
  billing: 'ipd_billing',
  audit: 'ipd_billing',
  insurance: 'ipd_billing',
  documents: 'ipd_documents',
};

export default function AdmissionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clinicId, profile, isAdmin, hasPermission } = useAuth();
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [postings, setPostings] = useState<ChargePosting[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [bills, setBills] = useState<IpdBill[]>([]);
  const [visits, setVisits] = useState<OpdVisit[]>([]);
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    return t && TABS.includes(t) ? t : 'overview';
  });
  const [error, setError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDischarge, setShowDischarge] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [admissionPackage, setAdmissionPackage] = useState<AdmissionPackage | null>(null);

  // deep links (?tab=…) cannot bypass tab permissions
  useEffect(() => {
    const perm = TAB_PERMISSIONS[tab];
    if (perm && !hasPermission(perm)) setTab('overview');
  }, [tab, hasPermission]);

  const reload = useCallback(() => {
    if (!id) return;
    Promise.all([
      admissionService.getById(id),
      chargeService.listPostings(id),
      billingService.listDeposits(id),
      billingService.listBills(id),
    ])
      .then(([adm, chg, dep, bls]) => {
        setAdmission(adm);
        setPostings(chg);
        setDeposits(dep);
        setBills(bls);
        if (adm?.patient_id) {
          patientService.listVisits(adm.patient_id).then(setVisits).catch(() => setVisits([]));
        }
        if (adm) {
          packageService.getAdmissionPackage(adm.id).then(setAdmissionPackage).catch(() => setAdmissionPackage(null));
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(reload, [reload]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!admission) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const payableCharges = postings
    .filter((p) => p.status !== 'cancelled' && !p.covered_by_package)
    .reduce((s, p) => s + p.net_amount, 0);
  const totalDeposits = deposits.reduce(
    (s, d) => s + (d.entry_type === 'deposit' ? d.amount : -d.amount), 0
  );
  // Expected total = package agreed price + payable (non-covered) charges
  const expectedTotal = (admissionPackage?.agreed_price ?? 0) + payableCharges;

  const reprintLabels = () =>
    printAdmissionLabels(
      {
        admissionNumber: admission.admission_number,
        patientName: admission.patient?.name ?? 'Patient',
        age: admission.patient?.age,
        gender: admission.patient?.gender,
        bloodGroup: admission.patient?.blood_group,
        allergies: admission.patient?.allergies,
        wardBed: admission.current_bed
          ? `${admission.current_bed.ward?.name ?? ''} / ${admission.current_bed.bed_number}`
          : undefined,
        admittedOn: format(new Date(admission.admission_datetime), 'dd MMM yy HH:mm'),
        chartUrl: `${window.location.origin}/ipd/admissions/${admission.id}`,
      },
      { copies: 2, includeQr: true }
    );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">
              {admission.patient?.name}
              <span className="ml-2 text-sm font-normal text-slate-500">{admission.admission_number}</span>
              {admission.status !== 'admitted' && (
                <span className="ml-2 text-xs uppercase bg-slate-200 text-slate-600 px-2 py-0.5 rounded">
                  {admission.status}
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-500">
              {admission.current_bed
                ? `${admission.current_bed.ward?.name} / Bed ${admission.current_bed.bed_number}`
                : 'No bed'}{' '}
              · Dr. {admission.admitting_doctor?.name} · admitted{' '}
              {format(new Date(admission.admission_datetime), 'dd MMM yyyy, HH:mm')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm">
              {admissionPackage && (
                <p className="text-slate-500">
                  📦 Package: <span className="font-semibold text-navy-700">₹{admissionPackage.agreed_price.toLocaleString('en-IN')}</span>
                </p>
              )}
              <p className="text-slate-500">
                {admissionPackage ? 'Extra charges' : 'Charges'}:{' '}
                <span className="font-semibold text-slate-800">₹{payableCharges.toFixed(2)}</span>
              </p>
              <p className="text-slate-500">
                {admissionPackage && (
                  <>Total: <span className="font-semibold text-slate-800">₹{expectedTotal.toLocaleString('en-IN')}</span> · </>
                )}
                Deposits: <span className="font-semibold text-emerald-700">₹{totalDeposits.toFixed(2)}</span>
              </p>
            </div>
            <button
              onClick={reprintLabels}
              title="Reprint wristband / file labels"
              className="border border-slate-300 rounded-lg p-2 text-slate-600 hover:bg-slate-50"
            >
              <Printer className="w-4 h-4" />
            </button>
            {admission.status === 'admitted' && (
              <>
                <button
                  onClick={() => setShowTransfer(true)}
                  className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <ArrowRightLeft className="w-4 h-4" /> Transfer
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setShowCancel(true)}
                    title="Wrong admission? Cancel it — the bed is released and the record is voided"
                    className="flex items-center gap-1.5 border border-red-300 text-red-700 rounded-lg px-3 py-2 text-sm hover:bg-red-50"
                  >
                    <Ban className="w-4 h-4" /> Cancel admission
                  </button>
                )}
                {isAdmin ? (
                  <button
                    onClick={() => setShowDischarge(true)}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 text-sm"
                  >
                    <LogOut className="w-4 h-4" /> Discharge
                  </button>
                ) : (
                  <span
                    title="Only admins can discharge (managed in OPD User Management)"
                    className="flex items-center gap-1.5 bg-slate-200 text-slate-400 rounded-lg px-3 py-2 text-sm cursor-not-allowed"
                  >
                    <LogOut className="w-4 h-4" /> Discharge
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showTransfer && (
        <TransferBedModal
          admission={admission}
          onClose={() => setShowTransfer(false)}
          onDone={reload}
        />
      )}
      {showDischarge && (
        <DischargeModal
          admission={admission}
          unbilledCount={postings.filter((p) => p.status === 'pending' && !p.covered_by_package).length}
          outstandingBalance={bills
            .filter((b) => b.status !== 'cancelled')
            .reduce((s, b) => s + Math.max(b.balance_amount, 0), 0)}
          onClose={() => setShowDischarge(false)}
          onDone={reload}
        />
      )}
      {showCancel && (
        <CancelAdmissionModal
          admission={admission}
          onClose={() => setShowCancel(false)}
          onCancelled={reload}
          onDeleted={() => navigate('/ipd/census', { replace: true })}
        />
      )}

      {/* Tabs (permission-gated) */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS
          .filter((t) => !TAB_PERMISSIONS[t] || hasPermission(TAB_PERMISSIONS[t]!))
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm capitalize ${
                tab === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              {TAB_LABELS[t] ?? t}
            </button>
          ))}
      </div>

      {tab === 'overview' && <OverviewTab admission={admission} />}
      {tab === 'plan' && (
        <TreatmentPlanTab admission={admission} readOnly={admission.status !== 'admitted'} />
      )}
      {tab === 'orders' && (
        <OrdersTab admission={admission} readOnly={admission.status !== 'admitted'} />
      )}
      {tab === 'timeline' && <TimelineTab visits={visits} />}
      {tab === 'nursing' && (
        <NursingTab admission={admission} readOnly={admission.status !== 'admitted'} />
      )}
      {tab === 'meds' && (
        <MedicationsTab admissionId={admission.id} readOnly={admission.status !== 'admitted'} />
      )}
      {tab === 'documents' && <DocumentsTab admission={admission} />}
      {tab === 'charges' && (
        <>
          {admissionPackage ? (
            <PackageMonitor assignment={admissionPackage} onConverted={reload} />
          ) : (
            admission.status === 'admitted' && (
              <AssignPackageBar
                clinicId={clinicId!}
                admission={admission}
                userId={profile?.id}
                onAssigned={reload}
              />
            )
          )}
          <ChargesTab
            clinicId={clinicId!}
            admission={admission}
            postings={postings}
            activeAssignmentId={admissionPackage?.status === 'active' ? admissionPackage.id : null}
            userId={profile?.id}
            onChange={reload}
          />
        </>
      )}
      {tab === 'deposits' && (
        <DepositsTab
          clinicId={clinicId!}
          admission={admission}
          deposits={deposits}
          pendingDue={Math.max(
            postings
              .filter((p) => p.status === 'pending' && !p.covered_by_package)
              .reduce((s, p) => s + p.net_amount, 0)
            + (admissionPackage && !admissionPackage.billed_bill_id ? admissionPackage.agreed_price : 0)
            + bills.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + Math.max(b.balance_amount, 0), 0)
            - totalDeposits,
            0
          )}
          userId={profile?.id}
          onChange={reload}
        />
      )}
      {tab === 'billing' && admissionPackage && (
        <PackageMonitor assignment={admissionPackage} onConverted={reload} />
      )}
      {tab === 'billing' && (
        <BillingTab
          clinicId={clinicId!}
          admission={admission}
          bills={bills}
          pendingCount={postings.filter((p) => p.status === 'pending' && !p.covered_by_package).length}
          unbilledPackage={
            admissionPackage && !admissionPackage.billed_bill_id
              ? { name: admissionPackage.package?.name ?? 'Package', agreed: admissionPackage.agreed_price }
              : null
          }
          userId={profile?.id}
          onChange={reload}
        />
      )}
      {tab === 'audit' && <BillAuditTab admission={admission} />}
      {tab === 'insurance' && <InsuranceClaimsTab admission={admission} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab({ admission }: { admission: Admission }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
        <p><span className="text-slate-400">Diagnosis:</span> {admission.provisional_diagnosis ?? '—'}</p>
        <p><span className="text-slate-400">Reason:</span> {admission.reason_for_admission ?? '—'}</p>
        <p><span className="text-slate-400">Type:</span> <span className="capitalize">{admission.admission_type.replace('_', ' ')}</span></p>
        <p><span className="text-slate-400">Attendant:</span> {admission.attendant_name ?? '—'} {admission.attendant_phone ? `(${admission.attendant_phone})` : ''}</p>
        {admission.patient?.allergies?.length ? (
          <p className="text-red-600">⚠ Allergies: {admission.patient.allergies.join(', ')}</p>
        ) : null}
        {admission.is_mlc && <p className="text-red-600 font-medium">MLC case {admission.mlc_number ?? ''}</p>}
        {admission.source_visit_id && (
          <p className="text-slate-400 text-xs">Admitted from OPD visit {admission.source_visit_id}</p>
        )}
      </div>
      {admission.is_mlc && <MlcCard admission={admission} />}
      <TransferLogCard admissionId={admission.id} />
      {admission.patient?.id && (
        <PatientDocumentsPanel
          patientId={admission.patient.id}
          patientName={admission.patient.name}
          patientPhone={admission.patient.phone}
          contextLabel={admission.admission_number}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BillAuditTab({ admission }: { admission: Admission }) {
  const [audit, setAudit] = useState<BillAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    billingService
      .getBillAudit(admission.id)
      .then(setAudit)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [admission.id]);

  if (loading) return <p className="text-sm text-slate-500">Auditing bill…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!audit) return null;

  const losDays = Math.max(
    1,
    Math.ceil(
      ((admission.discharge_datetime ? new Date(admission.discharge_datetime) : new Date()).getTime() -
        new Date(admission.admission_datetime).getTime()) / 86_400_000
    )
  );
  const roomShort = losDays - audit.roomRentPostings;

  const issues =
    audit.ordersNotCharged.length +
    audit.consumablesNotCharged.length +
    audit.doctorWorkMissingDoctor.length +
    (roomShort > 0 ? 1 : 0);

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2">
          {issues === 0 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          )}
          <span className="font-semibold text-slate-800">
            {issues === 0 ? 'No leakage found — bill looks complete' : `${issues} item(s) to review before final bill`}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Pending (unbilled) charges</p>
            <p className="font-bold text-slate-800">{audit.pendingCount} · {fmt(audit.pendingAmount)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Room-rent days billed</p>
            <p className={`font-bold ${roomShort > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {audit.roomRentPostings} / {losDays} day(s)
            </p>
          </div>
        </div>
      </div>

      <AuditSection
        title="Orders placed but not charged"
        rows={audit.ordersNotCharged.map((o) => `${o.serviceName} · ordered ${fmtDate(o.orderedAt)}`)}
        hint="Post these from the Orders/Charges tab — usually a rate that couldn't be resolved."
      />
      <AuditSection
        title="Ward consumption not charged"
        rows={audit.consumablesNotCharged.map((c) => `${c.name} × ${c.quantity} · ${fmtDate(c.at)}`)}
        hint="No selling price is configured for these items — set it in pharmacy pricing, then re-issue."
      />
      <AuditSection
        title="Doctor-work charges missing a performing doctor"
        rows={audit.doctorWorkMissingDoctor.map((d) => `${d.serviceName} · ${fmt(d.amount)}`)}
        hint="Tag the performing doctor on the Charges tab so doctor-wise revenue is attributable."
      />
      {roomShort > 0 && (
        <AuditSection
          title="Room rent may be under-billed"
          rows={[`${audit.roomRentPostings} day(s) billed vs ${losDays} day(s) of stay`]}
          hint="The nightly room-rent job may have missed a day, or the patient changed bed class."
        />
      )}
    </div>
  );
}

function AuditSection({ title, rows, hint }: { title: string; rows: string[]; hint: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-amber-200 p-4">
      <p className="font-medium text-amber-800 text-sm mb-1">{title} <span className="text-amber-500">({rows.length})</span></p>
      <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5">
        {rows.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      <p className="text-xs text-slate-400 mt-2">{hint}</p>
    </div>
  );
}

/** Full bed movement log: ICU shifts, upgrades, who moved and why */
function TransferLogCard({ admissionId }: { admissionId: string }) {
  const [history, setHistory] = useState<BedAllocation[]>([]);

  useEffect(() => {
    admissionService.listBedHistory(admissionId).then(setHistory).catch(() => setHistory([]));
  }, [admissionId]);

  if (history.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
        <ArrowRightLeft className="w-4 h-4 text-blue-600" /> Bed / ward transfer log
      </h3>
      <div className="space-y-0">
        {history.map((a, i) => (
          <div key={a.id} className="flex gap-3 text-sm">
            <div className="flex flex-col items-center">
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${a.to_datetime ? 'bg-slate-300' : 'bg-emerald-500'}`} />
              {i < history.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
            </div>
            <div className="pb-4 min-w-0">
              <p className="text-slate-700">
                <b>{a.bed?.ward?.name ?? 'Ward'} / {a.bed?.bed_number ?? '—'}</b>
                <span className="text-slate-400"> ({a.bed?.bed_type?.name ?? '—'}</span>
                {a.rate_snapshot != null && <span className="text-slate-400"> · ₹{Number(a.rate_snapshot).toLocaleString('en-IN')}/day</span>}
                <span className="text-slate-400">)</span>
                <span className="ml-2 text-xs uppercase bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                  {a.reason.replace(/_/g, ' ')}
                </span>
                {!a.to_datetime && (
                  <span className="ml-1.5 text-xs uppercase bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5">current</span>
                )}
              </p>
              <p className="text-xs text-slate-400">
                {format(new Date(a.from_datetime), 'dd MMM yyyy HH:mm')}
                {a.to_datetime ? ` → ${format(new Date(a.to_datetime), 'dd MMM yyyy HH:mm')}` : ' → now'}
                {a.creator?.name ? ` · by ${a.creator.name}` : ''}
              </p>
              {a.notes && <p className="text-xs text-slate-500 mt-0.5 italic">{a.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** MLC register particulars — separate table, one row per MLC admission */
function MlcCard({ admission }: { admission: Admission }) {
  const { clinicId, profile } = useAuth();
  const [details, setDetails] = useState<MlcDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<MlcDetails>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    admissionService.getMlcDetails(admission.id).then((d) => {
      setDetails(d);
      if (!d) setEditing(true); // nothing recorded yet — open the form
    }).catch(() => {});
  }, [admission.id]);

  const startEdit = () => {
    setForm(details ?? {});
    setEditing(true);
  };

  const save = async () => {
    if (!clinicId) return;
    setSaving(true);
    try {
      const saved = await admissionService.upsertMlcDetails({
        clinicId,
        admissionId: admission.id,
        patch: form,
        userId: profile?.id,
      });
      setDetails(saved);
      setEditing(false);
      toast.success('MLC details saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const F = (key: keyof MlcDetails, placeholder: string, span = false) => (
    <input
      value={(form[key] as string | null) ?? ''}
      onChange={(e) => setForm({ ...form, [key]: e.target.value || null })}
      placeholder={placeholder}
      className={`border border-slate-300 rounded-lg px-3 py-1.5 text-sm ${span ? 'sm:col-span-2' : ''}`}
    />
  );

  return (
    <div className="bg-white rounded-xl border-2 border-red-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-red-700">
          ⚖ MLC register — {admission.mlc_number ?? 'no MLC number'}
        </h3>
        {!editing && (
          <button onClick={startEdit} className="text-xs text-blue-600 underline">Edit</button>
        )}
      </div>

      {editing ? (
        <div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs text-slate-500 sm:col-span-2">
              Incident date & time
              <input
                type="datetime-local"
                value={form.incident_datetime ? form.incident_datetime.slice(0, 16) : ''}
                onChange={(e) => setForm({ ...form, incident_datetime: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-0.5 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            {F('incident_place', 'Place of incident')}
            {F('brought_by', 'Brought by (name / relation / police)')}
            {F('incident_description', 'How the incident happened…', true)}
            {F('injuries_description', 'Injuries noted on examination…', true)}
            {F('identification_marks', 'Identification marks')}
            {F('belongings', 'Belongings handed over')}
            {F('police_station', 'Police station')}
            {F('fir_number', 'FIR / DD number')}
            <label className="text-xs text-slate-500">
              Police informed at
              <input
                type="datetime-local"
                value={form.police_informed_at ? form.police_informed_at.slice(0, 16) : ''}
                onChange={(e) => setForm({ ...form, police_informed_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="mt-0.5 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </label>
            {F('informed_officer', 'Officer informed (name/badge)')}
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.alcohol_suspected ?? false}
                onChange={(e) => setForm({ ...form, alcohol_suspected: e.target.checked })}
              />
              Smell of alcohol / intoxication suspected
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {details && (
              <button onClick={() => setEditing(false)} className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5">
                Cancel
              </button>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-4 py-1.5"
            >
              {saving ? 'Saving…' : 'Save MLC details'}
            </button>
          </div>
        </div>
      ) : details ? (
        <div className="text-sm text-slate-600 space-y-1">
          <p><span className="text-slate-400">Incident:</span> {details.incident_datetime ? format(new Date(details.incident_datetime), 'dd MMM yyyy HH:mm') : '—'} {details.incident_place ? `at ${details.incident_place}` : ''}</p>
          {details.incident_description && <p><span className="text-slate-400">Description:</span> {details.incident_description}</p>}
          {details.injuries_description && <p><span className="text-slate-400">Injuries:</span> {details.injuries_description}</p>}
          <p><span className="text-slate-400">Brought by:</span> {details.brought_by ?? '—'}</p>
          <p>
            <span className="text-slate-400">Police:</span> {details.police_station ?? '—'}
            {details.fir_number ? ` · FIR ${details.fir_number}` : ''}
            {details.police_informed_at ? ` · informed ${format(new Date(details.police_informed_at), 'dd MMM HH:mm')}` : ' · not yet informed'}
            {details.informed_officer ? ` (${details.informed_officer})` : ''}
          </p>
          {details.alcohol_suspected && <p className="text-red-600">⚠ Alcohol/intoxication suspected</p>}
          {details.belongings && <p><span className="text-slate-400">Belongings:</span> {details.belongings}</p>}
          {details.identification_marks && <p><span className="text-slate-400">ID marks:</span> {details.identification_marks}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-400">No MLC particulars recorded yet.</p>
      )}
    </div>
  );
}

function TimelineTab({ visits }: { visits: OpdVisit[] }) {
  if (visits.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
        No OPD visit history for this patient.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {visits.map((v) => {
        const when = v.visit_date ?? v.date;
        return (
          <div key={v.id} className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex justify-between mb-1">
              <span className="font-medium text-slate-800">
                {when ? format(new Date(when), 'dd MMM yyyy') : '—'}
              </span>
              <span className="text-slate-400">Dr. {v.doctor?.name ?? '—'}</span>
            </div>
            {v.chief_complaint && <p className="text-slate-600">Complaint: {v.chief_complaint}</p>}
            {v.diagnosis?.length ? <p className="text-slate-600">Diagnosis: {v.diagnosis.join(', ')}</p> : null}
            {v.doctor_notes && <p className="text-slate-400 text-xs mt-1 line-clamp-2">{v.doctor_notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

type ServiceOption = ServiceMaster & { charge_group?: { code: string; name: string; path: string } };

// Doctor work — a performing doctor must be tagged so bills read "… — Dr. X"
// and doctor-wise revenue is attributable. Matched by service_type, the
// requires_doctor flag, or filing under the CONS/PROC charge-group trees.
const DOCTOR_SERVICE_TYPES = ['consultation', 'surgery', 'procedure'];
const DOCTOR_GROUP_PREFIXES = ['CONS', 'PROC'];

const isDoctorWork = (svc: ServiceOption) =>
  svc.requires_doctor ||
  DOCTOR_SERVICE_TYPES.includes(svc.service_type) ||
  DOCTOR_GROUP_PREFIXES.some(
    (g) => svc.charge_group?.path === g || svc.charge_group?.path.startsWith(`${g}/`)
  );

// --- AI charge capture (billing utility) -----------------------------------
// Type or dictate plain language → matched services from the clinic master →
// review → post. Browser speech-to-text is optional and degrades gracefully.

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

const getSpeechRecognitionCtor = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

interface CaptureRow {
  service: ServiceOption;
  quantity: number;
  rate: string;
  performedById: string;
  needsDoctor: boolean;
  phrase?: string;
}

function AiChargeCapture({
  clinicId, admission, doctors, userId, onChange,
}: {
  clinicId: string; admission: Admission; doctors: Profile[]; userId?: string; onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [finding, setFinding] = useState(false);
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechCtor = getSpeechRecognitionCtor();

  const toggleMic = () => {
    if (listening) { recognitionRef.current?.stop(); return; }
    if (!speechCtor) { toast.error('Voice input is not supported on this browser'); return; }
    const rec = new speechCtor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join(' ');
      setText((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const find = async () => {
    if (!text.trim()) return;
    setFinding(true);
    try {
      const res = await chargeService.aiCaptureCharges(clinicId, text.trim());
      const built = await Promise.all(
        res.matches.map(async (m) => {
          let rate = m.service.base_price;
          try {
            rate = await chargeService.resolveRate(
              m.service.id, admission.tariff_plan_id, admission.current_bed?.bed_type_id ?? null
            );
          } catch { /* fall back to base price */ }
          const needsDoctor = isDoctorWork(m.service);
          return {
            service: m.service,
            quantity: m.quantity,
            rate: String(rate),
            performedById: needsDoctor ? (admission.admitting_doctor_id ?? '') : '',
            needsDoctor,
            phrase: m.phrase,
          } as CaptureRow;
        })
      );
      setRows(built);
      setUnmatched(res.unmatched);
      if (built.length === 0) toast('No matching services found — try different words', { icon: 'ℹ️' });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinding(false);
    }
  };

  const updateRow = (i: number, patch: Partial<CaptureRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const postAll = async () => {
    if (rows.length === 0) return;
    if (rows.some((r) => r.needsDoctor && !r.performedById)) {
      toast.error('Select the performing doctor for the highlighted services');
      return;
    }
    setPosting(true);
    try {
      for (const r of rows) {
        await chargeService.postCharge({
          clinicId,
          admissionId: admission.id,
          serviceId: r.service.id,
          quantity: r.quantity,
          unitRate: Number(r.rate) || 0,
          performingDoctorId: r.performedById || undefined,
          userId,
        });
      }
      toast.success(`${rows.length} charge${rows.length > 1 ? 's' : ''} posted`);
      setRows([]); setUnmatched([]); setText(''); setOpen(false);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm px-3 py-1.5 rounded-lg"
        title="Type or speak charges in plain language and let AI match them"
      >
        <Sparkles className="w-4 h-4" /> AI charge capture
      </button>
    );
  }

  return (
    <div className="w-full bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-medium text-violet-800">AI charge capture</span>
        <button
          onClick={() => { setOpen(false); setRows([]); setUnmatched([]); }}
          className="ml-auto text-xs text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder='e.g. "two dressings, one ECG, chest x-ray and a physician round"'
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm resize-y"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={toggleMic}
            className={`flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm border ${
              listening ? 'bg-red-600 text-white border-red-600 animate-pulse' : 'bg-white text-slate-600 border-slate-300'
            }`}
            title={speechCtor ? 'Dictate' : 'Voice input not supported on this browser'}
          >
            <Mic className="w-4 h-4" /> {listening ? 'Stop' : 'Speak'}
          </button>
          <button
            onClick={find}
            disabled={finding || !text.trim()}
            className="flex items-center justify-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm"
          >
            {finding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {finding ? 'Finding…' : 'Find charges'}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-navy-700 bg-slate-100 rounded px-1 py-0.5">{r.service.service_code}</span>
              <span className="flex-1 min-w-40">{r.service.name}</span>
              <input
                type="number" min="1" value={r.quantity}
                onChange={(e) => updateRow(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14 border border-slate-300 rounded px-2 py-1" title="Qty"
              />
              <input
                type="number" value={r.rate}
                onChange={(e) => updateRow(i, { rate: e.target.value })}
                className="w-24 border border-slate-300 rounded px-2 py-1" title="Rate"
              />
              {r.needsDoctor && (
                <select
                  value={r.performedById}
                  onChange={(e) => updateRow(i, { performedById: e.target.value })}
                  className={`max-w-40 border rounded px-2 py-1 ${r.performedById ? 'border-slate-300' : 'border-red-400 text-red-600'}`}
                  title="Performed by (required)"
                >
                  <option value="">Performed by *</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>Dr. {d.name?.replace(/^dr\.?\s*/i, '')}</option>
                  ))}
                </select>
              )}
              <button onClick={() => removeRow(i)} className="p-1 text-slate-400 hover:text-red-600" title="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {unmatched.length > 0 && (
        <p className="text-xs text-amber-700">
          Not matched (add manually): {unmatched.join(', ')}
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={postAll}
            disabled={posting}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            <FilePlus className="w-4 h-4" /> {posting ? 'Posting…' : `Post ${rows.length} charge${rows.length > 1 ? 's' : ''}`}
          </button>
          <button onClick={() => setRows([])} className="text-xs text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      )}
    </div>
  );
}

function ChargesTab({
  clinicId, admission, postings, activeAssignmentId, userId, onChange,
}: {
  clinicId: string; admission: Admission; postings: ChargePosting[];
  activeAssignmentId: string | null; userId?: string; onChange: () => void;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<ServiceOption[]>([]);
  const [selected, setSelected] = useState<ServiceOption | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');
  const [posting, setPosting] = useState(false);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [performedById, setPerformedById] = useState('');
  // charge-code (top-level group) filter for the picker
  const [groups, setGroups] = useState<Array<{ id: string; code: string; name: string; path: string; depth: number }>>([]);
  const [groupFilter, setGroupFilter] = useState(''); // selected group path

  const needsDoctor = !!selected && isDoctorWork(selected);

  useEffect(() => {
    chargeService
      .listChargeGroups(clinicId)
      .then((g) => setGroups(g.map(({ id, code, name, path, depth }) => ({ id, code, name, path, depth }))))
      .catch(() => setGroups([]));
    patientService.listDoctors(clinicId).then(setDoctors).catch(() => setDoctors([]));
  }, [clinicId]);

  useEffect(() => {
    const handle = setTimeout(() => {
      // with a group filter active, list even without a search term
      if (search.trim().length < 2 && !groupFilter) { setOptions([]); return; }
      chargeService
        .listServices(clinicId, search.trim().length >= 2 ? search : undefined, groupFilter || undefined)
        .then(setOptions)
        .catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [clinicId, search, groupFilter]);

  const pickService = async (svc: ServiceOption) => {
    setSelected(svc);
    setOptions([]);
    setSearch(`${svc.service_code} — ${svc.name}`);
    // doctor work defaults to the admitting doctor; free to change
    setPerformedById(isDoctorWork(svc) ? admission.admitting_doctor_id : '');
    try {
      const resolved = await chargeService.resolveRate(
        svc.id,
        admission.tariff_plan_id,
        admission.current_bed?.bed_type_id ?? null
      );
      setRate(String(resolved));
    } catch {
      setRate(String(svc.base_price));
    }
  };

  const post = async () => {
    if (!selected) return;
    if (needsDoctor && !performedById) {
      toast.error('Select the performing doctor for this service');
      return;
    }
    setPosting(true);
    try {
      await chargeService.postCharge({
        clinicId,
        admissionId: admission.id,
        serviceId: selected.id,
        quantity: Number(qty) || 1,
        unitRate: Number(rate) || 0,
        performingDoctorId: performedById || undefined,
        userId,
      });
      toast.success('Charge posted');
      setSelected(null); setSearch(''); setQty('1'); setRate(''); setPerformedById('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      {admission.status === 'admitted' && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center relative">
          {/* Charge code (group) filter — pick a group to browse, or search across all */}
          <select
            value={groupFilter}
            onChange={(e) => { setGroupFilter(e.target.value); setSelected(null); }}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm max-w-52"
            title="Charge code"
          >
            <option value="">All charge codes</option>
            {groups.map((g) => (
              <option key={g.id} value={g.path}>
                {' '.repeat((g.depth - 1) * 3)}{g.code} — {g.name}
              </option>
            ))}
          </select>
          <div className="relative flex-1 min-w-56">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              placeholder={groupFilter ? 'Browse or type to filter…' : 'Search service code or name…'}
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
            />
            {options.length > 0 && !selected && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-56 overflow-auto">
                {options.map((s) => (
                  <li key={s.id} onClick={() => pickService(s)}
                    className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer flex justify-between gap-2">
                    <span>
                      <span className="font-mono text-xs text-navy-700 bg-slate-100 rounded px-1 py-0.5 mr-1.5">{s.service_code}</span>
                      {s.name}
                    </span>
                    <span className="text-slate-400 whitespace-nowrap">
                      <span className="text-xs mr-2">{s.charge_group?.path}</span>₹{s.base_price}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" title="Qty" />
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)}
            className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" title="Rate" placeholder="Rate" />
          <select
            value={performedById}
            onChange={(e) => setPerformedById(e.target.value)}
            title="Performed by (surgeon / consulting doctor)"
            className={`max-w-44 border rounded-lg px-2 py-1.5 text-sm ${
              needsDoctor && !performedById ? 'border-red-400 text-red-600' : 'border-slate-300'
            }`}
          >
            <option value="">{needsDoctor ? 'Performed by *' : 'Performed by…'}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>Dr. {d.name?.replace(/^dr\.?\s*/i, '')}</option>
            ))}
          </select>
          <button onClick={post} disabled={!selected || posting}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
            <FilePlus className="w-4 h-4" /> Post
          </button>
          <AiChargeCapture
            clinicId={clinicId}
            admission={admission}
            doctors={doctors}
            userId={userId}
            onChange={onChange}
          />
        </div>
      )}

      <GroupedPostings
        postings={postings}
        activeAssignmentId={activeAssignmentId}
        onCreateDoc={async (posting) => {
          try {
            const doc = await documentService.createFromTemplate({
              clinicId,
              admission,
              templateId: posting.service!.document_template_id!,
              chargePostingId: posting.id,
              userId,
            });
            toast.success(`Draft ${doc.doc_type.replace(/_/g, ' ')} created — open the Documents tab to complete and sign it.`, { duration: 6000 });
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onDiscount={async (posting) => {
          const raw = prompt(
            `Discount for "${posting.service?.name ?? 'item'}" (gross ₹${posting.gross_amount.toFixed(2)}, current discount ₹${posting.discount_amount.toFixed(2)}).\nEnter discount amount in ₹:`
          );
          if (raw === null) return;
          const amt = Number(raw);
          if (!Number.isFinite(amt)) { toast.error('Invalid amount'); return; }
          try {
            await chargeService.applyDiscount({ posting, discountAmount: amt, approvedBy: userId! });
            if (posting.package_assignment_id) {
              await chargeService.recomputePackageConsumption(posting.package_assignment_id);
            }
            toast.success(amt > 0 ? `Discount ₹${amt.toFixed(2)} applied` : 'Discount removed');
            onChange();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
        onToggle={async (posting, include) => {
          try {
            await chargeService.setPackageInclusion(
              posting.id,
              include ? activeAssignmentId : null
            );
            if (activeAssignmentId) {
              await chargeService.recomputePackageConsumption(activeAssignmentId);
            }
            toast.success(include ? 'Moved into package' : 'Moved to patient-payable');
            onChange();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

/** Attach a package to an already-admitted patient (price auto-fills by bed class).
    Coverage applies to charges posted AFTER assignment — earlier charges stay payable. */
function AssignPackageBar({
  clinicId, admission, userId, onAssigned,
}: {
  clinicId: string; admission: Admission; userId?: string; onAssigned: () => void;
}) {
  const [packages, setPackages] = useState<Array<{ id: string; name: string; package_price: number }>>([]);
  const [packageId, setPackageId] = useState('');
  const [agreedPrice, setAgreedPrice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    packageService.listPackages(clinicId).then(setPackages).catch(() => setPackages([]));
  }, [clinicId]);

  useEffect(() => {
    if (!packageId) { setAgreedPrice(''); return; }
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    packageService
      .getPriceForClass(pkg as never, admission.current_bed?.bed_type_id ?? null, admission.payer_id)
      .then((price) => setAgreedPrice(String(price)))
      .catch(() => setAgreedPrice(String(pkg.package_price)));
  }, [packageId, packages, admission.current_bed?.bed_type_id, admission.payer_id]);

  const assign = async () => {
    if (!packageId) return;
    setSaving(true);
    try {
      await packageService.assignPackage({
        clinicId,
        admissionId: admission.id,
        packageId,
        agreedPrice: Number(agreedPrice) || 0,
        userId,
      });
      onAssigned();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (packages.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-3 mb-3 flex flex-wrap gap-2 items-center">
      <span className="text-sm text-slate-500">📦 No package —</span>
      <select
        value={packageId}
        onChange={(e) => setPackageId(e.target.value)}
        className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
      >
        <option value="">assign one…</option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — ₹{p.package_price.toLocaleString('en-IN')}
          </option>
        ))}
      </select>
      {packageId && (
        <>
          <input
            type="number"
            value={agreedPrice}
            onChange={(e) => setAgreedPrice(e.target.value)}
            title="Agreed price"
            className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
          />
          <button
            onClick={assign}
            disabled={saving}
            className="bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm rounded-lg px-3 py-1.5"
          >
            {saving ? 'Assigning…' : 'Assign'}
          </button>
          <span className="text-xs text-slate-400">covers charges posted from now on</span>
        </>
      )}
    </div>
  );
}

/** Package monitor: agreed price vs itemized consumption, overrun alert (concept file §B/§10) */
function PackageMonitor({
  assignment, onConverted,
}: {
  assignment: AdmissionPackage; onConverted: () => void;
}) {
  const pct = assignment.agreed_price > 0
    ? Math.min((assignment.consumed_amount / assignment.agreed_price) * 100, 100)
    : 0;
  const overrun = assignment.overrun_amount > 0;

  const [reapplying, setReapplying] = useState(false);

  const convert = async () => {
    if (!confirm('Convert to itemized billing? Covered charges become payable individually and package price no longer applies.')) return;
    try {
      await packageService.convertToItemized(assignment.id);
      onConverted();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const reapply = async () => {
    setReapplying(true);
    try {
      const changed = await chargeService.reapplyCoverage(assignment.admission_id);
      toast.success(`Rules re-applied — ${changed} unbilled charge(s) updated`);
      onConverted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReapplying(false);
    }
  };

  return (
    <div className={`rounded-xl border p-4 mb-3 ${overrun ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-slate-800">
          📦 {assignment.package?.name}
          <span className="ml-2 text-xs text-slate-400 uppercase">{assignment.status.replace(/_/g, ' ')}</span>
        </p>
        {overrun && (
          <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
            ⚠ OVERRUN ₹{assignment.overrun_amount.toFixed(2)} — negative margin risk
          </span>
        )}
        {assignment.status === 'active' && (
          <span className="flex gap-1.5">
            <button
              onClick={reapply}
              disabled={reapplying}
              title="Re-run inclusion/exclusion rules on all unbilled charges"
              className="text-xs text-navy-700 border border-navy-300 rounded-lg px-2 py-1 hover:bg-navy-50 disabled:opacity-50"
            >
              {reapplying ? 'Re-applying…' : '↻ Re-evaluate rules'}
            </button>
            <button onClick={convert} className="text-xs text-slate-500 border border-slate-300 rounded-lg px-2 py-1 hover:bg-slate-50">
              Convert to itemized
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <div className="flex-1">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${overrun ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <span className="text-slate-600 whitespace-nowrap">
          consumed <b>₹{assignment.consumed_amount.toLocaleString('en-IN')}</b> / agreed{' '}
          <b>₹{assignment.agreed_price.toLocaleString('en-IN')}</b>
        </span>
      </div>
    </div>
  );
}

/** Running charges grouped by top-level charge code (INV, PROC, BED …) with subtotals */
function GroupedPostings({
  postings, activeAssignmentId, onToggle, onDiscount, onCreateDoc,
}: {
  postings: ChargePosting[];
  activeAssignmentId?: string | null;
  onToggle?: (posting: ChargePosting, include: boolean) => void;
  onDiscount?: (posting: ChargePosting) => void;
  onCreateDoc?: (posting: ChargePosting) => void;
}) {
  const { isAdmin } = useAuth();
  const grouped = new Map<string, ChargePosting[]>();
  for (const p of postings) {
    const chargeCode = p.charge_group_path.split('/')[0] || 'OTHER';
    if (!grouped.has(chargeCode)) grouped.set(chargeCode, []);
    grouped.get(chargeCode)!.push(p);
  }
  const sections = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  // covered-by-package lines are settled by the package price, not payable itemized
  const grandTotal = postings
    .filter((p) => p.status !== 'cancelled' && !p.covered_by_package)
    .reduce((s, p) => s + p.net_amount, 0);

  if (postings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-400">
        No charges posted yet
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Code</th>
            <th className="px-4 py-2">Service</th>
            <th className="px-4 py-2 text-right">Qty</th>
            <th className="px-4 py-2 text-right">Rate</th>
            <th className="px-4 py-2 text-right">Net</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(([chargeCode, rows]) => {
            const subtotal = rows
              .filter((p) => p.status !== 'cancelled' && !p.covered_by_package)
              .reduce((s, p) => s + p.net_amount, 0);
            return (
              <Fragment key={chargeCode}>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <td colSpan={7} className="px-4 py-1.5 text-xs font-semibold text-navy-700 uppercase tracking-wide">
                    {chargeCode}
                  </td>
                </tr>
                {rows.map((p) => (
                  <tr key={p.id} className={`border-b border-slate-100 ${p.status === 'cancelled' ? 'opacity-40 line-through' : ''}`}>
                    <td className="px-4 py-2">{format(new Date(p.service_date), 'dd MMM')}</td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-slate-500">{p.service?.service_code ?? ''}</span>
                    </td>
                    <td className="px-4 py-2">
                      {p.description ?? p.service?.name ?? p.service_id}
                      {onCreateDoc && p.service?.document_template_id && p.status !== 'cancelled' && (
                        <button
                          onClick={() => onCreateDoc(p)}
                          title="Create the linked document (consent / OT note) for this service"
                          className="ml-1.5 text-[10px] border border-navy-300 text-navy-700 rounded px-1.5 py-0.5 hover:bg-navy-50 align-middle"
                        >
                          📄 doc
                        </button>
                      )}
                      <span className="block text-xs text-slate-400">
                        {p.charge_group_path}
                        {p.performing_doctor?.name && (
                          <span className="ml-1.5 text-navy-700">
                            · Dr. {p.performing_doctor.name.replace(/^dr\.?\s*/i, '')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{p.quantity}</td>
                    <td className="px-4 py-2 text-right">₹{p.unit_rate.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      ₹{p.net_amount.toFixed(2)}
                      {p.covered_by_package && (
                        <span className="ml-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 rounded px-1 py-0.5 align-middle">
                          PKG
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 capitalize whitespace-nowrap">
                      {p.status}
                      {isAdmin && onDiscount && p.status === 'pending' && (
                        <button
                          onClick={() => onDiscount(p)}
                          title={p.discount_amount > 0 ? `Discount ₹${p.discount_amount} — click to change` : 'Give discount (admin)'}
                          className={`ml-1.5 text-[10px] rounded px-1.5 py-0.5 border ${
                            p.discount_amount > 0
                              ? 'border-violet-400 text-violet-700 bg-violet-50'
                              : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                          }`}
                        >
                          {p.discount_amount > 0 ? `−₹${p.discount_amount}` : '% disc'}
                        </button>
                      )}
                      {activeAssignmentId && onToggle && p.status === 'pending' && (
                        <button
                          onClick={() => onToggle(p, !p.covered_by_package)}
                          title={p.covered_by_package ? 'Remove from package (patient pays)' : 'Move into package'}
                          className={`ml-1.5 text-[10px] rounded px-1.5 py-0.5 border ${
                            p.covered_by_package
                              ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                              : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {p.covered_by_package ? '→ payable' : '→ package'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-slate-200">
                  <td colSpan={5} className="px-4 py-1.5 text-right text-xs text-slate-500">
                    {chargeCode} subtotal
                  </td>
                  <td className="px-4 py-1.5 text-right text-sm font-semibold text-slate-700">
                    ₹{subtotal.toFixed(2)}
                  </td>
                  <td />
                </tr>
              </Fragment>
            );
          })}
          <tr className="bg-slate-50">
            <td colSpan={5} className="px-4 py-2 text-right text-sm font-medium text-slate-600">
              Total (payable, excl. package-covered)
            </td>
            <td className="px-4 py-2 text-right text-base font-bold text-navy-700">₹{grandTotal.toFixed(2)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DepositsTab({
  clinicId, admission, deposits, pendingDue, userId, onChange,
}: {
  clinicId: string; admission: Admission; deposits: Deposit[];
  pendingDue: number; userId?: string; onChange: () => void;
}) {
  const admissionId = admission.id;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  // available = deposits − refunds − applied-to-bills
  const available = deposits.reduce(
    (s, d) => s + (d.entry_type === 'deposit' ? d.amount : -d.amount), 0
  );

  const collect = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      await billingService.collectDeposit({
        clinicId, admissionId, amount: amt, paymentMethod: method, userId,
      });
      toast.success('Deposit collected');
      setAmount('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const refund = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    if (amt > available) {
      toast.error(`Only ₹${available.toFixed(2)} available to refund`);
      return;
    }
    if (!confirm(`Refund ₹${amt.toFixed(2)} to the patient by ${method.replace('_', ' ')}?`)) return;
    setSaving(true);
    try {
      await billingService.refundDeposit({
        clinicId, admissionId, amount: amt, paymentMethod: method, userId,
      });
      toast.success('Deposit refunded');
      setAmount('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500 mr-2">
          Available: <b className="text-emerald-700">₹{available.toFixed(2)}</b>
        </span>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount ₹" className="w-32 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        {pendingDue > 0 && (
          <button
            onClick={() => setAmount(pendingDue.toFixed(2))}
            title="Autofill with the patient's current pending amount"
            className="text-xs border border-amber-300 text-amber-700 rounded-lg px-2 py-1.5 hover:bg-amber-50"
          >
            Fill due ₹{pendingDue.toLocaleString('en-IN')}
          </button>
        )}
        <select value={method} onChange={(e) => setMethod(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          {['cash', 'card', 'upi', 'cheque', 'net_banking'].map((m) => (
            <option key={m} value={m}>{m.replace('_', ' ')}</option>
          ))}
        </select>
        <button onClick={collect} disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg">
          Collect deposit
        </button>
        <button onClick={refund} disabled={saving || available <= 0}
          className="border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 text-sm px-4 py-1.5 rounded-lg">
          Refund to patient
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2">Receipt #</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Received</th>
              <th className="px-4 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d) => (
              <tr key={d.id} className="border-b border-slate-100">
                <td className="px-4 py-2">{d.receipt_number}</td>
                <td className="px-4 py-2 capitalize">{d.entry_type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-2">{d.payment_method ?? '—'}</td>
                <td className="px-4 py-2 text-right font-medium">₹{d.amount.toFixed(2)}</td>
                <td className="px-4 py-2">{format(new Date(d.received_at), 'dd MMM, HH:mm')}</td>
                <td className="px-4 py-2">
                  {d.entry_type !== 'applied_to_bill' && (
                    <button
                      onClick={() =>
                        documentService.printDepositReceipt({
                          deposit: d, admission, clinicName: 'MediTrust Clinics',
                        })
                      }
                      title="Print receipt"
                      className="p-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {deposits.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No deposits collected yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BillingTab({
  clinicId, admission, bills, pendingCount, unbilledPackage, userId, onChange,
}: {
  clinicId: string; admission: Admission; bills: IpdBill[];
  pendingCount: number;
  unbilledPackage: { name: string; agreed: number } | null;
  userId?: string; onChange: () => void;
}) {
  const admissionId = admission.id;
  const nothingToBill = pendingCount === 0 && !unbilledPackage;
  const hasFinal = bills.some((b) => b.bill_type === 'final' && b.status !== 'cancelled');
  const [generating, setGenerating] = useState(false);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [payBillId, setPayBillId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');

  const markFinal = async (billId: string) => {
    if (!confirm('Mark this bill as the FINAL bill for the admission?')) return;
    try {
      await billingService.markAsFinal(billId);
      toast.success('Bill marked as final');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const generate = async (type: 'interim' | 'final' | 'supplementary') => {
    setGenerating(true);
    try {
      await billingService.generateBill(admissionId, type, userId);
      toast.success(`${type} bill generated`);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const recordPayment = async () => {
    const amt = Number(payAmount);
    if (!payBillId || !amt || amt <= 0) return;
    try {
      const payment = await billingService.recordPayment({
        clinicId, billId: payBillId, amount: amt,
        payerKind: 'patient', paymentMethod: payMethod, userId,
      });
      toast.success('Payment recorded — printing receipt');
      // receipt prints immediately with the receipt number just issued
      const bill = bills.find((b) => b.id === payBillId);
      if (bill) {
        documentService.printPaymentReceipt({
          payment, bill, admission, clinicName: 'MediTrust Clinics',
        });
      }
      setPayAmount('');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-slate-500">
          {pendingCount} unbilled charge(s)
          {unbilledPackage && (
            <span className="ml-2 text-navy-700 font-medium">
              + 📦 {unbilledPackage.name} ₹{unbilledPackage.agreed.toLocaleString('en-IN')} (added to the next bill)
            </span>
          )}
        </span>
        <button onClick={() => generate('interim')} disabled={generating || nothingToBill}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
          <ReceiptText className="w-4 h-4" /> Interim bill
        </button>
        {!hasFinal ? (
          <button onClick={() => generate('final')} disabled={generating || nothingToBill}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
            <ReceiptText className="w-4 h-4" /> Final bill
          </button>
        ) : (
          <button onClick={() => generate('supplementary')} disabled={generating || nothingToBill}
            title="For charges that arrived after the final bill"
            className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg">
            <ReceiptText className="w-4 h-4" /> Supplementary bill
          </button>
        )}
      </div>

      {bills.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 flex flex-wrap gap-2 items-center">
          <select value={payBillId} onChange={(e) => setPayBillId(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">Pay against bill…</option>
            {bills.filter((b) => b.status !== 'cancelled' && b.balance_amount > 0).map((b) => (
              <option key={b.id} value={b.id}>
                {b.bill_number} — bal ₹{b.balance_amount.toFixed(0)}
              </option>
            ))}
          </select>
          <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
            placeholder="Amount ₹" className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            {['cash', 'card', 'upi', 'cheque', 'net_banking'].map((m) => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>
          <button onClick={recordPayment}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-1.5 rounded-lg">
            Record payment
          </button>
        </div>
      )}

      <div className="space-y-3">
        {bills.map((b) => (
          <div key={b.id} className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2 mb-2">
              <span className="font-medium text-slate-800">
                {b.bill_number}
                <span className="ml-2 text-xs uppercase bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                  {b.bill_type}
                </span>
                <span className={`ml-1 text-xs uppercase px-2 py-0.5 rounded ${
                  b.status === 'settled' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {b.status.replace('_', ' ')}
                </span>
              </span>
              <span className="flex items-center gap-2 text-slate-500">
                {format(new Date(b.bill_datetime), 'dd MMM yyyy, HH:mm')}
                {b.bill_type === 'interim' && !hasFinal && b.status !== 'cancelled' && (
                  <button
                    onClick={() => markFinal(b.id)}
                    title="Relabel this bill as the FINAL bill"
                    className="text-[10px] font-semibold border border-slate-300 text-slate-600 rounded px-1.5 py-0.5 hover:bg-slate-50"
                  >
                    Mark final
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (b.pdf_url) { window.open(b.pdf_url, '_blank', 'noopener'); return; }
                    setPdfBusyId(b.id);
                    try {
                      const url = await documentService.generateBillPdf({
                        bill: b, admission, clinicId,
                      });
                      window.open(url, '_blank', 'noopener');
                      toast.success('Bill PDF generated — permanent copy saving');
                      setTimeout(onChange, 8000);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setPdfBusyId(null);
                    }
                  }}
                  disabled={pdfBusyId === b.id}
                  title="Bill PDF (letterhead from clinic settings)"
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <FileDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    documentService.printBill({ bill: b, admission, clinicName: 'MediTrust Clinics' })
                  }
                  title="Quick browser print"
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <Printer className="w-4 h-4" />
                </button>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-slate-500">
              <span>Gross <b className="block text-sm text-slate-800">₹{b.gross_total.toFixed(2)}</b></span>
              <span>Discount <b className="block text-sm text-slate-800">₹{b.discount_total.toFixed(2)}</b></span>
              <span>Net <b className="block text-sm text-slate-800">₹{b.net_total.toFixed(2)}</b></span>
              <span>Deposits applied <b className="block text-sm text-emerald-700">₹{b.deposits_applied.toFixed(2)}</b></span>
              <span>Balance <b className="block text-sm text-red-600">₹{b.balance_amount.toFixed(2)}</b></span>
            </div>
            {b.lines && b.lines.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-blue-600 cursor-pointer">{b.lines.length} line(s)</summary>
                <table className="w-full text-xs mt-2">
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-1">{l.description}</td>
                        <td className="text-right">{l.quantity} × ₹{l.unit_rate.toFixed(2)}</td>
                        <td className="text-right font-medium">₹{l.net.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        ))}
        {bills.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
            No bills yet — post charges, then generate an interim or final bill.
          </div>
        )}
      </div>
    </div>
  );
}
