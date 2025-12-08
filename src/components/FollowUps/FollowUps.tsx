import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Phone, MessageCircle, CheckCircle, AlertCircle, Search, Send, Heart, User, Activity, TrendingUp } from 'lucide-react';
import { Visit } from '../../types';
import { visitService } from '../../services/visitService';
import { reviewService } from '../../services/reviewService';
import { useAuth } from '../Auth/useAuth';
import { format, isToday, isTomorrow, isPast, isFuture, addDays, startOfDay, endOfDay } from 'date-fns';
import SendMessageModal from './SendMessageModal';
import { toTitleCase } from '../../utils/stringUtils';

const FollowUps: React.FC = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [messagesSentStatus, setMessagesSentStatus] = useState<{ [visitId: string]: { followUpSent: boolean; thankYouSent: boolean } }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSendMessageModal, setShowSendMessageModal] = useState(false);
  const [selectedVisitForMessage, setSelectedVisitForMessage] = useState<Visit | null>(null);
  const [messageType, setMessageType] = useState<'follow_up' | 'thank_you'>('follow_up');
  const [activeTab, setActiveTab] = useState<'today' | 'thank_you' | 'overdue' | 'upcoming'>('today');

  useEffect(() => {
    if (user) {
      loadFollowUps();
    }
  }, [user]);

  const loadFollowUps = async () => {
    try {
      setLoading(true);
      setError(null);
      const followUpVisits = await visitService.getVisitsWithFollowUps();
      setVisits(followUpVisits);
      
      // Load message sent status for each visit
      const statusPromises = followUpVisits.map(async (visit) => {
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
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
      console.error('Error loading follow-ups:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = (visit: Visit, type: 'follow_up' | 'thank_you') => {
    setSelectedVisitForMessage(visit);
    setMessageType(type);
    setShowSendMessageModal(true);
  };

  const handleMessageSent = () => {
    setShowSendMessageModal(false);
    setSelectedVisitForMessage(null);
    loadFollowUps(); // Reload to update sent status
  };

  const handleMessageSentWithDetails = (visitId: string, messageType: 'follow_up' | 'thank_you') => {
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

  const getFilteredVisits = (filterType: string) => {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const dayAfterTomorrow = addDays(today, 2);
    const threeDaysFromNow = addDays(today, 3);

    return visits.filter(visit => {
      if (!visit.patient || !visit.followUpDate) return false;
      
      const matchesSearch = visit.patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           visit.patient.phone.includes(searchTerm);
      
      if (!matchesSearch) return false;

      const messageSentStatus = messagesSentStatus[visit.id] || { followUpSent: false, thankYouSent: false };
      switch (filterType) {
        case 'today':
          return isToday(visit.followUpDate) || isTomorrow(visit.followUpDate);
        case 'overdue':
          return isPast(visit.followUpDate) && !isToday(visit.followUpDate) && !messageSentStatus.followUpSent;
        case 'upcoming':
          return (
            (isToday(tomorrow) && isToday(visit.followUpDate)) ||
            (isToday(dayAfterTomorrow) && isToday(visit.followUpDate)) ||
            (visit.followUpDate >= startOfDay(tomorrow) && visit.followUpDate <= endOfDay(threeDaysFromNow))
          );
        default:
          return true;
      }
    });
  };

  const getDailySummary = () => {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    const threeDaysFromNow = addDays(today, 3);

    return {
      followUpsToday: visits.filter(v => v.followUpDate && (isToday(v.followUpDate) || isTomorrow(v.followUpDate))).length,
      overdue: visits.filter(v => {
        const status = messagesSentStatus[v.id] || { followUpSent: false, thankYouSent: false };
        return v.followUpDate && isPast(v.followUpDate) && !isToday(v.followUpDate) && !status.followUpSent;
      }).length,
      tomorrowFollowUps: visits.filter(v => v.followUpDate && v.followUpDate >= startOfDay(tomorrow) && v.followUpDate <= endOfDay(threeDaysFromNow)).length
    };
  };

  const tabs = [
    { id: 'today', label: 'Follow-ups Due Today & Tomorrow', icon: Calendar },
    { id: 'overdue', label: 'Overdue Follow-ups', icon: AlertCircle },
    { id: 'upcoming', label: 'Upcoming (Next 3 Days)', icon: Clock }
  ];

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view follow-ups.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading follow-ups...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadFollowUps}
          className="btn-figma-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  const summary = getDailySummary();
  const filteredVisits = getFilteredVisits(activeTab);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-ups Dashboard</h1>
          <p className="text-gray-600 mt-1">Manage patient follow-ups and thank you messages</p>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search patients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-80"
          />
        </div>
      </div>

      {/* Daily Workflow Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Follow-Ups Today</p>
              <p className="text-2xl font-bold text-blue-600">{summary.followUpsToday}</p>
            </div>
            <Calendar className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Overdue</p>
              <p className="text-2xl font-bold text-red-600">{summary.overdue}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
        </div>

        <div className="card-standard p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Next 3 Days</p>
              <p className="text-2xl font-bold text-green-600">{summary.tomorrowFollowUps}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
        </div>
      </div>

      {/* Today's Tasks Section */}
      <div className="card-standard overflow-hidden">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'today' && summary.followUpsToday > 0 && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                    {summary.followUpsToday}
                  </span>
                )}
                {tab.id === 'overdue' && summary.overdue > 0 && (
                  <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                    {summary.overdue}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Table Content */}
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
                    Date
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  Reason
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Contact
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
              {filteredVisits.map((visit, index) => {
                if (!visit.patient || !visit.followUpDate) return null;
                
                const messageSentStatus = messagesSentStatus[visit.id] || { followUpSent: false, thankYouSent: false };
                const isOverdue = isPast(visit.followUpDate) && !isToday(visit.followUpDate);
                
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
                        {activeTab === 'thank_you' 
                          ? format(visit.date, 'MMM dd, yyyy')
                          : format(visit.followUpDate, 'MMM dd, yyyy')
                        }
                      </div>
                      <div className="text-xs text-gray-500">
                        {activeTab === 'thank_you' 
                          ? format(visit.date, 'h:mm a')
                          : format(visit.followUpDate, 'h:mm a')
                        }
                      </div>
                      {activeTab === 'thank_you' && (
                        <div className="text-xs text-blue-600 mt-1">
                          Visit Date
                        </div>
                      )}
                      {isOverdue && (
                        <div className="text-xs text-red-600 mt-1">
                          Overdue
                        </div>
                      )}
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-gray-900 max-w-xs truncate">
                        {visit.chiefComplaint || 'General consultation'}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-gray-900 font-medium">{visit.patient.phone}</div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {/* Follow-up Status - Show if visit has follow-up date */}
                        {visit.followUpDate && (
                          <span className={`status-chip text-xs ${
                            messageSentStatus.followUpSent 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            <CheckCircle className="w-3 h-3" />
                            Follow-Up {messageSentStatus.followUpSent ? 'Sent' : 'Pending'}
                          </span>
                        )}
                        
                        {/* No Actions Required - Show if no follow-up date and not today's visit */}
                        {!visit.followUpDate && (
                          <span className="status-chip bg-gray-100 text-gray-600 text-xs">
                            <CheckCircle className="w-3 h-3" />
                            No Actions Required
                          </span>
                        )}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {messageSentStatus.followUpSent ? (
                          <span className="flex items-center gap-1 text-green-600 text-sm">
                            <CheckCircle className="w-4 h-4" />
                            Follow-Up Sent
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSendMessage(visit, 'follow_up')}
                            className="btn-figma-success text-sm"
                          >
                            <Send className="w-4 h-4 inline mr-1" />
                            Send Follow-Up
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
            <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchTerm 
                ? 'No follow-ups found matching your search' 
                : `No ${activeTab === 'today' ? 'follow-ups due today' : activeTab.replace('_', ' ')} found`
              }
            </p>
          </div>
        )}
      </div>

      {/* Send Message Modal */}
      {showSendMessageModal && selectedVisitForMessage && (
        <SendMessageModal
          review={reviewService.visitToReview(selectedVisitForMessage)}
          followUpDate={selectedVisitForMessage.followUpDate?.toISOString()}
          messageType={messageType}
          visitId={selectedVisitForMessage.id}
          onClose={() => {
            setShowSendMessageModal(false);
            setSelectedVisitForMessage(null);
          }}
          onMessageSent={handleMessageSentWithDetails}
        />
      )}
    </div>
  );
};

export default FollowUps;