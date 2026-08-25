import React, { useState, useEffect } from 'react';
import { X, Shield, CheckCircle, Smartphone, AlertCircle, Loader2, AtSign } from 'lucide-react';
import { abhaService, ABHASessionExpiredError, type ABHAProfile } from '../../services/abhaService';
import { buildAbhaConsentText } from '../../utils/abhaConsent';
import ABHACardPanel from './ABHACardPanel';

/**
 * ABHA creation via Aadhaar OTP — spec section 3.
 *
 * Use this only for patients who have no ABHA yet; ABHAVerifyModal (mobile OTP)
 * is the primary path for everyone else. Aadhaar is encrypted for ABDM on the
 * server and is never stored, logged, or echoed back — see
 * supabase/functions/abdm-request-otp/index.ts.
 *
 * Enrolment does not end at `enrol/byAadhaar`. Two steps chain off it and both
 * are part of finishing M1:
 *   - §3.4 mobile verification, when the Aadhaar-linked number is not the one
 *     the clinic holds — otherwise `mobile_verified` would be claiming a number
 *     the clinic cannot actually reach.
 *   - §3.6 ABHA address, without which the new account has no handle for the
 *     M2/M3 care-context linking that comes later.
 * Both are skippable: neither should block a patient being seen.
 */

interface ABHALinkModalProps {
  patientId: string;
  patientName: string;
  patientMobile?: string;
  clinicName?: string;
  onLinked: (profile: ABHAProfile) => void;
  onClose: () => void;
}

type Step = 'aadhaar' | 'otp' | 'consent' | 'mobile' | 'address' | 'success';

const last4 = (value: string) => value.replace(/\D/g, '').slice(-4);

const ABHALinkModal: React.FC<ABHALinkModalProps> = ({
  patientId,
  patientName,
  patientMobile = '',
  clinicName = '',
  onLinked,
  onClose
}) => {
  const [step, setStep] = useState<Step>('aadhaar');
  const [aadhaar, setAadhaar] = useState('');
  const [otp, setOtp] = useState('');
  const [txnId, setTxnId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [profile, setProfile] = useState<ABHAProfile | null>(null);
  const [needsAddress, setNeedsAddress] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // §3.4 state
  const clinicMobile = patientMobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10);
  const [altMobile, setAltMobile] = useState(clinicMobile);
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileOtpSent, setMobileOtpSent] = useState(false);

  // §3.6 state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chosenAddress, setChosenAddress] = useState('');
  const [customAddress, setCustomAddress] = useState('');

  const consentText = buildAbhaConsentText({ patientName, clinicName });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleFailure = (err: unknown) => {
    if (err instanceof ABHASessionExpiredError) {
      // The enrolment transaction is gone upstream; there is nothing to resume.
      // The ABHA itself was already created and linked, so send them to the end
      // rather than implying the whole thing failed.
      setError('The enrolment window has closed. The ABHA is linked; remaining steps were skipped.');
      setStep('success');
      return;
    }
    setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  };

  const sendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      setTxnId('');
      setOtp('');
      const id = await abhaService.requestOTP(aadhaar, patientId);
      setTxnId(id);
      setStep('otp');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = () => {
    if (!/^\d{12}$/.test(aadhaar)) {
      setError('Please enter a valid 12-digit Aadhaar number.');
      return;
    }
    void sendOtp();
  };

  const handleVerifyOTP = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    if (!/^\d{10}$/.test(clinicMobile)) {
      setError('Patient must have a valid 10-digit mobile number before ABHA verification.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Returns the normalised profile directly — no X-token, no raw payload.
      const res = await abhaService.verifyOTP(txnId, otp, clinicMobile, patientId);
      setProfile(res.profile);
      setSessionId(res.sessionId);
      setNeedsAddress(res.needsAbhaAddress);
      setStep('consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Where to go once the ABHA is linked, given what is still outstanding. */
  const advanceAfterLink = (linked: ABHAProfile) => {
    const abdmMobile = last4(linked.mobileMasked);
    const mobileDiffers = Boolean(abdmMobile) && Boolean(clinicMobile) && abdmMobile !== last4(clinicMobile);
    if (mobileDiffers) {
      setNotice(
        `ABDM has a mobile ending ${abdmMobile} for this ABHA, but the clinic record ends ${last4(clinicMobile)}.`
      );
      setStep('mobile');
      return;
    }
    if (needsAddress) {
      void loadSuggestions();
      return;
    }
    setStep('success');
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
        authMethod: 'aadhaar-otp'
      });
      onLinked(profile);
      advanceAfterLink(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link ABHA. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── §3.4 mobile verification ───────────────────────────────────────────────

  const handleSendMobileOTP = async () => {
    if (!/^[6-9]\d{9}$/.test(altMobile)) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.enrolMobileRequestOTP(sessionId, altMobile);
      setSessionId(res.sessionId);
      setMobileOtpSent(true);
      setNotice(res.message ?? `OTP sent to the number ending ${last4(altMobile)}.`);
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMobileOTP = async () => {
    if (!/^\d{6}$/.test(mobileOtp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.enrolMobileVerify(sessionId, mobileOtp);
      setSessionId(res.sessionId);
      setNotice('Mobile number verified with ABDM.');
      if (needsAddress) void loadSuggestions();
      else setStep('success');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  // ── §3.6 ABHA address ──────────────────────────────────────────────────────

  const loadSuggestions = async () => {
    setError('');
    setLoading(true);
    setStep('address');
    try {
      const res = await abhaService.addressSuggestions(sessionId);
      setSessionId(res.sessionId);
      setSuggestions(res.suggestions);
      setChosenAddress(res.suggestions[0] ?? '');
    } catch (err) {
      // Suggestions are a convenience — a custom address still works without
      // them, so this degrades rather than blocking the step.
      setSuggestions([]);
      setError(err instanceof ABHASessionExpiredError ? '' : 'Could not load suggestions. You can type an address instead.');
      if (err instanceof ABHASessionExpiredError) handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAddress = async () => {
    const wanted = (customAddress.trim() || chosenAddress).toLowerCase();
    if (!wanted) {
      setError('Choose a suggestion or type an ABHA address.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.createAddress(sessionId, wanted);
      setProfile((p) => (p ? { ...p, abhaAddress: res.abhaAddress } : p));
      setNotice('');
      setStep('success');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  // The visible sequence depends on what this particular enrolment needs.
  const steps: Step[] = [
    'aadhaar',
    'otp',
    'consent',
    ...(step === 'mobile' ? (['mobile'] as Step[]) : []),
    ...(needsAddress ? (['address'] as Step[]) : []),
    'success'
  ];
  const stepIndex = steps.indexOf(step);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="card max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b mb-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Create ABHA (Aadhaar)</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-1 mb-6">
          {steps.map((s, i) => (
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
              {i < steps.length - 1 && <div className="flex-1 h-0.5 bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === 'aadhaar' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the patient's Aadhaar number. OTP will be sent to the Aadhaar-linked mobile
              number.
            </p>
            {/*
              Deliberately literal. Earlier copy claimed the Aadhaar number was
              "encrypted before transmission", which described behaviour the code
              did not have — encryption happens on our server, not in the browser.
            */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              The Aadhaar number is sent over a secure connection to our server, encrypted there for
              ABDM, and never stored or written to logs. It is used only for this verification.
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Aadhaar Number</label>
              <input
                type="password"
                inputMode="numeric"
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

        {step === 'otp' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              OTP sent to the mobile number linked with the patient's Aadhaar. Valid for 10 minutes.
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
                <button onClick={() => void sendOtp()} disabled={loading} className="text-blue-600 hover:underline">
                  Resend OTP
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'consent' && profile && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 space-y-1">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">
                ABHA Profile Found
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
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0"
              />
              {/* Same string sent to the server and stored verbatim on the
                  consent artefact, so display and record cannot drift. */}
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

        {/* §3.4 — verify a mobile that is not the Aadhaar-linked one */}
        {step === 'mobile' && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800">
              {notice} Verifying the clinic's number with ABDM keeps the ABHA reachable on the
              phone the patient actually uses. This step is optional.
            </div>

            {!mobileOtpSent ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Mobile to verify</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={altMobile}
                    onChange={(e) => {
                      setAltMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setError('');
                    }}
                    className="input-field tracking-widest"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleSendMobileOTP}
                  disabled={loading || altMobile.length !== 10}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Sending...' : 'Send OTP'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Enter OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={mobileOtp}
                    onChange={(e) => {
                      setMobileOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setError('');
                    }}
                    className="input-field text-center text-lg tracking-widest"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleVerifyMobileOTP}
                  disabled={loading || mobileOtp.length !== 6}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Verifying...' : 'Verify Mobile'}
                </button>
              </>
            )}

            <button
              onClick={() => (needsAddress ? void loadSuggestions() : setStep('success'))}
              disabled={loading}
              className="text-sm text-gray-500 hover:text-gray-700 w-full"
            >
              Skip this step
            </button>
          </div>
        )}

        {/* §3.6 — ABHA address */}
        {step === 'address' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <AtSign className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium">Choose an ABHA address</span>
            </div>
            <p className="text-xs text-gray-500">
              This is the patient's health address (like an email). It is needed for sharing records
              across the ABDM network. Optional now, but the ABHA is less useful without one.
            </p>

            {loading && suggestions.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading suggestions...
              </div>
            ) : (
              <>
                {suggestions.length > 0 && (
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <label
                        key={s}
                        className={`flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                          chosenAddress === s && !customAddress
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="abha-address"
                          className="accent-blue-600"
                          checked={chosenAddress === s && !customAddress}
                          onChange={() => {
                            setChosenAddress(s);
                            setCustomAddress('');
                            setError('');
                          }}
                        />
                        <span className="text-sm font-mono">{s}</span>
                      </label>
                    ))}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1">Or type your own</label>
                  <input
                    type="text"
                    value={customAddress}
                    onChange={(e) => {
                      setCustomAddress(e.target.value.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase());
                      setError('');
                    }}
                    placeholder="e.g. ramesh.kumar"
                    className="input-field font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    4–30 characters, start with a letter, lowercase letters/numbers/dot/underscore.
                  </p>
                </div>

                <button
                  onClick={handleCreateAddress}
                  disabled={loading || (!chosenAddress && !customAddress.trim())}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Creating...' : 'Create ABHA Address'}
                </button>
              </>
            )}

            <button
              onClick={() => setStep('success')}
              disabled={loading}
              className="text-sm text-gray-500 hover:text-gray-700 w-full"
            >
              Skip this step
            </button>
          </div>
        )}

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

export default ABHALinkModal;
