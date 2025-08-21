import React, { useState, useEffect } from 'react';
import { X, Save, Package, AlertTriangle } from 'lucide-react';
import { MedicineWithPrice, Supplier } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import { pharmacyService } from '../../services/pharmacyService';
import { getCurrentProfile } from '../../services/profileService';
import { useAuth } from '../Auth/useAuth';

interface ReturnToSupplierModalProps {
  onSave: () => void;
  onClose: () => void;
}

const ReturnToSupplierModal: React.FC<ReturnToSupplierModalProps> = ({ onSave, onClose }) => {
  const { user } = useAuth();
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    medicineId: '',
    quantity: 1,
    reason: '',
    supplierId: ''
  });

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const clinicId = user?.clinicId;
      const [medicinesData, suppliersData] = await Promise.all([
        masterDataService.getMedicines(clinicId),
        pharmacyService.getSuppliers()
      ]);
      
      // Only show medicines with current stock > 0
      const availableMedicines = medicinesData.filter(m => m.currentStock > 0);
      setMedicines(availableMedicines);
      setSuppliers(suppliersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSelectedMedicine = () => {
    return medicines.find(m => m.id === formData.medicineId);
  };

  const getMaxReturnQuantity = () => {
    const medicine = getSelectedMedicine();
    return medicine?.currentStock || 0;
  };

  const handleSave = async () => {
    if (!user) {
      alert('You must be logged in to return medicines');
      return;
    }

    if (!formData.medicineId) {
      alert('Please select a medicine');
      return;
    }

    if (!formData.supplierId) {
      alert('Please select a supplier');
      return;
    }

    if (formData.quantity <= 0) {
      alert('Please enter a valid quantity');
      return;
    }

    if (!formData.reason.trim()) {
      alert('Please provide a reason for the return');
      return;
    }

    const maxQuantity = getMaxReturnQuantity();
    if (formData.quantity > maxQuantity) {
      alert(`Cannot return more than available stock (${maxQuantity})`);
      return;
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot return medicines.');
      return;
    }
    try {
      setSaving(true);
      
      await pharmacyService.returnMedicines(
        formData.medicineId,
        formData.quantity,
        formData.reason,
        formData.supplierId,
        user.id
      );
      
      alert('Medicine return recorded successfully!');
      onSave();
      onClose();
      
    } catch (error) {
      console.error('Error returning medicine:', error);
      alert(error instanceof Error ? error.message : 'Failed to record medicine return');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-orange-600" />
            <h2 className="text-xl font-bold">Return to Supplier</h2>
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
                  {medicine.name} (Stock: {medicine.currentStock})
                </option>
              ))}
            </select>
          </div>

          {formData.medicineId && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm text-blue-700">
                <div><strong>Available Stock:</strong> {getMaxReturnQuantity()}</div>
                {getSelectedMedicine()?.batchNumber && (
                  <div><strong>Batch:</strong> {getSelectedMedicine()?.batchNumber}</div>
                )}
                {getSelectedMedicine()?.expiryDate && (
                  <div><strong>Expiry:</strong> {getSelectedMedicine()?.expiryDate.toLocaleDateString()}</div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity to Return *
            </label>
            <input
              type="number"
              min="1"
              max={getMaxReturnQuantity()}
              required
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter quantity"
            />
            {formData.medicineId && formData.quantity > getMaxReturnQuantity() && (
              <div className="flex items-center gap-1 mt-1">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">
                  Exceeds available stock ({getMaxReturnQuantity()})
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Return to Supplier *
            </label>
            <select
              required
              value={formData.supplierId}
              onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a supplier</option>
              {suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Return *
            </label>
            <textarea
              required
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter reason for return (e.g., expired, damaged, wrong item)"
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
              <div className="text-sm text-yellow-700">
                <strong>Note:</strong> This action will reduce the medicine stock and cannot be undone. 
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
              disabled={saving || !formData.medicineId || !formData.supplierId || !formData.reason.trim() || formData.quantity <= 0 || formData.quantity > getMaxReturnQuantity()}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Processing...' : 'Record Return'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReturnToSupplierModal;