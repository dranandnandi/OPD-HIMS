import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Calendar, User, Search } from 'lucide-react';
import { Patient, Visit, Prescription, Symptom, Diagnosis, TestOrdered } from '../../types';
import { patientService } from '../../services/patientService';
import { visitService } from '../../services/visitService';
import { masterDataService } from '../../services/masterDataService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../Auth/useAuth';

interface EMRFormProps {
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
}

const EMRForm: React.FC<EMRFormProps> = ({ ocrData }) => {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [medicines, setMedicines] = useState<string[]>([]);
  const [frequencies, setFrequencies] = useState<Array<{code: string, label: string, timesPerDay: number | null}>>([]);
  
  const [formData, setFormData] = useState({
    chiefComplaint: '',
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
    followUpDate: '',
    doctorNotes: ''
  });

  // Load patients on component mount
  useEffect(() => {
    if (user) {
      loadPatients();
      loadMedicines();
      loadFrequencies();
    }
  }, [user]);

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
          {code: 'OD', label: 'OD (Once daily)', timesPerDay: 1},
          {code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2},
          {code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3},
          {code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4},
          {code: 'PRN', label: 'PRN (As needed)', timesPerDay: null}
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
        {code: 'OD', label: 'OD (Once daily)', timesPerDay: 1},
        {code: 'BD', label: 'BD (Twice daily)', timesPerDay: 2},
        {code: 'TID', label: 'TID (Three times daily)', timesPerDay: 3},
        {code: 'QID', label: 'QID (Four times daily)', timesPerDay: 4},
        {code: 'PRN', label: 'PRN (As needed)', timesPerDay: null}
      ]);
    }
  };

  const loadPatients = async () => {
    try {
      setLoading(true);
      const fetchedPatients = await patientService.getPatients();
      setPatients(fetchedPatients);
    } catch (error) {
      console.error('Error loading patients:', error);
      alert('Failed to load patients. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.phone.includes(searchTerm)
  );

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setSearchTerm('');
  };

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
    if (!selectedPatient) {
      alert('Please select a patient first');
      return;
    }

    if (!user) {
      alert('You must be logged in to save a visit');
      return;
    }

    try {
      setSaving(true);
      
      const visit: Omit<Visit, 'id' | 'createdAt' | 'updatedAt' | 'patient' | 'doctor'> = {
        patientId: selectedPatient.id,
        doctorId: user.id,
        appointmentId: undefined,
        date: new Date(),
        chiefComplaint: formData.chiefComplaint,
        symptoms: formData.symptoms.filter(s => s.name.trim() !== ''),
        vitals: {
          temperature: formData.vitals.temperature ? parseFloat(formData.vitals.temperature) : undefined,
          bloodPressure: formData.vitals.bloodPressure || undefined,
          pulse: formData.vitals.pulse ? parseInt(formData.vitals.pulse) : undefined,
          weight: formData.vitals.weight ? parseFloat(formData.vitals.weight) : undefined,
          height: formData.vitals.height ? parseFloat(formData.vitals.height) : undefined,
          respiratoryRate: undefined,
          oxygenSaturation: undefined
        },
        diagnoses: formData.diagnoses.filter(d => d.name.trim() !== ''),
        prescriptions: formData.prescriptions.filter(p => p.medicine.trim() !== ''),
        testsOrdered: formData.testsOrdered.filter(t => t.testName.trim() !== ''),
        testResults: [],
        advice: formData.advice.filter(a => a.trim() !== ''),
        followUpDate: formData.followUpDate ? new Date(formData.followUpDate) : undefined,
        doctorNotes: formData.doctorNotes,
        caseImageUrl: undefined
      };

      const savedVisit = await visitService.addVisit(visit);
      console.log('Visit saved successfully:', savedVisit);
      
      alert('Visit saved successfully!');
      
      // Reset form or redirect as needed
      // You might want to redirect to patient timeline or clear the form
      
    } catch (error) {
      console.error('Error saving visit:', error);
      alert(error instanceof Error ? error.message : 'Failed to save visit. Please try again.');
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
      <h3 className="text-lg font-bold text-gray-800">Create EMR Entry</h3>

      {/* Patient Selection */}
      <div className="space-y-4">
        <h4 className="font-medium text-gray-700">Select Patient</h4>
        
        {selectedPatient ? (
          <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-blue-600" />
              <div>
                <p className="font-medium text-blue-800">{selectedPatient.name}</p>
                <p className="text-sm text-blue-600">{selectedPatient.phone} • {selectedPatient.age} years</p>
              </div>
            </div>
            <button
              onClick={() => setSelectedPatient(null)}
              className="text-blue-600 hover:text-blue-700 text-sm"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search patients by name or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            {searchTerm && (
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                {loading ? (
                  <div className="p-3 text-center text-gray-500">Loading patients...</div>
                ) : filteredPatients.length > 0 ? (
                  filteredPatients.map(patient => (
                    <button
                      key={patient.id}
                      onClick={() => handlePatientSelect(patient)}
                      className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      <div className="font-medium">{patient.name}</div>
                      <div className="text-sm text-gray-600">{patient.phone} • {patient.age} years</div>
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-center text-gray-500">No patients found</div>
                )}
              </div>
            )}
          </div>
        )}
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
          <label className="text-sm font-medium text-gray-700">Prescriptions</label>
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
          <label className="text-sm font-medium text-gray-700">Advice</label>
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
          disabled={!selectedPatient || saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Saving...' : 'Save Visit'}
        </button>
      </div>
    </div>
  );
};

export default EMRForm;