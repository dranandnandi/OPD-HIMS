// Caller authorization for the ABDM functions — G-05.
//
// `verify_jwt` defaults to true, so these endpoints already required *a*
// Supabase JWT. What was missing is the second half: nothing checked that the
// caller was entitled to act on the patientId/clinicId in the request body.
// Any authenticated user of any clinic could fire an Aadhaar OTP against any
// patient record and write audit rows attributed to someone else's clinic.
// Textbook broken object-level authorization (OWASP A01).
//
// The rule enforced here: the clinic is derived from the caller's JWT, never
// taken from the request body. A client-supplied clinicId is advisory at best
// and forgeable at worst, so we ignore it entirely.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';

export interface AbdmCaller {
  userId: string;
  clinicId: string;
  roleName: string | null;
  /** Service-role client, for writes that must bypass RLS (audit, cache). */
  admin: SupabaseClient;
}

export class AbdmAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

/**
 * Resolves the caller from their Authorization header and loads their clinic.
 *
 * Throws rather than returning null so a caller cannot forget to check.
 */
export async function authenticateCaller(req: Request): Promise<AbdmCaller> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) throw new AbdmAuthError('Authentication required', 401);

  const admin = createAdminClient();

  // Validate the JWT against the auth service rather than decoding it here —
  // decoding without verification would accept any well-formed token.
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    throw new AbdmAuthError('Authentication required', 401);
  }

  const userId = userData.user.id;

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('clinic_id, role_name, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    throw new AbdmAuthError('No profile for this user', 403);
  }
  // A deactivated account keeps a valid JWT until it expires. ABDM calls carry
  // real-world consequences (OTPs to patients, health-account creation), so a
  // revoked user must be stopped here rather than at next login.
  if (profile.is_active === false) {
    throw new AbdmAuthError('Account is inactive', 403);
  }
  if (!profile.clinic_id) {
    throw new AbdmAuthError('User is not assigned to a clinic', 403);
  }

  return {
    userId,
    clinicId: profile.clinic_id as string,
    roleName: (profile.role_name as string | null) ?? null,
    admin,
  };
}

/**
 * Confirms the patient belongs to the caller's clinic.
 *
 * Call this before any ABDM interaction that names a patient. Returns the
 * patient's stored mobile so callers do not need a second round-trip.
 */
export async function assertPatientInCallerClinic(
  caller: AbdmCaller,
  patientId: string,
): Promise<{ id: string; phone: string | null; abhaNumber: string | null }> {
  const { data: patient, error } = await caller.admin
    .from('patients')
    .select('id, clinic_id, phone, abha_number')
    .eq('id', patientId)
    .maybeSingle();

  if (error) throw new AbdmAuthError('Patient lookup failed', 500);

  // Same response for "does not exist" and "belongs to another clinic".
  // Distinguishing them turns this endpoint into an oracle for which patient
  // IDs are real across the whole install.
  if (!patient || patient.clinic_id !== caller.clinicId) {
    throw new AbdmAuthError('Patient not found', 404);
  }

  return {
    id: patient.id as string,
    phone: (patient.phone as string | null) ?? null,
    abhaNumber: (patient.abha_number as string | null) ?? null,
  };
}

/**
 * Rate-limit gate (G-08), delegating the count-and-insert to the SQL function
 * so concurrent requests cannot both pass a check they should not.
 *
 * Fails **closed**: if the limiter itself errors we refuse the call. An OTP
 * endpoint that keeps serving when its throttle is broken is the exact
 * condition that gets abused.
 */
export async function enforceRateLimit(
  caller: AbdmCaller,
  action: string,
  targetHash: string | null,
): Promise<void> {
  const { data, error } = await caller.admin.rpc('abdm_check_rate_limit', {
    p_actor_id: caller.userId,
    p_clinic_id: caller.clinicId,
    p_action: action,
    p_target_hash: targetHash,
  });

  if (error) {
    console.error('[abdm] rate limiter unavailable:', error.message);
    throw new AbdmAuthError('Service temporarily unavailable', 503);
  }
  if (data === false) {
    throw new AbdmAuthError(
      'Too many attempts. Please wait before trying again.',
      429,
    );
  }
}
