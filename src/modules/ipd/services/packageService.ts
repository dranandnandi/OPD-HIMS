import { supabase } from '../utils/supabase';

export interface HospitalPackage {
  id: string;
  clinic_id: string;
  code: string | null;
  name: string;
  package_price: number;
  estimated_cost: number | null;
  default_stay_days: number | null;
  per_day_bed_cap: number | null;
  implant_cap: number | null;
  deduction_buffer_pct: number;
  doctor_share_override_pct: number | null;
  /** restrict this package to one payer/account; null = all payers */
  exclusive_payer_id: string | null;
  is_active: boolean;
}

export interface PackageItem {
  id: string;
  clinic_id: string;
  package_id: string;
  item_kind: 'inclusion' | 'exclusion';
  service_id: string | null;
  charge_group_id: string | null;
  bed_type_id: string | null;
  max_quantity: number | null;
  max_amount: number | null;
  // joined labels
  service?: { service_code: string; name: string } | null;
  charge_group?: { code: string; name: string; path: string } | null;
  bed_type?: { code: string; name: string } | null;
}

export interface AdmissionPackage {
  id: string;
  clinic_id: string;
  admission_id: string;
  package_id: string;
  agreed_price: number;
  status: 'active' | 'closed' | 'converted_to_itemized';
  consumed_amount: number;
  overrun_amount: number;
  overrun_flagged_at: string | null;
  billed_bill_id: string | null;
  package?: HospitalPackage;
}

export interface PackageClassPrice {
  id: string;
  clinic_id: string;
  package_id: string;
  bed_type_id: string;
  price: number;
  estimated_cost: number | null;
  bed_type?: { code: string; name: string } | null;
}

export const packageService = {
  // --- masters ---------------------------------------------------------------
  async listPackages(clinicId: string, activeOnly = true): Promise<HospitalPackage[]> {
    let query = supabase.from('packages').select('*').eq('clinic_id', clinicId).order('name');
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return data as HospitalPackage[];
  },

  async createPackage(pkg: Partial<HospitalPackage> & {
    clinic_id: string; name: string; package_price: number;
  }): Promise<HospitalPackage> {
    const { data, error } = await supabase.from('packages').insert(pkg).select().single();
    if (error) throw error;
    return data as HospitalPackage;
  },

  async updatePackage(id: string, patch: Partial<HospitalPackage>): Promise<void> {
    const { error } = await supabase
      .from('packages')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async listItems(packageId: string): Promise<PackageItem[]> {
    const { data, error } = await supabase
      .from('package_items')
      .select('*, service:services_master(service_code, name), charge_group:charge_groups(code, name, path), bed_type:bed_types(code, name)')
      .eq('package_id', packageId)
      .order('item_kind');
    if (error) throw error;
    return data as unknown as PackageItem[];
  },

  async addItem(item: {
    clinic_id: string;
    package_id: string;
    item_kind: 'inclusion' | 'exclusion';
    service_id?: string;
    charge_group_id?: string;
    bed_type_id?: string;
    max_quantity?: number;
    max_amount?: number;
  }): Promise<void> {
    const { error } = await supabase.from('package_items').insert(item);
    if (error) throw error;
  },

  async removeItem(itemId: string): Promise<void> {
    const { error } = await supabase.from('package_items').delete().eq('id', itemId);
    if (error) throw error;
  },

  // --- class-wise package prices ------------------------------------------------
  async listClassPrices(packageId: string): Promise<PackageClassPrice[]> {
    const { data, error } = await supabase
      .from('package_class_prices')
      .select('*, bed_type:bed_types(code, name)')
      .eq('package_id', packageId);
    if (error) throw error;
    return data as unknown as PackageClassPrice[];
  },

  async setClassPrice(params: {
    clinicId: string;
    packageId: string;
    bedTypeId: string;
    price: number;
    estimatedCost?: number;
  }): Promise<void> {
    const { error } = await supabase.from('package_class_prices').upsert(
      {
        clinic_id: params.clinicId,
        package_id: params.packageId,
        bed_type_id: params.bedTypeId,
        price: params.price,
        estimated_cost: params.estimatedCost ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'package_id,bed_type_id' }
    );
    if (error) throw error;
  },

  /** Package price resolution:
      payer+class → payer (all classes) → class price → package base */
  async getPriceForClass(
    pkg: HospitalPackage,
    bedTypeId: string | null,
    payerId?: string | null
  ): Promise<number> {
    if (payerId) {
      const { data: payerRows } = await supabase
        .from('payer_package_prices')
        .select('price, bed_type_id')
        .eq('payer_id', payerId)
        .eq('package_id', pkg.id)
        .eq('is_active', true);
      if (payerRows && payerRows.length > 0) {
        const classMatch = bedTypeId ? payerRows.find((r) => r.bed_type_id === bedTypeId) : undefined;
        if (classMatch) return Number(classMatch.price);
        const allClasses = payerRows.find((r) => r.bed_type_id === null);
        if (allClasses) return Number(allClasses.price);
      }
    }
    if (bedTypeId) {
      const { data } = await supabase
        .from('package_class_prices')
        .select('price')
        .eq('package_id', pkg.id)
        .eq('bed_type_id', bedTypeId)
        .maybeSingle();
      if (data?.price != null) return Number(data.price);
    }
    return pkg.package_price;
  },

  // --- admission assignment -----------------------------------------------------
  async getAdmissionPackage(admissionId: string): Promise<AdmissionPackage | null> {
    const { data, error } = await supabase
      .from('admission_packages')
      .select('*, package:packages(*)')
      .eq('admission_id', admissionId)
      .in('status', ['active', 'closed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as unknown as AdmissionPackage | null;
  },

  async assignPackage(params: {
    clinicId: string;
    admissionId: string;
    packageId: string;
    agreedPrice: number;
    userId?: string;
  }): Promise<AdmissionPackage> {
    const { data, error } = await supabase
      .from('admission_packages')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        package_id: params.packageId,
        agreed_price: params.agreedPrice,
        created_by: params.userId ?? null,
      })
      .select('*, package:packages(*)')
      .single();
    if (error) throw error;
    return data as unknown as AdmissionPackage;
  },

  /** Convert to itemized billing: coverage stops, already-covered lines revert to payable */
  async convertToItemized(assignmentId: string): Promise<void> {
    const { error } = await supabase
      .from('admission_packages')
      .update({ status: 'converted_to_itemized', updated_at: new Date().toISOString() })
      .eq('id', assignmentId);
    if (error) throw error;

    // release covered postings back to itemized billing (only unbilled ones)
    const { error: relErr } = await supabase
      .from('charge_postings')
      .update({ covered_by_package: false, package_assignment_id: null, package_item_id: null })
      .eq('package_assignment_id', assignmentId)
      .eq('status', 'pending');
    if (relErr) throw relErr;
  },
};
