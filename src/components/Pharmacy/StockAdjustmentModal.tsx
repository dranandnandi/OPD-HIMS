import React, { useState, useEffect } from 'react';
import { X, Save, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { MedicineWithPrice } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import { pharmacyService } from '../../services/pharmacyService';
import { getCurrentProfile } from '../../services/profileService';
import { useAuth } from '../Auth/useAuth';

interface StockAdjustmentModalProps {
  onSave: () => void;
  onClose: () => void;
}

const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({ onSave, onClose }) => {
  const { user } = useAuth();
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    medicineId: '',
    adjustmentType: 'increase' as 'increase' | 'decrease',
    quantity: 1,
    reason: ''
  });

  useEffect(() => {
    if (user) {
      loadMedicines();
    }
  }, [user]);

  const loadMedicines = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const clinicId = user?.clinicId;
      const medicinesData = await masterDataService.getMedicines(clinicId);
      setMedicines(medicinesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load medicines');
      console.error('Error loading medicines:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSelectedMedicine = () => {
    return medicines.find(m => m.id === formData.medicineId);
  };

  const getCurrentStock = () => {
    const medicine = getSelectedMedicine();
    return medicine?.currentStock || 0;
  };

  const getNewStockLevel = () => {
    const currentStock = getCurrentStock();
    const quantityChange = formData.adjustmentType === 'increase' ? formData.quantity : -formData.quantity;
    return currentStock + quantityChange;
  };

  const isValidAdjustment = () => {
    const newStock = getNewStockLevel();
    return newStock >= 0;
  };

  const handleSave = async () => {
    if (!user) {
      alert('You must be logged in to adjust stock');
      return;
    }

    if (!formData.medicineId) {
      alert('Please select a medicine');
      return;
    }

    if (formData.quantity <= 0) {
      alert('Please enter a valid quantity');
      return;
    }

    if (!formData.reason.trim()) {
      alert('Please provide a reason for the adjustment');
      return;
    }

    if (!isValidAdjustment()) {
      alert('This adjustment would result in negative stock, which is not allowed');
      return;
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot adjust stock.');
      return;
    }
    try {
      setSaving(true);
      
      const quantityChange = formData.adjustmentType === 'increase' ? formData.quantity : -formData.quantity;
      
      await pharmacyService.adjustStock(
        formData.medicineId,
        quantityChange,
        formData.reason,
        user.id
      );
      
      alert('Stock adjustment recorded successfully!');
      onSave();
      onClose();
      
    } catch (error) {
      console.error('Error adjusting stock:', error);
      alert(error instanceof Error ? error.message : 'Failed to record stock adjustment');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading medicines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            {formData.adjustmentType === 'increase' ? (
              <TrendingUp className="w-5 h-5 text-green-600" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-600" />
            )}
            <h2 className="text-xl font-bold">Stock Adjustment</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Medicine *
            </label>
            <select
              required
              value={formData.medicineId}
              onChange={(e) => setFormData({ ...formData, medicineId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a medicine</option>
              {medicines.map(medicine => (
                <option key={medicine.id} value={medicine.id}>
                  {medicine.name} (Current Stock: {medicine.currentStock})
                </option>
              ))}
            </select>
          </div>

          {formData.medicineId && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm text-blue-700">
                <div><strong>Current Stock:</strong> {getCurrentStock()}</div>
                {getSelectedMedicine()?.batchNumber && (
                  <div><strong>Batch:</strong> {getSelectedMedicine()?.batchNumber}</div>
                )}
                {getSelectedMedicine()?.reorderLevel && (
                  <div><strong>Reorder Level:</strong> {getSelectedMedicine()?.reorderLevel}</div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adjustment Type *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, adjustmentType: 'increase' })}
                className={`flex items-center justify-center gap-2 px-4 py-3 border rounded-lg transition-colors ${
                  formData.adjustmentType === 'increase'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                Increase Stock
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, adjustmentType: 'decrease' })}
                className={`flex items-center justify-center gap-2 px-4 py-3 border rounded-lg transition-colors ${
                  formData.adjustmentType === 'decrease'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <TrendingDown className="w-4 h-4" />
                Decrease Stock
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity *
            </label>
            <input
              type="number"
              min="1"
              required
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter quantity"
            />
          </div>

          {formData.medicineId && formData.quantity > 0 && (
            <div className={`p-3 border rounded-lg ${
              isValidAdjustment() 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className={`text-sm ${
                isValidAdjustment() ? 'text-green-700' : 'text-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  {isValidAdjustment() ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  <span>
                    <strong>New Stock Level:</strong> {getNewStockLevel()}
                  </span>
                </div>
                {!isValidAdjustment() && (
                  <div className="mt-1 text-xs">
                    This adjustment would result in negative stock, which is not allowed.
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Adjustment *
            </label>
            <textarea
              required
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter reason for adjustment (e.g., physical count correction, damaged goods, system error)"
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-sm text-yellow-700">
                <strong>Note:</strong> Stock adjustments will be recorded in the movement log and cannot be undone. 
                Please ensure all details are correct before proceeding.
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !formData.medicineId || !formData.reason.trim() || formData.quantity <= 0 || !isValidAdjustment()}
              className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                formData.adjustmentType === 'increase' 
                  ? 'bg-green-600 hover:bg-green-700' 
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Processing...' : 'Record Adjustment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StockAdjustmentModal;