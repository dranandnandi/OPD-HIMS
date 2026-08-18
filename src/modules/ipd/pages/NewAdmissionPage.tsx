import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { Search, Printer, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { patientService } from '../services/patientService';
import { patientService as opdPatientService } from '../../../services/patientService';
import PatientModal from '../../../components/Patients/PatientModal';
import { bedService } from '../services/bedService';
import { masterService } from '../services/masterService';
import { admissionService } from '../services/admissionService';
import { billingService } from '../services/billingService';
import { packageService, HospitalPackage } from '../services/packageService';
import { printAdmissionLabels } from '../utils/labelGenerator';
import { ipdWhatsappService } from '../services/whatsappService';
import type { Patient, Profile, Bed, Payer, TariffPlan, AdmissionType } from '../types/ipd';

export default function NewAdmissionPage() {
  const { clinicId, profile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // masters
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [plans, setPlans] = useState<TariffPlan[]>([]);
  const [packages, setPackages] = useState<HospitalPackage[]>([]);
  const [packageId, setPackageId] = useState('');
  const [agreedPrice, setAgreedPrice] = useState('');

  // patient search
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [showNewPatient, setShowNewPatient] = useState(false);

  // form
  const [doctorId, setDoctorId] = useState('');
  const [bedId, setBedId] = useState('');
  const [admissionType, setAdmissionType] = useState<AdmissionType>('planned');
  const [payerId, setPayerId] = useState('');
  const [tariffPlanId, setTariffPlanId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [reason, setReason] = useState('');
  const [attendantName, setAttendantName] = useState('');
  const [attendantPhone, setAttendantPhone] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('cash');
  const [printLabels, setPrintLabels] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const sourceVisitId = params.get('visit_id') ?? undefined;

  useEffect(() => {
    if (!clinicId) return;
    Promise.all([
      patientService.listDoctors(clinicId),
      bedService.listBeds(clinicId),
      masterService.listPayers(clinicId),
      masterService.listTariffPlans(clinicId),
      packageService.listPackages(clinicId),
    ])
      .then(([d, b, p, tp, pk]) => {
        setDoctors(d);
        setBeds(b.filter((x) => x.status === 'available'));
        setPayers(p);
        setPlans(tp);
        setPackages(pk);
      })
      .catch((e) => toast.error(e.message));

    // deep link from OPD app: ?patient_id=...&doctor_id=...
    const pid = params.get('patient_id');
    if (pid) {
      supabase
        .from('patients')
        .select('id, clinic_id, name, phone, age, gender, address, blood_group, allergies, abha_number')
        .eq('id', pid)
        .maybeSingle()
        .then(({ data }) => data && setPatient(data as Patient));
    }
    const did = params.get('doctor_id');
    if (did) setDoctorId(did);
  }, [clinicId, params]);

  useEffect(() => {
    if (!clinicId || patient) return;
    const handle = setTimeout(() => {
      patientService.search(clinicId, searchTerm).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [clinicId, searchTerm, patient]);

  // class-wise package price: refresh agreed price when package or bed changes
  useEffect(() => {
    if (!packageId) return;
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) return;
    const bed = beds.find((b) => b.id === bedId);
    packageService
      .getPriceForClass(pkg, bed?.bed_type_id ?? null, payerId || null)
      .then((price) => setAgreedPrice(String(price)))
      .catch(() => setAgreedPrice(String(pkg.package_price)));
  }, [packageId, bedId, payerId, packages, beds]);

  const bedsByWard = useMemo(() => {
    const map = new Map<string, Bed[]>();
    for (const b of beds) {
      const w = b.ward?.name ?? 'Ward';
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(b);
    }
    return [...map.entries()];
  }, [beds]);

  // payer-exclusive packages (ABPMJAY HBP etc.) show only for their payer
  const visiblePackages = useMemo(
    () => packages.filter((p) => !p.exclusive_payer_id || p.exclusive_payer_id === payerId),
    [packages, payerId]
  );

  const handlePayerChange = (newPayerId: string) => {
    setPayerId(newPayerId);
    // auto-pick the payer's rate plan (still overridable in the tariff box)
    const payerPlan = plans.find((pl) => pl.payer_id === newPayerId);
    setTariffPlanId(newPayerId && payerPlan ? payerPlan.id : '');
    // drop a selected package that is exclusive to a different payer
    const pkg = packages.find((p) => p.id === packageId);
    if (pkg?.exclusive_payer_id && pkg.exclusive_payer_id !== newPayerId) {
      setPackageId('');
      setAgreedPrice('');
    }
  };

  // Walk-in / emergency arrivals are often not registered in OPD yet. Register
  // them through the same OPD service the front desk uses so patient numbering,
  // duplicate checks and the registration WhatsApp behave identically, then
  // select the new patient straight into this admission form.
  const handleCreatePatient = async (data: {
    name: string;
    phone: string;
    age: number;
    date_of_birth?: string | null;
    gender: 'male' | 'female' | 'other';
    address: string;
    emergency_contact?: string;
    blood_group?: string;
    allergies?: string[];
    referred_by?: string;
  }) => {
    const created = await opdPatientService.addPatient(data);
    setPatient({
      id: created.id,
      clinic_id: clinicId ?? null,
      name: created.name,
      phone: created.phone,
      age: created.age ?? null,
      gender: created.gender ?? null,
      address: created.address ?? null,
      blood_group: created.blood_group ?? null,
      allergies: created.allergies ?? null,
      abha_number: created.abha_number ?? null,
    });
    setResults([]);
    setSearchTerm('');
    setShowNewPatient(false);
    toast.success(`${created.name} registered`);
  };

  const handleSubmit = async () => {
    if (!clinicId || !patient || !doctorId || !bedId) {
      toast.error('Patient, doctor and bed are required');
      return;
    }
    setSubmitting(true);
    try {
      const admission = await admissionService.create({
        clinicId,
        patientId: patient.id,
        admittingDoctorId: doctorId,
        bedId,
        admissionType,
        provisionalDiagnosis: diagnosis || undefined,
        reasonForAdmission: reason || undefined,
        payerId: payerId || undefined,
        tariffPlanId: tariffPlanId || undefined,
        attendantName: attendantName || undefined,
        attendantPhone: attendantPhone || undefined,
        sourceVisitId,
        userId: profile?.id,
      });

      if (packageId) {
        const pkg = packages.find((p) => p.id === packageId);
        await packageService.assignPackage({
          clinicId,
          admissionId: admission.id,
          packageId,
          agreedPrice: Number(agreedPrice) || pkg?.package_price || 0,
          userId: profile?.id,
        });
      }

      const deposit = Number(depositAmount);
      if (deposit > 0) {
        await billingService.collectDeposit({
          clinicId,
          admissionId: admission.id,
          amount: deposit,
          paymentMethod: depositMethod,
          userId: profile?.id,
        });
      }

      if (printLabels) {
        const bed = beds.find((b) => b.id === bedId);
        await printAdmissionLabels(
          {
            admissionNumber: admission.admission_number,
            patientName: patient.name,
            age: patient.age,
            gender: patient.gender,
            bloodGroup: patient.blood_group,
            allergies: patient.allergies,
            wardBed: bed ? `${bed.ward?.name ?? ''} / ${bed.bed_number}` : undefined,
            admittedOn: format(new Date(), 'dd MMM yy HH:mm'),
            chartUrl: `${window.location.origin}/ipd/admissions/${admission.id}`,
          },
          { copies: 2, includeQr: true }
        );
      }

      toast.success(`Admitted — ${admission.admission_number}`);

      // Admission confirmation on WhatsApp — fire-and-forget so a messaging
      // hiccup never blocks the admission flow.
      if (patient.phone && clinicId && profile?.id) {
        const bed = beds.find((b) => b.id === bedId);
        const doctor = doctors.find((d) => d.id === doctorId);
        ipdWhatsappService
          .sendAdmissionWelcome({
            clinicId,
            userId: profile.id,
            admissionId: admission.id,
            admissionNumber: admission.admission_number,
            patientId: patient.id,
            patientName: patient.name,
            phone: patient.phone,
            bedLabel: bed ? `${bed.ward?.name ?? ''} / ${bed.bed_number}` : undefined,
            doctorName: doctor?.name ?? undefined,
          })
          .then(() => toast.success('Admission message sent on WhatsApp'))
          .catch(() => toast('WhatsApp admission message could not be sent', { icon: '⚠️' }));
      }

      navigate(`/ipd/admissions/${admission.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold text-slate-800 mb-4">New Admission</h1>

      {/* Patient */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <h2 className="text-sm font-medium text-slate-700 mb-2">Patient</h2>
        {patient ? (
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium text-slate-800">{patient.name}</p>
              <p className="text-slate-500">
                {patient.phone} · {patient.age ? `${patient.age}y` : ''}{' '}
                {patient.gender ?? ''} {patient.blood_group ? `· ${patient.blood_group}` : ''}
              </p>
              {patient.allergies?.length ? (
                <p className="text-red-600 text-xs mt-1">⚠ Allergies: {patient.allergies.join(', ')}</p>
              ) : null}
            </div>
            <button onClick={() => setPatient(null)} className="text-sm text-blue-600 hover:underline">
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search patient by name or phone (shared with OPD)…"
                className="flex-1 text-sm outline-none"
              />
            </div>
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-56 overflow-auto">
                {results.map((p) => (
                  <li
                    key={p.id}
                    onClick={() => { setPatient(p); setResults([]); }}
                    className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-slate-400 ml-2">{p.phone}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                {searchTerm.trim().length >= 2 && results.length === 0
                  ? 'No matching patient — register a new one.'
                  : 'Not registered yet? Add the patient here.'}
              </p>
              <button
                type="button"
                onClick={() => setShowNewPatient(true)}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" /> Add new patient
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clinical + bed */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="text-slate-600">Admitting doctor *</span>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Select…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.specialization ? ` (${d.specialization})` : ''}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Bed *</span>
          <select value={bedId} onChange={(e) => setBedId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
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
        <label className="text-sm">
          <span className="text-slate-600">Admission type</span>
          <select value={admissionType} onChange={(e) => setAdmissionType(e.target.value as AdmissionType)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
            {['planned', 'emergency', 'transfer_in', 'daycare', 'mlc'].map((t) => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Payer / tariff</span>
          <div className="flex gap-2 mt-1">
            <select value={payerId} onChange={(e) => handlePayerChange(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm">
              <option value="">Cash</option>
              {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={tariffPlanId} onChange={(e) => setTariffPlanId(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm">
              <option value="">Default rates</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Package (optional)</span>
          <div className="flex gap-2 mt-1">
            <select
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-2 py-2 text-sm"
            >
              <option value="">No package — itemized billing</option>
              {visiblePackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{p.package_price.toLocaleString('en-IN')}
                  {p.exclusive_payer_id ? ` (${payers.find((py) => py.id === p.exclusive_payer_id)?.name ?? 'payer'} only)` : ''}
                </option>
              ))}
            </select>
            {packageId && (
              <input
                type="number"
                value={agreedPrice}
                onChange={(e) => setAgreedPrice(e.target.value)}
                title="Agreed price (negotiable)"
                className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            )}
          </div>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Provisional diagnosis</span>
          <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Reason for admission</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Attendant name</span>
          <input value={attendantName} onChange={(e) => setAttendantName(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Attendant phone</span>
          <input value={attendantPhone} onChange={(e) => setAttendantPhone(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
      </div>

      {/* Deposit + labels */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid sm:grid-cols-3 gap-3 items-end">
        <label className="text-sm">
          <span className="text-slate-600">Advance deposit (₹)</span>
          <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="0" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Method</span>
          <select value={depositMethod} onChange={(e) => setDepositMethod(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
            {['cash', 'card', 'upi', 'cheque', 'net_banking'].map((m) => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
          <input type="checkbox" checked={printLabels} onChange={(e) => setPrintLabels(e.target.checked)} />
          <Printer className="w-4 h-4" /> Print wristband + file labels
        </label>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !patient || !doctorId || !bedId}
        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 rounded-lg"
      >
        {submitting ? 'Admitting…' : 'Admit Patient'}
      </button>

      {showNewPatient && (
        <PatientModal
          patient={null}
          clinicId={clinicId ?? undefined}
          onSave={handleCreatePatient}
          onClose={() => setShowNewPatient(false)}
        />
      )}
    </div>
  );
}
