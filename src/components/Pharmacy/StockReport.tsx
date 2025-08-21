import React, { useState, useEffect } from 'react';
import { Search, Filter, Calendar, TrendingUp, TrendingDown, BarChart3, AlertTriangle, Clock, Package, Pill } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { StockMovementLog, MedicineMaster, MedicineWithPrice } from '../../types';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { useAuth } from '../Auth/useAuth';

const StockReport: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'movements' | 'low-stock' | 'expiring'>('movements');
  const [movements, setMovements] = useState<StockMovementLog[]>([]);
  const [lowStockMedicines, setLowStockMedicines] = useState<MedicineWithPrice[]>([]);
  const [expiringMedicines, setExpiringMedicines] = useState<MedicineWithPrice[]>([]);
  const [medicines, setMedicines] = useState<MedicineMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMedicine, setSelectedMedicine] = useState('');
  const [movementType, setMovementType] = useState<'all' | 'inward' | 'outward' | 'adjustment' | 'return'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expiryDaysFilter, setExpiryDaysFilter] = useState(30);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const clinicId = user?.clinicId;
      
      if (activeTab === 'movements') {
        const [movementsData, medicinesData] = await Promise.all([
          pharmacyService.getStockMovementLog(),
          masterDataService.getMedicines()
        ]);
        setMovements(movementsData);
        setMedicines(medicinesData);
      } else if (activeTab === 'low-stock') {
        const lowStockData = await pharmacyService.getLowStockMedicines(clinicId);
        setLowStockMedicines(lowStockData);
      } else if (activeTab === 'expiring') {
        const expiringData = await pharmacyService.getExpiringMedicines(expiryDaysFilter, clinicId);
        setExpiringMedicines(expiringData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data');
      console.error('Error loading report data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMovements = movements.filter(movement => {
    // Search filter
    const matchesSearch = !searchTerm || 
      movement.medicine?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      movement.remarks?.toLowerCase().includes(searchTerm.toLowerCase());

    // Medicine filter
    const matchesMedicine = !selectedMedicine || movement.medicineId === selectedMedicine;

    // Movement type filter
    const matchesType = movementType === 'all' || movement.movementType === movementType;

    // Date range filter
    const movementDate = new Date(movement.movementDate);
    const matchesDateFrom = !dateFrom || movementDate >= new Date(dateFrom);
    const matchesDateTo = !dateTo || movementDate <= new Date(dateTo);

    return matchesSearch && matchesMedicine && matchesType && matchesDateFrom && matchesDateTo;
  });

  const filteredLowStock = lowStockMedicines.filter(medicine =>
    !searchTerm || 
    medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.genericName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredExpiring = expiringMedicines.filter(medicine =>
    !searchTerm || 
    medicine.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.genericName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getMovementIcon = (type: string) => {
    switch (type) {
      case 'inward':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'outward':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      default:
        return <BarChart3 className="w-4 h-4 text-blue-600" />;
    }
  };

  const getMovementColor = (type: string) => {
    switch (type) {
      case 'inward':
        return 'bg-green-100 text-green-800';
      case 'outward':
        return 'bg-red-100 text-red-800';
      case 'adjustment':
        return 'bg-blue-100 text-blue-800';
      case 'return':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getExpiryStatus = (expiryDate: Date) => {
    const daysUntilExpiry = differenceInDays(expiryDate, new Date());
    if (daysUntilExpiry <= 0) return { status: 'Expired', color: 'bg-red-100 text-red-800' };
    if (daysUntilExpiry <= 7) return { status: 'Critical', color: 'bg-red-100 text-red-800' };
    if (daysUntilExpiry <= 30) return { status: 'Warning', color: 'bg-yellow-100 text-yellow-800' };
    return { status: 'Good', color: 'bg-green-100 text-green-800' };
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedMedicine('');
    setMovementType('all');
    setDateFrom('');
    setDateTo('');
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view stock reports.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading report data...</p>
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Pharmacy Reports</h2>
          <p className="text-gray-600">Comprehensive inventory and stock analysis</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Stock Movements Today</p>
              <p className="text-2xl font-bold text-blue-600">
                {movements.filter(m => 
                  new Date(m.movementDate).toDateString() === new Date().toDateString()
                ).length}
              </p>
            </div>
            <BarChart3 className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Low Stock Items</p>
              <p className="text-2xl font-bold text-red-600">{lowStockMedicines.length}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Expiring Soon</p>
              <p className="text-2xl font-bold text-yellow-600">{expiringMedicines.length}</p>
            </div>
            <Clock className="w-8 h-8 text-yellow-600" />
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="border-b border-gray-200">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('movements')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'movements'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              Stock Movements
            </button>
            <button
              onClick={() => setActiveTab('low-stock')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'low-stock'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
              Low Stock Report
              {lowStockMedicines.length > 0 && (
                <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                  {lowStockMedicines.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('expiring')}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === 'expiring'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Clock className="w-4 h-4" />
              Expiring Medicines
              {expiringMedicines.length > 0 && (
                <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
                  {expiringMedicines.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Filters */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-800">Filters</h3>
            <button
              onClick={clearFilters}
              className="ml-auto text-blue-600 hover:text-blue-700 text-sm"
            >
              Clear All
            </button>
          </div>

          {activeTab === 'movements' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Medicine name, remarks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Medicine Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Medicine</label>
                <select
                  value={selectedMedicine}
                  onChange={(e) => setSelectedMedicine(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Medicines</option>
                  {medicines.map(medicine => (
                    <option key={medicine.id} value={medicine.id}>
                      {medicine.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Movement Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Movement Type</label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as typeof movementType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="all">All Types</option>
                  <option value="inward">Inward</option>
                  <option value="outward">Outward</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="return">Return</option>
                </select>
              </div>

              {/* Date From */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Date To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          )}

          {(activeTab === 'low-stock' || activeTab === 'expiring') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Medicine name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Expiry Days Filter (only for expiring tab) */}
              {activeTab === 'expiring' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Days Ahead</label>
                  <select
                    value={expiryDaysFilter}
                    onChange={(e) => {
                      setExpiryDaysFilter(parseInt(e.target.value));
                      // Reload data when filter changes
                      setTimeout(loadData, 100);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value={7}>Next 7 days</option>
                    <option value={15}>Next 15 days</option>
                    <option value={30}>Next 30 days</option>
                    <option value={60}>Next 60 days</option>
                    <option value={90}>Next 90 days</option>
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Stock Movements Tab */}
          {activeTab === 'movements' && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date & Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Medicine
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity Change
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      New Stock Level
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Moved By
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Remarks
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredMovements.map(movement => (
                    <tr key={movement.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                          <div className="text-sm text-gray-900">
                            {format(movement.movementDate, 'MMM dd, yyyy HH:mm')}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {movement.medicine?.name || 'Unknown Medicine'}
                        </div>
                        {movement.medicine?.genericName && (
                          <div className="text-sm text-gray-500">{movement.medicine.genericName}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {getMovementIcon(movement.movementType)}
                          <span className={`px-2 py-1 text-xs rounded-full ${getMovementColor(movement.movementType)}`}>
                            {movement.movementType}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-medium ${
                          movement.quantityChange > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {movement.newStockLevel}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {movement.movedByProfile?.name || 'System'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {movement.remarks || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredMovements.length === 0 && (
                <div className="p-8 text-center">
                  <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {searchTerm || selectedMedicine || movementType !== 'all' || dateFrom || dateTo
                      ? 'No movements found matching your filters'
                      : 'No stock movements recorded yet'
                    }
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Low Stock Tab */}
          {activeTab === 'low-stock' && (
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
                      Shortage
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLowStock.map(medicine => {
                    const shortage = medicine.reorderLevel - medicine.currentStock;
                    return (
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
                            medicine.currentStock === 0 ? 'text-red-600' : 'text-orange-600'
                          }`}>
                            {medicine.currentStock}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.reorderLevel}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-red-600">
                            {shortage > 0 ? shortage : 0}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.category}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            medicine.currentStock === 0 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {medicine.currentStock === 0 ? 'Out of Stock' : 'Low Stock'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredLowStock.length === 0 && (
                <div className="p-8 text-center">
                  <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {searchTerm 
                      ? 'No low stock medicines found matching your search' 
                      : 'No medicines are currently low on stock'
                    }
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Expiring Medicines Tab */}
          {activeTab === 'expiring' && (
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
                      Expiry Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Days Remaining
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Batch Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredExpiring.map(medicine => {
                    const daysRemaining = medicine.expiryDate ? differenceInDays(medicine.expiryDate, new Date()) : 0;
                    const expiryStatus = medicine.expiryDate ? getExpiryStatus(medicine.expiryDate) : { status: 'Unknown', color: 'bg-gray-100 text-gray-800' };
                    
                    return (
                      <tr key={medicine.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{medicine.name}</div>
                            {medicine.genericName && (
                              <div className="text-sm text-gray-500">{medicine.genericName}</div>
                            )}
                            <div className="text-xs text-gray-400">{medicine.category}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.currentStock}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.expiryDate ? format(medicine.expiryDate, 'MMM dd, yyyy') : 'Not set'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${
                            daysRemaining <= 0 ? 'text-red-600' :
                            daysRemaining <= 7 ? 'text-red-600' :
                            daysRemaining <= 30 ? 'text-yellow-600' :
                            'text-green-600'
                          }`}>
                            {daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days`}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {medicine.batchNumber || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${expiryStatus.color}`}>
                            {expiryStatus.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredExpiring.length === 0 && (
                <div className="p-8 text-center">
                  <Clock className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {searchTerm 
                      ? 'No expiring medicines found matching your search' 
                      : `No medicines expiring in the next ${expiryDaysFilter} days`
                    }
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StockReport;