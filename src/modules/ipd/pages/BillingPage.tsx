import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { ReceiptText, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { billingService, BillingOverviewRow } from '../services/billingService';
import { ipdWhatsappService } from '../services/whatsappService';
import CollectionsTab from '../components/Billing/CollectionsTab';

export default function BillingPage() {
  const { clinicId, profile, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'admissions' | 'collections'>('admissions');
  const canSeeCollections = hasPermission('ipd_collections');
  const [rows, setRows] = useState<BillingOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const sendBillSummary = async (r: BillingOverviewRow) => {
    if (!clinicId || !profile?.id || !r.patientPhone) return;
    setSendingId(r.admissionId);
    try {
      await ipdWhatsappService.sendBillSummary({
        clinicId,
        userId: profile.id,
        admissionId: r.admissionId,
        admissionNumber: r.admissionNumber,
        patientId: r.patientId,
        patientName: r.patientName,
        phone: r.patientPhone,
        unbilledCharges: r.unbilledCharges,
        depositsHeld: r.depositsHeld,
        billBalance: r.billBalance,
      });
      toast.success(`Bill summary sent to ${r.patientName} on WhatsApp`);
    } catch (e) {
      toast.error(`WhatsApp send failed: ${(e as Error).message}`);
    } finally {
      setSendingId(null);
    }
  };

  useEffect(() => {
    if (!clinicId) return;
    billingService
      .getBillingOverview(clinicId)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clinicId]);

  const totals = rows.reduce(
    (t, r) => ({
      unbilled: t.unbilled + r.unbilledCharges,
      deposits: t.deposits + r.depositsHeld,
      balance: t.balance + r.billBalance,
    }),
    { unbilled: 0, deposits: 0, balance: 0 }
  );

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-4">
        IPD Billing
        {!loading && tab === 'admissions' && (
          <span className="ml-2 text-sm font-normal text-slate-500">{rows.length} admitted</span>
        )}
      </h1>

      <div className="flex gap-1 mb-4">
        {(['admissions', ...(canSeeCollections ? (['collections'] as const) : [])] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm ${
              tab === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {t === 'admissions' ? 'Admissions' : 'Daily Collections'}
          </button>
        ))}
      </div>

      {tab === 'collections' && canSeeCollections ? (
        <CollectionsTab />
      ) : (
        <>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* Day summary */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4 max-w-2xl">
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-400">Unbilled charges</p>
            <p className="text-lg font-bold text-slate-800">₹{totals.unbilled.toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-400">Deposits held</p>
            <p className="text-lg font-bold text-emerald-700">₹{totals.deposits.toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-400">Outstanding on bills</p>
            <p className="text-lg font-bold text-red-600">₹{totals.balance.toLocaleString('en-IN')}</p>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No active admissions.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Admission</th>
                <th className="px-4 py-3">Bed</th>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3 text-right">Unbilled ₹</th>
                <th className="px-4 py-3 text-right">In package ₹</th>
                <th className="px-4 py-3 text-right">Deposits ₹</th>
                <th className="px-4 py-3 text-right">Bill balance ₹</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.admissionId}
                  onClick={() => navigate(`/ipd/admissions/${r.admissionId}?tab=billing`)}
                  className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer"
                  title="Open billing for this patient"
                >
                  <td className="px-4 py-3 font-medium text-blue-700 underline decoration-blue-200">{r.patientName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.doctorName}</td>
                  <td className="px-4 py-3">
                    {r.admissionNumber}
                    <span className="block text-xs text-slate-400">
                      since {format(new Date(r.admissionDate), 'dd MMM')}
                    </span>
                  </td>
                  <td className="px-4 py-3">{r.bedLabel}</td>
                  <td className="px-4 py-3">
                    {r.packageName ? (
                      <span className="inline-flex flex-col">
                        <span className="text-xs font-medium text-navy-700">📦 {r.packageName}</span>
                        <span className="text-xs text-slate-400">₹{(r.packageAgreed ?? 0).toLocaleString('en-IN')}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">itemized</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ₹{r.unbilledCharges.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-700">
                    {r.packageCovered > 0 ? `₹${r.packageCovered.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-700">
                    ₹{r.depositsHeld.toLocaleString('en-IN')}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${r.billBalance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    ₹{r.billBalance.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-xs bg-blue-600 text-white rounded-lg px-2.5 py-1.5">
                        <ReceiptText className="w-3.5 h-3.5" /> Billing
                      </span>
                      {r.patientPhone && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void sendBillSummary(r);
                          }}
                          disabled={sendingId === r.admissionId}
                          title={`Send bill summary on WhatsApp (${r.patientPhone})`}
                          className="inline-flex items-center gap-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg px-2.5 py-1.5"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          {sendingId === r.admissionId ? 'Sending…' : 'WhatsApp'}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
