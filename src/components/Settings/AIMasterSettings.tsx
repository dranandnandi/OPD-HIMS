import React, { useState } from 'react';
import { Bot, Send, CheckCircle, AlertCircle, Loader2, Edit, Save, X, Lightbulb } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { masterDataService } from '../../services/masterDataService';
import { supabase } from '../../lib/supabase';
import { getCurrentProfile } from '../../services/profileService';

interface AISuggestion {
  itemType: 'medicine' | 'test' | 'unknown';
  confidence: number;
  suggestedData: {
    masterData: {
      name: string;
      category: string;
      type?: 'lab' | 'radiology' | 'other';
      dosageForm?: string;
      strength?: string;
      genericName?: string;
      brandName?: string;
      manufacturer?: string;
      description?: string;
      normalRange?: string;
      units?: string;
      preparationInstructions?: string;
    };
    pricingData: {
      sellingPrice: number;
      costPrice: number;
    };
  };
  explanation: string;
  suggestions: string[];
}

const AIMasterSettings: React.FC = () => {
  const { user } = useAuth();
  const [userInput, setUserInput] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Editable form data
  const [editableData, setEditableData] = useState<AISuggestion['suggestedData'] | null>(null);

  const handleGetAISuggestion = async () => {
    if (!userInput.trim()) {
      setError('Please enter a description of the medicine or test');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);
    setAiSuggestion(null);
    setEditableData(null);

    try {
      const profile = await getCurrentProfile();
      if (!profile?.clinicId) {
        throw new Error('User not assigned to a clinic.');
      }

      // Get session token for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      // Call the Gemini master data parser edge function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-master-data-parser`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userInput: userInput.trim() })
      });

      if (!response.ok) {
        throw new Error(`AI processing failed: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      setAiSuggestion(result.data);
      setEditableData(result.data.suggestedData);

    } catch (err) {
      console.error('AI suggestion error:', err);
      setError(err instanceof Error ? err.message : 'Failed to get AI suggestion');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveAndSave = async () => {
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      setError('User not assigned to a clinic. Cannot save data.');
      return;
    }
    if (!aiSuggestion || !editableData || !user?.clinicId) {
      setError('Missing required data or clinic information');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (aiSuggestion.itemType === 'medicine') {
        // Find existing medicine and set pricing (no creation allowed)
        const medicineData = {
          name: editableData.masterData.name,
          genericName: editableData.masterData.genericName,
          brandName: editableData.masterData.brandName,
          category: editableData.masterData.category as any,
          dosageForm: editableData.masterData.dosageForm as any,
          strength: editableData.masterData.strength,
          manufacturer: editableData.masterData.manufacturer,
          description: editableData.masterData.description,
          sideEffects: [],
          contraindications: [],
          currentStock: 0,
          reorderLevel: 0,
          isActive: true
        };

        // Use the restricted upsert method
        const result = await masterDataService.upsertMasterDataAndPrice(
          'medicine',
          medicineData,
          editableData.pricingData,
          user.clinicId,
        );

        setSuccess(`Medicine "${medicineData.name}" saved successfully with pricing!`);

      } else if (aiSuggestion.itemType === 'test') {
        // Find existing test/procedure and set pricing (no creation allowed)
        const testData = {
          name: editableData.masterData.name,
          category: editableData.masterData.category as any,
          type: editableData.masterData.type as 'lab' | 'radiology' | 'procedure' | 'other',
          normalRange: editableData.masterData.normalRange,
          units: editableData.masterData.units,
          description: editableData.masterData.description,
          preparationInstructions: editableData.masterData.preparationInstructions,
          isActive: true
        };

        // Use the restricted upsert method
        const result = await masterDataService.upsertMasterDataAndPrice(
          'test',
          testData,
          editableData.pricingData,
          user.clinicId,
        );

        const itemTypeName = testData.type === 'procedure' ? 'Procedure' : 'Test';
        setSuccess(`${itemTypeName} "${testData.name}" saved successfully with pricing!`);

      } else {
        throw new Error('Unknown item type. Please try again with a clearer description.');
      }

      // Reset form
      setUserInput('');
      setAiSuggestion(null);
      setEditableData(null);
      setIsEditing(false);

    } catch (err) {
      console.error('Save error:', err);
      if (err instanceof Error && err.message.includes('not found in master catalog')) {
        setError(`❌ ${err.message}\n\n💡 The AI Assistant can only set prices for existing items in the master catalog. It cannot create new medicines, tests, or procedures.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save data');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const updateEditableData = (section: 'masterData' | 'pricingData', field: string, value: any) => {
    if (!editableData) return;
    
    setEditableData(prev => ({
      ...prev!,
      [section]: {
        ...prev![section],
        [field]: value
      }
    }));
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-100';
    if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to use AI Master Settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="w-8 h-8 text-blue-600" />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">AI Master Data Assistant</h2>
          <p className="text-gray-600">Describe a medicine or test, and AI will suggest structured data for your clinic</p>
        </div>
      </div>

      {/* Input Section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Describe the medicine or test service
            </label>
            <div className="flex gap-3">
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Examples:&#10;• CBC 300 rs&#10;• Paracetamol 500mg tablet 50 rupees&#10;• ECG test 200 rs&#10;• Amoxicillin capsule 250mg 80 rs&#10;• X-ray chest 500 rupees"
                rows={4}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
              <button
                onClick={handleGetAISuggestion}
                disabled={isProcessing || !userInput.trim()}
                className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed self-start"
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                {isProcessing ? 'Processing...' : 'Get AI Suggestion'}
              </button>
            </div>
          </div>

          {/* Example prompts */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-800 mb-2">Example Inputs:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-blue-700">
                  <div>• "CBC test 300 rupees"</div>
                  <div>• "Paracetamol 500mg tablet 50 rs"</div>
                  <div>• "ECG 200 rs"</div>
                  <div>• "Amoxicillin capsule 250mg"</div>
                  <div>• "X-ray chest 500 rupees"</div>
                  <div>• "Blood sugar test 150 rs"</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Success Display */}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <p className="text-green-700">{success}</p>
        </div>
      )}

      {/* AI Suggestion Display */}
      {aiSuggestion && editableData && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Bot className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-800">AI Suggestion</h3>
              <span className={`px-3 py-1 text-sm rounded-full ${getConfidenceColor(aiSuggestion.confidence)}`}>
                {(aiSuggestion.confidence * 100).toFixed(0)}% confidence
              </span>
              <span className={`px-3 py-1 text-sm rounded-full ${
                aiSuggestion.itemType === 'medicine' ? 'bg-green-100 text-green-800' :
                aiSuggestion.itemType === 'test' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {aiSuggestion.itemType === 'medicine' ? 'Medicine' : 
                 aiSuggestion.itemType === 'test' ? 'Test/Service' : 'Unknown'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Edit className="w-4 h-4" />
                {isEditing ? 'View Mode' : 'Edit Mode'}
              </button>
            </div>
          </div>

          {/* AI Explanation */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-800 mb-2">AI Analysis:</h4>
            <p className="text-gray-700 text-sm">{aiSuggestion.explanation}</p>
            {aiSuggestion.suggestions.length > 0 && (
              <div className="mt-3">
                <h5 className="font-medium text-gray-700 text-sm mb-1">Suggestions:</h5>
                <ul className="text-sm text-gray-600 space-y-1">
                  {aiSuggestion.suggestions.map((suggestion, index) => (
                    <li key={index} className="flex items-start gap-1">
                      <span className="text-blue-600">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Master Data Fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-medium text-gray-800 border-b border-gray-200 pb-2">
                {aiSuggestion.itemType === 'medicine' ? 'Medicine' : 'Test'} Details
              </h4>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editableData.masterData.name}
                    onChange={(e) => updateEditableData('masterData', 'name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : (
                  <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editableData.masterData.category}
                    onChange={(e) => updateEditableData('masterData', 'category', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : (
                  <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.category}</p>
                )}
              </div>

              {aiSuggestion.itemType === 'test' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    {isEditing ? (
                      <select
                        value={editableData.masterData.type || 'lab'}
                        onChange={(e) => updateEditableData('masterData', 'type', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="lab">Lab</option>
                        <option value="radiology">Radiology</option>
                        <option value="procedure">Procedure</option>
                        <option value="other">Other</option>
                      </select>
                    ) : (
                      <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.type || 'lab'}</p>
                    )}
                  </div>

                  {editableData.masterData.normalRange && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Normal Range</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editableData.masterData.normalRange}
                          onChange={(e) => updateEditableData('masterData', 'normalRange', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.normalRange}</p>
                      )}
                    </div>
                  )}

                  {editableData.masterData.units && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Units</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editableData.masterData.units}
                          onChange={(e) => updateEditableData('masterData', 'units', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.units}</p>
                      )}
                    </div>
                  )}
                </>
              )}

              {aiSuggestion.itemType === 'medicine' && (
                <>
                  {editableData.masterData.dosageForm && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Dosage Form</label>
                      {isEditing ? (
                        <select
                          value={editableData.masterData.dosageForm}
                          onChange={(e) => updateEditableData('masterData', 'dosageForm', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="tablet">Tablet</option>
                          <option value="capsule">Capsule</option>
                          <option value="syrup">Syrup</option>
                          <option value="injection">Injection</option>
                          <option value="cream">Cream</option>
                          <option value="ointment">Ointment</option>
                          <option value="drops">Drops</option>
                          <option value="other">Other</option>
                        </select>
                      ) : (
                        <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.dosageForm}</p>
                      )}
                    </div>
                  )}

                  {editableData.masterData.strength && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Strength</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editableData.masterData.strength}
                          onChange={(e) => updateEditableData('masterData', 'strength', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="e.g., 500mg, 10ml"
                        />
                      ) : (
                        <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.strength}</p>
                      )}
                    </div>
                  )}

                  {editableData.masterData.genericName && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Generic Name</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editableData.masterData.genericName}
                          onChange={(e) => updateEditableData('masterData', 'genericName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">{editableData.masterData.genericName}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Pricing Data */}
            <div className="space-y-4">
              <h4 className="font-medium text-gray-800 border-b border-gray-200 pb-2">Pricing Information</h4>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Selling Price (₹) *</label>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editableData.pricingData.sellingPrice}
                    onChange={(e) => updateEditableData('pricingData', 'sellingPrice', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : (
                  <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">₹{editableData.pricingData.sellingPrice}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price (₹) *</label>
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editableData.pricingData.costPrice}
                    onChange={(e) => updateEditableData('pricingData', 'costPrice', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                ) : (
                  <p className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">₹{editableData.pricingData.costPrice}</p>
                )}
              </div>

              {/* Margin Calculation */}
              {editableData.pricingData.sellingPrice > 0 && editableData.pricingData.costPrice > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <h5 className="font-medium text-blue-800 mb-2">Profit Analysis</h5>
                  <div className="text-sm text-blue-700 space-y-1">
                    <div>Margin: ₹{(editableData.pricingData.sellingPrice - editableData.pricingData.costPrice).toFixed(2)}</div>
                    <div>
                      Margin %: {editableData.pricingData.costPrice > 0 ? 
                        (((editableData.pricingData.sellingPrice - editableData.pricingData.costPrice) / editableData.pricingData.costPrice) * 100).toFixed(1) : 
                        '0'
                      }%
                    </div>
                  </div>
                </div>
              )}

              {/* Target Table Info */}
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <h5 className="font-medium text-green-800 mb-2">Database Target</h5>
                <div className="text-sm text-green-700 space-y-1">
                  <div>Master Table: {aiSuggestion.itemType === 'medicine' ? 'medicines_master' : 'tests_master'}</div>
                  <div>Pricing Table: {aiSuggestion.itemType === 'medicine' ? 'clinic_medicine_prices' : 'clinic_test_prices'}</div>
                  <div>Clinic: {user?.clinic?.clinicName || 'Current Clinic'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                setAiSuggestion(null);
                setEditableData(null);
                setIsEditing(false);
              }}
              className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <X className="w-4 h-4 inline mr-2" />
              Cancel
            </button>
            <button
              onClick={handleApproveAndSave}
              disabled={isSaving || !editableData.masterData.name.trim() || editableData.pricingData.sellingPrice <= 0}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isSaving ? 'Saving...' : 'Approve & Save to Database'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIMasterSettings;