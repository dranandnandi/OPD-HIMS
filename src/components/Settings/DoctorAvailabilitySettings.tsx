import React, { useState, useEffect } from 'react';
import { Save, Clock, Calendar, AlertCircle, Users } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { Profile } from '../../types';
import { authService } from '../../services/authService';
import { getCurrentProfile } from '../../services/profileService';
import { doctorAvailabilityService, DoctorAvailability } from '../../services/doctorAvailabilityService';

const canManageClinicDoctors = (user: Profile | null | undefined) => {
  const roleName = user?.roleName?.toLowerCase();
  return Boolean(
    user && (
      roleName === 'admin' ||
      roleName === 'super_admin' ||
      roleName === 'receptionist' ||
      roleName === 'reception' ||
      user.permissions.includes('admin') ||
      user.permissions.includes('all')
    )
  );
};

const DoctorAvailabilitySettings: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');

  const [availability, setAvailability] = useState<DoctorAvailability>({
    monday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    tuesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    wednesday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    thursday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    friday: { isOpen: true, startTime: '09:00', endTime: '18:00', breakStart: '13:00', breakEnd: '14:00' },
    saturday: { isOpen: true, startTime: '09:00', endTime: '14:00' },
    sunday: { isOpen: false, startTime: '09:00', endTime: '18:00' }
  });

  useEffect(() => {
    if (user) {
      loadDoctors();
    }
  }, [user]);

  useEffect(() => {
    if (selectedDoctorId) {
      loadAvailability(selectedDoctorId);
    }
  }, [selectedDoctorId]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log('[AVAILABILITY DEBUG] route guard values', {
      userId: user?.id,
      name: user?.name,
      roleName: user?.roleName,
      isOpenForConsultation: user?.isOpenForConsultation,
      updatedAt: user?.updatedAt,
    });
  }, [user]);

  const loadDoctors = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const profile = await getCurrentProfile();
      if (!profile?.clinicId) {
        throw new Error('User not assigned to a clinic.');
      }

      if (canManageClinicDoctors(user)) {
        const clinicDoctors = await authService.getDoctors();
        setDoctors(clinicDoctors);
        setSelectedDoctorId(prev =>
          prev && clinicDoctors.some(doctor => doctor.id === prev)
            ? prev
            : clinicDoctors[0]?.id || ''
        );
      } else if (user.isOpenForConsultation) {
        setDoctors([user]);
        setSelectedDoctorId(user.id);
      } else {
        setDoctors([]);
        setSelectedDoctorId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load doctors');
      console.error('Error loading doctors:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailability = async (doctorId = selectedDoctorId) => {
    if (!doctorId) return;

    try {
      setLoading(true);
      setError(null);
      const doctorAvailability = await doctorAvailabilityService.getDoctorAvailability(doctorId);
      setAvailability(doctorAvailability);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load availability');
      console.error('Error loading availability:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || !selectedDoctorId) return;

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot save availability.');
      return;
    }
    try {
      setSaving(true);
      await doctorAvailabilityService.updateDoctorAvailability(selectedDoctorId, availability);
      alert('Availability updated successfully!');
    } catch (err) {
      console.error('Error saving availability:', err);
      alert(err instanceof Error ? err.message : 'Failed to save availability');
    } finally {
      setSaving(false);
    }
  };

  const updateAvailability = (day: string, field: string, value: string | boolean) => {
    setAvailability(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to manage availability.</p>
      </div>
    );
  }

  const selectedDoctor = doctors.find(doctor => doctor.id === selectedDoctorId);
  const managerView = canManageClinicDoctors(user);

  if (!managerView && !user.isOpenForConsultation) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-yellow-800 mb-2">Not Open for Consultation</h3>
          <p className="text-yellow-700 mb-4">
            You need to enable "Open for Consultation" in your profile settings to manage your availability.
          </p>
          <button
            onClick={() => window.location.href = '/settings/profile'}
            className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
          >
            Go to Profile Settings
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading availability...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error}</div>
        <button
          onClick={loadDoctors}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!selectedDoctorId) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-yellow-800 mb-2">No Consultation Doctors</h3>
          <p className="text-yellow-700">
            Add a doctor or mark an existing doctor as open for consultation before setting availability.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {managerView ? 'Doctor Availability' : 'My Availability'}
          </h2>
          <p className="text-gray-600">
            {managerView
              ? 'Set consultation hours for doctors in this clinic'
              : 'Set your consultation hours and availability'}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Availability'}
        </button>
      </div>

      {managerView && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-800">Select Doctor</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Doctor</label>
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {doctors.map(doctor => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}{doctor.specialization ? ` - ${doctor.specialization}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedDoctor && (
              <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                {selectedDoctor.email}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Availability Settings */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <Clock className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Weekly Schedule</h3>
        </div>
        
        <div className="space-y-4">
          {Object.entries(availability).map(([day, hours]) => (
            <div key={day} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-24">
                <span className="font-medium text-gray-700 capitalize">{day}</span>
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hours.isOpen}
                  onChange={(e) => updateAvailability(day, 'isOpen', e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">Available</span>
              </div>
              
              {hours.isOpen && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">From:</span>
                    <input
                      type="time"
                      value={hours.startTime}
                      onChange={(e) => updateAvailability(day, 'startTime', e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">To:</span>
                    <input
                      type="time"
                      value={hours.endTime}
                      onChange={(e) => updateAvailability(day, 'endTime', e.target.value)}
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
                          onChange={(e) => updateAvailability(day, 'breakStart', e.target.value)}
                          className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">to:</span>
                        <input
                          type="time"
                          value={hours.breakEnd || ''}
                          onChange={(e) => updateAvailability(day, 'breakEnd', e.target.value)}
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

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-2">
            <Calendar className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-800 mb-2">How it works</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Set your available days and working hours</li>
                <li>• Define break times to block appointments during lunch/breaks</li>
                <li>• Patients can only book appointments during your available slots</li>
                <li>• If not set, clinic default working hours will be used</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DoctorAvailabilitySettings;
