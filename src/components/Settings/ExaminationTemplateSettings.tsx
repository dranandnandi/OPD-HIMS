import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, Search, Stethoscope, Sparkles, Loader2, ChevronDown, ChevronUp, LayoutList, ClipboardPaste } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { examinationTemplateService } from '../../services/examinationTemplateService';
import { ExaminationTemplate, ExaminationSection, ExaminationField } from '../../types';
import { supabase } from '../../lib/supabase';

const SPECIALIZATIONS = [
    'General Medicine',
    'Cardiology',
    'Orthopedics',
    'Dermatology',
    'Gastroenterology',
    'Pulmonology',
    'Neurology',
    'Pediatrics',
    'ENT',
    'Ophthalmology',
    'Gynecology',
    'Urology',
    'Psychiatry',
    'Surgery',
    'Other'
];

const FIELD_TYPES: Array<{ value: ExaminationField['type']; label: string }> = [
    { value: 'text', label: 'Text' },
    { value: 'select', label: 'Dropdown' },
    { value: 'toggle', label: 'Toggle (Present/Absent)' },
    { value: 'textarea', label: 'Textarea' },
];

interface TemplateFormData {
    name: string;
    description: string;
    specialization: string;
    sections: ExaminationSection[];
}

const ExaminationTemplateSettings: React.FC = () => {
    const { user } = useAuth();
    const [templates, setTemplates] = useState<ExaminationTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<ExaminationTemplate | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

    const [referenceText, setReferenceText] = useState('');

    const [formData, setFormData] = useState<TemplateFormData>({
        name: '',
        description: '',
        specialization: '',
        sections: []
    });

    useEffect(() => {
        if (user?.clinicId) {
            loadData();
        }
    }, [user]);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await examinationTemplateService.getTemplates();
            setTemplates(data);
        } catch (error) {
            console.error('Error loading templates:', error);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            specialization: '',
            sections: []
        });
        setReferenceText('');
        setEditingTemplate(null);
        setExpandedSections(new Set());
    };

    const handleEdit = (template: ExaminationTemplate) => {
        setEditingTemplate(template);
        setFormData({
            name: template.name,
            description: template.description || '',
            specialization: template.specialization || '',
            sections: template.templateData.sections.map(s => ({
                ...s,
                fields: s.fields.map(f => ({ ...f }))
            }))
        });
        setExpandedSections(new Set(template.templateData.sections.map(s => s.id)));
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this template?')) {
            try {
                await examinationTemplateService.deleteTemplate(id);
                await loadData();
            } catch (error) {
                console.error('Error deleting template:', error);
                alert('Failed to delete template');
            }
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const templatePayload = {
                name: formData.name,
                description: formData.description || undefined,
                specialization: formData.specialization || undefined,
                templateData: {
                    sections: formData.sections.map(s => ({
                        ...s,
                        fields: s.fields.filter(f => f.label.trim())
                    })).filter(s => s.title.trim())
                },
                isActive: true
            };

            if (editingTemplate) {
                await examinationTemplateService.updateTemplate(editingTemplate.id, templatePayload);
            } else {
                await examinationTemplateService.createTemplate(templatePayload);
            }

            setShowModal(false);
            resetForm();
            await loadData();
        } catch (error) {
            console.error('Error saving template:', error);
            alert('Failed to save template. Make sure the name is unique.');
        }
    };

    // AI Generate
    const handleAIGenerate = async () => {
        if (!supabase) return;
        setAiLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('generate-examination-template', {
                body: {
                    doctorSpecialization: formData.specialization || 'General Medicine',
                    referenceText: referenceText.trim() || undefined,
                }
            });
            if (error) throw new Error(error.message);
            if (data?.success && data?.template?.sections) {
                setFormData(prev => ({
                    ...prev,
                    sections: data.template.sections
                }));
                setExpandedSections(new Set(data.template.sections.map((s: ExaminationSection) => s.id)));
            } else {
                throw new Error(data?.error || 'Failed to generate template');
            }
        } catch (err) {
            console.error('AI generation failed:', err);
            alert('Failed to generate template with AI. Please try again.');
        } finally {
            setAiLoading(false);
        }
    };

    // Section management
    const addSection = () => {
        const sectionId = `section_${Date.now()}`;
        setFormData(prev => ({
            ...prev,
            sections: [...prev.sections, { id: sectionId, title: '', fields: [] }]
        }));
        setExpandedSections(prev => new Set([...prev, sectionId]));
    };

    const updateSectionTitle = (sectionId: string, title: string) => {
        setFormData(prev => ({
            ...prev,
            sections: prev.sections.map(s => s.id === sectionId ? { ...s, title } : s)
        }));
    };

    const removeSection = (sectionId: string) => {
        setFormData(prev => ({
            ...prev,
            sections: prev.sections.filter(s => s.id !== sectionId)
        }));
    };

    const toggleSection = (sectionId: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
        });
    };

    // Field management
    const addField = (sectionId: string) => {
        const fieldKey = `field_${Date.now()}`;
        setFormData(prev => ({
            ...prev,
            sections: prev.sections.map(s => {
                if (s.id !== sectionId) return s;
                return {
                    ...s,
                    fields: [...s.fields, {
                        key: fieldKey,
                        label: '',
                        type: 'text' as const,
                        value: '',
                        placeholder: ''
                    }]
                };
            })
        }));
    };

    const updateField = (sectionId: string, fieldKey: string, updates: Partial<ExaminationField>) => {
        setFormData(prev => ({
            ...prev,
            sections: prev.sections.map(s => {
                if (s.id !== sectionId) return s;
                return {
                    ...s,
                    fields: s.fields.map(f => {
                        if (f.key !== fieldKey) return f;
                        return { ...f, ...updates };
                    })
                };
            })
        }));
    };

    const removeField = (sectionId: string, fieldKey: string) => {
        setFormData(prev => ({
            ...prev,
            sections: prev.sections.map(s => {
                if (s.id !== sectionId) return s;
                return {
                    ...s,
                    fields: s.fields.filter(f => f.key !== fieldKey)
                };
            })
        }));
    };

    const getTotalFieldCount = (sections: ExaminationSection[]) =>
        sections.reduce((sum, s) => sum + s.fields.length, 0);

    const filteredTemplates = templates.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.specialization?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-4 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800">Examination Templates</h2>
                    <p className="text-gray-600 text-sm">Create reusable general & local examination templates for your clinic.</p>
                </div>
                <button
                    onClick={() => { resetForm(); setShowModal(true); }}
                    className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Create Template
                </button>
            </div>

            {/* Search */}
            <div className="bg-white rounded-lg shadow p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search templates by name or specialization..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Template Cards */}
            {filteredTemplates.length === 0 ? (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                    <Stethoscope className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-700 mb-2">No examination templates yet</h3>
                    <p className="text-gray-500 text-sm mb-4">Create your first template to standardize examinations across your clinic.</p>
                    <button
                        onClick={() => { resetForm(); setShowModal(true); }}
                        className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
                    >
                        <Plus className="w-4 h-4" />
                        Create Template
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredTemplates.map(template => (
                        <div key={template.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-5 border border-gray-100">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center gap-2">
                                    <Stethoscope className="w-5 h-5 text-purple-500" />
                                    <h3 className="font-semibold text-lg text-gray-800">{template.name}</h3>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleEdit(template)} className="text-blue-600 hover:bg-blue-50 p-1 rounded">
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(template.id)} className="text-red-600 hover:bg-red-50 p-1 rounded">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {template.description && <p className="text-gray-600 text-sm mb-3">{template.description}</p>}

                            <div className="space-y-2 mb-4">
                                {template.specialization && (
                                    <span className="inline-flex px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                        {template.specialization}
                                    </span>
                                )}
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <LayoutList className="w-4 h-4 text-blue-500" />
                                    <span>{template.templateData.sections.length} sections, {getTotalFieldCount(template.templateData.sections)} fields</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between text-xs text-gray-400 mt-auto pt-3 border-t border-gray-100">
                                <span>Used {template.usageCount} times</span>
                                <span>{template.updatedAt.toLocaleDateString()}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Editor Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-lg max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-lg z-10">
                            <h2 className="text-xl font-bold text-gray-800">
                                {editingTemplate ? 'Edit Template' : 'New Examination Template'}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto flex-1">
                            <form id="templateForm" onSubmit={handleSave} className="space-y-6">
                                {/* Basic Info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
                                        <input
                                            required
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="e.g. General Medicine Examination"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label>
                                        <select
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            value={formData.specialization}
                                            onChange={e => setFormData({ ...formData, specialization: e.target.value })}
                                        >
                                            <option value="">Select specialization...</option>
                                            {SPECIALIZATIONS.map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            placeholder="Brief description of this examination template"
                                        />
                                    </div>
                                </div>

                                {/* AI Assistant Section */}
                                <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <Sparkles className="w-5 h-5 text-purple-600 flex-shrink-0" />
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-purple-800">AI Assistant</p>
                                            <p className="text-xs text-purple-600">Paste an existing examination format below, or just click Generate for a default template</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAIGenerate}
                                            disabled={aiLoading}
                                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 transition-all"
                                        >
                                            {aiLoading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles className="w-4 h-4" />
                                                    {formData.sections.length > 0 ? 'Regenerate' : 'Generate'}
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    {/* Reference Text Paste Area */}
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <ClipboardPaste className="w-3.5 h-3.5 text-purple-600" />
                                            <label className="text-xs font-medium text-purple-700">Paste existing examination format (optional)</label>
                                        </div>
                                        <textarea
                                            value={referenceText}
                                            onChange={e => setReferenceText(e.target.value)}
                                            rows={4}
                                            className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white placeholder-gray-400"
                                            placeholder={`Paste any existing examination proforma or text here, e.g.:\n\nGeneral Examination:\nConsciousness, Pallor, Icterus, Cyanosis, Clubbing, Lymphadenopathy, Edema\n\nLocal Examination:\nSite, Swelling, Tenderness, Range of Motion...`}
                                        />
                                        <p className="text-xs text-purple-500 mt-1">AI will convert this into a structured template with proper sections and field types</p>
                                    </div>
                                </div>

                                {/* Sections */}
                                <div className="border-t pt-4">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="font-semibold text-gray-800">Examination Sections</h3>
                                        <button
                                            type="button"
                                            onClick={addSection}
                                            className="text-purple-600 text-sm hover:underline flex items-center gap-1"
                                        >
                                            <Plus className="w-3 h-3" /> Add Section
                                        </button>
                                    </div>

                                    {formData.sections.length === 0 ? (
                                        <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
                                            <p className="mb-2">No sections yet.</p>
                                            <p className="text-sm">Use AI Generate or add sections manually.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {formData.sections.map((section) => (
                                                <div key={section.id} className="border border-gray-200 rounded-lg overflow-hidden">
                                                    {/* Section Header */}
                                                    <div className="flex items-center gap-2 px-4 py-3 bg-gray-50">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleSection(section.id)}
                                                            className="text-gray-500 hover:text-gray-700"
                                                        >
                                                            {expandedSections.has(section.id) ? (
                                                                <ChevronUp className="w-4 h-4" />
                                                            ) : (
                                                                <ChevronDown className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                        <input
                                                            type="text"
                                                            value={section.title}
                                                            onChange={e => updateSectionTitle(section.id, e.target.value)}
                                                            className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                                            placeholder="Section title (e.g. General Examination)"
                                                        />
                                                        <span className="text-xs text-gray-400">{section.fields.length} fields</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeSection(section.id)}
                                                            className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>

                                                    {/* Section Fields */}
                                                    {expandedSections.has(section.id) && (
                                                        <div className="p-4 space-y-3">
                                                            {section.fields.map((field) => (
                                                                <div key={field.key} className="flex flex-wrap gap-2 items-start p-3 bg-gray-50 rounded border border-gray-200">
                                                                    <div className="flex-1 min-w-[150px]">
                                                                        <label className="text-xs text-gray-500">Label</label>
                                                                        <input
                                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            value={field.label}
                                                                            onChange={e => updateField(section.id, field.key, { label: e.target.value })}
                                                                            placeholder="Field label..."
                                                                        />
                                                                    </div>
                                                                    <div className="w-40">
                                                                        <label className="text-xs text-gray-500">Type</label>
                                                                        <select
                                                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                            value={field.type}
                                                                            onChange={e => updateField(section.id, field.key, {
                                                                                type: e.target.value as ExaminationField['type'],
                                                                                value: e.target.value === 'toggle' ? false : '',
                                                                                options: e.target.value === 'select' ? (field.options || []) : undefined
                                                                            })}
                                                                        >
                                                                            {FIELD_TYPES.map(ft => (
                                                                                <option key={ft.value} value={ft.value}>{ft.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    {field.type === 'select' && (
                                                                        <div className="flex-1 min-w-[200px]">
                                                                            <label className="text-xs text-gray-500">Options (comma separated)</label>
                                                                            <input
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                                value={(field.options || []).join(', ')}
                                                                                onChange={e => updateField(section.id, field.key, {
                                                                                    options: e.target.value.split(',').map(o => o.trim()).filter(Boolean)
                                                                                })}
                                                                                placeholder="Option 1, Option 2, ..."
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    {(field.type === 'text' || field.type === 'textarea') && (
                                                                        <div className="w-40">
                                                                            <label className="text-xs text-gray-500">Placeholder</label>
                                                                            <input
                                                                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                                value={field.placeholder || ''}
                                                                                onChange={e => updateField(section.id, field.key, { placeholder: e.target.value })}
                                                                                placeholder="Hint text..."
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeField(section.id, field.key)}
                                                                        className="text-red-500 hover:bg-red-50 p-1 rounded mt-4"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                            ))}

                                                            {section.fields.length === 0 && (
                                                                <p className="text-gray-500 italic text-sm text-center py-2">No fields in this section.</p>
                                                            )}

                                                            <button
                                                                type="button"
                                                                onClick={() => addField(section.id)}
                                                                className="text-purple-600 text-sm hover:underline flex items-center gap-1"
                                                            >
                                                                <Plus className="w-3 h-3" /> Add Field
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </form>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-6 border-t flex justify-end gap-3 sticky bottom-0 bg-white rounded-b-lg">
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="templateForm"
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
                            >
                                <Save className="w-4 h-4" />
                                Save Template
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExaminationTemplateSettings;
