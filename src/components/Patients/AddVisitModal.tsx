import React, { useState } from 'react';
import { X, Upload, Camera, FileText, Loader2, CheckCircle, Save, Search, User, Plus, Calendar, Clock, Phone, Stethoscope } from 'lucide-react';
import { Patient, Visit, OCRResult, Profile } from '../../types';
import { processCasePaperWithAI } from '../../services/ocrService';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase } from '../../utils/stringUtils';
import { isPDF, convertPDFToSingleImage } from '../../utils/pdfToImage';
import { supabase } from '../../lib/supabaseClient';
import PatientModal from './PatientModal';
import EMRForm from './EMRForm';

interface AddVisitModalProps {
  patient?: Patient; // Make optional for backward compatibility
  existingVisit?: Visit;
  onSave: () => void;
  onClose: () => void;
}

const AddVisitModal: React.FC<AddVisitModalProps> = ({ patient, existingVisit, onSave, onClose }) => {
  const { user } = useAuth();
  const [step, setStep] = useState<'patient' | 'method' | 'upload' | 'processing' | 'emr'>(
    existingVisit ? 'emr' : patient ? 'method' : 'patient'
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [useOCR, setUseOCR] = useState(false);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(patient || null);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [showPatientSearchResults, setShowPatientSearchResults] = useState(false);
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [todaysAppointments, setTodaysAppointments] = useState<any[]>([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [showAllDoctorsAppointments, setShowAllDoctorsAppointments] = useState(false);
  const [visitDate, setVisitDate] = useState(
    existingVisit
      ? new Date(existingVisit.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );

  const loadDoctors = async () => {
    try {
      // Load all active doctors from clinic (not just those open for consultation)
      // Users need to select doctors for visit EMR even if they're not currently accepting appointments
      const doctorsData = await authService.getAllDoctors();
      setDoctors(doctorsData);

      if (doctorsData.length === 0) {
        console.warn('No doctors found in clinic');
      }
    } catch (error) {
      console.error('Error loading doctors:', error);
    }
  };

  const loadPatients = async () => {
    try {
      setLoadingPatients(true);
      const patientsData = await patientService.getPatients();
      setPatients(patientsData);
    } catch (error) {
      console.error('Error loading patients:', error);
      alert('Failed to load patients. Please try again.');
    } finally {
      setLoadingPatients(false);
    }
  };

  const loadTodaysAppointments = async (allDoctors: boolean = false) => {
    if (!user?.clinicId || !supabase) return;

    try {
      setLoadingAppointments(true);
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

      let query = supabase
        .from('appointments')
        .select(`
          *,
          patient:patient_id(id, name, phone, age, gender),
          doctor:doctor_id(id, name, specialization)
        `)
        .eq('clinic_id', user.clinicId)
        .gte('appointment_date', startOfDay)
        .lte('appointment_date', endOfDay)
        .order('appointment_date', { ascending: true });

      // Filter by current doctor if not showing all
      if (!allDoctors && user.id) {
        query = query.eq('doctor_id', user.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTodaysAppointments(data || []);
    } catch (error) {
      console.error('Error loading today\'s appointments:', error);
      setTodaysAppointments([]);
    } finally {
      setLoadingAppointments(false);
    }
  };

  // Load doctors on component mount
  React.useEffect(() => {
    loadDoctors();
    if (!patient) {
      loadPatients();
    }
    // Load today's appointments
    loadTodaysAppointments(showAllDoctorsAppointments);
  }, []);

  // Reload appointments when filter changes
  React.useEffect(() => {
    if (step === 'patient') {
      loadTodaysAppointments(showAllDoctorsAppointments);
    }
  }, [showAllDoctorsAppointments]);

  // Filter patients based on search term
  const filteredPatients = patients.filter(p =>
    p.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) ||
    p.phone.includes(patientSearchTerm)
  ).slice(0, 10); // Limit to 10 results for performance

  const handlePatientSearch = (searchTerm: string) => {
    setPatientSearchTerm(searchTerm);
    setShowPatientSearchResults(searchTerm.length > 0);
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setPatientSearchTerm('');
    setShowPatientSearchResults(false);
    setStep('method');
  };

  const handleAppointmentSelect = (appointment: any) => {
    if (appointment.patient) {
      setSelectedPatient(appointment.patient);
      setPatientSearchTerm('');
      setShowPatientSearchResults(false);
      setStep('method');
    }
  };

  const clearPatientSelection = () => {
    setSelectedPatient(null);
    setPatientSearchTerm('');
    setShowPatientSearchResults(false);
    setStep('patient');
  };

  const handleSaveNewPatient = async (patientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    try {
      const newPatient = await patientService.addPatient(patientData);
      setSelectedPatient(newPatient);
      setShowNewPatientModal(false);
      setStep('method');
      await loadPatients(); // Refresh patient list
    } catch (error) {
      console.error('Error adding patient:', error);
      throw error; // Re-throw to let PatientModal handle it
    }
  };

  const handleMethodSelection = (method: 'manual' | 'ocr') => {
    if (method === 'manual') {
      setUseOCR(false);
      setStep('emr');
    } else {
      setUseOCR(true);
      setStep('upload');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type - images and PDFs supported
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
      if (!validTypes.includes(file.type.toLowerCase())) {
        alert('Please upload a valid image file (JPEG, PNG, HEIC, HEIF, WebP) or PDF.');
        event.target.value = ''; // Reset the input
        return;
      }

      // Check file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('File size must be less than 10MB');
        event.target.value = '';
        return;
      }

      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setStep('processing');

    try {
      let fileToProcess = selectedFile;

      // If PDF, convert to image first
      if (isPDF(selectedFile)) {
        try {
          console.log('Converting PDF to image...');
          fileToProcess = await convertPDFToSingleImage(selectedFile, {
            scale: 2.0,
            outputFormat: 'image/jpeg',
            quality: 0.92
          });
          console.log('PDF converted to image successfully');
        } catch (error) {
          console.error('PDF conversion failed:', error);
          throw new Error(`Failed to convert PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      const result = await processCasePaperWithAI(fileToProcess, selectedPatient?.id);
      setOcrResult(result);
      setStep('emr');
    } catch (error) {
      console.error('OCR processing failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(`Failed to process case paper: ${errorMessage}. Please try again or enter data manually.`);
      setStep('upload');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVisitSaved = () => {
    onSave();
    onClose();
  };

  const getEmptyOCRData = () => ({
    symptoms: [],
    vitals: {},
    diagnoses: [],
    prescriptions: [],
    advice: []
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              {existingVisit ? 'Edit Visit' : 'Add New Visit'}
            </h2>
            {selectedPatient && (
              <p className="text-sm text-gray-600">Patient: {toTitleCase(selectedPatient.name)} • {selectedPatient.phone}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {step === 'patient' && (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Select Patient</h3>
                <p className="text-gray-600">Search for an existing patient or add a new one</p>
              </div>

              {/* Today's Appointments Section */}
              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-md font-semibold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    Today's Appointments
                    {todaysAppointments.length > 0 && (
                      <span className="text-sm text-gray-500">({todaysAppointments.length})</span>
                    )}
                  </h4>
                  <select
                    value={showAllDoctorsAppointments ? 'all' : 'my'}
                    onChange={(e) => setShowAllDoctorsAppointments(e.target.value === 'all')}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="my">My Appointments</option>
                    <option value="all">All Doctors</option>
                  </select>
                </div>

                {loadingAppointments ? (
                  <div className="text-center py-6">
                    <Loader2 className="w-6 h-6 text-blue-500 mx-auto mb-2 animate-spin" />
                    <p className="text-sm text-gray-600">Loading appointments...</p>
                  </div>
                ) : todaysAppointments.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {todaysAppointments.map((apt: any) => (
                      <button
                        key={apt.id}
                        onClick={() => handleAppointmentSelect(apt)}
                        className="w-full p-3 rounded-lg border-2 border-gray-200 bg-white text-left transition-all hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
                              <span className="font-medium text-gray-900">
                                {new Date(apt.appointment_date).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: true
                                })}
                              </span>
                              {apt.appointment_type && (
                                <span className="text-sm text-gray-600">- {apt.appointment_type}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm mb-1">
                              <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="font-medium text-gray-800 truncate">
                                {toTitleCase(apt.patient?.name || 'Unknown')}
                              </span>
                              {apt.patient?.phone && (
                                <>
                                  <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                  <span className="text-gray-600">{apt.patient.phone}</span>
                                </>
                              )}
                            </div>
                            {showAllDoctorsAppointments && apt.doctor && (
                              <div className="flex items-center gap-2 text-sm">
                                <Stethoscope className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                <span className="text-gray-700">Dr. {apt.doctor.name}</span>
                              </div>
                            )}
                          </div>
                          <CheckCircle className="w-5 h-5 text-blue-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    <p>No appointments scheduled for today</p>
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Or search patients</span>
                </div>
              </div>

              {/* Patient Search */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search patients by name or phone..."
                      value={patientSearchTerm}
                      onChange={(e) => handlePatientSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <button
                    onClick={() => setShowNewPatientModal(true)}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add New Patient
                  </button>
                </div>

                {/* Search Results */}
                {showPatientSearchResults && (
                  <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
                    {loadingPatients ? (
                      <div className="p-4 text-center text-gray-500">Loading patients...</div>
                    ) : filteredPatients.length > 0 ? (
                      filteredPatients.map(patient => (
                        <button
                          key={patient.id}
                          onClick={() => handlePatientSelect(patient)}
                          className="w-full text-left p-4 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <User className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-800">{toTitleCase(patient.name)}</div>
                              <div className="text-sm text-gray-600">{patient.phone} • {patient.age} years • {patient.gender}</div>
                              {patient.lastVisit && (
                                <div className="text-xs text-green-600">
                                  Last visit: {new Date(patient.lastVisit).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-4 text-center text-gray-500">
                        <p>No patients found matching "{patientSearchTerm}"</p>
                        <button
                          onClick={() => setShowNewPatientModal(true)}
                          className="mt-2 text-blue-600 hover:text-blue-700 text-sm underline"
                        >
                          Add "{patientSearchTerm}" as new patient
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Recent Patients (when no search term) */}
                {!patientSearchTerm && !showPatientSearchResults && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Recent Patients</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {patients.slice(0, 6).map(patient => (
                        <button
                          key={patient.id}
                          onClick={() => handlePatientSelect(patient)}
                          className="text-left p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <User className="w-4 h-4 text-blue-600" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-800 text-sm">{toTitleCase(patient.name)}</div>
                              <div className="text-xs text-gray-600">{patient.phone}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'method' && (
            <div className="space-y-6">
              {/* Selected Patient Display */}
              {selectedPatient && (
                <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-medium text-blue-800">{toTitleCase(selectedPatient.name)}</p>
                      <p className="text-sm text-blue-600">{selectedPatient.phone} • {selectedPatient.age} years</p>
                    </div>
                  </div>
                  <button
                    onClick={clearPatientSelection}
                    className="text-blue-600 hover:text-blue-700 text-sm"
                  >
                    Change Patient
                  </button>
                </div>
              )}

              {/* Visit Date Selection */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Visit Date</label>
                <input
                  type="date"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">How would you like to create this visit?</h3>
                <p className="text-gray-600">Choose your preferred method for entering visit data</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button
                  onClick={() => handleMethodSelection('ocr')}
                  className="card hover:border-blue-500 hover:bg-blue-50 transition-colors group border-2 border-dashed border-gray-300"
                >
                  <div className="text-center space-y-6">
                    <Camera className="w-16 h-16 text-gray-400 group-hover:text-blue-500 mx-auto transition-colors" />
                    <div>
                      <h4 className="text-gray-800 mb-2">Scan Case Paper</h4>
                      <p className="text-gray-600">Upload or take a photo of handwritten case paper</p>
                      <p className="text-sm text-blue-600 mt-3 font-medium">✨ AI will extract data automatically</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleMethodSelection('manual')}
                  className="card hover:border-green-500 hover:bg-green-50 transition-colors group border-2 border-dashed border-gray-300"
                >
                  <div className="text-center space-y-6">
                    <FileText className="w-16 h-16 text-gray-400 group-hover:text-green-500 mx-auto transition-colors" />
                    <div>
                      <h4 className="text-gray-800 mb-2">Manual Entry</h4>
                      <p className="text-gray-600">Enter visit details manually using forms</p>
                      <p className="text-sm text-green-600 mt-3 font-medium">📝 Traditional data entry method</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Upload Case Paper</h3>
                <button
                  onClick={() => setStep('method')}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  ← Back to method selection
                </button>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <div className="space-y-4">
                  {selectedFile ? (
                    <>
                      <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                      <div>
                        <p className="text-lg font-medium text-gray-800">File Selected</p>
                        <p className="text-gray-600">{selectedFile.name}</p>
                      </div>
                      <button
                        onClick={handleUpload}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto"
                      >
                        <FileText className="w-5 h-5" />
                        Process with AI
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload className="w-16 h-16 text-gray-400 mx-auto" />
                      <div>
                        <p className="text-lg font-medium text-gray-800">Upload Case Paper</p>
                        <p className="text-gray-600">Take a photo or select an image/PDF of the case paper</p>
                        <p className="text-xs text-blue-600 mt-1">📄 PDFs will be automatically converted to images</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <label className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center gap-2">
                          <Camera className="w-5 h-5" />
                          Take Photo
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleFileSelect}
                            className="hidden"
                          />
                        </label>
                        <label className="border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer flex items-center gap-2">
                          <Upload className="w-5 h-5" />
                          Select Image/PDF
                          <input
                            type="file"
                            accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,image/webp,application/pdf"
                            onChange={handleFileSelect}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center py-12">
              <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">Processing Case Paper with AI</h3>
              {selectedFile && isPDF(selectedFile) && (
                <p className="text-gray-600 mb-2">Converting PDF to image...</p>
              )}
              <p className="text-gray-600 mb-2">Step 1: Extracting text from document...</p>
              <p className="text-gray-600">Step 2: Analyzing medical content with AI...</p>
              <div className="mt-4 text-sm text-gray-500">
                This may take 10-40 seconds depending on document complexity
              </div>
            </div>
          )}

          {step === 'emr' && selectedPatient && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800">Visit Details</h3>
                {(useOCR && !existingVisit) || (!patient && !existingVisit) ? (
                  <button
                    onClick={() => setStep(patient ? 'method' : 'patient')}
                    className="text-blue-600 hover:text-blue-700 text-sm"
                  >
                    ← Start over
                  </button>
                ) : null}
              </div>

              <EMRForm
                patient={selectedPatient}
                existingVisit={existingVisit}
                ocrData={ocrResult?.extractedData || getEmptyOCRData()}
                initialVisitDate={visitDate}
                onSave={handleVisitSaved}
              />
            </div>
          )}
        </div>

        {/* New Patient Modal */}
        {showNewPatientModal && (
          <PatientModal
            patient={null}
            onSave={handleSaveNewPatient}
            onClose={() => setShowNewPatientModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default AddVisitModal;