import React, { useState, useEffect } from 'react';
import { Plus, Save, Trash2, Upload, Search, Calendar, Bot, FileText } from 'lucide-react';
import { Supplier, MedicineWithPrice, PharmacyInwardItem } from '../../types';
import { getCurrentProfile } from '../../services/profileService';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { useAuth } from '../Auth/useAuth';
import { Link } from 'react-router-dom';

const InwardStock: React.FC = () => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNumber: '',
    receiptDate: new Date().toISOString().split('T')[0],
    totalAmount: 0,
    invoiceFileUrl: '',
    remarks: ''
  });

  const [inwardItems, setInwardItems] = useState<Omit<PharmacyInwardItem, 'id' | 'receiptId' | 'createdAt' | 'medicine' | 'totalCostPrice'>[]>([
    {
      medicineId: '',
      quantity: 0,
      unitCostPrice: 0,
      batchNumber: '',
      expiryDate: undefined
    }
  ]);

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
      const [suppliersData, medicinesData] = await Promise.all([
        pharmacyService.getSuppliers(),
        masterDataService.getMedicines(clinicId)
      ]);
      
      setSuppliers(suppliersData);
      setMedicines(medicinesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const addInwardItem = () => {
    setInwardItems([...inwardItems, {
      medicineId: '',
      quantity: 0,
      unitCostPrice: 0,
      batchNumber: '',
      expiryDate: undefined
    }]);
  };

  const updateInwardItem = (index: number, field: keyof typeof inwardItems[0], value: string | number | Date | undefined) => {
    const updatedItems = inwardItems.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        return updatedItem;
      }
      return item;
    });
    setInwardItems(updatedItems);
  };

  const removeInwardItem = (index: number) => {
    setInwardItems(inwardItems.filter((_, i) => i !== index));
  };

  const calculateTotalAmount = () => {
    return inwardItems.reduce((sum, item) => sum + (item.quantity * item.unitCostPrice), 0);
  };

  const handleSave = async () => {
    if (!user) {
      alert('You must be logged in to save inward stock');
      return;
    }

    if (!formData.supplierId) {
      alert('Please select a supplier');
      return;
    }

    if (!formData.invoiceNumber) {
      alert('Please enter an invoice number');
      return;
    }

    const validItems = inwardItems.filter(item => item.medicineId && item.quantity > 0 && item.unitCostPrice > 0);
    
    if (validItems.length === 0) {
      alert('Please add at least one valid medicine item');
      return;
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot save inward stock.');
      return;
    }
    try {
      setSaving(true);
      
      const receiptData = {
        supplierId: formData.supplierId,
        invoiceNumber: formData.invoiceNumber,
        receiptDate: new Date(formData.receiptDate),
        totalAmount: calculateTotalAmount(),
        uploadedBy: user.id,
        invoiceFileUrl: formData.invoiceFileUrl,
        status: 'completed' as const,
        remarks: formData.remarks
      };

      await pharmacyService.createInwardReceipt(receiptData, validItems);
      
      alert('Inward stock saved successfully!');
      
      // Reset form
      setFormData({
        supplierId: '',
        invoiceNumber: '',
        receiptDate: new Date().toISOString().split('T')[0],
        totalAmount: 0,
        invoiceFileUrl: '',
        remarks: ''
      });
      
      setInwardItems([{
        medicineId: '',
        quantity: 0,
        unitCostPrice: 0,
        batchNumber: '',
        expiryDate: undefined
      }]);
      
    } catch (error) {
      console.error('Error saving inward stock:', error);
      alert(error instanceof Error ? error.message : 'Failed to save inward stock');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to manage inward stock.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadData}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Inward Stock</h2>
          <p className="text-gray-600">Record new medicine inventory</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/pharmacy/invoice-upload"
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Bot className="w-4 h-4" />
            Process Invoice with AI
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {/* AI Processing Info */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-800 mb-2">💡 Pro Tip: Use AI for Faster Processing</h4>
              <p className="text-sm text-blue-700 mb-2">
                Instead of manual entry, you can upload your supplier invoice and let AI extract all the medicine data automatically!
              </p>
              <Link
                to="/pharmacy/invoice-upload"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                <FileText className="w-4 h-4" />
                Try AI Invoice Processing →
              </Link>
            </div>
          </div>
        </div>

        {/* Receipt Details */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Receipt Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number *</label>
              <input
                type="text"
                required
                value={formData.invoiceNumber}
                onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter invoice number"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Date *</label>
              <input
                type="date"
                required
                value={formData.receiptDate}
                onChange={(e) => setFormData({ ...formData, receiptDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Additional notes..."
            />
          </div>
        </div>

        {/* Medicine Items */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Medicine Items</h3>
            <button
              onClick={addInwardItem}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
          </div>

          <div className="space-y-4">
            {inwardItems.map((item, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Medicine *</label>
                    <select
                      value={item.medicineId}
                      onChange={(e) => updateInwardItem(index, 'medicineId', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select medicine</option>
                      {medicines.map(medicine => (
                        <option key={medicine.id} value={medicine.id}>
                          {medicine.name}
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
                      onChange={(e) => updateInwardItem(index, 'quantity', parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Unit Cost (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitCostPrice}
                      onChange={(e) => updateInwardItem(index, 'unitCostPrice', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                    <input
                      type="text"
                      value={item.batchNumber}
                      onChange={(e) => updateInwardItem(index, 'batchNumber', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Expiry Date</label>
                    <input
                      type="date"
                      value={item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : ''}
                      onChange={(e) => updateInwardItem(index, 'expiryDate', e.target.value ? new Date(e.target.value) : undefined)}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex items-end">
                    <div className="w-full">
                      <label className="block text-xs text-gray-600 mb-1">Total (₹)</label>
                      <input
                        type="number"
                        value={item.quantity * item.unitCostPrice}
                        readOnly
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                      />
                    </div>
                    <button
                      onClick={() => removeInwardItem(index)}
                      className="ml-2 p-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Total Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold text-gray-800">Total Amount:</span>
            <span className="text-xl font-bold text-blue-600">₹{calculateTotalAmount().toLocaleString()}</span>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : 'Save Inward Stock'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InwardStock;