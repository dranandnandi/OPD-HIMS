import { supabase } from '../lib/supabaseClient';

function normalizeAbdmMobile(mobile?: string): string {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface ABHAProfile {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
  gender: string;
  dob: string;
  mobile: string;
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase client not initialised');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error + (data.detail ? ` — ${data.detail}` : ''));
  return data as T;
}

export const abhaService = {
  /** Send OTP to Aadhaar-linked mobile via ABDM. Returns txnId. */
  requestOTP: async (aadhaar: string, patientId?: string, clinicId?: string): Promise<string> => {
    const data = await invokeFunction<{ txnId: string }>('abdm-request-otp', {
      aadhaar,
      patientId,
      clinicId
    });
    return data.txnId;
  },

  /** Verify Aadhaar OTP. Returns xToken needed for profile fetch. */
  verifyOTP: async (
    txnId: string,
    otp: string,
    mobile?: string,
    patientId?: string,
    clinicId?: string
  ): Promise<{ txnId: string; authResult?: string; message?: string; xToken: string | null; _raw: unknown }> => {
    return invokeFunction<{ txnId: string; authResult?: string; message?: string; xToken: string | null; _raw: unknown }>('abdm-verify-otp', {
      txnId,
      otp,
      mobile: normalizeAbdmMobile(mobile),
      patientId,
      clinicId
    });
  },

  /** Fetch ABHA profile using X-token from verify step. */
  fetchProfile: async (xToken: string, patientId?: string, clinicId?: string): Promise<ABHAProfile> => {
    const data = await invokeFunction<{ profile: ABHAProfile }>('abdm-fetch-profile', {
      xToken,
      patientId,
      clinicId
    });
    return data.profile;
  },

  /** Persist ABHA details to patient record after consent is given. */
  linkABHAToPatient: async (
    patientId: string,
    profile: ABHAProfile
  ): Promise<void> => {
    if (!supabase) throw new Error('Supabase client not initialised');
    const { error } = await supabase
      .from('patients')
      .update({
        abha_number: profile.abhaNumber,
        abha_address: profile.abhaAddress,
        abha_linked_at: new Date().toISOString(),
        abha_consent_given: true,
        abha_consent_at: new Date().toISOString(),
        mobile_verified: true
      })
      .eq('id', patientId);
    if (error) throw new Error(error.message);
  },

  /** Format ABHA number as XX-XXXX-XXXX-XXXX for display. */
  formatAbhaNumber: (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 14) return raw;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10)}`;
  }
};
