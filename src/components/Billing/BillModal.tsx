import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Calculator, Search, User, Download } from 'lucide-react';
import { Patient, BillItem, Profile, Visit } from '../../types';
import { getCurrentProfile } from '../../services/profileService';
import { billingService } from '../../services/billingService';
import { patientService } from '../../services/patientService';
import { masterDataService } from '../../services/masterDataService';
import { visitService } from '../../services/visitService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase } from '../../utils/stringUtils';
import { pdfService } from '../../services/pdfService';

interface BillModalProps {
  bill?: any | null;
  patientId?: string;
  visitId?: string;
  prefillItems?: any[];
  onSave: () => void;
  onClose: () => void;
}

const BillModal: React.FC<BillModalProps> = ({
  bill,
  patientId,
  visitId,
  prefillItems = [],
  onSave,
  onClose
}) => {
  const { user } = useAuth();
  
  // Data states
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [tests, setTests] = useState<any[]>([]);
  
  // UI states
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentVisitId, setCurrentVisitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

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

  // Auto-calculate totals when bill items change
  useEffect(() => {
    calculateTotals();
  }, [billItems]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [patientsData, medicinesData, testsData, doctorsResponse] = await Promise.all([
        patientService.getPatients(),
        masterDataService.getMedicines(),
        masterDataService.getTests(),
        supabase
          .from('profiles')
          .select('*')
          .eq('is_open_for_consultation', true)
          .eq('is_active', true)
          .order('name', { ascending: true })
      ]);
      
      setPatients(patientsData);
      setMedicines(medicinesData);
      setTests(testsData);
      
      if (doctorsResponse.error) {
        console.error('Error loading doctors:', doctorsResponse.error);
        setDoctors([]);
      } else {
        // Convert database profiles to Profile type
        const convertedDoctors = doctorsResponse.data.map(profile => ({
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
        const filteredDoctors = convertedDoctors.filter(doctor => 
          doctor.clinicId === user?.clinicId
        );
        setDoctors(filteredDoctors);
      }
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
    if (!selectedPatient) return;

    try {
      const visits = await visitService.getPatientVisits(selectedPatient.id);
      if (visits.length > 0) {
        const lastVisit = visits[0]; // Most recent visit
        if (lastVisit.doctorId) {
          setSelectedDoctorId(lastVisit.doctorId);
          updateConsultationFee(lastVisit.doctorId);
        }
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
        const discountAmount = subtotal * (updatedItem.discount / 100);
        const taxableAmount = subtotal - discountAmount;
        const taxAmount = taxableAmount * (updatedItem.tax / 100);
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

  const handleSave = async () => {
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
      setSaving(true);
      
      // First, update the visit with the selected doctor if we have both visitId and doctorId
      if ((currentVisitId || visitId) && selectedDoctorId) {
        try {
          const visitIdToUpdate = currentVisitId || visitId;
          await visitService.updateVisit(visitIdToUpdate, { doctorId: selectedDoctorId });
          if (import.meta.env.DEV) {
            console.log('✅ Updated visit doctor:', { visitId: visitIdToUpdate, doctorId: selectedDoctorId });
          }
        } catch (visitUpdateError) {
          console.error('Error updating visit doctor:', visitUpdateError);
          // Don't fail the entire bill save if visit update fails
        }
      }
      
      const billData = {
        visitId: currentVisitId || visitId || null,
        patientId: selectedPatient.id,
        billNumber: formData.billNumber || billingService.generateBillNumber(),
        totalAmount: formData.totalAmount,
        paidAmount: formData.paidAmount,
        balanceAmount: formData.totalAmount - formData.paidAmount,
        paymentStatus: formData.paidAmount >= formData.totalAmount ? 'paid' as const : 
                      formData.paidAmount > 0 ? 'partial' as const : 'pending' as const,
        paymentMethod: formData.paymentMethod,
        billDate: new Date(formData.billDate),
        notes: formData.notes,
        billItems: billItems.map(item => ({
          itemType: item.itemType,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          discount: item.discount,
          tax: item.tax
        }))
      };

      if (bill) {
        await billingService.updateBill(bill.id, billData);
      } else {
        await billingService.createBill(billData);
      }
      
      onSave();
      onClose();
    } catch (error) {
      console.error('Error saving bill:', error);
      alert(error instanceof Error ? error.message : 'Failed to save bill');
    } finally {
      setSaving(false);
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill Date</label>
              <input
                type="date"
                value={formData.billDate}
                onChange={(e) => setFormData({ ...formData, billDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
                <div className="text-2xl font-bold text-gray-800">₹{formData.totalAmount.toFixed(2)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.paidAmount}
                  onChange={(e) => {
                    const paid = parseFloat(e.target.value) || 0;
                    setFormData(prev => ({
                      ...prev,
                      paidAmount: paid,
                      balanceAmount: prev.totalAmount - paid
                    }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Balance</label>
                <div className={`text-2xl font-bold ${formData.balanceAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  ₹{formData.balanceAmount.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

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
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Calculator className="w-4 h-4" />
              {saving ? 'Saving...' : bill ? 'Update Bill' : 'Create Bill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillModal;