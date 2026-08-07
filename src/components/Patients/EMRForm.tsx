import React, { useState, useEffect, useRef } from 'react';
import { Save, Plus, Trash2, Calendar, Zap, Image, Upload, Camera, Link, X, Loader2, Sparkles, Eye, AlertTriangle } from 'lucide-react';
import { Patient, Visit, Prescription, Symptom, Diagnosis, TestOrdered, Profile, PhysicalExamination, VoiceTranscript, VisitImage, MedicineMaster, TestMaster, OcrResult } from '../../types';
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
import {
  normalizeExtraction,
  mergeExtractionIntoForm,
  summarizeMerge,
  MergeSummary
} from '../../utils/emrMapping';

interface EMRFormProps {
  patient: Patient;
  existingVisit?: Visit;
  initialVisitDate: string;
  initialVisitTime?: string; // HH:mm from appointment, if created from appointment
  initialDoctorId?: string;  // Doctor from appointment, if created from appointment
  appointmentId?: string;    // Link visit to the appointment
  /** Raw extraction from the case-paper pipeline; merged in via the shared AI mapper. */
  ocrData: OcrResult['extractedData'] | Record<string, never>;
  /** Blank examination template chosen before case-paper processing, if any. */
  initialExamination?: PhysicalExamination;
  onSave: () => void;
}

/** Visit form state. Structurally satisfies EmrFormDataLike so the AI mapper can merge into it. */
interface EmrFormState {
  chiefComplaint: string;
  visitDate: string;
  symptoms: Array<Omit<Symptom, 'id' | 'visitId' | 'createdAt'>>;
  vitals: {
    temperature: string;
    bloodPressure: string;
    pulse: string;
    weight: string;
    height: string;
    respiratoryRate: string;
    oxygenSaturation: string;
  };
  diagnoses: Array<Omit<Diagnosis, 'id' | 'visitId' | 'createdAt'>>;
  prescriptions: Prescription[];
  testsOrdered: Array<Omit<TestOrdered, 'id' | 'visitId' | 'createdAt'>>;
  advice: string[];
  adviceLanguage: string;
  adviceRegional: string;
  followUpDate: string;
  doctorNotes: string;
}

const getCurrentLocalTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

const EMRForm: React.FC<EMRFormProps> = ({ patient, existingVisit, ocrData, initialExamination, initialVisitDate, initialVisitTime, initialDoctorId, appointmentId: appointmentIdProp, onSave }) => {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [medicines, setMedicines] = useState<MedicineMaster[]>([]);
  const [medicineSuggestions, setMedicineSuggestions] = useState<{ [key: number]: MedicineMaster[] }>({});
  const [showMedicineSuggestions, setShowMedicineSuggestions] = useState<{ [key: number]: boolean }>({});
  const [doctors, setDoctors] = useState<Profile[]>([]);
  const [frequencies, setFrequencies] = useState<Array<{ code: string, label: string, timesPerDay: number | null }>>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState(existingVisit?.doctorId || initialDoctorId || '');
  const [visitDate, setVisitDate] = useState(initialVisitDate);
  const [visitTime, setVisitTime] = useState<string>(() => {
    if (existingVisit) {
      const d = new Date(existingVisit.date);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return initialVisitTime || getCurrentLocalTime();
  });
  const [physicalExamination, setPhysicalExamination] = useState<PhysicalExamination | undefined>(
    existingVisit?.physicalExamination || initialExamination
  );
  // Read inside the setFormData updater, where the latest examination state is
  // needed but not available through the closure.
  const physicalExaminationRef = useRef(physicalExamination);
  useEffect(() => {
    physicalExaminationRef.current = physicalExamination;
  }, [physicalExamination]);
  const [presets, setPresets] = useState<PrescriptionPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [visitImages, setVisitImages] = useState<VisitImage[]>(existingVisit?.visitImages || []);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [analyzingImageId, setAnalyzingImageId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [testsMaster, setTestsMaster] = useState<TestMaster[]>([]);
  const [testSearchQuery, setTestSearchQuery] = useState<{ [key: number]: string }>({});
  const [testSuggestions, setTestSuggestions] = useState<{ [key: number]: TestMaster[] }>({});
  const [showTestSuggestions, setShowTestSuggestions] = useState<{ [key: number]: boolean }>({});

  // Helper function to convert existing visit data to form format
  const convertExistingVisitToFormData = (visit: Visit): EmrFormState => {
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
        height: visit.vitals.height?.toString() || '',
        respiratoryRate: visit.vitals.respiratoryRate?.toString() || '',
        oxygenSaturation: visit.vitals.oxygenSaturation?.toString() || ''
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

  const [formData, setFormData] = useState<EmrFormState>(
    existingVisit
      ? convertExistingVisitToFormData(existingVisit)
      : {
        // Case-paper data is merged in by the effect below via the shared AI
        // mapper, so examination findings, follow-up and unmapped content are
        // handled the same way as voice dictation instead of being dropped.
        chiefComplaint: '',
        visitDate: new Date().toISOString().split('T')[0],
        symptoms: [],
        vitals: {
          temperature: '',
          bloodPressure: '',
          pulse: '',
          weight: '',
          height: '',
          respiratoryRate: '',
          oxygenSaturation: ''
        },
        diagnoses: [],
        prescriptions: [],
        testsOrdered: [],
        advice: [],
        adviceLanguage: 'english',
        adviceRegional: '',
        followUpDate: '',
        doctorNotes: ''
      }
  );

  // Mirrors formData so AI merges always build on the latest value, including
  // when two extractions are applied in quick succession.
  const formDataRef = useRef(formData);
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Apply case-paper OCR output once, through the same mapper the voice and
  // image flows use. Runs only for a new visit — an existing visit is loaded
  // from the database instead.
  const ocrAppliedRef = useRef(false);
  useEffect(() => {
    if (existingVisit || ocrAppliedRef.current) return;
    const hasOcrContent = ocrData && Object.values(ocrData).some(
      value => (Array.isArray(value) ? value.length > 0 : value && Object.keys(value as object).length !== 0)
    );
    if (!hasOcrContent) return;

    ocrAppliedRef.current = true;
    applyAiExtraction(ocrData, 'Case paper');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrData, existingVisit]);

  // Load medicines and tests on component mount
  useEffect(() => {
    if (user) {
      loadMedicines();
      loadDoctors();
      loadFrequencies();
      loadTests();
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
      setMedicines(medicineData);
    } catch (error) {
      console.error('Error loading medicines:', error);
    }
  };

  const searchMedicineSuggestions = (query: string, index: number) => {
    if (!query.trim()) {
      setMedicineSuggestions(prev => ({ ...prev, [index]: [] }));
      setShowMedicineSuggestions(prev => ({ ...prev, [index]: false }));
      return;
    }

    const lowerQuery = query.toLowerCase();
    const filtered = medicines.filter(medicine =>
      medicine.name.toLowerCase().includes(lowerQuery) ||
      medicine.genericName?.toLowerCase().includes(lowerQuery) ||
      medicine.brandName?.toLowerCase().includes(lowerQuery)
    ).slice(0, 10);

    setMedicineSuggestions(prev => ({ ...prev, [index]: filtered }));
    setShowMedicineSuggestions(prev => ({ ...prev, [index]: filtered.length > 0 }));
  };

  const selectMedicineFromMaster = (medicine: MedicineMaster, index: number) => {
    setFormData(prev => ({
      ...prev,
      prescriptions: prev.prescriptions.map((prescription, i) => i === index ? {
        ...prescription,
        medicine: medicine.name,
        dosage: prescription.dosage || medicine.strength || prescription.dosage
      } : prescription)
    }));
    setShowMedicineSuggestions(prev => ({ ...prev, [index]: false }));
  };

  const loadTests = async () => {
    try {
      const testData = await masterDataService.getTests();
      setTestsMaster(testData);
    } catch (error) {
      console.error('Error loading tests:', error);
    }
  };

  const searchTestSuggestions = (query: string, index: number) => {
    if (!query.trim()) {
      setTestSuggestions(prev => ({ ...prev, [index]: [] }));
      setShowTestSuggestions(prev => ({ ...prev, [index]: false }));
      return;
    }
    const lowerQuery = query.toLowerCase();
    const filtered = testsMaster.filter(test =>
      test.name.toLowerCase().includes(lowerQuery)
    ).slice(0, 10);
    setTestSuggestions(prev => ({ ...prev, [index]: filtered }));
    setShowTestSuggestions(prev => ({ ...prev, [index]: filtered.length > 0 }));
  };

  const selectTestFromMaster = (test: TestMaster, index: number) => {
    setFormData(prev => ({
      ...prev,
      testsOrdered: prev.testsOrdered.map((t, i) => i === index ? {
        ...t,
        testName: test.name,
        testType: test.type as 'lab' | 'radiology' | 'procedure' | 'other'
      } : t)
    }));
    setTestSearchQuery(prev => ({ ...prev, [index]: test.name }));
    setShowTestSuggestions(prev => ({ ...prev, [index]: false }));
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

  // --- Clinical safety: patient allergies ---
  const patientAllergies = (patient.allergies || [])
    .map(a => (a || '').trim())
    .filter(Boolean);

  // Returns the allergy term that appears to conflict with the given medicine name, if any.
  const allergyConflictFor = (medicineName: string): string | null => {
    const med = (medicineName || '').trim().toLowerCase();
    if (!med) return null;
    for (const allergy of patientAllergies) {
      const term = allergy.toLowerCase();
      if (term.length < 3) continue;
      if (med.includes(term) || term.includes(med)) return allergy;
    }
    return null;
  };

  // --- BMI from weight (kg) and height (cm) ---
  const computeBmi = (): { value: string; category: string; color: string } | null => {
    const w = parseFloat(formData.vitals.weight);
    const h = parseFloat(formData.vitals.height);
    if (!w || !h || h <= 0) return null;
    const bmi = w / Math.pow(h / 100, 2);
    if (!isFinite(bmi) || bmi <= 0 || bmi > 200) return null;
    let category = 'Normal';
    let color = 'text-green-600';
    if (bmi < 18.5) { category = 'Underweight'; color = 'text-amber-600'; }
    else if (bmi < 25) { category = 'Normal'; color = 'text-green-600'; }
    else if (bmi < 30) { category = 'Overweight'; color = 'text-amber-600'; }
    else { category = 'Obese'; color = 'text-red-600'; }
    return { value: bmi.toFixed(1), category, color };
  };

  const addTestOrdered = () => {
    setFormData(prev => ({
      ...prev,
      testsOrdered: [...prev.testsOrdered, {
        testName: '',
        testType: 'lab' as 'lab' | 'radiology' | 'procedure' | 'other',
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

  /**
   * Single entry point for every AI source (voice dictation, case paper, image
   * analysis). Normalises the payload, merges it into the form and the
   * examination — falling back to the standard OPD schema when no template is
   * loaded — and reports exactly what was applied.
   */
  const applyAiExtraction = (raw: unknown, sourceLabel: string): MergeSummary | null => {
    if (!raw) return null;

    const extraction = normalizeExtraction(raw);
    const merged = mergeExtractionIntoForm(
      formDataRef.current,
      extraction,
      physicalExaminationRef.current,
      { sourceLabel }
    );

    // Update the refs immediately so back-to-back applies (e.g. analysing two
    // images in a row) merge onto each other rather than the stale render value.
    formDataRef.current = merged.formData;
    setFormData(merged.formData);

    if (merged.examination !== physicalExaminationRef.current) {
      physicalExaminationRef.current = merged.examination;
      setPhysicalExamination(merged.examination);
    }

    return merged.summary;
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
        doctorContext: img.context || undefined,
        examinationTemplate: physicalExamination
      });

      // Save AI description back to image
      setVisitImages(prev => prev.map(i => i.id === img.id
        ? { ...i, aiAnalysis: result.description, imageType: result.imageCategory as VisitImage['imageType'] }
        : i
      ));

      // The visual description is clinical content in its own right — keep it
      // even when the model returned no separate doctorNotes.
      const structured = {
        ...result.structuredData,
        doctorNotes: [result.structuredData.doctorNotes, result.structuredData.doctorNotes ? null : result.description]
          .filter(Boolean)
          .join('\n') || null
      };

      const summary = applyAiExtraction(structured, `Image AI — ${img.imageType}`);
      alert(summary ? summarizeMerge(summary) : 'Image analyzed, but no data could be extracted.');
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
        date: new Date(`${visitDate}T${visitTime || '00:00'}:00`),
        chiefComplaint: formData.chiefComplaint,

        symptoms: formData.symptoms.filter(
          (s) => typeof s.name === 'string' && s.name.trim() !== ''
        ) as Visit['symptoms'],

        vitals: {
          temperature: formData.vitals.temperature ? parseFloat(formData.vitals.temperature) : undefined,
          bloodPressure: formData.vitals.bloodPressure || undefined,
          pulse: formData.vitals.pulse ? parseInt(formData.vitals.pulse) : undefined,
          weight: formData.vitals.weight ? parseFloat(formData.vitals.weight) : undefined,
          height: formData.vitals.height ? parseFloat(formData.vitals.height) : undefined,
          respiratoryRate: formData.vitals.respiratoryRate ? parseInt(formData.vitals.respiratoryRate) : undefined,
          oxygenSaturation: formData.vitals.oxygenSaturation ? parseFloat(formData.vitals.oxygenSaturation) : undefined
        },

        diagnoses: formData.diagnoses.filter(
          (d) => typeof d.name === 'string' && d.name.trim() !== ''
        ) as Visit['diagnoses'],

        prescriptions: formData.prescriptions.filter(
          (p) => typeof p.medicine === 'string' && p.medicine.trim() !== ''
        ),

        testsOrdered: formData.testsOrdered.filter(
          (t) => typeof t.testName === 'string' && t.testName.trim() !== ''
        ) as Visit['testsOrdered'],

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

      {/* Visit Date & Time */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Visit Date &amp; Time</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-36 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Allergy alert — always visible so the prescriber is aware */}
      {patientAllergies.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Known allergies</p>
            <p className="text-sm text-red-700">{patientAllergies.join(', ')}</p>
          </div>
        </div>
      )}

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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
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
          <div>
            <label className="block text-xs text-gray-600 mb-1">SpO₂</label>
            <input
              type="text"
              value={formData.vitals.oxygenSaturation}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, oxygenSaturation: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="98%"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Respiratory Rate</label>
            <input
              type="text"
              value={formData.vitals.respiratoryRate}
              onChange={(e) => setFormData({
                ...formData,
                vitals: { ...formData.vitals, respiratoryRate: e.target.value }
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="18 /min"
            />
          </div>
        </div>
        {(() => {
          const bmi = computeBmi();
          if (!bmi) return null;
          return (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-gray-600">BMI:</span>
              <span className={`font-semibold ${bmi.color}`}>{bmi.value}</span>
              <span className={`${bmi.color}`}>({bmi.category})</span>
              <span className="text-xs text-gray-400">auto-calculated from weight &amp; height</span>
            </div>
          );
        })()}
      </div>

      {/* Physical Examination - AI Powered */}
      <PhysicalExaminationSection
        examination={physicalExamination}
        onChange={setPhysicalExamination}
        doctorSpecialization={doctors.find(d => d.id === selectedDoctorId)?.specialization}
        chiefComplaint={formData.chiefComplaint}
        symptoms={formData.symptoms.map(s => typeof s === 'string' ? s : s.name).filter(Boolean)}
        patientAge={patient.age ?? undefined}
        patientGender={patient.gender}
      />

      {/* Voice Recording - AI Transcription */}
      <VoiceRecorder
        visitId={existingVisit?.id}
        chiefComplaint={formData.chiefComplaint}
        currentSymptoms={formData.symptoms.map(s => typeof s === 'string' ? s : s.name).filter(Boolean)}
        currentDiagnoses={formData.diagnoses.map(d => typeof d === 'string' ? d : d.name).filter(Boolean)}
        examinationTemplate={physicalExamination}
        patientAge={patient.age ?? undefined}
        patientGender={patient.gender}
        doctorSpecialization={doctors.find(d => d.id === selectedDoctorId)?.specialization}
        onApplyToForm={(data: VoiceTranscript['extractedData']) => {
          const summary = applyAiExtraction(data, 'Voice dictation');
          if (summary) alert(summarizeMerge(summary));
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
        <datalist id="rx-routes">
          <option value="PO (Oral)" />
          <option value="IV (Intravenous)" />
          <option value="IM (Intramuscular)" />
          <option value="SC (Subcutaneous)" />
          <option value="SL (Sublingual)" />
          <option value="PR (Rectal)" />
          <option value="Topical" />
          <option value="Inhaled" />
          <option value="Ophthalmic" />
          <option value="Nasal" />
        </datalist>
        <div className="space-y-4">
          {formData.prescriptions.map((prescription, index) => (
            <div key={prescription.id} className="border border-gray-200 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="relative">
                  <label className="block text-xs text-gray-600 mb-1">Medicine</label>
                  <input
                    type="text"
                    value={prescription.medicine}
                    onChange={(e) => {
                      updatePrescription(index, 'medicine', e.target.value);
                      searchMedicineSuggestions(e.target.value, index);
                    }}
                    onFocus={() => {
                      if (prescription.medicine) {
                        searchMedicineSuggestions(prescription.medicine, index);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowMedicineSuggestions(prev => ({ ...prev, [index]: false })), 200);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Type to search or enter custom"
                  />
                  {showMedicineSuggestions[index] && medicineSuggestions[index]?.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {medicineSuggestions[index].map((suggestion) => (
                        <div
                          key={suggestion.id}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          onMouseDown={() => selectMedicineFromMaster(suggestion, index)}
                        >
                          <div className="font-medium text-sm">{suggestion.name}</div>
                          <div className="text-xs text-gray-500">
                            {[suggestion.category, suggestion.dosageForm, suggestion.strength].filter(Boolean).join(' - ')}
                          </div>
                          {(suggestion.genericName || suggestion.brandName) && (
                            <div className="text-xs text-gray-400">
                              {[suggestion.genericName, suggestion.brandName].filter(Boolean).join(' / ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const conflict = allergyConflictFor(prescription.medicine);
                    if (!conflict) return null;
                    return (
                      <div className="mt-1 flex items-start gap-1 text-red-600">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="text-xs">Allergy alert: patient is allergic to "{conflict}"</span>
                      </div>
                    );
                  })()}
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
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={prescription.quantity ?? ''}
                    onChange={(e) => updatePrescription(index, 'quantity', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g. 10"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Refills</label>
                  <input
                    type="number"
                    min="0"
                    value={prescription.refills ?? ''}
                    onChange={(e) => updatePrescription(index, 'refills', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <div className="w-40">
                  <label className="block text-xs text-gray-600 mb-1">Route</label>
                  <input
                    type="text"
                    list="rx-routes"
                    value={prescription.route ?? ''}
                    onChange={(e) => updatePrescription(index, 'route', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="PO / IV / IM"
                  />
                </div>
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
                <div className="relative">
                  <label className="block text-xs text-gray-600 mb-1">Test Name</label>
                  <input
                    type="text"
                    value={test.testName}
                    onChange={(e) => {
                      updateTestOrdered(index, 'testName', e.target.value);
                      searchTestSuggestions(e.target.value, index);
                    }}
                    onFocus={() => {
                      if (test.testName) {
                        searchTestSuggestions(test.testName, index);
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowTestSuggestions(prev => ({ ...prev, [index]: false })), 200);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Type to search or enter custom"
                  />
                  {showTestSuggestions[index] && testSuggestions[index]?.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {testSuggestions[index].map((suggestion) => (
                        <div
                          key={suggestion.id}
                          className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          onMouseDown={() => selectTestFromMaster(suggestion, index)}
                        >
                          <div className="font-medium text-sm">{suggestion.name}</div>
                          <div className="text-xs text-gray-500">
                            {suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}
                            {suggestion.category && ` • ${suggestion.category}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
                    <option value="procedure">Procedure</option>
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
