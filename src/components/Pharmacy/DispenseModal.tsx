import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { Visit, MedicineWithPrice, PharmacyDispensedItem } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import { pharmacyService } from '../../services/pharmacyService';
import { useAuth } from '../Auth/useAuth';

interface DispenseModalProps {
  visit: Visit;
  onSave: (dispensedItems?: PharmacyDispensedItem[]) => void;
  onClose: () => void;
}

const DispenseModal: React.FC<DispenseModalProps> = ({ visit, onSave, onClose }) => {
  const { user } = useAuth();
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dispenseItems, setDispenseItems] = useState<Omit<PharmacyDispensedItem, 'id' | 'createdAt' | 'medicine' | 'dispensedByProfile' | 'totalSellingPrice'>[]>([]);

  useEffect(() => {
    loadMedicines();
  }, []);

  useEffect(() => {
    if (medicines.length > 0) {
      initializeDispenseItems();
    }
  }, [visit, medicines]);
  const loadMedicines = async () => {
    try {
      setLoading(true);
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

  const initializeDispenseItems = () => {
    // Pre-populate with prescribed medicines if available
    if (visit.prescriptions && visit.prescriptions.length > 0) {
      const items = visit.prescriptions.map(prescription => {
        let matchedMedicine: MedicineWithPrice | undefined;
        
        // First, try to match using medicineId if available
        if (prescription.medicineId) {
          matchedMedicine = medicines.find(m => m.id === prescription.medicineId);
        }
        
        // If no match found via medicineId, try name matching
        if (!matchedMedicine) {
          matchedMedicine = medicines.find(m => 
            m.name.toLowerCase() === prescription.medicine.toLowerCase() ||
            m.genericName?.toLowerCase() === prescription.medicine.toLowerCase() ||
            m.brandName?.toLowerCase() === prescription.medicine.toLowerCase() ||
            prescription.medicine.toLowerCase().includes(m.name.toLowerCase()) ||
            m.name.toLowerCase().includes(prescription.medicine.toLowerCase())
          );
        }
        
        return {
          visitId: visit.id,
          prescriptionId: prescription.id,
          medicineId: matchedMedicine?.id || '',
          quantity: prescription.quantity || 1,
          dispensedBy: user?.id || '',
          dispenseDate: new Date(),
          sellingPriceAtDispense: matchedMedicine?.sellingPrice || 0,
          batchNumber: matchedMedicine?.batchNumber || '',
          originalPrescriptionName: prescription.medicine,
          isMatched: !!matchedMedicine
        };
      });
      setDispenseItems(items);
    } else {
      // Add one empty item
      setDispenseItems([{
        visitId: visit.id,
        prescriptionId: undefined,
        medicineId: '',
        quantity: 1,
        dispensedBy: user?.id || '',
        dispenseDate: new Date(),
        sellingPriceAtDispense: 0,
        batchNumber: '',
        originalPrescriptionName: undefined,
        isMatched: false
      }]);
    }
  };

  const addDispenseItem = () => {
    setDispenseItems([...dispenseItems, {
      visitId: visit.id,
      prescriptionId: undefined,
      medicineId: '',
      quantity: 1,
      dispensedBy: user?.id || '',
      dispenseDate: new Date(),
      sellingPriceAtDispense: 0,
      batchNumber: '',
      originalPrescriptionName: undefined,
      isMatched: false
    }]);
  };

  const updateDispenseItem = (index: number, field: keyof typeof dispenseItems[0], value: string | number | Date | undefined) => {
    const updatedItems = dispenseItems.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto-fill selling price when medicine is selected
        if (field === 'medicineId' && typeof value === 'string') {
          const selectedMedicine = medicines.find(m => m.id === value);
          if (selectedMedicine) {
            updatedItem.sellingPriceAtDispense = selectedMedicine.sellingPrice || 0;
            updatedItem.batchNumber = selectedMedicine.batchNumber || '';
            updatedItem.isMatched = true;
          } else {
            updatedItem.isMatched = false;
          }
        }
        
        return updatedItem;
      }
      return item;
    });
    setDispenseItems(updatedItems);
  };

  const removeDispenseItem = (index: number) => {
    setDispenseItems(dispenseItems.filter((_, i) => i !== index));
  };

  const getMedicineStock = (medicineId: string): number => {
    const medicine = medicines.find(m => m.id === medicineId);
    return medicine?.currentStock || 0;
  };

  const isStockSufficient = (medicineId: string, quantity: number): boolean => {
    return getMedicineStock(medicineId) >= quantity;
  };

  const handleDispense = async () => {
    if (!user) {
      alert('You must be logged in to dispense medicines');
      return;
    }

    const validItems = dispenseItems.filter(item => item.medicineId && item.quantity > 0);
    
    if (validItems.length === 0) {
      alert('Please add at least one valid medicine item');
      return;
    }

    // Check stock availability
    for (const item of validItems) {
      if (!isStockSufficient(item.medicineId, item.quantity)) {
        const medicine = medicines.find(m => m.id === item.medicineId);
        alert(`Insufficient stock for ${medicine?.name}. Available: ${getMedicineStock(item.medicineId)}, Required: ${item.quantity}`);
        return;
      }
    }

    try {
      setSaving(true);
      const dispensedItems = await pharmacyService.dispenseMedicines(validItems);
      alert('Medicines dispensed successfully!');
      onSave(dispensedItems);
      onClose();
    } catch (error) {
      console.error('Error dispensing medicines:', error);
      alert(error instanceof Error ? error.message : 'Failed to dispense medicines');
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
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Dispense Medicines</h2>
            <p className="text-sm text-gray-600">
              Patient: {visit.patient?.name} • Visit: {new Date(visit.date).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Prescribed Medicines (if any) */}
          {visit.prescriptions && visit.prescriptions.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-800 mb-2">Prescribed Medicines</h3>
              <div className="space-y-2">
                {visit.prescriptions.map(prescription => (
                  <div key={prescription.id} className="text-sm text-blue-700">
                    <strong>{prescription.medicine}</strong> - {prescription.dosage} {prescription.frequency} for {prescription.duration}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dispense Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Medicines to Dispense</h3>
              <button
                onClick={addDispenseItem}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Medicine
              </button>
            </div>

            <div className="space-y-4">
              {dispenseItems.map((item, index) => {
                const medicine = medicines.find(m => m.id === item.medicineId);
                const availableStock = getMedicineStock(item.medicineId);
                const stockSufficient = isStockSufficient(item.medicineId, item.quantity);

                return (
                  <div key={index} className={`border rounded-lg p-4 ${
                    item.isMatched ? 'border-green-200 bg-green-50' : 
                    item.originalPrescriptionName ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                  }`}>
                    {/* Match Status Indicator */}
                    {item.originalPrescriptionName && (
                      <div className="mb-3 flex items-center gap-2">
                        {item.isMatched ? (
                          <div className="flex items-center gap-1 text-green-700 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            <span>Matched: "{item.originalPrescriptionName}"</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-orange-700 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            <span>No match found for: "{item.originalPrescriptionName}" - Please select manually</span>
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Medicine *</label>
                        <select
                          value={item.medicineId}
                          onChange={(e) => updateDispenseItem(index, 'medicineId', e.target.value)}
                          className={`w-full px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            !item.isMatched && item.originalPrescriptionName ? 'border-orange-300' : 'border-gray-300'
                          }`}
                        >
                          <option value="">
                            {item.originalPrescriptionName && !item.isMatched 
                              ? `Select medicine for "${item.originalPrescriptionName}"` 
                              : 'Select medicine'
                            }
                          </option>
                          {medicines.map(medicine => (
                            <option key={medicine.id} value={medicine.id}>
                              {medicine.name} (Stock: {medicine.currentStock})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateDispenseItem(index, 'quantity', parseInt(e.target.value) || 0)}
                          className={`w-full px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            !stockSufficient && item.medicineId ? 'border-red-300 bg-red-50' : 'border-gray-300'
                          }`}
                        />
                        {!stockSufficient && item.medicineId && (
                          <div className="flex items-center gap-1 mt-1">
                            <AlertCircle className="w-3 h-3 text-red-500" />
                            <span className="text-xs text-red-600">Insufficient stock ({availableStock})</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Selling Price (₹)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.sellingPriceAtDispense}
                          onChange={(e) => updateDispenseItem(index, 'sellingPriceAtDispense', parseFloat(e.target.value) || 0)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                        <input
                          type="text"
                          value={item.batchNumber}
                          onChange={(e) => updateDispenseItem(index, 'batchNumber', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>

                      <div className="flex items-end">
                        <div className="w-full">
                          <label className="block text-xs text-gray-600 mb-1">Total (₹)</label>
                          <input
                            type="number"
                            value={item.quantity * (item.sellingPriceAtDispense || 0)}
                            readOnly
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                          />
                        </div>
                        <button
                          onClick={() => removeDispenseItem(index)}
                          className="ml-2 p-1 text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {medicine && (
                      <div className="mt-2 text-xs text-gray-600">
                        Available Stock: {medicine.currentStock} | 
                        Generic: {medicine.genericName || 'N/A'} | 
                        Form: {medicine.dosageForm}
                        {item.originalPrescriptionName && item.isMatched && (
                          <span className="text-green-600"> | ✓ Matched from prescription</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Total Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-gray-800">Total Amount:</span>
              <span className="text-xl font-bold text-blue-600">
                ₹{dispenseItems.reduce((sum, item) => sum + (item.quantity * (item.sellingPriceAtDispense || 0)), 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDispense}
              disabled={saving || dispenseItems.some(item => item.medicineId && !isStockSufficient(item.medicineId, item.quantity))}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Dispensing...' : 'Dispense Medicines'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DispenseModal;