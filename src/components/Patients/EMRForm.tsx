import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Calendar, Zap } from 'lucide-react';
import { Patient, Visit, Prescription, Symptom, Diagnosis, TestOrdered, Profile, PhysicalExamination, VoiceTranscript } from '../../types';
import PhysicalExaminationSection from './PhysicalExaminationSection';
import VoiceRecorder from './VoiceRecorder';
import { getCurrentProfile } from '../../services/profileService';
import { visitService } from '../../services/visitService';
import { masterDataService } from '../../services/masterDataService';
import { authService } from '../../services/authService';
import { presetService, PrescriptionPreset } from '../../services/presetService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';
import { toTitleCase } from '../../utils/stringUtils';

interface EMRFormProps {
  patient: Patient;
  existingVisit?: Visit;
  initialVisitDate: string;
  ocrData: {
    symptoms: string[];
    vitals: {
      temperature?: string;
      bloodPressure?: string;
      pulse?: string;
      weight?: string;
      height?: string;
    };
    diagnoses: string[];
    prescriptions: string[];
    advice: string[];
  };
  onSave: () => void;
}

const EMRForm: React.FC<EMRFormProps> = ({ patient, existingVisit, ocrData, initialVisitDate, onSave }) => {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [medicines, setMedicines] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [frequencies, setFrequencies] = useState<Array<{ code: string, label: string, timesPerDay: number | null }>>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState(existingVisit?.doctorId || '');
  const [visitDate, setVisitDate] = useState(initialVisitDate);
  const [physicalExamination, setPhysicalExamination] = useState<PhysicalExamination | undefined>(
    existingVisit?.physicalExamination
  );
  const [presets, setPresets] = useState<PrescriptionPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);

  // Helper function to convert existing visit data to form format
  const convertExistingVisitToFormData = (visit: Visit) => {
    return {
      chiefComplaint: visit.chiefComplaint || '',
      visitDate: new Date(visit.date).toISOString().split('T')[0],
      symptoms: visit.symptoms?.map(symptom => ({
        name: symptom.name,
        severity: symptom.severity,
        duration: symptom.duration,
        notes: symptom.notes
      })) || [],
      vitals: {
        temperature: visit.vitals.temperature?.toString() || '',
        bloodPressure: visit.vitals.bloodPressure || '',
        pulse: visit.vitals.pulse?.toString() || '',
        weight: visit.vitals.weight?.toString() || '',
        height: visit.vitals.height?.toString() || ''
      },
      diagnoses: visit.diagnoses?.map(diagnosis => ({
        name: diagnosis.name,
        icd10Code: diagnosis.icd10Code,
        isPrimary: diagnosis.isPrimary,
        notes: diagnosis.notes
      })) || [],
      prescriptions: visit.prescriptions || [],
      testsOrdered: visit.testsOrdered?.map(test => ({
        testName: test.testName,
        testType: test.testType,
        instructions: test.instructions,
        urgency: test.urgency,
        status: test.status,
        orderedDate: test.orderedDate,
        expectedDate: test.expectedDate
      })) || [],
      advice: visit.advice || [],
      adviceLanguage: (visit as any).adviceLanguage || 'english',
      adviceRegional: (visit as any).adviceRegional || '',
      followUpDate: visit.followUpDate ? new Date(visit.followUpDate).toISOString().split('T')[0] : '',
      doctorNotes: visit.doctorNotes || ''
    };
  };

  const [formData, setFormData] = useState({
    ...(existingVisit
      ? convertExistingVisitToFormData(existingVisit)
      : {
        chiefComplaint: '',
        visitDate: new Date().toISOString().split('T')[0],
        symptoms: ocrData.symptoms || [] as Omit<Symptom, 'id' | 'visitId' | 'createdAt'>[],
        vitals: {
          temperature: ocrData.vitals.temperature || '',
          bloodPressure: ocrData.vitals.bloodPressure || '',
          pulse: ocrData.vitals.pulse || '',
          weight: ocrData.vitals.weight || '',
          height: ocrData.vitals.height || ''
        },
        diagnoses: ocrData.diagnoses || [] as Omit<Diagnosis, 'id' | 'visitId' | 'createdAt'>[],
        prescriptions: ocrData.prescriptions?.map((prescription, index) => ({
          id: `prescription_${Date.now()}_${index}`,
          visitId: '',
          medicine: prescription.medicine,
          dosage: prescription.dosage,
          frequency: prescription.frequency,
          duration: prescription.duration,
          instructions: prescription.instructions,
          quantity: prescription.quantity,
          refills: prescription.refills,
          createdAt: new Date()
        })) || [] as Prescription[],
        testsOrdered: ocrData.testsOrdered || [] as Omit<TestOrdered, 'id' | 'visitId' | 'createdAt'>[],
        advice: ocrData.advice || [],
        adviceLanguage: 'english',
        adviceRegional: '',
        followUpDate: '',
        doctorNotes: ''
      }
    )
  });

  // Load medicines on component mount
  useEffect(() => {
    if (user) {
      loadMedicines();
      loadDoctors();
      loadFrequencies();
    }
  }, [user]);

  // Pre-select current user as doctor when doctors list is loaded
  useEffect(() => {
    if (user && doctors.length > 0 && !selectedDoctorId) {
      // Check if current user is in the doctors list
      const currentUserAsDoctor = doctors.find(doctor => doctor.id === user.id);
      if (currentUserAsDoctor) {
        setSelectedDoctorId(user.id);
        console.log('Pre-selected current user as doctor:', currentUserAsDoctor.name);
      } else {
        console.warn('Current user not found in doctors list. Available doctors:', doctors.map(d => ({ id: d.id, name: d.name, isOpenForConsultation: d.isOpenForConsultation })));
      }
    }
  }, [user, doctors, selectedDoctorId]);

  const loadMedicines = async () => {
    try {
      const clinicId = user?.clinicId;
      const medicineData = await masterDataService.getMedicines(clinicId);
      setMedicines(medicineData.map(m => m.name));
    } catch (error) {
      console.error('Error loading medicines:', error);
    }
  };

  const loadFrequencies = async () => {
    try {
      if (!user?.clinicId || !supabase) return;

      const { data: clinicData, error } = await supabase
        .from('clinic_settings')
        .select('prescription_frequencies')
        .eq('id', user.clinicId)
        .single();

      if (error) {
        console.error('Error loading frequencies:', error);
        // Fallback to default frequencies
        setFrequencies([
          { code: 'OD', label: 'OD (Once daily)', timesPerDay: 1 },
          { code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2 },
          { code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3 },
          { code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4 },
          { code: 'PRN', label: 'PRN (As needed)', timesPerDay: null }
        ]);
        return;
      }

      if (clinicData?.prescription_frequencies) {
        setFrequencies(clinicData.prescription_frequencies);
      }
    } catch (error) {
      console.error('Error loading frequencies:', error);
      // Set default frequencies on error
      setFrequencies([
        { code: 'OD', label: 'OD (Once daily)', timesPerDay: 1 },
        { code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2 },
        { code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3 },
        { code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4 },
        { code: 'PRN', label: 'PRN (As needed)', timesPerDay: null }
      ]);
    }
  };

  const loadDoctors = async () => {
    try {
      console.log('Loading doctors...');
      // Load doctors using authService to ensure clinic filtering
      const doctorsData = await authService.getDoctors();
      console.log('Loaded doctors:', doctorsData.length, doctorsData.map(d => ({ id: d.id, name: d.name, isOpenForConsultation: d.isOpenForConsultation })));
      setDoctors(doctorsData);
    } catch (error) {
      console.error('Error loading doctors:', error);
      // Set empty array on error to prevent undefined issues
      setDoctors([]);
    }
  };

  // Load prescription presets
  const loadPresets = async () => {
    setLoadingPresets(true);
    try {
      const presetsData = await presetService.getPresets();
      setPresets(presetsData);
    } catch (error) {
      console.error('Error loading presets:', error);
    } finally {
      setLoadingPresets(false);
    }
  };

  // Apply a preset to the form
  const applyPreset = async (preset: PrescriptionPreset) => {
    // Track usage
    presetService.incrementUsage(preset.id).catch(() => { });

    // Convert preset medicines to prescriptions
    const newPrescriptions: Prescription[] = preset.presetData.medicines.map((med, index) => ({
      id: `preset_${Date.now()}_${index}`,
      visitId: '',
      medicine: med.medicine,
      dosage: med.dosage,
      frequency: med.frequency,
      duration: med.duration,
      instructions: med.instructions,
      quantity: undefined,
      refills: undefined,
      createdAt: new Date()
    }));

    // Update form data - append to existing prescriptions and advice
    setFormData(prev => ({
      ...prev,
      prescriptions: [...prev.prescriptions, ...newPrescriptions],
      advice: [...prev.advice, ...preset.presetData.advice],
      followUpDate: preset.presetData.followUpDays
        ? new Date(Date.now() + preset.presetData.followUpDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : prev.followUpDate
    }));
  };

  // Load presets when component mounts
  useEffect(() => {
    loadPresets();
  }, []);

  const addSymptom = () => {
    setFormData(prev => ({
      ...prev,
      symptoms: [...prev.symptoms, {
        name: '',
        severity: undefined as 'mild' | 'moderate' | 'severe' | undefined,
        duration: undefined,
        notes: undefined
      }]
    }));
  };

  const updateSymptom = (index: number, field: keyof Omit<Symptom, 'id' | 'visitId' | 'createdAt'>, value: string) => {
    setFormData(prev => ({
      ...prev,
      symptoms: prev.symptoms.map((symptom, i) => i === index ? { ...symptom, [field]: value } : symptom)
    }));
  };

  const removeSymptom = (index: number) => {
    setFormData(prev => ({
      ...prev,
      symptoms: prev.symptoms.filter((_, i) => i !== index)
    }));
  };

  const addDiagnosis = () => {
    setFormData(prev => ({
      ...prev,
      diagnoses: [...prev.diagnoses, {
        name: '',
        icd10Code: undefined,
        isPrimary: false,
        notes: undefined
      }]
    }));
  };

  const updateDiagnosis = (index: number, field: keyof Omit<Diagnosis, 'id' | 'visitId' | 'createdAt'>, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      diagnoses: prev.diagnoses.map((diagnosis, i) => i === index ? { ...diagnosis, [field]: value } : diagnosis)
    }));
  };

  const removeDiagnosis = (index: number) => {
    setFormData(prev => ({
      ...prev,
      diagnoses: prev.diagnoses.filter((_, i) => i !== index)
    }));
  };

  const addPrescription = () => {
    const newPrescription: Prescription = {
      id: `prescription_${Date.now()}`,
      visitId: '',
      medicine: '',
      dosage: '1 tablet',
      frequency: 'BD',
      duration: '5 days',
      instructions: 'After meals',
      quantity: undefined,
      refills: undefined,
      createdAt: new Date()
    };
    setFormData(prev => ({
      ...prev,
      prescriptions: [...prev.prescriptions, newPrescription]
    }));
  };

  const updatePrescription = (index: number, field: keyof Prescription, value: string) => {
    setFormData(prev => ({
      ...prev,
      prescriptions: prev.prescriptions.map((prescription, i) =>
        i === index ? { ...prescription, [field]: value } : prescription
      )
    }));
  };

  const removePrescription = (index: number) => {
    setFormData(prev => ({
      ...prev,
      prescriptions: prev.prescriptions.filter((_, i) => i !== index)
    }));
  };

  const addTestOrdered = () => {
    setFormData(prev => ({
      ...prev,
      testsOrdered: [...prev.testsOrdered, {
        testName: '',
        testType: 'lab' as 'lab' | 'radiology' | 'other',
        instructions: undefined,
        urgency: 'routine' as 'routine' | 'urgent' | 'stat',
        status: 'ordered' as 'ordered' | 'sample_collected' | 'in_progress' | 'completed' | 'cancelled',
        orderedDate: new Date(),
        expectedDate: undefined
      }]
    }));
  };

  const updateTestOrdered = (index: number, field: keyof Omit<TestOrdered, 'id' | 'visitId' | 'createdAt'>, value: string | Date) => {
    setFormData(prev => ({
      ...prev,
      testsOrdered: prev.testsOrdered.map((test, i) => i === index ? { ...test, [field]: value } : test)
    }));
  };

  const removeTestOrdered = (index: number) => {
    setFormData(prev => ({
      ...prev,
      testsOrdered: prev.testsOrdered.filter((_, i) => i !== index)
    }));
  };

  const addAdvice = () => {
    setFormData(prev => ({
      ...prev,
      advice: [...prev.advice, '']
    }));
  };

  const updateAdvice = (index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      advice: prev.advice.map((advice, i) => i === index ? value : advice)
    }));
  };

  const removeAdvice = (index: number) => {
    setFormData(prev => ({
      ...prev,
      advice: prev.advice.filter((_, i) => i !== index)
    }));
  };

  const handleSave = async () => {
    if (!user) { // user from useAuth()
      alert('You must be logged in to save a visit');
      return;
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      alert('User not assigned to a clinic. Cannot save visit.');
      return;
    }


    try {
      setSaving(true);

      const visitData: Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'> = {
        patientId: patient.id,
        doctorId: selectedDoctorId || null,
        appointmentId: existingVisit?.appointmentId || undefined,
        date: new Date(formData.visitDate),
        chiefComplaint: formData.chiefComplaint,

        symptoms: formData.symptoms.filter(
          (s) => typeof s.name === 'string' && s.name.trim() !== ''
        ),

        vitals: {
          temperature: formData.vitals.temperature ? parseFloat(formData.vitals.temperature) : undefined,
          bloodPressure: formData.vitals.bloodPressure || undefined,
          pulse: formData.vitals.pulse ? parseInt(formData.vitals.pulse) : undefined,
          weight: formData.vitals.weight ? parseFloat(formData.vitals.weight) : undefined,
          height: formData.vitals.height ? parseFloat(formData.vitals.height) : undefined,
          respiratoryRate: undefined,
          oxygenSaturation: undefined
        },

        diagnoses: formData.diagnoses.filter(
          (d) => typeof d.name === 'string' && d.name.trim() !== ''
        ),

        prescriptions: formData.prescriptions.filter(
          (p) => typeof p.medicine === 'string' && p.medicine.trim() !== ''
        ),

        testsOrdered: formData.testsOrdered.filter(
          (t) => typeof t.testName === 'string' && t.testName.trim() !== ''
        ),

        testResults: existingVisit?.testResults || [],

        advice: formData.advice.filter(
          (a) => typeof a === 'string' && a.trim() !== ''
        ),

        adviceLanguage: formData.adviceLanguage || 'english',
        adviceRegional: formData.adviceRegional || '',

        followUpDate: formData.followUpDate ? new Date(formData.followUpDate) : undefined,

        doctorNotes: formData.doctorNotes,
        physicalExamination: physicalExamination,
        caseImageUrl: existingVisit?.caseImageUrl || undefined
      };

      if (existingVisit) {
        // Update existing visit
        const updatedVisit = await visitService.updateVisit(existingVisit.id, visitData);
        console.log('Visit updated successfully:', updatedVisit);
        alert('Visit updated successfully!');
      } else {
        // Create new visit
        const savedVisit = await visitService.addVisit(visitData);
        console.log('Visit saved successfully:', savedVisit);
        alert('Visit saved successfully!');
      }

      onSave();

    } catch (error) {
      console.error('Error saving visit:', error);
      alert(error instanceof Error ? error.message : `Failed to ${existingVisit ? 'update' : 'save'} visit. Please try again.`);
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-center text-gray-600">Please log in to create EMR entries.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-800">
          {existingVisit ? 'Edit Visit' : 'Create EMR Entry'}
        </h3>
        <div className="text-sm text-gray-600">
          Patient: <span className="font-medium">{toTitleCase(patient.name)}</span>
        </div>
      </div>

      {/* Doctor Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Attending Doctor *</label>
        <select
          required
          value={selectedDoctorId}
          onChange={(e) => setSelectedDoctorId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Select a doctor</option>
          {doctors.map(doctor => (
            <option key={doctor.id} value={doctor.id}>
              {toTitleCase(doctor.name || 'Unknown Doctor')} {doctor.specialization && `- ${doctor.specialization}`}
            </option>
          ))}
        </select>
        {doctors.length === 0 && (
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-orange-600">
              No doctors found in your clinic. Please contact your administrator to add doctors.
            </p>
            <button
              type="button"
              onClick={loadDoctors}
              className="text-xs text-blue-600 hover:text-blue-700 underline"
            >
              Reload Doctors
            </button>
          </div>
        )}
      </div>

      {/* Visit Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Date</label>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Chief Complaint */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Chief Complaint</label>
        <textarea
          value={formData.chiefComplaint}
          onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Patient's main complaint..."
        />
      </div>

      {/* Visit Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Date</label>
        <input
          type="date"
          value={formData.visitDate}
          onChange={(e) => setFormData({ ...formData, visitDate: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Symptoms */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Symptoms</label>
          <button
            onClick={addSymptom}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {formData.symptoms.map((symptom, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={symptom.name}
                  onChange={(e) => updateSymptom(index, 'name', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Symptom name..."
                />
                <select
                  value={symptom.severity || ''}
                  onChange={(e) => updateSymptom(index, 'severity', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select severity</option>
                  <option value="mild">Mild</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                </select>
                <input
                  type="text"
                  value={symptom.duration || ''}
                  onChange={(e) => updateSymptom(index, 'duration', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Duration..."
                />
              </div>
              <button
                onClick={() => removeSymptom(index)}
                className="p-2 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Vitals */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Vitals</label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Temperature</label>
            <input
              type="text"
              value={formData.vitals.temperature}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, temperature: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="98.6°F"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Blood Pressure</label>
            <input
              type="text"
              value={formData.vitals.bloodPressure}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, bloodPressure: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="120/80"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Pulse</label>
            <input
              type="text"
              value={formData.vitals.pulse}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, pulse: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="72 BPM"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Weight</label>
            <input
              type="text"
              value={formData.vitals.weight}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, weight: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="70 kg"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Height</label>
            <input
              type="text"
              value={formData.vitals.height}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, height: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="170 cm"
            />
          </div>
        </div>
      </div>

      {/* Physical Examination - AI Powered */}
      <PhysicalExaminationSection
        examination={physicalExamination}
        onChange={setPhysicalExamination}
        doctorSpecialization={doctors.find(d => d.id === selectedDoctorId)?.specialization}
        chiefComplaint={formData.chiefComplaint}
        symptoms={formData.symptoms.map(s => typeof s === 'string' ? s : s.name).filter(Boolean)}
        patientAge={patient.age}
        patientGender={patient.gender}
      />

      {/* Voice Recording - AI Transcription */}
      <VoiceRecorder
        visitId={existingVisit?.id}
        chiefComplaint={formData.chiefComplaint}
        currentSymptoms={formData.symptoms.map(s => typeof s === 'string' ? s : s.name).filter(Boolean)}
        onApplyToForm={(data: VoiceTranscript['extractedData']) => {
          if (!data) return;

          // Apply extracted symptoms with enhanced details
          if (data.symptoms?.length) {
            const newSymptoms = data.symptoms.map(s => {
              // Build notes from additional details
              const notesParts: string[] = [];
              if (s.location) notesParts.push(`Location: ${s.location}`);
              if (s.pattern) notesParts.push(`Pattern: ${s.pattern}`);
              if (s.character) notesParts.push(`Character: ${s.character}`);
              if (s.aggravatingFactors) notesParts.push(`Worse with: ${s.aggravatingFactors}`);
              if (s.relievingFactors) notesParts.push(`Better with: ${s.relievingFactors}`);

              return {
                name: s.name,
                severity: (s.severity as 'mild' | 'moderate' | 'severe') || undefined,
                duration: s.duration || undefined,
                notes: notesParts.length > 0 ? notesParts.join('; ') : undefined
              };
            });
            setFormData(prev => ({
              ...prev,
              symptoms: [...prev.symptoms, ...newSymptoms]
            }));
          }

          // Apply extracted diagnoses (handle both string and object format)
          if (data.diagnoses?.length) {
            const newDiagnoses = data.diagnoses.map(d => {
              if (typeof d === 'string') {
                return {
                  name: d,
                  icd10Code: undefined,
                  isPrimary: false,
                  notes: undefined
                };
              }
              return {
                name: d.name,
                icd10Code: d.icd10Code || undefined,
                isPrimary: d.isPrimary || false,
                notes: d.notes || undefined
              };
            });
            setFormData(prev => ({
              ...prev,
              diagnoses: [...prev.diagnoses, ...newDiagnoses]
            }));
          }

          // Apply extracted vitals
          if (data.vitals) {
            setFormData(prev => ({
              ...prev,
              vitals: {
                ...prev.vitals,
                temperature: data.vitals?.temperature || prev.vitals.temperature,
                bloodPressure: data.vitals?.bloodPressure || prev.vitals.bloodPressure,
                pulse: data.vitals?.pulse || prev.vitals.pulse,
                weight: data.vitals?.weight || prev.vitals.weight
              }
            }));
          }

          // Apply extracted prescriptions
          if (data.prescriptions?.length) {
            const newPrescriptions = data.prescriptions.map(p => ({
              medicine: p.medicine,
              dosage: p.dosage || '',
              frequency: p.frequency || '',
              duration: p.duration || '',
              instructions: p.instructions || '',
              quantity: '',
              refills: 0
            }));
            setFormData(prev => ({
              ...prev,
              prescriptions: [...prev.prescriptions, ...newPrescriptions]
            }));
          }

          // Apply extracted advice
          if (data.advice?.length) {
            setFormData(prev => ({
              ...prev,
              advice: [...prev.advice, ...data.advice!]
            }));
          }

          // Apply follow-up if mentioned
          if (data.followUp?.duration) {
            // Try to parse follow-up duration into date
            const durationMatch = data.followUp.duration.match(/(\d+)\s*(day|week|month)/i);
            if (durationMatch) {
              const [, num, unit] = durationMatch;
              const futureDate = new Date();
              if (unit.toLowerCase() === 'day') futureDate.setDate(futureDate.getDate() + parseInt(num));
              else if (unit.toLowerCase() === 'week') futureDate.setDate(futureDate.getDate() + parseInt(num) * 7);
              else if (unit.toLowerCase() === 'month') futureDate.setMonth(futureDate.getMonth() + parseInt(num));

              setFormData(prev => ({
                ...prev,
                followUpDate: futureDate.toISOString().split('T')[0]
              }));
            }
          }
        }}
      />

      {/* Diagnosis */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Diagnosis</label>
          <button
            onClick={addDiagnosis}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {formData.diagnoses.map((diagnosis, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={diagnosis.name}
                  onChange={(e) => updateDiagnosis(index, 'name', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Diagnosis name..."
                />
                <input
                  type="text"
                  value={diagnosis.icd10Code || ''}
                  onChange={(e) => updateDiagnosis(index, 'icd10Code', e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="ICD-10 Code (optional)"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={diagnosis.isPrimary}
                    onChange={(e) => updateDiagnosis(index, 'isPrimary', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label className="text-sm text-gray-600">Primary</label>
                </div>
              </div>
              <button
                onClick={() => removeDiagnosis(index)}
                className="p-2 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Prescriptions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Prescriptions</label>
            {/* Preset Selector */}
            {presets.length > 0 && (
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <select
                  value=""
                  onChange={(e) => {
                    const preset = presets.find(p => p.id === e.target.value);
                    if (preset) applyPreset(preset);
                  }}
                  className="text-xs px-2 py-1 border border-amber-300 bg-amber-50 rounded focus:ring-2 focus:ring-amber-500 text-amber-800"
                >
                  <option value="">Quick Apply Preset...</option>
                  {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} ({preset.presetData.medicines.length} medicines, {preset.presetData.advice.length} advice)
                    </option>
                  ))}
                </select>
              </div>
            )}
            {loadingPresets && <span className="text-xs text-gray-400">Loading presets...</span>}
          </div>
          <button
            onClick={addPrescription}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-4">
          {formData.prescriptions.map((prescription, index) => (
            <div key={prescription.id} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Medicine</label>
                  <input
                    list={`medicines-${index}`}
                    type="text"
                    value={prescription.medicine}
                    onChange={(e) => updatePrescription(index, 'medicine', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Medicine name"
                  />
                  <datalist id={`medicines-${index}`}>
                    {medicines.map(medicine => (
                      <option key={medicine} value={medicine} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Dosage</label>
                  <input
                    type="text"
                    value={prescription.dosage}
                    onChange={(e) => updatePrescription(index, 'dosage', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="1 tablet"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Frequency</label>
                  <select
                    value={prescription.frequency}
                    onChange={(e) => updatePrescription(index, 'frequency', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {frequencies.length > 0 ? (
                      frequencies.map(freq => (
                        <option key={freq.code} value={freq.code}>{freq.label}</option>
                      ))
                    ) : (
                      <>
                        <option value="OD">OD (Once daily)</option>
                        <option value="BD">BD (Twice daily)</option>
                        <option value="TID">TID (Three times daily)</option>
                        <option value="QID">QID (Four times daily)</option>
                        <option value="PRN">PRN (As needed)</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Duration</label>
                  <input
                    type="text"
                    value={prescription.duration}
                    onChange={(e) => updatePrescription(index, 'duration', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="5 days"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-600 mb-1">Instructions</label>
                    <input
                      type="text"
                      value={prescription.instructions}
                      onChange={(e) => updatePrescription(index, 'instructions', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="After meals"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => removePrescription(index)}
                      className="p-2 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tests Ordered */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Tests Ordered</label>
          <button
            onClick={addTestOrdered}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-4">
          {formData.testsOrdered.map((test, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Test Name</label>
                  <input
                    type="text"
                    value={test.testName}
                    onChange={(e) => updateTestOrdered(index, 'testName', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Test name"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Type</label>
                  <select
                    value={test.testType}
                    onChange={(e) => updateTestOrdered(index, 'testType', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="lab">Lab</option>
                    <option value="radiology">Radiology</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Urgency</label>
                  <select
                    value={test.urgency}
                    onChange={(e) => updateTestOrdered(index, 'urgency', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-600 mb-1">Instructions</label>
                    <input
                      type="text"
                      value={test.instructions || ''}
                      onChange={(e) => updateTestOrdered(index, 'instructions', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Special instructions"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => removeTestOrdered(index)}
                      className="p-2 text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Advice */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Advice</label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Regional Language:</label>
              <select
                value={formData.adviceLanguage || 'english'}
                onChange={(e) => setFormData({ ...formData, adviceLanguage: e.target.value })}
                className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="english">English</option>
                <option value="hindi">हिंदी (Hindi)</option>
                <option value="bengali">বাংলা (Bengali)</option>
                <option value="gujarati">ગુજરાતી (Gujarati)</option>
                <option value="tamil">தமிழ் (Tamil)</option>
                <option value="telugu">తెలుగు (Telugu)</option>
                <option value="kannada">ಕನ್ನಡ (Kannada)</option>
                <option value="malayalam">മലയാളം (Malayalam)</option>
                <option value="marathi">मराठी (Marathi)</option>
                <option value="punjabi">ਪੰਜਾਬੀ (Punjabi)</option>
                <option value="oriya">ଓଡ଼ିଆ (Oriya)</option>
              </select>
            </div>
          </div>
          <button
            onClick={addAdvice}
            className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="space-y-2">
          {formData.advice.map((advice, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={advice}
                onChange={(e) => updateAdvice(index, e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter advice..."
              />
              <button
                onClick={() => removeAdvice(index)}
                className="p-2 text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Regional Language Advice */}
        {formData.adviceLanguage && formData.adviceLanguage !== 'english' && (
          <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <label className="block text-sm font-medium text-amber-800 mb-2">
              🗣️ Advice in {formData.adviceLanguage.charAt(0).toUpperCase() + formData.adviceLanguage.slice(1)} (for Patient PDF)
            </label>
            <textarea
              value={formData.adviceRegional || ''}
              onChange={(e) => setFormData({ ...formData, adviceRegional: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder={`Type advice in ${formData.adviceLanguage} for the patient PDF...`}
            />
            <p className="text-xs text-amber-600 mt-1">
              💡 This will appear in the patient's prescription PDF in their preferred language
            </p>
          </div>
        )}
      </div>

      {/* Follow-up Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Date</label>
        <div className="relative">
          <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="date"
            value={formData.followUpDate}
            onChange={(e) => setFormData({ ...formData, followUpDate: e.target.value })}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Doctor Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Doctor's Notes</label>
        <textarea
          value={formData.doctorNotes}
          onChange={(e) => setFormData({ ...formData, doctorNotes: e.target.value })}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Additional notes..."
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          <Save className="w-5 h-5" />
          {saving ? (existingVisit ? 'Updating...' : 'Saving...') : (existingVisit ? 'Update Visit' : 'Save Visit')}
        </button>
      </div>
    </div>
  );
};

export default EMRForm;