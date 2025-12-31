import React, { useState, useEffect } from 'react';
import { Save, Building, Clock, IndianRupee, Plus, Trash2, FileText, MessageSquare } from 'lucide-react';
import { ClinicSetting, AppointmentType } from '../../types';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { useAuth } from '../Auth/useAuth';

const ClinicSettings: React.FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ClinicSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    clinicName: '',
    address: '',
    phone: '',
    email: '',
    website: '',
    registrationNumber: '',
    taxId: '',
    consultationFee: 300,
    followUpFee: 200,
    emergencyFee: 500,
    appointmentDuration: 30,
    currency: 'INR',
    timezone: 'Asia/Kolkata'
  });

  const [workingHours, setWorkingHours] = useState({
    monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    tuesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    wednesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    thursday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    friday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    saturday: { isOpen: true, startTime: '09:00', endTime: '14:00' },
    sunday: { isOpen: false, startTime: '09:00', endTime: '18:00' }
  });

  const [frequencies, setFrequencies] = useState<Array<{ code: string, label: string, timesPerDay: number | null }>>([
    { code: 'OD', label: 'OD (Once daily)', timesPerDay: 1 },
    { code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2 },
    { code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3 },
    { code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4 },
    { code: 'PRN', label: 'PRN (As needed)', timesPerDay: null }
  ]);

  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([
    { id: 'consultation', label: 'Consultation', duration: 30, color: '#3B82F6', feeType: 'consultation' },
    { id: 'followup', label: 'Follow-up', duration: 20, color: '#10B981', feeType: 'followup' },
    { id: 'emergency', label: 'Emergency', duration: 15, color: '#EF4444', feeType: 'emergency' },
    { id: 'homevisit', label: 'Home Visit', duration: 45, color: '#F59E0B', feeType: 'custom', customFee: 500 }
  ]);

  // PDF Settings
  const [pdfHeaderUrl, setPdfHeaderUrl] = useState('');
  const [pdfFooterUrl, setPdfFooterUrl] = useState('');

  // WhatsApp Templates (use camelCase placeholders to match whatsappAutoSendService)
  const [whatsappTemplates, setWhatsappTemplates] = useState({
    appointment_confirmation: 'Dear {{patientName}},\n\n✅ **APPOINTMENT CONFIRMED**\n\n📅 Date & Time: {{appointmentDate}}\n👨‍⚕️ Doctor: Dr. {{doctorName}}\n🏥 Clinic: {{clinicName}}\n\n⏰ Please arrive 10 minutes early.\n\nIf you need to reschedule, please call us in advance.\n\nSee you soon! 😊',
    appointment_reminder: 'Dear {{patientName}},\n\n⏰ **APPOINTMENT REMINDER**\n\nYou have an appointment tomorrow:\n📅 {{appointmentDate}}\n👨‍⚕️ With Dr. {{doctorName}}\n🏥 At {{clinicName}}\n\nPlease confirm your attendance by replying to this message.\n\nSee you tomorrow! 👋',
    visit_prescription: 'Dear {{patientName}},\n\n💊 Your prescription from {{clinicName}} is ready!\n\nThe prescription has been attached to this message for your reference.\n\n📋 Please follow the prescribed medication as discussed during your consultation.\n\nFeel better soon! 🌟\n\n- {{clinicName}}',
    invoice_generated: 'Dear {{patientName}},\n\n🧾 **INVOICE DETAILS**\n\nBill Number: #{{billNumber}}\n💰 Total Amount: ₹{{totalAmount}}\n\nYour invoice has been attached to this message.\n\nThank you for visiting {{clinicName}}! 🙏\n\nFor any queries, feel free to contact us.\n\n- {{clinicName}}',
    thank_you: 'Dear {{patientName}},\n\n🙏 Thank you for visiting {{clinicName}} today!\n\nWe hope you feel better soon. 💚\n\n⭐ We would greatly appreciate if you could share your feedback:\n{{reviewLink}}\n\nYour review helps us serve you better!\n\nWarm regards,\n{{clinicName}} Team'
  });

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const clinicSettings = await clinicSettingsService.getOrCreateClinicSettings();
      setSettings(clinicSettings);

      // Update form data
      setFormData({
        clinicName: clinicSettings.clinicName,
        address: clinicSettings.address,
        phone: clinicSettings.phone,
        email: clinicSettings.email || '',
        website: clinicSettings.website || '',
        registrationNumber: clinicSettings.registrationNumber || '',
        taxId: clinicSettings.taxId || '',
        consultationFee: clinicSettings.consultationFee,
        followUpFee: clinicSettings.followUpFee,
        emergencyFee: clinicSettings.emergencyFee,
        appointmentDuration: clinicSettings.appointmentDuration,
        currency: clinicSettings.currency,
        timezone: clinicSettings.timezone
      });

      // Set working hours with fallback to default if not present
      if (clinicSettings.workingHours) {
        setWorkingHours(clinicSettings.workingHours);
      }

      // Load prescription frequencies if available
      if (clinicSettings.prescriptionFrequencies) {
        setFrequencies(clinicSettings.prescriptionFrequencies);
      }

      // Load appointment types if available
      if (clinicSettings.appointmentTypes) {
        setAppointmentTypes(clinicSettings.appointmentTypes);
      }

      // Load PDF settings
      if ((clinicSettings as any).pdfHeaderUrl) {
        setPdfHeaderUrl((clinicSettings as any).pdfHeaderUrl);
      }
      if ((clinicSettings as any).pdfFooterUrl) {
        setPdfFooterUrl((clinicSettings as any).pdfFooterUrl);
      }

      // Load WhatsApp templates
      if ((clinicSettings as any).whatsappTemplates) {
        setWhatsappTemplates(prev => ({
          ...prev,
          ...(clinicSettings as any).whatsappTemplates
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clinic settings');
      console.error('Error loading clinic settings:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get fee for an appointment type
  const getFeeForAppointmentType = (type: typeof appointmentTypes[0]) => {
    switch (type.feeType) {
      case 'consultation':
        return formData.consultationFee;
      case 'followup':
        return formData.followUpFee;
      case 'emergency':
        return formData.emergencyFee;
      case 'custom':
        return type.customFee || 0;
      default:
        return 0;
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      const updatedSettings = await clinicSettingsService.updateClinicSettings(settings.id, {
        ...formData,
        workingHours,
        prescriptionFrequencies: frequencies,
        appointmentTypes: appointmentTypes,
        pdfHeaderUrl,
        pdfFooterUrl,
        whatsappTemplates
      } as any);
      setSettings(updatedSettings);
      alert('Settings saved successfully!');
    } catch (err) {
      console.error('Error saving settings:', err);
      alert(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateWorkingHours = (day: string, field: string, value: string | boolean) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day as keyof typeof prev],
        [field]: value
      }
    }));
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to access clinic settings.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading settings...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadSettings}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Clinic Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Basic Information */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Basic Information</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clinic Name</label>
            <input
              type="text"
              value={formData.clinicName}
              onChange={(e) => setFormData({ ...formData, clinicName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number</label>
            <input
              type="text"
              value={formData.registrationNumber}
              onChange={(e) => setFormData({ ...formData, registrationNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID</label>
            <input
              type="text"
              value={formData.taxId}
              onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <textarea
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Consultation Fees */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <IndianRupee className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">Clinic Default Consultation Fees</h3>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> These are clinic-wide default fees. Individual doctors can set their own fees in their profile settings or through User Management. Doctor-specific fees take precedence over these defaults.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">General Consultation</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
              <input
                type="number"
                value={formData.consultationFee}
                onChange={(e) => setFormData({ ...formData, consultationFee: parseInt(e.target.value) })}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
              <input
                type="number"
                value={formData.followUpFee}
                onChange={(e) => setFormData({ ...formData, followUpFee: parseInt(e.target.value) })}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Emergency</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
              <input
                type="number"
                value={formData.emergencyFee}
                onChange={(e) => setFormData({ ...formData, emergencyFee: parseInt(e.target.value) })}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Appointment Duration (min)</label>
            <input
              type="number"
              value={formData.appointmentDuration}
              onChange={(e) => setFormData({ ...formData, appointmentDuration: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Prescription Frequencies */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-800">Prescription Frequencies</h3>
          </div>
          <button
            onClick={() => setFrequencies([...frequencies, { code: '', label: '', timesPerDay: 1 }])}
            className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Frequency
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Configure prescription frequency options that will appear in the EMR forms when adding prescriptions.
        </p>

        <div className="space-y-3">
          {frequencies.map((freq, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border border-gray-200 rounded-lg">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
                <input
                  type="text"
                  value={freq.code}
                  onChange={(e) => {
                    const updated = [...frequencies];
                    updated[index].code = e.target.value;
                    setFrequencies(updated);
                  }}
                  placeholder="OD, BD, TID..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={freq.label}
                  onChange={(e) => {
                    const updated = [...frequencies];
                    updated[index].label = e.target.value;
                    setFrequencies(updated);
                  }}
                  placeholder="OD (Once daily)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Times/Day</label>
                  <input
                    type="number"
                    value={freq.timesPerDay ?? ''}
                    onChange={(e) => {
                      const updated = [...frequencies];
                      updated[index].timesPerDay = e.target.value === '' ? null : parseInt(e.target.value);
                      setFrequencies(updated);
                    }}
                    placeholder="Leave empty for PRN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => setFrequencies(frequencies.filter((_, i) => i !== index))}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove frequency"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {frequencies.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            No frequencies configured. Click "Add Frequency" to add one.
          </p>
        )}
      </div>

      {/* Appointment Types */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-800">Appointment Types</h3>
          </div>
          <button
            onClick={() => setAppointmentTypes([...appointmentTypes, { id: '', label: '', duration: 30, color: '#3B82F6', feeType: 'consultation' }])}
            className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Type
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-blue-800 mb-2">
            <strong>How Fee Mapping Works:</strong>
          </p>
          <ul className="text-sm text-blue-800 space-y-1 ml-4 list-disc">
            <li><strong>Consultation/Follow-up/Emergency:</strong> Uses the fee from the dropdown above (doctor-specific or clinic default)</li>
            <li><strong>Custom Fee:</strong> Uses the specific amount you set for this appointment type</li>
            <li><strong>Priority:</strong> Doctor's personal fee → Clinic default fee → System default</li>
          </ul>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Configure appointment types that will appear when scheduling appointments. Each type links to a fee category above.
        </p>

        <div className="space-y-3">
          {appointmentTypes.map((type, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-6 gap-3 p-3 border border-gray-200 rounded-lg">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ID</label>
                <input
                  type="text"
                  value={type.id}
                  onChange={(e) => {
                    const updated = [...appointmentTypes];
                    updated[index].id = e.target.value.toLowerCase().replace(/\s+/g, '_');
                    setAppointmentTypes(updated);
                  }}
                  placeholder="consultation"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={type.label}
                  onChange={(e) => {
                    const updated = [...appointmentTypes];
                    updated[index].label = e.target.value;
                    setAppointmentTypes(updated);
                  }}
                  placeholder="Consultation"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={type.duration}
                  onChange={(e) => {
                    const updated = [...appointmentTypes];
                    updated[index].duration = parseInt(e.target.value) || 30;
                    setAppointmentTypes(updated);
                  }}
                  placeholder="30"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fee Type</label>
                <select
                  value={type.feeType}
                  onChange={(e) => {
                    const updated = [...appointmentTypes];
                    updated[index].feeType = e.target.value as AppointmentType['feeType'];
                    if (e.target.value !== 'custom') {
                      delete updated[index].customFee;
                    }
                    setAppointmentTypes(updated);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                >
                  <option value="consultation">Consultation (₹{formData.consultationFee})</option>
                  <option value="followup">Follow-up (₹{formData.followUpFee})</option>
                  <option value="emergency">Emergency (₹{formData.emergencyFee})</option>
                  <option value="custom">Custom Fee</option>
                </select>
              </div>

              {type.feeType === 'custom' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Custom Fee (₹)</label>
                  <input
                    type="number"
                    value={type.customFee || 0}
                    onChange={(e) => {
                      const updated = [...appointmentTypes];
                      updated[index].customFee = parseInt(e.target.value) || 0;
                      setAppointmentTypes(updated);
                    }}
                    placeholder="500"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Color</label>
                  <input
                    type="color"
                    value={type.color}
                    onChange={(e) => {
                      const updated = [...appointmentTypes];
                      updated[index].color = e.target.value;
                      setAppointmentTypes(updated);
                    }}
                    className="w-full h-10 border border-gray-300 rounded-lg cursor-pointer"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => setAppointmentTypes(appointmentTypes.filter((_, i) => i !== index))}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove type"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {appointmentTypes.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            No appointment types configured. Click "Add Type" to add one.
          </p>
        )}
      </div>

      {/* PDF Header/Footer Settings */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">PDF Settings</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Add custom header and footer images to your prescription/visit PDFs. Use image URLs from your hosting or upload to a service like Imgur.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Header Image URL</label>
            <input
              type="url"
              value={pdfHeaderUrl}
              onChange={(e) => setPdfHeaderUrl(e.target.value)}
              placeholder="https://example.com/header.png"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {pdfHeaderUrl && (
              <div className="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-xs text-gray-500 mb-1">Preview:</p>
                <img
                  src={pdfHeaderUrl}
                  alt="Header preview"
                  className="max-h-20 object-contain"
                  onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Footer Image URL</label>
            <input
              type="url"
              value={pdfFooterUrl}
              onChange={(e) => setPdfFooterUrl(e.target.value)}
              placeholder="https://example.com/footer.png"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {pdfFooterUrl && (
              <div className="mt-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
                <p className="text-xs text-gray-500 mb-1">Preview:</p>
                <img
                  src={pdfFooterUrl}
                  alt="Footer preview"
                  className="max-h-20 object-contain"
                  onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">
            <strong>Tip:</strong> For best results, use images with:
            <ul className="mt-1 ml-4 list-disc">
              <li>Width: 800-1000 pixels</li>
              <li>Height: 100-150 pixels for header, 80-100 pixels for footer</li>
              <li>Format: PNG with transparent background</li>
            </ul>
          </p>
        </div>
      </div>

      {/* WhatsApp Templates */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">WhatsApp Message Templates</h3>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Customize the messages sent to patients via WhatsApp. Use placeholders like <code className="bg-gray-100 px-1 rounded">{"{{patientName}}"}</code> which will be replaced with actual values.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-800 font-medium mb-1">Available Placeholders:</p>
          <div className="flex flex-wrap gap-2">
            {['{{patientName}}', '{{doctorName}}', '{{clinicName}}', '{{appointmentDate}}', '{{appointmentType}}', '{{pdfUrl}}', '{{billNumber}}', '{{totalAmount}}', '{{reviewLink}}'].map(placeholder => (
              <code key={placeholder} className="text-xs bg-blue-100 px-2 py-1 rounded">{placeholder}</code>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              📅 Appointment Confirmation
            </label>
            <textarea
              value={whatsappTemplates.appointment_confirmation}
              onChange={(e) => setWhatsappTemplates(prev => ({ ...prev, appointment_confirmation: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ⏰ Appointment Reminder
            </label>
            <textarea
              value={whatsappTemplates.appointment_reminder}
              onChange={(e) => setWhatsappTemplates(prev => ({ ...prev, appointment_reminder: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              💊 Prescription Ready
            </label>
            <textarea
              value={whatsappTemplates.visit_prescription}
              onChange={(e) => setWhatsappTemplates(prev => ({ ...prev, visit_prescription: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              🧾 Invoice Generated
            </label>
            <textarea
              value={whatsappTemplates.invoice_generated}
              onChange={(e) => setWhatsappTemplates(prev => ({ ...prev, invoice_generated: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              🙏 Thank You Message
            </label>
            <textarea
              value={whatsappTemplates.thank_you}
              onChange={(e) => setWhatsappTemplates(prev => ({ ...prev, thank_you: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>
        </div>
      </div>

      {/* Working Hours */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-800">Working Hours</h3>
        </div>

        <div className="space-y-4">
          {workingHours && Object.entries(workingHours).map(([day, hours]) => (
            <div key={day} className="flex items-center gap-4 p-3 border border-gray-200 rounded-lg">
              <div className="w-20">
                <span className="font-medium text-gray-700 capitalize">{day}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hours.isOpen}
                  onChange={(e) => updateWorkingHours(day, 'isOpen', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">Open</span>
              </div>

              {hours.isOpen && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">From:</span>
                    <input
                      type="time"
                      value={hours.startTime}
                      onChange={(e) => updateWorkingHours(day, 'startTime', e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">To:</span>
                    <input
                      type="time"
                      value={hours.endTime}
                      onChange={(e) => updateWorkingHours(day, 'endTime', e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {day !== 'saturday' && day !== 'sunday' && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Break:</span>
                        <input
                          type="time"
                          value={hours.breakStart || ''}
                          onChange={(e) => updateWorkingHours(day, 'breakStart', e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">to:</span>
                        <input
                          type="time"
                          value={hours.breakEnd || ''}
                          onChange={(e) => updateWorkingHours(day, 'breakEnd', e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ClinicSettings;