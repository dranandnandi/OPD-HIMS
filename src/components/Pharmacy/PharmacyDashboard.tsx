import ControlledSalesRegister from './ControlledSalesRegister';
import { StockExpiryIndicators } from './ExpiryBadge';
import { usePharmacyDate } from '../../hooks/usePharmacyDate';
import { expiryStatus, expiryWithin, type ExpiryLot } from '../../utils/pharmacyExpiry';
import { medicineCategories, dosageForms, stockedUnits, optionLabel } from '../../utils/medicineOptions';
import MedicineFlags, { MedicineFlagFields } from '../Pharmacy/MedicineFlags';
import React, { useState, useEffect, useMemo } from 'react';
import { Pill, TrendingUp, AlertCircle, Package, Plus, Search, CalendarDays, ArrowRight, Bell, RefreshCw, FileText, RotateCcw, Settings, X, Save, ClipboardList, Truck, Percent, BookOpen, MapPin, ShoppingCart } from 'lucide-react';
import { MedicineWithPrice, StockMovementLog, StockAlert, MedicineMaster } from '../../types';
import { packSpec, stockDisplay, fmtQty } from '../../utils/packUnits';
import { pharmacyService } from '../../services/pharmacyService';
import { masterDataService } from '../../services/masterDataService';
import { useAuth } from '../Auth/useAuth';
import { Link, useSearchParams } from 'react-router-dom';
import CounterSaleModal from './CounterSaleModal';
import PharmacySalesRegister from './PharmacySalesRegister';
import { format } from 'date-fns';
import ReturnToSupplierModal from './ReturnToSupplierModal';
import StockAdjustmentModal from './StockAdjustmentModal';
import { storeIndentService } from '../../services/storeIndentService';
import { jsPDF } from 'jspdf';

const PharmacyDashboard: React.FC = () => {
  const today = usePharmacyDate();
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<{
    totalMedicines: number;
    lowStockCount: number;
    expiringCount: number;
    expiredCount: number;
    totalStockValue: number;
    recentMovements: StockMovementLog[];
  } | null>(null);
  const [allMedicines, setAllMedicines] = useState<MedicineWithPrice[]>([]);
  const [expiryLots, setExpiryLots] = useState<ExpiryLot[]>([]);
  const expiryByMedicine = useMemo(() => {
    const grouped = new Map<string, ExpiryLot[]>();
    expiryLots.forEach(lot => grouped.set(lot.medicine.id, [...(grouped.get(lot.medicine.id) || []), lot]));
    grouped.forEach(lots => lots.sort((a,b) => (expiryStatus(a.expiryDate).days ?? Infinity) - (expiryStatus(b.expiryDate).days ?? Infinity)));
    return grouped;
  }, [expiryLots]);
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'expiring' | 'expired' | 'out'>('all');
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [refreshingAlerts, setRefreshingAlerts] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  // /pharmacy?sale=1 (sidebar "Counter Sale") opens the over-the-counter flow directly
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'controlled' ? 'controlled' : searchParams.get('view') === 'sales' ? 'sales' : 'stock';
  const [salesRevision, setSalesRevision] = useState(0);
  const [stockPage, setStockPage] = useState(0);
  useEffect(() => { setStockPage(0); }, [searchTerm, stockFilter]);
  useEffect(() => { if (searchParams.get('sale') === '1') setShowCounterSale(true); }, [searchParams]);
  const [showCounterSale, setShowCounterSale] = useState(searchParams.get('sale') === '1');
  const closeCounterSale = () => {
    setShowCounterSale(false);
    if (searchParams.get('sale')) {
      const next = new URLSearchParams(searchParams);
      next.delete('sale');
      setSearchParams(next, { replace: true });
    }
  };
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showAddMedicineModal, setShowAddMedicineModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ward indents waiting on the main pharmacy — the "IP Pharmacy has ordered" notification
  const [indentCounts, setIndentCounts] = useState<{ waiting: number; unseen: number }>({ waiting: 0, unseen: 0 });

  useEffect(() => {
    if (user) {
      loadDashboardData();
      loadStockAlerts();
      loadIndentCounts();
    }
  }, [user, today]);

  // A ward raising an indent lights the badge up without a refresh.
  useEffect(() => {
    if (!user?.clinicId) return;
    return storeIndentService.subscribe(user.clinicId, loadIndentCounts);
  }, [user?.clinicId]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      const clinicId = user?.clinicId;
      const data = await pharmacyService.getPharmacyDashboardData(clinicId);
      setDashboardData(data);
      setAllMedicines(data.medicines);
      setExpiryLots(data.expiryLots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pharmacy dashboard data');
      console.error('Error loading pharmacy dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadIndentCounts = async () => {
    if (!user?.clinicId) return;
    try {
      setIndentCounts(await storeIndentService.pharmacyNotificationCounts(user.clinicId));
    } catch (err) {
      console.error('Error loading ward indent counts:', err);
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
  };

  const handleAdjustmentSaved = () => {
    setShowAdjustmentModal(false);
    loadDashboardData(); // Reload dashboard data
  };

  const filteredMedicines = allMedicines.filter(medicine => {
    const matches = [medicine.name, medicine.genericName, medicine.batchNumber, medicine.rackLocation]
      .some(value => value?.toLowerCase().includes(searchTerm.toLowerCase()));
    const lots = expiryByMedicine.get(medicine.id) || [];
    const expiring = lots.some(lot => expiryWithin(lot.expiryDate, 30));
    const expired = lots.some(lot => expiryStatus(lot.expiryDate).kind === 'expired');
    return matches && (stockFilter === 'all' || (stockFilter === 'low' && medicine.currentStock <= medicine.reorderLevel)
      || (stockFilter === 'out' && medicine.currentStock <= 0) || (stockFilter === 'expiring' && expiring) || (stockFilter === 'expired' && expired));
  });
  const visibleStockPage = Math.min(stockPage, Math.max(0, Math.ceil(filteredMedicines.length / 50) - 1));

  const downloadDoctorMedicineList = () => {
    if (!filteredMedicines.length) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const margin = 12;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const columns = [
      { title: 'Medicine / Brand', width: 48, value: (m: MedicineWithPrice) => m.brandName || m.name },
      { title: 'Generic name', width: 58, value: (m: MedicineWithPrice) => m.genericName || '' },
      { title: 'Strength', width: 30, value: (m: MedicineWithPrice) => m.strength || '' },
      { title: 'Dosage form', width: 35, value: (m: MedicineWithPrice) => m.dosageForm || '' },
      { title: 'Pack', width: 35, value: (m: MedicineWithPrice) => [m.packSize ? `${m.packSize} units` : '', m.stockUnit, m.dispenseUnit ? `(${m.dispenseUnit})` : ''].filter(Boolean).join(' ') },
      { title: 'Manufacturer', width: 55, value: (m: MedicineWithPrice) => m.manufacturer || '' },
    ];
    const usableWidth = pageWidth - margin * 2;
    const scale = usableWidth / columns.reduce((sum, col) => sum + col.width, 0);
    const widths = columns.map(col => col.width * scale);
    const drawHeader = (continued = false) => {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text('Medicine Information for Doctors', margin, 13);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(`${filteredMedicines.length} medicines${searchTerm ? ` · Search: ${searchTerm}` : ''}${continued ? ' · continued' : ''}`, margin, 19);
      let x = margin;
      let y = 24;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setFillColor(239, 246, 255);
      pdf.rect(margin, y - 4, usableWidth, 7, 'F');
      columns.forEach((col, i) => { pdf.text(col.title, x + 1.5, y); x += widths[i]; });
      pdf.setFont('helvetica', 'normal');
      return y + 7;
    };
    let y = drawHeader();
    for (const medicine of filteredMedicines) {
      const values = columns.map(col => col.value(medicine));
      const lines = values.map((value, i) => pdf.splitTextToSize(value || '—', widths[i] - 3) as string[]);
      const rowHeight = Math.max(7, ...lines.map(cell => cell.length * 4 + 2));
      if (y + rowHeight > pdf.internal.pageSize.getHeight() - 10) {
        pdf.addPage();
        y = drawHeader(true);
      }
      let x = margin;
      lines.forEach((cell, i) => { pdf.text(cell, x + 1.5, y + 2, { baseline: 'top' }); x += widths[i]; });
      pdf.setDrawColor(220, 226, 232);
      pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      y += rowHeight;
    }
    pdf.save('doctor-medicine-information.pdf');
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view pharmacy dashboard.</p>
      </div>
    );
  }

  if (loading && !dashboardData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading pharmacy dashboard...</p>
      </div>
    );
  }

  if (error && !dashboardData) {
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
          <p className="text-gray-600">Stock, counter sales, invoices and saved PDFs</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setShowCounterSale(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><ShoppingCart className="w-4 h-4" />Counter Sale</button>
          <button disabled={loading} onClick={() => { loadDashboardData(); setSalesRevision(r => r + 1); }} className="flex items-center gap-2 border bg-white px-4 py-2 rounded-lg disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          {/* Ward indents — IP Pharmacy / ward stores have ordered stock */}
          <Link
            to="/pharmacy/indents"
            className="relative flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ClipboardList className="w-4 h-4" />
            Ward Indents
            {indentCounts.waiting > 0 && (
              <span className={`absolute -top-2 -right-2 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center ${indentCounts.unseen > 0 ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`}>
                {indentCounts.waiting}
              </span>
            )}
          </Link>

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

      {/* Ward indent notification — an order came in from the IP Pharmacy /
          a ward store and is waiting to be dispatched from the main pool */}
      {indentCounts.waiting > 0 && (
        <Link
          to="/pharmacy/indents"
          className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 hover:bg-amber-100 transition-colors"
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-white">
            <Truck className="w-5 h-5" />
          </span>
          <div>
            <p className="font-medium text-amber-900">
              {indentCounts.waiting} ward indent{indentCounts.waiting === 1 ? '' : 's'} waiting to be dispatched
              {indentCounts.unseen > 0 && ` · ${indentCounts.unseen} new`}
            </p>
            <p className="text-sm text-amber-800">
              The IP Pharmacy / ward stores have ordered stock from the main pharmacy. Open to dispatch.
            </p>
          </div>
          <ArrowRight className="w-5 h-5 text-amber-700 ml-auto" />
        </Link>
      )}

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
                <button onClick={() => setStockFilter('expired')} className="text-sm text-red-700 underline">Expired stock: {dashboardData.expiredCount}</button>
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

      {error && <p role="alert" className="text-red-700 bg-red-50 p-3 rounded">{error}</p>}
      <nav aria-label="Pharmacy views" className="flex flex-wrap gap-2 border-b pb-3">
        {([['stock', 'Current Stock'], ['sales', 'Sales & Bills'], ['controlled', 'NRx / H1 Register']] as const).map(([key, label]) => <button key={key} aria-current={view === key ? 'page' : undefined}
          onClick={() => { const next = new URLSearchParams(searchParams); next.set('view', key); setSearchParams(next, { replace: true }); }}
          className={`px-5 py-3 rounded-lg font-medium ${view === key ? 'bg-blue-600 text-white' : 'bg-white border text-gray-700'}`}>{label}</button>)}
      </nav>
      {/* Quick Actions */}
      <details className="bg-white rounded-lg shadow-md p-4">
        <summary className="font-semibold text-gray-800 cursor-pointer">Operations &amp; Reports</summary>
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

          <button
            onClick={() => setShowCounterSale(true)}
            className="flex items-center gap-3 p-4 border-2 border-blue-500 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-left"
          >
            <ShoppingCart className="w-6 h-6 text-blue-700" />
            <div>
              <h4 className="font-medium text-gray-800">Counter Sale</h4>
              <p className="text-sm text-gray-600">Over-the-counter sale with GST invoice</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </button>

          <Link
            to="/pharmacy/indents"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ClipboardList className="w-6 h-6 text-amber-600" />
            <div>
              <h4 className="font-medium text-gray-800">Ward Indents</h4>
              <p className="text-sm text-gray-600">Dispatch stock ordered by IP Pharmacy</p>
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

          <button
            onClick={() => setShowAddMedicineModal(true)}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-6 h-6 text-green-600" />
            <div>
              <h4 className="font-medium text-gray-800">Add Medicine</h4>
              <p className="text-sm text-gray-600">Add new medicine to inventory</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </button>

          <Link
            to="/pharmacy/medicines"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Pill className="w-6 h-6 text-purple-600" />
            <div>
              <h4 className="font-medium text-gray-800">Medicine Master</h4>
              <p className="text-sm text-gray-600">Rack, HSN, GST rate, barcode per SKU</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <Link
            to="/pharmacy/purchases"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <BookOpen className="w-6 h-6 text-teal-600" />
            <div>
              <h4 className="font-medium text-gray-800">Purchase Register</h4>
              <p className="text-sm text-gray-600">Supplier invoices, debit notes, GST input</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <Link
            to="/pharmacy/gst"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Percent className="w-6 h-6 text-blue-600" />
            <div>
              <h4 className="font-medium text-gray-800">GST Reports</h4>
              <p className="text-sm text-gray-600">Output, input credit, net payable</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>

          <Link
            to="/pharmacy/mis"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <TrendingUp className="w-6 h-6 text-emerald-600" />
            <div>
              <h4 className="font-medium text-gray-800">Pharmacy MIS</h4>
              <p className="text-sm text-gray-600">Margin, valuation, dead & expired stock</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 ml-auto" />
          </Link>
        </div>
      </details>

      {view === 'controlled' && <ControlledSalesRegister revision={salesRevision} />}
      {view === 'sales' && <PharmacySalesRegister revision={salesRevision} />}
      {view === 'stock' && <>
      {/* Medicine Inventory */}
      <div className="bg-white rounded-lg shadow-md">
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-gray-800">Medicine Inventory</h3>
              <button type="button" onClick={downloadDoctorMedicineList} disabled={!filteredMedicines.length}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Download doctor-facing medicine information without pricing or tax details">
                <FileText className="h-4 w-4" /> Doctor PDF
              </button>
            </div>
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
                <button onClick={() => setStockFilter('expired')} className={`px-3 py-1 text-sm rounded-full ${stockFilter === 'expired' ? 'bg-red-700 text-white' : 'bg-red-100 text-red-800'}`}>Expired</button>
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
                  Rack
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
              {filteredMedicines.slice(visibleStockPage * 50, (visibleStockPage + 1) * 50).map(medicine => (
                <tr key={medicine.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{medicine.name}<MedicineFlags medicine={medicine} /></div>
                      {medicine.genericName && (
                        <div className="text-sm text-gray-500">{medicine.genericName}</div>
                      )}
                      {medicine.batchNumber && (
                        <div className="text-xs text-gray-400">Batch: {medicine.batchNumber}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {medicine.rackLocation ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs font-medium">
                        <MapPin className="w-3 h-3" />{medicine.rackLocation}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${
                      medicine.currentStock <= medicine.reorderLevel 
                        ? 'text-red-600' 
                        : 'text-gray-900'
                    }`}>
                      {stockDisplay(medicine.currentStock, packSpec(medicine))}
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
                    <div className="space-y-1">
                      {medicine.currentStock <= 0 ? <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">Out of stock</span>
                        : medicine.currentStock <= medicine.reorderLevel && <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Low Stock</span>}
                      <StockExpiryIndicators lots={expiryByMedicine.get(medicine.id) || []} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredMedicines.length > 0 && <div className="p-4 border-t flex justify-between text-sm items-center">
          <span>{visibleStockPage * 50 + 1}-{Math.min((visibleStockPage + 1) * 50, filteredMedicines.length)} of {filteredMedicines.length} medicines</span>
          <div className="flex gap-3"><button disabled={visibleStockPage === 0} onClick={() => setStockPage(visibleStockPage - 1)} className="border rounded px-3 py-1 disabled:opacity-40">Previous</button>
          <button disabled={(visibleStockPage + 1) * 50 >= filteredMedicines.length} onClick={() => setStockPage(visibleStockPage + 1)} className="border rounded px-3 py-1 disabled:opacity-40">Next</button></div>
        </div>}
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
                        {movement.movementType === 'inward' ? '+' : '-'}{fmtQty(Math.abs(movement.quantityChange))} units
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

      </>}

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

      {/* Counter Sale (no visit) */}
      {showCounterSale && (
        <CounterSaleModal
          onClose={closeCounterSale}
          onSaved={() => {
            setSalesRevision(r => r + 1);
            loadDashboardData();
          }}
        />
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

      {/* Add Medicine Modal */}
      {showAddMedicineModal && (
        <AddMedicineModal
          onSave={async (medicineData) => {
            try {
              await masterDataService.addMedicine(medicineData);
              setShowAddMedicineModal(false);
              await loadDashboardData();
              alert('Medicine added successfully!');
            } catch (error) {
              console.error('Error adding medicine:', error);
              alert('Failed to add medicine. Please try again.');
            }
          }}
          onClose={() => setShowAddMedicineModal(false)}
        />
      )}
    </div>
  );
};

// Add Medicine Modal Component
const AddMedicineModal: React.FC<{
  onSave: (medicine: Omit<MedicineMaster, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}> = ({ onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    genericName: '',
    brandName: '',
    category: 'other' as string,
    dosageForm: 'other' as string,
    strength: '',
    manufacturer: '',
    description: '',
    unit: '',
    sideEffects: [] as string[],
    contraindications: [] as string[],
    currentStock: 0,
    reorderLevel: 0,
    batchNumber: '',
    expiryDate: undefined as Date | undefined,
    packSize: 1,
    stockUnit: '',
    dispenseUnit: '',
    allowLooseSale: true,
    isNrx: false,
    isScheduleH1: false,
    isActive: true
  });

  const [sideEffectInput, setSideEffectInput] = useState('');
  const [contraindicationInput, setContraindicationInput] = useState('');



  const handleAddSideEffect = () => {
    if (sideEffectInput.trim()) {
      setFormData({
        ...formData,
        sideEffects: [...formData.sideEffects, sideEffectInput.trim()]
      });
      setSideEffectInput('');
    }
  };

  const handleRemoveSideEffect = (index: number) => {
    setFormData({
      ...formData,
      sideEffects: formData.sideEffects.filter((_, i) => i !== index)
    });
  };

  const handleAddContraindication = () => {
    if (contraindicationInput.trim()) {
      setFormData({
        ...formData,
        contraindications: [...formData.contraindications, contraindicationInput.trim()]
      });
      setContraindicationInput('');
    }
  };

  const handleRemoveContraindication = (index: number) => {
    setFormData({
      ...formData,
      contraindications: formData.contraindications.filter((_, i) => i !== index)
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Medicine name is required');
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-800">Add New Medicine</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Basic Information */}
            <div className="md:col-span-2">
              <h4 className="text-md font-medium text-gray-700 mb-3">Basic Information</h4>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Medicine Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Paracetamol"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Generic Name</label>
              <input
                type="text"
                value={formData.genericName}
                onChange={(e) => setFormData({ ...formData, genericName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Acetaminophen"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
              <input
                type="text"
                value={formData.brandName}
                onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., Crocin"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {medicineCategories.map(cat => (
                  <option key={cat} value={cat}>{optionLabel(cat)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dosage Form</label>
              <select
                value={formData.dosageForm}
                onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {dosageForms.map(form => (
                  <option key={form} value={form}>{optionLabel(form)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Strength</label>
              <input
                type="text"
                value={formData.strength}
                onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 500mg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., tablets, ml, gm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
              <input
                type="text"
                value={formData.manufacturer}
                onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., GSK Pharmaceuticals"
              />
            </div>

            {/* Inventory Information */}
            <div className="md:col-span-2 mt-4">
              <h4 className="text-md font-medium text-gray-700 mb-3">Inventory Information</h4>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Current Stock ({formData.stockUnit || 'Pack'}s)
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={formData.currentStock}
                onChange={(e) => setFormData({ ...formData, currentStock: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <MedicineFlagFields value={formData} onChange={patch => setFormData({ ...formData, ...patch })} />
            <datalist id="medicine-stocked-units">{stockedUnits.map(unit => <option key={unit} value={unit} />)}</datalist>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stocked unit</label>
              <input
                type="text"
                list="medicine-stocked-units"
                      value={formData.stockUnit}
                onChange={(e) => setFormData({ ...formData, stockUnit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Strip / Bottle / Vial"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dispense unit</label>
              <input
                type="text"
                value={formData.dispenseUnit}
                onChange={(e) => setFormData({ ...formData, dispenseUnit: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Tablet / ml"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pack size</label>
              <input
                type="number"
                min="1"
                step="0.001"
                value={formData.packSize}
                onChange={(e) => setFormData({ ...formData, packSize: parseFloat(e.target.value) || 1 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="10"
              />
              <p className="text-xs text-gray-500 mt-1">
                1 {formData.stockUnit || 'Pack'} = {formData.packSize || 1} {formData.dispenseUnit || 'Unit'}. Lets the counter sell half a strip.
              </p>
            </div>

            <div className="flex items-start gap-3 pt-7">
              <input
                id="dashAllowLooseSale"
                type="checkbox"
                checked={formData.allowLooseSale}
                onChange={(e) => setFormData({ ...formData, allowLooseSale: e.target.checked })}
                className="mt-1 rounded"
              />
              <label htmlFor="dashAllowLooseSale" className="text-sm text-gray-700">
                May be sold loose
                <span className="block text-xs text-gray-500">Untick for a sealed pack that can only leave whole.</span>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
              <input
                type="number"
                min="0"
                value={formData.reorderLevel}
                onChange={(e) => setFormData({ ...formData, reorderLevel: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch Number</label>
              <input
                type="text"
                value={formData.batchNumber}
                onChange={(e) => setFormData({ ...formData, batchNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., BATCH123"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date</label>
              <input
                type="date"
                value={formData.expiryDate ? formData.expiryDate.toISOString().split('T')[0] : ''}
                onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value ? new Date(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Additional information about the medicine"
              />
            </div>

            {/* Side Effects */}
            <div className="md:col-span-2 mt-4">
              <h4 className="text-md font-medium text-gray-700 mb-3">Side Effects</h4>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={sideEffectInput}
                  onChange={(e) => setSideEffectInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSideEffect())}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter a side effect"
                />
                <button
                  type="button"
                  onClick={handleAddSideEffect}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.sideEffects.map((effect, index) => (
                  <span key={index} className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm">
                    {effect}
                    <button type="button" onClick={() => handleRemoveSideEffect(index)} className="hover:text-red-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Contraindications */}
            <div className="md:col-span-2 mt-4">
              <h4 className="text-md font-medium text-gray-700 mb-3">Contraindications</h4>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={contraindicationInput}
                  onChange={(e) => setContraindicationInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddContraindication())}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter a contraindication"
                />
                <button
                  type="button"
                  onClick={handleAddContraindication}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.contraindications.map((contraindication, index) => (
                  <span key={index} className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm">
                    {contraindication}
                    <button type="button" onClick={() => handleRemoveContraindication(index)} className="hover:text-yellow-900">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Active Status */}
            <div className="md:col-span-2 mt-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-gray-700">
                  Active (available for prescription)
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save Medicine
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PharmacyDashboard;
