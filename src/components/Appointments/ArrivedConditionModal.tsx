import React, { useEffect, useState } from 'react';
import { CheckCircle, MessageCircle, SkipForward, Timer, X } from 'lucide-react';
import { waitingSequenceService } from '../../services/waitingSequenceService';
import { useAuth } from '../Auth/useAuth';

interface Props {
  appointmentId: string;
  patientName: string;
  preselectedCondition?: string;
  onConfirm: (conditionType: string | null) => void;
  onCancel: () => void;
}

const ArrivedConditionModal: React.FC<Props> = ({
  patientName,
  preselectedCondition,
  onConfirm,
  onCancel
}) => {
  const { user } = useAuth();
  const [conditionTypes, setConditionTypes] = useState<string[]>(['General']);
  const [selected, setSelected] = useState<string>(preselectedCondition || 'General');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user?.clinicId) return;
      try {
        const types = await waitingSequenceService.getConditionTypes(user.clinicId);
        setConditionTypes(types);
        if (!preselectedCondition && types.includes('General')) {
          setSelected('General');
        }
      } catch {
        setConditionTypes(['General']);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [preselectedCondition, user?.clinicId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0">
                <Timer className="w-5 h-5 text-teal-700" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Start Waiting Sequence</h3>
                <p className="text-sm text-gray-500 mt-0.5">{patientName}</p>
              </div>
            </div>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex gap-3">
            <MessageCircle className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700">
              Choose the patient condition. Matching WhatsApp messages will be queued automatically after arrival.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {conditionTypes.map(type => {
                const isSelected = selected === type;
                return (
                  <button
                    key={type}
                    onClick={() => setSelected(type)}
                    className={`text-left px-4 py-3 rounded-lg border text-sm transition-all ${
                      isSelected
                        ? 'border-teal-500 bg-teal-50 text-teal-900 ring-2 ring-teal-100'
                        : 'border-gray-200 hover:border-teal-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{type === 'General' ? 'General' : type}</span>
                      {isSelected && <CheckCircle className="w-4 h-4 text-teal-600 flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {type === 'General' ? 'Default fallback flow' : 'Condition-specific flow'}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => onConfirm(null)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors"
          >
            <SkipForward className="w-4 h-4" />
            Mark Arrived Only
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Start Sequence
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArrivedConditionModal;
