import React, { useState, useEffect } from 'react';
import { IndianRupee, FileText, Calendar, Search, Plus, Eye, Edit, RotateCcw, MessageCircle, Loader2 } from 'lucide-react';
import { Bill, Patient } from '../../types';
import { billingService } from '../../services/billingService';
import { patientService } from '../../services/patientService';
import { useAuth } from '../Auth/useAuth';
import { format } from 'date-fns';
import BillModal from './BillModal';
import { toTitleCase } from '../../utils/stringUtils';
import RefundRequestModal from './RefundRequestModal';
import { useWhatsApp } from '../../hooks/useWhatsApp';
import { buildInvoiceMessage } from '../../services/whatsappApi';

const BillingDashboard: React.FC = () => {
  const { user } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  
  // Temporary filter states (for input fields)
  const [tempSearchTerm, setTempSearchTerm] = useState('');
  const [tempStatusFilter, setTempStatusFilter] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all');
  const [tempPaymentMethodFilter, setTempPaymentMethodFilter] = useState('');
  const [tempDoctorFilter, setTempDoctorFilter] = useState('');
  const [tempDateFromFilter, setTempDateFromFilter] = useState('');
  const [tempDateToFilter, setTempDateToFilter] = useState('');
  
  // Applied filter states (actually used for filtering)
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const [appliedStatusFilter, setAppliedStatusFilter] = useState<'all' | 'pending' | 'paid' | 'overdue'>('all');
  const [appliedPaymentMethodFilter, setAppliedPaymentMethodFilter] = useState('');
  const [appliedDoctorFilter, setAppliedDoctorFilter] = useState('');
  const [appliedDateFromFilter, setAppliedDateFromFilter] = useState('');
  const [appliedDateToFilter, setAppliedDateToFilter] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundBill, setRefundBill] = useState<Bill | null>(null);
  const [whatsappBillId, setWhatsappBillId] = useState<string | null>(null);
  const { sendBillMessage } = useWhatsApp({ clinicId: user?.clinicId, userId: user?.id });

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [billsData, patientsData] = await Promise.all([
        billingService.getBills(),
        patientService.getPatients()
      ]);
      
      setBills(billsData);
      setPatients(patientsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
      console.error('Error loading billing data:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredBills = bills.filter(bill => {
    const matchesSearch = !appliedSearchTerm || 
      bill.billNumber.toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      bill.patient?.name.toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      bill.patient?.phone.includes(appliedSearchTerm);
    
    const matchesStatus = appliedStatusFilter === 'all' || bill.paymentStatus === appliedStatusFilter;
    
    const matchesPaymentMethod = !appliedPaymentMethodFilter || bill.paymentMethod === appliedPaymentMethodFilter;
    
    const matchesDoctor = !appliedDoctorFilter || (bill.visit?.doctorId === appliedDoctorFilter);
    
    const billDate = new Date(bill.billDate);
    const matchesDateFrom = !appliedDateFromFilter || billDate >= new Date(appliedDateFromFilter);
    const matchesDateTo = !appliedDateToFilter || billDate <= new Date(appliedDateToFilter);
    
    return matchesSearch && matchesStatus && matchesPaymentMethod && matchesDoctor && matchesDateFrom && matchesDateTo;
  });

  const getStatusColor = (status: Bill['paymentStatus']) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'partial': return 'bg-blue-100 text-blue-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRefundStatusColor = (status: Bill['refundStatus']) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-50 text-yellow-800 border border-yellow-200';
      case 'partial':
        return 'bg-blue-50 text-blue-800 border border-blue-200';
      case 'refunded':
        return 'bg-green-50 text-green-800 border border-green-200';
      default:
        return 'bg-gray-50 text-gray-600 border border-gray-200';
    }
  };

  const formatRefundStatus = (status: Bill['refundStatus']) => status.replace(/_/g, ' ');

  const canRequestRefund = (bill: Bill) => bill.paidAmount - bill.totalRefundedAmount > 1 && canEditBill(bill);

  const handleRefundClick = (bill: Bill) => {
    setRefundBill(bill);
    setShowRefundModal(true);
  };

  const handleRefundCompleted = () => {
    setShowRefundModal(false);
    setRefundBill(null);
    loadData();
  };

  const totalRevenue = bills.reduce((sum, bill) => sum + bill.paidAmount, 0);
  const pendingAmount = bills.reduce((sum, bill) => sum + bill.balanceAmount, 0);
  const totalBills = bills.length;
  const paidBills = bills.filter(bill => bill.paymentStatus === 'paid').length;

  const applyFilters = () => {
    setAppliedSearchTerm(tempSearchTerm);
    setAppliedStatusFilter(tempStatusFilter);
    setAppliedPaymentMethodFilter(tempPaymentMethodFilter);
    setAppliedDoctorFilter(tempDoctorFilter);
    setAppliedDateFromFilter(tempDateFromFilter);
    setAppliedDateToFilter(tempDateToFilter);
  };

  const clearFilters = () => {
    // Clear temporary filters
    setTempSearchTerm('');
    setTempStatusFilter('all');
    setTempPaymentMethodFilter('');
    setTempDoctorFilter('');
    setTempDateFromFilter('');
    setTempDateToFilter('');
    
    // Clear applied filters
    setAppliedSearchTerm('');
    setAppliedStatusFilter('all');
    setAppliedPaymentMethodFilter('');
    setAppliedDoctorFilter('');
    setAppliedDateFromFilter('');
    setAppliedDateToFilter('');
  };

  const handleNewBill = () => {
    setSelectedBill(null);
    setShowBillModal(true);
  };

  const handleViewBill = (bill: Bill) => {
    setSelectedBill(bill);
    setShowBillModal(true);
  };

  const handleEditBill = (bill: Bill) => {
    setSelectedBill(bill);
    setShowBillModal(true);
  };

  // Check if user can edit bills
  const canEditBills = () => {
    if (!user) return false;
    const roleName = user.roleName?.toLowerCase();
    return roleName === 'admin' || 
           roleName === 'super_admin' || 
           user.permissions?.includes('edit_bills') ||
           user.permissions?.includes('manage_billing');
  };

  // Check if user can edit a specific bill (additional checks can be added)
  const canEditBill = (bill: Bill) => {
    if (!canEditBills()) return false;
    
    // Additional checks can be added here, such as:
    // - Bill status (e.g., can't edit paid bills)
    // - Time-based restrictions (e.g., can't edit bills older than X days)
    // - User role restrictions (e.g., only bill creator can edit)
    
    // For now, if user has edit permission, allow editing
    return true;
  };

  const handleBillSaved = () => {
    setShowBillModal(false);
    setSelectedBill(null);
    loadData(); // Reload data to show changes
  };

  const handleSendWhatsApp = async (bill: Bill) => {
    if (!bill.patient?.phone) {
      alert('Patient phone number is missing.');
      return;
    }

    try {
      setWhatsappBillId(bill.id);
      
      // Generate PDF directly without fetching clinic settings (use cached data from user context)
      const { pdfService } = await import('../../services/pdfService');
      
      // Use clinic data from user context instead of fetching
      const clinicSettings = user?.clinic ? {
        id: user.clinic.id,
        clinicName: user.clinic.clinicName || 'Clinic',
        address: user.clinic.address || '',
        phone: user.clinic.phone || '',
        email: user.clinic.email || '',
        logo: user.clinic.logo || null,
        headerText: user.clinic.headerText || '',
        footerText: user.clinic.footerText || ''
      } : null;
      
      const pdfUrl = await pdfService.generatePdfFromData('bill', {
        bill,
        patient: bill.patient,
        clinicSettings
      });
      
      // Send PDF via WhatsApp
      const { whatsappApi } = await import('../../services/whatsappApi');
      const clinicName = user?.clinic?.clinicName || 'Clinic';
      const patientName = bill.patient.name;
      const caption = `Dear ${patientName},\n\nThank you for visiting ${clinicName}.\n\nYour bill #${bill.billNumber} for ₹${bill.totalAmount.toLocaleString('en-IN')} is attached.\n\n${bill.balanceAmount > 0 ? `Balance due: ₹${bill.balanceAmount.toLocaleString('en-IN')}\n\n` : ''}Regards,\n${clinicName}`;
      
      await whatsappApi.sendBillPdf({
        phone: bill.patient.phone,
        fileUrl: pdfUrl,
        caption,
        fileName: `bill_${bill.billNumber}.pdf`,
        billNumber: bill.billNumber,
        patientName: bill.patient.name,
        totalAmount: bill.totalAmount
      }, {
        userId: user?.id,
        clinicId: user?.clinicId
      });
      
      alert('Bill PDF sent via WhatsApp successfully.');
    } catch (error) {
      console.error('Failed to send bill PDF via WhatsApp', error);
      alert(error instanceof Error ? error.message : 'Failed to send bill PDF via WhatsApp');
    } finally {
      setWhatsappBillId(null);
    }
  };

  const getBillSource = (bill: Bill) => {
    return bill.visitId ? 'Visit' : 'Direct';
  };

  const getBillSourceColor = (source: string) => {
    switch (source) {
      case 'Visit': return 'bg-blue-100 text-blue-800';
      case 'Direct': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view billing data.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading billing data...</p>
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
    <div className="section-spacing">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2>Billing Dashboard</h2>
        <button 
          onClick={handleNewBill}
          className="primary-button flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Bill
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div>
            <p className="text-sm text-gray-600">Total Revenue</p>
            <p className="text-3xl font-bold text-green-600">₹{totalRevenue.toLocaleString()}</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Amount</p>
              <p className="text-3xl font-bold text-yellow-600">₹{pendingAmount.toLocaleString()}</p>
            </div>
            <Calendar className="w-8 h-8 text-yellow-600" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Bills</p>
              <p className="text-3xl font-bold text-blue-600">{totalBills}</p>
            </div>
            <FileText className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Paid Bills</p>
              <p className="text-3xl font-bold text-purple-600">{paidBills}</p>
            </div>
            <IndianRupee className="w-8 h-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search bills, patients..."
              value={tempSearchTerm}
              onChange={(e) => setTempSearchTerm(e.target.value)}
              className="input-field pl-12"
            />
          </div>
          
          <select
            value={tempStatusFilter}
            onChange={(e) => setTempStatusFilter(e.target.value as typeof tempStatusFilter)}
            className="input-field"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
          
          <select
            value={tempPaymentMethodFilter}
            onChange={(e) => setTempPaymentMethodFilter(e.target.value)}
            className="input-field"
          >
            <option value="">All Payment Methods</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="online">Online</option>
          </select>
          
          <select
            value={tempDoctorFilter}
            onChange={(e) => setTempDoctorFilter(e.target.value)}
            className="input-field"
          >
            <option value="">All Doctors</option>
            {doctors.map(doctor => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
          
          <input
            type="date"
            value={tempDateFromFilter}
            onChange={(e) => setTempDateFromFilter(e.target.value)}
            className="input-field"
            placeholder="From Date"
          />
          
          <input
            type="date"
            value={tempDateToFilter}
            onChange={(e) => setTempDateToFilter(e.target.value)}
            className="input-field"
            placeholder="To Date"
          />
          </div>
          
          {/* Filter Action Buttons */}
          <div className="flex justify-end gap-4">
            <button
              onClick={clearFilters}
              className="secondary-button"
            >
              Clear Filters
            </button>
            <button
              onClick={applyFilters}
              className="primary-button"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>

      {/* Bills Table */}
      <div className="card p-0 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3>Recent Bills</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Bill Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Patient
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Refunds
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredBills.map(bill => (
                <tr key={bill.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {bill.billNumber}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {toTitleCase(bill.patient?.name || 'Unknown')}
                      </div>
                      <div className="text-sm text-gray-500">
                        {bill.patient?.phone || 'No phone'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {format(bill.billDate, 'MMM dd, yyyy')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">₹{bill.totalAmount.toLocaleString()}</div>
                    {bill.balanceAmount > 0 && (
                      <div className="text-sm text-red-600">
                        Balance: ₹{bill.balanceAmount.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getBillSourceColor(getBillSource(bill))}`}>
                      {getBillSource(bill)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(bill.paymentStatus)}`}>
                      {bill.paymentStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div className={`inline-flex flex-col px-3 py-2 rounded-xl text-xs font-medium ${getRefundStatusColor(bill.refundStatus)}`}>
                      <span className="uppercase tracking-wide">{formatRefundStatus(bill.refundStatus)}</span>
                      <span className="text-xs text-gray-500">₹{bill.totalRefundedAmount.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleViewBill(bill)}
                        className="text-blue-600 hover:text-blue-900"
                        title="View Bill"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {canEditBill(bill) ? (
                        <button 
                          onClick={() => handleEditBill(bill)}
                          className="text-green-600 hover:text-green-900"
                          title="Edit Bill"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      ) : (
                        <button 
                          disabled
                          className="text-gray-400 cursor-not-allowed"
                          title="No permission to edit bills"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      {canRequestRefund(bill) && (
                        <button
                          onClick={() => handleRefundClick(bill)}
                          className="text-purple-600 hover:text-purple-900"
                          title="Request Refund"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleSendWhatsApp(bill)}
                        className="text-green-600 hover:text-green-900"
                        title="Send Bill PDF via WhatsApp"
                        disabled={whatsappBillId === bill.id}
                      >
                        {whatsappBillId === bill.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <MessageCircle className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredBills.length === 0 && (
          <div className="p-8 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No bills found</p>
          </div>
        )}
      </div>

      {/* Bill Modal */}
      {showBillModal && (
        <BillModal
          bill={selectedBill}
          patients={patients}
          onSave={handleBillSaved}
          onClose={() => {
            setShowBillModal(false);
            setSelectedBill(null);
          }}
          isReadOnly={selectedBill ? !canEditBill(selectedBill) : false}
        />
      )}

      {showRefundModal && refundBill && (
        <RefundRequestModal
          bill={refundBill}
          onClose={() => {
            setShowRefundModal(false);
            setRefundBill(null);
          }}
          onRequestCreated={handleRefundCompleted}
        />
      )}
    </div>
  );
};

export default BillingDashboard;