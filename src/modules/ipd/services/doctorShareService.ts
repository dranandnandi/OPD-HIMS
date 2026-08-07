import { supabase } from '../utils/supabase';

export interface DoctorContract {
  id: string;
  clinic_id: string;
  doctor_id: string;
  share_percent: number;
  share_basis: 'gross' | 'net_received';
  is_active: boolean;
  notes: string | null;
  doctor_name?: string;
}

export interface EarningsLine {
  serviceName: string;
  date: string;
  amount: number;
}

export interface Earnings {
  gross: number;
  count: number;
  sharePercent: number;
  shareBasis: 'gross' | 'net_received';
  shareAmount: number;
  lines: EarningsLine[];
}

export interface DoctorSettlement {
  id: string;
  clinic_id: string;
  doctor_id: string;
  period_from: string;
  period_to: string;
  gross_amount: number;
  share_percent: number;
  share_amount: number;
  status: 'draft' | 'paid';
  payment_ref: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  doctor_name?: string;
}

export const doctorShareService = {
  async listContracts(clinicId: string): Promise<DoctorContract[]> {
    const { data, error } = await supabase
      .from('doctor_contracts')
      .select('*, doctor:profiles!doctor_contracts_doctor_id_fkey(name)')
      .eq('clinic_id', clinicId);
    if (error) throw error;
    return ((data ?? []) as unknown as Array<DoctorContract & { doctor?: { name?: string } | null }>).map((c) => ({
      ...c,
      doctor_name: c.doctor?.name ?? '',
    }));
  },

  async upsertContract(params: {
    clinicId: string;
    doctorId: string;
    sharePercent: number;
    shareBasis: 'gross' | 'net_received';
    isActive: boolean;
    userId?: string;
  }): Promise<void> {
    const { error } = await supabase.from('doctor_contracts').upsert(
      {
        clinic_id: params.clinicId,
        doctor_id: params.doctorId,
        share_percent: params.sharePercent,
        share_basis: params.shareBasis,
        is_active: params.isActive,
        created_by: params.userId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,doctor_id' }
    );
    if (error) throw error;
  },

  /** Sum a doctor's sharable charge postings over a period and apply the rule. */
  async computeEarnings(
    clinicId: string,
    doctorId: string,
    from: string,
    to: string
  ): Promise<Earnings> {
    const [{ data: contractRow }, { data: postings, error }] = await Promise.all([
      supabase
        .from('doctor_contracts')
        .select('share_percent, share_basis')
        .eq('clinic_id', clinicId)
        .eq('doctor_id', doctorId)
        .maybeSingle(),
      supabase
        .from('charge_postings')
        .select('net_amount, service_date, service:services_master(name, is_sharable)')
        .eq('clinic_id', clinicId)
        .eq('performing_doctor_id', doctorId)
        .neq('status', 'cancelled')
        .gte('service_date', from)
        .lte('service_date', to),
    ]);
    if (error) throw error;

    const rows = ((postings ?? []) as unknown as Array<{
      net_amount: number;
      service_date: string;
      service: { name?: string; is_sharable?: boolean } | null;
    }>).filter((p) => p.service?.is_sharable);

    const gross = rows.reduce((s, p) => s + Number(p.net_amount), 0);
    const sharePercent = Number(contractRow?.share_percent ?? 0);
    const shareBasis = (contractRow?.share_basis ?? 'gross') as 'gross' | 'net_received';
    const shareAmount = Math.round(gross * (sharePercent / 100) * 100) / 100;

    const lines = rows
      .map((p) => ({ serviceName: p.service?.name ?? 'Service', date: p.service_date, amount: Number(p.net_amount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { gross, count: rows.length, sharePercent, shareBasis, shareAmount, lines };
  },

  async createSettlement(params: {
    clinicId: string;
    doctorId: string;
    from: string;
    to: string;
    gross: number;
    sharePercent: number;
    shareAmount: number;
    userId?: string;
  }): Promise<void> {
    const { error } = await supabase.from('doctor_settlements').insert({
      clinic_id: params.clinicId,
      doctor_id: params.doctorId,
      period_from: params.from,
      period_to: params.to,
      gross_amount: params.gross,
      share_percent: params.sharePercent,
      share_amount: params.shareAmount,
      created_by: params.userId ?? null,
    });
    if (error) throw error;
  },

  async listSettlements(clinicId: string, doctorId?: string): Promise<DoctorSettlement[]> {
    let q = supabase
      .from('doctor_settlements')
      .select('*, doctor:profiles!doctor_settlements_doctor_id_fkey(name)')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });
    if (doctorId) q = q.eq('doctor_id', doctorId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as unknown as Array<DoctorSettlement & { doctor?: { name?: string } | null }>).map((s) => ({
      ...s,
      doctor_name: s.doctor?.name ?? '',
    }));
  },

  async markPaid(id: string, paymentRef: string): Promise<void> {
    const { error } = await supabase
      .from('doctor_settlements')
      .update({ status: 'paid', payment_ref: paymentRef || null, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};
