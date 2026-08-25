import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../Auth/useAuth';
import { hasReceptionAccess, isAdminUser } from '../../utils/roleAccess';
import { hasModuleAccess } from '../../utils/modulePermissions';
import { clinicSettingsService } from '../../services/clinicSettingsService';
import { ClinicSetting } from '../../types';
import {
  User,
  Stethoscope,
  IndianRupee,
  Users,
  Bell,
  Shield,
  Save,
  Database,
  Edit,
  MessageCircle,
  Building,
  Zap,
  FileImage,
  Timer,
  Clock,
  UserCog,
  BedDouble,
  Globe
} from 'lucide-react';
import { PDFSettings } from './PDFSettings';
import PublicBookingSettings from './PublicBookingSettings';

const Settings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [clinicSettings, setClinicSettings] = useState<ClinicSetting | null>(null);

  const [consultationFees, setConsultationFees] = useState({
    generalConsultation: '',
    followUpConsultation: '',
    emergencyConsultation: ''
  });
  const [savingFees, setSavingFees] = useState(false);
  const [feesMessage, setFeesMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Base tabs available to all users
  const baseTabs = [
    { id: 'profile', label: 'Profile', icon: User },
  ];

  // Admin-only tabs
  const adminTabs = [
    { id: 'clinic', label: 'Clinic Settings', icon: Building },
    { id: 'pdf', label: 'PDF Settings', icon: FileImage },
    { id: 'fees', label: 'Consultation Fees', icon: IndianRupee },
    { id: 'templates', label: 'Examination Templates', icon: Stethoscope },
    { id: 'presets', label: 'Prescription Presets', icon: Zap },
    { id: 'public-booking', label: 'Public Booking', icon: Globe },
    { id: 'staff', label: 'Staff Roles', icon: Users },
    { id: 'master-data', label: 'Master Data', icon: Database },
    { id: 'whatsapp-ai', label: 'WhatsApp & AI', icon: MessageCircle },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'system', label: 'System Settings', icon: Shield }
  ];

  // Combine tabs based on user role
  const isAdmin = isAdminUser(user);
  const isReception = hasReceptionAccess(user);
  const ipdEnabled = user?.clinic?.ipdEnabled ?? false;

  // Use the shared helper (same one gating linkTabs below) so a user who holds
  // the admin permission under a different role name still sees these tabs.
  const tabs = isAdmin ? [...baseTabs, ...adminTabs] : baseTabs;

  // These live on their own routes (removed from the main sidebar to keep it
  // compact) and are surfaced here as direct links.
  const linkTabs = [
    ...(isAdmin ? [{ to: '/waiting-sequences', label: 'Waiting Sequences', icon: Timer }] : []),
    ...(user?.isOpenForConsultation || isAdmin || isReception
      ? [{ to: '/settings/availability', label: 'Doctor Availability', icon: Clock }]
      : []),
    ...(isAdmin ? [{ to: '/settings/users', label: 'User Management', icon: UserCog }] : []),
    ...(ipdEnabled && hasModuleAccess(user, 'ipd_masters')
      ? [{ to: '/ipd/masters', label: 'IPD Masters', icon: BedDouble }]
      : []),
  ];

  // Load clinic settings from database
  useEffect(() => {
    const loadClinicSettings = async () => {
      if (user?.clinicId) {
        try {
          const settings = await clinicSettingsService.getClinicSettings(user.clinicId);
          setClinicSettings(settings);
          if (settings) {
            setConsultationFees({
              generalConsultation: settings.consultationFee != null ? String(settings.consultationFee) : '',
              followUpConsultation: settings.followUpFee != null ? String(settings.followUpFee) : '',
              emergencyConsultation: settings.emergencyFee != null ? String(settings.emergencyFee) : ''
            });
          }
        } catch (error) {
          console.error('Failed to load clinic settings:', error);
        }
      }
    };

    loadClinicSettings();
  }, [user?.clinicId]);

  const handleSaveFees = async () => {
    setSavingFees(true);
    setFeesMessage(null);
    try {
      const toNumber = (v: string) => (v.trim() === '' ? undefined : Number(v));
      const updated = await clinicSettingsService.updateConsultationFees({
        consultation: toNumber(consultationFees.generalConsultation),
        followUp: toNumber(consultationFees.followUpConsultation),
        emergency: toNumber(consultationFees.emergencyConsultation)
      });
      setClinicSettings(updated);
      setFeesMessage({ type: 'success', text: 'Consultation fees saved.' });
    } catch (error) {
      setFeesMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save consultation fees.'
      });
    } finally {
      setSavingFees(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Settings</h2>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="lg:w-64">
          <nav className="bg-white rounded-lg shadow-md p-4">
            <ul className="space-y-2">
              {tabs.map(tab => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${activeTab === tab.id
                      ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600'
                      : 'text-gray-600 hover:bg-gray-50'
                      }`}
                  >
                    <tab.icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            {linkTabs.length > 0 && (
              <>
                <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  More
                </p>
                <ul className="space-y-2">
                  {linkTabs.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <Link
                        to={to}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors text-gray-600 hover:bg-gray-50"
                      >
                        <Icon className="w-5 h-5" />
                        <span>{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === 'profile' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">My Profile</h3>
                <Link
                  to="/settings/profile"
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit Profile
                </Link>
              </div>

              <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Note:</strong> This section displays your profile information.
                  Click "Edit Profile\" above to make changes. To manage other users, go to Settings → User Management.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Full Name</label>
                    <p className="text-gray-800 font-medium">{user?.name || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
                    <p className="text-gray-800 font-medium">{user?.email || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Phone</label>
                    <p className="text-gray-800 font-medium">{user?.phone || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Role</label>
                    <p className="text-gray-800 font-medium">{user?.roleName || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Specialization</label>
                    <p className="text-gray-800 font-medium">{user?.specialization || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Qualification</label>
                    <p className="text-gray-800 font-medium">{user?.qualification || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Registration No.</label>
                    <p className="text-gray-800 font-medium">{user?.registrationNo || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Status</label>
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${user?.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                      {user?.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                {/* Consultation Fees for Doctors */}
                {user?.roleName?.toLowerCase() === 'doctor' && (
                  <div className="mt-6 pt-6 border-t border-gray-300">
                    <h4 className="text-md font-medium text-gray-700 mb-4">Consultation Fees</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">General Consultation</label>
                        <p className="text-gray-800 font-medium">
                          {user?.consultationFee ? `₹${user.consultationFee}` : 'Using clinic default'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Follow-up</label>
                        <p className="text-gray-800 font-medium">
                          {user?.followUpFee ? `₹${user.followUpFee}` : 'Using clinic default'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Emergency</label>
                        <p className="text-gray-800 font-medium">
                          {user?.emergencyFee ? `₹${user.emergencyFee}` : 'Using clinic default'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Clinic Information */}
                {user?.clinic && (
                  <div className="mt-6 pt-6 border-t border-gray-300">
                    <h4 className="text-md font-medium text-gray-700 mb-4">Clinic Information</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Clinic Name</label>
                        <p className="text-gray-800 font-medium">{user.clinic.clinicName}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Phone</label>
                        <p className="text-gray-800 font-medium">{user.clinic.phone}</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-600 mb-1">Address</label>
                        <p className="text-gray-800 font-medium">{user.clinic.address}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'fees' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Clinic Default Consultation Fees</h3>

              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Note:</strong> These are clinic-wide default fees. Individual doctors can set their own fees
                  in their profile settings or through User Management. Doctor-specific fees take precedence over these defaults.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">General Consultation</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
                    <input
                      type="number"
                      value={consultationFees.generalConsultation}
                      onChange={(e) => setConsultationFees({ ...consultationFees, generalConsultation: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Consultation</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
                    <input
                      type="number"
                      value={consultationFees.followUpConsultation}
                      onChange={(e) => setConsultationFees({ ...consultationFees, followUpConsultation: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Consultation</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
                    <input
                      type="number"
                      value={consultationFees.emergencyConsultation}
                      onChange={(e) => setConsultationFees({ ...consultationFees, emergencyConsultation: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {feesMessage && (
                <p className={`mt-4 text-sm ${feesMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {feesMessage.text}
                </p>
              )}

              <div className="mt-6">
                <button
                  onClick={handleSaveFees}
                  disabled={savingFees}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  {savingFees ? 'Saving...' : 'Save Fees'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'clinic' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Clinic Settings</h3>
                <Link
                  to="/settings/clinic"
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit Clinic Settings
                </Link>
              </div>

              <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Note:</strong> This section displays your clinic information.
                  Click "Edit Clinic Settings\" above to make changes to clinic name, address, contact details, and branding.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Clinic Name</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.clinicName || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Phone</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.phone || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Email</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.email || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Website</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.website || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Registration Number</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.registrationNumber || 'Not set'}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Tax ID</label>
                    <p className="text-gray-800 font-medium">{user?.clinic?.taxId || 'Not set'}</p>
                  </div>
                </div>

                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-600 mb-1">Address</label>
                  <p className="text-gray-800 font-medium">{user?.clinic?.address || 'Not set'}</p>
                </div>

                {/* Working Hours */}
                <div className="mt-6 pt-6 border-t border-gray-300">
                  <h4 className="text-md font-medium text-gray-700 mb-4">Working Hours</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {user?.clinic?.workingHours && Object.entries(user.clinic.workingHours).map(([day, hours]) => (
                      <div key={day} className="text-sm">
                        <span className="font-medium capitalize text-gray-700">{day}:</span>
                        <span className="ml-2 text-gray-600">
                          {hours.isOpen
                            ? `${hours.startTime} - ${hours.endTime}${hours.breakStart ? ` (Break: ${hours.breakStart}-${hours.breakEnd})` : ''}`
                            : 'Closed'
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Consultation Fees */}
                <div className="mt-6 pt-6 border-t border-gray-300">
                  <h4 className="text-md font-medium text-gray-700 mb-4">Default Consultation Fees</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">General Consultation</label>
                      <p className="text-gray-800 font-medium">₹{user?.clinic?.consultationFee || 'Not set'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Follow-up</label>
                      <p className="text-gray-800 font-medium">₹{user?.clinic?.followUpFee || 'Not set'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-600 mb-1">Emergency</label>
                      <p className="text-gray-800 font-medium">₹{user?.clinic?.emergencyFee || 'Not set'}</p>
                    </div>
                  </div>
                </div>

                {/* Prescription Frequencies */}
                {clinicSettings?.prescriptionFrequencies && clinicSettings.prescriptionFrequencies.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-gray-300">
                    <h4 className="text-md font-medium text-gray-700 mb-4">Prescription Frequencies</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {clinicSettings.prescriptionFrequencies.map((freq, index) => (
                        <div key={index} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-800">{freq.code}</span>
                            {freq.timesPerDay !== null && (
                              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                {freq.timesPerDay}x/day
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{freq.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'pdf' && user?.clinicId && (
            <PDFSettings clinicId={user.clinicId} />
          )}

          {activeTab === 'public-booking' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <PublicBookingSettings />
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Examination Templates</h3>
                <Link
                  to="/settings/examination-templates"
                  className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Manage Templates
                </Link>
              </div>

              <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex gap-3">
                  <Stethoscope className="w-6 h-6 text-purple-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-purple-800 mb-1">Standardize examinations</h4>
                    <p className="text-sm text-purple-700">
                      Create reusable examination templates for different specializations.
                      Use AI to generate section structures, then customize fields.
                      Doctors can load these templates during patient visits.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-8">
                <Link
                  to="/settings/examination-templates"
                  className="flex flex-col items-center gap-4 text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Stethoscope className="w-8 h-8 text-purple-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Configure Templates</h4>
                    <p className="text-gray-500 mt-1">Click here to add or edit examination templates</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'presets' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Prescription Presets</h3>
                <Link
                  to="/settings/presets"
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Manage Presets
                </Link>
              </div>

              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex gap-3">
                  <Zap className="w-6 h-6 text-amber-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-amber-800 mb-1">Speed up your practice</h4>
                    <p className="text-sm text-amber-700">
                      Create ready-made prescription templates for common conditions like "Viral Fever", "Hypertension", or "Diabetes".
                      Doctors can apply these with one click during patient visits.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-8">
                <Link
                  to="/settings/presets"
                  className="flex flex-col items-center gap-4 text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Zap className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Configure Presets</h4>
                    <p className="text-gray-500 mt-1">Click here to add or edit prescription templates</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Staff Roles & Permissions</h3>
                <Link
                  to="/settings/users"
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <UserCog className="w-4 h-4" />
                  Manage Users & Roles
                </Link>
              </div>

              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-3">
                  <Users className="w-6 h-6 text-blue-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-blue-800 mb-1">Manage staff, roles and permissions</h4>
                    <p className="text-sm text-blue-700">
                      Add staff members, assign roles (Doctor, Receptionist, Nurse, Admin) and control
                      per-user permissions in User Management. Changes there apply across the app.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-8">
                <Link
                  to="/settings/users"
                  className="flex flex-col items-center gap-4 text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <UserCog className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Open User Management</h4>
                    <p className="text-gray-500 mt-1">Add users, assign roles and permissions</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'master-data' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Master Data Management</h3>
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>Note:</strong> Master Data Management includes AI-powered data entry, medicine and test catalogs,
                  clinic-specific pricing, and inventory management. Use the AI Assistant for quick natural language entry.
                </p>
              </div>

              <div className="space-y-4">
                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">🤖 AI Assistant</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Use natural language to add medicines and tests. Just type "CBC 300 rs" or "Paracetamol 500mg tablet 50 rupees" and let AI do the rest!
                  </p>
                  <button
                    onClick={() => navigate('/settings/master-data', { state: { activeTab: 'ai-assistant' } })}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    Open AI Assistant
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">Medicine Master Data</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Manage medicine catalog, set clinic-specific pricing, and track inventory levels.
                  </p>
                  <button
                    onClick={() => navigate('/settings/master-data', { state: { activeTab: 'medicines' } })}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Open Master Data Management
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">Test Master Data</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Manage test catalog and set clinic-specific test pricing.
                  </p>
                  <button
                    onClick={() => navigate('/settings/master-data', { state: { activeTab: 'tests' } })}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Manage Test Pricing
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">Clinic Pricing Overview</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    View and manage all clinic-specific pricing for medicines and tests in one place.
                  </p>
                  <button
                    onClick={() => navigate('/settings/master-data', { state: { activeTab: 'pricing' } })}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    View Pricing Overview
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'whatsapp-ai' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">WhatsApp & AI Review Settings</h3>
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700">
                  <strong>Note:</strong> Configure WhatsApp messaging options and AI-powered review features.
                  These settings control how follow-up messages and review requests are sent to patients.
                </p>
              </div>

              <div className="space-y-4">
                {/* Auto-Send Rules - NEW */}
                <div className="p-4 border-2 border-blue-200 bg-blue-50 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">🤖 Auto-Send Rules</h4>
                  <p className="text-sm text-blue-700 mb-3">
                    Configure automatic WhatsApp notifications for appointments, invoices, prescriptions, and more.
                    Uses your WhatsApp templates for consistent messaging.
                  </p>
                  <button
                    onClick={() => navigate('/settings/whatsapp-auto-send')}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Configure Auto-Send Rules
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">📱 WhatsApp Integration</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Connect your WhatsApp account for direct message sending and automated notifications.
                  </p>
                  <button
                    onClick={() => navigate('/settings/whatsapp-ai')}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    Configure WhatsApp Settings
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">🤖 AI Review Features</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Enable AI-powered thank you messages and personalized review suggestions for patients.
                  </p>
                  <button
                    onClick={() => navigate('/settings/whatsapp-ai')}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    Configure AI Features
                  </button>
                </div>

                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">⭐ Google My Business</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Set up your Google My Business review link for automated review requests.
                  </p>
                  <button
                    onClick={() => navigate('/settings/whatsapp-ai')}
                    className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
                  >
                    Configure GMB Link
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">Patient Notifications</h3>
                <Link
                  to="/settings/whatsapp-auto-send"
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Configure Auto-Send Rules
                </Link>
              </div>

              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex gap-3">
                  <Bell className="w-6 h-6 text-green-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-green-800 mb-1">Automated patient notifications</h4>
                    <p className="text-sm text-green-700">
                      Appointment reminders, invoice, prescription and follow-up messages are sent via
                      WhatsApp Auto-Send Rules. Open the rules screen to enable each event type, pick a
                      template and set delays.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-8">
                <Link
                  to="/settings/whatsapp-auto-send"
                  className="flex flex-col items-center gap-4 text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Bell className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Open Notification Rules</h4>
                    <p className="text-gray-500 mt-1">Enable and customize automated patient messages</p>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-800">System Settings</h3>
                <Link
                  to="/settings/system"
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Manage System Settings
                </Link>
              </div>

              <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex gap-3">
                  <Shield className="w-6 h-6 text-gray-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-gray-800 mb-1">Advanced System Configuration</h4>
                    <p className="text-sm text-gray-600">
                      Configure database backups, security policies, session timeouts, and notification preferences.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-center py-8">
                <Link
                  to="/settings/system"
                  className="flex flex-col items-center gap-4 text-center p-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                >
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Shield className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900">Open System Settings</h4>
                    <p className="text-gray-500 mt-1">Manage backups, security, and preferences</p>
                  </div>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
