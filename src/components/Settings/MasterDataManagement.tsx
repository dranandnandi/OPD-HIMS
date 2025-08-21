import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Pill, TestTube, Save, X, IndianRupee, Bot } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { masterDataService } from '../../services/masterDataService';
import { getCurrentProfile } from '../../services/profileService';
import { MedicineMaster, TestMaster, MedicineWithPrice, TestWithPrice, ClinicMedicinePrice, ClinicTestPrice } from '../../types';
import AIMasterSettings from './AIMasterSettings';

const MasterDataManagement: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'ai-assistant' | 'medicines' | 'tests' | 'pricing'>(
    (location.state as { activeTab?: 'ai-assistant' | 'medicines' | 'tests' | 'pricing' })?.activeTab || 'ai-assistant'
  );
  const [medicines, setMedicines] = useState<MedicineWithPrice[]>([]);
  const [tests, setTests] = useState<TestWithPrice[]>([]);
  const [medicinePrices, setMedicinePrices] = useState<ClinicMedicinePrice[]>([]);
  const [testPrices, setTestPrices] = useState<ClinicTestPrice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MedicineMaster | TestMaster | MedicineWithPrice | TestWithPrice | null>(null);
  const [selectedPriceItem, setSelectedPriceItem] = useState<{ type: 'medicine' | 'test'; id: string; name: string } | null>(null);

  // Update activeTab when location state changes
  useEffect(() => {
    const state = location.state as { activeTab?: 'ai-assistant' | 'medicines' | 'tests' | 'pricing' };
    if (state?.activeTab && state.activeTab !== activeTab) {
      setActiveTab(state.activeTab);
    }
  }, [location.state, activeTab]);

  useEffect(() => {
    if (user && hasPermission('master_data_management')) {
      loadData();
    }
  }, [user, activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      const clinicId = user?.clinicId;
      const profile = await getCurrentProfile();
      if (!profile?.clinicId) {
        throw new Error('User not assigned to a clinic.');
      }

      
      if (activeTab === 'medicines') {
        const medicinesData = await masterDataService.getMedicines(clinicId);
        setMedicines(medicinesData);
      } else if (activeTab === 'tests') {
        const testsData = await masterDataService.getTests(clinicId);
        setTests(testsData);
      } else if (activeTab === 'pricing' && clinicId) {
        const [medicinePricesData, testPricesData] = await Promise.all([
          masterDataService.getClinicMedicinePrices(clinicId),
          masterDataService.getClinicTestPrices(clinicId)
        ]);
        setMedicinePrices(medicinePricesData);
        setTestPrices(testPricesData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredMedicines = medicines.filter(medicine =>
    medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.genericName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.brandName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredTests = tests.filter(test =>
    test.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    test.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSetPrice = async (type: 'medicine' | 'test', id: string, price: number, cost?: number) => {
    if (!user?.clinicId) {
      alert('No clinic ID found for current user');
      return;
    }

    try {
      if (type === 'medicine' && cost !== undefined) {
        await masterDataService.setClinicMedicinePrice(user.clinicId, id, price, cost);
      } else if (type === 'test' && cost !== undefined) {
        await masterDataService.setClinicTestPrice(user.clinicId, id, price, cost);
      }
      
      setShowPricingModal(false);
      setSelectedPriceItem(null);
      await loadData(); // Reload data
      alert('Price updated successfully!');
    } catch (error) {
      console.error('Error setting price:', error);
      alert('Failed to update price');
    }
  };

  if (!user || !hasPermission('master_data_management')) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Pill className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">You don't have permission to access master data management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Master Data Management</h2>
        <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
          <strong>Note:</strong> Only administrators can create new master items. Use AI Assistant to set prices for existing items.
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="border-b border-gray-200">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('ai-assistant')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'ai-assistant'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Bot className="w-4 h-4" />
              AI Assistant
            </button>
            <button
              onClick={() => setActiveTab('medicines')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'medicines'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Pill className="w-4 h-4" />
              Medicines
            </button>
            <button
              onClick={() => setActiveTab('tests')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'tests'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <TestTube className="w-4 h-4" />
              Tests & Procedures
            </button>
            <button
              onClick={() => setActiveTab('pricing')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'pricing'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <IndianRupee className="w-4 h-4" />
              Pricing
            </button>
          </nav>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder={`Search ${activeTab}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : activeTab === 'ai-assistant' ? (
            <AIMasterSettings />
          ) : activeTab === 'medicines' ? (
            <MedicinesTable 
              medicines={filteredMedicines} 
              onEdit={() => {
                alert('Only administrators can edit master medicine data. Use AI Assistant to set clinic-specific pricing.');
              }}
              onDelete={() => {
                alert('Only administrators can delete master medicine data.');
              }}
              onSetPrice={(medicine) => {
                setSelectedPriceItem({ type: 'medicine', id: medicine.id, name: medicine.name });
                setShowPricingModal(true);
              }}
            />
          ) : activeTab === 'tests' ? (
            <TestsTable 
              tests={filteredTests} 
              onEdit={() => {
                alert('Only administrators can edit master test/procedure data. Use AI Assistant to set clinic-specific pricing.');
              }}
              onDelete={() => {
                alert('Only administrators can delete master test/procedure data.');
              }}
              onSetPrice={(test) => {
                setSelectedPriceItem({ type: 'test', id: test.id, name: test.name });
                setShowPricingModal(true);
              }}
            />
          ) : (
            <PricingTable 
              medicinePrices={medicinePrices}
              testPrices={testPrices}
              onEditPrice={(type, id, name) => {
                setSelectedPriceItem({ type, id, name });
                setShowPricingModal(true);
              }}
            />
          )}
        </div>
      </div>

      {/* Pricing Modal */}
      {showPricingModal && selectedPriceItem && (
        <PricingModal
          item={selectedPriceItem}
          onSave={handleSetPrice}
          onClose={() => {
            setShowPricingModal(false);
            setSelectedPriceItem(null);
          }}
        />
      )}
    </div>
  );
};

// Medicines Table Component
const MedicinesTable: React.FC<{
  medicines: MedicineWithPrice[];
  onEdit: (medicine: MedicineWithPrice) => void;
  onDelete: (id: string) => void;
  onSetPrice: (medicine: MedicineWithPrice) => void;
}> = ({ medicines, onEdit, onDelete, onSetPrice }) => {
  if (medicines.length === 0) {
    return (
      <div className="text-center py-12">
        <Pill className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No medicines found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Generic Name</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Category</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Dosage Form</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Stock Info</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Clinic Pricing</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {medicines.map(medicine => (
            <tr key={medicine.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-3 px-4">
                <div>
                  <div className="font-medium text-gray-800">{medicine.name}</div>
                  {medicine.brandName && (
                    <div className="text-sm text-gray-600">Brand: {medicine.brandName}</div>
                  )}
                  {medicine.batchNumber && (
                    <div className="text-xs text-gray-400">Batch: {medicine.batchNumber}</div>
                  )}
                </div>
              </td>
              <td className="py-3 px-4 text-gray-600">{medicine.genericName || '-'}</td>
              <td className="py-3 px-4 text-gray-600">{medicine.category}</td>
              <td className="py-3 px-4 text-gray-600">{medicine.dosageForm}</td>
              <td className="py-3 px-4 text-gray-600">
                <div className="space-y-1">
                  <div>Stock: {medicine.currentStock}</div>
                  <div className="text-xs">Reorder: {medicine.reorderLevel}</div>
                </div>
              </td>
              <td className="py-3 px-4 text-gray-600">
                <div className="space-y-1">
                  <div>Cost: {medicine.costPrice ? `₹${medicine.costPrice}` : 'Not set'}</div>
                  <div className="text-xs">Sell: {medicine.sellingPrice ? `₹${medicine.sellingPrice}` : 'Not set'}</div>
                </div>
              </td>
              <td className="py-3 px-4">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  medicine.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {medicine.isActive ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(medicine)}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onSetPrice(medicine)}
                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                    title="Set Price"
                  >
                    <IndianRupee className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete(medicine.id)}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Tests Table Component
const TestsTable: React.FC<{
  tests: TestWithPrice[];
  onEdit: (test: TestWithPrice) => void;
  onDelete: (id: string) => void;
  onSetPrice: (test: TestWithPrice) => void;
}> = ({ tests, onEdit, onDelete, onSetPrice }) => {
  if (tests.length === 0) {
    return (
      <div className="text-center py-12">
        <TestTube className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No tests found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Category</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Type</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Clinic Pricing</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
            <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tests.map(test => (
            <tr key={test.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-3 px-4">
                <div className="font-medium text-gray-800">{test.name}</div>
                {test.normalRange && (
                  <div className="text-sm text-gray-600">Normal: {test.normalRange}</div>
                )}
              </td>
              <td className="py-3 px-4 text-gray-600">{test.category}</td>
              <td className="py-3 px-4">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  test.type === 'lab' ? 'bg-blue-100 text-blue-700' :
                  test.type === 'procedure' ? 'bg-purple-100 text-purple-700' :
                  test.type === 'radiology' ? 'bg-purple-100 text-purple-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {test.type}
                </span>
              </td>
              <td className="py-3 px-4 text-gray-600">
                <div className="space-y-1">
                  <div>Price: {test.price ? `₹${test.price}` : 'Not set'}</div>
                  <div className="text-xs">Cost: {test.cost ? `₹${test.cost}` : 'Not set'}</div>
                </div>
              </td>
              <td className="py-3 px-4">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  test.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {test.isActive ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onEdit(test)}
                    className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                    title="Edit (Admin Only)"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onSetPrice(test)}
                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                    title="Set Price"
                  >
                    <IndianRupee className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete(test.id)}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    title="Delete (Admin Only)"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Pricing Table Component
const PricingTable: React.FC<{
  medicinePrices: ClinicMedicinePrice[];
  testPrices: ClinicTestPrice[];
  onEditPrice: (type: 'medicine' | 'test', id: string, name: string) => void;
}> = ({ medicinePrices, testPrices, onEditPrice }) => {
  return (
    <div className="space-y-6">
      {/* Medicine Prices */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Medicine Prices</h3>
        {medicinePrices.length === 0 ? (
          <div className="text-center py-8">
            <Pill className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No medicine prices set for this clinic</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Medicine</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Cost Price</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Selling Price</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Margin</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {medicinePrices.map(price => {
                  const margin = price.sellingPrice - price.costPrice;
                  const marginPercent = price.costPrice > 0 ? ((margin / price.costPrice) * 100).toFixed(1) : '0';
                  
                  return (
                    <tr key={price.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-800">
                        {price.medicine?.name || 'Unknown Medicine'}
                      </td>
                      <td className="py-3 px-4 text-gray-600">₹{price.costPrice}</td>
                      <td className="py-3 px-4 text-gray-600">₹{price.sellingPrice}</td>
                      <td className="py-3 px-4 text-gray-600">
                        ₹{margin} ({marginPercent}%)
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => onEditPrice('medicine', price.medicineId, price.medicine?.name || 'Unknown')}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Test Prices */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Test Prices</h3>
        {testPrices.length === 0 ? (
          <div className="text-center py-8">
            <TestTube className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No test prices set for this clinic</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Test</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Cost</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Price</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Margin</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {testPrices.map(price => {
                  const margin = price.price - price.cost;
                  const marginPercent = price.cost > 0 ? ((margin / price.cost) * 100).toFixed(1) : '0';
                  
                  return (
                    <tr key={price.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-800">
                        {price.test?.name || 'Unknown Test'}
                      </td>
                      <td className="py-3 px-4 text-gray-600">₹{price.cost}</td>
                      <td className="py-3 px-4 text-gray-600">₹{price.price}</td>
                      <td className="py-3 px-4 text-gray-600">
                        ₹{margin} ({marginPercent}%)
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => onEditPrice('test', price.testId, price.test?.name || 'Unknown')}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// Pricing Modal Component
const PricingModal: React.FC<{
  item: { type: 'medicine' | 'test'; id: string; name: string };
  onSave: (type: 'medicine' | 'test', id: string, price: number, cost?: number) => void;
  onClose: () => void;
}> = ({ item, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    price: '',
    cost: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const price = parseFloat(formData.price);
    const cost = parseFloat(formData.cost);
    
    if (isNaN(price) || price < 0) {
      alert('Please enter a valid price');
      return;
    }
    
    if (isNaN(cost) || cost < 0) {
      alert('Please enter a valid cost');
      return;
    }
    
    setSaving(true);
    try {
      await onSave(item.type, item.id, price, cost);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">
            Set {item.type === 'medicine' ? 'Medicine' : 'Test'} Price
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {item.type === 'medicine' ? 'Medicine' : 'Test'} Name
            </label>
            <input
              type="text"
              value={item.name}
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cost Price (₹) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter cost price"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {item.type === 'medicine' ? 'Selling' : 'Patient'} Price (₹) *
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={`Enter ${item.type === 'medicine' ? 'selling' : 'patient'} price`}
            />
          </div>

          {formData.price && formData.cost && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm text-blue-700">
                <div>Margin: ₹{(parseFloat(formData.price) - parseFloat(formData.cost)).toFixed(2)}</div>
                <div>
                  Margin %: {parseFloat(formData.cost) > 0 ? 
                    (((parseFloat(formData.price) - parseFloat(formData.cost)) / parseFloat(formData.cost)) * 100).toFixed(1) : 
                    '0'
                  }%
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Set Price'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Master Data Modal Component
const MasterDataModal: React.FC<{
  type: 'medicines' | 'tests';
  item: MedicineMaster | TestMaster | MedicineWithPrice | TestWithPrice | null;
  onSave: (data: any) => void;
  onClose: () => void;
}> = ({ type, item, onSave, onClose }) => {
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setFormData(item);
    } else {
      // Initialize with empty data based on type
      if (type === 'medicines') {
        setFormData({
          name: '',
          genericName: '',
          brandName: '',
          category: 'tablet',
          dosageForm: 'tablet',
          strength: '',
          manufacturer: '',
          description: '',
          sideEffects: [],
          contraindications: [],
          currentStock: 0,
          reorderLevel: 0,
          isActive: true
        });
      } else {
        setFormData({
          name: '',
          category: 'blood',
          type: 'lab',
          normalRange: '',
          units: '',
          description: '',
          preparationInstructions: '',
          isActive: true
        });
      }
    }
  }, [item, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">
            {item ? 'Edit' : 'Add'} {type === 'medicines' ? 'Medicine' : 'Test'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {type === 'medicines' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Generic Name</label>
                  <input
                    type="text"
                    value={formData.genericName || ''}
                    onChange={(e) => setFormData({ ...formData, genericName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
                  <input
                    type="text"
                    value={formData.brandName || ''}
                    onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                  <select
                    required
                    value={formData.category || 'tablet'}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
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
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dosage Form *</label>
                  <select
                    required
                    value={formData.dosageForm || 'tablet'}
                    onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="syrup">Syrup</option>
                    <option value="injection">Injection</option>
                    <option value="cream">Cream</option>
                    <option value="ointment">Ointment</option>
                    <option value="drops">Drops</option>
                    <option value="inhaler">Inhaler</option>
                    <option value="suppository">Suppository</option>
                    <option value="suspension">Suspension</option>
                    <option value="powder">Powder</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Strength</label>
                  <input
                    type="text"
                    value={formData.strength || ''}
                    onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., 500mg, 10ml"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
                <input
                  type="text"
                  value={formData.manufacturer || ''}
                  onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.currentStock || 0}
                    onChange={(e) => setFormData({ ...formData, currentStock: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.reorderLevel || 0}
                    onChange={(e) => setFormData({ ...formData, reorderLevel: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Test Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                  <select
                    required
                    value={formData.category || 'blood'}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="blood">Blood</option>
                    <option value="cardiac">Cardiac</option>
                    <option value="imaging">Imaging</option>
                    <option value="neurology">Neurology</option>
                    <option value="pathology">Pathology</option>
                    <option value="urine">Urine</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                  <select
                    required
                    value={formData.type || 'lab'}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="lab">Lab</option>
                    <option value="radiology">Radiology</option>
                    <option value="procedure">Procedure</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units</label>
                  <input
                    type="text"
                    value={formData.units || ''}
                    onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., mg/dL, cells/μL"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Normal Range</label>
                <input
                  type="text"
                  value={formData.normalRange || ''}
                  onChange={(e) => setFormData({ ...formData, normalRange: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., 70-100 mg/dL"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preparation Instructions</label>
                <textarea
                  value={formData.preparationInstructions || ''}
                  onChange={(e) => setFormData({ ...formData, preparationInstructions: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Fasting required for 12 hours"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive !== false}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : item ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MasterDataManagement;