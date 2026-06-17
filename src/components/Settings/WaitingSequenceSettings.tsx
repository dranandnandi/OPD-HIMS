import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Layers,
  ListChecks,
  MessageCircle,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Timer,
  Trash2
} from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { waitingSequenceService, WaitingSequence } from '../../services/waitingSequenceService';
import { clinicSettingsService } from '../../services/clinicSettingsService';

interface GroupedSequences {
  [conditionType: string]: WaitingSequence[];
}

const sortConditionTypes = (types: string[]) =>
  types.sort((a, b) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b)));

const formatDelay = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const getSequenceHealth = (steps: WaitingSequence[]) => {
  if (steps.length === 0) {
    return { label: 'Empty', className: 'bg-gray-100 text-gray-600 border-gray-200' };
  }

  if (steps.some(step => !step.message.trim())) {
    return { label: 'Needs text', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  }

  if (steps.every(step => !step.isActive)) {
    return { label: 'Paused', className: 'bg-gray-100 text-gray-600 border-gray-200' };
  }

  return { label: 'Ready', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};

const WaitingSequenceSettings: React.FC = () => {
  const { user } = useAuth();
  const [sequences, setSequences] = useState<WaitingSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newConditionType, setNewConditionType] = useState('');
  const [showAddType, setShowAddType] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [selectedConditionType, setSelectedConditionType] = useState('General');

  const checkEnabled = async () => {
    try {
      const settings = await clinicSettingsService.getOrCreateClinicSettings();
      setFeatureEnabled(settings?.waitingSequenceEnabled ?? false);
    } catch {
      setFeatureEnabled(false);
    }
  };

  const load = async () => {
    if (!user?.clinicId) return;

    try {
      setLoading(true);
      const data = await waitingSequenceService.getAll(user.clinicId);
      setSequences(data);
    } catch (err) {
      console.error('Failed to load waiting sequences:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.clinicId) {
      checkEnabled();
      load();
    }
  }, [user?.clinicId]);

  const grouped = useMemo<GroupedSequences>(() => {
    return sequences.reduce((acc, seq) => {
      if (!acc[seq.conditionType]) acc[seq.conditionType] = [];
      acc[seq.conditionType].push(seq);
      return acc;
    }, {} as GroupedSequences);
  }, [sequences]);

  const conditionTypes = useMemo(() => sortConditionTypes(Object.keys(grouped)), [grouped]);

  useEffect(() => {
    if (conditionTypes.length === 0) {
      setSelectedConditionType('General');
      return;
    }

    if (!conditionTypes.includes(selectedConditionType)) {
      setSelectedConditionType(conditionTypes[0]);
    }
  }, [conditionTypes, selectedConditionType]);

  const selectedSteps = grouped[selectedConditionType] ?? [];
  const activeSteps = sequences.filter(seq => seq.isActive);
  const inactiveSteps = sequences.length - activeSteps.length;
  const emptyMessageSteps = sequences.filter(seq => !seq.message.trim()).length;
  const selectedActiveSteps = selectedSteps.filter(seq => seq.isActive).length;
  const totalWaitMinutes = selectedSteps.length > 0 ? Math.max(...selectedSteps.map(seq => seq.delayMinutes)) : 0;

  const handleAddType = async () => {
    const name = newConditionType.trim();
    if (!name || !user?.clinicId) return;
    if (conditionTypes.includes(name)) {
      alert('This condition type already exists.');
      return;
    }

    try {
      setSaving(true);
      await waitingSequenceService.create(user.clinicId, {
        conditionType: name,
        stepOrder: 1,
        delayMinutes: 5,
        message: '',
        isActive: true,
      });
      setNewConditionType('');
      setShowAddType(false);
      setSelectedConditionType(name);
      await load();
    } catch (err) {
      alert('Failed to add condition type.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = async (conditionType: string) => {
    if (!user?.clinicId) return;
    const existing = grouped[conditionType] ?? [];
    const nextOrder = existing.length > 0 ? Math.max(...existing.map(s => s.stepOrder)) + 1 : 1;
    const lastDelay = existing.length > 0 ? existing[existing.length - 1].delayMinutes : 0;

    try {
      await waitingSequenceService.create(user.clinicId, {
        conditionType,
        stepOrder: nextOrder,
        delayMinutes: lastDelay + 5,
        message: '',
        isActive: true,
      });
      setSelectedConditionType(conditionType);
      await load();
    } catch (err) {
      alert('Failed to add step.');
    }
  };

  const handleUpdateStep = (id: string, field: keyof WaitingSequence, value: any) => {
    setSequences(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleSaveStep = async (seq: WaitingSequence) => {
    try {
      setSaving(true);
      await waitingSequenceService.update(seq.id, {
        conditionType: seq.conditionType,
        stepOrder: seq.stepOrder,
        delayMinutes: seq.delayMinutes,
        message: seq.message,
        isActive: seq.isActive,
      });
    } catch (err) {
      alert('Failed to save step.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStep = async (id: string) => {
    if (!confirm('Delete this step?')) return;
    try {
      await waitingSequenceService.delete(id);
      await load();
    } catch (err) {
      alert('Failed to delete step.');
    }
  };

  const handleDeleteConditionType = async (conditionType: string) => {
    if (conditionType === 'General') {
      alert('The General sequence cannot be deleted because it is the default fallback.');
      return;
    }
    if (!confirm(`Delete all steps for "${conditionType}"?`)) return;

    try {
      const steps = grouped[conditionType] ?? [];
      await Promise.all(steps.map(s => waitingSequenceService.delete(s.id)));
      await load();
    } catch (err) {
      alert('Failed to delete condition type.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (featureEnabled === false) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-white border border-amber-200 rounded-lg p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex gap-4 items-start">
              <div className="w-11 h-11 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Waiting Sequences are off</h2>
                <p className="text-sm text-gray-600 mt-1 max-w-2xl">
                  Enable the waiting room sequence toggle in Clinic Settings before configuring arrival messages.
                </p>
              </div>
            </div>
            <Link
              to="/settings/clinic"
              className="inline-flex items-center justify-center gap-2 bg-amber-600 text-white px-4 py-2.5 rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
            >
              <Settings className="w-4 h-4" />
              Open Clinic Settings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center">
            <Timer className="w-6 h-6 text-teal-700" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Waiting Sequences</h2>
            <p className="text-sm text-gray-500 mt-1">
              Build WhatsApp message flows that start when reception marks a patient arrived.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { checkEnabled(); load(); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddType(true)}
            className="inline-flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Sequence
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Sequences', value: conditionTypes.length, icon: Layers, tone: 'text-blue-700 bg-blue-50 border-blue-100' },
          { label: 'Active Messages', value: activeSteps.length, icon: CheckCircle, tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
          { label: 'Paused', value: inactiveSteps, icon: PauseCircle, tone: 'text-gray-700 bg-gray-50 border-gray-200' },
          { label: 'General Steps', value: grouped.General?.length ?? 0, icon: ListChecks, tone: 'text-violet-700 bg-violet-50 border-violet-100' },
          { label: 'Needs Text', value: emptyMessageSteps, icon: AlertCircle, tone: 'text-amber-700 bg-amber-50 border-amber-100' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${tone}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAddType && (
        <div className="bg-white border border-teal-200 rounded-lg p-4 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-800 mb-1">Sequence name</label>
              <input
                type="text"
                value={newConditionType}
                onChange={e => setNewConditionType(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddType()}
                placeholder="e.g. General, Joint Pain, Diabetes, Back Pain"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                autoFocus
              />
            </div>
            <button
              onClick={handleAddType}
              disabled={saving || !newConditionType.trim()}
              className="inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
            <button
              onClick={() => { setShowAddType(false); setNewConditionType(''); }}
              className="text-gray-600 hover:text-gray-900 px-4 py-2.5 rounded-lg text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {conditionTypes.length === 0 && !showAddType && (
        <div className="text-center py-14 bg-white rounded-lg border border-dashed border-gray-300">
          <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-700 font-semibold">No waiting sequences yet</p>
          <p className="text-sm text-gray-500 mt-1 max-w-xl mx-auto">
            Start with a General sequence. It becomes the fallback when a patient has no specific condition selected.
          </p>
          <button
            onClick={() => { setNewConditionType('General'); setShowAddType(true); }}
            className="mt-4 inline-flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg hover:bg-teal-700 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create General Sequence
          </button>
        </div>
      )}

      {conditionTypes.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Condition Flows</h3>
              <span className="text-xs text-gray-400">{conditionTypes.length} total</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
              {conditionTypes.map(conditionType => {
                const steps = grouped[conditionType] ?? [];
                const health = getSequenceHealth(steps);
                const activeCount = steps.filter(step => step.isActive).length;
                const waitMinutes = steps.length > 0 ? Math.max(...steps.map(step => step.delayMinutes)) : 0;
                const isSelected = selectedConditionType === conditionType;

                return (
                  <button
                    key={conditionType}
                    onClick={() => setSelectedConditionType(conditionType)}
                    className={`text-left bg-white border rounded-lg p-4 shadow-sm transition-all ${
                      isSelected
                        ? 'border-teal-500 ring-2 ring-teal-100'
                        : 'border-gray-200 hover:border-teal-200 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-gray-900 truncate">{conditionType}</h4>
                          {conditionType === 'General' && (
                            <span className="text-[11px] bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-full">
                              Fallback
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {steps.length} step{steps.length !== 1 ? 's' : ''} - {activeCount} active - {formatDelay(waitMinutes)}
                        </p>
                      </div>
                      <span className={`text-[11px] px-2 py-1 rounded-full border whitespace-nowrap ${health.className}`}>
                        {health.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-bold text-gray-900">{selectedConditionType}</h3>
                    {selectedConditionType === 'General' && (
                      <span className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-1 rounded-full">
                        Default fallback
                      </span>
                    )}
                    <span className={`text-xs px-2 py-1 rounded-full border ${getSequenceHealth(selectedSteps).className}`}>
                      {getSequenceHealth(selectedSteps).label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedSteps.length} message step{selectedSteps.length !== 1 ? 's' : ''}, {selectedActiveSteps} active, last message after {formatDelay(totalWaitMinutes)}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleAddStep(selectedConditionType)}
                    className="inline-flex items-center gap-2 bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add Step
                  </button>
                  {selectedConditionType !== 'General' && (
                    <button
                      onClick={() => handleDeleteConditionType(selectedConditionType)}
                      className="inline-flex items-center gap-2 border border-red-200 text-red-600 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Flow
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5">
              {selectedSteps.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
                  <MessageCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="font-medium text-gray-700">No messages in this flow</p>
                  <p className="text-sm text-gray-500 mt-1">Add the first timed WhatsApp message for this condition.</p>
                  <button
                    onClick={() => handleAddStep(selectedConditionType)}
                    className="mt-4 inline-flex items-center gap-2 text-teal-700 hover:text-teal-800 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add first step
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedSteps.map((seq, idx) => (
                    <div key={seq.id} className="relative pl-10">
                      {idx !== selectedSteps.length - 1 && (
                        <div className="absolute left-4 top-10 bottom-[-18px] w-px bg-gray-200" />
                      )}
                      <div className={`absolute left-0 top-5 w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold ${
                        seq.isActive
                          ? 'bg-teal-50 border-teal-200 text-teal-700'
                          : 'bg-gray-50 border-gray-200 text-gray-500'
                      }`}>
                        {idx + 1}
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                              <PlayCircle className="w-4 h-4 text-teal-600" />
                              Step {idx + 1}
                            </span>
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="text-sm text-gray-600">After</span>
                              <input
                                type="number"
                                min={1}
                                value={seq.delayMinutes}
                                onChange={e => handleUpdateStep(seq.id, 'delayMinutes', parseInt(e.target.value) || 1)}
                                className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              />
                              <span className="text-sm text-gray-600">minutes</span>
                            </div>
                          </div>

                          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={seq.isActive}
                              onChange={e => handleUpdateStep(seq.id, 'isActive', e.target.checked)}
                              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                            />
                            Active
                          </label>
                        </div>

                        <textarea
                          value={seq.message}
                          onChange={e => handleUpdateStep(seq.id, 'message', e.target.value)}
                          placeholder="Type the WhatsApp message. Add links directly inside the message."
                          rows={4}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-y min-h-[112px]"
                        />

                        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <p className="text-xs text-gray-400">
                            {seq.message.trim().length} characters - sends before appointment time only
                          </p>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleDeleteStep(seq.id)}
                              className="inline-flex items-center gap-1.5 text-red-600 hover:bg-red-50 text-sm px-3 py-2 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                            <button
                              onClick={() => handleSaveStep(seq)}
                              disabled={saving}
                              className="inline-flex items-center gap-1.5 bg-teal-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                            >
                              <Save className="w-4 h-4" />
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
                <strong>Arrival flow:</strong> When reception marks a patient arrived, they choose a condition. Active messages from that flow are queued at these intervals. If no matching flow exists, General is used.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WaitingSequenceSettings;
