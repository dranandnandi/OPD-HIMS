import React, { useState, useEffect } from 'react';
import { X, Shield, CheckCircle } from 'lucide-react';
import { toTitleCase } from '../../utils/stringUtils';
import ABHALinkModal from './ABHALinkModal';
import { abhaService, ABHAProfile } from '../../services/abhaService';

interface PatientModalProps {
  patient: {
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: 'male' | 'female' | 'other';
    address: string;
    emergency_contact?: string;
    blood_group?: string;
    allergies?: string[];
    referred_by?: string;
    abha_number?: string;
    abha_address?: string;
  } | null;
  clinicId?: string;
  onSave: (patient: {
    name: string;
    phone: string;
    age: number;
    gender: 'male' | 'female' | 'other';
    address: string;
    emergency_contact?: string;
    blood_group?: string;
    allergies?: string[];
    referred_by?: string;
  }) => void;
  onClose: () => void;
}

const PatientModal: React.FC<PatientModalProps> = ({ patient, clinicId, onSave, onClose }) => {
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showABHAModal, setShowABHAModal] = useState(false);
  const [linkedABHA, setLinkedABHA] = useState<{ number: string; address?: string } | null>(
    patient?.abha_number ? { number: patient.abha_number, address: patient.abha_address } : null
  );
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    age: '',
    gender: 'male' as 'male' | 'female' | 'other',
    address: '',
    emergency_contact: '',
    blood_group: '',
    allergies: '',
    referred_by: ''
  });

  useEffect(() => {
    if (patient) {
      setFormData({
        name: toTitleCase(patient.name || ''),
        phone: patient.phone || '',
        age: patient.age?.toString() || '',
        gender: patient.gender || 'male',
        address: patient.address || '',
        emergency_contact: patient.emergency_contact || '',
        blood_group: patient.blood_group || '',
        allergies: patient.allergies?.join(', ') || '',
        referred_by: patient.referred_by || ''
      });
    }
  }, [patient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);
    try {
      const patientData = {
        name: toTitleCase(formData.name),
        phone: formData.phone,
        age: parseInt(formData.age, 10),
        gender: formData.gender,
        address: formData.address,
        emergency_contact: formData.emergency_contact || undefined,
        blood_group: formData.blood_group || undefined,
        allergies: formData.allergies ? formData.allergies.split(',').map(a => a.trim()) : undefined,
        referred_by: formData.referred_by || undefined
      };

      await onSave(patientData);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'An error occurred while saving the patient');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-6 border-b mb-6">
          <h2>
            {patient ? 'Edit Patient' : 'Add New Patient'}
          </h2>
          <button
            onClick={onClose}
            className="p-3 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block mb-2">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-field"
              />
            </div>

            <div>
              <label className="block mb-2">
                Phone Number *
              </label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => {
                  setFormData({ ...formData, phone: e.target.value });
                  setFormError(null); // Clear error when phone changes
                }}
                className="input-field"
              />
            </div>

            <div>
              <label className="block mb-2">
                Age *
              </label>
              <input
                type="number"
                required
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                className="input-field"
              />
            </div>

            <div>
              <label className="block mb-2">
                Gender *
              </label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'male' | 'female' | 'other' })}
                className="input-field"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block mb-2">
                Emergency Contact
              </label>
              <input
                type="tel"
                value={formData.emergency_contact}
                onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
                className="input-field"
                placeholder="Emergency contact number"
              />
            </div>

            <div>
              <label className="block mb-2">
                Referred By
              </label>
              <input
                type="text"
                value={formData.referred_by}
                onChange={(e) => setFormData({ ...formData, referred_by: e.target.value })}
                className="input-field"
                placeholder="Doctor, clinic, or person who referred"
              />
            </div>

            <div>
              <label className="block mb-2">
                Blood Group
              </label>
              <select
                value={formData.blood_group}
                onChange={(e) => setFormData({ ...formData, blood_group: e.target.value })}
                className="input-field"
              >
                <option value="">Select Blood Group</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block mb-2">
              Address *
            </label>
            <textarea
              required
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={3}
              className="input-field resize-none"
            />
          </div>

          <div>
            <label className="block mb-2">
              Allergies (comma-separated)
            </label>
            <input
              type="text"
              value={formData.allergies}
              onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
              placeholder="e.g., Penicillin, Sulfa drugs"
              className="input-field"
            />
          </div>

          {formError && (
            <p className="text-red-600 text-sm">{formError}</p>
          )}

          {/* ABHA Section — only shown when editing an existing patient */}
          {patient && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-600" />
                <span className="font-medium text-sm">ABHA ID (Ayushman Bharat)</span>
              </div>
              {linkedABHA ? (
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-700">ABHA Linked</p>
                    <p className="text-xs font-mono text-gray-600">
                      {abhaService.formatAbhaNumber(linkedABHA.number)}
                    </p>
                    {linkedABHA.address && (
                      <p className="text-xs text-gray-500">{linkedABHA.address}</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Not linked yet</p>
                  <button
                    type="button"
                    onClick={() => setShowABHAModal(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium border border-blue-600 hover:border-blue-800 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Link ABHA ID
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-4 pt-6">
            <button
              type="button"
              onClick={onClose}
              className="secondary-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="primary-button disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : patient ? 'Update Patient' : 'Create Patient'}
            </button>
          </div>
        </form>
      </div>

      {showABHAModal && patient && (
        <ABHALinkModal
          patientId={patient.id}
          patientName={patient.name}
          patientMobile={patient.phone}
          clinicId={clinicId}
          onLinked={(profile: ABHAProfile) => {
            setLinkedABHA({ number: profile.abhaNumber, address: profile.abhaAddress });
            setShowABHAModal(false);
          }}
          onClose={() => setShowABHAModal(false)}
        />
      )}
    </div>
  );
};

export default PatientModal;
