import { supabase } from '../utils/supabase';
import type { DietChartEntry, DietOrder, DietRoute, DietType, MealSlot } from '../types/ipd';

/** Diet chart — a standing diet order (what the patient is allowed) plus the
    meal-wise service record the nurse ticks off each day. */

export const MEAL_SLOTS: Array<{ key: MealSlot; label: string; time: string }> = [
  { key: 'early_morning', label: 'Early morning', time: '06:00' },
  { key: 'breakfast', label: 'Breakfast', time: '08:00' },
  { key: 'mid_morning', label: 'Mid morning', time: '11:00' },
  { key: 'lunch', label: 'Lunch', time: '13:00' },
  { key: 'evening', label: 'Evening', time: '16:30' },
  { key: 'dinner', label: 'Dinner', time: '20:00' },
  { key: 'bedtime', label: 'Bedtime', time: '22:00' },
];

export const DIET_TYPES: Array<{ key: DietType; label: string }> = [
  { key: 'normal', label: 'Normal / full diet' },
  { key: 'soft', label: 'Soft diet' },
  { key: 'semi_solid', label: 'Semi-solid' },
  { key: 'liquid', label: 'Liquid diet' },
  { key: 'diabetic', label: 'Diabetic diet' },
  { key: 'renal', label: 'Renal diet' },
  { key: 'cardiac', label: 'Cardiac diet' },
  { key: 'low_salt', label: 'Salt restricted' },
  { key: 'high_protein', label: 'High protein' },
  { key: 'low_fat', label: 'Low fat' },
  { key: 'bland', label: 'Bland diet' },
  { key: 'pediatric', label: 'Pediatric' },
  { key: 'npo', label: 'NPO — nil by mouth' },
  { key: 'other', label: 'Other' },
];

export const DIET_ROUTES: Array<{ key: DietRoute; label: string }> = [
  { key: 'oral', label: 'Oral' },
  { key: 'ryles_tube', label: "Ryle's tube" },
  { key: 'peg', label: 'PEG' },
  { key: 'npo', label: 'NPO' },
  { key: 'tpn', label: 'TPN (parenteral)' },
];

export interface DietOrderInput {
  dietType: DietType;
  route: DietRoute;
  caloriesKcal?: number | null;
  proteinG?: number | null;
  fluidRestrictionMl?: number | null;
  specialInstructions?: string | null;
  restrictions?: string | null;
  startDate?: string;
  treatmentPlanId?: string | null;
}

export const dietService = {
  async listOrders(admissionId: string): Promise<DietOrder[]> {
    const { data, error } = await supabase
      .from('ipd_diet_orders')
      .select('*')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as DietOrder[];
  },

  async activeOrder(admissionId: string): Promise<DietOrder | null> {
    const { data, error } = await supabase
      .from('ipd_diet_orders')
      .select('*')
      .eq('admission_id', admissionId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as DietOrder) ?? null;
  },

  /** A new diet order supersedes the running one — only one diet is in force. */
  async setOrder(params: {
    clinicId: string;
    admissionId: string;
    input: DietOrderInput;
    userId?: string;
  }): Promise<DietOrder> {
    const { input } = params;
    await supabase
      .from('ipd_diet_orders')
      .update({
        status: 'stopped',
        end_date: new Date().toISOString().slice(0, 10),
        stopped_reason: 'Superseded by a new diet order',
        updated_at: new Date().toISOString(),
      })
      .eq('admission_id', params.admissionId)
      .eq('status', 'active');

    const { data, error } = await supabase
      .from('ipd_diet_orders')
      .insert({
        clinic_id: params.clinicId,
        admission_id: params.admissionId,
        treatment_plan_id: input.treatmentPlanId ?? null,
        diet_type: input.dietType,
        route: input.route,
        calories_kcal: input.caloriesKcal ?? null,
        protein_g: input.proteinG ?? null,
        fluid_restriction_ml: input.fluidRestrictionMl ?? null,
        special_instructions: input.specialInstructions ?? null,
        restrictions: input.restrictions ?? null,
        start_date: input.startDate ?? new Date().toISOString().slice(0, 10),
        ordered_by: params.userId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as DietOrder;
  },

  async stopOrder(orderId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('ipd_diet_orders')
      .update({
        status: 'stopped',
        end_date: new Date().toISOString().slice(0, 10),
        stopped_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    if (error) throw error;
  },

  // --- meal-wise chart -------------------------------------------------------

  async listEntries(admissionId: string, days = 7): Promise<DietChartEntry[]> {
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    const { data, error } = await supabase
      .from('ipd_diet_chart_entries')
      .select('*')
      .eq('admission_id', admissionId)
      .gte('entry_date', from.toISOString().slice(0, 10))
      .order('entry_date', { ascending: false });
    if (error) throw error;
    return data as DietChartEntry[];
  },

  /** One row per (date, meal) — upserted so a nurse can correct an entry */
  async recordMeal(params: {
    clinicId: string;
    admissionId: string;
    dietOrderId?: string | null;
    entryDate: string;
    meal: MealSlot;
    items?: string | null;
    status: DietChartEntry['status'];
    intakePercent?: number | null;
    notes?: string | null;
    userId?: string;
  }): Promise<DietChartEntry> {
    const served = params.status === 'served';
    const { data, error } = await supabase
      .from('ipd_diet_chart_entries')
      .upsert(
        {
          clinic_id: params.clinicId,
          admission_id: params.admissionId,
          diet_order_id: params.dietOrderId ?? null,
          entry_date: params.entryDate,
          meal: params.meal,
          items: params.items ?? null,
          status: params.status,
          intake_percent: params.intakePercent ?? null,
          notes: params.notes ?? null,
          served_by: served ? params.userId ?? null : null,
          served_at: served ? new Date().toISOString() : null,
          created_by: params.userId ?? null,
        },
        { onConflict: 'admission_id,entry_date,meal' }
      )
      .select()
      .single();
    if (error) throw error;
    return data as DietChartEntry;
  },
};
