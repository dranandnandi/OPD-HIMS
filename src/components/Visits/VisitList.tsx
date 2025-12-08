import React, { useState, useEffect } from 'react';
import { Search, Filter, Calendar, User, Eye, Plus, FileText, CheckCircle, XCircle, Stethoscope } from 'lucide-react';
import { Visit, Patient, Profile } from '../../types';
import { visitService } from '../../services/visitService';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import { useAuth } from '../Auth/useAuth';
import { useNavigate } from 'react-router-dom';
import { format, isAfter } from 'date-fns';
import AddVisitModal from '../Patients/AddVisitModal';
import VisitDetailsModal from './VisitDetailsModal';
import { toTitleCase } from '../../utils/stringUtils';

const VisitList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);
  const [showAddVisitModal, setShowAddVisitModal] = useState(false);
  const [showVisitDetailsModal, setShowVisitDetailsModal] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [visitsData, patientsData, doctorsData] = await Promise.all([
        visitService.getAllVisits(),
        patientService.getPatients(),
        authService.getDoctors()
      ]);
      
      setVisits(visitsData);
      setPatients(patientsData);
      
      // Filter doctors by current user's clinic ID
      const filteredDoctors = doctorsData.filter(doctor => doctor.clinicId === user?.clinicId);
      setDoctors(filteredDoctors);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visits data');
      console.error('Error loading visits data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getVisitStatus = (visit: Visit): 'Open' | 'Closed' => {
    // Visit is "Open" if there's a future follow-up date, otherwise "Closed"
    if (visit.followUpDate && isAfter(visit.followUpDate, new Date())) {
      return 'Open';
    }
    return 'Closed';
  };

  const getPatientName = (patientId: string): string => {
    const patient = patients.find(p => p.id === patientId);
    return toTitleCase(patient?.name || 'Unknown Patient');
  };

  const getDoctorName = (doctorId: string): string => {
    const doctor = doctors.find(d => d.id === doctorId);
    return toTitleCase(doctor?.name || 'Unknown Doctor');
  };

  const filteredVisits = visits.filter(visit => {
    // Search filter
    const matchesSearch = !searchTerm || 
      getPatientName(visit.patientId).toLowerCase().includes(searchTerm.toLowerCase()) ||
      visit.chiefComplaint.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getDoctorName(visit.doctorId).toLowerCase().includes(searchTerm.toLowerCase());

    // Doctor filter
    const matchesDoctor = !selectedDoctor || visit.doctorId === selectedDoctor;

    // Date range filter
    const visitDate = new Date(visit.date);
    const matchesDateFrom = !dateFrom || visitDate >= new Date(dateFrom);
    const matchesDateTo = !dateTo || visitDate <= new Date(dateTo);

    return matchesSearch && matchesDoctor && matchesDateFrom && matchesDateTo;
  });

  const handleViewDetails = (visitId: string) => {
    setSelectedVisitId(visitId);
    setShowVisitDetailsModal(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedDoctor('');
    setDateFrom('');
    setDateTo('');
  };

  const handleAddVisit = () => {
    setShowAddVisitModal(true);
  };

  const handleVisitSaved = () => {
    setShowAddVisitModal(false);
    loadData(); // Reload visits to show the new one
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view visits.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading visits...</p>
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
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patient Visits</h1>
          <p className="text-gray-600 mt-1">View all patient visits and medical records</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <button
            onClick={handleAddVisit}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Visit
          </button>
          <div className="text-sm text-gray-600">
            Total: {filteredVisits.length} visits
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card-standard p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-gray-600" />
          <h3>Filters</h3>
          <button
            onClick={clearFilters}
            className="ml-auto text-blue-600 hover:text-blue-700 text-sm"
          >
            Clear All
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search patient, doctor, or reason..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field pl-12"
              />
            </div>
          </div>

          {/* Doctor Filter */}
          <div>
            <label className="block mb-2">Doctor</label>
            <select
              value={selectedDoctor}
              onChange={(e) => setSelectedDoctor(e.target.value)}
              className="input-field"
            >
              <option value="">All Doctors</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block mb-2">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block mb-2">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
      </div>

      {/* Visits Table */}
      <div className="card-standard overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3>All Visits</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                  Patient
                  </div>
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  <div className="flex items-center justify-end gap-2">
                    <Calendar className="w-4 h-4" />
                    Visit Date
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Reason/Purpose
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-4 h-4" />
                  Doctor
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredVisits.map(visit => {
                const status = getVisitStatus(visit);
                const isExpanded = expandedVisit === visit.id;
                return (
                  <React.Fragment key={visit.id}>
                    <tr className={`hover:bg-gray-50 cursor-pointer transition-colors text-sm ${
                      filteredVisits.indexOf(visit) % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    }`}
                      onClick={() => setExpandedVisit(isExpanded ? null : visit.id)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <User className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="font-medium text-gray-900">
                            {getPatientName(visit.patientId)}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="text-gray-900 font-medium">
                          {format(visit.date, 'MMM dd, yyyy')}
                        </div>
                        <div className="text-xs text-gray-500">
                          {format(visit.date, 'h:mm a')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900 max-w-xs truncate">
                          {visit.chiefComplaint || 'No complaint specified'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900">
                          {getDoctorName(visit.doctorId)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Consultation
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`status-chip ${
                          status === 'Open' 
                            ? 'status-chip-open' 
                            : 'status-chip-closed'
                        }`}>
                          {status === 'Open' ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewDetails(visit.id);
                            }}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 transition-colors text-sm font-medium"
                          >
                            <Eye className="w-4 h-4" />
                            View Details
                          </button>
                          <span className="text-gray-400 text-xs">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                      </td>
                    </tr>
                    
                    {/* Expandable Row */}
                    {isExpanded && (
                      <tr className="bg-blue-50/30">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {/* Symptoms */}
                              {visit.symptoms && visit.symptoms.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-1">Symptoms</h4>
                                  <div className="flex flex-wrap gap-1">
                                    {visit.symptoms.slice(0, 3).map(symptom => (
                                      <span key={symptom.id} className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-lg">
                                        {symptom.name}
                                      </span>
                                    ))}
                                    {visit.symptoms.length > 3 && (
                                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                                        +{visit.symptoms.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {/* Vitals */}
                              {Object.keys(visit.vitals).some(key => visit.vitals[key as keyof typeof visit.vitals]) && (
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-1">Vitals</h4>
                                  <div className="text-sm text-gray-600 space-y-1">
                                    {visit.vitals.temperature && <div>Temp: {visit.vitals.temperature}°F</div>}
                                    {visit.vitals.bloodPressure && <div>BP: {visit.vitals.bloodPressure}</div>}
                                    {visit.vitals.pulse && <div>Pulse: {visit.vitals.pulse} BPM</div>}
                                  </div>
                                </div>
                              )}
                              
                              {/* Diagnoses */}
                              {visit.diagnoses && visit.diagnoses.length > 0 && (
                                <div>
                                  <h4 className="font-medium text-gray-700 mb-1">Diagnoses</h4>
                                  <div className="flex flex-wrap gap-1">
                                    {visit.diagnoses.slice(0, 2).map(diagnosis => (
                                      <span key={diagnosis.id} className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-lg">
                                        {diagnosis.name}
                                      </span>
                                    ))}
                                    {visit.diagnoses.length > 2 && (
                                      <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                                        +{visit.diagnoses.length - 2} more
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredVisits.length === 0 && (
          <div className="p-8 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchTerm || selectedDoctor || dateFrom || dateTo 
                ? 'No visits found matching your filters' 
                : 'No visits recorded yet'
              }
            </p>
          </div>
        )}
      </div>

      {/* Visit Details Modal */}
      {showVisitDetailsModal && selectedVisitId && (
        <VisitDetailsModal
          visitId={selectedVisitId}
          onClose={() => setShowVisitDetailsModal(false)}
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

export default VisitList;