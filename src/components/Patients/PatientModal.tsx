import React, { useState, useEffect } from 'react';
import { X, Shield, CheckCircle, AlertTriangle } from 'lucide-react';
import { toTitleCase } from '../../utils/stringUtils';
import { calculateAgeFromDob, todayForDobInput } from '../../utils/dateOfBirth';
import ABHALinkModal from './ABHALinkModal';
import ABHAVerifyModal from './ABHAVerifyModal';
import { abhaService, ABHAProfile } from '../../services/abhaService';
import { patientService } from '../../services/patientService';
import PatientDocumentsPanel from './PatientDocumentsPanel';

interface PatientModalProps {
  patient: {
    id: string;
    name: string;
    phone: string;
    age: number | null;
    date_of_birth?: string | null;
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
    date_of_birth?: string | null;
    gender: 'male' | 'female' | 'other';
    address: string;
    emergency_contact?: string;
    blood_group?: string;
    allergies?: string[];
    referred_by?: string;
  }) => void;
  onClose: () => void;
}

// `clinicId` stays in the props for existing call sites but is no longer read:
// the ABDM functions derive the clinic from the caller's JWT, because a
// client-supplied clinic id is forgeable (G-05).
const PatientModal: React.FC<PatientModalProps> = ({ patient, onSave, onClose }) => {
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Two ABHA paths: 'verify' (mobile OTP, spec 7.4) is the primary one — most
  // walk-ins already have an ABHA. 'create' (Aadhaar OTP, spec 3) is the
  // fallback for patients who do not, and the verify flow hands off to it.
  const [abhaFlow, setAbhaFlow] = useState<'none' | 'verify' | 'create'>('none');
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [linkedABHA, setLinkedABHA] = useState<{ number: string; address?: string } | null>(
    patient?.abha_number ? { number: patient.abha_number, address: patient.abha_address } : null
  );
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    age: '',
    date_of_birth: '',
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
        date_of_birth: patient.date_of_birth || '',
        gender: patient.gender || 'male',
        address: patient.address || '',
        emergency_contact: patient.emergency_contact || '',
        blood_group: patient.blood_group || '',
        allergies: patient.allergies?.join(', ') || '',
        referred_by: patient.referred_by || ''
      });
    }
  }, [patient]);

  // DOB is optional; when reception enters one it fills the age so both stay consistent.
  const handleDobChange = (dateOfBirth: string) => {
    const derivedAge = dateOfBirth ? calculateAgeFromDob(dateOfBirth) : null;
    setFormData((current) => ({
      ...current,
      date_of_birth: dateOfBirth,
      age: derivedAge !== null ? derivedAge.toString() : current.age
    }));
  };

  // Warn reception if a patient with the same phone already exists (only for new registrations).
  const checkForDuplicate = async () => {
    if (patient) return; // editing an existing patient — skip
    const phone = formData.phone.trim();
    if (phone.length < 10) {
      setDuplicateWarning(false);
      return;
    }
    setCheckingDuplicate(true);
    try {
      const exists = await patientService.checkIfPatientExistsByPhone(phone);
      setDuplicateWarning(exists);
    } catch {
      // Non-blocking: a failed lookup should never stop registration.
      setDuplicateWarning(false);
    } finally {
      setCheckingDuplicate(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (formData.date_of_birth && calculateAgeFromDob(formData.date_of_birth) === null) {
      setFormError('Please enter a valid date of birth that is not in the future.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    try {
      const patientData = {
        name: toTitleCase(formData.name),
        phone: formData.phone,
        age: parseInt(formData.age, 10),
        date_of_birth: formData.date_of_birth || null,
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

  /**
   * Withdraw ABHA consent (G-13).
   *
   * The server revokes every live consent artefact and clears the patient's
   * ABHA columns. Only the local view is reset here — the patient's ABHA
   * account itself is untouched and can be linked again later.
   */
  const handleUnlinkABHA = async () => {
    if (!patient) return;
    setUnlinkError('');
    setUnlinking(true);
    try {
      await abhaService.unlinkABHA(patient.id);
      setLinkedABHA(null);
      setConfirmUnlink(false);
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : 'Could not withdraw consent.');
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
                  setDuplicateWarning(false); // Re-check on next blur
                }}
                onBlur={checkForDuplicate}
                className="input-field"
              />
              {checkingDuplicate && (
                <p className="mt-1 text-xs text-gray-500">Checking for existing patient…</p>
              )}
              {duplicateWarning && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p className="text-xs">
                    A patient with this phone number already exists in this clinic. Please search
                    existing patients before creating a duplicate.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block mb-2">
                Date of Birth
              </label>
              <input
                type="date"
                max={todayForDobInput()}
                value={formData.date_of_birth}
                onChange={(e) => handleDobChange(e.target.value)}
                className="input-field"
              />
              <p className="mt-1 text-xs text-gray-500">Optional — fills the age automatically.</p>
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
                <div className="space-y-3">
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

                  {/*
                    Consent withdrawal (G-13). The patient must be able to take
                    it back, or the clinic can record consent but never honour
                    its withdrawal — a data-principal rights failure under DPDP.
                    Local only: the patient's ABHA itself is untouched.
                  */}
                  {unlinkError && <p className="text-xs text-red-600">{unlinkError}</p>}
                  {confirmUnlink ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-red-800">
                        Withdraw consent and remove this ABHA from {patient.name}'s record? Their
                        ABHA account is not affected and can be linked again later.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleUnlinkABHA}
                          disabled={unlinking}
                          className="text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5 disabled:opacity-60"
                        >
                          {unlinking ? 'Removing...' : 'Yes, withdraw consent'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmUnlink(false)}
                          disabled={unlinking}
                          className="text-xs text-gray-600 hover:text-gray-800 px-3 py-1.5"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setUnlinkError('');
                        setConfirmUnlink(true);
                      }}
                      className="text-xs text-red-600 hover:text-red-800 hover:underline"
                    >
                      Withdraw consent & unlink ABHA
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">Not linked yet</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Verify first: it is the faster path and needs no Aadhaar. */}
                    <button
                      type="button"
                      onClick={() => setAbhaFlow('verify')}
                      className="text-sm text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Verify existing ABHA
                    </button>
                    <button
                      type="button"
                      onClick={() => setAbhaFlow('create')}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium border border-blue-600 hover:border-blue-800 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Create with Aadhaar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Patient document upload portal (share link + view uploads) */}
          {patient && (
            <PatientDocumentsPanel
              patientId={patient.id}
              patientName={patient.name}
              patientPhone={patient.phone}
            />
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

      {abhaFlow === 'verify' && patient && (
        <ABHAVerifyModal
          patientId={patient.id}
          patientName={patient.name}
          patientMobile={patient.phone}
          onLinked={(profile: ABHAProfile) => {
            setLinkedABHA({ number: profile.abhaNumber, address: profile.abhaAddress });
          }}
          // The mobile has no ABHA — switch straight to creation rather than
          // making reception close one dialog and hunt for another button.
          onNoAbhaFound={() => setAbhaFlow('create')}
          onClose={() => setAbhaFlow('none')}
        />
      )}

      {abhaFlow === 'create' && patient && (
        <ABHALinkModal
          patientId={patient.id}
          patientName={patient.name}
          patientMobile={patient.phone}
          onLinked={(profile: ABHAProfile) => {
            setLinkedABHA({ number: profile.abhaNumber, address: profile.abhaAddress });
          }}
          onClose={() => setAbhaFlow('none')}
        />
      )}
    </div>
  );
};

export default PatientModal;
