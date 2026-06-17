import React, { useState, useEffect } from 'react';
import { X, Shield, CheckCircle, Smartphone, AlertCircle, Loader2 } from 'lucide-react';
import { abhaService, ABHAProfile } from '../../services/abhaService';

interface ABHALinkModalProps {
  patientId: string;
  patientName: string;
  patientMobile?: string;
  clinicId?: string;
  onLinked: (profile: ABHAProfile) => void;
  onClose: () => void;
}

type Step = 'mobile' | 'otp' | 'consent' | 'success';

function extractProfileFromVerifyRaw(raw: unknown): ABHAProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const abhaProfile = (raw as { ABHAProfile?: Record<string, unknown> }).ABHAProfile;
  if (!abhaProfile) return null;

  const abhaNumber = typeof abhaProfile.ABHANumber === 'string' ? abhaProfile.ABHANumber : '';
  const phrAddressList = Array.isArray(abhaProfile.phrAddress) ? abhaProfile.phrAddress : [];
  const abhaAddress = typeof phrAddressList[0] === 'string' ? phrAddressList[0] : '';
  const firstName = typeof abhaProfile.firstName === 'string' ? abhaProfile.firstName : '';
  const middleName = typeof abhaProfile.middleName === 'string' ? abhaProfile.middleName : '';
  const lastName = typeof abhaProfile.lastName === 'string' ? abhaProfile.lastName : '';
  const name = [firstName, middleName, lastName].filter(Boolean).join(' ');

  if (!abhaNumber) return null;

  return {
    abhaNumber,
    abhaAddress,
    name,
    gender: typeof abhaProfile.gender === 'string' ? abhaProfile.gender : '',
    dob: typeof abhaProfile.dob === 'string' ? abhaProfile.dob : '',
    mobile: typeof abhaProfile.mobile === 'string' ? abhaProfile.mobile : ''
  };
}

const ABHALinkModal: React.FC<ABHALinkModalProps> = ({
  patientId,
  patientName,
  patientMobile = '',
  clinicId,
  onLinked,
  onClose
}) => {
  const [step, setStep] = useState<Step>('mobile');
  const [aadhaar, setAadhaar] = useState('');
  const [otp, setOtp] = useState('');
  const [txnId, setTxnId] = useState('');
  const [profile, setProfile] = useState<ABHAProfile | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleSendOTP = async () => {
    if (!/^\d{12}$/.test(aadhaar)) {
      setError('Please enter a valid 12-digit Aadhaar number.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      setTxnId('');
      setOtp('');
      const id = await abhaService.requestOTP(aadhaar, patientId, clinicId);
      setTxnId(id);
      setStep('otp');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      setTxnId('');
      const id = await abhaService.requestOTP(aadhaar, patientId, clinicId);
      setTxnId(id);
      setOtp('');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    const normalizedPatientMobile = patientMobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^\d{10}$/.test(normalizedPatientMobile)) {
      setError('Patient must have a valid 10-digit mobile number before ABHA verification.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const verifyResult = await abhaService.verifyOTP(
        txnId,
        otp,
        normalizedPatientMobile,
        patientId,
        clinicId
      );
      console.log('[ABHA] Verify OTP raw response:', JSON.stringify(verifyResult._raw));
      const isVerifySuccess =
        verifyResult.authResult === 'success' ||
        Boolean(verifyResult.xToken) ||
        verifyResult.message === 'Account created successfully';
      if (!isVerifySuccess) throw new Error('OTP verification failed');
      if (!verifyResult.xToken) throw new Error('No X-token in verify response — check console for raw response fields');
      const abhaProfile =
        extractProfileFromVerifyRaw(verifyResult._raw) ??
        await abhaService.fetchProfile(verifyResult.xToken, patientId, clinicId);
      setProfile(abhaProfile);
      setStep('consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!consentChecked || !profile) return;
    setError('');
    setLoading(true);
    try {
      await abhaService.linkABHAToPatient(patientId, profile);
      setStep('success');
      onLinked(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link ABHA. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="card max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b mb-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Link ABHA ID</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-6">
          {(['mobile', 'otp', 'consent', 'success'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  step === s
                    ? 'bg-blue-600 text-white'
                    : (['mobile', 'otp', 'consent', 'success'] as Step[]).indexOf(step) > i
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {(['mobile', 'otp', 'consent', 'success'] as Step[]).indexOf(step) > i ? '✓' : i + 1}
              </div>
              {i < 3 && <div className="flex-1 h-0.5 bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step: Aadhaar */}
        {step === 'mobile' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the patient's Aadhaar number. OTP will be sent to the Aadhaar-linked mobile number.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Aadhaar number is encrypted before transmission and never stored. Used only for ABDM verification.
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Aadhaar Number</label>
              <input
                type="password"
                maxLength={12}
                value={aadhaar}
                onChange={(e) => {
                  setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12));
                  setError('');
                }}
                placeholder="12-digit Aadhaar number"
                className="input-field tracking-widest"
                autoComplete="off"
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1">{aadhaar.length}/12 digits entered</p>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={handleSendOTP}
              disabled={loading || aadhaar.length !== 12}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              {loading ? 'Sending OTP...' : 'Send OTP to Aadhaar-linked Mobile'}
            </button>
          </div>
        )}

        {/* Step: OTP */}
        {step === 'otp' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              OTP sent to the mobile number linked with the patient's Aadhaar. Valid for 10 minutes.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Enter OTP</label>
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                placeholder="6-digit OTP"
                className="input-field text-center text-lg tracking-widest"
                autoFocus
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 6 || !txnId}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
            <div className="text-center text-sm text-gray-500">
              {resendCooldown > 0 ? (
                <span>Resend OTP in {resendCooldown}s</span>
              ) : (
                <button
                  onClick={handleResendOTP}
                  disabled={loading}
                  className="text-blue-600 hover:underline"
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step: Consent */}
        {step === 'consent' && profile && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 space-y-1">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">ABHA Profile Found</p>
              <p className="font-semibold text-gray-900">{profile.name || patientName}</p>
              <p className="text-sm text-gray-600">
                ABHA: <span className="font-mono font-medium">{abhaService.formatAbhaNumber(profile.abhaNumber)}</span>
              </p>
              {profile.abhaAddress && (
                <p className="text-sm text-gray-600">Address: {profile.abhaAddress}</p>
              )}
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700">
                I, <strong>{patientName}</strong>, give my explicit consent to link my ABHA ID with{' '}
                this clinic's records as per ABDM guidelines. I understand this will allow the clinic
                to access and update my health records through the ABDM network.
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handleConfirmLink}
              disabled={loading || !consentChecked}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Linking...' : 'Confirm & Link ABHA'}
            </button>
          </div>
        )}

        {/* Step: Success */}
        {step === 'success' && profile && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">ABHA Linked Successfully</h3>
              <p className="text-sm text-gray-600 mt-1">
                {patientName}'s ABHA ID has been linked to their patient record.
              </p>
            </div>
            <div className="bg-green-50 rounded-lg p-4 space-y-1 text-left">
              <p className="text-xs text-green-700 font-medium uppercase tracking-wide">ABHA Details</p>
              <p className="font-mono font-semibold text-gray-900">
                {abhaService.formatAbhaNumber(profile.abhaNumber)}
              </p>
              {profile.abhaAddress && (
                <p className="text-sm text-gray-600">{profile.abhaAddress}</p>
              )}
            </div>
            <button onClick={onClose} className="btn-primary w-full">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ABHALinkModal;
