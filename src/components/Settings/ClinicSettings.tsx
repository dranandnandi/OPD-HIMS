import React, { useState, useEffect } from 'react';
import { Save, Building, Phone, Mail, Globe, Clock, IndianRupee, Plus, Trash2 } from 'lucide-react';
import { ClinicSetting } from '../../types';
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

  const [frequencies, setFrequencies] = useState<Array<{code: string, label: string, timesPerDay: number | null}>>([
    {code: 'OD', label: 'OD (Once daily)', timesPerDay: 1},
    {code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2},
    {code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3},
    {code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4},
    {code: 'PRN', label: 'PRN (As needed)', timesPerDay: null}
  ]);

  const [appointmentTypes, setAppointmentTypes] = useState<Array<{id: string, label: string, duration: number, color: string}>>([
    {id: 'consultation', label: 'Consultation', duration: 30, color: '#3B82F6'},
    {id: 'followup', label: 'Follow-up', duration: 20, color: '#10B981'},
    {id: 'emergency', label: 'Emergency', duration: 15, color: '#EF4444'},
    {id: 'procedure', label: 'Procedure', duration: 60, color: '#8B5CF6'}
  ]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clinic settings');
      console.error('Error loading clinic settings:', err);
    } finally {
      setLoading(false);
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
        appointmentTypes: appointmentTypes
      });
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
          <h3 className="text-lg font-semibold text-gray-800">Consultation Fees</h3>
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
            onClick={() => setFrequencies([...frequencies, {code: '', label: '', timesPerDay: 1}])}
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
            onClick={() => setAppointmentTypes([...appointmentTypes, {id: '', label: '', duration: 30, color: '#3B82F6'}])}
            className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Type
          </button>
        </div>
        
        <p className="text-sm text-gray-600 mb-4">
          Configure appointment types that will appear when scheduling appointments. Each type can have a different duration and color.
        </p>

        <div className="space-y-3">
          {appointmentTypes.map((type, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 border border-gray-200 rounded-lg">
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