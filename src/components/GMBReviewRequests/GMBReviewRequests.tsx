import React, { useState, useEffect } from 'react';
import { Search, Filter, Calendar, User, Send, Star, CheckCircle, AlertCircle, Heart, Phone, TrendingUp } from 'lucide-react';
import { Visit, Patient, Profile } from '../../types';
import { visitService } from '../../services/visitService';
import { patientService } from '../../services/patientService';
import { authService } from '../../services/authService';
import { reviewService } from '../../services/reviewService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import { format, isToday } from 'date-fns';
import SendMessageModal from '../FollowUps/SendMessageModal';
import { toTitleCase } from '../../utils/stringUtils';

const GMBReviewRequests: React.FC = () => {
  const { user } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [messagesSentStatus, setMessagesSentStatus] = useState<{ [visitId: string]: { followUpSent: boolean; thankYouSent: boolean } }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [showSendMessageModal, setShowSendMessageModal] = useState(false);
  const [selectedVisitForMessage, setSelectedVisitForMessage] = useState<Visit | null>(null);

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
        // Load doctors using authService to ensure clinic filtering
        authService.getDoctors()
      ]);
      
      setVisits(visitsData);
      setPatients(patientsData);
      setDoctors(doctorsData);
      
      // Load message sent status for each visit
      const statusPromises = visitsData.map(async (visit) => {
        const status = await reviewService.checkMessagesSent(visit.id);
        return { visitId: visit.id, status };
      });
      
      const statusResults = await Promise.all(statusPromises);
      const statusMap = statusResults.reduce((acc, { visitId, status }) => {
        acc[visitId] = status;
        return acc;
      }, {} as { [visitId: string]: { followUpSent: boolean; thankYouSent: boolean } });
      
      setMessagesSentStatus(statusMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GMB review data');
      console.error('Error loading GMB review data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getPatientName = (patientId: string): string => {
    const patient = patients.find(p => p.id === patientId);
    return toTitleCase(patient?.name || 'Unknown Patient');
  };

  const getDoctorName = (doctorId: string): string => {
    const doctor = doctors.find(d => d.id === doctorId);
    return toTitleCase(doctor?.name || 'Unknown Doctor');
  };

  const getFilteredVisits = () => {
    // Show only today's visits where thank you messages haven't been sent
    return visits.filter(visit => {
      if (!visit.patient) return false;
      
      const status = messagesSentStatus[visit.id] || { followUpSent: false, thankYouSent: false };
      const isTodaysVisit = isToday(visit.date);
      
      // Base filter: today's visits where thank you hasn't been sent
      if (!isTodaysVisit) return false;
      
      const matchesSearch = !searchTerm || 
        visit.patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        visit.patient.phone.includes(searchTerm) ||
        visit.chiefComplaint.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesDoctor = !selectedDoctor || visit.doctorId === selectedDoctor;

      return matchesSearch && matchesDoctor;
    });
  };

  const handleSendMessage = (visit: Visit) => {
    setSelectedVisitForMessage(visit);
    setShowSendMessageModal(true);
  };

  const handleMessageSent = (visitId: string, messageType: 'follow_up' | 'thank_you') => {
    // Update the specific message status immediately
    setMessagesSentStatus(prev => ({
      ...prev,
      [visitId]: {
        ...prev[visitId],
        [messageType === 'follow_up' ? 'followUpSent' : 'thankYouSent']: true
      }
    }));
    
    setShowSendMessageModal(false);
    setSelectedVisitForMessage(null);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedDoctor('');
  };

  const getGMBSummary = () => {
    const todaysVisits = visits.filter(v => isToday(v.date));
    const pendingReviews = todaysVisits.filter(v => {
      const status = messagesSentStatus[v.id] || { followUpSent: false, thankYouSent: false };
      return !status.thankYouSent;
    });
    const sentReviews = todaysVisits.filter(v => {
      const status = messagesSentStatus[v.id] || { followUpSent: false, thankYouSent: false };
      return status.thankYouSent;
    });

    return {
      todaysVisits: todaysVisits.length,
      pendingReviews: pendingReviews.length,
      sentReviews: sentReviews.length
    };
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view GMB review requests.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading GMB review requests...</p>
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

  const filteredVisits = getFilteredVisits();
  const summary = getGMBSummary();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GMB Review Requests</h1>
          <p className="text-gray-600 mt-1">Send thank you messages and review requests to today's patients</p>
        </div>
        <div className="text-sm text-gray-600">
          {summary.todaysVisits} visits today • {summary.pendingReviews} pending • {summary.sentReviews} sent
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Today's Visits</p>
              <p className="text-2xl font-bold text-blue-600">{summary.todaysVisits}</p>
            </div>
            <Calendar className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Pending Reviews</p>
              <p className="text-2xl font-bold text-yellow-600">{summary.pendingReviews}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-yellow-600" />
          </div>
        </div>

        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Reviews Sent</p>
              <p className="text-2xl font-bold text-green-600">{summary.sentReviews}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-600" />
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>
      </div>

      {/* GMB Review Requests Table */}
      <div className="card-standard overflow-hidden">
        <div className="p-4 bg-yellow-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-600" />
            <div>
              <h3 className="font-medium text-yellow-800">Google My Business Review Requests</h3>
              <p className="text-sm text-yellow-700">
                Send thank you messages and review requests to today's patients ({summary.todaysVisits} visits today, {summary.pendingReviews} pending)
              </p>
            </div>
          </div>
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
                    Visit Date (Today)
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Treatment/Reason
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Contact
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Review Status
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredVisits.map((visit, index) => {
                if (!visit.patient) return null;
                
                const messageSentStatus = messagesSentStatus[visit.id] || { followUpSent: false, thankYouSent: false };
                
                return (
                  <tr 
                    key={visit.id} 
                    className={`hover:bg-gray-50 transition-colors text-sm ${
                      index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{toTitleCase(visit.patient.name)}</div>
                          <div className="text-xs text-gray-500">Age: {visit.patient.age}</div>
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
                      <div className="text-xs text-blue-600 mt-1">
                        Today's Visit
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-gray-900 max-w-xs truncate">
                        {visit.chiefComplaint || 'General consultation'}
                      </div>
                      <div className="text-xs text-gray-500">
                        Dr. {getDoctorName(visit.doctorId)}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-gray-900 font-medium">{visit.patient.phone}</div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <span className={`status-chip text-xs ${
                        messageSentStatus.thankYouSent 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        <Heart className="w-3 h-3" />
                        {messageSentStatus.thankYouSent ? 'Review Sent' : 'Pending'}
                      </span>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {messageSentStatus.thankYouSent ? (
                          <span className="flex items-center gap-1 text-green-600 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            Sent
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSendMessage(visit)}
                            className="flex items-center gap-1 bg-yellow-600 text-white px-3 py-1 rounded-lg hover:bg-yellow-700 transition-colors text-sm"
                          >
                            <Star className="w-4 h-4" />
                            Send Review Request
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {filteredVisits.length === 0 && (
          <div className="p-8 text-center">
            <Star className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchTerm || selectedDoctor 
                ? 'No pending review requests found matching your filters' 
                : 'No pending review requests for today'
              }
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Review requests are shown for today's visits where thank you messages haven't been sent yet.
            </p>
          </div>
        )}
      </div>

      {/* Send Message Modal */}
      {showSendMessageModal && selectedVisitForMessage && (
        <SendMessageModal
          review={reviewService.visitToReview(selectedVisitForMessage)}
          messageType="thank_you"
          visitId={selectedVisitForMessage.id}
          onClose={() => {
            setShowSendMessageModal(false);
            setSelectedVisitForMessage(null);
          }}
          onMessageSent={handleMessageSent}
        />
      )}
    </div>
  );
};

export default GMBReviewRequests;