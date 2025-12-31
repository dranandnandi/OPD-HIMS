import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';

// Prescription Preset interface
export interface PrescriptionPreset {
    id: string;
    clinicId: string;
    name: string;
    description?: string;
    condition?: string;
    tags: string[];
    presetData: {
        medicines: Array<{
            medicine: string;
            dosage: string;
            frequency: string;
            duration: string;
            instructions: string;
        }>;
        advice: string[];
        followUpDays?: number;
    };
    isActive: boolean;
    usageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

// Convert database record to app type
const convertDbPreset = (dbPreset: any): PrescriptionPreset => ({
    id: dbPreset.id,
    clinicId: dbPreset.clinic_id,
    name: dbPreset.name,
    description: dbPreset.description,
    condition: dbPreset.condition,
    tags: dbPreset.tags || [],
    presetData: dbPreset.preset_data || { medicines: [], advice: [] },
    isActive: dbPreset.is_active,
    usageCount: dbPreset.usage_count || 0,
    createdAt: new Date(dbPreset.created_at),
    updatedAt: new Date(dbPreset.updated_at)
});

export const presetService = {
    // Get all presets for the current clinic
    async getPresets(): Promise<PrescriptionPreset[]> {
        if (!supabase) throw new Error('Supabase not initialized');

        const profile = await getCurrentProfile();
        if (!profile?.clinicId) throw new Error('User not assigned to a clinic');

        // First, seed default presets if none exist
        await supabase.rpc('seed_default_presets', { p_clinic_id: profile.clinicId });

        // Fetch all active presets
        const { data, error } = await supabase
            .from('prescription_presets')
            .select('*')
            .eq('clinic_id', profile.clinicId)
            .eq('is_active', true)
            .order('usage_count', { ascending: false });

        if (error) throw new Error('Failed to fetch presets');

        return (data || []).map(convertDbPreset);
    },

    // Get a single preset by ID
    async getPreset(id: string): Promise<PrescriptionPreset | null> {
        if (!supabase) throw new Error('Supabase not initialized');

        const { data, error } = await supabase
            .from('prescription_presets')
            .select('*')
            .eq('id', id)
            .single();

        if (error) return null;
        return convertDbPreset(data);
    },

    // Create a new preset
    async createPreset(preset: Omit<PrescriptionPreset, 'id' | 'clinicId' | 'createdAt' | 'updatedAt' | 'usageCount'>): Promise<PrescriptionPreset> {
        if (!supabase) throw new Error('Supabase not initialized');

        const profile = await getCurrentProfile();
        if (!profile?.clinicId) throw new Error('User not assigned to a clinic');

        const { data, error } = await supabase
            .from('prescription_presets')
            .insert([{
                clinic_id: profile.clinicId,
                name: preset.name,
                description: preset.description,
                condition: preset.condition,
                tags: preset.tags,
                preset_data: preset.presetData,
                is_active: preset.isActive ?? true,
                created_by: profile.id
            }])
            .select()
            .single();

        if (error) throw new Error('Failed to create preset');
        return convertDbPreset(data);
    },

    // Update a preset
    async updatePreset(id: string, updates: Partial<PrescriptionPreset>): Promise<PrescriptionPreset> {
        if (!supabase) throw new Error('Supabase not initialized');

        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.condition !== undefined) dbUpdates.condition = updates.condition;
        if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
        if (updates.presetData !== undefined) dbUpdates.preset_data = updates.presetData;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

        const { data, error } = await supabase
            .from('prescription_presets')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error('Failed to update preset');
        return convertDbPreset(data);
    },

    // Delete a preset (soft delete - set is_active to false)
    async deletePreset(id: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not initialized');

        const { error } = await supabase
            .from('prescription_presets')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw new Error('Failed to delete preset');
    },

    // Increment usage count when a preset is used
    async incrementUsage(id: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not initialized');

        // Simple increment - fetch current value and increment
        try {
            const { data } = await supabase
                .from('prescription_presets')
                .select('usage_count')
                .eq('id', id)
                .single();

            if (data) {
                await supabase
                    .from('prescription_presets')
                    .update({ usage_count: (data.usage_count || 0) + 1 })
                    .eq('id', id);
            }
        } catch {
            // Ignore errors for usage tracking
        }
    },

    // Search presets by name, condition, or tags
    async searchPresets(query: string): Promise<PrescriptionPreset[]> {
        if (!supabase) throw new Error('Supabase not initialized');

        const profile = await getCurrentProfile();
        if (!profile?.clinicId) throw new Error('User not assigned to a clinic');

        const { data, error } = await supabase
            .from('prescription_presets')
            .select('*')
            .eq('clinic_id', profile.clinicId)
            .eq('is_active', true)
            .or(`name.ilike.%${query}%,condition.ilike.%${query}%`)
            .order('usage_count', { ascending: false })
            .limit(10);

        if (error) throw new Error('Failed to search presets');

        return (data || []).map(convertDbPreset);
    }
};

export default presetService;
