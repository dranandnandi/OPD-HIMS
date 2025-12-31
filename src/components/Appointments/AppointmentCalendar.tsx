import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, User, Phone, Edit, Trash2, Stethoscope, UserCheck, AlertTriangle, Heart, MessageCircle, Filter, ChevronLeft, ChevronRight, Activity, CheckCircle, XCircle } from 'lucide-react';
import { Appointment, Patient, Profile, AppointmentType } from '../../types';
import { appointmentService } from '../../services/appointmentService';
import { patientService } from '../../services/patientService';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { authService } from '../../services/authService';
import { useAuth } from '../Auth/useAuth';
import { supabase } from '../../lib/supabase';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks } from 'date-fns';
import PatientModal from '../Patients/PatientModal';
import AddVisitModal from '../Patients/AddVisitModal';
import AppointmentMessageModal from './AppointmentMessageModal';
import AppointmentCard from './AppointmentCard';
import { toTitleCase } from '../../utils/stringUtils';

const AppointmentCalendar: React.FC = () => {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showSendMessageModal, setShowSendMessageModal] = useState(false);
  const [selectedAppointmentForMessage, setSelectedAppointmentForMessage] = useState<Appointment | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | Appointment['status']>('all');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showDayDetailsModal, setShowDayDetailsModal] = useState(false);
  const [selectedDateForDetails, setSelectedDateForDetails] = useState<Date | null>(null);

  // 4-day calculation starting from current date
  const fourDayStart = new Date(currentWeek);
  fourDayStart.setHours(0, 0, 0, 0);
  const fourDayEnd = new Date(fourDayStart);
  fourDayEnd.setDate(fourDayStart.getDate() + 3);
  fourDayEnd.setHours(23, 59, 59, 999);
  const weekDays = eachDayOfInterval({ start: fourDayStart, end: fourDayEnd });

  useEffect(() => {
    if (user) {
      loadData();
      loadAppointmentTypes();
    }
  }, [user, currentWeek]);

  const loadAppointmentTypes = async () => {
    try {
      if (user?.clinicId) {
        const settings = await clinicSettingsService.getClinicSettings(user.clinicId);
        if (settings?.appointmentTypes && settings.appointmentTypes.length > 0) {
          setAppointmentTypes(settings.appointmentTypes);
        } else {
          // Default appointment types if not configured
          setAppointmentTypes([
            { id: 'consultation', label: 'Consultation', duration: 30, color: '#3B82F6', fee: 300 },
            { id: 'followup', label: 'Follow-up', duration: 20, color: '#10B981', fee: 200 },
            { id: 'emergency', label: 'Emergency', duration: 15, color: '#EF4444', fee: 800 },
            { id: 'procedure', label: 'Procedure', duration: 60, color: '#8B5CF6', fee: 500 }
          ]);
        }
      }
    } catch (err) {
      console.error('Error loading appointment types:', err);
      // Use defaults on error
      setAppointmentTypes([
        { id: 'consultation', label: 'Consultation', duration: 30, color: '#3B82F6', fee: 300 },
        { id: 'followup', label: 'Follow-up', duration: 20, color: '#10B981', fee: 200 },
        { id: 'emergency', label: 'Emergency', duration: 15, color: '#EF4444', fee: 800 },
        { id: 'procedure', label: 'Procedure', duration: 60, color: '#8B5CF6', fee: 500 }
      ]);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [appointmentsData, patientsData] = await Promise.all([
        appointmentService.getAppointmentsByDateRange(fourDayStart, fourDayEnd),
        patientService.getPatients()
      ]);

      setAppointments(appointmentsData);
      setPatients(patientsData);

      // Load doctors using authService to ensure clinic filtering
      try {
        const doctorsData = await authService.getDoctors();
        setDoctors(doctorsData);
      } catch (doctorLoadError) {
        console.error('Failed to load doctors:', doctorLoadError);
        setDoctors([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments');
      console.error('Error loading appointments:', err);
    } finally {
      setLoading(false);
    }
  };

  const getAppointmentsForDay = (date: Date) => {
    return appointments.filter(appointment => {
      const matchesDate = isSameDay(appointment.appointmentDate, date);
      const matchesStatus = statusFilter === 'all' || appointment.status === statusFilter;
      const matchesDoctor = !doctorFilter || appointment.doctorId === doctorFilter;
      return matchesDate && matchesStatus && matchesDoctor;
    });
  };

  const handlePreviousWeek = () => {
    const newDate = new Date(currentWeek);
    newDate.setDate(newDate.getDate() - 3);
    setCurrentWeek(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(currentWeek);
    newDate.setDate(newDate.getDate() + 4);
    setCurrentWeek(newDate);
  };

  const handleNewAppointment = () => {
    setSelectedAppointment(null);
    setShowModal(true);
  };

  const handleEditAppointment = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setShowModal(true);
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (!confirm('Are you sure you want to delete this appointment?')) return;

    try {
      await appointmentService.deleteAppointment(appointmentId);
      setAppointments(appointments.filter(a => a.id !== appointmentId));
    } catch (err) {
      console.error('Error deleting appointment:', err);
      alert('Failed to delete appointment');
    }
  };

  const handleSendMessage = (appointment: Appointment) => {
    setSelectedAppointmentForMessage(appointment);
    setShowSendMessageModal(true);
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setDoctorFilter('');
  };

  const getStatusColor = (status: Appointment['status']) => {
    return `status-${status.toLowerCase().replace('_', '-')}`;
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to view appointments.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading appointments...</p>
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
    <div className="space-y-6">
      {/* Enhanced Header with Filters */}
      <div className="calendar-nav">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Appointments</h2>
            <p className="text-sm text-gray-600 mt-1">Manage patient appointments and schedules</p>
          </div>

          {/* Desktop Filters */}
          <div className="hidden lg:flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-button text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="Scheduled">Scheduled</option>
                <option value="Confirmed">Confirmed</option>
                <option value="In_Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="No_Show">No Show</option>
              </select>
            </div>

            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-button text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Doctors</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  Dr. {toTitleCase(doctor.name)}
                </option>
              ))}
            </select>

            {(statusFilter !== 'all' || doctorFilter) && (
              <button
                onClick={clearFilters}
                className="px-3 py-2 text-gray-600 hover:text-gray-800 text-sm"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Desktop New Appointment Button */}
          <button
            onClick={handleNewAppointment}
            className="hidden lg:flex items-center gap-2 bg-primary-500 text-white px-6 py-3 rounded-button hover:bg-primary-600 transition-all duration-200 shadow-md hover:shadow-lg font-medium"
          >
            <Plus className="w-4 h-4" />
            New Appointment
          </button>
        </div>
      </div>

      {/* Enhanced Week Navigation */}
      <div className="calendar-nav">
        <div className="flex items-center justify-between">
          <button
            onClick={handlePreviousWeek}
            className="calendar-nav-button flex items-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <div className="text-center">
            <h3 className="calendar-nav-title">
              {format(fourDayStart, 'MMM dd')} - {format(fourDayEnd, 'MMM dd, yyyy')}
            </h3>
            <p className="text-sm text-gray-600 mt-1">4-Day View</p>
          </div>

          <button
            onClick={handleNextWeek}
            className="calendar-nav-button flex items-center gap-2"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Filters */}
        <div className="lg:hidden mt-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-button text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Confirmed">Confirmed</option>
              <option value="In_Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="No_Show">No Show</option>
            </select>

            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-button text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Doctors</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  Dr. {toTitleCase(doctor.name)}
                </option>
              ))}
            </select>
          </div>

          {(statusFilter !== 'all' || doctorFilter) && (
            <button
              onClick={clearFilters}
              className="mt-2 px-3 py-2 text-gray-600 hover:text-gray-800 text-sm"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Enhanced Calendar Grid */}
      <div className="grid grid-cols-4 gap-0 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-md">
        {/* Week Day Headers */}
        <div className="contents">
          {weekDays.map(day => (
            <div key={`header-${day.toISOString()}`} className="week-day-header">
              <div className="week-day-date">
                <div className="week-day-name">
                  {format(day, 'EEE')}
                </div>
                <div className="week-day-number">
                  {format(day, 'd')}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Week Day Content */}
        <div className="contents">
          {weekDays.map(day => (
            <div
              key={`content-${day.toISOString()}`}
              className="p-2 md:p-4 border-r border-gray-200 last:border-r-0 min-h-[250px] md:min-h-[300px] bg-white hover:bg-blue-50 cursor-pointer transition-colors"
              onClick={() => {
                setSelectedDateForDetails(day);
                setShowDayDetailsModal(true);
              }}
            >
              <div className="space-y-1 md:space-y-2">
                {getAppointmentsForDay(day).map(appointment => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment}
                    onEdit={handleEditAppointment}
                    onSendMessage={handleSendMessage}
                    hideActions={true}
                    className="text-xs md:text-sm"
                  />
                ))}

                {/* Empty state for days with no appointments */}
                {getAppointmentsForDay(day).length === 0 && (
                  <div className="text-center py-4 md:py-8 text-gray-400">
                    <Calendar className="w-6 h-6 md:w-8 md:h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Click to add</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile FAB */}
      <button
        onClick={handleNewAppointment}
        className="lg:hidden fab"
        aria-label="Add new appointment"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Appointment Modal */}
      {showModal && (
        <AppointmentModal
          appointment={selectedAppointment}
          patients={patients}
          doctors={doctors}
          appointmentTypes={appointmentTypes}
          onSave={(appointmentData) => {
            // Handle save logic here
            setShowModal(false);
            loadData(); // Reload data
          }}
          onPatientAdded={loadData}
          onClose={() => setShowModal(false)}
        />
      )}

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

      {/* Day Details Modal */}
      {showDayDetailsModal && selectedDateForDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <AppointmentDayDetailsModal
            selectedDate={selectedDateForDetails}
            onClose={() => {
              setShowDayDetailsModal(false);
              setSelectedDateForDetails(null);
            }}
            onEditAppointment={(appointment) => {
              setShowDayDetailsModal(false);
              setSelectedDateForDetails(null);
              handleEditAppointment(appointment);
            }}
            onNewAppointment={() => {
              setShowDayDetailsModal(false);
              setSelectedDateForDetails(null);
              handleNewAppointment();
            }}
          />
        </div>
      )}
    </div>
  );
};

// Import the missing component
import AppointmentDayDetailsModal from './AppointmentDayDetailsModal';

// Appointment Modal Component (keeping existing implementation)
interface AppointmentModalProps {
  appointment: Appointment | null;
  patients: Patient[];
  doctors: Profile[];
  appointmentTypes: AppointmentType[];
  onSave: (appointment: any) => void;
  onPatientAdded: () => void;
  onClose: () => void;
}

const AppointmentModal: React.FC<AppointmentModalProps> = ({
  appointment,
  patients,
  doctors,
  appointmentTypes,
  onSave,
  onPatientAdded,
  onClose
}) => {
  const { user } = useAuth();
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [showAddVisitModal, setShowAddVisitModal] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [showPatientSearchResults, setShowPatientSearchResults] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    appointment ? patients.find(p => p.id === appointment.patientId) || null : null
  );

  // Generate time slots starting from 9:00 AM
  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 9; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const displayTime = new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        slots.push({ value: timeString, display: displayTime });
      }
    }
    // Add early morning slots (12:00 AM to 8:45 AM)
    for (let hour = 0; hour < 9; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const displayTime = new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        slots.push({ value: timeString, display: displayTime });
      }
    }
    return slots;
  };

  const timeSlots = generateTimeSlots();

  // Extract date and time from appointment if editing
  const getInitialDateTime = () => {
    if (appointment) {
      const date = new Date(appointment.appointmentDate);
      return {
        date: format(date, 'yyyy-MM-dd'),
        time: format(date, 'HH:mm')
      };
    }
    return {
      date: '',
      time: '09:00'
    };
  };

  const initialDateTime = getInitialDateTime();

  // Get default appointment type from available types
  const getDefaultAppointmentType = () => {
    if (appointment?.appointmentType) return appointment.appointmentType;
    if (appointmentTypes.length > 0) return appointmentTypes[0].label as Appointment['appointmentType'];
    return 'Consultation' as Appointment['appointmentType'];
  };

  const [formData, setFormData] = useState({
    patientId: selectedPatient?.id || '',
    doctorId: appointment?.doctorId || user?.id || '',
    selectedDate: initialDateTime.date,
    selectedTime: initialDateTime.time,
    duration: appointment?.duration || 30,
    appointmentType: getDefaultAppointmentType(),
    status: appointment?.status || 'Scheduled' as Appointment['status'],
    notes: appointment?.notes || ''
  });
  const [saving, setSaving] = useState(false);

  // Filter patients based on search term
  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(patientSearchTerm.toLowerCase()) ||
    patient.phone.includes(patientSearchTerm)
  ).slice(0, 10); // Limit to 10 results for performance

  const handlePatientSearch = (searchTerm: string) => {
    setPatientSearchTerm(searchTerm);
    setShowPatientSearchResults(searchTerm.length > 0);
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setFormData({ ...formData, patientId: patient.id });
    setPatientSearchTerm('');
    setShowPatientSearchResults(false);
  };

  const clearPatientSelection = () => {
    setSelectedPatient(null);
    setFormData({ ...formData, patientId: '' });
    setPatientSearchTerm('');
    setShowPatientSearchResults(false);
  };

  const handleSaveNewPatient = async (patientData: Omit<Patient, 'id' | 'createdAt' | 'lastVisit'>) => {
    try {
      const newPatient = await patientService.addPatient(patientData);
      setSelectedPatient(newPatient);
      setFormData({ ...formData, patientId: newPatient.id });
      setShowNewPatientModal(false);
      onPatientAdded(); // Refresh patient list in parent component
    } catch (error) {
      console.error('Error adding patient:', error);
      throw error; // Re-throw to let PatientModal handle it
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      // Combine date and time into a single Date object
      const appointmentDateTime = new Date(`${formData.selectedDate}T${formData.selectedTime}`);

      const appointmentData = {
        patientId: formData.patientId,
        doctorId: formData.doctorId,
        appointmentDate: appointmentDateTime,
        duration: formData.duration,
        appointmentType: formData.appointmentType,
        status: formData.status,
        notes: formData.notes
      };

      if (appointment) {
        await appointmentService.updateAppointment(appointment.id, appointmentData);
      } else {
        await appointmentService.addAppointment(appointmentData);
      }

      onSave(appointmentData);
    } catch (error) {
      console.error('Error saving appointment:', error);
      alert('Failed to save appointment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-bold">
            {appointment ? 'Edit Appointment' : 'New Appointment'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            ×
          </button>
        </div>


        {/* New Patient Modal */}
        {showNewPatientModal && (
          <PatientModal
            patient={null}
            onSave={handleSaveNewPatient}
            onClose={() => setShowNewPatientModal(false)}
          />
        )}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">
                Patient *
              </label>
              <button
                type="button"
                onClick={() => setShowNewPatientModal(true)}
                className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
              >
                <Plus className="w-3 h-3" />
                Add New Patient
              </button>
            </div>

            {/* Selected Patient Display */}
            {selectedPatient ? (
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium text-blue-800">{toTitleCase(selectedPatient.name)}</p>
                    <p className="text-sm text-blue-600">{selectedPatient.phone} • {selectedPatient.age} years</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearPatientSelection}
                  className="text-blue-600 hover:text-blue-700 text-sm"
                >
                  Change
                </button>
              </div>
            ) : (
              /* Patient Search */
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search patients by name or phone..."
                  value={patientSearchTerm}
                  onChange={(e) => handlePatientSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required={!selectedPatient}
                />

                {/* Search Results */}
                {showPatientSearchResults && filteredPatients.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredPatients.map(patient => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => handlePatientSelect(patient)}
                        className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium">{toTitleCase(patient.name)}</div>
                        <div className="text-sm text-gray-600">{patient.phone} • {patient.age} years</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No Results */}
                {showPatientSearchResults && patientSearchTerm && filteredPatients.length === 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                    <div className="text-center text-gray-500">No patients found</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Doctor *
            </label>
            <select
              required
              value={formData.doctorId}
              onChange={(e) => setFormData({ ...formData, doctorId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select a doctor</option>
              {doctors.map(doctor => (
                <option key={doctor.id} value={doctor.id}>
                  Dr. {toTitleCase(doctor?.name || 'Unknown Doctor')} {doctor.specialization && `- ${doctor.specialization}`}
                </option>
              ))}
            </select>
            {doctors.length === 0 && (
              <p className="text-xs text-orange-600 mt-1">
                No doctors available for consultation. Please ensure doctors have "Open for Consultation" enabled in their profiles.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date *
              </label>
              <input
                type="date"
                required
                value={formData.selectedDate}
                onChange={(e) => setFormData({ ...formData, selectedDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Time *
              </label>
              <select
                required
                value={formData.selectedTime}
                onChange={(e) => setFormData({ ...formData, selectedTime: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select time</option>
                {timeSlots.map(slot => (
                  <option key={slot.value} value={slot.value}>
                    {slot.display}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Duration (minutes)
            </label>
            <input
              type="number"
              value={formData.duration}
              onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              value={formData.appointmentType}
              onChange={(e) => {
                const selectedType = appointmentTypes.find(t => t.label === e.target.value);
                setFormData({
                  ...formData,
                  appointmentType: e.target.value as Appointment['appointmentType'],
                  duration: selectedType?.duration || formData.duration
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {appointmentTypes && appointmentTypes.length > 0 ? (
                appointmentTypes.map(type => (
                  <option key={type.id} value={type.label}>{type.label}</option>
                ))
              ) : (
                <option value="Consultation">Consultation</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as Appointment['status'] })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Scheduled">Scheduled</option>
              <option value="Confirmed">Confirmed</option>
              <option value="In_Progress">In Progress</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
              <option value="No_Show">No Show</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            {appointment && formData.status === 'Completed' && selectedPatient && (
              <button
                type="button"
                onClick={() => setShowAddVisitModal(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Add Visit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : appointment ? 'Update' : 'Create'}
            </button>
          </div>
        </form>

        {/* Add Visit Modal */}
        {showAddVisitModal && selectedPatient && (
          <AddVisitModal
            patient={selectedPatient}
            onSave={() => setShowAddVisitModal(false)}
            onClose={() => setShowAddVisitModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default AppointmentCalendar;