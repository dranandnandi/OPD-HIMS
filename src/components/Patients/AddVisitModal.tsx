import React, { useState } from 'react';
import { X, Upload, Camera, FileText, Loader2, CheckCircle, Save, Search, User, Plus } from 'lucide-react';
import { Patient, Visit, OCRResult, Profile } from '../../types';
import { processCasePaperWithAI } from '../../services/ocrService';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase } from '../../utils/stringUtils';
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
  const [visitDate, setVisitDate] = useState(
    existingVisit 
      ? new Date(existingVisit.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );

  // Load doctors on component mount
  React.useEffect(() => {
    loadDoctors();
    if (!patient) {
      loadPatients();
    }
  }, []);

  const loadDoctors = async () => {
    try {
      const doctorsData = await authService.getDoctors();
      setDoctors(doctorsData);
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
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setStep('processing');

    try {
      const result = await processCasePaperWithAI(selectedFile, selectedPatient?.id);
      setOcrResult(result);
      setStep('emr');
    } catch (error) {
      console.error('OCR processing failed:', error);
      alert('Failed to process case paper. Please try again or enter data manually.');
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
                        <p className="text-gray-600">Take a photo or select an image of the handwritten case paper</p>
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
                          Select File
                          <input
                            type="file"
                            accept="image/*"
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
              <p className="text-gray-600 mb-2">Step 1: Extracting text from image...</p>
              <p className="text-gray-600">Step 2: Analyzing medical content with AI...</p>
              <div className="mt-4 text-sm text-gray-500">
                This may take 10-30 seconds depending on image complexity
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