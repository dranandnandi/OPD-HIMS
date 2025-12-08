import React from 'react';
import { Edit, MessageCircle, Phone, Calendar, User, Stethoscope, UserCheck, AlertTriangle, Heart, Clock, CheckCircle, XCircle, Activity } from 'lucide-react';
import { Appointment } from '../../types';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';

interface AppointmentCardProps {
  appointment: Appointment;
  onEdit: (appointment: Appointment) => void;
  onSendMessage: (appointment: Appointment) => void;
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

const getStatusClass = (status: Appointment['status']) => {
  switch (status) {
    case 'Scheduled':
      return 'status-scheduled';
    case 'Confirmed':
      return 'status-confirmed';
    case 'In_Progress':
      return 'status-in-progress';
    case 'Completed':
      return 'status-completed';
    case 'Cancelled':
      return 'status-cancelled';
    case 'No_Show':
      return 'status-no-show';
    default:
      return 'status-scheduled';
  }
};

const AppointmentCard: React.FC<AppointmentCardProps> = ({
  appointment,
  onEdit,
  onSendMessage,
  className = '',
  hideActions = false
}) => {
  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(appointment);
  };

  const handleSendMessage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSendMessage(appointment);
  };

  return (
    <div className={`appointment-card ${className}`}>
      {/* Time and Status Row */}
      <div className="flex items-center justify-between mb-3">
        <span className="appointment-card-time">
          {format(appointment.appointmentDate, 'h:mm a')}
        </span>
        <span className={getStatusClass(appointment.status)}>
          {getStatusIcon(appointment.status)}
          {appointment.status.replace('_', ' ')}
        </span>
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