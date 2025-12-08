import React, { useState } from 'react';
import { Search, Plus, Phone, User, Eye, FileText } from 'lucide-react';
import { Patient } from '../../types';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import PatientModal from './PatientModal';
import PatientTimeline from './PatientTimeline';
import AddVisitModal from './AddVisitModal';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase, getInitials } from '../../utils/stringUtils';

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

  // Load patients on component mount
  React.useEffect(() => {
    if (user) {
      loadPatients();
      loadDoctors();
    }
  }, [user]);

  const loadPatients = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check if we have a valid user session first
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
      
      // If it's a network error, provide more helpful guidance
      if (errorMessage.includes('Network connection failed') || errorMessage.includes('Supabase client not initialized')) {
        setError('Unable to connect to the server. Please check your internet connection and refresh the page.');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    try {
      // Use authService to get doctors and filter by clinic ID
      const allDoctors = await authService.getDoctors();
      const filteredDoctors = allDoctors.filter(doctor => doctor.clinicId === user?.clinicId);
      
      setDoctors(filteredDoctors);
    } catch (error) {
      console.error('Error loading doctors:', error);
      setDoctors([]);
    }
  };

  const filteredPatients = patients.filter(patient => 
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.phone.includes(searchTerm) ||
    patient.id.includes(searchTerm)
  );

  const handleAddPatient = async (patientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    try {
      const newPatient = await patientService.addPatient(patientData);
      setPatients([newPatient, ...patients]);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error adding patient:', err);
      // Don't show alert here - let the modal handle the error display
      throw err; // Re-throw to let PatientModal handle it
    }
  };

  const handleEditPatient = async (updatedPatientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    if (!selectedPatient) return;
    
    try {
      const updatedPatient = await patientService.updatePatient(selectedPatient.id, updatedPatientData);
      setPatients(patients.map(p => p.id === updatedPatient.id ? updatedPatient : p));
      setIsModalOpen(false);
      setSelectedPatient(null);
    } catch (err) {
      console.error('Error updating patient:', err);
      alert(err instanceof Error ? err.message : 'Failed to update patient. Please try again.');
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

  const handleAddVisit = (patient: Patient) => {
    setShowAddVisitModal(true);
  };

  const handleVisitSaved = () => {
    setShowAddVisitModal(false);
    // Optionally reload patients to update last visit date
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
        <button
          onClick={() => setIsModalOpen(true)}
          className="primary-button flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Patient
        </button>
      </div>

      {/* Search Bar */}
      <div className="card p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by name or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pl-12"
            />
          </div>
          
          {/* Doctor Filter */}
          <div>
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="input-field"
            >
              <option value="">All Doctors (Last Visit)</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  Dr. {toTitleCase(doctor.name)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Patient Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPatients.map(patient => (
          <div
            key={patient.id}
            className="card hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold text-sm">
                    {getInitials(patient.name)}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{toTitleCase(patient.name)}</h3>
                  <p className="text-sm text-gray-600">{patient.age} years • {patient.gender}</p>
                </div>
              </div>
            </div>
            
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4" />
                {patient.phone}
              </div>
              {patient.bloodGroup && (
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Blood Group:</span> {patient.bloodGroup}
                </div>
              )}
              {patient.lastVisit && (
                <div className="p-2 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm text-green-800">
                    <span className="font-semibold">Last Visit:</span> {patient.lastVisit.toLocaleDateString()}
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

      {/* Patient Modal */}
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

      {/* Add Visit Modal */}
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