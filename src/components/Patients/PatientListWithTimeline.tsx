import React, { useEffect, useState } from 'react';
import { Search, Plus, Phone, User, Eye, FileText, Download, Trash2 } from 'lucide-react';
import { Appointment, Bill, Patient, Visit } from '../../types';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import { appointmentService } from '../../services/appointmentService';
import { visitService } from '../../services/visitService';
import { billingService } from '../../services/billingService';
import PatientModal from './PatientModal';
import PatientTimeline from './PatientTimeline';
import AddVisitModal from './AddVisitModal';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase, getInitials } from '../../utils/stringUtils';

type ExcelCellValue = string | number | boolean | null | undefined;
type PatientWithOptionalBloodGroup = Patient & { bloodGroup?: string };

const escapeXml = (value: ExcelCellValue) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const buildExcelCell = (value: ExcelCellValue, isHeader = false) => {
  const style = isHeader ? ' ss:StyleID="Header"' : '';
  return `<Cell${style}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
};

const buildWorksheetXml = (name: string, rows: ExcelCellValue[][]) => `
  <Worksheet ss:Name="${escapeXml(name)}">
    <Table>
      ${rows
        .map(
          (row, rowIndex) => `
          <Row>
            ${row.map((cell) => buildExcelCell(cell, rowIndex === 0)).join('')}
          </Row>`
        )
        .join('')}
    </Table>
  </Worksheet>`;

const createExcelWorkbookXml = (worksheets: Array<{ name: string; rows: ExcelCellValue[][] }>) => `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" />
    </Style>
  </Styles>
  ${worksheets.map((sheet) => buildWorksheetXml(sheet.name, sheet.rows)).join('')}
</Workbook>`;

const triggerExcelDownload = (filename: string, worksheets: Array<{ name: string; rows: ExcelCellValue[][] }>) => {
  const workbookXml = createExcelWorkbookXml(worksheets);
  const blob = new Blob([workbookXml], {
    type: 'application/vnd.ms-excel;charset=utf-8;'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const formatDateValue = (value?: Date) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

const formatDateTimeValue = (value?: Date) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

const formatDoctorName = (name?: string) => (name ? `Dr. ${toTitleCase(name)}` : '');

const PatientListWithTimeline: React.FC = () => {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelinePatient, setTimelinePatient] = useState<Patient | null>(null);
  const [showAddVisitModal, setShowAddVisitModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doctorFilter, setDoctorFilter] = useState('');
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    if (user) {
      loadPatients();
      loadDoctors();
    }
  }, [user]);

  useEffect(() => {
    setSelectedPatientIds((currentSelection) =>
      currentSelection.filter((patientId) => patients.some((patient) => patient.id === patientId))
    );
  }, [patients]);

  const loadPatients = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user) {
        setError('Please log in to view patients');
        return;
      }

      const fetchedPatients = await patientService.getPatients();
      setPatients(fetchedPatients);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load patients';
      setError(errorMessage);
      console.error('Error loading patients:', err);

      if (errorMessage.includes('Network connection failed') || errorMessage.includes('Supabase client not initialized')) {
        setError('Unable to connect to the server. Please check your internet connection and refresh the page.');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    try {
      const allDoctors = await authService.getDoctors();
      const filteredDoctors = allDoctors.filter((doctor) => doctor.clinicId === user?.clinicId);
      setDoctors(filteredDoctors);
    } catch (loadDoctorsError) {
      console.error('Error loading doctors:', loadDoctorsError);
      setDoctors([]);
    }
  };

  const filteredPatients = patients.filter(
    (patient) =>
      patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patient.phone.includes(searchTerm) ||
      patient.id.includes(searchTerm)
  );

  const selectedFilteredPatients = filteredPatients.filter((patient) => selectedPatientIds.includes(patient.id));
  const areAllFilteredSelected =
    filteredPatients.length > 0 && selectedFilteredPatients.length === filteredPatients.length;

  const getPatientBloodGroup = (patient: Patient) =>
    (patient as PatientWithOptionalBloodGroup).bloodGroup || patient.blood_group || '';

  const togglePatientSelection = (patientId: string) => {
    setSelectedPatientIds((currentSelection) =>
      currentSelection.includes(patientId)
        ? currentSelection.filter((id) => id !== patientId)
        : [...currentSelection, patientId]
    );
  };

  const handleSelectAllFiltered = () => {
    if (areAllFilteredSelected) {
      const filteredIds = new Set(filteredPatients.map((patient) => patient.id));
      setSelectedPatientIds((currentSelection) => currentSelection.filter((id) => !filteredIds.has(id)));
      return;
    }

    const mergedIds = new Set([...selectedPatientIds, ...filteredPatients.map((patient) => patient.id)]);
    setSelectedPatientIds(Array.from(mergedIds));
  };

  const handleDownloadSelectedPatients = async () => {
    if (selectedFilteredPatients.length === 0) {
      return;
    }

    try {
      setExportingExcel(true);

      const relatedData = await Promise.all(
        selectedFilteredPatients.map(async (patient) => {
          const [appointments, visits, bills] = await Promise.all([
            appointmentService.getPatientAppointments(patient.id),
            visitService.getPatientVisits(patient.id),
            billingService.getPatientBills(patient.id)
          ]);

          return {
            patient,
            appointments,
            visits,
            bills
          };
        })
      );

      const appointments = relatedData.flatMap((entry) => entry.appointments);
      const visits = relatedData.flatMap((entry) => entry.visits);
      const bills = relatedData.flatMap((entry) => entry.bills);

      const patientRows: ExcelCellValue[][] = [
        [
          'Patient Name',
          'Phone',
          'Age',
          'Gender',
          'Address',
          'Emergency Contact',
          'Blood Group',
          'Allergies',
          'Referred By',
          'ABHA Number',
          'ABHA Address',
          'Mobile Verified',
          'Created At',
          'Last Visit'
        ],
        ...selectedFilteredPatients.map((patient) => [
          toTitleCase(patient.name),
          patient.phone,
          patient.age,
          patient.gender,
          patient.address || '',
          patient.emergency_contact || '',
          getPatientBloodGroup(patient),
          patient.allergies?.join(', ') || '',
          patient.referred_by || '',
          patient.abha_number || '',
          patient.abha_address || '',
          patient.mobile_verified ? 'Yes' : 'No',
          formatDateValue(patient.createdAt),
          formatDateValue(patient.lastVisit)
        ])
      ];

      const appointmentRows: ExcelCellValue[][] = [
        [
          'Patient Name',
          'Appointment ID',
          'Appointment Date',
          'Doctor',
          'Status',
          'Type',
          'Duration (min)',
          'Waiting Condition',
          'Notes',
          'Created At'
        ],
        ...appointments.map((appointment: Appointment) => [
          toTitleCase(appointment.patient?.name || selectedFilteredPatients.find((patient) => patient.id === appointment.patientId)?.name || ''),
          appointment.id,
          formatDateTimeValue(appointment.appointmentDate),
          formatDoctorName(appointment.doctor?.name),
          appointment.status,
          appointment.appointmentType,
          appointment.duration,
          appointment.waitingConditionType || '',
          appointment.notes || '',
          formatDateTimeValue(appointment.createdAt)
        ])
      ];

      const visitRows: ExcelCellValue[][] = [
        [
          'Patient Name',
          'Visit ID',
          'Visit Date',
          'Doctor',
          'Chief Complaint',
          'Blood Pressure',
          'Pulse',
          'Temperature',
          'Weight',
          'Height',
          'Follow Up Date',
          'Advice',
          'Doctor Notes'
        ],
        ...visits.map((visit: Visit) => [
          toTitleCase(visit.patient?.name || selectedFilteredPatients.find((patient) => patient.id === visit.patientId)?.name || ''),
          visit.id,
          formatDateTimeValue(visit.date),
          formatDoctorName(visit.doctor?.name),
          visit.chiefComplaint || '',
          visit.vitals?.bloodPressure || '',
          visit.vitals?.pulse || '',
          visit.vitals?.temperature || '',
          visit.vitals?.weight || '',
          visit.vitals?.height || '',
          formatDateValue(visit.followUpDate),
          visit.advice || '',
          visit.doctorNotes || ''
        ])
      ];

      const diagnosisRows: ExcelCellValue[][] = [
        ['Patient Name', 'Visit ID', 'Visit Date', 'Diagnosis', 'Primary', 'ICD10 Code', 'Notes'],
        ...visits.flatMap((visit: Visit) =>
          visit.diagnoses.map((diagnosis) => [
            toTitleCase(visit.patient?.name || selectedFilteredPatients.find((patient) => patient.id === visit.patientId)?.name || ''),
            visit.id,
            formatDateTimeValue(visit.date),
            diagnosis.name,
            diagnosis.isPrimary ? 'Yes' : 'No',
            diagnosis.icd10Code || '',
            diagnosis.notes || ''
          ])
        )
      ];

      const prescriptionRows: ExcelCellValue[][] = [
        ['Patient Name', 'Visit ID', 'Visit Date', 'Medicine', 'Dosage', 'Frequency', 'Duration', 'Quantity', 'Refills', 'Instructions'],
        ...visits.flatMap((visit: Visit) =>
          visit.prescriptions.map((prescription) => [
            toTitleCase(visit.patient?.name || selectedFilteredPatients.find((patient) => patient.id === visit.patientId)?.name || ''),
            visit.id,
            formatDateTimeValue(visit.date),
            prescription.medicine,
            prescription.dosage || '',
            prescription.frequency || '',
            prescription.duration || '',
            prescription.quantity || '',
            prescription.refills || '',
            prescription.instructions || ''
          ])
        )
      ];

      const testRows: ExcelCellValue[][] = [
        ['Patient Name', 'Visit ID', 'Visit Date', 'Test Name', 'Type', 'Urgency', 'Status', 'Instructions', 'Ordered Date', 'Expected Date'],
        ...visits.flatMap((visit: Visit) =>
          visit.testsOrdered.map((test) => [
            toTitleCase(visit.patient?.name || selectedFilteredPatients.find((patient) => patient.id === visit.patientId)?.name || ''),
            visit.id,
            formatDateTimeValue(visit.date),
            test.testName,
            test.testType,
            test.urgency,
            test.status,
            test.instructions || '',
            formatDateValue(test.orderedDate),
            formatDateValue(test.expectedDate)
          ])
        )
      ];

      const billRows: ExcelCellValue[][] = [
        [
          'Patient Name',
          'Bill ID',
          'Bill Number',
          'Visit ID',
          'Bill Date',
          'Due Date',
          'Total Amount',
          'Paid Amount',
          'Balance Amount',
          'Payment Status',
          'Payment Method',
          'Refund Status',
          'Refunded Amount',
          'Notes'
        ],
        ...bills.map((bill: Bill) => [
          toTitleCase(bill.patient?.name || selectedFilteredPatients.find((patient) => patient.id === bill.patientId)?.name || ''),
          bill.id,
          bill.billNumber,
          bill.visitId || '',
          formatDateTimeValue(bill.billDate),
          formatDateValue(bill.dueDate),
          bill.totalAmount,
          bill.paidAmount,
          bill.balanceAmount,
          bill.paymentStatus,
          bill.paymentMethod || '',
          bill.refundStatus,
          bill.totalRefundedAmount,
          bill.notes || ''
        ])
      ];

      const billItemRows: ExcelCellValue[][] = [
        ['Patient Name', 'Bill Number', 'Bill ID', 'Item Type', 'Item Name', 'Quantity', 'Unit Price', 'Total Price', 'Discount', 'Tax', 'Refunded Quantity', 'Refunded Amount', 'Last Refund Reason'],
        ...bills.flatMap((bill: Bill) =>
          bill.billItems.map((item) => [
            toTitleCase(bill.patient?.name || selectedFilteredPatients.find((patient) => patient.id === bill.patientId)?.name || ''),
            bill.billNumber,
            bill.id,
            item.itemType,
            item.itemName,
            item.quantity,
            item.unitPrice,
            item.totalPrice,
            item.discount || '',
            item.tax || '',
            item.refundedQuantity || '',
            item.refundedAmount || '',
            item.lastRefundReason || ''
          ])
        )
      ];

      const symptomRows: ExcelCellValue[][] = [
        ['Patient Name', 'Visit ID', 'Visit Date', 'Symptom', 'Severity', 'Duration', 'Notes'],
        ...visits.flatMap((visit: Visit) =>
          visit.symptoms.map((symptom) => [
            toTitleCase(visit.patient?.name || selectedFilteredPatients.find((patient) => patient.id === visit.patientId)?.name || ''),
            visit.id,
            formatDateTimeValue(visit.date),
            symptom.name,
            symptom.severity || '',
            symptom.duration || '',
            symptom.notes || ''
          ])
        )
      ];

      const worksheets = [
        { name: 'Patients', rows: patientRows },
        { name: 'Appointments', rows: appointmentRows },
        { name: 'Visits', rows: visitRows },
        { name: 'Symptoms', rows: symptomRows },
        { name: 'Diagnoses', rows: diagnosisRows },
        { name: 'Prescriptions', rows: prescriptionRows },
        { name: 'Tests', rows: testRows },
        { name: 'Bills', rows: billRows },
        { name: 'Bill Items', rows: billItemRows }
      ];

      const dateSuffix = new Date().toISOString().slice(0, 10);
      triggerExcelDownload(`patients_full_export_${selectedFilteredPatients.length}_${dateSuffix}.xls`, worksheets);
    } catch (downloadError) {
      console.error('Error exporting selected patients:', downloadError);
      alert('Failed to export selected patients. Please try again.');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleAddPatient = async (patientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    try {
      const newPatient = await patientService.addPatient(patientData);
      setPatients([newPatient, ...patients]);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error adding patient:', err);
      throw err;
    }
  };

  const handleEditPatient = async (updatedPatientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    if (!selectedPatient) return;

    try {
      const updatedPatient = await patientService.updatePatient(selectedPatient.id, updatedPatientData);
      setPatients(patients.map((patient) => (patient.id === updatedPatient.id ? updatedPatient : patient)));
      setIsModalOpen(false);
      setSelectedPatient(null);
    } catch (err) {
      console.error('Error updating patient:', err);
      alert(err instanceof Error ? err.message : 'Failed to update patient. Please try again.');
    }
  };

  const handleDeletePatient = async (patient: Patient) => {
    const confirmed = window.confirm(
      `Delete ${toTitleCase(patient.name)}? This will hide the patient from patient, appointment, and visit lists while keeping existing records safely stored.`
    );

    if (!confirmed) return;

    try {
      await patientService.deletePatient(patient.id);
      setPatients((currentPatients) => currentPatients.filter((currentPatient) => currentPatient.id !== patient.id));
      setSelectedPatientIds((currentSelection) => currentSelection.filter((patientId) => patientId !== patient.id));
    } catch (err) {
      console.error('Error deleting patient:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete patient. Please try again.');
    }
  };

  const openEditModal = (patient: Patient) => {
    setSelectedPatient(patient);
    setIsModalOpen(true);
  };

  const openTimeline = (patient: Patient) => {
    setTimelinePatient(patient);
    setShowTimeline(true);
  };

  const closeTimeline = () => {
    setShowTimeline(false);
    setTimelinePatient(null);
  };

  const handleAddVisit = (_patient: Patient) => {
    setShowAddVisitModal(true);
  };

  const handleVisitSaved = () => {
    setShowAddVisitModal(false);
    loadPatients();
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="text-gray-600">Please log in to access patient data.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading patients...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadPatients}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (showTimeline && timelinePatient) {
    return <PatientTimeline patient={timelinePatient} onBack={closeTimeline} />;
  }

  return (
    <div className="section-spacing">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2>Patients</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleDownloadSelectedPatients}
            disabled={selectedFilteredPatients.length === 0 || exportingExcel}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-3 rounded-lg hover:bg-emerald-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {exportingExcel
              ? 'Preparing Excel...'
              : `Download Excel${selectedFilteredPatients.length ? ` (${selectedFilteredPatients.length})` : ''}`}
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="primary-button flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Patient
          </button>
        </div>
      </div>

      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="input-field pl-12"
            />
          </div>

          <div>
            <select
              value={doctorFilter}
              onChange={(event) => setDoctorFilter(event.target.value)}
              className="input-field"
            >
              <option value="">All Doctors (Last Visit)</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  Dr. {toTitleCase(doctor.name)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={areAllFilteredSelected}
              onChange={handleSelectAllFiltered}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Select all filtered patients
          </label>
          <div className="text-sm text-gray-600">
            {selectedFilteredPatients.length} of {filteredPatients.length} filtered patients selected
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPatients.map((patient) => (
          <div
            key={patient.id}
            className="card hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">
                    {getInitials(patient.name)}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{toTitleCase(patient.name)}</h3>
                  <p className="text-sm text-gray-600">{patient.age} years - {patient.gender}</p>
                </div>
              </div>
              <input
                type="checkbox"
                aria-label={`Select ${patient.name}`}
                checked={selectedPatientIds.includes(patient.id)}
                onChange={() => togglePatientSelection(patient.id)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4" />
                {patient.phone}
              </div>
              {getPatientBloodGroup(patient) && (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Blood Group:</span> {getPatientBloodGroup(patient)}
                </div>
              )}
              {patient.lastVisit && (
                <div className="p-2 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-green-800">
                    <span className="font-semibold">Last Visit:</span> {formatDateValue(patient.lastVisit)}
                  </div>
                </div>
              )}
              {!patient.lastVisit && (
                <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-sm text-gray-600">
                    <span className="font-semibold">Status:</span> New Patient
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3 flex-wrap">
              <button
                onClick={() => openEditModal(patient)}
                className="flex-1 min-w-0 primary-button text-sm"
              >
                Edit Patient
              </button>
              <button
                onClick={() => openTimeline(patient)}
                className="flex items-center gap-1 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 transition-colors text-sm"
              >
                <Eye className="w-4 h-4" />
                View History
              </button>
              <button
                onClick={() => handleAddVisit(patient)}
                className="flex items-center gap-1 bg-purple-600 text-white px-4 py-3 rounded-lg hover:bg-purple-700 transition-colors text-sm"
              >
                <FileText className="w-4 h-4" />
                Add Visit
              </button>
              <button
                onClick={() => handleDeletePatient(patient)}
                className="flex items-center gap-1 bg-red-600 text-white px-4 py-3 rounded-lg hover:bg-red-700 transition-colors text-sm"
                title="Delete patient"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredPatients.length === 0 && (
        <div className="text-center py-12">
          <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-base">No patients found</p>
        </div>
      )}

      {isModalOpen && (
        <PatientModal
          patient={selectedPatient}
          onSave={selectedPatient ? handleEditPatient : handleAddPatient}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedPatient(null);
          }}
        />
      )}

      {showAddVisitModal && (
        <AddVisitModal
          onSave={handleVisitSaved}
          onClose={() => {
            setShowAddVisitModal(false);
          }}
        />
      )}
    </div>
  );
};

export default PatientListWithTimeline;
