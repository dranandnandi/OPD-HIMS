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
  /** what happens when a charge breaches a cap; individual rules may override */
  default_cap_mode: CapMode;
  /** head that absorbs the break-up residual; null = the clinic's flagged head */
  residual_service_id: string | null;
  /** what the residual line prints as; null = the head's own service name */
  residual_label: string | null;
  /** grain of a generated claim break-up */
  breakup_grain: 'charge_group' | 'service';
  is_active: boolean;
}

/**
 * 'split' — the package absorbs the remaining allowance and the excess becomes
 *           a separate patient-payable charge (₹2,000 cap, ₹1,500 used, ₹6,000
 *           charge → ₹500 in, ₹5,500 out)
 * 'block' — the whole charge falls outside the package and the remaining
 *           allowance stays unused (₹0 in, ₹6,000 out)
 */
export type CapMode = 'split' | 'block';

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
  /** null = inherit the package's default_cap_mode */
  cap_mode: CapMode | null;
  // joined labels
  service?: { service_code: string; name: string } | null;
  charge_group?: { code: string; name: string; path: string } | null;
  bed_type?: { code: string; name: string } | null;
}

/**
 * Optional per-package claim break-up template. Empty = build from actuals.
 * A row targets EITHER a charge head (the common case — "Investigations",
 * "OT Charges") or one specific service.
 */
export interface PackageBreakupRule {
  id: string;
  clinic_id: string;
  package_id: string;
  service_id: string | null;
  charge_group_id: string | null;
  mode: 'percent' | 'fixed';
  value: number;
  sort_order: number;
  service?: { service_code: string; name: string } | null;
  charge_group?: { code: string; name: string } | null;
}

/** One line of a generated claim break-up. The residual line is DB-derived. */
export interface PackageBreakupLine {
  id: string;
  clinic_id: string;
  assignment_id: string;
  service_id: string | null;
  charge_group_id: string | null;
  charge_group_path: string | null;
  description: string;
  quantity: number;
  unit_rate: number;
  net: number;
  is_residual: boolean;
  source: 'actual' | 'template' | 'manual' | 'residual';
  sort_order: number;
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
    cap_mode?: CapMode;
  }): Promise<void> {
    const { error } = await supabase.from('package_items').insert(item);
    if (error) throw error;
  },

  /** Flip an existing rule between split-at-limit and exclude-whole-charge. */
  async setItemCapMode(itemId: string, capMode: CapMode): Promise<void> {
    const { error } = await supabase
      .from('package_items')
      .update({ cap_mode: capMode })
      .eq('id', itemId);
    if (error) throw error;
  },

  async removeItem(itemId: string): Promise<void> {
    const { error } = await supabase.from('package_items').delete().eq('id', itemId);
    if (error) throw error;
  },

  /**
   * The head that absorbs the break-up residual: the package's override, else
   * the clinic's service flagged is_package_residual (seeded as PKG-RESID).
   */
  async getResidualHead(
    clinicId: string,
    pkg: Pick<HospitalPackage, 'residual_service_id'>
  ): Promise<{ id: string; service_code: string; name: string } | null> {
    if (pkg.residual_service_id) {
      const { data, error } = await supabase
        .from('services_master')
        .select('id, service_code, name')
        .eq('id', pkg.residual_service_id)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as { id: string; service_code: string; name: string };
    }
    const { data, error } = await supabase
      .from('services_master')
      .select('id, service_code, name')
      .eq('clinic_id', clinicId)
      .eq('is_package_residual', true)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string; service_code: string; name: string } | null) ?? null;
  },

  // --- claim break-up template (masters) ----------------------------------------
  async listBreakupRules(packageId: string): Promise<PackageBreakupRule[]> {
    const { data, error } = await supabase
      .from('package_breakup_rules')
      .select('*, service:services_master(service_code, name), charge_group:charge_groups(code, name)')
      .eq('package_id', packageId)
      // oldest first. created_at breaks ties left by rows saved before
      // sort_order was made collision-proof.
      .order('sort_order')
      .order('created_at');
    if (error) throw error;
    return data as unknown as PackageBreakupRule[];
  },

  /** Pass exactly one of service_id / charge_group_id. */
  async addBreakupRule(rule: {
    clinic_id: string;
    package_id: string;
    service_id?: string;
    charge_group_id?: string;
    mode: 'percent' | 'fixed';
    value: number;
    sort_order?: number;
  }): Promise<void> {
    const { error } = await supabase.from('package_breakup_rules').insert({
      ...rule,
      service_id: rule.service_id ?? null,
      charge_group_id: rule.charge_group_id ?? null,
    });
    if (error) {
      if (/uq_breakup_rule_(service|group)/.test(error.message ?? '')) {
        throw new Error('That head is already in this template.');
      }
      throw error;
    }
  },

  async removeBreakupRule(ruleId: string): Promise<void> {
    const { error } = await supabase.from('package_breakup_rules').delete().eq('id', ruleId);
    if (error) throw error;
  },

  // --- claim break-up for one admission -----------------------------------------
  async listBreakupLines(assignmentId: string): Promise<PackageBreakupLine[]> {
    const { data, error } = await supabase
      .from('admission_package_breakup_lines')
      .select('*')
      .eq('assignment_id', assignmentId)
      // oldest first; the residual sits at sort_order 9999 so it stays last
      .order('sort_order')
      .order('created_at');
    if (error) throw error;
    return data as unknown as PackageBreakupLine[];
  },

  /** (Re)build the break-up. Returns the total, which always equals the agreed price. */
  async generateBreakup(assignmentId: string): Promise<number> {
    const { data, error } = await supabase.rpc('fn_generate_package_breakup', {
      p_assignment_id: assignmentId,
    });
    if (error) throw error;
    return Number(data);
  },

  /**
   * Add a component targeting either a charge head or one service. The
   * residual line rebalances itself in the DB.
   */
  async addBreakupLine(line: {
    clinic_id: string;
    assignment_id: string;
    service_id?: string;
    charge_group_id?: string;
    description: string;
    quantity: number;
    unit_rate: number;
  }): Promise<void> {
    let groupId = line.charge_group_id ?? null;
    let groupPath: string | null = null;

    if (line.service_id) {
      const { data: svc, error: svcErr } = await supabase
        .from('services_master')
        .select('charge_group_id, charge_group:charge_groups(path)')
        .eq('id', line.service_id)
        .single();
      if (svcErr) throw svcErr;
      groupId = (svc as { charge_group_id: string }).charge_group_id;
      groupPath = (svc as unknown as { charge_group?: { path: string } }).charge_group?.path ?? null;
    } else if (groupId) {
      const { data: grp, error: grpErr } = await supabase
        .from('charge_groups')
        .select('path')
        .eq('id', groupId)
        .single();
      if (grpErr) throw grpErr;
      groupPath = (grp as { path: string }).path;
    }

    const { error } = await supabase.from('admission_package_breakup_lines').insert({
      clinic_id: line.clinic_id,
      assignment_id: line.assignment_id,
      service_id: line.service_id ?? null,
      charge_group_id: groupId,
      charge_group_path: groupPath,
      description: line.description,
      quantity: line.quantity,
      unit_rate: line.unit_rate,
      net: Number((line.quantity * line.unit_rate).toFixed(2)),
      source: 'manual',
      sort_order: 500,
    });
    if (error) throw error;
  },

  async updateBreakupLine(lineId: string, patch: { quantity: number; unit_rate: number }): Promise<void> {
    const { error } = await supabase
      .from('admission_package_breakup_lines')
      .update({
        quantity: patch.quantity,
        unit_rate: patch.unit_rate,
        net: Number((patch.quantity * patch.unit_rate).toFixed(2)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', lineId)
      .eq('is_residual', false);
    if (error) throw error;
  },

  /**
   * Rename any line, residual included — the residual's AMOUNT stays derived,
   * only what it prints as changes. Recomputes never touch the description, so
   * the new name survives rebalancing (a full rebuild resets it to the
   * package's default label).
   */
  async renameBreakupLine(lineId: string, description: string): Promise<void> {
    const { error } = await supabase
      .from('admission_package_breakup_lines')
      .update({ description, updated_at: new Date().toISOString() })
      .eq('id', lineId);
    if (error) throw error;
  },

  async removeBreakupLine(lineId: string): Promise<void> {
    const { error } = await supabase
      .from('admission_package_breakup_lines')
      .delete()
      .eq('id', lineId)
      .eq('is_residual', false);
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
