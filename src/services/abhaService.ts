import { supabase } from '../lib/supabaseClient';

/**
 * ABHA profile as the edge functions hand it back.
 *
 * Note what is absent: no X-token, no raw upstream payload, no base64 profile
 * photo. Those stay server-side (see the module comments in
 * supabase/functions/_shared/abhaProfile.ts). The mobile number arrives already
 * masked because the browser only ever needs to confirm identity, not dial.
 */
export interface ABHAProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  mobileMasked: string;
  /** null = ABDM did not state it, NOT a failed KYC. Render as "unknown". */
  kycVerified: boolean | null;
}

/** One ABHA on a mobile number, for the account picker. */
export interface ABHAAccountChoice {
  /** Masked by ABDM, e.g. "91-2568-7073-XXXX". */
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  status: string;
  /** null = ABDM did not state it, NOT a failed KYC. Render as "unknown". */
  kycVerified: boolean | null;
}

export interface ABHASearchHit {
  /**
   * ABDM's 1-based position in the result list.
   *
   * Meaningless on its own, but it is the ONLY way to address an account in the
   * fetch-details flow — spec 7.6.1.2 / 7.6.2.2 send `loginHint: "index"`, not
   * an ABHA number. Without it a chained search is a dead end.
   */
  index: number;
  abhaNumber: string;
  name: string;
  gender: string;
  /** null = ABDM did not state it, NOT a failed KYC. Render as "unknown". */
  kycVerified: boolean | null;
  authMethods: string[];
}

/** Where ABDM sends the OTP. The distinction is user-visible at the desk. */
export type ABHAOtpSystem = 'abdm' | 'aadhaar';

/** What `abha-address-search` returns — spec 14.1 Step 1. */
export interface ABHAAddressLookup {
  found: boolean;
  abhaAddress: string;
  /** Masked by ABDM. */
  abhaNumber: string;
  name: string;
  status: string;
  /** Masked by ABDM, e.g. "******9725". */
  mobileMasked: string;
  /**
   * Offer ONLY these to the operator.
   *
   * Offering a method ABDM has blocked produces a failure reception cannot
   * explain to the patient standing in front of them.
   */
  authMethods: string[];
  /** Shown so the desk can say *why* a route is unavailable. */
  blockedAuthMethods: string[];
}

export type ABHAAuthMethod = 'aadhaar-otp' | 'mobile-otp' | 'qr-scan';

/**
 * Thrown when a server-side flow session has expired or been consumed.
 *
 * Separate from a generic error because the UI has to react differently: there
 * is nothing to retry, the user has to restart from the mobile number. ABDM's
 * T-token lives 300 seconds, which a patient hunting for their phone can
 * easily exceed.
 */
export class ABHASessionExpiredError extends Error {
  constructor(message = 'This verification step has expired. Please start again.') {
    super(message);
    this.name = 'ABHASessionExpiredError';
  }
}

/**
 * Pin every ABDM call to the Mumbai region.
 *
 * Supabase Edge Functions execute in the region **closest to the caller** by
 * default, not in the project's region. A Mumbai project is therefore not on
 * its own enough: a call from a browser outside India would run the function —
 * and touch patient identifiers and ABDM tokens — outside India.
 *
 * `x-region` is the documented lever and is what the client's `region` option
 * sets underneath. It is sent as a plain header here because `FunctionRegion`
 * is not re-exported from `@supabase/supabase-js`, so importing the enum would
 * mean reaching into a sub-package for no benefit.
 *
 * Verify at runtime with the `x-sb-edge-region` response header, or `SB_REGION`
 * inside the function.
 */
const ABDM_FUNCTION_REGION = 'ap-south-1';

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase client not initialised');

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { 'x-region': ABDM_FUNCTION_REGION },
  });

  // supabase-js surfaces non-2xx as `error` with the body on `error.context`.
  // Without digging it out, every upstream failure collapses into the useless
  // "Edge Function returned a non-2xx status code".
  if (error) {
    const payload = await readErrorBody(error);
    if (payload?.status === 410) throw new ABHASessionExpiredError(payload.message);
    throw new Error(payload?.message || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

async function readErrorBody(
  error: unknown,
): Promise<{ message: string; status: number } | null> {
  const context = (error as { context?: Response })?.context;
  if (!context || typeof context.json !== 'function') return null;
  try {
    const body = await context.json();
    return {
      message: typeof body?.error === 'string' ? body.error : '',
      status: context.status,
    };
  } catch {
    return null;
  }
}

export const abhaService = {
  // ── Mobile OTP verification (spec 7.4) — the primary OPD path ─────────────

  /** Step 1. Sends an OTP and returns the opaque session handle for step 2. */
  loginRequestOTP: async (
    mobile: string,
    patientId?: string,
  ): Promise<{ sessionId: string; message: string | null }> =>
    invokeFunction('abha-login-request-otp', { mobile, patientId }),

  /**
   * Step 2. Verifies the OTP and returns every ABHA on that mobile.
   *
   * An empty list is a legitimate outcome, not an error: the mobile has no
   * ABHA, so the desk should switch to the Aadhaar creation path.
   */
  loginVerifyOTP: async (
    sessionId: string,
    otp: string,
  ): Promise<{ sessionId: string | null; accounts: ABHAAccountChoice[] }> =>
    invokeFunction('abha-login-verify', { sessionId, otp }),

  /**
   * Step 3. Confirms the chosen ABHA.
   *
   * `profile` is **nullable**, and null is a success, not a failure. ABDM's Get
   * Profile call is enrichment on top of the account already returned by step
   * 2 — it adds only the masked mobile — and it can be refused independently of
   * the verification itself. When it is null, fall back to the account the
   * operator selected; do not show an error, because the patient's OTP was
   * accepted and the identity is confirmed.
   *
   * Returns the session handle too: the ABHA card and QR need the patient's
   * X-token, which is retained server-side against this handle for a few more
   * minutes. Once it lapses, printing requires re-verification.
   */
  loginVerifyUser: async (
    sessionId: string,
    abhaNumber: string,
  ): Promise<{ profile: ABHAProfile | null; sessionId: string }> =>
    invokeFunction('abha-login-verify-user', { sessionId, abhaNumber }),

  /** Find ABHA by mobile (spec 7.6.1.1) — pre-check, sends no OTP. */
  searchByMobile: async (
    mobile: string,
    patientId?: string,
  ): Promise<{ found: boolean; accounts: ABHASearchHit[] }> =>
    invokeFunction('abha-search', { mobile, patientId }),

  // ── Fetch ABHA details (spec 7.6.1 / 7.6.2) ──────────────────────────────
  //
  // Mandatory M1: VRFY_ABHA_301-305 (OTP to the ABHA's own mobile) and
  // VRFY_ABHA_401-405 (OTP to the AADHAAR-registered mobile). One flow; the
  // only difference is `otpSystem`, and that difference is the patient's
  // problem, not ours: the Aadhaar-registered number may be a phone they are
  // not holding. Say which number the OTP went to.
  //
  // Unlike the 7.4 login there is no account picker at the end — the account is
  // chosen by `index` BEFORE the OTP is sent, so the choice happens first.

  /**
   * Step 1. Same search as `searchByMobile`, but keeps the ABDM transaction
   * alive so an account can be acted on.
   *
   * Separate method rather than a flag on `searchByMobile` because the two have
   * different costs: the pre-check is free and disposable, this one opens a
   * server-side session. Callers should not acquire one by accident.
   */
  searchByMobileForFetch: async (
    mobile: string,
    patientId?: string,
  ): Promise<{ found: boolean; accounts: ABHASearchHit[]; sessionId?: string }> =>
    invokeFunction('abha-search', { mobile, patientId, chain: true }),

  /**
   * Step 2. Sends the OTP for the account at `index`.
   *
   * `message` is ABDM's own masked confirmation and is the only way the desk
   * learns the OTP went somewhere unexpected — show it verbatim rather than
   * substituting our own wording.
   */
  fetchRequestOTP: async (
    sessionId: string,
    index: number,
    otpSystem: ABHAOtpSystem = 'abdm',
  ): Promise<{ sessionId: string; message: string | null; otpSystem: ABHAOtpSystem }> =>
    invokeFunction('abha-fetch-request-otp', { sessionId, index, otpSystem }),

  /**
   * Step 3. Returns the profile directly — this flow yields the X-token without
   * the 7.4 exchange, so there is nothing further to confirm.
   *
   * `profile.kycVerified` is commonly **null** here: this response is thinner
   * than 7.4's and omits the flag entirely. Render null as *unknown*, never as
   * "not verified" — that would be a false negative on an identity-assurance
   * flag.
   */
  fetchVerify: async (
    sessionId: string,
    otp: string,
    otpSystem: ABHAOtpSystem = 'abdm',
  ): Promise<{ profile: ABHAProfile; sessionId: string | null }> =>
    invokeFunction('abha-fetch-verify', { sessionId, otp, otpSystem }),

  // ── ABHA address verification (spec 14.1 / 14.2) ─────────────────────────
  //
  // Mandatory M1: VRFY_ABHA_202 (mobile OTP) and VRFY_ABHA_102 (Aadhaar OTP).
  // Runs on the PHR host, a different API family from everything above.

  /**
   * Step 1. Look up an ABHA address (`someone@abdm`) — no OTP is sent.
   *
   * The address is NOT lowercased anywhere in this flow. They are user-chosen
   * and routinely contain capitals; normalising the case turns a real address
   * into one ABDM does not hold, and the failure reads as "no such ABHA".
   */
  searchAbhaAddress: async (
    abhaAddress: string,
    patientId?: string,
  ): Promise<ABHAAddressLookup> =>
    invokeFunction('abha-address-search', { abhaAddress, patientId }),

  /** Step 2. Sends the OTP, by whichever route the lookup said is available. */
  addressRequestOTP: async (
    abhaAddress: string,
    otpSystem: ABHAOtpSystem = 'abdm',
    patientId?: string,
  ): Promise<{ sessionId: string; message: string | null; otpSystem: ABHAOtpSystem }> =>
    invokeFunction('abha-address-request-otp', { abhaAddress, otpSystem, patientId }),

  /**
   * Step 3. Verifies and returns the profile.
   *
   * Known limitation: this flow returns identity but **no demographics** —
   * `gender`, `dob` and `mobileMasked` come back empty and profile enrichment
   * does not fill them. That is acceptable because the test asks for
   * verification, not a profile, and demographics are already on the patient
   * record. Do not present the blanks as missing data.
   */
  addressVerify: async (
    sessionId: string,
    otp: string,
    otpSystem: ABHAOtpSystem = 'abdm',
  ): Promise<{ profile: ABHAProfile; sessionId: string | null }> =>
    invokeFunction('abha-address-verify', { sessionId, otp, otpSystem }),

  // ── Aadhaar OTP creation (spec 3) — retained for patients with no ABHA ────

  /** Sends an OTP to the Aadhaar-linked mobile. Returns the ABDM txnId. */
  requestOTP: async (aadhaar: string, patientId?: string): Promise<string> => {
    const data = await invokeFunction<{ txnId: string }>('abdm-request-otp', {
      aadhaar,
      patientId,
    });
    return data.txnId;
  },

  /**
   * Verifies the Aadhaar OTP, enrols, and returns the profile.
   *
   * `sessionId` carries the enrolment forward: mobile verification (§3.4) and
   * ABHA address creation (§3.6) both chain off the same upstream transaction.
   * `needsAbhaAddress` is true when ABDM issued the account without one — that
   * account has no handle for M2/M3 linking until §3.6 runs.
   */
  verifyOTP: async (
    txnId: string,
    otp: string,
    /**
     * REQUIRED, not optional. ABDM's enrol/byAadhaar marks `mobile` mandatory —
     * it is the new ABHA's primary/communication number. Omitting it returns a
     * bare 400 with no usable message.
     */
    mobile: string,
    patientId?: string,
  ): Promise<{ profile: ABHAProfile; sessionId: string; needsAbhaAddress: boolean }> =>
    invokeFunction('abdm-verify-otp', { txnId, otp, mobile, patientId }),

  // ── Post-enrolment steps (spec 3.4 / 3.6) ────────────────────────────────

  /**
   * §3.4a — send an OTP to a mobile that is *not* the Aadhaar-linked one.
   *
   * Needed whenever the number UIDAI holds differs from the one the patient
   * gives at reception, which is common: old SIMs, a relative's phone.
   */
  enrolMobileRequestOTP: async (
    sessionId: string,
    mobile: string,
  ): Promise<{ sessionId: string; message: string | null }> =>
    invokeFunction('abha-enrol-mobile-request-otp', { sessionId, mobile }),

  /** §3.4b — verify that mobile OTP against the enrolment. */
  enrolMobileVerify: async (
    sessionId: string,
    otp: string,
  ): Promise<{ sessionId: string; verified: boolean }> =>
    invokeFunction('abha-enrol-mobile-verify', { sessionId, otp }),

  /** §3.6a — ABDM's suggested ABHA addresses for this enrolment. */
  addressSuggestions: async (
    sessionId: string,
  ): Promise<{ sessionId: string; suggestions: string[] }> =>
    invokeFunction('abha-address-suggestions', { sessionId }),

  /** §3.6b — claim an ABHA address and set it as preferred. */
  createAddress: async (
    sessionId: string,
    abhaAddress: string,
  ): Promise<{ abhaAddress: string }> =>
    invokeFunction('abha-address-create', { sessionId, abhaAddress }),

  // ── Card / QR (spec 10, 11) ──────────────────────────────────────────────

  /**
   * Fetches the ABHA QR and card as data URIs for immediate display or print.
   *
   * Only works while the verification session is live — both endpoints
   * authenticate as the patient, and we do not retain that token beyond the
   * flow. Either field may be null if ABDM returned only one.
   */
  getCard: async (
    sessionId: string,
  ): Promise<{ qrCode: string | null; card: string | null }> =>
    invokeFunction('abha-get-card', { sessionId }),

  // ── Withdrawal ────────────────────────────────────────────────────────────

  /**
   * Withdraws consent and unlinks the ABHA from the patient record.
   *
   * Local only — the patient's ABHA is untouched and remains theirs. The
   * consent artefact is marked revoked rather than deleted, so the record that
   * consent was lawfully obtained survives alongside its withdrawal.
   */
  unlinkABHA: async (patientId: string, reason?: string): Promise<void> => {
    await invokeFunction('abha-unlink-patient', { patientId, reason });
  },

  // ── Linking ───────────────────────────────────────────────────────────────

  /**
   * Persists the ABHA against the patient and records the consent artefact.
   *
   * `consentText` is the exact wording shown on screen and is stored verbatim:
   * that is the evidence an assessor asks for, so it must be captured at the
   * point of display rather than reconstructed later.
   */
  linkABHAToPatient: async (params: {
    patientId: string;
    profile: ABHAProfile;
    consentText: string;
    authMethod: ABHAAuthMethod;
  }): Promise<void> => {
    await invokeFunction('abha-link-patient', {
      patientId: params.patientId,
      abhaNumber: params.profile.abhaNumber,
      abhaAddress: params.profile.abhaAddress,
      consentText: params.consentText,
      authMethod: params.authMethod,
    });
  },

  /** Formats a 14-digit ABHA number as XX-XXXX-XXXX-XXXX. */
  formatAbhaNumber: (raw: string): string => {
    // Already-masked values from ABDM (91-2568-7073-XXXX) contain non-digits
    // and must pass through untouched rather than be mangled into nonsense.
    if (/[A-Za-z]/.test(raw)) return raw;
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 14) return raw;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
  },
};
