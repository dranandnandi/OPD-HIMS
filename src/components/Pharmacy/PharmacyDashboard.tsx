import React, { useState, useEffect } from 'react';
import { Pill, TrendingUp, AlertCircle, Package, Plus, Search, CalendarDays, ArrowRight, Bell, RefreshCw, FileText, RotateCcw, Settings } from 'lucide-react';
import { MedicineWithPrice, StockMovementLog, StockAlert } from '../../types';
import { pharmacyService } from '../../services/pharmacyService';
import { useAuth } from '../Auth/useAuth';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import ReturnToSupplierModal from './ReturnToSupplierModal';
import StockAdjustmentModal from './StockAdjustmentModal';

const PharmacyDashboard: React.FC = () => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<{
    totalMedicines: number;
    lowStockCount: number;
    expiringCount: number;
    totalStockValue: number;
    recentMovements: StockMovementLog[];
  } | null>(null);
  const [allMedicines, setAllMedicines] = useState<MedicineWithPrice[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'expiring' | 'out'>('all');
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [refreshingAlerts, setRefreshingAlerts] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadDashboardData();
      loadAllMedicines();
      loadStockAlerts();
    }
  }, [user]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const clinicId = user?.clinicId;
      const data = await pharmacyService.getPharmacyDashboardData(clinicId);
      setDashboardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pharmacy dashboard data');
      console.error('Error loading pharmacy dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAllMedicines = async () => {
    try {
      const clinicId = user?.clinicId;
      const medicines = await pharmacyService.getAllMedicinesWithPrices(clinicId);
      setAllMedicines(medicines);
    } catch (err) {
      console.error('Error loading all medicines:', err);
    }
  };

  const loadStockAlerts = async () => {
    try {
      const alerts = await pharmacyService.getStockAlerts(false); // Only unresolved alerts
      setStockAlerts(alerts);
    } catch (err) {
      console.error('Error loading stock alerts:', err);
    }
  };

  const handleRefreshAlerts = async () => {
    try {
      setRefreshingAlerts(true);
      const result = await pharmacyService.triggerStockAlertsCheck();
      console.log('Stock alerts check result:', result);
      
      // Reload alerts and dashboard data
      await Promise.all([
        loadStockAlerts(),
        loadDashboardData()
      ]);
      
      alert(result?.message || 'Stock alerts updated successfully');
    } catch (err) {
      console.error('Error refreshing alerts:', err);
      alert('Failed to refresh stock alerts');
    } finally {
      setRefreshingAlerts(false);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    if (!user) return;
    
    try {
      await pharmacyService.resolveStockAlert(alertId, user.id);
      await loadStockAlerts(); // Reload alerts
    } catch (err) {
      console.error('Error resolving alert:', err);
      alert('Failed to resolve alert');
    }
  };

  const handleReturnSaved = () => {
    setShowReturnModal(false);
    loadDashboardData(); // Reload dashboard data
    loadAllMedicines(); // Reload medicines list
  };

  const handleAdjustmentSaved = () => {
    setShowAdjustmentModal(false);
    loadDashboardData(); // Reload dashboard data
    loadAllMedicines(); // Reload medicines list
  };

  const filteredMedicines = allMedicines.filter(medicine =>
    medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.genericName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.batchNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view pharmacy dashboard.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading pharmacy dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadDashboardData}
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Pharmacy Dashboard</h2>
          <p className="text-gray-600">Manage medicine inventory and stock</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stock Alerts Bell */}
          <button
            onClick={() => setShowAlertsModal(true)}
            className="relative flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Bell className="w-4 h-4" />
            Alerts
            {stockAlerts.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {stockAlerts.length}
              </span>
            )}
          </button>
          
          {/* Refresh Alerts */}
          <button
            onClick={handleRefreshAlerts}
            disabled={refreshingAlerts}
            className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshingAlerts ? 'animate-spin' : ''}`} />
            {refreshingAlerts ? 'Checking...' : 'Check Alerts'}
          </button>
          
          <button
            onClick={() => setShowReturnModal(true)}
            className="flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Return Medicines
          </button>
          
          <button
            onClick={() => setShowAdjustmentModal(true)}
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Adjust Stock
          </button>
          
          <Link
            to="/pharmacy/inward"
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Stock
          </Link>
          <Link
            to="/pharmacy/suppliers"
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Package className="w-4 h-4" />
            Suppliers
          </Link>
          <Link
            to="/pharmacy/invoice-upload"
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
          >
            <FileText className="w-4 h-4" />
            AI Invoice Upload
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      {dashboardData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Medicines</p>
                <p className="text-2xl font-bold text-blue-600">{dashboardData.totalMedicines}</p>
              </div>
              <Pill className="w-8 h-8 text-blue-600" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Low Stock Items</p>
                <p className="text-2xl font-bold text-red-600">{dashboardData.lowStockCount}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Expiring Soon</p>
                <p className="text-2xl font-bold text-yellow-600">{dashboardData.expiringCount}</p>
              </div>
              <CalendarDays className="w-8 h-8 text-yellow-600" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Stock Value</p>
                <p className="text-2xl font-bold text-green-600">₹{dashboardData.totalStockValue.toLocaleString()}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-600" />
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            to="/pharmacy/inward"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Package className="w-6 h-6 text-green-600" />
            <div>
              <h4 className="font-medium text-gray-800">Receive Stock</h4>
              <p className="text-sm text-gray-600">Add new inventory</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <Link
            to="/pharmacy/invoice-upload"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-6 h-6 text-purple-600" />
            <div>
              <h4 className="font-medium text-gray-800">AI Invoice Processing</h4>
              <p className="text-sm text-gray-600">Upload & auto-extract invoice data</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <Link
            to="/pharmacy/reports"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <TrendingUp className="w-6 h-6 text-blue-600" />
            <div>
              <h4 className="font-medium text-gray-800">Stock Reports</h4>
              <p className="text-sm text-gray-600">View movement history</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <button
            onClick={() => setShowReturnModal(true)}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-6 h-6 text-orange-600" />
            <div>
              <h4 className="font-medium text-gray-800">Return to Supplier</h4>
              <p className="text-sm text-gray-600">Return medicines to suppliers</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </button>

          <button
            onClick={() => setShowAdjustmentModal(true)}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Settings className="w-6 h-6 text-purple-600" />
            <div>
              <h4 className="font-medium text-gray-800">Stock Adjustment</h4>
              <p className="text-sm text-gray-600">Manual stock corrections</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </button>

          <Link
            to="/settings/master-data"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Pill className="w-6 h-6 text-purple-600" />
            <div>
              <h4 className="font-medium text-gray-800">Medicine Master</h4>
              <p className="text-sm text-gray-600">Manage medicine data</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>
        </div>
      </div>

      {/* Medicine Inventory */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="font-semibold text-gray-800">Medicine Inventory</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setStockFilter('all')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    stockFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setStockFilter('low')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    stockFilter === 'low' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Low Stock
                </button>
                <button
                  onClick={() => setStockFilter('expiring')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    stockFilter === 'expiring' ? 'bg-yellow-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Expiring
                </button>
                <button
                  onClick={() => setStockFilter('out')}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    stockFilter === 'out' ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Out of Stock
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search medicines..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medicine
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Stock
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reorder Level
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cost Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Selling Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredMedicines.map(medicine => (
                <tr key={medicine.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{medicine.name}</div>
                      {medicine.genericName && (
                        <div className="text-sm text-gray-500">{medicine.genericName}</div>
                      )}
                      {medicine.batchNumber && (
                        <div className="text-xs text-gray-400">Batch: {medicine.batchNumber}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${
                      medicine.currentStock <= medicine.reorderLevel 
                        ? 'text-red-600' 
                        : 'text-gray-900'
                    }`}>
                      {medicine.currentStock}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {medicine.reorderLevel}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {medicine.costPrice ? `₹${medicine.costPrice}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {medicine.sellingPrice ? `₹${medicine.sellingPrice}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {medicine.currentStock <= medicine.reorderLevel ? (
                      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                        Low Stock
                      </span>
                    ) : medicine.expiryDate && new Date(medicine.expiryDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? (
                      <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
                        Expiring Soon
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                        In Stock
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredMedicines.length === 0 && (
          <div className="p-8 text-center">
            <Pill className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchTerm ? 'No medicines found matching your search' : 'No medicines in inventory'}
            </p>
          </div>
        )}
      </div>

      {/* Recent Stock Movements */}
      {dashboardData && dashboardData.recentMovements.length > 0 && (
        <div className="bg-white rounded-lg shadow-md">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-800">Recent Stock Movements</h3>
          </div>
          <div className="p-4">
            <div className="space-y-3">
              {dashboardData.recentMovements.slice(0, 5).map(movement => (
                <div key={movement.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      movement.movementType === 'inward' ? 'bg-green-500' : 
                      movement.movementType === 'outward' ? 'bg-red-500' : 
                      'bg-blue-500'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {movement.medicine?.name || 'Unknown Medicine'}
                      </p>
                      <p className="text-xs text-gray-600">
                        {movement.movementType === 'inward' ? '+' : '-'}{Math.abs(movement.quantityChange)} units
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">
                      {format(movement.movementDate, 'MMM dd, HH:mm')}
                    </p>
                    <p className="text-xs text-gray-500">
                      Stock: {movement.newStockLevel}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <Link
                to="/pharmacy/reports"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                View All Movements →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Stock Alerts Modal */}
      {showAlertsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-orange-600" />
                <h2 className="text-xl font-bold text-gray-800">Stock Alerts</h2>
                <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-sm">
                  {stockAlerts.length} active
                </span>
              </div>
              <button
                onClick={() => setShowAlertsModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              {stockAlerts.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">No active stock alerts</p>
                  <p className="text-sm text-gray-400 mt-2">All medicines are adequately stocked</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {stockAlerts.map(alert => (
                    <div key={alert.id} className="flex items-start justify-between p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertCircle className={`w-5 h-5 mt-0.5 ${
                          alert.alertType === 'low_stock' ? 'text-red-500' : 'text-yellow-500'
                        }`} />
                        <div>
                          <h4 className="font-medium text-gray-800">
                            {alert.medicine?.name || 'Unknown Medicine'}
                          </h4>
                          <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                          <p className="text-xs text-gray-400 mt-2">
                            {format(alert.createdAt, 'MMM dd, yyyy HH:mm')}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResolveAlert(alert.id)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors"
                      >
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Return to Supplier Modal */}
      {showReturnModal && (
        <ReturnToSupplierModal
          onSave={handleReturnSaved}
          onClose={() => setShowReturnModal(false)}
        />
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustmentModal && (
        <StockAdjustmentModal
          onSave={handleAdjustmentSaved}
          onClose={() => setShowAdjustmentModal(false)}
        />
      )}
    </div>
  );
};

export default PharmacyDashboard;