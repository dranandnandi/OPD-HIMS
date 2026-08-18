// Clinic identity used on everything the IPD module prints — deposit and
// payment receipts, bills, ward-file sheets, documents. The name/address/phone
// always come from the logged-in clinic's own clinic_settings row, never from a
// constant, so each hospital's paperwork carries its own letterhead.
//
// Cached per clinic for the life of the page: printing is a click-time action
// and must not wait on a round trip every time.
import { supabase } from '../utils/supabase';

export interface ClinicInfo {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  registrationNumber: string | null;
}

/**
 * Fallback when the clinic row can't be read. Deliberately blank rather than a
 * placeholder name — a printed document must never claim a clinic it isn't.
 * Callers drop the empty fields from the letterhead.
 */
export const EMPTY_CLINIC_INFO: ClinicInfo = {
  name: '',
  address: null,
  phone: null,
  email: null,
  website: null,
  registrationNumber: null,
};

const cache = new Map<string, ClinicInfo>();
const inFlight = new Map<string, Promise<ClinicInfo>>();

/** Clinic header details for `clinicId`, cached; never rejects. */
export async function getClinicInfo(clinicId: string | null | undefined): Promise<ClinicInfo> {
  if (!clinicId) return EMPTY_CLINIC_INFO;

  const cached = cache.get(clinicId);
  if (cached) return cached;

  const pending = inFlight.get(clinicId);
  if (pending) return pending;

  const request = (async (): Promise<ClinicInfo> => {
    try {
      const { data, error } = await supabase
        .from('clinic_settings')
        .select('clinic_name, address, phone, email, website, registration_number')
        .eq('id', clinicId)
        .maybeSingle();

      if (error || !data) return EMPTY_CLINIC_INFO;

      const info: ClinicInfo = {
        name: data.clinic_name ?? '',
        address: data.address ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        website: data.website ?? null,
        registrationNumber: data.registration_number ?? null,
      };
      cache.set(clinicId, info);
      return info;
    } catch {
      return EMPTY_CLINIC_INFO;
    } finally {
      inFlight.delete(clinicId);
    }
  })();

  inFlight.set(clinicId, request);
  return request;
}

/** Drop the cache after the clinic's own details are edited. */
export function clearClinicInfoCache(clinicId?: string): void {
  if (clinicId) cache.delete(clinicId);
  else cache.clear();
}
