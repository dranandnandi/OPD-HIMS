import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../Auth/useAuth';
import { 
  User, 
  Stethoscope, 
  IndianRupee, 
  Users, 
  Bell, 
  Shield,
  Printer,
  Globe,
  Save,
  Database,
  Edit,
  MessageCircle,
  Building
} from 'lucide-react';

const Settings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  
  const [profileData, setProfileData] = useState({
    name: 'Dr. Rajesh Kumar',
    email: 'dr.rajesh@clinic.com',
    phone: '9876543210',
    specialization: 'General Medicine',
    qualification: 'MBBS, MD',
    registrationNo: 'MCI-12345',
    clinicName: 'Kumar Medical Clinic',
    clinicAddress: '123 Main Street, Mumbai, Maharashtra 400001'
  });

  const [consultationFees, setConsultationFees] = useState({
    generalConsultation: '300',
    followUpConsultation: '200',
    homeVisit: '500',
    emergencyConsultation: '800'
  });

  const [specialtyTemplates, setSpecialtyTemplates] = useState([
    { id: '1', name: 'General Medicine', active: true },
    { id: '2', name: 'Pediatrics', active: false },
    { id: '3', name: 'Cardiology', active: false },
    { id: '4', name: 'Dermatology', active: false }
  ]);

  const [staffRoles, setStaffRoles] = useState([
    { id: '1', name: 'Receptionist', permissions: ['patient_registration', 'appointment_scheduling'] },
    { id: '2', name: 'Nurse', permissions: ['patient_registration', 'vitals_recording', 'follow_up_calls'] },
    { id: '3', name: 'Doctor', permissions: ['all'] }
  ]);

  const [notificationSettings, setNotificationSettings] = useState({
    smsReminders: true,
    emailReports: true,
    followUpAlerts: true,
    appointmentNotifications: true
  });

  // Base tabs available to all users
  const baseTabs = [
    { id: 'profile', label: 'Profile', icon: User },
  ];

  // Admin-only tabs
  const adminTabs = [
    { id: 'clinic', label: 'Clinic Settings', icon: Building },
    { id: 'fees', label: 'Consultation Fees', icon: IndianRupee },
    { id: 'templates', label: 'Specialty Templates', icon: Stethoscope },
    { id: 'staff', label: 'Staff Roles', icon: Users },
    { id: 'master-data', label: 'Master Data', icon: Database },
    { id: 'whatsapp-ai', label: 'WhatsApp & AI', icon: MessageCircle },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'system', label: 'System Settings', icon: Shield }
  ];

  // Combine tabs based on user role
  const tabs = user && (user.roleName === 'admin' || user.roleName === 'super_admin') 
    ? [...baseTabs, ...adminTabs] 
    : baseTabs;
  const handleSaveProfile = () => {
    alert('Profile updated successfully!');
  };

  const handleSaveFees = () => {
    alert('Consultation fees updated successfully!');
  };

  const toggleTemplate = (templateId: string) => {
    setSpecialtyTemplates(prev => prev.map(template => 
      template.id === templateId 
        ? { ...template, active: !template.active }
        : template
    ));
  };

  const handleSaveNotifications = () => {
    alert('Notification settings updated successfully!');
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
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      activeTab === tab.id
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
                    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${
                      user?.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Home Visit</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
                    <input
                      type="number"
                      value={consultationFees.homeVisit}
                      onChange={(e) => setConsultationFees({ ...consultationFees, homeVisit: e.target.value })}
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
              
              <div className="mt-6">
                <button
                  onClick={handleSaveFees}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Fees
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
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Specialty Templates</h3>
              <div className="space-y-3">
                {specialtyTemplates.map(template => (
                  <div key={template.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Stethoscope className="w-5 h-5 text-blue-600" />
                      <span className="font-medium">{template.name}</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={template.active}
                        onChange={() => toggleTemplate(template.id)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'staff' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Staff Roles & Permissions</h3>
              <div className="space-y-4">
                {staffRoles.map(role => (
                  <div key={role.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-800">{role.name}</h4>
                      <button className="text-blue-600 hover:text-blue-700 text-sm">Edit</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {role.permissions.map(permission => (
                        <span key={permission} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          {permission.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
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
                <div className="p-4 border border-gray-200 rounded-lg">
                  <h4 className="font-medium text-gray-800 mb-2">📱 WhatsApp Integration</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Enable manual WhatsApp sending or direct API integration with Blueticks for automated messaging.
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
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Notification Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-800">SMS Reminders</h4>
                    <p className="text-sm text-gray-600">Send SMS reminders to patients for follow-ups</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationSettings.smsReminders}
                      onChange={(e) => setNotificationSettings({ ...notificationSettings, smsReminders: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-800">Email Reports</h4>
                    <p className="text-sm text-gray-600">Receive daily/weekly analytics reports via email</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationSettings.emailReports}
                      onChange={(e) => setNotificationSettings({ ...notificationSettings, emailReports: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-800">Follow-up Alerts</h4>
                    <p className="text-sm text-gray-600">Get notified when follow-up appointments are due</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationSettings.followUpAlerts}
                      onChange={(e) => setNotificationSettings({ ...notificationSettings, followUpAlerts: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
              
              <div className="mt-6">
                <button
                  onClick={handleSaveNotifications}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {activeTab === 'system' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">System Settings</h3>
              <div className="space-y-6">
                <div>
                  <h4 className="font-medium text-gray-800 mb-3">Printer Settings</h4>
                  <div className="flex items-center gap-3">
                    <Printer className="w-5 h-5 text-gray-600" />
                    <select className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                      <option>Default Printer</option>
                      <option>HP LaserJet Pro</option>
                      <option>Canon PIXMA</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-800 mb-3">Language Settings</h4>
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-gray-600" />
                    <select className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                      <option>English</option>
                      <option>Hindi</option>
                      <option>Marathi</option>
                      <option>Tamil</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-800 mb-3">Data Backup</h4>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm text-gray-600">Last backup: 2 hours ago</p>
                      <p className="text-sm text-gray-600">Next backup: Today at 11:00 PM</p>
                    </div>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                      Backup Now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;