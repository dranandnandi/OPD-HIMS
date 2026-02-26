import { supabase } from '../lib/supabase';
import { getCurrentProfile } from './profileService';
import { ExaminationTemplate } from '../types';

// Convert database record to app type
const convertDbTemplate = (dbTemplate: any): ExaminationTemplate => ({
    id: dbTemplate.id,
    clinicId: dbTemplate.clinic_id,
    name: dbTemplate.name,
    description: dbTemplate.description,
    specialization: dbTemplate.specialization,
    templateData: dbTemplate.template_data || { sections: [] },
    isActive: dbTemplate.is_active,
    usageCount: dbTemplate.usage_count || 0,
    createdBy: dbTemplate.created_by,
    createdAt: new Date(dbTemplate.created_at),
    updatedAt: new Date(dbTemplate.updated_at),
});

export const examinationTemplateService = {
    // Get all active templates for the current clinic
    async getTemplates(specialization?: string): Promise<ExaminationTemplate[]> {
        if (!supabase) throw new Error('Supabase not initialized');

        const profile = await getCurrentProfile();
        if (!profile?.clinicId) throw new Error('User not assigned to a clinic');

        let query = supabase
            .from('examination_templates')
            .select('*')
            .eq('clinic_id', profile.clinicId)
            .eq('is_active', true)
            .order('usage_count', { ascending: false });

        if (specialization) {
            query = query.eq('specialization', specialization);
        }

        const { data, error } = await query;

        if (error) throw new Error('Failed to fetch examination templates');
        return (data || []).map(convertDbTemplate);
    },

    // Get a single template by ID
    async getTemplate(id: string): Promise<ExaminationTemplate | null> {
        if (!supabase) throw new Error('Supabase not initialized');

        const { data, error } = await supabase
            .from('examination_templates')
            .select('*')
            .eq('id', id)
            .single();

        if (error) return null;
        return convertDbTemplate(data);
    },

    // Create a new template
    async createTemplate(
        template: Omit<ExaminationTemplate, 'id' | 'clinicId' | 'createdAt' | 'updatedAt' | 'usageCount'>
    ): Promise<ExaminationTemplate> {
        if (!supabase) throw new Error('Supabase not initialized');

        const profile = await getCurrentProfile();
        if (!profile?.clinicId) throw new Error('User not assigned to a clinic');

        const { data, error } = await supabase
            .from('examination_templates')
            .insert([{
                clinic_id: profile.clinicId,
                name: template.name,
                description: template.description,
                specialization: template.specialization,
                template_data: template.templateData,
                is_active: template.isActive ?? true,
                created_by: profile.id,
            }])
            .select()
            .single();

        if (error) throw new Error('Failed to create examination template');
        return convertDbTemplate(data);
    },

    // Update a template
    async updateTemplate(
        id: string,
        updates: Partial<ExaminationTemplate>
    ): Promise<ExaminationTemplate> {
        if (!supabase) throw new Error('Supabase not initialized');

        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.specialization !== undefined) dbUpdates.specialization = updates.specialization;
        if (updates.templateData !== undefined) dbUpdates.template_data = updates.templateData;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

        const { data, error } = await supabase
            .from('examination_templates')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw new Error('Failed to update examination template');
        return convertDbTemplate(data);
    },

    // Soft-delete a template
    async deleteTemplate(id: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not initialized');

        const { error } = await supabase
            .from('examination_templates')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw new Error('Failed to delete examination template');
    },

    // Increment usage count when a template is loaded into the EMR form
    async incrementUsage(id: string): Promise<void> {
        if (!supabase) throw new Error('Supabase not initialized');

        try {
            const { data } = await supabase
                .from('examination_templates')
                .select('usage_count')
                .eq('id', id)
                .single();

            if (data) {
                await supabase
                    .from('examination_templates')
                    .update({ usage_count: (data.usage_count || 0) + 1 })
                    .eq('id', id);
            }
        } catch {
            // Ignore errors for usage tracking
        }
    },
};

export default examinationTemplateService;
