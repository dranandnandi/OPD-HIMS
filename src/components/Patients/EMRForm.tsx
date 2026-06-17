import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, Trash2, Calendar, Zap, Image, Upload, Camera, Link, X, Loader2, Sparkles, Eye } from 'lucide-react';
import { Patient, Visit, Prescription, Symptom, Diagnosis, TestOrdered, Profile, PhysicalExamination, VoiceTranscript, VisitImage } from '../../types';
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
import { analyzeVisitImageWithAI } from '../../services/ocrService';

interface EMRFormProps {
  patient: Patient;
  existingVisit?: Visit;
  initialVisitDate: string;
  initialVisitTime?: string; // HH:mm from appointment, if created from appointment
  appointmentId?: string;    // Link visit to the appointment
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

const getCurrentLocalTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

const EMRForm: React.FC<EMRFormProps> = ({ patient, existingVisit, ocrData, initialVisitDate, initialVisitTime, appointmentId: appointmentIdProp, onSave }) => {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [medicines, setMedicines] = useState<string[]>([]);
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [frequencies, setFrequencies] = useState<Array<{ code: string, label: string, timesPerDay: number | null }>>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState(existingVisit?.doctorId || '');
  const [visitDate, setVisitDate] = useState(initialVisitDate);
  const [visitTime, setVisitTime] = useState<string>(() => {
    if (existingVisit) {
      const d = new Date(existingVisit.date);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return initialVisitTime || getCurrentLocalTime();
  });
  const [physicalExamination, setPhysicalExamination] = useState<PhysicalExamination | undefined>(
    existingVisit?.physicalExamination
  );
  const [presets, setPresets] = useState<PrescriptionPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [visitImages, setVisitImages] = useState<VisitImage[]>(existingVisit?.visitImages || []);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [analyzingImageId, setAnalyzingImageId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

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

  // ── Image helpers ──────────────────────────────────────────────────
  const uploadImageFile = async (file: File): Promise<string> => {
    if (!supabase) throw new Error('Supabase not initialised');
    const fileName = `visit_images/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('ocruploads').upload(fileName, file);
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from('ocruploads').getPublicUrl(fileName);
    return publicUrl;
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      alert('Please upload a valid image file (JPEG, PNG, HEIC, WebP).');
      e.target.value = '';
      return;
    }
    try {
      const url = await uploadImageFile(file);
      const newImage: VisitImage = {
        id: `img_${Date.now()}`,
        url,
        imageType: 'clinical_photo',
        label: file.name,
        uploadedAt: new Date().toISOString()
      };
      setVisitImages(prev => [...prev, newImage]);
    } catch (err) {
      alert('Failed to upload image. Please try again.');
    }
    e.target.value = '';
  };

  const handleAddImageUrl = () => {
    const url = imageUrlInput.trim();
    if (!url) return;
    const newImage: VisitImage = {
      id: `img_${Date.now()}`,
      url,
      imageType: 'other',
      label: 'Attached Image',
      uploadedAt: new Date().toISOString()
    };
    setVisitImages(prev => [...prev, newImage]);
    setImageUrlInput('');
    setShowUrlInput(false);
  };

  const removeImage = (id: string) => {
    setVisitImages(prev => prev.filter(img => img.id !== id));
  };

  const updateImageType = (id: string, imageType: VisitImage['imageType']) => {
    setVisitImages(prev => prev.map(img => img.id === id ? { ...img, imageType } : img));
  };

  const updateImageContext = (id: string, context: string) => {
    setVisitImages(prev => prev.map(img => img.id === id ? { ...img, context } : img));
  };

  const handleAnalyzeImage = async (img: VisitImage) => {
    setAnalyzingImageId(img.id);
    try {
      // Fetch image as blob to pass as File
      const response = await fetch(img.url);
      const blob = await response.blob();
      const file = new File([blob], img.label || 'image.jpg', { type: blob.type || 'image/jpeg' });

      const result = await analyzeVisitImageWithAI(file, img.imageType, {
        chiefComplaint: formData.chiefComplaint,
        symptoms: formData.symptoms.map(s => s.name).filter(Boolean),
        diagnoses: formData.diagnoses.map(d => d.name).filter(Boolean),
        doctorContext: img.context || undefined
      });

      // Save AI description back to image
      setVisitImages(prev => prev.map(i => i.id === img.id
        ? { ...i, aiAnalysis: result.description, imageType: result.imageCategory as VisitImage['imageType'] }
        : i
      ));

      const sd = result.structuredData;

      // Apply symptoms
      if (sd.symptoms?.length) {
        const newSymptoms = sd.symptoms
          .filter(s => s.name?.trim())
          .map(s => ({
            name: s.name,
            severity: (s.severity as 'mild' | 'moderate' | 'severe') || undefined,
            duration: s.duration || undefined,
            notes: s.notes || undefined
          }));
        setFormData(prev => ({ ...prev, symptoms: [...prev.symptoms, ...newSymptoms] }));
      }

      // Apply diagnoses
      if (sd.diagnoses?.length) {
        const newDiagnoses = sd.diagnoses
          .filter(d => d.name?.trim())
          .map(d => ({
            name: d.name,
            icd10Code: d.icd10Code || undefined,
            isPrimary: d.isPrimary || false,
            notes: d.notes || undefined
          }));
        setFormData(prev => ({ ...prev, diagnoses: [...prev.diagnoses, ...newDiagnoses] }));
      }

      // Apply vitals
      if (sd.vitals && Object.values(sd.vitals).some(v => v)) {
        setFormData(prev => ({
          ...prev,
          vitals: {
            temperature: sd.vitals?.temperature || prev.vitals.temperature,
            bloodPressure: sd.vitals?.bloodPressure || prev.vitals.bloodPressure,
            pulse: sd.vitals?.pulse || prev.vitals.pulse,
            weight: sd.vitals?.weight || prev.vitals.weight,
            height: sd.vitals?.height || prev.vitals.height
          }
        }));
      }

      // Apply prescriptions
      if (sd.prescriptions?.length) {
        const newRx = sd.prescriptions
          .filter(p => p.medicine?.trim())
          .map(p => ({
            id: `ai_rx_${Date.now()}_${Math.random()}`,
            visitId: '',
            medicine: p.medicine,
            dosage: p.dosage || '1 tablet',
            frequency: p.frequency || 'BD',
            duration: p.duration || '5 days',
            instructions: p.instructions || 'After meals',
            createdAt: new Date()
          }));
        setFormData(prev => ({ ...prev, prescriptions: [...prev.prescriptions, ...newRx] }));
      }

      // Apply tests ordered
      if (sd.testsOrdered?.length) {
        const newTests = sd.testsOrdered
          .filter(t => t.testName?.trim())
          .map(t => ({
            testName: t.testName,
            testType: (t.testType || 'lab') as 'lab' | 'radiology' | 'other',
            urgency: (t.urgency || 'routine') as 'routine' | 'urgent' | 'stat',
            status: 'ordered' as const,
            orderedDate: new Date()
          }));
        setFormData(prev => ({ ...prev, testsOrdered: [...prev.testsOrdered, ...newTests] }));
      }

      // Apply advice
      if (sd.advice?.length) {
        setFormData(prev => ({ ...prev, advice: [...prev.advice, ...sd.advice!.filter(Boolean)] }));
      }

      // Apply chief complaint if not set
      if (sd.chiefComplaint && !formData.chiefComplaint) {
        setFormData(prev => ({ ...prev, chiefComplaint: sd.chiefComplaint! }));
      }

      // Apply doctor notes (append, don't overwrite)
      const noteToAdd = sd.doctorNotes || result.description;
      if (noteToAdd) {
        setFormData(prev => ({
          ...prev,
          doctorNotes: prev.doctorNotes
            ? `${prev.doctorNotes}\n\n[Image AI - ${img.imageType}]: ${noteToAdd}`
            : `[Image AI - ${img.imageType}]: ${noteToAdd}`
        }));
      }

      alert(`Image analyzed successfully! ${result.imageCategory === 'clinical_photo' || result.imageCategory === 'xray' ? 'Clinical findings added to Doctor Notes.' : 'Medical data extracted and applied to EMR.'}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to analyze image');
    } finally {
      setAnalyzingImageId(null);
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;

    if (!user) { // user from useAuth()
      alert('You must be logged in to save a visit');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const profile = await getCurrentProfile();
      if (!profile?.clinicId) {
        alert('User not assigned to a clinic. Cannot save visit.');
        return;
      }

      const visitData: Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'> = {
        patientId: patient.id,
        doctorId: selectedDoctorId || null,
        appointmentId: appointmentIdProp || existingVisit?.appointmentId || undefined,
        date: new Date(`${formData.visitDate}T${visitTime || '00:00'}:00`),
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
        caseImageUrl: existingVisit?.caseImageUrl || undefined,
        visitImages: visitImages.length > 0 ? visitImages : undefined
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
      savingRef.current = false;
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

      {/* Visit Date & Time */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Date &amp; Time</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={formData.visitDate}
            onChange={(e) => setFormData({ ...formData, visitDate: e.target.value })}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-36 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
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
        examinationTemplate={physicalExamination}
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

          // Apply examination findings to loaded template fields
          if (data.examination && physicalExamination?.sections?.length) {
            const examData = data.examination as Record<string, any>;
            setPhysicalExamination(prev => {
              if (!prev?.sections) return prev;
              return {
                ...prev,
                sections: prev.sections.map(section => {
                  // Check if AI returned data for this section (by section id or title match)
                  const sectionData = examData[section.id] || examData[section.title?.toLowerCase()?.replace(/\s+/g, '')] || null;
                  if (!sectionData || typeof sectionData !== 'object') {
                    // Also check if fields are at root level (flat structure from AI)
                    return {
                      ...section,
                      fields: section.fields.map(field => {
                        const val = examData[field.key];
                        if (val !== undefined && val !== null) {
                          return { ...field, value: typeof val === 'boolean' ? val : String(val) };
                        }
                        return field;
                      })
                    };
                  }
                  return {
                    ...section,
                    fields: section.fields.map(field => {
                      const val = sectionData[field.key];
                      if (val !== undefined && val !== null) {
                        return { ...field, value: typeof val === 'boolean' ? val : String(val) };
                      }
                      return field;
                    })
                  };
                })
              };
            });
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

      {/* Clinical Images */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Image className="w-4 h-4 text-teal-600" />
            <label className="text-sm font-medium text-gray-700">Clinical Images</label>
            <span className="text-xs text-gray-400">(reports, swelling, X-rays, case papers)</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 cursor-pointer border border-teal-300 rounded-lg px-2 py-1">
              <Upload className="w-3 h-3" />
              Upload
              <input type="file" accept="image/*" onChange={handleImageFileSelect} className="hidden" />
            </label>
            <label className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 cursor-pointer border border-teal-300 rounded-lg px-2 py-1">
              <Camera className="w-3 h-3" />
              Camera
              <input type="file" accept="image/*" capture="environment" onChange={handleImageFileSelect} className="hidden" />
            </label>
            <button
              onClick={() => setShowUrlInput(v => !v)}
              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 border border-teal-300 rounded-lg px-2 py-1"
            >
              <Link className="w-3 h-3" />
              Add URL
            </button>
          </div>
        </div>

        {showUrlInput && (
          <div className="flex gap-2 mb-3">
            <input
              type="url"
              value={imageUrlInput}
              onChange={e => setImageUrlInput(e.target.value)}
              placeholder="Paste image URL..."
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              onKeyDown={e => e.key === 'Enter' && handleAddImageUrl()}
            />
            <button
              onClick={handleAddImageUrl}
              className="px-3 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700"
            >
              Add
            </button>
            <button
              onClick={() => setShowUrlInput(false)}
              className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        )}

        {visitImages.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visitImages.map(img => (
              <div key={img.id} className="relative group border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                {/* Thumbnail */}
                <div
                  className="relative cursor-pointer"
                  onClick={() => setLightboxUrl(img.url)}
                >
                  <img
                    src={img.url}
                    alt={img.label || img.imageType}
                    className="w-full h-28 object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23e5e7eb" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12">No preview</text></svg>'; }}
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all flex items-center justify-center">
                    <Eye className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>

                {/* Controls */}
                <div className="p-2 space-y-1">
                  <select
                    value={img.imageType}
                    onChange={e => updateImageType(img.id, e.target.value as VisitImage['imageType'])}
                    className="w-full text-xs px-1 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="clinical_photo">Clinical Photo</option>
                    <option value="lab_report">Lab Report</option>
                    <option value="xray">X-Ray</option>
                    <option value="case_paper">Case Paper</option>
                    <option value="other">Other</option>
                  </select>

                  <input
                    type="text"
                    value={img.context || ''}
                    onChange={e => updateImageContext(img.id, e.target.value)}
                    placeholder="Focus (e.g. check cartilage, fracture...)"
                    className="w-full text-xs px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-purple-400 placeholder-gray-300"
                    title="Optional: tell AI what to specifically look for"
                  />

                  <div className="flex gap-1">
                    <button
                      onClick={() => handleAnalyzeImage(img)}
                      disabled={analyzingImageId === img.id}
                      className="flex-1 flex items-center justify-center gap-1 text-xs py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                    >
                      {analyzingImageId === img.id
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing...</>
                        : <><Sparkles className="w-3 h-3" /> AI Analyze</>
                      }
                    </button>
                    <button
                      onClick={() => removeImage(img.id)}
                      className="p-1 text-red-500 hover:text-red-700"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {img.aiAnalysis && (
                    <p className="text-xs text-gray-500 italic truncate" title={img.aiAnalysis}>
                      ✓ {img.aiAnalysis.slice(0, 50)}…
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {visitImages.length === 0 && (
          <p className="text-xs text-gray-400 italic text-center py-2">
            No images attached. Upload photos of reports, swelling, X-rays, or scan case papers.
          </p>
        )}
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

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-5xl max-h-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={lightboxUrl}
              alt="Full view"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
            <a
              href={lightboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 bg-white bg-opacity-80 text-gray-800 text-xs px-2 py-1 rounded"
              onClick={e => e.stopPropagation()}
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default EMRForm;
