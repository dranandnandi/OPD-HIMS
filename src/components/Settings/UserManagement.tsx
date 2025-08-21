import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Shield, User, Mail, Phone, X, Save, DollarSign } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { authService } from '../../services/authService';
import { Profile, Role } from '../../types';
import { toTitleCase } from '../../utils/stringUtils';

const UserManagement: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    roleId: '',
    roleName: '',
    permissions: '',
    phone: '',
    specialization: '',
    qualification: '',
    registrationNo: '',
    consultationFee: '',
    followUpFee: '',
    emergencyFee: '',
    isOpenForConsultation: false
  });

  useEffect(() => {
    if (user && hasPermission('user_management')) {
      loadData();
    }
  }, [user]);

  useEffect(() => {
    if (selectedUser) {
      setFormData({
        email: selectedUser.email,
        password: '', // Never pre-fill password
        name: toTitleCase(selectedUser.name),
        roleId: selectedUser.roleId,
        roleName: selectedUser.roleName,
        permissions: selectedUser.permissions.join(', '),
        phone: selectedUser.phone || '',
        specialization: selectedUser.specialization || '',
        qualification: selectedUser.qualification || '',
        registrationNo: selectedUser.registrationNo || '',
        consultationFee: selectedUser.consultationFee?.toString() || '',
        followUpFee: selectedUser.followUpFee?.toString() || '',
        emergencyFee: selectedUser.emergencyFee?.toString() || '',
        isOpenForConsultation: selectedUser.isOpenForConsultation ?? false
      });
    } else {
      setFormData({
        email: '',
        password: '',
        name: '',
        roleId: '',
        roleName: '',
        permissions: '',
        phone: '',
        specialization: '',
        qualification: '',
        registrationNo: '',
        consultationFee: '',
        followUpFee: '',
        emergencyFee: '',
        isOpenForConsultation: false
      });
    }
  }, [selectedUser]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersData, rolesData] = await Promise.all([
        authService.getUsers(),
        authService.getRoles()
      ]);
      setUsers(usersData);
      setRoles(rolesData);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load user data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async () => {
    try {
      setSaving(true);
      
      if (selectedUser) {
        // Update existing user
        await authService.updateProfile(selectedUser.id, {
          name: toTitleCase(formData.name),
          email: formData.email,
          phone: formData.phone,
          specialization: formData.specialization,
          qualification: formData.qualification,
          registrationNo: formData.registrationNo,
          roleId: formData.roleId,
          consultationFee: formData.consultationFee ? parseFloat(formData.consultationFee) : undefined,
          followUpFee: formData.followUpFee ? parseFloat(formData.followUpFee) : undefined,
          emergencyFee: formData.emergencyFee ? parseFloat(formData.emergencyFee) : undefined,
          isOpenForConsultation: formData.isOpenForConsultation
        });
      } else {
        // Create new user
        if (!formData.password) {
          alert('Password is required for new users');
          return;
        }
        // Pass the current user's clinic ID to new users
        await authService.createUser({
          ...formData,
          name: toTitleCase(formData.name),
          clinicId: user?.clinicId,
          consultationFee: formData.consultationFee ? parseFloat(formData.consultationFee) : undefined,
          followUpFee: formData.followUpFee ? parseFloat(formData.followUpFee) : undefined,
          emergencyFee: formData.emergencyFee ? parseFloat(formData.emergencyFee) : undefined,
          isOpenForConsultation: formData.isOpenForConsultation
        });
      }
      
      setShowModal(false);
      setSelectedUser(null);
      await loadData(); // Reload users
      alert(`User ${selectedUser ? 'updated' : 'created'} successfully!`);
    } catch (error) {
      console.error('Error saving user:', error);
      
      // Handle specific error cases with user-friendly messages
      if (error instanceof Error) {
        if (error.message.includes('User already registered') || error.message.includes('user_already_exists')) {
          alert(`A user with email "${formData.email}" already exists in the system. Please use a different email address or edit the existing user instead.`);
        } else {
          alert(error.message);
        }
      } else {
        alert('Failed to save user');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to deactivate this user? This action will prevent them from logging in but will preserve their data.')) return;
    
    try {
      await authService.deleteUser(userId);
      await loadData(); // Reload users
      alert('User deactivated successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Failed to deactivate user');
    }
  };

  const filteredUsers = users.filter(user =>
    (user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (roleFilter === '' || user.roleId === roleFilter)
  );

  const isDoctorRole = formData.roleName.toLowerCase() === 'doctor';

  if (!user || !hasPermission('user_management')) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">You don't have permission to access user management.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading users...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div className="sm:w-48">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Roles</option>
              {roles.map(role => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-800">System Users</h3>
        </div>

        <div className="divide-y divide-gray-200">
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center">
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No users found</p>
            </div>
          ) : (
            filteredUsers.map(user => (
              <div key={user.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-medium">
                        {user.name?.charAt(0)?.toUpperCase() ?? 'U'}
                      </span>
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-800">{toTitleCase(user.name)}</h4>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {user.phone}
                          </div>
                        )}
                        {user.isOpenForConsultation && (
                          <div className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                            <span className="text-xs text-green-600">Open for consultation</span>
                          </div>
                        )}
                          {user.role?.name.toLowerCase() === 'doctor' && user.consultationFee && (
                            <div className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              ₹{user.consultationFee}
                            </div>
                          )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Shield className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">{user.roleName || 'No role'}</span>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedUser(user);
                        setShowModal(true);
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        handleDeleteUser(user.id);
                      }}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Roles Summary */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">System Roles</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(role => (
            <div key={role.id} className="p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-blue-600" />
                <h4 className="font-medium text-gray-800">{role.name}</h4>
              </div>
              {role.description && (
                <p className="text-sm text-gray-600 mb-2">{role.description}</p>
              )}
              <div className="text-xs text-gray-500">
                {role.permissions.length} permissions
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold">
                {selectedUser ? 'Edit User' : 'Add New User'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedUser(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {!selectedUser && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Minimum 6 characters"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role *
                  </label>
                  <select
                    required
                    value={formData.roleId}
                    onChange={(e) => {
                      const selectedRole = roles.find(r => r.id === e.target.value);
                      setFormData({ 
                        ...formData, 
                        roleId: e.target.value,
                        roleName: selectedRole?.name || '',
                        permissions: selectedRole?.permissions.join(', ') || ''
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select a role</option>
                    {roles.map(role => (
                      <option key={role.id} value={role.id}>
                        {role.name} {role.description && `- ${role.description}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role Name
                  </label>
                  <input
                    type="text"
                    value={formData.roleName}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                    placeholder="Auto-filled from role selection"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Permissions
                  </label>
                  <input
                    type="text"
                    value={formData.permissions}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                    placeholder="Auto-filled from role selection"
                  />
                </div>
              </div>

              {/* Doctor-specific fields */}
              {(isDoctorRole || formData.roleName.toLowerCase() === 'admin') && (
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-lg font-medium text-gray-800 mb-4">
                    {isDoctorRole ? 'Doctor Information' : 'Admin Consultation Settings'}
                  </h3>
                  
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
                          Check this box to make this user available for patient consultations and appointments.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Specialization
                      </label>
                      <input
                        type="text"
                        value={formData.specialization}
                        onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., General Medicine, Cardiology"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Qualification
                      </label>
                      <input
                        type="text"
                        value={formData.qualification}
                        onChange={(e) => setFormData({ ...formData, qualification: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., MBBS, MD, MS"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Registration Number
                      </label>
                      <input
                        type="text"
                        value={formData.registrationNo}
                        onChange={(e) => setFormData({ ...formData, registrationNo: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Medical council registration number"
                      />
                    </div>
                  </div>
                  
                  {/* Doctor Consultation Fees */}
                  <div className="mt-6">
                    <div className="flex items-center gap-2 mb-4">
                      <DollarSign className="w-5 h-5 text-green-600" />
                      <h4 className="text-md font-medium text-gray-800">
                        {isDoctorRole ? 'Consultation Fees' : 'Admin Consultation Fees'}
                      </h4>
                    </div>
                    
                    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-700">
                        Set {isDoctorRole ? 'doctor' : 'admin'}-specific consultation fees. Leave empty to use clinic defaults.
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          General Consultation (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.consultationFee}
                          onChange={(e) => setFormData({ ...formData, consultationFee: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter consultation fee"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Follow-up Fee (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.followUpFee}
                          onChange={(e) => setFormData({ ...formData, followUpFee: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter follow-up fee"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Emergency Fee (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.emergencyFee}
                          onChange={(e) => setFormData({ ...formData, emergencyFee: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter emergency fee"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setSelectedUser(null);
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveUser}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : selectedUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;