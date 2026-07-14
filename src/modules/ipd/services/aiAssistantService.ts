import { supabase } from '../utils/supabase';
import { masterService } from './masterService';
import { bedService } from './bedService';
import { packageService } from './packageService';
import { chargeService } from './chargeService';
import { PLACEHOLDER_CATALOG } from './documentService';

export interface AiTemplateResult {
  name: string;
  doc_type: string;
  html_template: string;
  summary: string;
}

// Mirrors the edge function's structured-output schema
export interface AiPlan {
  summary: string;
  wards: Array<{ name: string; floor: string | null; ward_type: string }>;
  bed_types: Array<{
    code: string; name: string; daily_rent: number;
    rate_multiplier: number; is_critical_care: boolean;
  }>;
  beds: Array<{
    ward_name: string; bed_type: string; count: number;
    number_prefix: string; start_number: number;
  }>;
  services: Array<{
    service_code: string; name: string; charge_group_code: string;
    price: number; cost: number | null; is_sharable: boolean;
  }>;
  service_class_rates: Array<{
    service_code: string; bed_type: string; rate: number;
  }>;
  packages: Array<{
    name: string; price: number; estimated_cost: number | null;
    stay_days: number | null; per_day_bed_cap: number | null; implant_cap: number | null;
    inclusions: Array<{
      charge_group_code: string | null; service_code: string | null;
      bed_type: string | null; max_amount: number | null; max_quantity: number | null;
    }>;
    exclusions: Array<{ charge_group_code: string | null; service_code: string | null }>;
    class_prices: Array<{ bed_type: string; price: number }>;
  }>;
}

export const aiAssistantService = {
  /** Ask the edge function (Claude Haiku) to turn plain English into a plan */
  async generatePlan(clinicId: string, instruction: string): Promise<AiPlan> {
    const [groups, bedTypes, wards, allServices] = await Promise.all([
      chargeService.listChargeGroups(clinicId),
      bedService.listBedTypes(clinicId),
      bedService.listWards(clinicId),
      masterService.listAllServices(clinicId),
    ]);

    const { data, error } = await supabase.functions.invoke('ai-masters-assistant', {
      body: {
        instruction,
        context: {
          chargeGroups: groups.map((g) => ({ code: g.code, name: g.name })),
          bedTypes: bedTypes.map((b) => ({ code: b.code, name: b.name, multiplier: b.rate_multiplier ?? 1 })),
          wards: wards.map((w) => w.name),
          services: allServices
            .filter((s) => s.is_active)
            .map((s) => ({ code: s.service_code, name: s.name, price: s.base_price })),
        },
      },
    });
    if (error) throw new Error(error.message ?? 'AI assistant call failed');
    if (data?.error) throw new Error(data.error);
    return data.plan as AiPlan;
  },

  /**
   * Generate (or revise) a document template from plain English.
   * Pass `current` when a template is open in the Studio — the AI then
   * treats the request as a revision of that template.
   */
  async generateTemplate(params: {
    instruction: string;
    current?: { name: string; doc_type: string; html: string };
  }): Promise<AiTemplateResult> {
    const { data, error } = await supabase.functions.invoke('ai-template-assistant', {
      body: {
        instruction: params.instruction,
        placeholders: PLACEHOLDER_CATALOG,
        current: params.current ?? null,
      },
    });
    if (error) throw new Error(error.message ?? 'AI template call failed');
    if (data?.error) throw new Error(data.error);
    return data.template as AiTemplateResult;
  },

  /** Execute a confirmed plan through the normal services (RLS applies). */
  async executePlan(clinicId: string, plan: AiPlan): Promise<string[]> {
    const log: string[] = [];

    // 1. bed types (may be referenced by beds/packages below)
    for (const bt of plan.bed_types) {
      await masterService.createBedType({
        clinicId,
        code: bt.code,
        name: bt.name,
        dailyRent: bt.daily_rent,
        rateMultiplier: bt.rate_multiplier,
        isCriticalCare: bt.is_critical_care,
      });
      log.push(`Bed class "${bt.name}" (₹${bt.daily_rent}/day, ×${bt.rate_multiplier})`);
    }

    // 2. wards
    for (const w of plan.wards) {
      await masterService.createWard({
        clinic_id: clinicId,
        name: w.name,
        floor: w.floor,
        ward_type: w.ward_type as never,
      });
      log.push(`Ward "${w.name}"${w.floor ? ` (floor ${w.floor})` : ''}`);
    }

    // refresh lookups after creations
    const [bedTypes, wards, groups, services] = await Promise.all([
      bedService.listBedTypes(clinicId),
      bedService.listWards(clinicId),
      chargeService.listChargeGroups(clinicId),
      masterService.listAllServices(clinicId),
    ]);
    const findBedType = (ref: string) =>
      bedTypes.find(
        (b) => b.code.toLowerCase() === ref.toLowerCase() || b.name.toLowerCase() === ref.toLowerCase()
      );
    const findWard = (name: string) => wards.find((w) => w.name.toLowerCase() === name.toLowerCase());
    const findGroup = (code: string) => groups.find((g) => g.code.toLowerCase() === code.toLowerCase());
    const findService = (code: string) =>
      services.find((s) => s.service_code.toLowerCase() === code.toLowerCase());

    // 3. beds
    for (const b of plan.beds) {
      const ward = findWard(b.ward_name);
      const bedType = findBedType(b.bed_type);
      if (!ward || !bedType) {
        log.push(`⚠ Skipped ${b.count} beds — ward "${b.ward_name}" or class "${b.bed_type}" not found`);
        continue;
      }
      for (let i = 0; i < b.count; i++) {
        await masterService.createBed({
          clinic_id: clinicId,
          ward_id: ward.id,
          bed_number: `${b.number_prefix}${b.start_number + i}`,
          bed_type_id: bedType.id,
        });
      }
      log.push(`${b.count} × ${bedType.name} beds in "${ward.name}" (${b.number_prefix}${b.start_number}…)`);
    }

    // 4. services
    for (const s of plan.services) {
      const group = findGroup(s.charge_group_code);
      if (!group) {
        log.push(`⚠ Skipped service "${s.name}" — charge group ${s.charge_group_code} not found`);
        continue;
      }
      await masterService.createService({
        clinic_id: clinicId,
        service_code: s.service_code.toUpperCase(),
        name: s.name,
        charge_group_id: group.id,
        base_price: s.price,
        base_cost: s.cost ?? 0,
        is_sharable: s.is_sharable,
      });
      log.push(`Service ${s.service_code.toUpperCase()} — ${s.name} (₹${s.price})`);
    }

    // 4b. class-wise service rates (explicit rate card entries)
    if (plan.service_class_rates.length > 0) {
      const freshServices = await masterService.listAllServices(clinicId);
      for (const r of plan.service_class_rates) {
        const svc = freshServices.find(
          (s) => s.service_code.toLowerCase() === r.service_code.toLowerCase() ||
                 s.name.toLowerCase() === r.service_code.toLowerCase()
        );
        const bt = findBedType(r.bed_type);
        if (!svc || !bt) {
          log.push(`⚠ Skipped class rate — service "${r.service_code}" or class "${r.bed_type}" not found`);
          continue;
        }
        await masterService.setServiceClassRate(clinicId, svc.id, bt.id, r.rate);
        log.push(`Class rate: ${svc.service_code} @ ${bt.name} = ₹${r.rate}`);
      }
    }

    // 5. packages
    for (const p of plan.packages) {
      const pkg = await packageService.createPackage({
        clinic_id: clinicId,
        name: p.name,
        package_price: p.price,
        estimated_cost: p.estimated_cost ?? undefined,
        default_stay_days: p.stay_days ?? undefined,
        per_day_bed_cap: p.per_day_bed_cap ?? undefined,
        implant_cap: p.implant_cap ?? undefined,
      });

      for (const item of [...p.inclusions.map((i) => ({ ...i, kind: 'inclusion' as const })),
                          ...p.exclusions.map((e) => ({ ...e, kind: 'exclusion' as const, bed_type: null, max_amount: null, max_quantity: null }))]) {
        const group = item.charge_group_code ? findGroup(item.charge_group_code) : undefined;
        const svc = item.service_code ? findService(item.service_code) : undefined;
        if (!group && !svc) continue;
        await packageService.addItem({
          clinic_id: clinicId,
          package_id: pkg.id,
          item_kind: item.kind,
          charge_group_id: group?.id,
          service_id: svc?.id,
          bed_type_id: item.bed_type ? findBedType(item.bed_type)?.id : undefined,
          max_amount: item.max_amount ?? undefined,
          max_quantity: item.max_quantity ?? undefined,
        });
      }

      for (const cp of p.class_prices) {
        const bt = findBedType(cp.bed_type);
        if (!bt) continue;
        await packageService.setClassPrice({
          clinicId,
          packageId: pkg.id,
          bedTypeId: bt.id,
          price: cp.price,
        });
      }
      log.push(`Package "${p.name}" (₹${p.price.toLocaleString('en-IN')}, ${p.inclusions.length} inclusions, ${p.class_prices.length} class prices)`);
    }

    return log;
  },
};
