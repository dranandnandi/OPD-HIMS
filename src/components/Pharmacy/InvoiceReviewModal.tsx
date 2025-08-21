import React, { useState, useEffect } from 'react';
import { Save, Edit, Trash2, Plus, CheckCircle, AlertCircle, Eye, X, Search } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { getCurrentProfile } from '../../services/profileService';
import { Supplier, MedicineWithPrice } from '../../types';

interface InvoiceData {
  invoiceInfo: {
    supplierName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number | null;
  };
  medicines: Array<{
    medicineName: string;
    quantity: number;
    unitCostPrice: number;
    totalCostPrice: number | null;
    batchNumber: string | null;
    expiryDate: string | null;
    manufacturer: string | null;
    strength: string | null;
    packSize: string | null;
  }>;
}

interface InvoiceReviewModalProps {
  extractedData: InvoiceData;
  rawText: string;
  confidence: number;
  fileName: string;
  onComplete: () => void;
  onClose: () => void;
}

const InvoiceReviewModal: React.FC<InvoiceReviewModalProps> = ({
  extractedData,
  rawText,
  confidence,
  fileName,
  onComplete,
  onClose
}) => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [itemSearchTerm, setItemSearchTerm] = useState('');

  const [invoiceInfo, setInvoiceInfo] = useState({
    supplierId: '',
    supplierName: extractedData.invoiceInfo.supplierName || '',
    invoiceNumber: extractedData.invoiceInfo.invoiceNumber || '',
    invoiceDate: extractedData.invoiceInfo.invoiceDate || new Date().toISOString().split('T')[0],
    totalAmount: extractedData.invoiceInfo.totalAmount || 0,
    remarks: `Processed from ${fileName} with ${(confidence * 100).toFixed(1)}% confidence`
  });

  const [medicineItems, setMedicineItems] = useState(
    extractedData.medicines.map((medicine, index) => ({
      id: `temp_${index}`,
      medicineName: medicine.medicineName,
      quantity: medicine.quantity,
      unitCostPrice: medicine.unitCostPrice,
      totalCostPrice: medicine.totalCostPrice || (medicine.quantity * medicine.unitCostPrice),
      batchNumber: medicine.batchNumber || '',
      expiryDate: medicine.expiryDate || '',
      manufacturer: medicine.manufacturer || '',
      strength: medicine.strength || '',
      packSize: medicine.packSize || '',
      medicineId: '', // Will be set if matched to master data
      isMatched: false,
      confidence: 0.8 // Default confidence for extracted items
    }))
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Auto-match medicines with master data
    matchMedicinesWithMaster();
  }, [medicines]);

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

      // Auto-select supplier if name matches
      if (invoiceInfo.supplierName) {
        const matchedSupplier = suppliersData.find(s => 
          s.name.toLowerCase().includes(invoiceInfo.supplierName.toLowerCase()) ||
          invoiceInfo.supplierName.toLowerCase().includes(s.name.toLowerCase())
        );
        if (matchedSupplier) {
          setInvoiceInfo(prev => ({ ...prev, supplierId: matchedSupplier.id }));
        }
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const matchMedicinesWithMaster = () => {
    setMedicineItems(prev => prev.map(item => {
      const matchedMedicine = medicines.find(m => 
        m.name.toLowerCase() === item.medicineName.toLowerCase() ||
        m.genericName?.toLowerCase() === item.medicineName.toLowerCase() ||
        m.brandName?.toLowerCase() === item.medicineName.toLowerCase() ||
        item.medicineName.toLowerCase().includes(m.name.toLowerCase()) ||
        m.name.toLowerCase().includes(item.medicineName.toLowerCase())
      );

      if (matchedMedicine) {
        return {
          ...item,
          medicineId: matchedMedicine.id,
          isMatched: true,
          confidence: 0.9
        };
      }

      return item;
    }));
  };

  const filteredMedicineItems = medicineItems.filter(item =>
    item.medicineName.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.manufacturer?.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.batchNumber?.toLowerCase().includes(itemSearchTerm.toLowerCase()) ||
    item.strength?.toLowerCase().includes(itemSearchTerm.toLowerCase())
  );

  const addMedicineItem = () => {
    const newItem = {
      id: `temp_${Date.now()}`,
      medicineName: '',
      quantity: 1,
      unitCostPrice: 0,
      totalCostPrice: 0,
      batchNumber: '',
      expiryDate: '',
      manufacturer: '',
      strength: '',
      packSize: '',
      medicineId: '',
      isMatched: false,
      confidence: 1.0
    };
    setMedicineItems([...medicineItems, newItem]);
  };

  const updateMedicineItem = (index: number, field: string, value: any) => {
    setMedicineItems(prev => prev.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        
        // Recalculate total cost price when quantity or unit cost changes
        if (field === 'quantity' || field === 'unitCostPrice') {
          updatedItem.totalCostPrice = updatedItem.quantity * updatedItem.unitCostPrice;
        }
        
        return updatedItem;
      }
      return item;
    }));
  };

  const removeMedicineItem = (index: number) => {
    setMedicineItems(prev => prev.filter((_, i) => i !== index));
  };

  const calculateTotalAmount = () => {
    return medicineItems.reduce((sum, item) => sum + item.totalCostPrice, 0);
  };

  const handleSave = async () => {
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot save invoice data.');
      return;
    }
    if (!user) {
      alert('You must be logged in to save invoice data');
      return;
    }

    if (!invoiceInfo.supplierId) {
      alert('Please select a supplier');
      return;
    }

    if (medicineItems.length === 0) {
      alert('Please add at least one medicine item');
      return;
    }

    const validItems = medicineItems.filter(item => 
      item.medicineName.trim() && item.quantity > 0 && item.unitCostPrice > 0
    );

    if (validItems.length === 0) {
      alert('Please ensure all medicine items have valid names, quantities, and prices');
      return;
    }

    try {
      setSaving(true);
      
      const receiptData = {
        supplierId: invoiceInfo.supplierId,
        invoiceNumber: invoiceInfo.invoiceNumber,
        receiptDate: new Date(invoiceInfo.invoiceDate),
        totalAmount: calculateTotalAmount(),
        uploadedBy: user.id,
        invoiceFileUrl: '', // Could store the original file URL if needed
        status: 'completed' as const,
        remarks: invoiceInfo.remarks
      };

      const inwardItems = validItems.map(item => ({
        medicineId: item.medicineId || '', // Use matched medicine ID if available
        quantity: item.quantity,
        unitCostPrice: item.unitCostPrice,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined
      }));

      await pharmacyService.createInwardReceipt(receiptData, inwardItems);
      
      alert(`Invoice processed successfully! ${validItems.length} medicine items added to inventory.`);
      onComplete();
      
    } catch (error) {
      console.error('Error saving invoice data:', error);
      alert(error instanceof Error ? error.message : 'Failed to save invoice data');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading suppliers and medicines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-800">Review Extracted Invoice Data</h2>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-gray-600">File: {fileName}</span>
              <span className={`px-2 py-1 text-xs rounded-full ${
                confidence >= 0.8 ? 'bg-green-100 text-green-700' :
                confidence >= 0.6 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {(confidence * 100).toFixed(1)}% confidence
              </span>
              <button
                onClick={() => setShowRawText(!showRawText)}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Eye className="w-4 h-4" />
                {showRawText ? 'Hide' : 'Show'} Raw Text
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Raw Text Display */}
          {showRawText && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-2">Raw OCR Text</h3>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {rawText}
              </pre>
            </div>
          )}

          {/* Invoice Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-800 mb-4">Invoice Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                <select
                  value={invoiceInfo.supplierId}
                  onChange={(e) => setInvoiceInfo({ ...invoiceInfo, supplierId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select supplier</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {invoiceInfo.supplierName && !invoiceInfo.supplierId && (
                  <p className="text-xs text-orange-600 mt-1">
                    Extracted: "{invoiceInfo.supplierName}" - Please select matching supplier
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
                <input
                  type="text"
                  value={invoiceInfo.invoiceNumber}
                  onChange={(e) => setInvoiceInfo({ ...invoiceInfo, invoiceNumber: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter invoice number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
                <input
                  type="date"
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
              <h3 className="text-lg font-semibold text-gray-800">
                Medicine Items ({filteredMedicineItems.length} of {medicineItems.length})
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Filter items..."
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <button
                  onClick={addMedicineItem}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {filteredMedicineItems.map((item, index) => {
                // Find the original index in the full medicineItems array
                const originalIndex = medicineItems.findIndex(originalItem => originalItem.id === item.id);
                
                return (
                <div key={item.id} className={`border rounded-lg p-4 ${
                  item.isMatched ? 'border-green-200 bg-green-50' : 'border-gray-200'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {item.isMatched ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-orange-600" />
                      )}
                      <span className="text-sm font-medium">
                        {item.isMatched ? 'Matched with master data' : 'No match found - manual entry'}
                      </span>
                    </div>
                    <button
                      onClick={() => removeMedicineItem(originalIndex)}
                      className="p-1 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Medicine Name *</label>
                      <input
                        type="text"
                        value={item.medicineName}
                        onChange={(e) => updateMedicineItem(originalIndex, 'medicineName', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Medicine name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Quantity *</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateMedicineItem(originalIndex, 'quantity', parseInt(e.target.value) || 0)}
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
                        onChange={(e) => updateMedicineItem(originalIndex, 'unitCostPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Total Cost (₹)</label>
                      <input
                        type="number"
                        value={item.totalCostPrice}
                        readOnly
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Batch Number</label>
                      <input
                        type="text"
                        value={item.batchNumber}
                        onChange={(e) => updateMedicineItem(originalIndex, 'batchNumber', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Expiry Date</label>
                      <input
                        type="date"
                        value={item.expiryDate}
                        onChange={(e) => updateMedicineItem(originalIndex, 'expiryDate', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Manufacturer</label>
                      <input
                        type="text"
                        value={item.manufacturer}
                        onChange={(e) => updateMedicineItem(originalIndex, 'manufacturer', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Strength</label>
                      <input
                        type="text"
                        value={item.strength}
                        onChange={(e) => updateMedicineItem(originalIndex, 'strength', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., 500mg"
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-gray-800">Total Invoice Amount:</span>
              <span className="text-xl font-bold text-blue-600">₹{calculateTotalAmount().toLocaleString()}</span>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {medicineItems.filter(item => item.isMatched).length} of {medicineItems.length} medicines matched with master data
              {itemSearchTerm && (
                <span className="ml-2 text-blue-600">• Showing {filteredMedicineItems.length} filtered items</span>
              )}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea
              value={invoiceInfo.remarks}
              onChange={(e) => setInvoiceInfo({ ...invoiceInfo, remarks: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Additional notes about this invoice..."
            />
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
              onClick={handleSave}
              disabled={saving || !invoiceInfo.supplierId || medicineItems.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save to Inventory'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceReviewModal;