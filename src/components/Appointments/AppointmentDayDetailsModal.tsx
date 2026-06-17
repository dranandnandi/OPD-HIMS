import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, User, Phone, Plus, Download } from 'lucide-react';
import { Appointment, Patient, Profile } from '../../types';
import { appointmentService } from '../../services/appointmentService';
import { patientService } from '../../services/patientService';
import { useAuth } from '../Auth/useAuth';
import { supabase } from '../../lib/supabase';
import { format, isSameDay } from 'date-fns';
import AppointmentCard from './AppointmentCard';
import AppointmentMessageModal from './AppointmentMessageModal';
import { toTitleCase } from '../../utils/stringUtils';

type ExcelCellValue = string | number | boolean | null | undefined;

const escapeXml = (value: ExcelCellValue) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const sanitizeWorksheetName = (value: string) =>
  value.replace(/[\\/*?:\[\]]/g, '').slice(0, 31) || 'Sheet';

const buildExcelCell = (value: ExcelCellValue, isHeader = false) => {
  const styleId = isHeader ? 'Header' : 'Default';
  const cellValue = value ?? '';

  if (typeof cellValue === 'number' && Number.isFinite(cellValue)) {
    return `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${cellValue}</Data></Cell>`;
  }

  if (typeof cellValue === 'boolean') {
    return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${cellValue ? 'Yes' : 'No'}</Data></Cell>`;
  }

  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${escapeXml(cellValue)}</Data></Cell>`;
};

const buildWorksheetXml = (name: string, rows: ExcelCellValue[][]) => `
  <Worksheet ss:Name="${escapeXml(sanitizeWorksheetName(name))}">
    <Table>
      ${rows
        .map((row, rowIndex) => `
          <Row>
            ${row.map((cell) => buildExcelCell(cell, rowIndex === 0)).join('')}
          </Row>
        `)
        .join('')}
    </Table>
  </Worksheet>
`;

const createExcelWorkbookXml = (worksheets: Array<{ name: string; rows: ExcelCellValue[][] }>) => `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default">
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
    </Style>
    <Style ss:ID="Header">
      <Font ss:Bold="1" />
      <Interior ss:Color="#DCEBFF" ss:Pattern="Solid" />
      <Alignment ss:Vertical="Top" ss:WrapText="1" />
    </Style>
  </Styles>
  ${worksheets.map((sheet) => buildWorksheetXml(sheet.name, sheet.rows)).join('')}
</Workbook>`;

const triggerExcelDownload = (filename: string, worksheets: Array<{ name: string; rows: ExcelCellValue[][] }>) => {
  const workbookXml = createExcelWorkbookXml(worksheets);
  const blob = new Blob([workbookXml], {
    type: 'application/vnd.ms-excel;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

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
  const [exportingExcel, setExportingExcel] = useState(false);
  const [showSendMessageModal, setShowSendMessageModal] = useState(false);
  const [selectedAppointmentForMessage, setSelectedAppointmentForMessage] = useState<Appointment | null>(null);
  const isAdminUser = !!user && (
    user.roleName?.toLowerCase() === 'admin' ||
    user.roleName?.toLowerCase() === 'super_admin' ||
    user.permissions?.includes('admin') ||
    user.permissions?.includes('all')
  );

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

  const handleDownloadExcel = async () => {
    if (!user || !isAdminUser) {
      return;
    }

    try {
      setExportingExcel(true);

      const scheduledCount = appointments.filter((appointment) => appointment.status === 'Scheduled').length;
      const confirmedCount = appointments.filter((appointment) => appointment.status === 'Confirmed').length;
      const completedCount = appointments.filter((appointment) => appointment.status === 'Completed').length;
      const cancelledCount = appointments.filter((appointment) => appointment.status === 'Cancelled').length;
      const noShowCount = appointments.filter((appointment) => appointment.status === 'No_Show').length;
      const arrivedCount = appointments.filter((appointment) => appointment.status === 'Arrived').length;
      const inProgressCount = appointments.filter((appointment) => appointment.status === 'In_Progress').length;

      const workbookSheets = [
        {
          name: 'Day Summary',
          rows: [
            ['Field', 'Value'],
            ['Date', format(selectedDate, 'dd-MMM-yyyy')],
            ['Day', format(selectedDate, 'EEEE')],
            ['Clinic User', user.name || user.email || ''],
            ['Total Appointments', appointments.length],
            ['First Slot', appointments[0] ? format(appointments[0].appointmentDate, 'hh:mm a') : ''],
            ['Last Slot', appointments.length > 0 ? format(appointments[appointments.length - 1].appointmentDate, 'hh:mm a') : ''],
            ['Scheduled', scheduledCount],
            ['Confirmed', confirmedCount],
            ['Arrived', arrivedCount],
            ['In Progress', inProgressCount],
            ['Completed', completedCount],
            ['Cancelled', cancelledCount],
            ['No Show', noShowCount]
          ]
        },
        {
          name: 'Appointments',
          rows: [
            ['Time', 'Patient Name', 'Phone', 'Doctor', 'Appointment Type', 'Duration (min)', 'Status', 'Waiting Condition', 'Notes', 'Patient ID', 'Appointment ID'],
            ...(appointments.length > 0
              ? appointments.map((appointment) => [
                  format(appointment.appointmentDate, 'hh:mm a'),
                  appointment.patient?.name || 'Unknown',
                  appointment.patient?.phone || '',
                  appointment.doctor?.name || 'Unassigned',
                  toTitleCase(appointment.appointmentType.replace(/_/g, ' ')),
                  appointment.duration,
                  toTitleCase(appointment.status.replace(/_/g, ' ')),
                  appointment.waitingConditionType || '',
                  appointment.notes || '',
                  appointment.patientId,
                  appointment.id
                ])
              : [['No appointments scheduled', '', '', '', '', '', '', '', '', '', '']])
          ]
        }
      ];

      triggerExcelDownload(`appointments_${format(selectedDate, 'dd-MMM-yyyy')}.xls`, workbookSheets);
    } catch (err) {
      console.error('Error exporting appointments Excel:', err);
      alert('Failed to export appointments Excel. Please try again.');
    } finally {
      setExportingExcel(false);
    }
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
            {isAdminUser && (
              <button
                onClick={handleDownloadExcel}
                disabled={exportingExcel}
                className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors text-sm disabled:bg-gray-400 disabled:cursor-not-allowed"
                title="Download appointments in Excel format"
              >
                <Download className="w-4 h-4" />
                {exportingExcel ? 'Preparing Excel...' : 'Download Excel'}
              </button>
            )}
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
