import React, { useState, useEffect } from 'react';
import { Save, Clock, Calendar, AlertCircle, Users, Plus, Trash2, CalendarOff } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { Profile } from '../../types';
import { authService } from '../../services/authService';
import { getCurrentProfile } from '../../services/profileService';
import { doctorAvailabilityService, DoctorAvailability, AvailabilityOverride } from '../../services/doctorAvailabilityService';
import { DEFAULT_WORKING_HOURS, normalizeWorkingHours } from '../../services/clinicSettingsService';
import { hasReceptionAccess } from '../../utils/roleAccess';

const canManageClinicDoctors = (user: Profile | null | undefined) => hasReceptionAccess(user);

const DoctorAvailabilitySettings: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');

  const [availability, setAvailability] = useState<DoctorAvailability>(DEFAULT_WORKING_HOURS);

  const EMPTY_OVERRIDE_FORM = {
    date: '',
    closed: false,
    startTime: '09:00',
    endTime: '13:00',
    breakStart: '',
    breakEnd: '',
    note: '',
  };

  const [overrides, setOverrides] = useState<AvailabilityOverride[]>([]);
  const [overrideForm, setOverrideForm] = useState(EMPTY_OVERRIDE_FORM);
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadDoctors();
    }
  }, [user]);

  useEffect(() => {
    if (selectedDoctorId) {
      loadAvailability(selectedDoctorId);
      loadOverrides(selectedDoctorId);
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
      setAvailability(normalizeWorkingHours(doctorAvailability));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load availability');
      console.error('Error loading availability:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOverrides = async (doctorId = selectedDoctorId) => {
    if (!doctorId) return;

    try {
      setOverrideError(null);
      const rows = await doctorAvailabilityService.listOverrides(doctorId);
      setOverrides(rows);
    } catch (err) {
      console.error('Error loading date overrides:', err);
      setOverrideError(err instanceof Error ? err.message : 'Failed to load date overrides');
    }
  };

  const handleAddOverride = async () => {
    if (!selectedDoctorId) return;

    setOverrideError(null);

    if (!overrideForm.date) {
      setOverrideError('Pick a date for the override.');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (overrideForm.date < today) {
      setOverrideError('Override date cannot be in the past.');
      return;
    }

    if (!overrideForm.closed) {
      if (!overrideForm.startTime || !overrideForm.endTime) {
        setOverrideError('Set both From and To times, or mark the day as unavailable.');
        return;
      }
      if (overrideForm.endTime <= overrideForm.startTime) {
        setOverrideError('End time must be after start time.');
        return;
      }
      if (
        (overrideForm.breakStart && !overrideForm.breakEnd) ||
        (!overrideForm.breakStart && overrideForm.breakEnd)
      ) {
        setOverrideError('Set both break times, or leave both empty.');
        return;
      }
    }

    try {
      setOverrideSaving(true);
      await doctorAvailabilityService.saveOverride(selectedDoctorId, {
        date: overrideForm.date,
        isOpen: !overrideForm.closed,
        startTime: overrideForm.startTime,
        endTime: overrideForm.endTime,
        breakStart: overrideForm.breakStart || undefined,
        breakEnd: overrideForm.breakEnd || undefined,
        note: overrideForm.note || undefined,
      });
      setOverrideForm(EMPTY_OVERRIDE_FORM);
      await loadOverrides();
    } catch (err) {
      console.error('Error saving date override:', err);
      setOverrideError(err instanceof Error ? err.message : 'Failed to save date override');
    } finally {
      setOverrideSaving(false);
    }
  };

  const handleDeleteOverride = async (overrideId: string) => {
    try {
      setOverrideError(null);
      await doctorAvailabilityService.deleteOverride(overrideId);
      setOverrides(prev => prev.filter(item => item.id !== overrideId));
    } catch (err) {
      console.error('Error deleting date override:', err);
      setOverrideError(err instanceof Error ? err.message : 'Failed to delete date override');
    }
  };

  const formatOverrideDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
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
          {Object.entries(availability || {}).map(([day, hours]) => (
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

      {/* Date Overrides */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-2">
          <CalendarOff className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Date Overrides</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Change hours for a specific date without touching the weekly schedule — e.g. a Saturday
          with morning hours only, or a full day off. Delete an override and that date goes back to
          the weekly schedule. Past dates are cleaned up automatically.
        </p>

        {overrideError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {overrideError}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input
              type="date"
              value={overrideForm.date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setOverrideForm(prev => ({ ...prev, date: e.target.value }))}
              className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2 pb-1.5">
            <input
              type="checkbox"
              id="override-closed"
              checked={overrideForm.closed}
              onChange={(e) => setOverrideForm(prev => ({ ...prev, closed: e.target.checked }))}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="override-closed" className="text-sm text-gray-600">Unavailable all day</label>
          </div>

          {!overrideForm.closed && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  type="time"
                  value={overrideForm.startTime}
                  onChange={(e) => setOverrideForm(prev => ({ ...prev, startTime: e.target.value }))}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  type="time"
                  value={overrideForm.endTime}
                  onChange={(e) => setOverrideForm(prev => ({ ...prev, endTime: e.target.value }))}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Break (optional)</label>
                <div className="flex items-center gap-1">
                  <input
                    type="time"
                    value={overrideForm.breakStart}
                    onChange={(e) => setOverrideForm(prev => ({ ...prev, breakStart: e.target.value }))}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <span className="text-xs text-gray-500">to</span>
                  <input
                    type="time"
                    value={overrideForm.breakEnd}
                    onChange={(e) => setOverrideForm(prev => ({ ...prev, breakEnd: e.target.value }))}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
            <input
              type="text"
              maxLength={120}
              placeholder="e.g. Conference"
              value={overrideForm.note}
              onChange={(e) => setOverrideForm(prev => ({ ...prev, note: e.target.value }))}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            onClick={handleAddOverride}
            disabled={overrideSaving}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {overrideSaving ? 'Saving...' : 'Add Override'}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {overrides.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming overrides. The weekly schedule applies to every date.</p>
          ) : (
            overrides.map(override => (
              <div
                key={override.id}
                className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-lg"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-gray-800">{formatOverrideDate(override.date)}</span>
                  {override.isOpen ? (
                    <span className="text-gray-700">
                      {override.startTime} – {override.endTime}
                      {override.breakStart && override.breakEnd && (
                        <span className="text-gray-500"> (break {override.breakStart}–{override.breakEnd})</span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      Unavailable all day
                    </span>
                  )}
                  {override.note && <span className="text-gray-500 italic">{override.note}</span>}
                </div>
                <button
                  onClick={() => handleDeleteOverride(override.id)}
                  title="Delete override (date reverts to weekly schedule)"
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DoctorAvailabilitySettings;
