import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Calculator, Search, User, Download, RotateCcw } from 'lucide-react';
import { Patient, BillItem, Profile, Visit, RefundRequest } from '../../types';
import { getCurrentProfile } from '../../services/profileService';
import { billingService } from '../../services/billingService';
import { paymentService } from '../../services/paymentService';
import { patientService } from '../../services/patientService';
import { masterDataService } from '../../services/masterDataService';
import { visitService } from '../../services/visitService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase } from '../../utils/stringUtils';
import { pdfService } from '../../services/pdfService';
import { refundService } from '../../services/refundService';
import RefundRequestModal from './RefundRequestModal';
import { format } from 'date-fns';

interface BillModalProps {
  bill?: any | null;
  patientId?: string;
  visitId?: string;
  prefillItems?: any[];
  onSave: () => void;
  onClose: () => void;
  isReadOnly?: boolean;
  patients?: Patient[]; // Pass patients from parent to avoid duplicate fetch
}

const BillModal: React.FC<BillModalProps> = ({
  bill,
  patientId,
  visitId,
  prefillItems = [],
  onSave,
  onClose,
  isReadOnly = false,
  patients: patientsProp
}) => {
  const { user } = useAuth();
  
  // Ref to prevent double-clicking save button
  const isSavingRef = useRef(false);
  
  // Check if user can edit bills
  const canEditBills = () => {
    if (isReadOnly) return false;
    if (!user) return false;
    return user.roleName === 'admin' || 
           user.roleName === 'super_admin' || 
           user.permissions.includes('edit_bills') ||
           user.permissions.includes('manage_billing');
  };

  const canManageRefunds = () => {
    if (!user) return false;
    const permissions = user.permissions || [];
    return (
      user.roleName === 'admin' ||
      user.roleName === 'super_admin' ||
      permissions.includes('manage_billing') ||
      permissions.includes('manage_finance') ||
      permissions.includes('approve_refunds')
    );
  };
  
  const isEditMode = canEditBills();
  
  // Data states
  const [patients, setPatients] = useState<Patient[]>(patientsProp || []);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [medicinesLoaded, setMedicinesLoaded] = useState(false);
  const [testsLoaded, setTestsLoaded] = useState(false);
  
  // UI states
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentVisitId, setCurrentVisitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [fullPayment, setFullPayment] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const [progressStep, setProgressStep] = useState(0);
  const [refundRequests, setRefundRequests] = useState<RefundRequest[]>([]);
  const [refundsLoading, setRefundsLoading] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundActionLoading, setRefundActionLoading] = useState<string | null>(null);

  const refundedAmountFromRequests = refundRequests
    .filter((request) => request.status === 'paid')
    .reduce((sum, request) => sum + request.totalAmount, 0);

  const refundedAmount = refundRequests.length > 0
    ? refundedAmountFromRequests
    : bill?.totalRefundedAmount || 0;

  const refundableBalance = Math.max((bill?.paidAmount || 0) - refundedAmount, 0);

  const refundRequestStatusClasses: Record<RefundRequest['status'], string> = {
    draft: 'bg-gray-100 text-gray-700 border border-gray-200',
    pending_approval: 'bg-yellow-50 text-yellow-800 border border-yellow-200',
    approved: 'bg-blue-50 text-blue-800 border border-blue-200',
    rejected: 'bg-red-50 text-red-700 border border-red-200',
    paid: 'bg-green-50 text-green-800 border border-green-200',
    cancelled: 'bg-gray-50 text-gray-600 border border-gray-200'
  };

  const formatRefundRequestStatus = (status: RefundRequest['status']) => status.replace(/_/g, ' ');

  const [formData, setFormData] = useState({
    billNumber: '',
    totalAmount: 0,
    paidAmount: 0,
    balanceAmount: 0,
    paymentStatus: 'pending' as 'pending' | 'partial' | 'paid' | 'overdue',
    paymentMethod: 'cash',
    billDate: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const [billItems, setBillItems] = useState<Omit<BillItem, 'id' | 'billId' | 'createdAt'>[]>([]);

  // Load all initial data when modal opens
  useEffect(() => {
    loadInitialData();
  }, []);

  // Initialize form data and patient selection based on props
  useEffect(() => {
    if (loading) return; // Wait for data to load first

    if (bill) {
      // Editing existing bill
      initializeFromExistingBill();
    } else if (patientId) {
      // Creating new bill for specific patient
      initializeForSpecificPatient();
    } else {
      // Creating new bill - need to select patient
      initializeForNewBill();
    }
  }, [loading, bill, patientId, patients]);

  useEffect(() => {
    if (bill?.id) {
      loadRefundRequests();
    } else {
      setRefundRequests([]);
    }
  }, [bill?.id]);

  // Load visit data if visitId is provided
  useEffect(() => {
    if (visitId && !loading) {
      loadVisitData();
    }
  }, [visitId, loading]);

  // Load patient's last visit doctor when patient is selected
  useEffect(() => {
    if (selectedPatient && !bill) {
      loadLastVisitDoctor();
    }
  }, [selectedPatient]);

  // Handle full payment checkbox when total amount changes
  useEffect(() => {
    if (fullPayment) {
      setFormData(prev => ({
        ...prev,
        paidAmount: prev.totalAmount,
        balanceAmount: 0
      }));
    }
  }, [formData.totalAmount, fullPayment]);

  // Uncheck full payment if user manually changes paid amount
  const handlePaidAmountChange = (paid: number) => {
    setFormData(prev => ({
      ...prev,
      paidAmount: paid,
      balanceAmount: prev.totalAmount - paid
    }));
    
    // Uncheck full payment if the amount doesn't match total
    if (paid !== formData.totalAmount && fullPayment) {
      setFullPayment(false);
    }
  };

  // Auto-calculate totals when bill items change
  useEffect(() => {
    calculateTotals();
  }, [billItems]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      // Only fetch patients if not provided by parent
      const fetchPromises: Promise<any>[] = [];
      
      if (!patientsProp || patientsProp.length === 0) {
        fetchPromises.push(patientService.getPatients());
      } else {
        fetchPromises.push(Promise.resolve(patientsProp));
      }
      
      const [patientsData] = await Promise.all(fetchPromises);
      
      // Load doctors separately with null check
      let doctorsData = [];
      if (supabase) {
        const doctorsResponse = await supabase
          .from('profiles')
          .select('*')
          .eq('is_open_for_consultation', true)
          .eq('is_active', true)
          .order('name', { ascending: true });
        
        if (doctorsResponse.data) {
          doctorsData = doctorsResponse.data;
        }
      }
      
      setPatients(patientsData);
      // Medicines and tests will be loaded lazily when needed
      
      // Convert database profiles to Profile type
      const convertedDoctors = doctorsData.map((profile: any) => ({
        id: profile.id,
        userId: profile.user_id,
        roleId: profile.role_id,
        clinicId: profile.clinic_id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        specialization: profile.specialization,
        qualification: profile.qualification,
        registrationNo: profile.registration_no,
        roleName: profile.role_name,
        permissions: profile.permissions,
        consultationFee: profile.consultation_fee,
        followUpFee: profile.follow_up_fee,
        emergencyFee: profile.emergency_fee,
        isActive: profile.is_active,
        isOpenForConsultation: profile.is_open_for_consultation,
        doctorAvailability: profile.doctor_availability,
        createdAt: new Date(profile.created_at),
        updatedAt: new Date(profile.updated_at)
      }));
      
      // Filter doctors by current user's clinic ID
      const filteredDoctors = convertedDoctors.filter((doctor: any) => 
        doctor.clinicId === user?.clinicId
      );
      setDoctors(filteredDoctors);
    } catch (error) {
      console.error('Error loading initial data:', error);
      setDoctors([]);
    } finally {
      setLoading(false);
    }
  };

  const initializeFromExistingBill = () => {
    setFormData({
      billNumber: bill.billNumber,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      balanceAmount: bill.balanceAmount,
      paymentStatus: bill.paymentStatus,
      paymentMethod: bill.paymentMethod || 'cash',
      billDate: new Date(bill.billDate).toISOString().split('T')[0],
      notes: bill.notes || ''
    });
    setBillItems(bill.billItems || []);
    setSelectedPatient(bill.patient || null);
    setCurrentVisitId(bill.visitId);
    
    // Set doctor if available in bill
    if (bill.visit?.doctorId) {
      setSelectedDoctorId(bill.visit.doctorId);
    }
  };

  const loadVisitData = async () => {
    if (!visitId) return;

    try {
      const visitData = await visitService.getVisit(visitId);
      if (visitData) {
        setCurrentVisitId(visitId);
        if (visitData.doctorId) {
          setSelectedDoctorId(visitData.doctorId);
          updateConsultationFee(visitData.doctorId);
        }
      }
    } catch (error) {
      console.error('Error loading visit data:', error);
    }
  };

  const loadRefundRequests = async () => {
    if (!bill?.id) return;
    setRefundsLoading(true);
    try {
      const data = await refundService.listRefundRequests({ billId: bill.id });
      setRefundRequests(data);
    } catch (error) {
      console.error('Error loading refund requests:', error);
    } finally {
      setRefundsLoading(false);
    }
  };

  const approveRefundRequest = async (request: RefundRequest) => {
    if (!canManageRefunds()) return;
    setRefundActionLoading(request.id);
    try {
      await refundService.updateRefundRequest(request.id, {
        status: 'approved',
        approvedBy: user?.id
      });
      await loadRefundRequests();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to approve refund request.');
    } finally {
      setRefundActionLoading(null);
    }
  };

  const rejectRefundRequest = async (request: RefundRequest) => {
    if (!canManageRefunds()) return;
    const rejectionReason = window.prompt('Add reason for rejection', request.reason || '') || request.reason;
    setRefundActionLoading(request.id);
    try {
      await refundService.updateRefundRequest(request.id, {
        status: 'rejected',
        reason: rejectionReason || undefined
      });
      await loadRefundRequests();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to reject refund request.');
    } finally {
      setRefundActionLoading(null);
    }
  };

  const markRefundPaid = async (request: RefundRequest) => {
    if (!canManageRefunds()) return;
    let paymentMethod = request.refundMethod;
    if (!paymentMethod) {
      const methodPrompt = window.prompt('Enter payment method (cash/card/upi/cheque/net_banking/wallet)', 'cash');
      if (!methodPrompt) return;
      paymentMethod = methodPrompt as RefundRequest['refundMethod'];
    }
    if (!paymentMethod) {
      alert('Payment method is required to record refund payment.');
      return;
    }

    setRefundActionLoading(request.id);
    try {
      await refundService.markRefundPaid(request.id, {
        amount: request.totalAmount,
        paymentMethod,
        notes: request.reason,
        approvedBy: user?.id
      });
      await loadRefundRequests();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to mark refund as paid.');
    } finally {
      setRefundActionLoading(null);
    }
  };

  const initializeForSpecificPatient = () => {
    const patient = patients.find(p => p.id === patientId);
    if (patient) {
      setSelectedPatient(patient);
    }
    setCurrentVisitId(visitId || null);
    initializeBillItems();
  };

  const initializeForNewBill = () => {
    initializeBillItems();
  };

  const initializeBillItems = () => {
    if (prefillItems && prefillItems.length > 0) {
      const newItems = prefillItems.map((item) => ({
        itemType: 'medicine' as const,
        itemName: item.medicine?.name || item.medicineName || 'Medicine',
        quantity: item.quantity || 1,
        unitPrice: item.sellingPriceAtDispense || item.unitPrice || 0,
        totalPrice: (item.quantity || 1) * (item.sellingPriceAtDispense || item.unitPrice || 0),
        discount: 0,
        tax: 0
      }));
      setBillItems(newItems);
    } else {
      // Add default consultation item
      setBillItems([{
        itemType: 'consultation' as const,
        itemName: 'Consultation',
        quantity: 1,
        unitPrice: 0,
        totalPrice: 0,
        discount: 0,
        tax: 0
      }]);
    }
  };

  const loadLastVisitDoctor = async () => {
    if (!selectedPatient || !supabase) return;

    try {
      // Lightweight query - only get doctor_id from most recent visit
      const { data: lastVisit, error } = await supabase
        .from('visits')
        .select('doctor_id')
        .eq('patient_id', selectedPatient.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && lastVisit?.doctor_id) {
        setSelectedDoctorId(lastVisit.doctor_id);
        updateConsultationFee(lastVisit.doctor_id);
      } else if (user?.id) {
        // Fallback to current user if they're a doctor
        const currentUserAsDoctor = doctors.find(d => d.id === user.id);
        if (currentUserAsDoctor) {
          setSelectedDoctorId(user.id);
          updateConsultationFee(user.id);
        }
      }
    } catch (error) {
      console.error('Error loading last visit doctor:', error);
    }
  };

  const updateConsultationFee = (doctorId: string) => {
    const doctor = doctors.find(d => d.id === doctorId);
    const consultationFee = doctor?.consultationFee || user?.clinic?.consultationFee || 300;
    
    setBillItems(prev => prev.map(item => {
      if (item.itemType === 'consultation') {
        return {
          ...item,
          itemName: doctor ? `Consultation - ${doctor.name}` : 'Consultation',
          unitPrice: consultationFee,
          totalPrice: consultationFee
        };
      }
      return item;
    }));
  };

  // Lazy load medicines when needed
  const ensureMedicinesLoaded = async () => {
    if (!medicinesLoaded) {
      try {
        const medicinesData = await masterDataService.getMedicines();
        setMedicines(medicinesData);
        setMedicinesLoaded(true);
      } catch (error) {
        console.error('Error loading medicines:', error);
      }
    }
  };

  // Lazy load tests when needed
  const ensureTestsLoaded = async () => {
    if (!testsLoaded) {
      try {
        const testsData = await masterDataService.getTests();
        setTests(testsData);
        setTestsLoaded(true);
      } catch (error) {
        console.error('Error loading tests:', error);
      }
    }
  };

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.phone.includes(searchTerm)
  );

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setSearchTerm('');
  };

  const addNewItem = () => {
    const newItem = {
      itemType: 'consultation' as const,
      itemName: '',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
      discount: 0,
      tax: 0
    };
    setBillItems([...billItems, newItem]);
  };

  const updateItem = (index: number, field: keyof typeof billItems[0], value: any) => {
    // Trigger lazy loading when switching to medicine or test type
    if (field === 'itemType') {
      if (value === 'medicine') {
        ensureMedicinesLoaded();
      } else if (value === 'test') {
        ensureTestsLoaded();
      }
    }
    
    setBillItems(prev => prev.map((item, i) => {
      if (i === index) {
        const updatedItem = { ...item, [field]: value };
        
        // Auto-fill unit price for medicine items when item name changes
        if (field === 'itemName' && updatedItem.itemType === 'medicine') {
          const matchedMedicine = medicines.find(medicine => 
            medicine.name.toLowerCase() === value.toLowerCase() ||
            medicine.genericName?.toLowerCase() === value.toLowerCase() ||
            medicine.brandName?.toLowerCase() === value.toLowerCase()
          );
          
          if (matchedMedicine && matchedMedicine.sellingPrice) {
            updatedItem.unitPrice = matchedMedicine.sellingPrice;
          }
        }
        
        // Auto-fill unit price for test items when item name changes
        if (field === 'itemName' && updatedItem.itemType === 'test') {
          const matchedTest = tests.find(test => 
            test.name.toLowerCase() === value.toLowerCase()
          );
          
          if (matchedTest && matchedTest.price) {
            updatedItem.unitPrice = matchedTest.price;
          }
        }
        
        // Always recalculate total price after any changes
        const subtotal = updatedItem.quantity * updatedItem.unitPrice;
        const discountAmount = subtotal * ((updatedItem.discount || 0) / 100);
        const taxableAmount = subtotal - discountAmount;
        const taxAmount = taxableAmount * ((updatedItem.tax || 0) / 100);
        updatedItem.totalPrice = taxableAmount + taxAmount;
        
        return updatedItem;
      }
      return item;
    }));
  };

  const removeItem = (index: number) => {
    setBillItems(prev => prev.filter((_, i) => i !== index));
  };

  const calculateTotals = () => {
    const total = billItems.reduce((sum, item) => sum + item.totalPrice, 0);
    setFormData(prev => ({
      ...prev,
      totalAmount: total,
      balanceAmount: total - prev.paidAmount
    }));
  };

  const getItemOptions = (itemType: string) => {
    switch (itemType) {
      case 'medicine':
        return medicines;
      case 'test':
        return tests;
      default:
        return [];
    }
  };

  const handleDoctorChange = (doctorId: string) => {
    setSelectedDoctorId(doctorId);
    if (doctorId) {
      updateConsultationFee(doctorId);
    }
  };

  const handleExportPDF = async () => {
    if (!bill || !bill.patient || !user?.clinic) {
      alert('Missing required data for PDF export');
      return;
    }

    try {
      setExportingPDF(true);
      
      // Find the doctor for this bill
      const doctor = doctors.find(d => d.id === bill.visit?.doctorId);
      
      const pdfUrl = await pdfService.generatePdfFromData('bill', {
        bill: bill,
        patient: bill.patient,
        doctor: doctor,
        clinicSettings: user.clinic
      });
      
      window.open(pdfUrl, '_blank'); // Open the generated PDF in a new tab
      
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setExportingPDF(false);
    }
  };

  const openRefundModal = () => {
    setShowRefundModal(true);
  };

  const closeRefundModal = () => {
    setShowRefundModal(false);
  };

  const handleRefundSubmitted = async () => {
    await loadRefundRequests();
    closeRefundModal();
  };

  const handleSave = async () => {
    // Double-click prevention using ref
    if (isSavingRef.current) {
      console.warn('Save already in progress, ignoring duplicate click');
      return;
    }
    
    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot save bill.');
      return;
    }
    if (!selectedPatient) {
      alert('Please select a patient');
      return;
    }

    if (billItems.length === 0) {
      alert('Please add at least one item');
      return;
    }

    try {
      isSavingRef.current = true;
      setSaving(true);
      setProgressStep(1);
      setSaveProgress('Updating visit information...');
      
      // First, update the visit with the selected doctor if we have both visitId and doctorId
      if ((currentVisitId || visitId) && selectedDoctorId) {
        try {
          const visitIdToUpdate = currentVisitId || visitId;
          if (visitIdToUpdate) {
            await visitService.updateVisit(visitIdToUpdate, { doctorId: selectedDoctorId });
            if (import.meta.env.DEV) {
              console.log('✅ Updated visit doctor:', { visitId: visitIdToUpdate, doctorId: selectedDoctorId });
            }
          }
        } catch (visitUpdateError) {
          console.error('Error updating visit doctor:', visitUpdateError);
          // Don't fail the entire bill save if visit update fails
        }
      }
      
      setProgressStep(2);
      setSaveProgress('Preparing bill data...');
      
      const billData = {
        visitId: currentVisitId || visitId || undefined,
        patientId: selectedPatient.id,
        totalAmount: formData.totalAmount,
        notes: formData.notes,
        billItems: billItems.map(item => ({
          itemType: item.itemType,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          discount: item.discount || 0,
          tax: item.tax || 0
        }))
      };

      if (bill) {
        setProgressStep(3);
        setSaveProgress('Updating bill...');
        // Update bill with all changed fields
        await billingService.updateBill(bill.id, {
          notes: formData.notes,
          totalAmount: formData.totalAmount,
          billItems: billItems.map(item => ({
            itemType: item.itemType,
            itemName: item.itemName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            discount: item.discount || 0,
            tax: item.tax || 0
          }))
        });
        
        // Handle payment updates for existing bills
        if (formData.paidAmount !== bill.paidAmount && formData.paidAmount > bill.paidAmount) {
          setProgressStep(4);
          setSaveProgress('Recording additional payment...');
          const additionalPayment = formData.paidAmount - bill.paidAmount;
          await paymentService.recordPayment({
            billId: bill.id,
            amount: additionalPayment,
            paymentMethod: formData.paymentMethod as 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet',
            notes: 'Additional payment',
            paymentDate: new Date()
          });
        }
      } else {
        setProgressStep(3);
        setSaveProgress('Creating bill...');
        // Create the bill first
        const createdBill = await billingService.createBill(billData);
        
        // If payment amount is greater than 0, create a payment record
        if (formData.paidAmount > 0) {
          setProgressStep(4);
          setSaveProgress('Recording payment...');
          await paymentService.recordPayment({
            billId: createdBill.id,
            amount: formData.paidAmount,
            paymentMethod: formData.paymentMethod as 'cash' | 'card' | 'upi' | 'cheque' | 'net_banking' | 'wallet',
            notes: formData.notes || undefined,
            paymentDate: new Date(formData.billDate)
          });
        }
      }
      
      setProgressStep(5);
      setSaveProgress('Finalizing...');
      
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving bill:', error);
      alert(error instanceof Error ? error.message : 'Failed to save bill');
    } finally {
      isSavingRef.current = false;
      setSaving(false);
      setProgressStep(0);
      setSaveProgress('');
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-xl font-bold text-gray-800">
            {bill ? 'Edit Bill' : 'Create New Bill'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Patient Selection */}
          {!selectedPatient ? (
            <div className="space-y-4">
              <h3 className="font-medium text-gray-800">Select Patient *</h3>
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search patients by name or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              {searchTerm && (
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                  {filteredPatients.length > 0 ? (
                    filteredPatients.map(patient => (
                      <button
                        key={patient.id}
                        onClick={() => handlePatientSelect(patient)}
                        className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium">{toTitleCase(patient.name)}</div>
                        <div className="text-sm text-gray-600">{patient.phone} • {patient.age} years</div>
                      </button>
                    ))
                  ) : (
                    <div className="p-3 text-center text-gray-500">No patients found</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Selected Patient Display */
            <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-800">{toTitleCase(selectedPatient.name)}</p>
                  <p className="text-sm text-blue-600">{selectedPatient.phone} • {selectedPatient.age} years</p>
                </div>
              </div>
              {!bill && (
                <button
                  onClick={() => {
                    setSelectedPatient(null);
                    setSelectedDoctorId('');
                  }}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  Change
                </button>
              )}
            </div>
          )}

          {/* Doctor Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Attending Doctor for Consultation
            </label>
            <select
              value={selectedDoctorId}
              onChange={(e) => handleDoctorChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a doctor</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  {toTitleCase(doctor.name)} {doctor.specialization && `- ${doctor.specialization}`}
                  {doctor.consultationFee && ` (₹${doctor.consultationFee})`}
                </option>
              ))}
            </select>
            {doctors.length === 0 && (
              <p className="text-xs text-orange-600 mt-1">
                No doctors available for consultation. Please ensure doctors have "Open for Consultation" enabled in their profiles.
              </p>
            )}
          </div>

          {/* Bill Details */}
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill Date</label>
              <input
                type="date"
                value={formData.billDate}
                onChange={(e) => setFormData({ ...formData, billDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Bill Items */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Bill Items</h3>
              <button
                onClick={addNewItem}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>

            <div className="space-y-4">
              {billItems.map((item, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Type</label>
                      <select
                        value={item.itemType}
                        onChange={(e) => updateItem(index, 'itemType', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="consultation">Consultation</option>
                        <option value="procedure">Procedure</option>
                        <option value="medicine">Medicine</option>
                        <option value="test">Test</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Item Name</label>
                      <input
                        type="text"
                        value={item.itemName}
                        onChange={(e) => updateItem(index, 'itemName', e.target.value)}
                        onFocus={() => {
                          if (item.itemType === 'medicine') ensureMedicinesLoaded();
                          if (item.itemType === 'test') ensureTestsLoaded();
                        }}
                        list={`items-${item.itemType}-${index}`}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Enter item name"
                      />
                      <datalist id={`items-${item.itemType}-${index}`}>
                        {getItemOptions(item.itemType).map((option: any) => (
                          <option key={option.id} value={option.name} />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Unit Price</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Disc %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={item.discount}
                        onChange={(e) => updateItem(index, 'discount', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Tax %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={item.tax}
                        onChange={(e) => updateItem(index, 'tax', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div className="flex items-end">
                      <div className="w-full">
                        <label className="block text-xs text-gray-600 mb-1">Total</label>
                        <input
                          type="number"
                          value={item.totalPrice.toFixed(2)}
                          readOnly
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm bg-gray-50"
                        />
                      </div>
                      <button
                        onClick={() => removeItem(index)}
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

          {/* Payment Details */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
                <div className="text-2xl font-bold text-gray-800">₹{formData.totalAmount.toFixed(2)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount</label>
                <div className="space-y-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.paidAmount}
                    disabled={fullPayment}
                    onChange={(e) => {
                      const paid = parseFloat(e.target.value) || 0;
                      handlePaidAmountChange(paid);
                    }}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      fullPayment ? 'bg-gray-100 cursor-not-allowed' : ''
                    }`}
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="fullPayment"
                      checked={fullPayment}
                      onChange={(e) => {
                        const isFullPayment = e.target.checked;
                        setFullPayment(isFullPayment);
                        if (isFullPayment) {
                          setFormData(prev => ({
                            ...prev,
                            paidAmount: prev.totalAmount,
                            balanceAmount: 0
                          }));
                        }
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2"
                    />
                    <label htmlFor="fullPayment" className="text-sm text-gray-600 cursor-pointer">
                      Full Payment (₹{formData.totalAmount.toFixed(2)})
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Balance</label>
                <div className={`text-2xl font-bold ${formData.balanceAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  ₹{formData.balanceAmount.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {bill && (
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Refund Activity</h3>
                  <p className="text-sm text-gray-500">Track refund requests associated with this bill.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadRefundRequests}
                    className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                    disabled={refundsLoading}
                  >
                    {refundsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  {refundableBalance > 0 && (
                    <button
                      onClick={openRefundModal}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                    >
                      <RotateCcw className="w-4 h-4" />
                      New Refund Request
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-purple-50 rounded-lg p-3">
                  <p className="text-xs uppercase text-purple-600">Total Refunded</p>
                  <p className="text-2xl font-semibold text-purple-800">₹{refundedAmount.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-xs uppercase text-emerald-600">Refundable Balance</p>
                  <p className="text-2xl font-semibold text-emerald-800">₹{refundableBalance.toLocaleString('en-IN')}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <p className="text-xs uppercase text-blue-600">Bill Status</p>
                  <p className="text-2xl font-semibold text-blue-800">{bill.refundStatus.replace(/_/g, ' ')}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Existing Requests</p>
                {refundRequests.length === 0 ? (
                  <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
                    No refund requests yet.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {refundRequests.map((request) => (
                      <div
                        key={request.id}
                        className={`rounded-lg p-3 text-sm flex flex-col gap-1 ${refundRequestStatusClasses[request.status]}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold capitalize">{formatRefundRequestStatus(request.status)}</span>
                          <span className="font-medium">₹{request.totalAmount.toLocaleString('en-IN')}</span>
                        </div>
                        {request.reason && (
                          <p className="text-gray-700 text-xs">{request.reason}</p>
                        )}
                        <div className="text-xs text-gray-600 flex flex-wrap gap-3">
                          <span>Requested: {format(request.createdAt, 'dd MMM, HH:mm')}</span>
                          {request.approvedAt && <span>Approved: {format(request.approvedAt, 'dd MMM, HH:mm')}</span>}
                          {request.paidAt && <span>Paid: {format(request.paidAt, 'dd MMM, HH:mm')}</span>}
                        </div>
                        {canManageRefunds() && (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            {(request.status === 'draft' || request.status === 'pending_approval') && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => approveRefundRequest(request)}
                                  disabled={refundActionLoading === request.id}
                                  className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 disabled:opacity-60"
                                >
                                  {refundActionLoading === request.id ? 'Approving…' : 'Approve'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectRefundRequest(request)}
                                  disabled={refundActionLoading === request.id}
                                  className="px-3 py-1 rounded-full bg-red-100 text-red-700 disabled:opacity-60"
                                >
                                  {refundActionLoading === request.id ? 'Working…' : 'Reject'}
                                </button>
                              </>
                            )}
                            {(request.status === 'approved' || request.status === 'pending_approval') && (
                              <button
                                type="button"
                                onClick={() => markRefundPaid(request)}
                                disabled={refundActionLoading === request.id}
                                className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 disabled:opacity-60"
                              >
                                {refundActionLoading === request.id ? 'Recording…' : 'Mark Paid'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Additional notes..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            {bill && (
              <button
                onClick={handleExportPDF}
                disabled={exportingPDF}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {exportingPDF ? 'Exporting...' : 'Export PDF'}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-6 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !selectedPatient || billItems.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed min-w-[180px]"
            >
              {saving ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-xs font-medium">Step {progressStep}/5</span>
                    <span className="text-xs opacity-90 truncate max-w-32">{saveProgress}</span>
                  </div>
                </div>
              ) : (
                <>
                  <Calculator className="w-4 h-4" />
                  {bill ? 'Update Bill' : 'Create Bill'}
                </>
              )}
            </button>
            
            {/* Progress indicator below button when saving */}
            {saving && (
              <div className="mt-2 w-full">
                <div className="w-full bg-gray-200 rounded-full h-1">
                  <div 
                    className="bg-blue-600 h-1 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(progressStep / 5) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1 text-center">{saveProgress}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {bill && showRefundModal && (
        <RefundRequestModal
          bill={bill}
          onClose={closeRefundModal}
          onRequestCreated={handleRefundSubmitted}
        />
      )}
    </div>
  );
};

export default BillModal;