import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ShieldCheck, FileText, Calendar, User, Stethoscope, Building2 } from 'lucide-react';

interface VerifyData {
  visitId: string;
  date: string;
  patientName: string;
  patientAge: number | null;
  patientGender: string;
  doctorName: string;
  doctorSpecialization: string;
  registrationNo: string;
  clinicName: string;
  pdfUrl: string | null;
  verifiedAt: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const VerifyPrescription: React.FC = () => {
  const [searchParams] = useSearchParams();
  const visitId = searchParams.get('id');

  const [status, setStatus] = useState<'loading' | 'verified' | 'not_found' | 'error'>('loading');
  const [data, setData] = useState<VerifyData | null>(null);

  useEffect(() => {
    if (!visitId) {
      setStatus('not_found');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-prescription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: visitId }),
        });
        const result = await res.json();
        if (result.status === 'verified') {
          setData(result.data);
          setStatus('verified');
        } else if (result.status === 'not_found') {
          setStatus('not_found');
        } else {
          setStatus('error');
        }
      } catch {
        setStatus('error');
      }
    };

    verify();
  }, [visitId]);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

  const formatDoctorName = (name: string) => {
    if (!name) return '';
    const cleaned = name.trim().replace(/^dr\.?\s*/i, '').trim();
    return cleaned ? `Dr. ${cleaned}` : '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-3 shadow-lg">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Prescription Verification</h1>
          <p className="text-sm text-gray-500 mt-1">Powered by Doctorpreneur Academy</p>
        </div>

        {/* Loading */}
        {status === 'loading' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Verifying prescription…</p>
            <p className="text-xs text-gray-400 mt-1">Checking against our secure database</p>
          </div>
        )}

        {/* Verified */}
        {status === 'verified' && data && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {/* Green banner */}
            <div className="bg-green-500 px-6 py-4 flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-white flex-shrink-0" />
              <div>
                <p className="text-white font-bold text-lg">✅ Verified Prescription</p>
                <p className="text-green-100 text-xs">This prescription is authentic and on record</p>
              </div>
            </div>

            {/* Details */}
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Patient</p>
                  <p className="text-gray-800 font-semibold">{data.patientName}</p>
                  <p className="text-gray-500 text-sm">
                    {data.patientAge ? `${data.patientAge} yrs` : ''}
                    {data.patientAge && data.patientGender ? ' · ' : ''}
                    {data.patientGender}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Stethoscope className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Prescribing Doctor</p>
                  <p className="text-gray-800 font-semibold">{formatDoctorName(data.doctorName)}</p>
                  {data.doctorSpecialization && <p className="text-gray-500 text-sm">{data.doctorSpecialization}</p>}
                  {data.registrationNo && <p className="text-gray-400 text-xs">Reg: {data.registrationNo}</p>}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Clinic</p>
                  <p className="text-gray-800 font-semibold">{data.clinicName || 'N/A'}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Visit Date</p>
                  <p className="text-gray-800 font-semibold">{formatDate(data.date)}</p>
                </div>
              </div>

              {data.pdfUrl && (
                <a
                  href={data.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors shadow"
                >
                  <FileText className="w-4 h-4" />
                  View Original Prescription
                </a>
              )}

              <p className="text-center text-xs text-gray-400 mt-2">
                Verified on {new Date(data.verifiedAt).toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        )}

        {/* Not Found */}
        {status === 'not_found' && (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-red-500 px-6 py-4 flex items-center gap-3">
              <XCircle className="w-6 h-6 text-white flex-shrink-0" />
              <div>
                <p className="text-white font-bold text-lg">❌ Not Verified</p>
                <p className="text-red-100 text-xs">This prescription could not be verified</p>
              </div>
            </div>
            <div className="p-6 text-center">
              <p className="text-gray-600">The prescription ID <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{visitId}</code> was not found in our records.</p>
              <p className="text-gray-400 text-sm mt-3">This document may be fraudulent. Please contact the clinic directly to verify.</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <XCircle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <p className="text-gray-700 font-semibold">Verification failed</p>
            <p className="text-gray-400 text-sm mt-1">Please try again or contact the clinic.</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors">
              Retry
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} Doctorpreneur Academy · Secure Prescription Registry
        </p>
      </div>
    </div>
  );
};

export default VerifyPrescription;
