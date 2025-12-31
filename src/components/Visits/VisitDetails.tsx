import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, User, FileText, Pill, TestTube, CreditCard, Activity } from 'lucide-react';
import { Visit, Bill } from '../../types';
import { visitService } from '../../services/visitService';
import { billingService } from '../../services/billingService';
import { useAuth } from '../Auth/useAuth';
import { format } from 'date-fns';
import BillModal from '../Billing/BillModal';
import DispenseModal from '../Pharmacy/DispenseModal';
import { pdfService } from '../../services/pdfService';
import { toTitleCase } from '../../utils/stringUtils';

const VisitDetails: React.FC = () => {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showDispenseModal, setShowDispenseModal] = useState(false);
  const [dispensedItemsForBilling, setDispensedItemsForBilling] = useState<any[]>([]);

  useEffect(() => {
    if (user && visitId) {
      loadVisitData();
    }
  }, [user, visitId]);

  const loadVisitData = async () => {
    if (!visitId) return;

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
      
      // Use doctor from visit if available, otherwise fetch all doctors
      let doctor = visit.doctor;
      if (!doctor && visit.doctorId) {
        const { authService } = await import('../../services/authService');
        const allDoctors = await authService.getAllDoctors();
        doctor = allDoctors.find(d => d.id === visit.doctorId);
      }
      
      const pdfUrl = await pdfService.generatePdfFromData('visit', {
        visit: visit,
        patient: visit.patient,
        doctor: doctor,
        clinicSettings: user.clinic
      });
      
      window.open(pdfUrl, '_blank');
      
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    } finally {
      setExportingPDF(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view visit details.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading visit details...</p>
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error || 'Visit not found'}</div>
        <button
          onClick={() => navigate('/visits')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Back to Visits
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/visits')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-gray-800">Visit Details</h2>
          <p className="text-gray-600">
            {toTitleCase(visit.patient?.name || '')} • {format(visit.date, 'MMMM dd, yyyy')}
          </p>
        </div>
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
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
        >
          <Pill className="w-4 h-4" />
          Dispense Medicines
        </button>
      </div>

      {/* Visit Overview */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="flex items-center gap-3">
            <User className="w-8 h-8 text-blue-600" />
            <div>
              <p className="text-sm text-gray-600">Patient</p>
              <p className="font-semibold text-gray-800">{toTitleCase(visit.patient?.name || '')}</p>
              <p className="text-sm text-gray-600">{visit.patient?.phone}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-sm text-gray-600">Visit Date</p>
              <p className="font-semibold text-gray-800">{format(visit.date, 'PPP')}</p>
              <p className="text-sm text-gray-600">{format(visit.date, 'p')}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-purple-600" />
            <div>
              <p className="text-sm text-gray-600">Doctor</p>
              <p className="font-semibold text-gray-800">{toTitleCase(visit.doctor?.name || 'Unknown')}</p>
              {visit.doctor?.specialization && (
                <p className="text-sm text-gray-600">{visit.doctor.specialization}</p>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-orange-600" />
            <div>
              <p className="text-sm text-gray-600">Status</p>
              <p className="font-semibold text-gray-800">
                {visit.followUpDate && new Date(visit.followUpDate) > new Date() ? 'Open' : 'Closed'}
              </p>
              {visit.followUpDate && (
                <p className="text-sm text-gray-600">
                  Follow-up: {format(visit.followUpDate, 'MMM dd, yyyy')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Visit Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chief Complaint & Symptoms */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Chief Complaint & Symptoms</h3>
          
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-700 mb-2">Chief Complaint</h4>
              <p className="text-gray-600">{visit.chiefComplaint || 'No complaint specified'}</p>
            </div>
            
            {visit.symptoms && visit.symptoms.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Symptoms</h4>
                <div className="space-y-2">
                  {visit.symptoms.map(symptom => (
                    <div key={symptom.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-gray-800">{symptom.name}</span>
                      {symptom.severity && (
                        <span className={`px-2 py-1 text-xs rounded-full ${
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
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Vitals</h3>
          
          <div className="grid grid-cols-2 gap-4">
            {visit.vitals.temperature && (
              <div>
                <p className="text-sm text-gray-600">Temperature</p>
                <p className="font-medium text-gray-800">{visit.vitals.temperature}°F</p>
              </div>
            )}
            {visit.vitals.bloodPressure && (
              <div>
                <p className="text-sm text-gray-600">Blood Pressure</p>
                <p className="font-medium text-gray-800">{visit.vitals.bloodPressure}</p>
              </div>
            )}
            {visit.vitals.pulse && (
              <div>
                <p className="text-sm text-gray-600">Pulse</p>
                <p className="font-medium text-gray-800">{visit.vitals.pulse} BPM</p>
              </div>
            )}
            {visit.vitals.weight && (
              <div>
                <p className="text-sm text-gray-600">Weight</p>
                <p className="font-medium text-gray-800">{visit.vitals.weight} kg</p>
              </div>
            )}
            {visit.vitals.height && (
              <div>
                <p className="text-sm text-gray-600">Height</p>
                <p className="font-medium text-gray-800">{visit.vitals.height} cm</p>
              </div>
            )}
            {visit.vitals.oxygenSaturation && (
              <div>
                <p className="text-sm text-gray-600">Oxygen Saturation</p>
                <p className="font-medium text-gray-800">{visit.vitals.oxygenSaturation}%</p>
              </div>
            )}
          </div>
          
          {!Object.values(visit.vitals).some(v => v) && (
            <p className="text-gray-500 italic">No vitals recorded</p>
          )}
        </div>
      </div>

      {/* Diagnoses & Prescriptions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Diagnoses */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Diagnoses</h3>
          
          {visit.diagnoses && visit.diagnoses.length > 0 ? (
            <div className="space-y-2">
              {visit.diagnoses.map(diagnosis => (
                <div key={diagnosis.id} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded">
                  <div>
                    <p className="font-medium text-red-800">{diagnosis.name}</p>
                    {diagnosis.icd10Code && (
                      <p className="text-sm text-red-600">ICD-10: {diagnosis.icd10Code}</p>
                    )}
                  </div>
                  {diagnosis.isPrimary && (
                    <span className="px-2 py-1 text-xs bg-red-200 text-red-800 rounded-full">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">No diagnoses recorded</p>
          )}
        </div>

        {/* Prescriptions */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <Pill className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-800">Prescriptions</h3>
          </div>
          
          {visit.prescriptions && visit.prescriptions.length > 0 ? (
            <div className="space-y-3">
              {visit.prescriptions.map(prescription => (
                <div key={prescription.id} className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="font-medium text-blue-800">{prescription.medicine}</p>
                  <p className="text-sm text-blue-600">
                    {prescription.dosage} • {prescription.frequency} • {prescription.duration}
                  </p>
                  <p className="text-sm text-blue-600">{prescription.instructions}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">No prescriptions recorded</p>
          )}
        </div>
      </div>

      {/* Tests & Advice */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tests Ordered */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <TestTube className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-800">Tests Ordered</h3>
          </div>
          
          {visit.testsOrdered && visit.testsOrdered.length > 0 ? (
            <div className="space-y-3">
              {visit.testsOrdered.map(test => (
                <div key={test.id} className="p-3 bg-purple-50 border border-purple-200 rounded">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-purple-800">{test.testName}</p>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      test.status === 'completed' ? 'bg-green-100 text-green-700' :
                      test.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {test.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-purple-600 capitalize">
                    {test.testType === 'procedure' ? 'Procedure' : test.testType} • {test.urgency}
                  </p>
                  {test.instructions && (
                    <p className="text-sm text-purple-600">{test.instructions}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">No tests ordered</p>
          )}
        </div>

        {/* Advice & Notes */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Advice & Notes</h3>
          
          <div className="space-y-4">
            {visit.advice && visit.advice.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Advice</h4>
                <ul className="space-y-1">
                  {visit.advice.map((advice, index) => (
                    <li key={index} className="flex items-start gap-2 text-gray-600">
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
                <p className="text-gray-600 italic">{visit.doctorNotes}</p>
              </div>
            )}
            
            {(!visit.advice || visit.advice.length === 0) && !visit.doctorNotes && (
              <p className="text-gray-500 italic">No advice or notes recorded</p>
            )}
          </div>
        </div>
      </div>

      {/* Associated Bills */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-800">Associated Bills</h3>
          </div>
          <span className="text-sm text-gray-600">{bills.length} bill(s)</span>
        </div>
        
        {bills.length > 0 ? (
          <div className="space-y-3">
            {bills.map(bill => (
              <div key={bill.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-800">{bill.billNumber}</p>
                  <p className="text-sm text-gray-600">
                    {format(bill.billDate, 'MMM dd, yyyy')} • ₹{bill.totalAmount.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(bill.paymentStatus)}`}>
                    {bill.paymentStatus}
                  </span>
                  {bill.balanceAmount > 0 && (
                    <span className="text-sm text-red-600">
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
    </div>
  );
};

export default VisitDetails;