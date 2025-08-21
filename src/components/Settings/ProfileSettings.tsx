import React, { useState, useEffect } from 'react';
import { Save, User, Mail, Phone, Award, Shield, DollarSign } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { authService } from '../../services/authService';
import { Profile, Role } from '../../types';
import { toTitleCase } from '../../utils/stringUtils';

const ProfileSettings: React.FC = () => {
  const { user, tryLoadLocalProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    specialization: '',
    qualification: '',
    registrationNo: '',
    consultationFee: '',
    followUpFee: '',
    emergencyFee: '',
    isOpenForConsultation: true
  });

  useEffect(() => {
    if (user) {
      setFormData({
        name: toTitleCase(user.name),
        email: user.email,
        phone: user.phone || '',
        specialization: user.specialization || '',
        qualification: user.qualification || '',
        registrationNo: user.registrationNo || '',
        consultationFee: user.consultationFee?.toString() || '',
        followUpFee: user.followUpFee?.toString() || '',
        emergencyFee: user.emergencyFee?.toString() || '',
        isOpenForConsultation: user.isOpenForConsultation ?? true
      });
    }
    loadRoles();
  }, [user]);

  const loadRoles = async () => {
    try {
      const rolesData = await authService.getRoles();
      setRoles(rolesData);
    } catch (error) {
      console.error('Error loading roles:', error);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    try {
      setSaving(true);
      const updateData = {
        ...formData,
        name: toTitleCase(formData.name),
        consultationFee: formData.consultationFee ? parseFloat(formData.consultationFee) : undefined,
        followUpFee: formData.followUpFee ? parseFloat(formData.followUpFee) : undefined,
        emergencyFee: formData.emergencyFee ? parseFloat(formData.emergencyFee) : undefined,
        isOpenForConsultation: formData.isOpenForConsultation
      };
      await authService.updateProfile(user.id, updateData);
      
      // Refresh the user profile in the application state
      tryLoadLocalProfile();
      
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Please log in to access profile settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">Profile Settings</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Profile Information */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <User className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Personal Information</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg">
              <Shield className="w-4 h-4 text-gray-500" />
              <span className="text-gray-700">{user.roleName || 'No role assigned'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Professional Information */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <Award className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">Professional Information</h3>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <h4 className="text-md font-medium text-gray-800 mb-4">Professional Details</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label>
              <input
                type="text"
                value={formData.specialization}
                onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                placeholder="e.g., General Medicine, Cardiology"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Qualification</label>
              <input
                type="text"
                value={formData.qualification}
                onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                placeholder="e.g., MBBS, MD, MS"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number</label>
              <input
                type="text"
                value={formData.registrationNo}
                onChange={(e) => setFormData({ ...formData, registrationNo: e.target.value })}
                placeholder="Medical council registration number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Doctor-Specific Consultation Fees */}
      {(user.roleName?.toLowerCase() === 'doctor' || user.roleName?.toLowerCase() === 'admin') && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center gap-2 mb-6">
            <DollarSign className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-semibold text-gray-800">My Consultation Fees</h3>
          </div>
          
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> Set your personal consultation fees here. If not set, the clinic's default fees will be used.
              Leave fields empty to use clinic defaults.
            </p>
          </div>

          {/* Open for Consultation Checkbox */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isOpenForConsultation"
                checked={formData.isOpenForConsultation}
                onChange={(e) => setFormData({ ...formData, isOpenForConsultation: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <label htmlFor="isOpenForConsultation" className="font-medium text-yellow-800">
                  Open for Consultation
                </label>
                <p className="text-sm text-yellow-700">
                  Check this box to appear in doctor selection lists for appointments and visits. 
                  Uncheck to remove yourself from consultation availability.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">General Consultation (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.consultationFee}
                onChange={(e) => setFormData({ ...formData, consultationFee: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={user.clinic?.consultationFee ? `Clinic default: ₹${user.clinic.consultationFee}` : 'Enter your fee'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Consultation (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.followUpFee}
                onChange={(e) => setFormData({ ...formData, followUpFee: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={user.clinic?.followUpFee ? `Clinic default: ₹${user.clinic.followUpFee}` : 'Enter your fee'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Consultation (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.emergencyFee}
                onChange={(e) => setFormData({ ...formData, emergencyFee: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={user.clinic?.emergencyFee ? `Clinic default: ₹${user.clinic.emergencyFee}` : 'Enter your fee'}
              />
            </div>
          </div>
        </div>
      )}

      {/* Account Status */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Account & Clinic Information</h3>
        
        <div className="space-y-3">
          {/* Clinic Information */}
          {user.clinic && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">Clinic Details</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-blue-600 font-medium">Name:</span> {user.clinic.clinicName}
                </div>
                <div>
                  <span className="text-blue-600 font-medium">Phone:</span> {user.clinic.phone}
                </div>
                <div className="md:col-span-2">
                  <span className="text-blue-600 font-medium">Address:</span> {user.clinic.address}
                </div>
              </div>
            </div>
          )}
          
          <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-green-800 font-medium">Account Active</span>
            </div>
            <span className="text-green-600 text-sm">Verified</span>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <span className="text-blue-800">Email Verified</span>
            </div>
            <span className="text-blue-600 text-sm">✓</span>
          </div>
          
          <div className="text-sm text-gray-600">
            <p>Account created: {user.createdAt.toLocaleDateString()}</p>
            <p>Last updated: {user.updatedAt.toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettings;