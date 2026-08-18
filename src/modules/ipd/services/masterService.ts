import { supabase } from '../utils/supabase';
import { chargeService } from './chargeService';
import type { Ward, Bed, BedType, ServiceMaster, ChargeGroup, Payer, TariffPlan } from '../types/ipd';

export const masterService = {
  async seedDefaults(clinicId: string): Promise<string> {
    const { data, error } = await supabase.rpc('seed_ipd_masters', { p_clinic_id: clinicId });
    if (error) throw error;
    return data as string;
  },

  // --- wards ---------------------------------------------------------------
  async createWard(ward: Pick<Ward, 'clinic_id' | 'name' | 'floor' | 'ward_type'>): Promise<Ward> {
    const { data, error } = await supabase.from('ipd_wards').insert(ward).select().single();
    if (error) throw error;
    return data as Ward;
  },

  async updateWard(id: string, patch: Partial<Ward>): Promise<void> {
    const { error } = await supabase
      .from('ipd_wards')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  /** Soft delete: hides the ward (and is blocked in UI while it still has beds) */
  async deactivateWard(id: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_wards')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // --- beds ----------------------------------------------------------------
  async createBed(bed: Pick<Bed, 'clinic_id' | 'ward_id' | 'bed_number' | 'bed_type_id'>): Promise<Bed> {
    const { data, error } = await supabase.from('ipd_beds').insert(bed).select().single();
    if (error) throw error;
    return data as Bed;
  },

  async deactivateBed(id: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_beds')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // --- bed types --------------------------------------------------------------
  /**
   * Create a bed class: auto-creates its room-rent service (BED group,
   * code BED-<CODE>) and optionally applies a class rate multiplier.
   */
  async createBedType(params: {
    clinicId: string;
    code: string;
    name: string;
    dailyRent: number;
    rateMultiplier?: number;
    isCriticalCare?: boolean;
  }): Promise<BedType> {
    const code = params.code.trim().toUpperCase();

    const { data: bedGroup, error: groupErr } = await supabase
      .from('charge_groups')
      .select('id')
      .eq('clinic_id', params.clinicId)
      .eq('code', 'BED')
      .maybeSingle();
    if (groupErr) throw groupErr;
    if (!bedGroup) throw new Error('Charge group BED not found — run "Seed defaults" first.');

    // room-rent service (idempotent on code)
    const { data: existingSvc } = await supabase
      .from('services_master')
      .select('id')
      .eq('clinic_id', params.clinicId)
      .eq('service_code', `BED-${code}`)
      .maybeSingle();

    let rentServiceId = existingSvc?.id as string | undefined;
    if (!rentServiceId) {
      const { data: svc, error: svcErr } = await supabase
        .from('services_master')
        .insert({
          clinic_id: params.clinicId,
          service_code: `BED-${code}`,
          name: `Room Rent — ${params.name}`,
          charge_group_id: bedGroup.id,
          service_type: 'bed',
          base_price: params.dailyRent,
          unit: 'per day',
          is_sharable: false,
        })
        .select('id')
        .single();
      if (svcErr) throw svcErr;
      rentServiceId = svc.id;
    }

    const { data, error } = await supabase
      .from('bed_types')
      .insert({
        clinic_id: params.clinicId,
        code,
        name: params.name,
        room_rent_service_id: rentServiceId,
        rate_multiplier: params.rateMultiplier ?? 1,
        is_critical_care: params.isCriticalCare ?? false,
      })
      .select()
      .single();
    if (error) throw error;
    return data as BedType;
  },

  async updateBedTypeMultiplier(bedTypeId: string, multiplier: number): Promise<void> {
    const { error } = await supabase
      .from('bed_types')
      .update({ rate_multiplier: multiplier, updated_at: new Date().toISOString() })
      .eq('id', bedTypeId);
    if (error) throw error;
  },

  async renameBedType(bedTypeId: string, name: string): Promise<void> {
    const { error } = await supabase
      .from('bed_types')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', bedTypeId);
    if (error) throw error;
  },

  /** Daily rent lives on the class's room-rent service */
  async setBedTypeRent(roomRentServiceId: string, rent: number): Promise<void> {
    const { error } = await supabase
      .from('services_master')
      .update({ base_price: rent, updated_at: new Date().toISOString() })
      .eq('id', roomRentServiceId);
    if (error) throw error;
  },

  /** Soft delete: hides from pickers; existing beds keep their class */
  async deactivateBedType(bedTypeId: string): Promise<void> {
    const { error } = await supabase
      .from('bed_types')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', bedTypeId);
    if (error) throw error;
  },

  // --- services / charge groups ---------------------------------------------
  async listAllServices(clinicId: string): Promise<ServiceMaster[]> {
    const { data, error } = await supabase
      .from('services_master')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('service_code');
    if (error) throw error;
    return data as ServiceMaster[];
  },

  async createService(svc: Partial<ServiceMaster> & {
    clinic_id: string; service_code: string; name: string; charge_group_id: string;
  }): Promise<ServiceMaster> {
    const { data, error } = await supabase.from('services_master').insert(svc).select().single();
    if (error) throw error;
    chargeService.invalidateServiceCache();
    return data as ServiceMaster;
  },

  async updateService(id: string, patch: Partial<ServiceMaster>): Promise<void> {
    const { error } = await supabase
      .from('services_master')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    chargeService.invalidateServiceCache();
  },

  async listChargeGroups(clinicId: string): Promise<ChargeGroup[]> {
    const { data, error } = await supabase
      .from('charge_groups')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('path');
    if (error) throw error;
    return data as ChargeGroup[];
  },

  /**
   * Merge OPD's own service catalog into the IPD charge-code structure:
   * priced tests (tests_master + clinic_test_prices) become services under
   * INV-PATH (lab) / INV-RAD (radiology/imaging), so OPD and IPD share one
   * charge-code → service-code hierarchy. Idempotent — existing names skipped.
   */
  async importOpdServices(clinicId: string): Promise<{ created: number; skipped: number }> {
    const [groups, services] = await Promise.all([
      this.listChargeGroups(clinicId),
      this.listAllServices(clinicId),
    ]);
    const invPath = groups.find((g) => g.code === 'INV-PATH');
    const invRad = groups.find((g) => g.code === 'INV-RAD');
    const inv = groups.find((g) => g.code === 'INV');
    if (!inv && !invPath) throw new Error('INV charge groups missing — run Seed defaults first.');

    const { data: priced, error } = await supabase
      .from('clinic_test_prices')
      .select('price, cost, test:tests_master(id, name, type, category, is_active)')
      .eq('clinic_id', clinicId);
    if (error) throw error;

    const existingNames = new Set(services.map((s) => s.name.trim().toLowerCase()));
    const counters: Record<string, number> = {};
    let created = 0;
    let skipped = 0;

    for (const row of (priced ?? []) as any[]) {
      const test = row.test;
      if (!test || test.is_active === false) continue;
      if (existingNames.has(String(test.name).trim().toLowerCase())) {
        skipped++;
        continue;
      }
      const isImaging = ['radiology', 'imaging', 'xray', 'scan'].includes(
        String(test.type ?? '').toLowerCase()
      );
      const group = (isImaging ? invRad : invPath) ?? inv!;

      // sequential code within the group: <GROUP>-OP001 …
      counters[group.code] = (counters[group.code] ?? 0) + 1;
      let seq = counters[group.code];
      let codeCandidate = `${group.code}-OP${String(seq).padStart(3, '0')}`;
      while (services.some((s) => s.service_code.toUpperCase() === codeCandidate.toUpperCase())) {
        seq += 1;
        counters[group.code] = seq;
        codeCandidate = `${group.code}-OP${String(seq).padStart(3, '0')}`;
      }

      const { error: insErr } = await supabase.from('services_master').insert({
        clinic_id: clinicId,
        service_code: codeCandidate,
        name: test.name,
        charge_group_id: group.id,
        service_type: isImaging ? 'imaging' : 'lab',
        base_price: Number(row.price) || 0,
        base_cost: Number(row.cost) || 0,
        unit: 'per test',
        is_sharable: true,
        // hard link → OPD price changes auto-sync via DB trigger
        external_system: 'opd_test',
        external_ref: String(test.id),
      });
      if (insErr) throw insErr;
      existingNames.add(String(test.name).trim().toLowerCase());
      created++;
    }

    return { created, skipped };
  },

  // --- per-service class rates (standard rate card: tariff_plan_id NULL) -------
  /** Explicit class rates for one service: { bed_type_id → rate } */
  async listServiceClassRates(clinicId: string, serviceId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('tariff_rates')
      .select('bed_type_id, rate')
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId)
      .is('tariff_plan_id', null)
      .not('bed_type_id', 'is', null);
    if (error) throw error;
    const map: Record<string, number> = {};
    for (const r of data ?? []) {
      if (r.bed_type_id && r.rate != null) map[r.bed_type_id] = Number(r.rate);
    }
    return map;
  },

  /** Set (or clear with null) the explicit rate of a service for one bed class.
      Explicit rates beat the class multiplier in tariff resolution. */
  async setServiceClassRate(
    clinicId: string,
    serviceId: string,
    bedTypeId: string,
    rate: number | null
  ): Promise<void> {
    const { data: existing } = await supabase
      .from('tariff_rates')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId)
      .eq('bed_type_id', bedTypeId)
      .is('tariff_plan_id', null)
      .maybeSingle();

    if (rate == null) {
      if (existing) {
        const { error } = await supabase.from('tariff_rates').delete().eq('id', existing.id);
        if (error) throw error;
      }
      return;
    }

    if (existing) {
      const { error } = await supabase.from('tariff_rates').update({ rate }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('tariff_rates').insert({
        clinic_id: clinicId,
        tariff_plan_id: null,
        service_id: serviceId,
        bed_type_id: bedTypeId,
        rate,
      });
      if (error) throw error;
    }
  },

  // --- payers / tariff plans --------------------------------------------------
  async listPayers(clinicId: string): Promise<Payer[]> {
    const { data, error } = await supabase
      .from('payers')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as Payer[];
  },

  async createPayer(payer: Partial<Payer> & {
    clinic_id: string; name: string; payer_type: Payer['payer_type'];
  }): Promise<Payer> {
    const { data, error } = await supabase.from('payers').insert(payer).select().single();
    if (error) throw error;
    return data as Payer;
  },

  async updatePayer(id: string, patch: Partial<Payer>): Promise<void> {
    const { error } = await supabase
      .from('payers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // --- account price lists ------------------------------------------------------
  /** Payer package prices: rows {package_id, bed_type_id|null, price} */
  async listPayerPackagePrices(payerId: string): Promise<Array<{
    id: string; package_id: string; bed_type_id: string | null; price: number;
    package?: { name: string } | null; bed_type?: { name: string } | null;
  }>> {
    const { data, error } = await supabase
      .from('payer_package_prices')
      .select('id, package_id, bed_type_id, price, package:packages(name), bed_type:bed_types(name)')
      .eq('payer_id', payerId)
      .eq('is_active', true);
    if (error) throw error;
    return data as never;
  },

  async setPayerPackagePrice(params: {
    clinicId: string; payerId: string; packageId: string;
    bedTypeId: string | null; price: number;
  }): Promise<void> {
    // manual upsert (unique index uses COALESCE, not usable via onConflict)
    let query = supabase
      .from('payer_package_prices')
      .select('id')
      .eq('payer_id', params.payerId)
      .eq('package_id', params.packageId);
    query = params.bedTypeId ? query.eq('bed_type_id', params.bedTypeId) : query.is('bed_type_id', null);
    const { data: existing } = await query.maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('payer_package_prices')
        .update({ price: params.price, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('payer_package_prices').insert({
        clinic_id: params.clinicId,
        payer_id: params.payerId,
        package_id: params.packageId,
        bed_type_id: params.bedTypeId,
        price: params.price,
      });
      if (error) throw error;
    }
  },

  async removePayerPackagePrice(id: string): Promise<void> {
    const { error } = await supabase.from('payer_package_prices').delete().eq('id', id);
    if (error) throw error;
  },

  /** Service rate on the payer's price list (their default tariff plan) */
  async setPayerServiceRate(params: {
    clinicId: string; payerId: string; serviceId: string;
    bedTypeId: string | null; rate: number | null;
  }): Promise<void> {
    const { data: planId, error: planErr } = await supabase.rpc('get_default_payer_plan', {
      p_clinic_id: params.clinicId,
      p_payer_id: params.payerId,
    });
    if (planErr) throw planErr;

    let query = supabase
      .from('tariff_rates')
      .select('id')
      .eq('tariff_plan_id', planId as string)
      .eq('service_id', params.serviceId);
    query = params.bedTypeId ? query.eq('bed_type_id', params.bedTypeId) : query.is('bed_type_id', null);
    const { data: existing } = await query.maybeSingle();

    if (params.rate == null) {
      if (existing) {
        const { error } = await supabase.from('tariff_rates').delete().eq('id', existing.id);
        if (error) throw error;
      }
      return;
    }
    if (existing) {
      const { error } = await supabase.from('tariff_rates').update({ rate: params.rate }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('tariff_rates').insert({
        clinic_id: params.clinicId,
        tariff_plan_id: planId as string,
        service_id: params.serviceId,
        bed_type_id: params.bedTypeId,
        rate: params.rate,
      });
      if (error) throw error;
    }
  },

  async listPayerServiceRates(clinicId: string, payerId: string): Promise<Array<{
    id: string; service_id: string; bed_type_id: string | null; rate: number | null;
    service?: { service_code: string; name: string } | null;
    bed_type?: { name: string } | null;
  }>> {
    const { data: plans } = await supabase
      .from('tariff_plans')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('payer_id', payerId)
      .eq('is_active', true);
    const planIds = (plans ?? []).map((p) => p.id);
    if (planIds.length === 0) return [];
    const { data, error } = await supabase
      .from('tariff_rates')
      .select('id, service_id, bed_type_id, rate, service:services_master(service_code, name), bed_type:bed_types(name)')
      .in('tariff_plan_id', planIds)
      .not('service_id', 'is', null);
    if (error) throw error;
    return data as never;
  },

  async listTariffPlans(clinicId: string): Promise<TariffPlan[]> {
    const { data, error } = await supabase
      .from('tariff_plans')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data as TariffPlan[];
  },
};
