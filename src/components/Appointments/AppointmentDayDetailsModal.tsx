import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, User, Phone, Plus } from 'lucide-react';
import { Appointment, Patient, Profile } from '../../types';
import { appointmentService } from '../../services/appointmentService';
import { patientService } from '../../services/patientService';
import { useAuth } from '../Auth/useAuth';
import { supabase } from '../../lib/supabase';
import { format, isSameDay } from 'date-fns';
import AppointmentCard from './AppointmentCard';
import AppointmentMessageModal from './AppointmentMessageModal';
import { toTitleCase } from '../../utils/stringUtils';

interface AppointmentDayDetailsModalProps {
  selectedDate: Date;
  onClose: () => void;
  onEditAppointment: (appointment: Appointment) => void;
  onNewAppointment: () => void;
}

const AppointmentDayDetailsModal: React.FC<AppointmentDayDetailsModalProps> = ({
  selectedDate,
  onClose,
  onEditAppointment,
  onNewAppointment
}) => {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSendMessageModal, setShowSendMessageModal] = useState(false);
  const [selectedAppointmentForMessage, setSelectedAppointmentForMessage] = useState<Appointment | null>(null);

  useEffect(() => {
    if (user && selectedDate) {
      loadDayAppointments();
    }
  }, [user, selectedDate]);

  const loadDayAppointments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get appointments for the selected date (start and end of day)
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      const dayAppointments = await appointmentService.getAppointmentsByDateRange(startOfDay, endOfDay);
      
      // Filter to only appointments on the exact selected date
      const filteredAppointments = dayAppointments.filter(appointment => 
        isSameDay(appointment.appointmentDate, selectedDate)
      );
      
      // Sort by appointment time
      filteredAppointments.sort((a, b) => 
        new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime()
      );
      
      setAppointments(filteredAppointments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
      console.error('Error loading day appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditAppointment = (appointment: Appointment) => {
    onEditAppointment(appointment);
    onClose(); // Close the day details modal when opening edit modal
  };

  const handleSendMessage = (appointment: Appointment) => {
    setSelectedAppointmentForMessage(appointment);
    setShowSendMessageModal(true);
  };

  const handleNewAppointmentForDate = () => {
    onNewAppointment();
    onClose(); // Close the day details modal when opening new appointment modal
  };

  if (!user) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-800">
                {format(selectedDate, 'EEEE, MMMM dd, yyyy')}
              </h2>
              <p className="text-sm text-gray-600">
                {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} scheduled
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewAppointmentForDate}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              New Appointment
            </button>
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading appointments...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-600 mb-4">{error}</div>
              <button
                onClick={loadDayAppointments}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : appointments.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-800 mb-2">No Appointments</h3>
              <p className="text-gray-600 mb-4">
                No appointments scheduled for {format(selectedDate, 'MMMM dd, yyyy')}
              </p>
              <button
                onClick={handleNewAppointmentForDate}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Schedule First Appointment
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Day Summary */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-600" />
                    <span className="font-medium text-blue-800">
                      {format(appointments[0].appointmentDate, 'h:mm a')} - {format(appointments[appointments.length - 1].appointmentDate, 'h:mm a')}
                    </span>
                  </div>
                  <div className="text-sm text-blue-600">
                    {appointments.length} total appointments
                  </div>
                </div>
              </div>

              {/* Appointments List */}
              <div className="space-y-3">
                {appointments.map(appointment => (
                  <div key={appointment.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <AppointmentCard
                      appointment={appointment}
                      onEdit={handleEditAppointment}
                      onSendMessage={handleSendMessage}
                      hideActions={false} // Show actions in detailed view
                      className="border-0 shadow-none p-0 hover:bg-transparent" // Remove card styling since we have outer container
                    />
                  </div>
                ))}
              </div>

              {/* Quick Stats */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 mb-3">Day Statistics</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Scheduled</p>
                    <p className="font-semibold text-blue-600">
                      {appointments.filter(a => a.status === 'Scheduled').length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Confirmed</p>
                    <p className="font-semibold text-green-600">
                      {appointments.filter(a => a.status === 'Confirmed').length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Completed</p>
                    <p className="font-semibold text-green-600">
                      {appointments.filter(a => a.status === 'Completed').length}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-600">Cancelled</p>
                    <p className="font-semibold text-red-600">
                      {appointments.filter(a => a.status === 'Cancelled').length}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Send Message Modal */}
      {showSendMessageModal && selectedAppointmentForMessage && (
        <AppointmentMessageModal
          appointment={selectedAppointmentForMessage}
          onClose={() => {
            setShowSendMessageModal(false);
            setSelectedAppointmentForMessage(null);
          }}
        />
      )}
    </div>
  );
};

export default AppointmentDayDetailsModal;