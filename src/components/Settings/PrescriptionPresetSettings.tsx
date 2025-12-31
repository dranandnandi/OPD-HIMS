import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X, Zap, Search, Pill, FileText, Clock } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { presetService, PrescriptionPreset } from '../../services/presetService';
import { masterDataService } from '../../services/masterDataService';
import { MedicineWithPrice } from '../../types';

const PrescriptionPresetSettings: React.FC = () => {
    const { user } = useAuth();
    const [presets, setPresets] = useState<PrescriptionPreset[]>([]);
    const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingPreset, setEditingPreset] = useState<PrescriptionPreset | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Form State
    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        condition: string;
        tags: string;
        medicines: Array<{
            medicine: string;
            dosage: string;
            frequency: string;
            duration: string;
            instructions: string;
        }>;
        advice: string[];
        followUpDays: string;
    }>({
        name: '',
        description: '',
        condition: '',
        tags: '',
        medicines: [],
        advice: [],
        followUpDays: ''
    });

    useEffect(() => {
        if (user?.clinicId) {
            loadData();
        }
    }, [user]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [presetsData, medicinesData] = await Promise.all([
                presetService.getPresets(),
                masterDataService.getMedicines(user?.clinicId)
            ]);
            setPresets(presetsData);
            setMedicines(medicinesData);
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setFormData({
            name: '',
            description: '',
            condition: '',
            tags: '',
            medicines: [],
            advice: [],
            followUpDays: ''
        });
        setEditingPreset(null);
    };

    const handleEdit = (preset: PrescriptionPreset) => {
        setEditingPreset(preset);
        setFormData({
            name: preset.name,
            description: preset.description || '',
            condition: preset.condition || '',
            tags: preset.tags.join(', '),
            medicines: preset.presetData.medicines.map(m => ({ ...m })),
            advice: [...preset.presetData.advice],
            followUpDays: preset.presetData.followUpDays?.toString() || ''
        });
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this preset?')) {
            try {
                await presetService.deletePreset(id);
                await loadData();
            } catch (error) {
                console.error('Error deleting preset:', error);
                alert('Failed to delete preset');
            }
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const presetData = {
                name: formData.name,
                description: formData.description,
                condition: formData.condition,
                tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
                presetData: {
                    medicines: formData.medicines.filter(m => m.medicine),
                    advice: formData.advice.filter(a => a.trim()),
                    followUpDays: formData.followUpDays ? parseInt(formData.followUpDays) : undefined
                },
                isActive: true
            };

            if (editingPreset) {
                await presetService.updatePreset(editingPreset.id, presetData);
            } else {
                await presetService.createPreset(presetData);
            }

            setShowModal(false);
            resetForm();
            await loadData();
        } catch (error) {
            console.error('Error saving preset:', error);
            alert('Failed to save preset');
        }
    };

    const addMedicine = () => {
        setFormData(prev => ({
            ...prev,
            medicines: [...prev.medicines, {
                medicine: '',
                dosage: '1 tablet',
                frequency: 'BD',
                duration: '5 days',
                instructions: 'After meals'
            }]
        }));
    };

    const updateMedicine = (index: number, field: string, value: string) => {
        const newMedicines = [...formData.medicines];
        newMedicines[index] = { ...newMedicines[index], [field]: value };
        setFormData(prev => ({ ...prev, medicines: newMedicines }));
    };

    const removeMedicine = (index: number) => {
        setFormData(prev => ({
            ...prev,
            medicines: prev.medicines.filter((_, i) => i !== index)
        }));
    };

    const addAdvice = () => {
        setFormData(prev => ({ ...prev, advice: [...prev.advice, ''] }));
    };

    const updateAdvice = (index: number, value: string) => {
        const newAdvice = [...formData.advice];
        newAdvice[index] = value;
        setFormData(prev => ({ ...prev, advice: newAdvice }));
    };

    const removeAdvice = (index: number) => {
        setFormData(prev => ({
            ...prev,
            advice: prev.advice.filter((_, i) => i !== index)
        }));
    };

    const filteredPresets = presets.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.condition?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-4 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800">Prescription Presets</h2>
                    <p className="text-gray-600 text-sm">Create templates for common conditions to speed up prescribing.</p>
                </div>
                <button
                    onClick={() => { resetForm(); setShowModal(true); }}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Create Preset
                </button>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search presets by name, condition, or tags..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPresets.map(preset => (
                    <div key={preset.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow p-5 border border-gray-100">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                                <Zap className="w-5 h-5 text-amber-500 fill-current" />
                                <h3 className="font-semibold text-lg text-gray-800">{preset.name}</h3>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(preset)} className="text-blue-600 hover:bg-blue-50 p-1 rounded">
                                    <Edit className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(preset.id)} className="text-red-600 hover:bg-red-50 p-1 rounded">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {preset.description && <p className="text-gray-600 text-sm mb-3">{preset.description}</p>}

                        <div className="space-y-2 mb-4">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Pill className="w-4 h-4 text-purple-500" />
                                <span>{preset.presetData.medicines.length} Medicines</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                <FileText className="w-4 h-4 text-green-500" />
                                <span>{preset.presetData.advice.length} Advice points</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-auto">
                            {preset.tags.map(tag => (
                                <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-lg max-w-4xl w-full my-8 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-lg z-10">
                            <h2 className="text-xl font-bold text-gray-800">{editingPreset ? 'Edit Preset' : 'New Preset'}</h2>
                            <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-full">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1">
                            <form id="presetForm" onSubmit={handleSave} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Preset Name *</label>
                                        <input
                                            required
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="e.g. Viral Fever Protocol"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Condition/Diagnosis</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            value={formData.condition}
                                            onChange={e => setFormData({ ...formData, condition: e.target.value })}
                                            placeholder="e.g. Viral Pyrexia"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            placeholder="Brief description of when to use this preset"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma separated)</label>
                                        <input
                                            type="text"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            value={formData.tags}
                                            onChange={e => setFormData({ ...formData, tags: e.target.value })}
                                            placeholder="fever, adult, seasonal"
                                        />
                                    </div>
                                </div>

                                <div className="border-t pt-4">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="font-semibold text-gray-800">Medicines</h3>
                                        <button type="button" onClick={addMedicine} className="text-blue-600 text-sm hover:underline flex items-center gap-1">
                                            <Plus className="w-3 h-3" /> Add Medicine
                                        </button>
                                    </div>
                                    <div className="space-y-3">
                                        {formData.medicines.map((med, idx) => (
                                            <div key={idx} className="flex flex-wrap gap-2 items-start p-3 bg-gray-50 rounded border border-gray-200">
                                                <div className="flex-1 min-w-[200px]">
                                                    <label className="text-xs text-gray-500">Medicine Name</label>
                                                    <input
                                                        list={`med-list-${idx}`}
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        value={med.medicine}
                                                        onChange={e => updateMedicine(idx, 'medicine', e.target.value)}
                                                        placeholder="Type to search..."
                                                    />
                                                    <datalist id={`med-list-${idx}`}>
                                                        {medicines.map(m => <option key={m.id} value={m.name}>{m.genericName}</option>)}
                                                    </datalist>
                                                </div>
                                                <div className="w-24">
                                                    <label className="text-xs text-gray-500">Dosage</label>
                                                    <input
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        value={med.dosage}
                                                        onChange={e => updateMedicine(idx, 'dosage', e.target.value)}
                                                        placeholder="500mg"
                                                    />
                                                </div>
                                                <div className="w-32">
                                                    <label className="text-xs text-gray-500">Frequency</label>
                                                    <select
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        value={med.frequency}
                                                        onChange={e => updateMedicine(idx, 'frequency', e.target.value)}
                                                    >
                                                        <option value="OD">OD (Once)</option>
                                                        <option value="BD">BD (Twice)</option>
                                                        <option value="TID">TID (Thrice)</option>
                                                        <option value="QID">QID (Four)</option>
                                                        <option value="PRN">PRN (SOS)</option>
                                                        <option value="STAT">STAT (Now)</option>
                                                    </select>
                                                </div>
                                                <div className="w-24">
                                                    <label className="text-xs text-gray-500">Duration</label>
                                                    <input
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        value={med.duration}
                                                        onChange={e => updateMedicine(idx, 'duration', e.target.value)}
                                                        placeholder="5 days"
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-[150px]">
                                                    <label className="text-xs text-gray-500">Instructions</label>
                                                    <input
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        value={med.instructions}
                                                        onChange={e => updateMedicine(idx, 'instructions', e.target.value)}
                                                        placeholder="After food"
                                                    />
                                                </div>
                                                <button type="button" onClick={() => removeMedicine(idx)} className="text-red-500 hover:bg-red-50 p-1 rounded mt-4">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                        {formData.medicines.length === 0 && <p className="text-gray-500 italic text-sm">No medicines added.</p>}
                                    </div>
                                </div>

                                <div className="border-t pt-4">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="font-semibold text-gray-800">Advice & Follow-up</h3>
                                        <button type="button" onClick={addAdvice} className="text-blue-600 text-sm hover:underline flex items-center gap-1">
                                            <Plus className="w-3 h-3" /> Add Advice
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {formData.advice.map((adv, idx) => (
                                            <div key={idx} className="flex gap-2">
                                                <input
                                                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                                                    value={adv}
                                                    onChange={e => updateAdvice(idx, e.target.value)}
                                                    placeholder="Enter advice..."
                                                />
                                                <button type="button" onClick={() => removeAdvice(idx)} className="text-red-500 hover:bg-red-50 p-2 rounded">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                        {formData.advice.length === 0 && <p className="text-gray-500 italic text-sm">No advice added.</p>}
                                    </div>
                                    <div className="mt-4 max-w-xs">
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Days</label>
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-gray-500" />
                                            <input
                                                type="number"
                                                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                value={formData.followUpDays}
                                                onChange={e => setFormData({ ...formData, followUpDays: e.target.value })}
                                                placeholder="e.g. 7"
                                            />
                                            <span className="text-sm text-gray-500">days</span>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>

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
                                form="presetForm"
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                            >
                                <Save className="w-4 h-4" />
                                Save Preset
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PrescriptionPresetSettings;
