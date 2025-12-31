import React, { useState } from 'react';
import { Sparkles, Plus, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { PhysicalExamination, ExaminationSection, ExaminationField } from '../../types';
import { supabase } from '../../lib/supabase';

interface PhysicalExaminationSectionProps {
    examination: PhysicalExamination | undefined;
    onChange: (examination: PhysicalExamination) => void;
    doctorSpecialization?: string;
    chiefComplaint?: string;
    symptoms?: string[];
    patientAge?: number;
    patientGender?: string;
}

const PhysicalExaminationSection: React.FC<PhysicalExaminationSectionProps> = ({
    examination,
    onChange,
    doctorSpecialization,
    chiefComplaint,
    symptoms,
    patientAge,
    patientGender
}) => {
    const [loading, setLoading] = useState(false);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['general']));
    const [error, setError] = useState<string | null>(null);

    const generateTemplate = async () => {
        if (!supabase) {
            setError('Database not connected');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: fnError } = await supabase.functions.invoke('generate-examination-template', {
                body: {
                    doctorSpecialization: doctorSpecialization || 'General Medicine',
                    chiefComplaint,
                    symptoms,
                    patientAge,
                    patientGender
                }
            });

            if (fnError) throw new Error(fnError.message);

            if (data?.success && data?.template) {
                onChange(data.template);
                // Expand all sections when generated
                const allSectionIds = new Set<string>(data.template.sections?.map((s: ExaminationSection) => s.id) || []);
                setExpandedSections(allSectionIds);
            } else {
                throw new Error(data?.error || 'Failed to generate template');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate examination template');
        } finally {
            setLoading(false);
        }
    };

    const toggleSection = (sectionId: string) => {
        const newExpanded = new Set(expandedSections);
        if (newExpanded.has(sectionId)) {
            newExpanded.delete(sectionId);
        } else {
            newExpanded.add(sectionId);
        }
        setExpandedSections(newExpanded);
    };

    const updateField = (sectionId: string, fieldKey: string, value: string | boolean) => {
        if (!examination?.sections) return;

        const updatedSections = examination.sections.map(section => {
            if (section.id !== sectionId) return section;
            return {
                ...section,
                fields: section.fields.map(field => {
                    if (field.key !== fieldKey) return field;
                    return { ...field, value };
                })
            };
        });

        onChange({ ...examination, sections: updatedSections });
    };

    const addCustomField = (sectionId: string) => {
        if (!examination?.sections) return;

        const fieldKey = `custom_${Date.now()}`;
        const newField: ExaminationField = {
            key: fieldKey,
            label: 'New Field',
            type: 'text',
            value: '',
            placeholder: 'Enter value...'
        };

        const updatedSections = examination.sections.map(section => {
            if (section.id !== sectionId) return section;
            return {
                ...section,
                fields: [...section.fields, newField]
            };
        });

        onChange({ ...examination, sections: updatedSections });
    };

    const removeField = (sectionId: string, fieldKey: string) => {
        if (!examination?.sections) return;

        const updatedSections = examination.sections.map(section => {
            if (section.id !== sectionId) return section;
            return {
                ...section,
                fields: section.fields.filter(field => field.key !== fieldKey)
            };
        });

        onChange({ ...examination, sections: updatedSections });
    };

    const updateFieldLabel = (sectionId: string, fieldKey: string, label: string) => {
        if (!examination?.sections) return;

        const updatedSections = examination.sections.map(section => {
            if (section.id !== sectionId) return section;
            return {
                ...section,
                fields: section.fields.map(field => {
                    if (field.key !== fieldKey) return field;
                    return { ...field, label };
                })
            };
        });

        onChange({ ...examination, sections: updatedSections });
    };

    const addSection = () => {
        const sectionId = `custom_section_${Date.now()}`;
        const newSection: ExaminationSection = {
            id: sectionId,
            title: 'New Section',
            fields: []
        };

        const updatedSections = [...(examination?.sections || []), newSection];
        onChange({ ...examination, sections: updatedSections } as PhysicalExamination);
        setExpandedSections(new Set([...expandedSections, sectionId]));
    };

    const removeSection = (sectionId: string) => {
        if (!examination?.sections) return;

        const updatedSections = examination.sections.filter(s => s.id !== sectionId);
        onChange({ ...examination, sections: updatedSections });
    };

    const renderField = (sectionId: string, field: ExaminationField) => {
        const isCustom = field.key.startsWith('custom_');

        return (
            <div key={field.key} className="flex items-start gap-2 mb-3">
                <div className="flex-1">
                    {isCustom ? (
                        <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateFieldLabel(sectionId, field.key, e.target.value)}
                            className="block text-xs font-medium text-gray-700 mb-1 px-1 py-0.5 border-b border-dashed border-gray-300 focus:border-blue-500 outline-none"
                            placeholder="Field name..."
                        />
                    ) : (
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {field.label}
                        </label>
                    )}

                    {field.type === 'text' && (
                        <input
                            type="text"
                            value={field.value as string}
                            onChange={(e) => updateField(sectionId, field.key, e.target.value)}
                            placeholder={field.placeholder}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    )}

                    {field.type === 'textarea' && (
                        <textarea
                            value={field.value as string}
                            onChange={(e) => updateField(sectionId, field.key, e.target.value)}
                            placeholder={field.placeholder}
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    )}

                    {field.type === 'select' && field.options && (
                        <select
                            value={field.value as string}
                            onChange={(e) => updateField(sectionId, field.key, e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="">Select...</option>
                            {field.options.map(option => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    )}

                    {field.type === 'toggle' && (
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => updateField(sectionId, field.key, !field.value)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${field.value ? 'bg-blue-600' : 'bg-gray-200'
                                    }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${field.value ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                            <span className="text-sm text-gray-600">
                                {field.value ? 'Present' : 'Absent'}
                            </span>
                        </div>
                    )}
                </div>

                <button
                    onClick={() => removeField(sectionId, field.key)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors mt-6"
                    title="Remove field"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        );
    };

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">Physical Examination</h3>
                    </div>

                    <button
                        onClick={generateTemplate}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 transition-all"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                {examination?.sections?.length ? 'Regenerate' : 'Generate Template'}
                            </>
                        )}
                    </button>
                </div>

                {error && (
                    <p className="text-red-600 text-sm mt-2">{error}</p>
                )}
            </div>

            {/* Sections */}
            <div className="p-4">
                {!examination?.sections?.length ? (
                    <div className="text-center py-8 text-gray-500">
                        <p className="mb-2">No examination data yet.</p>
                        <p className="text-sm">Click "Generate Template" to create an AI-powered examination form based on the patient's condition and doctor's specialization.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {examination.sections.map(section => (
                            <div key={section.id} className="border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => toggleSection(section.id)}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                                >
                                    <span className="font-medium text-gray-700">{section.title}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500">
                                            {section.fields.filter(f => f.value).length}/{section.fields.length} filled
                                        </span>
                                        {expandedSections.has(section.id) ? (
                                            <ChevronUp className="w-4 h-4 text-gray-500" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-gray-500" />
                                        )}
                                    </div>
                                </button>

                                {expandedSections.has(section.id) && (
                                    <div className="p-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                            {section.fields.map(field => renderField(section.id, field))}
                                        </div>

                                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                                            <button
                                                onClick={() => addCustomField(section.id)}
                                                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                                            >
                                                <Plus className="w-4 h-4" />
                                                Add Field
                                            </button>

                                            <button
                                                onClick={() => removeSection(section.id)}
                                                className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 ml-auto"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Remove Section
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Add Section Button */}
                        <button
                            onClick={addSection}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Add Custom Section
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PhysicalExaminationSection;
