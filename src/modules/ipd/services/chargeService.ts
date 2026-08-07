import { supabase } from '../utils/supabase';
import { fuzzyFilter } from '../utils/fuzzy';
import type { ChargePosting, ChargeSource, ServiceMaster, ChargeGroup } from '../types/ipd';

type ServiceRow = ServiceMaster & { charge_group?: { code: string; name: string; path: string } };

// Short-lived per-clinic cache of the full active service list so the fuzzy
// search ranks over everything without a DB round-trip per keystroke.
let serviceCache: { clinicId: string; at: number; rows: ServiceRow[] } | null = null;
const SERVICE_CACHE_TTL_MS = 60_000;

async function allServices(clinicId: string): Promise<ServiceRow[]> {
  if (
    serviceCache &&
    serviceCache.clinicId === clinicId &&
    Date.now() - serviceCache.at < SERVICE_CACHE_TTL_MS
  ) {
    return serviceCache.rows;
  }
  const { data, error } = await supabase
    .from('services_master')
    .select('*, charge_group:charge_groups(code, name, path)')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('service_code');
  if (error) throw error;
  serviceCache = { clinicId, at: Date.now(), rows: data as ServiceRow[] };
  return serviceCache.rows;
}

export const chargeService = {
  /** Loose fuzzy search over the whole service master (word-order and
      punctuation independent, acronyms like "cbc", typo-light subsequence) */
  async listServices(
    clinicId: string,
    search?: string,
    chargeGroupPath?: string
  ): Promise<ServiceRow[]> {
    let rows = await allServices(clinicId);
    // Filter by charge-group subtree (charge code level) on the joined path
    if (chargeGroupPath) {
      rows = rows.filter(
        (s) => s.charge_group?.path === chargeGroupPath || s.charge_group?.path.startsWith(chargeGroupPath + '/')
      );
    }
    if (!search) return rows.slice(0, 50);
    return fuzzyFilter(search, rows, (s) => [s.service_code, s.name, s.charge_group?.name], 30);
  },

  /** Call after creating/editing services so searches see them immediately */
  invalidateServiceCache(): void {
    serviceCache = null;
  },

  /**
   * AI charge capture (billing utility): free text / dictation → matched
   * services from THIS clinic's master. The AI only picks existing
   * service_codes; anything it can't match is returned in `unmatched`.
   * The caller resolves rates and posts — nothing is billed here.
   */
  async aiCaptureCharges(
    clinicId: string,
    text: string
  ): Promise<{
    matches: Array<{ service: ServiceRow; quantity: number; phrase?: string }>;
    unmatched: string[];
  }> {
    const rows = await allServices(clinicId);
    const catalog = rows.map((s) => ({
      code: s.service_code,
      name: s.name,
      group: s.charge_group?.name ?? '',
    }));

    const { data, error } = await supabase.functions.invoke('ai-charge-capture', {
      body: { text, services: catalog },
    });
    if (error) throw new Error(error.message ?? 'AI charge capture failed');
    if (data?.error) throw new Error(data.error);

    const byCode = new Map(rows.map((s) => [s.service_code.toLowerCase(), s]));
    const matches = ((data?.items ?? []) as Array<{ service_code: string; quantity?: number; source_phrase?: string }>)
      .map((it) => {
        const service = byCode.get(String(it.service_code).toLowerCase());
        return service
          ? { service, quantity: Math.max(1, Number(it.quantity) || 1), phrase: it.source_phrase }
          : null;
      })
      .filter((m): m is { service: ServiceRow; quantity: number; phrase?: string } => m !== null);

    return { matches, unmatched: (data?.unmatched ?? []) as string[] };
  },

  async listChargeGroups(clinicId: string): Promise<ChargeGroup[]> {
    const { data, error } = await supabase
      .from('charge_groups')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('path');
    if (error) throw error;
    return data as ChargeGroup[];
  },

  /** Running charges for an admission (the live bill view) */
  async listPostings(admissionId: string): Promise<ChargePosting[]> {
    const { data, error } = await supabase
      .from('charge_postings')
      .select('*, service:services_master(*), performing_doctor:profiles!charge_postings_performing_doctor_id_fkey(id, name)')
      .eq('admission_id', admissionId)
      .neq('status', 'cancelled')
      .order('service_date')
      .order('created_at');
    if (error) throw error;
    return data as unknown as ChargePosting[];
  },

  /** Resolve payer- and bed-class-specific rate via the DB function */
  async resolveRate(
    serviceId: string,
    tariffPlanId: string | null,
    bedTypeId?: string | null
  ): Promise<number> {
    const { data, error } = await supabase.rpc('resolve_tariff_rate', {
      p_service_id: serviceId,
      p_tariff_plan_id: tariffPlanId,
      p_bed_type_id: bedTypeId ?? null,
    });
    if (error) throw error;
    return data as number;
  },

  /** Manual service posting. charge_group columns are filled by DB trigger. */
  async postCharge(params: {
    clinicId: string;
    admissionId: string;
    serviceId: string;
    quantity: number;
    unitRate: number;
    discountAmount?: number;
    source?: ChargeSource;
    sourceRef?: string;
    serviceDate?: string;
    description?: string;
    orderingDoctorId?: string;
    performingDoctorId?: string;
    userId?: string;
  }): Promise<ChargePosting> {
    const gross = Math.round(params.unitRate * params.quantity * 100) / 100;
    const discount = params.discountAmount ?? 0;
    const { data, error } = await supabase
      .from('charge_postings')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        service_id: params.serviceId,
        // placeholder — trigger overwrites from services_master
        charge_group_id: '00000000-0000-0000-0000-000000000000',
        source: params.source ?? 'manual',
        source_ref: params.sourceRef ?? null,
        description: params.description ?? null,
        service_date: params.serviceDate ?? new Date().toISOString().slice(0, 10),
        quantity: params.quantity,
        unit_rate: params.unitRate,
        gross_amount: gross,
        discount_amount: discount,
        net_amount: gross - discount,
        ordering_doctor_id: params.orderingDoctorId ?? null,
        performing_doctor_id: params.performingDoctorId ?? null,
        created_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ChargePosting;
  },

  /** Line discount on a PENDING charge (admin-approved). Net recomputed here
      to satisfy the net = gross − discount constraint. */
  async applyDiscount(params: {
    posting: ChargePosting;
    discountAmount: number;
    approvedBy: string;
  }): Promise<void> {
    const { posting, discountAmount } = params;
    if (discountAmount < 0 || discountAmount > posting.gross_amount) {
      throw new Error(`Discount must be between 0 and ₹${posting.gross_amount}`);
    }
    const { error } = await supabase
      .from('charge_postings')
      .update({
        discount_amount: discountAmount,
        net_amount: posting.gross_amount - discountAmount,
        discount_approved_by: params.approvedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', posting.id)
      .eq('status', 'pending');
    if (error) throw error;
  },

  /** Manually move a PENDING charge into / out of the active package.
      Manual moves bypass rule caps (package_item_id stays null). */
  async setPackageInclusion(postingId: string, assignmentId: string | null): Promise<void> {
    const { error } = await supabase
      .from('charge_postings')
      .update({
        covered_by_package: !!assignmentId,
        package_assignment_id: assignmentId,
        package_item_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', postingId)
      .eq('status', 'pending'); // billed items are final
    if (error) throw error;
  },

  /** Recompute consumed/overrun after manual moves */
  async recomputePackageConsumption(assignmentId: string): Promise<void> {
    const { data: postings, error } = await supabase
      .from('charge_postings')
      .select('net_amount')
      .eq('package_assignment_id', assignmentId)
      .neq('status', 'cancelled');
    if (error) throw error;
    const consumed = (postings ?? []).reduce((s, p) => s + Number(p.net_amount), 0);

    const { data: ap } = await supabase
      .from('admission_packages')
      .select('agreed_price, overrun_flagged_at')
      .eq('id', assignmentId)
      .single();
    const agreed = Number(ap?.agreed_price ?? 0);

    await supabase
      .from('admission_packages')
      .update({
        consumed_amount: consumed,
        overrun_amount: Math.max(consumed - agreed, 0),
        overrun_flagged_at:
          consumed > agreed
            ? (ap?.overrun_flagged_at ?? new Date().toISOString())
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignmentId);
  },

  /** Re-run the package rules over all pending charges (DB function) */
  async reapplyCoverage(admissionId: string): Promise<number> {
    const { data, error } = await supabase.rpc('reapply_package_coverage', {
      p_admission_id: admissionId,
    });
    if (error) throw error;
    return data as number;
  },

  async cancelPosting(postingId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('charge_postings')
      .update({ status: 'cancelled', cancelled_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', postingId)
      .eq('status', 'pending'); // billed postings need a credit adjustment instead
    if (error) throw error;
  },
};
