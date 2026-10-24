import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CheckCircle } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import type { InvoiceData } from '../../types/pharmacyImport';
interface Supplier { id: string; name: string; }
interface MedicineWithPrice { id: string; name: string; }
interface ManualInvoiceEntryProps {
  onComplete: (data: InvoiceData) => void;
  onBack: () => void;
}

const ManualInvoiceEntry: React.FC<ManualInvoiceEntryProps> = ({ onComplete, onBack }) => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);

  const [invoiceInfo, setInvoiceInfo] = useState({
    supplierName: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    totalAmount: 0
  });

  const [medicineItems, setMedicineItems] = useState([{
    id: 'manual_1',
    medicineName: '',
    quantity: 1,
    unitCostPrice: 0,
    totalCostPrice: 0,
    batchNumber: '',
    expiryDate: '',
    manufacturer: '',
    strength: '',
    packSize: ''
  }]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const clinicId = user?.clinicId;
      const [suppliersData, medicinesData] = await Promise.all([
        pharmacyService.getSuppliers(),
        masterDataService.getMedicines(clinicId)
      ]);
      setSuppliers(suppliersData);
      setMedicines(medicinesData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const addMedicineItem = () => {
    setMedicineItems([...medicineItems, {
      id: `manual_${Date.now()}`,
      medicineName: '',
      quantity: 1,
      unitCostPrice: 0,
      totalCostPrice: 0,
      batchNumber: '',
      expiryDate: '',
      manufacturer: '',
      strength: '',
      packSize: ''
    }]);
  };

  const updateMedicineItem = (index: number, field: string, value: any) => {
    setMedicineItems(prev => prev.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto-calculate total cost price
        if (field === 'quantity' || field === 'unitCostPrice') {
          updatedItem.totalCostPrice = updatedItem.quantity * updatedItem.unitCostPrice;
        }
        
        return updatedItem;
      }
      return item;
    }));
  };

  const removeMedicineItem = (index: number) => {
    if (medicineItems.length > 1) {
      setMedicineItems(prev => prev.filter((_, i) => i !== index));
    }
  };

  const calculateTotalAmount = () => {
    return medicineItems.reduce((sum, item) => sum + item.totalCostPrice, 0);
  };

  const handleSubmit = () => {
    // Validate required fields
    if (!invoiceInfo.supplierName.trim()) {
      alert('Please enter supplier name');
      return;
    }

    if (!invoiceInfo.invoiceNumber.trim()) {
      alert('Please enter invoice number');
      return;
    }

    const validItems = medicineItems.filter(item => 
      item.medicineName.trim() && item.quantity > 0 && item.unitCostPrice > 0
    );

    if (validItems.length === 0) {
      alert('Please add at least one valid medicine item');
      return;
    }

    // Create the data structure expected by InvoiceReviewModal
    const data: InvoiceData = {
      invoiceInfo: {
        supplierName: invoiceInfo.supplierName,
        invoiceNumber: invoiceInfo.invoiceNumber,
        invoiceDate: invoiceInfo.invoiceDate,
        totalAmount: calculateTotalAmount()
      },
      medicines: validItems.map(item => ({
        medicineName: item.medicineName,
        quantity: item.quantity,
        unitCostPrice: item.unitCostPrice,
        totalCostPrice: item.totalCostPrice,
        batchNumber: item.batchNumber || null,
        expiryDate: item.expiryDate || null,
        manufacturer: item.manufacturer || null,
        strength: item.strength || null,
        packSize: item.packSize || null
      }))
    };

    onComplete(data);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading suppliers and medicines...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">Manual Invoice Entry</h3>
        <button
          onClick={onBack}
          className="text-blue-600 hover:text-blue-700 text-sm"
        >
          ← Back to method selection
        </button>
      </div>

      {/* Invoice Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-4">Invoice Information</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name *</label>
            <input
              type="text"
              list="suppliers-list"
              required
              value={invoiceInfo.supplierName}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, supplierName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter or select supplier"
            />
            <datalist id="suppliers-list">
              {suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number *</label>
            <input
              type="text"
              required
              value={invoiceInfo.invoiceNumber}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter invoice number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date *</label>
            <input
              type="date"
              required
              value={invoiceInfo.invoiceDate}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (₹)</label>
            <input
              type="number"
              value={calculateTotalAmount()}
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* Medicine Items */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-gray-800">Medicine Items</h4>
          <button
            onClick={addMedicineItem}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>

        <div className="space-y-4">
          {medicineItems.map((item, index) => (
            <div key={item.id} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Medicine Name *</label>
                  <input
                    type="text"
                    list={`medicines-list-${index}`}
                    required
                    value={item.medicineName}
                    onChange={(e) => updateMedicineItem(index, 'medicineName', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter or select medicine"
                  />
                  <datalist id={`medicines-list-${index}`}>
                    {medicines.map(medicine => (
                      <option key={medicine.id} value={medicine.name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={item.quantity}
                    onChange={(e) => updateMedicineItem(index, 'quantity', parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Unit Cost (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={item.unitCostPrice}
                    onChange={(e) => updateMedicineItem(index, 'unitCostPrice', parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex items-end">
                  <div className="w-full">
                    <label className="block text-xs text-gray-600 mb-1">Total (₹)</label>
                    <input
                      type="number"
                      value={item.totalCostPrice}
                      readOnly
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                    />
                  </div>
                  {medicineItems.length > 1 && (
                    <button
                      onClick={() => removeMedicineItem(index)}
                      className="ml-2 p-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Additional Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                  <input
                    type="text"
                    value={item.batchNumber}
                    onChange={(e) => updateMedicineItem(index, 'batchNumber', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={item.expiryDate}
                    onChange={(e) => updateMedicineItem(index, 'expiryDate', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Manufacturer</label>
                  <input
                    type="text"
                    value={item.manufacturer}
                    onChange={(e) => updateMedicineItem(index, 'manufacturer', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Strength</label>
                  <input
                    type="text"
                    value={item.strength}
                    onChange={(e) => updateMedicineItem(index, 'strength', e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., 500mg"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="text-lg font-semibold text-gray-800">Total Invoice Amount:</span>
          <span className="text-xl font-bold text-blue-600">₹{calculateTotalAmount().toLocaleString()}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleSubmit}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <CheckCircle className="w-4 h-4" />
          Continue to Review
        </button>
      </div>
    </div>
  );
};


export default ManualInvoiceEntry;
