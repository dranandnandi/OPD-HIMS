import React, { useState, useEffect, useCallback } from 'react';
import { X, Shield, CheckCircle, Smartphone, AlertCircle, Loader2, UserCheck } from 'lucide-react';
import {
  abhaService,
  ABHASessionExpiredError,
  type ABHAProfile,
  type ABHAAccountChoice
} from '../../services/abhaService';
import { buildAbhaConsentText } from '../../utils/abhaConsent';
import ABHACardPanel from './ABHACardPanel';

/**
 * Mobile-OTP ABHA verification — spec section 7.4.
 *
 * The primary OPD path: most walk-in patients already have an ABHA and need it
 * verified, not created. No Aadhaar is involved. For patients with no ABHA at
 * all, `onNoAbhaFound` hands off to the Aadhaar creation flow.
 */

interface ABHAVerifyModalProps {
  patientId: string;
  patientName: string;
  patientMobile?: string;
  clinicName?: string;
  onLinked: (profile: ABHAProfile) => void;
  onNoAbhaFound?: () => void;
  onClose: () => void;
}

type Step = 'mobile' | 'otp' | 'select' | 'consent' | 'success';

const STEPS: Step[] = ['mobile', 'otp', 'select', 'consent', 'success'];

const ABHAVerifyModal: React.FC<ABHAVerifyModalProps> = ({
  patientId,
  patientName,
  patientMobile = '',
  clinicName = '',
  onLinked,
  onNoAbhaFound,
  onClose
}) => {
  // Prefill from the patient record — reception has usually already typed it.
  const [mobile, setMobile] = useState(() =>
    patientMobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10)
  );
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('mobile');
  const [sessionId, setSessionId] = useState('');
  const [accounts, setAccounts] = useState<ABHAAccountChoice[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [profile, setProfile] = useState<ABHAProfile | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const consentText = buildAbhaConsentText({ patientName, clinicName });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  /**
   * A consumed or expired server-side session cannot be retried in place —
   * the T-token behind it is gone. Reset all the way to the mobile step so the
   * user is never staring at a dead OTP box.
   */
  const handleFailure = useCallback((err: unknown) => {
    if (err instanceof ABHASessionExpiredError) {
      setSessionId('');
      setOtp('');
      setAccounts([]);
      setSelected('');
      setStep('mobile');
      setError(err.message);
      return;
    }
    setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  }, []);

  const sendOtp = async (isResend: boolean) => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.loginRequestOTP(mobile, patientId);
      setSessionId(res.sessionId);
      setOtp('');
      setStep('otp');
      setResendCooldown(30);
      if (res.message) setNotice(res.message);
      else if (isResend) setNotice('A new OTP has been sent.');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    void sendOtp(false);
  };

  const handleVerifyOTP = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.loginVerifyOTP(sessionId, otp);

      // A verified OTP with no accounts is a real answer, not a failure: this
      // mobile has no ABHA, so the desk should create one instead.
      if (res.accounts.length === 0 || !res.sessionId) {
        setAccounts([]);
        setNotice('No ABHA is registered against this mobile number.');
        setStep('select');
        return;
      }

      setSessionId(res.sessionId);
      setAccounts(res.accounts);

      // Never auto-select when there is a choice: one mobile commonly carries a
      // whole family's ABHAs, and picking for them links the wrong person.
      const active = res.accounts.filter((a) => a.status !== 'DEACTIVATED');
      setSelected(active.length === 1 ? active[0].abhaNumber : '');
      setStep('select');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAccount = async () => {
    if (!selected) return;
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.loginVerifyUser(sessionId, selected);
      setProfile(res.profile);
      // The handle now carries the X-token, which the card/QR step needs.
      setSessionId(res.sessionId);
      setStep('consent');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!consentChecked || !profile) return;
    setError('');
    setLoading(true);
    try {
      await abhaService.linkABHAToPatient({
        patientId,
        profile,
        consentText,
        authMethod: 'mobile-otp'
      });
      setStep('success');
      onLinked(profile);
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b mb-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Verify ABHA</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  step === s
                    ? 'bg-blue-600 text-white'
                    : stepIndex > i
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {stepIndex > i ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 1 — mobile */}
        {step === 'mobile' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the patient's mobile number. An OTP will be sent by ABDM to verify their
              existing ABHA.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Mobile Number</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={mobile}
                onChange={(e) => {
                  setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                  setError('');
                }}
                placeholder="10-digit mobile number"
                className="input-field tracking-widest"
                autoComplete="off"
                autoFocus
              />
            </div>
            <button
              onClick={handleSendOTP}
              disabled={loading || mobile.length !== 10}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </div>
        )}

        {/* Step 2 — OTP */}
        {step === 'otp' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {notice || `OTP sent to the mobile number ending ${mobile.slice(-4)}.`}
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">Enter OTP</label>
              <input
                type="text"
                inputMode="numeric"
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
            <button
              onClick={handleVerifyOTP}
              disabled={loading || otp.length !== 6}
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
                  onClick={() => void sendOtp(true)}
                  disabled={loading}
                  className="text-blue-600 hover:underline"
                >
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3 — account picker */}
        {step === 'select' && (
          <div className="space-y-4">
            {accounts.length === 0 ? (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                  No ABHA is registered against {mobile}. The patient can create one using their
                  Aadhaar.
                </div>
                {onNoAbhaFound && (
                  <button onClick={onNoAbhaFound} className="btn-primary w-full">
                    Create ABHA using Aadhaar
                  </button>
                )}
                <button onClick={onClose} className="btn-secondary w-full">
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  {accounts.length === 1
                    ? 'Confirm this is the correct ABHA.'
                    : `${accounts.length} ABHA accounts are registered on this mobile. Ask the patient which one is theirs.`}
                </p>
                <div className="space-y-2">
                  {accounts.map((account) => {
                    const deactivated = account.status === 'DEACTIVATED';
                    return (
                      <label
                        key={account.abhaNumber}
                        className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                          deactivated
                            ? 'opacity-50 cursor-not-allowed border-gray-200'
                            : selected === account.abhaNumber
                            ? 'border-blue-500 bg-blue-50 cursor-pointer'
                            : 'border-gray-200 hover:border-gray-300 cursor-pointer'
                        }`}
                      >
                        <input
                          type="radio"
                          name="abha-account"
                          className="mt-1 accent-blue-600"
                          checked={selected === account.abhaNumber}
                          disabled={deactivated}
                          onChange={() => {
                            setSelected(account.abhaNumber);
                            setError('');
                          }}
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {account.name || '(name not provided)'}
                          </p>
                          <p className="text-sm font-mono text-gray-600">{account.abhaNumber}</p>
                          <div className="flex flex-wrap gap-x-3 text-xs text-gray-500 mt-0.5">
                            {account.gender && <span>{account.gender}</span>}
                            {account.dob && <span>{account.dob}</span>}
                            {deactivated && (
                              <span className="text-red-600 font-medium">Deactivated</span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <button
                  onClick={handleConfirmAccount}
                  disabled={loading || !selected}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                  {loading ? 'Confirming...' : 'Continue'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4 — consent */}
        {step === 'consent' && profile && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 space-y-1">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">
                ABHA Verified
              </p>
              <p className="font-semibold text-gray-900">{profile.name || patientName}</p>
              <p className="text-sm text-gray-600">
                ABHA:{' '}
                <span className="font-mono font-medium">
                  {abhaService.formatAbhaNumber(profile.abhaNumber)}
                </span>
              </p>
              {profile.abhaAddress && (
                <p className="text-sm text-gray-600">Address: {profile.abhaAddress}</p>
              )}
              {profile.mobileMasked && (
                <p className="text-sm text-gray-600">Mobile: {profile.mobileMasked}</p>
              )}
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0"
              />
              {/* Rendered from the same string sent to the server and stored
                  verbatim on the consent artefact — they cannot drift. */}
              <span className="text-sm text-gray-700">{consentText}</span>
            </label>

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

        {/* Step 5 — done */}
        {step === 'success' && profile && (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">ABHA Linked</h3>
              <p className="text-sm text-gray-600 mt-1">
                {patientName}'s ABHA has been linked to their patient record.
              </p>
            </div>
            <div className="bg-green-50 rounded-lg p-4 space-y-1 text-left">
              <p className="text-xs text-green-700 font-medium uppercase tracking-wide">
                ABHA Details
              </p>
              <p className="font-mono font-semibold text-gray-900">
                {abhaService.formatAbhaNumber(profile.abhaNumber)}
              </p>
              {profile.abhaAddress && (
                <p className="text-sm text-gray-600">{profile.abhaAddress}</p>
              )}
            </div>

            {sessionId && <ABHACardPanel sessionId={sessionId} patientName={patientName} />}

            <button onClick={onClose} className="btn-primary w-full">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ABHAVerifyModal;
