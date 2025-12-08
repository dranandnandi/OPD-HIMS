import React, { useState, useEffect } from 'react';
import { X, Calendar, User, FileText, Pill, TestTube, CreditCard, Activity, CheckCircle, XCircle, Stethoscope, Phone, MapPin, Clock, Download, Edit } from 'lucide-react';
import { Visit, Bill } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import { visitService } from '../../services/visitService';
import { billingService } from '../../services/billingService';
import { useAuth } from '../Auth/useAuth';
import { authService } from '../../services/authService';
import { format } from 'date-fns';
import BillModal from '../Billing/BillModal';
import DispenseModal from '../Pharmacy/DispenseModal';
import AddVisitModal from '../Patients/AddVisitModal';
import { toTitleCase } from '../../utils/stringUtils';
import { pdfService } from '../../services/pdfService';

interface VisitDetailsModalProps {
  visitId: string;
  onClose: () => void;
}

const VisitDetailsModal: React.FC<VisitDetailsModalProps> = ({ visitId, onClose }) => {
  const { user } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showDispenseModal, setShowDispenseModal] = useState(false);
  const [showEditVisitModal, setShowEditVisitModal] = useState(false);
  const [dispensedItemsForBilling, setDispensedItemsForBilling] = useState<any[]>([]);
  const [exportingPDF, setExportingPDF] = useState(false);

  useEffect(() => {
    if (user && visitId) {
      loadVisitData();
      loadDoctors();
    }
  }, [user, visitId]);

  const loadVisitData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const visitData = await visitService.getVisit(visitId);
      if (!visitData) {
        setError('Visit not found');
        return;
      }
      
      setVisit(visitData);
      
      // Load bills for this visit
      const allBills = await billingService.getBills();
      const visitBills = allBills.filter(bill => bill.visitId === visitId);
      setBills(visitBills);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visit details');
      console.error('Error loading visit details:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    try {
      // Load doctors directly from profiles table and filter by clinic
      const { data: doctorsData, error: doctorsError } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_open_for_consultation', true)
        .eq('is_active', true)
        .order('name');

      if (doctorsError) {
        console.error('Error loading doctors:', doctorsError);
        setDoctors([]);
        return;
      }

      // Convert and filter doctors by current user's clinic ID
      const convertedDoctors = doctorsData
        .filter(profile => profile.clinic_id === user?.clinicId)
        .map(profile => ({
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
      
      setDoctors(convertedDoctors);
    } catch (error) {
      console.error('Error loading doctors:', error);
      setDoctors([]);
    }
  };

  const handleAddBill = () => {
    setShowBillModal(true);
  };

  const handleBillSaved = () => {
    setShowBillModal(false);
    loadVisitData(); // Reload to show new bill
  };

  const getStatusColor = (status: Bill['paymentStatus']) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'partial': return 'bg-blue-100 text-blue-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleDispenseSaved = (dispensedItems?: any[]) => {
    setShowDispenseModal(false);
    
    // If items were dispensed, ask if user wants to create a bill
    if (dispensedItems && dispensedItems.length > 0) {
      const createBill = confirm('Medicines dispensed successfully! Would you like to create a bill for these items?');
      if (createBill) {
        setDispensedItemsForBilling(dispensedItems);
        setShowBillModal(true);
      }
    }
  };

  const handleExportPDF = async () => {
    if (!visit || !visit.patient || !user?.clinic) {
      alert('Missing required data for PDF export');
      return;
    }

    try {
      setExportingPDF(true);
      
      // Find the doctor for this visit
      const doctor = doctors.find(d => d.id === visit.doctorId) || visit.doctor;

      const pdfUrl = await pdfService.generatePdfFromData('visit', {
        visit: visit,
        patient: visit.patient,
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

  const handleEditVisit = () => {
    setShowEditVisitModal(true);
  };

  const handleVisitUpdated = () => {
    setShowEditVisitModal(false);
    loadVisitData(); // Reload visit data to show changes
  };

  const getVisitStatus = () => {
    if (!visit) return 'Closed';
    return visit.followUpDate && new Date(visit.followUpDate) > new Date() ? 'Open' : 'Closed';
  };

  if (!user) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
        {/* Modal Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Visit Details - {visit ? format(visit.date, 'MMM dd, yyyy') : 'Loading...'}
              </h2>
              {visit && (
                <p className="text-sm text-gray-600 mt-1">
                  {toTitleCase(visit.patient?.name || '')} • Dr. {toTitleCase(visit.doctor?.name || 'Unknown')}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading visit details...</p>
            </div>
          ) : error || !visit ? (
            <div className="text-center py-12">
              <div className="text-red-600 mb-4">{error || 'Visit not found'}</div>
              <button
                onClick={onClose}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Visit Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Patient</p>
                      <p className="font-semibold text-gray-900">{toTitleCase(visit.patient?.name || '')}</p>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {visit.patient?.phone}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Visit Date</p>
                      <p className="font-semibold text-gray-900">{format(visit.date, 'PPP')}</p>
                      <p className="text-sm text-gray-600 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(visit.date, 'p')}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <Stethoscope className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Doctor</p>
                      <p className="font-semibold text-gray-900">{toTitleCase(visit.doctor?.name || 'Unknown')}</p>
                      {visit.doctor?.specialization && (
                        <p className="text-sm text-gray-600">{visit.doctor.specialization}</p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="card-standard p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                      <Activity className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
                      <div className="mt-1">
                        <span className={`status-chip ${
                          getVisitStatus() === 'Open' ? 'status-chip-open' : 'status-chip-closed'
                        }`}>
                          {getVisitStatus() === 'Open' ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {getVisitStatus()}
                        </span>
                      </div>
                      {visit.followUpDate && (
                        <p className="text-sm text-gray-600 mt-1">
                          Follow-up: {format(visit.followUpDate, 'MMM dd, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleEditVisit}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit Visit
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={exportingPDF}
                  className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  {exportingPDF ? 'Exporting...' : 'Export PDF'}
                </button>
                <button
                  onClick={handleAddBill}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Add Bill for this Visit
                </button>
                <button
                  onClick={() => setShowDispenseModal(true)}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Pill className="w-4 h-4" />
                  Dispense Medicines
                </button>
              </div>

              {/* Visit Details Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Chief Complaint & Symptoms */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Chief Complaint & Symptoms
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2">Chief Complaint</h4>
                      <p className="text-gray-600 bg-gray-50 p-3 rounded-lg">
                        {visit.chiefComplaint || 'No complaint specified'}
                      </p>
                    </div>
                    
                    {visit.symptoms && visit.symptoms.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Symptoms</h4>
                        <div className="space-y-2">
                          {visit.symptoms.map(symptom => (
                            <div key={symptom.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <span className="text-gray-800 font-medium">{symptom.name}</span>
                              {symptom.severity && (
                                <span className={`px-2 py-1 text-xs rounded-lg font-medium ${
                                  symptom.severity === 'severe' ? 'bg-red-100 text-red-700' :
                                  symptom.severity === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-green-100 text-green-700'
                                }`}>
                                  {symptom.severity}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vitals */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-600" />
                    Vitals
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {visit.vitals.temperature && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Temperature</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.temperature}°F</p>
                      </div>
                    )}
                    {visit.vitals.bloodPressure && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Blood Pressure</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.bloodPressure}</p>
                      </div>
                    )}
                    {visit.vitals.pulse && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Pulse</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.pulse} BPM</p>
                      </div>
                    )}
                    {visit.vitals.weight && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Weight</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.weight} kg</p>
                      </div>
                    )}
                    {visit.vitals.height && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Height</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.height} cm</p>
                      </div>
                    )}
                    {visit.vitals.oxygenSaturation && (
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-sm text-gray-600">Oxygen Saturation</p>
                        <p className="font-semibold text-gray-900">{visit.vitals.oxygenSaturation}%</p>
                      </div>
                    )}
                  </div>
                  
                  {!Object.values(visit.vitals).some(v => v) && (
                    <p className="text-gray-500 italic text-center py-8">No vitals recorded</p>
                  )}
                </div>
              </div>

              {/* Diagnoses & Prescriptions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Diagnoses */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-600" />
                    Diagnoses
                  </h3>
                  
                  {visit.diagnoses && visit.diagnoses.length > 0 ? (
                    <div className="space-y-3">
                      {visit.diagnoses.map(diagnosis => (
                        <div key={diagnosis.id} className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-lg">
                          <div>
                            <p className="font-medium text-red-900">{diagnosis.name}</p>
                            {diagnosis.icd10Code && (
                              <p className="text-sm text-red-700">ICD-10: {diagnosis.icd10Code}</p>
                            )}
                          </div>
                          {diagnosis.isPrimary && (
                            <span className="px-2 py-1 text-xs bg-red-200 text-red-800 rounded-lg font-medium">
                              Primary
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No diagnoses recorded</p>
                  )}
                </div>

                {/* Prescriptions */}
                <div className="card-standard p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Pill className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Prescriptions</h3>
                  </div>
                  
                  {visit.prescriptions && visit.prescriptions.length > 0 ? (
                    <div className="space-y-3">
                      {visit.prescriptions.map(prescription => (
                        <div key={prescription.id} className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="font-medium text-blue-900">{prescription.medicine}</p>
                          <p className="text-sm text-blue-700 mt-1">
                            {prescription.dosage} • {prescription.frequency} • {prescription.duration}
                          </p>
                          <p className="text-sm text-blue-600 mt-1">{prescription.instructions}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No prescriptions recorded</p>
                  )}
                </div>
              </div>

              {/* Tests & Advice */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Tests Ordered */}
                <div className="card-standard p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TestTube className="w-5 h-5 text-purple-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Tests Ordered</h3>
                  </div>
                  
                  {visit.testsOrdered && visit.testsOrdered.length > 0 ? (
                    <div className="space-y-3">
                      {visit.testsOrdered.map(test => (
                        <div key={test.id} className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-purple-900">{test.testName}</p>
                            <span className={`px-2 py-1 text-xs rounded-lg font-medium ${
                              test.status === 'completed' ? 'bg-green-100 text-green-700' :
                              test.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {test.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-sm text-purple-700 capitalize mt-1">
                            {test.testType === 'procedure' ? 'Procedure' : test.testType} • {test.urgency}
                          </p>
                          {test.instructions && (
                            <p className="text-sm text-purple-600 mt-1">{test.instructions}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic text-center py-8">No tests ordered</p>
                  )}
                </div>

                {/* Advice & Notes */}
                <div className="card-standard p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-gray-600" />
                    Advice & Notes
                  </h3>
                  
                  <div className="space-y-4">
                    {visit.advice && visit.advice.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Advice</h4>
                        <ul className="space-y-2">
                          {visit.advice.map((advice, index) => (
                            <li key={index} className="flex items-start gap-2 text-gray-600 bg-gray-50 p-3 rounded-lg">
                              <span className="text-blue-600 mt-1">•</span>
                              {advice}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {visit.doctorNotes && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Doctor's Notes</h4>
                        <p className="text-gray-600 italic bg-gray-50 p-3 rounded-lg">{visit.doctorNotes}</p>
                      </div>
                    )}
                    
                    {(!visit.advice || visit.advice.length === 0) && !visit.doctorNotes && (
                      <p className="text-gray-500 italic text-center py-8">No advice or notes recorded</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Associated Bills */}
              <div className="card-standard p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-green-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Associated Bills</h3>
                  </div>
                  <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded-lg">
                    {bills.length} bill(s)
                  </span>
                </div>
                
                {bills.length > 0 ? (
                  <div className="space-y-3">
                    {bills.map(bill => (
                      <div key={bill.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <div>
                          <p className="font-medium text-gray-900">{bill.billNumber}</p>
                          <p className="text-sm text-gray-600">
                            {format(bill.billDate, 'MMM dd, yyyy')} • ₹{bill.totalAmount.toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 text-xs rounded-lg font-medium ${getStatusColor(bill.paymentStatus)}`}>
                            {bill.paymentStatus}
                          </span>
                          {bill.balanceAmount > 0 && (
                            <span className="text-sm text-red-600 font-medium">
                              Balance: ₹{bill.balanceAmount.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 mb-3">No bills created for this visit yet</p>
                    <button
                      onClick={handleAddBill}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Create First Bill
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bill Modal */}
      {showBillModal && visit && (
        <BillModal
          bill={null}
          patientId={visit.patientId}
          visitId={visit.id}
          prefillItems={dispensedItemsForBilling}
          onSave={handleBillSaved}
          onClose={() => {
            setShowBillModal(false);
            setDispensedItemsForBilling([]);
          }}
        />
      )}

      {/* Dispense Modal */}
      {showDispenseModal && visit && (
        <DispenseModal
          visit={visit}
          onSave={handleDispenseSaved}
          onClose={() => setShowDispenseModal(false)}
        />
      )}

      {/* Edit Visit Modal */}
      {showEditVisitModal && visit && (
        <AddVisitModal
          patient={visit.patient!}
          existingVisit={visit}
          onSave={handleVisitUpdated}
          onClose={() => setShowEditVisitModal(false)}
        />
      )}
    </div>
  );
};

export default VisitDetailsModal;