import React, { useState } from 'react';
import { ArrowLeft, Calendar, FileText, Activity, Search, Filter, Plus } from 'lucide-react';
import { Patient, Visit } from '../../types';
import { visitService } from '../../services/visitService';
import { format } from 'date-fns';
import { useAuth } from '../Auth/useAuth';
import AddVisitModal from './AddVisitModal';
import { toTitleCase, getInitials } from '../../utils/stringUtils';

interface PatientTimelineProps {
  patient: Patient;
  onBack: () => void;
}

const PatientTimeline: React.FC<PatientTimelineProps> = ({ patient, onBack }) => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBy, setFilterBy] = useState<'all' | 'diagnosis' | 'medicine'>('all');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddVisitModal, setShowAddVisitModal] = useState(false);
  
  // Load visits on component mount
  React.useEffect(() => {
    if (user) {
      loadVisits();
    }
  }, [patient.id, user]);

  const loadVisits = async () => {
    try {
      setLoading(true);
      setError(null);
      const patientVisits = await visitService.getPatientVisits(patient.id);
      setVisits(patientVisits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visit history');
      console.error('Error loading visits:', err);
    } finally {
      setLoading(false);
    }
  };
  
  // Filter visits based on search and filter criteria
  const filteredVisits = visits.filter(visit => {
    const matchesSearch = !searchTerm || 
      visit.chiefComplaint.toLowerCase().includes(searchTerm.toLowerCase()) ||
      visit.diagnoses.some(d => d.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      visit.prescriptions.some(p => p.medicine.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesSearch;
  });

  const handleAddVisit = () => {
    setShowAddVisitModal(true);
  };

  const handleVisitAdded = () => {
    setShowAddVisitModal(false);
    loadVisits(); // Reload visits to show the new one
  };

  const sortedVisits = filteredVisits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="section-spacing">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-3 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 font-semibold text-sm">
            {getInitials(patient.name)}
          </span>
        </div>
        <div className="flex-1">
          <h2>{toTitleCase(patient.name)}</h2>
          <p className="text-gray-600">{patient.phone} • {patient.age} years • {patient.gender}</p>
        </div>
        <button
          onClick={handleAddVisit}
          className="primary-button flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Visit
        </button>
      </div>


      {/* Patient Summary */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{visits.length}</div>
            <div className="text-sm text-gray-600">Total Visits</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">
              {patient.lastVisit ? format(patient.lastVisit, 'MMM dd, yyyy') : 'Never'}
            </div>
            <div className="text-sm text-gray-600">Last Visit</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{patient.bloodGroup || 'Unknown'}</div>
            <div className="text-sm text-gray-600">Blood Group</div>
          </div>
        </div>
        
        {patient.allergies && patient.allergies.length > 0 && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h4 className="font-medium text-red-800 mb-2">Allergies</h4>
            <div className="flex flex-wrap gap-2">
              {patient.allergies.map(allergy => (
                <span key={allergy} className="px-2 py-1 bg-red-100 text-red-700 text-sm rounded-full">
                  {allergy}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search and Filter */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search visits, diagnoses, medicines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pl-12"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as 'all' | 'diagnosis' | 'medicine')}
              className="input-field"
            >
              <option value="all">All Visits</option>
              <option value="diagnosis">By Diagnosis</option>
              <option value="medicine">By Medicine</option>
            </select>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="card p-0">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3>Visit History</h3>
            {loading && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            )}
          </div>
        </div>
        
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Loading visit history...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className="text-red-600 mb-4">{error}</div>
              <button
                onClick={loadVisits}
                className="primary-button"
              >
                Retry
              </button>
            </div>
          ) : sortedVisits.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-base">
                {searchTerm ? 'No visits found matching your search' : 'No visits recorded yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {sortedVisits.map((visit, index) => (
                <div key={visit.id} className="relative">
                  {/* Timeline connector */}
                  {index < sortedVisits.length - 1 && (
                    <div className="absolute left-6 top-14 w-0.5 h-full bg-gray-200" />
                  )}
                  
                  <div className="flex gap-6">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-blue-600" />
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="bg-gray-50 rounded-lg p-6">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-gray-800">
                            {format(visit.date, 'MMMM dd, yyyy')}
                          </h4>
                          <span className="text-sm text-gray-500">
                            {format(visit.date, 'h:mm a')}
                          </span>
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <h5 className="text-sm font-semibold text-gray-700 mb-1">Chief Complaint</h5>
                            <p className="text-sm text-gray-600">{visit.chiefComplaint}</p>
                          </div>
                          
                          {visit.symptoms && visit.symptoms.length > 0 && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-2">Symptoms</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {visit.symptoms.map(symptom => (
                                  <span key={symptom.id} className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                                    {symptom.name}
                                    {symptom.severity && ` (${symptom.severity})`}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* Vitals */}
                          {Object.keys(visit.vitals).some(key => visit.vitals[key as keyof typeof visit.vitals]) && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-2">Vitals</h5>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                                {visit.vitals.temperature && (
                                  <div className="text-xs">
                                    <span className="text-gray-500">Temp:</span> {visit.vitals.temperature}°F
                                  </div>
                                )}
                                {visit.vitals.bloodPressure && (
                                  <div className="text-xs">
                                    <span className="text-gray-500">BP:</span> {visit.vitals.bloodPressure}
                                  </div>
                                )}
                                {visit.vitals.pulse && (
                                  <div className="text-xs">
                                    <span className="text-gray-500">Pulse:</span> {visit.vitals.pulse} BPM
                                  </div>
                                )}
                                {visit.vitals.weight && (
                                  <div className="text-xs">
                                    <span className="text-gray-500">Weight:</span> {visit.vitals.weight} kg
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {visit.diagnoses && visit.diagnoses.length > 0 && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-2">Diagnosis</h5>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {visit.diagnoses.map(diagnosis => (
                                  <span key={diagnosis.id} className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                                    {diagnosis.name}
                                    {diagnosis.isPrimary && ' (Primary)'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {visit.prescriptions && visit.prescriptions.length > 0 && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-2">Prescriptions</h5>
                              <div className="mt-1 space-y-1">
                                {visit.prescriptions.map(prescription => (
                                  <div key={prescription.id} className="text-xs text-gray-600 bg-white p-2 rounded border">
                                    <strong>{prescription.medicine}</strong> - {prescription.dosage} {prescription.frequency} for {prescription.duration}
                                    {prescription.instructions && (
                                      <span className="text-gray-500"> ({prescription.instructions})</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {visit.advice && visit.advice.length > 0 && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-2">Advice</h5>
                              <ul className="text-xs text-gray-600 mt-1 space-y-1">
                                {visit.advice.map((advice, i) => (
                                  <li key={i} className="flex items-start gap-1">
                                    <span className="text-blue-600">•</span>
                                    {advice}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {visit.followUpDate && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-1">Follow-up</h5>
                              <p className="text-xs text-blue-600">
                                {format(visit.followUpDate, 'PPP')}
                              </p>
                            </div>
                          )}
                          
                          {visit.doctorNotes && (
                            <div>
                              <h5 className="text-sm font-semibold text-gray-700 mb-1">Doctor's Notes</h5>
                              <p className="text-xs text-gray-600 italic">{visit.doctorNotes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Visit Modal */}
      {showAddVisitModal && (
        <AddVisitModal
          patient={patient} // Keep patient prop for timeline context
          onSave={handleVisitAdded}
          onClose={() => setShowAddVisitModal(false)}
        />
      )}
    </div>
  );
};

export default PatientTimeline;