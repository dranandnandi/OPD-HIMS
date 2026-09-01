import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Shield, CheckCircle, Smartphone, AlertCircle, Loader2, UserCheck,
  AtSign, Search, Fingerprint
} from 'lucide-react';
import {
  abhaService,
  ABHASessionExpiredError,
  type ABHAProfile,
  type ABHAAccountChoice,
  type ABHASearchHit,
  type ABHAAddressLookup,
  type ABHAOtpSystem
} from '../../services/abhaService';
import { buildAbhaConsentText } from '../../utils/abhaConsent';
import ABHACardPanel from './ABHACardPanel';

/**
 * ABHA verification at the front desk — all three routes NHA's M1 functional
 * test sheet marks mandatory, behind one consent and one link step.
 *
 *   mobile-otp     spec 7.4          VRFY_ABHA_201
 *   abha-address   spec 14.1 / 14.2  VRFY_ABHA_102 + VRFY_ABHA_202
 *   fetch          spec 7.6.1/7.6.2  VRFY_ABHA_301-305 + VRFY_ABHA_401-405
 *
 * They are one component rather than three because everything *after* identity
 * is established — consent wording, the artefact, linking, the card — is
 * identical, and duplicating that is how consent text drifts between paths.
 * What differs is only how the patient proves who they are.
 *
 * For patients with no ABHA at all, `onNoAbhaFound` hands off to the Aadhaar
 * creation flow.
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

type Method = 'mobile-otp' | 'abha-address' | 'fetch';

type Step =
  | 'method'
  // mobile-otp (7.4)
  | 'mobile' | 'otp' | 'select'
  // abha-address (14.1 / 14.2)
  | 'address' | 'address-route' | 'address-otp'
  // fetch details (7.6.1 / 7.6.2)
  | 'fetch-search' | 'fetch-select' | 'fetch-otp'
  // shared
  | 'consent' | 'success';

/**
 * The visible progress track per method.
 *
 * 'method' is deliberately absent: choosing a route is not progress towards
 * verifying, and counting it would make the same patient look further along in
 * one flow than in another.
 */
const FLOW: Record<Method, Step[]> = {
  'mobile-otp': ['mobile', 'otp', 'select', 'consent', 'success'],
  'abha-address': ['address', 'address-route', 'address-otp', 'consent', 'success'],
  fetch: ['fetch-search', 'fetch-select', 'fetch-otp', 'consent', 'success'],
};

const METHOD_LABEL: Record<Method, string> = {
  'mobile-otp': 'Mobile number',
  'abha-address': 'ABHA address',
  fetch: 'Find & verify',
};

/**
 * Which OTP routes ABDM says this account actually supports.
 *
 * Offering a route ABDM has blocked produces a failure reception cannot explain
 * to a patient standing in front of them, so the picker is driven by the
 * server's answer rather than by what we happen to have implemented.
 *
 * The empty case is deliberate. An EMPTY `authMethods` means ABDM told us
 * nothing, so both routes are offered and the OTP itself settles it. A
 * NON-empty list with no OTP route in it means ABDM told us something real —
 * this account authenticates by password or demographics — and inventing an OTP
 * button there would only produce a failure nobody can explain.
 */
function otpRoutesFrom(authMethods: string[]): ABHAOtpSystem[] {
  if (authMethods.length === 0) return ['abdm', 'aadhaar'];
  const routes = new Set<ABHAOtpSystem>();
  for (const method of authMethods) {
    const value = method.toUpperCase();
    if (!value.includes('OTP')) continue;
    if (value.includes('AADHAAR')) routes.add('aadhaar');
    else if (value.includes('MOBILE') || value.includes('ABDM')) routes.add('abdm');
  }
  return [...routes];
}

const ROUTE_LABEL: Record<ABHAOtpSystem, string> = {
  abdm: 'OTP to the ABHA-registered mobile',
  aadhaar: 'OTP to the Aadhaar-registered mobile',
};

const ROUTE_HINT: Record<ABHAOtpSystem, string> = {
  abdm: "The number the patient used when creating their ABHA.",
  // Worth spelling out: this is a different phone from the one reception just
  // typed more often than anyone expects, and the patient may not have it.
  aadhaar: 'May be a different phone — check the patient has it before sending.',
};

const ABHA_ADDRESS_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9]+$/;

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
  const [method, setMethod] = useState<Method>('mobile-otp');
  const [step, setStep] = useState<Step>('method');
  const [otp, setOtp] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [accounts, setAccounts] = useState<ABHAAccountChoice[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [profile, setProfile] = useState<ABHAProfile | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // ── abha-address flow ──
  // NOT lowercased anywhere. ABHA addresses are user-chosen and routinely carry
  // capitals ("Jain.nitesh123@sbx"); normalising the case turns a real address
  // into one ABDM does not hold, and the failure reads as "no such ABHA".
  const [abhaAddress, setAbhaAddress] = useState('');
  const [addressLookup, setAddressLookup] = useState<ABHAAddressLookup | null>(null);

  // ── fetch-details flow ──
  const [hits, setHits] = useState<ABHASearchHit[]>([]);
  const [hitIndex, setHitIndex] = useState<number | null>(null);
  /**
   * The search handle, kept SEPARATE from the OTP handle.
   *
   * Requesting an OTP mints a new session and leaves the search one claimable,
   * which is what lets the operator go back and pick a different family member
   * — or resend — without searching again.
   */
  const [searchSessionId, setSearchSessionId] = useState('');
  const [otpSystem, setOtpSystem] = useState<ABHAOtpSystem>('abdm');

  const consentText = buildAbhaConsentText({ patientName, clinicName });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  /**
   * A consumed or expired server-side session cannot be retried in place — the
   * token behind it is gone. Reset to the START OF THE CURRENT METHOD so the
   * user is never staring at a dead OTP box, and never bounced into a flow they
   * did not choose.
   */
  const handleFailure = useCallback((err: unknown) => {
    if (err instanceof ABHASessionExpiredError) {
      setSessionId('');
      setSearchSessionId('');
      setOtp('');
      setAccounts([]);
      setSelected('');
      setHits([]);
      setHitIndex(null);
      setAddressLookup(null);
      setStep(FLOW[method][0]);
      setError(err.message);
      return;
    }
    setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
  }, [method]);

  const chooseMethod = (next: Method) => {
    setMethod(next);
    setStep(FLOW[next][0]);
    setError('');
    setNotice('');
    setOtp('');
    setSessionId('');
    setSearchSessionId('');
    setAccounts([]);
    setSelected('');
    setHits([]);
    setHitIndex(null);
    setAddressLookup(null);
    setOtpSystem('abdm');
  };

  // ── Mobile OTP (spec 7.4) ────────────────────────────────────────────────

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

      // A null profile means ABDM's Get Profile call did not answer — NOT that
      // verification failed. The OTP was accepted and the account confirmed,
      // so fall back to the account already on screen rather than dead-ending
      // the desk. The only field lost is the masked mobile, and the operator
      // just typed that number themselves.
      const chosen = accounts.find((a) => a.abhaNumber === selected);
      setProfile(
        res.profile ?? {
          abhaNumber: chosen?.abhaNumber ?? selected,
          abhaAddress: chosen?.abhaAddress ?? '',
          name: chosen?.name ?? '',
          gender: chosen?.gender ?? '',
          dob: chosen?.dob ?? '',
          mobileMasked: '',
          // null, never false. `false` asserts that ABDM said this ABHA is NOT
          // KYC-verified; the truth is that it said nothing at all.
          kycVerified: chosen?.kycVerified ?? null,
        },
      );
      // The handle now carries the X-token, which the card/QR step needs.
      setSessionId(res.sessionId);
      setStep('consent');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  // ── ABHA address (spec 14.1 / 14.2) ──────────────────────────────────────

  const handleAddressLookup = async () => {
    const address = abhaAddress.trim();
    if (!ABHA_ADDRESS_RE.test(address)) {
      setError('Enter a valid ABHA address, for example ramesh@abdm.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.searchAbhaAddress(address, patientId);
      if (!res.found) {
        setAddressLookup(null);
        setError('No ABHA exists with that address. Check the spelling with the patient.');
        return;
      }
      setAddressLookup(res);
      const routes = otpRoutesFrom(res.authMethods);
      setOtpSystem(routes[0] ?? 'abdm');
      setStep('address-route');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const sendAddressOtp = async (route: ABHAOtpSystem, isResend: boolean) => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.addressRequestOTP(abhaAddress.trim(), route, patientId);
      setSessionId(res.sessionId);
      setOtpSystem(route);
      setOtp('');
      setStep('address-otp');
      setResendCooldown(30);
      // ABDM's own wording names the number it used. Ours would only guess.
      if (res.message) setNotice(res.message);
      else if (isResend) setNotice('A new OTP has been sent.');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAddressOtp = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.addressVerify(sessionId, otp, otpSystem);
      setProfile(res.profile);
      setSessionId(res.sessionId ?? '');
      setStep('consent');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch ABHA details (spec 7.6.1 / 7.6.2) ──────────────────────────────

  const handleFetchSearch = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.searchByMobileForFetch(mobile, patientId);
      if (!res.found || res.accounts.length === 0 || !res.sessionId) {
        setHits([]);
        setNotice('No ABHA is registered against this mobile number.');
        setStep('fetch-select');
        return;
      }
      setHits(res.accounts);
      setSearchSessionId(res.sessionId);
      // Same rule as the 7.4 picker: never choose a family member for them.
      setHitIndex(res.accounts.length === 1 ? res.accounts[0].index : null);
      setStep('fetch-select');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const sendFetchOtp = async (route: ABHAOtpSystem, isResend: boolean) => {
    if (hitIndex === null) return;
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await abhaService.fetchRequestOTP(searchSessionId, hitIndex, route);
      setSessionId(res.sessionId);
      setOtpSystem(route);
      setOtp('');
      setStep('fetch-otp');
      setResendCooldown(30);
      if (res.message) setNotice(res.message);
      else if (isResend) setNotice('A new OTP has been sent.');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyFetchOtp = async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await abhaService.fetchVerify(sessionId, otp, otpSystem);
      setProfile(res.profile);
      setSessionId(res.sessionId ?? '');
      setStep('consent');
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Shared: consent and link ─────────────────────────────────────────────

  const handleConfirmLink = async () => {
    if (!consentChecked || !profile) return;
    setError('');
    setLoading(true);
    try {
      await abhaService.linkABHAToPatient({
        patientId,
        profile,
        consentText,
        // What the patient actually proved, not which screen they came from: an
        // ABHA-address verification completed by Aadhaar OTP is an Aadhaar
        // authentication, and the artefact has to say so.
        authMethod:
          method === 'mobile-otp'
            ? 'mobile-otp'
            : otpSystem === 'aadhaar'
            ? 'aadhaar-otp'
            : 'mobile-otp',
      });
      setStep('success');
      onLinked(profile);
    } catch (err) {
      handleFailure(err);
    } finally {
      setLoading(false);
    }
  };

  const track = FLOW[method];
  const stepIndex = track.indexOf(step);
  const selectedHit = hits.find((h) => h.index === hitIndex) ?? null;

  const renderOtpBox = (onVerify: () => void, fallbackNotice: string) => (
    <>
      <p className="text-sm text-gray-600">{notice || fallbackNotice}</p>
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
        onClick={onVerify}
        disabled={loading || otp.length !== 6}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Verifying...' : 'Verify OTP'}
      </button>
    </>
  );

  const renderResend = (onResend: () => void) => (
    <div className="text-center text-sm text-gray-500">
      {resendCooldown > 0 ? (
        <span>Resend OTP in {resendCooldown}s</span>
      ) : (
        <button onClick={onResend} disabled={loading} className="text-blue-600 hover:underline">
          Resend OTP
        </button>
      )}
    </div>
  );

  /** OTP route picker, shared by the address and fetch flows. */
  const renderRoutePicker = (routes: ABHAOtpSystem[], onSend: (route: ABHAOtpSystem) => void) => {
    if (routes.length === 0) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          ABDM does not offer an OTP route for this ABHA. Verify using the patient's mobile
          number instead.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {routes.map((route) => (
          <button
            key={route}
            onClick={() => onSend(route)}
            disabled={loading}
            className="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2 font-medium text-gray-900">
              {route === 'aadhaar' ? (
                <Fingerprint className="w-4 h-4 text-blue-600" />
              ) : (
                <Smartphone className="w-4 h-4 text-blue-600" />
              )}
              {ROUTE_LABEL[route]}
            </span>
            <span className="block text-xs text-gray-500 mt-0.5 pl-6">{ROUTE_HINT[route]}</span>
          </button>
        ))}
      </div>
    );
  };

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

        {step !== 'method' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {METHOD_LABEL[method]}
              </span>
              {step !== 'success' && (
                <button
                  onClick={() => setStep('method')}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Change method
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 mb-6">
              {track.map((s, i) => (
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
                  {i < track.length - 1 && <div className="flex-1 h-0.5 bg-gray-200" />}
                </React.Fragment>
              ))}
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-600 text-sm mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Step 0 — how will the patient identify themselves? */}
        {step === 'method' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              How would the patient like to verify their ABHA?
            </p>

            <button
              onClick={() => chooseMethod('mobile-otp')}
              className="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-gray-900">
                <Smartphone className="w-4 h-4 text-blue-600" />
                Mobile number
              </span>
              <span className="block text-xs text-gray-500 mt-0.5 pl-6">
                The usual route. An OTP goes to the patient's ABHA mobile.
              </span>
            </button>

            <button
              onClick={() => chooseMethod('abha-address')}
              className="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-gray-900">
                <AtSign className="w-4 h-4 text-blue-600" />
                ABHA address
              </span>
              <span className="block text-xs text-gray-500 mt-0.5 pl-6">
                For a patient who knows their address, such as ramesh@abdm.
              </span>
            </button>

            <button
              onClick={() => chooseMethod('fetch')}
              className="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium text-gray-900">
                <Search className="w-4 h-4 text-blue-600" />
                Find &amp; verify
              </span>
              <span className="block text-xs text-gray-500 mt-0.5 pl-6">
                Look up the ABHA first, then send the OTP to the ABHA or Aadhaar mobile.
              </span>
            </button>
          </div>
        )}

        {/* mobile-otp — step 1 */}
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

        {/* mobile-otp — step 2 */}
        {step === 'otp' && (
          <div className="space-y-4">
            {renderOtpBox(
              handleVerifyOTP,
              `OTP sent to the mobile number ending ${mobile.slice(-4)}.`,
            )}
            {renderResend(() => void sendOtp(true))}
          </div>
        )}

        {/* mobile-otp — step 3, account picker */}
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

        {/* abha-address — step 1 */}
        {step === 'address' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the patient's ABHA address. Nothing is sent yet — this only checks that the
              address exists.
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">ABHA Address</label>
              <input
                type="text"
                value={abhaAddress}
                onChange={(e) => {
                  setAbhaAddress(e.target.value.trim());
                  setError('');
                }}
                placeholder="ramesh@abdm"
                className="input-field"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Capitals matter — type it exactly as the patient gives it.
              </p>
            </div>
            <button
              onClick={handleAddressLookup}
              disabled={loading || !abhaAddress}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Checking...' : 'Look up ABHA'}
            </button>
          </div>
        )}

        {/* abha-address — step 2, confirm the person and choose the OTP route */}
        {step === 'address-route' && addressLookup && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 space-y-1">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">
                ABHA found
              </p>
              <p className="font-semibold text-gray-900">
                {addressLookup.name || '(name not provided)'}
              </p>
              <p className="text-sm font-mono text-gray-600">{addressLookup.abhaNumber}</p>
              {addressLookup.mobileMasked && (
                <p className="text-sm text-gray-600">Mobile: {addressLookup.mobileMasked}</p>
              )}
              {addressLookup.status && addressLookup.status !== 'ACTIVE' && (
                <p className="text-sm text-red-600 font-medium">Status: {addressLookup.status}</p>
              )}
            </div>

            <p className="text-sm text-gray-600">Confirm this is the patient, then send an OTP.</p>

            {renderRoutePicker(otpRoutesFrom(addressLookup.authMethods), (route) => {
              void sendAddressOtp(route, false);
            })}

            {addressLookup.blockedAuthMethods.length > 0 && (
              <p className="text-xs text-gray-500">
                ABDM has blocked: {addressLookup.blockedAuthMethods.join(', ')}. Those routes
                cannot be used for this ABHA.
              </p>
            )}
          </div>
        )}

        {/* abha-address — step 3 */}
        {step === 'address-otp' && (
          <div className="space-y-4">
            {renderOtpBox(
              handleVerifyAddressOtp,
              otpSystem === 'aadhaar'
                ? 'OTP sent to the Aadhaar-registered mobile number.'
                : 'OTP sent to the ABHA-registered mobile number.',
            )}
            {renderResend(() => void sendAddressOtp(otpSystem, true))}
          </div>
        )}

        {/* fetch — step 1 */}
        {step === 'fetch-search' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the patient's mobile number to find their ABHA. No OTP is sent yet.
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
              onClick={handleFetchSearch}
              disabled={loading || mobile.length !== 10}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? 'Searching...' : 'Find ABHA'}
            </button>
          </div>
        )}

        {/* fetch — step 2, pick the account, then the OTP route */}
        {step === 'fetch-select' && (
          <div className="space-y-4">
            {hits.length === 0 ? (
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
                  {hits.length === 1
                    ? 'Confirm this is the correct ABHA.'
                    : `${hits.length} ABHA accounts are registered on this mobile. Ask the patient which one is theirs.`}
                </p>
                <div className="space-y-2">
                  {hits.map((hit) => (
                    <label
                      key={hit.index}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        hitIndex === hit.index
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="abha-hit"
                        className="mt-1 accent-blue-600"
                        checked={hitIndex === hit.index}
                        onChange={() => {
                          setHitIndex(hit.index);
                          setError('');
                        }}
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {hit.name || '(name not provided)'}
                        </p>
                        <p className="text-sm font-mono text-gray-600">{hit.abhaNumber}</p>
                        {hit.gender && <p className="text-xs text-gray-500">{hit.gender}</p>}
                      </div>
                    </label>
                  ))}
                </div>

                {selectedHit && (
                  <>
                    <p className="text-sm text-gray-600 pt-2">Where should the OTP go?</p>
                    {renderRoutePicker(otpRoutesFrom(selectedHit.authMethods), (route) => {
                      void sendFetchOtp(route, false);
                    })}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* fetch — step 3 */}
        {step === 'fetch-otp' && (
          <div className="space-y-4">
            {renderOtpBox(
              handleVerifyFetchOtp,
              otpSystem === 'aadhaar'
                ? 'OTP sent to the Aadhaar-registered mobile number.'
                : 'OTP sent to the ABHA-registered mobile number.',
            )}
            {renderResend(() => void sendFetchOtp(otpSystem, true))}
          </div>
        )}

        {/* Shared — consent */}
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
              {/*
                Three states, not two. `null` means ABDM did not tell us — the
                fetch-details response omits the field entirely — and rendering
                that as "not verified" would be a false negative on an identity
                assurance flag, which reception would read as a red flag against
                a patient who has done nothing wrong.
              */}
              <p className="text-sm text-gray-600">
                KYC:{' '}
                {profile.kycVerified === true ? (
                  <span className="text-green-700 font-medium">Verified</span>
                ) : profile.kycVerified === false ? (
                  <span className="text-amber-700 font-medium">Not verified</span>
                ) : (
                  <span className="text-gray-500">Not stated by ABDM</span>
                )}
              </p>
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

        {/* Shared — done */}
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

            {sessionId && (
              <ABHACardPanel sessionId={sessionId} patientName={patientName} profile={profile} />
            )}

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
