import React, { useState, useEffect } from 'react';
import { X, MessageCircle, Send, Phone, MapPin, User, Calendar, Clock, Zap, AlertCircle, CheckCircle } from 'lucide-react';
import { Appointment, ClinicSetting, Profile } from '../../types';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { authService } from '../../services/authService';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';
import { WhatsAppAPI } from '../../services/whatsappApi';
import { useAuth } from '../Auth/useAuth';
import { formatPhoneForWhatsApp } from '../../utils/phoneUtils';

interface AppointmentMessageModalProps {
  appointment: Appointment;
  onClose: () => void;
}

const AppointmentMessageModal: React.FC<AppointmentMessageModalProps> = ({ appointment, onClose }) => {
  const { user } = useAuth();
  const [clinicSettings, setClinicSettings] = useState<ClinicSetting | null>(null);
  const [doctor, setDoctor] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingManually, setSendingManually] = useState(false);
  const [sendingDirectly, setSendingDirectly] = useState(false);
  const [message, setMessage] = useState('');
  const [editableMessage, setEditableMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);

  useEffect(() => {
    loadData();
    checkWhatsAppConnection();
  }, [appointment, user?.id, user?.clinicId]);

  const checkWhatsAppConnection = async () => {
    if (!user?.id || !user?.clinicId) {
      setCheckingConnection(false);
      return;
    }

    try {
      const whatsappApi = new WhatsAppAPI();
      
      const status = await whatsappApi.getStatus({}, {
        userId: user.id,
        clinicId: user.clinicId
      });
      setWhatsappConnected(status.connected || false);
    } catch (err) {
      console.error('Error checking WhatsApp connection:', err);
      setWhatsappConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Load clinic settings and doctor details
      const [clinicData, doctorData] = await Promise.all([
        clinicSettingsService.getOrCreateClinicSettings(),
        authService.getUsers().then(users => users.find(u => u.id === appointment.doctorId))
      ]);
      
      setClinicSettings(clinicData);
      setDoctor(doctorData || null);
      
      // Generate message
      generateMessage(clinicData, doctorData || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointment data');
      console.error('Error loading appointment data:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateMessage = (clinic: ClinicSetting, doctorInfo: Profile | null) => {
    if (!appointment.patient) return;

    const formattedDateTime = format(appointment.appointmentDate, 'PPp'); // e.g., "Jan 20, 2025 at 10:30 AM"
    
    const messageTemplate = `Hello ${appointment.patient.name},

Your appointment has been scheduled with ${clinic.clinicName} for ${formattedDateTime}.

Doctor Details:
Name: ${toTitleCase(doctorInfo?.name || 'Not specified')}
Contact: ${doctorInfo?.phone || clinic.phone}

Patient Details:
📍 Address: ${appointment.patient.address}
📞 Contact: ${appointment.patient.phone}

Please arrive 15 minutes before your scheduled time. If you need to reschedule, kindly let us know in advance.

Best regards,
Team ${clinic.clinicName}`;

    setMessage(messageTemplate);
    setEditableMessage(messageTemplate);
  };

  const handleSendManually = async () => {
    if (!appointment.patient) return;

    setSendingManually(true);
    setError(null);
    
    try {
      // Format phone number using utility function
      const phoneNumber = formatPhoneForWhatsApp(appointment.patient.phone);
      
      const encodedMessage = encodeURIComponent(editableMessage);
      
      // Detect if mobile device
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const baseUrl = isMobile ? 'whatsapp://send' : 'https://web.whatsapp.com/send';
      
      // Construct WhatsApp URL based on device type
      const whatsappUrl = `${baseUrl}?phone=${phoneNumber}&text=${encodedMessage}`;
      
      // Try to open WhatsApp with better error handling
      const newWindow = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      
      // Check if popup was blocked
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // Fallback: try direct navigation
        window.location.href = whatsappUrl;
      }
      
      setSuccess('WhatsApp opened successfully! Please send the message from WhatsApp.');
    } catch (err) {
      setError('Failed to open WhatsApp. Please check if WhatsApp is installed on your device.');
      console.error('Error opening WhatsApp:', err);
    } finally {
      setSendingManually(false);
    }
  };

  const handleSendDirectly = async () => {
    if (!appointment.patient || !user?.id || !user?.clinicId) return;

    setSendingDirectly(true);
    setError(null);
    
    try {
      const whatsappApi = new WhatsAppAPI();

      // Format phone number using utility function
      const phoneNumber = formatPhoneForWhatsApp(appointment.patient.phone);

      await whatsappApi.sendMessage({
        phone: phoneNumber,
        message: editableMessage,
        metadata: {
          appointmentId: appointment.id,
          patientId: appointment.patient.id,
          type: 'appointment_confirmation'
        }
      }, {
        userId: user.id,
        clinicId: user.clinicId
      });
      
      setSuccess('Message sent successfully via WhatsApp!');
      
      // Optional: Update appointment status in database
      // await appointmentService.updateAppointment(appointment.id, { status: 'Confirmed' });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message via WhatsApp');
      console.error('Error sending message via WhatsApp:', err);
    } finally {
      setSendingDirectly(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading appointment details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">Send Appointment Confirmation</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-red-700">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-green-700">{success}</p>
            </div>
          )}

          {/* Patient & Appointment Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-800 mb-4">Patient & Appointment Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Patient Name</p>
                  <p className="font-medium text-blue-800">{toTitleCase(appointment.patient?.name || 'Unknown')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Contact Number</p>
                  <p className="font-medium text-blue-800">{appointment.patient?.phone || 'Not provided'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Appointment Date & Time</p>
                  <p className="font-medium text-blue-800">{format(appointment.appointmentDate, 'PPp')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Doctor Name</p>
                  <p className="font-medium text-blue-800">{toTitleCase(doctor?.name || appointment.doctor?.name || 'Not assigned')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 md:col-span-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <div>
                  <p className="text-sm text-blue-600">Patient Address</p>
                  <p className="font-medium text-blue-800">{appointment.patient?.address || 'Not provided'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Clinic Information */}
          {clinicSettings && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-4">Clinic Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Clinic Name</p>
                  <p className="font-medium text-gray-800">{clinicSettings.clinicName}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Clinic Phone</p>
                  <p className="font-medium text-gray-800">{clinicSettings.phone}</p>
                </div>
              </div>
            </div>
          )}

          {/* Message Preview */}
          <div>
            <h3 className="font-medium text-gray-800 mb-2">Message Preview (Editable)</h3>
            <textarea
              value={editableMessage}
              onChange={(e) => setEditableMessage(e.target.value)}
              rows={12}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono resize-none"
              placeholder="Edit the message content as needed..."
            />
            <p className="text-xs text-gray-600 mt-1">
              You can edit this message before sending. Changes will be applied to the message that gets sent.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSendManually}
              disabled={sendingManually || !appointment.patient?.phone}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {sendingManually ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <MessageCircle className="w-5 h-5" />
              )}
              {sendingManually ? 'Opening WhatsApp...' : 'Send Manually'}
            </button>

            <button
              onClick={handleSendDirectly}
              disabled={sendingDirectly || checkingConnection || !whatsappConnected || !appointment.patient?.phone}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              title={!whatsappConnected ? 'WhatsApp not connected. Please connect WhatsApp in Settings.' : ''}
            >
              {sendingDirectly ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <Zap className="w-5 h-5" />
              )}
              {sendingDirectly ? 'Sending...' : 'Send Directly'}
            </button>
          </div>

          {/* WhatsApp Connection Notice */}
          {!checkingConnection && !whatsappConnected && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <p className="text-yellow-800 font-medium">WhatsApp Not Connected</p>
                  <p className="text-yellow-700 text-sm mt-1">
                    To use direct sending, please connect your WhatsApp account in Settings → WhatsApp Integration.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppointmentMessageModal;