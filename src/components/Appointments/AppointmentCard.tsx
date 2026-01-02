import React from 'react';
import { Edit, MessageCircle, Phone, Calendar, User, Stethoscope, UserCheck, AlertTriangle, Heart, Clock, CheckCircle, XCircle, Activity, DoorOpen } from 'lucide-react';
import { Appointment } from '../../types';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';
import { getAppointmentStatusColor, getAppointmentStatusLabel } from '../../utils/appointmentUtils';

interface AppointmentCardProps {
  appointment: Appointment;
  onEdit: (appointment: Appointment) => void;
  onSendMessage: (appointment: Appointment) => void;
  onStatusChange?: (appointmentId: string, newStatus: Appointment['status']) => void;
  className?: string;
  hideActions?: boolean;
}

const getAppointmentTypeIcon = (appointmentType: Appointment['appointmentType']) => {
  switch (appointmentType) {
    case 'Consultation':
      return <Stethoscope className="w-3 h-3" />;
    case 'Follow_Up':
      return <UserCheck className="w-3 h-3" />;
    case 'Emergency':
      return <AlertTriangle className="w-3 h-3" />;
    case 'Routine_Checkup':
      return <Heart className="w-3 h-3" />;
    default:
      return <Calendar className="w-3 h-3" />;
  }
};

const getStatusIcon = (status: Appointment['status']) => {
  switch (status) {
    case 'Scheduled':
      return <Clock className="w-3 h-3" />;
    case 'Confirmed':
      return <UserCheck className="w-3 h-3" />;
    case 'Arrived':
      return <DoorOpen className="w-3 h-3" />;
    case 'In_Progress':
      return <Activity className="w-3 h-3" />;
    case 'Completed':
      return <CheckCircle className="w-3 h-3" />;
    case 'Cancelled':
      return <XCircle className="w-3 h-3" />;
    case 'No_Show':
      return <AlertTriangle className="w-3 h-3" />;
    default:
      return <Clock className="w-3 h-3" />;
  }
};



const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onEdit,
  onSendMessage,
  onStatusChange,
  className = '',
  hideActions = false
}) => {
  const [showStatusDropdown, setShowStatusDropdown] = React.useState(false);

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(appointment);
  };

  const handleSendMessage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSendMessage(appointment);
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onStatusChange) {
      setShowStatusDropdown(!showStatusDropdown);
    }
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newStatus = e.target.value as Appointment['status'];
    if (onStatusChange && newStatus !== appointment.status) {
      onStatusChange(appointment.id, newStatus);
    }
    setShowStatusDropdown(false);
  };

  return (
    <div className={`appointment-card ${className}`}>
      {/* Time and Status Row */}
      <div className="flex items-center justify-between mb-3">
        <span className="appointment-card-time">
          {format(appointment.appointmentDate, 'h:mm a')}
        </span>
        <div className="relative">
          {onStatusChange ? (
            <>
              <button
                onClick={handleStatusClick}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getAppointmentStatusColor(appointment.status)} hover:opacity-80 transition-opacity cursor-pointer`}
              >
                {getStatusIcon(appointment.status)}
                {getAppointmentStatusLabel(appointment.status)}
                <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showStatusDropdown && (
                <select
                  value={appointment.status}
                  onChange={handleStatusChange}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => setShowStatusDropdown(false)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="absolute top-full right-0 mt-1 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white shadow-lg z-10 min-w-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                >
                  <option value="Scheduled">Scheduled</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Arrived">Arrived</option>
                  <option value="In_Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="No_Show">No Show</option>
                </select>
              )}
            </>
          ) : (
            <span className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getAppointmentStatusColor(appointment.status)}`}>
              {getStatusIcon(appointment.status)}
              {getAppointmentStatusLabel(appointment.status)}
            </span>
          )}
        </div>
      </div>

      {/* Patient Information */}
      <div className="mb-3">
        <div className="appointment-card-patient mb-1">
          {toTitleCase(appointment.patient?.name || 'Unknown Patient')}
        </div>
        <div className="appointment-card-contact">
          <Phone className="w-3 h-3" />
          {appointment.patient?.phone || 'No phone'}
        </div>
      </div>

      {/* Appointment Type */}
      <div className="flex items-center gap-1 mb-3">
        {getAppointmentTypeIcon(appointment.appointmentType)}
        <span className="appointment-card-type">
          {appointment.appointmentType.replace('_', ' ').toLowerCase()}
        </span>
      </div>

      {/* Doctor Information (if available) */}
      {appointment.doctor && (
        <div className="flex items-center gap-1 mb-3 text-xs text-gray-500">
          <User className="w-3 h-3" />
          Dr. {toTitleCase(appointment.doctor.name)}
        </div>
      )}

      {/* Action Buttons - Only show if not hidden */}
      {!hideActions && (
        <div className="appointment-card-actions">
          <button
            onClick={handleEdit}
            className="appointment-edit-btn"
          >
            <Edit className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={handleSendMessage}
            className="appointment-send-btn"
          >
            <MessageCircle className="w-3 h-3" />
            Send
          </button>
        </div>
      )}

      {/* Notes Preview (if any) */}
      {appointment.notes && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 truncate" title={appointment.notes}>
            💬 {appointment.notes}
          </p>
        </div>
      )}
    </div>
  );
};

export default AppointmentCard;