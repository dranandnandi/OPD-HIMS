import { Patient, Visit, Prescription, AnalyticsData } from '../types';

export const mockPatients: Patient[] = [
  {
    id: '1',
    name: 'Rajesh Kumar',
    phone: '9876543210',
    age: 45,
    gender: 'male',
    address: '123 MG Road, Mumbai, Maharashtra 400001',
    emergencyContact: '9876543211',
    bloodGroup: 'O+',
    allergies: ['Penicillin'],
    createdAt: new Date('2024-01-15'),
    lastVisit: new Date('2024-12-15')
  },
  {
    id: '2',
    name: 'Priya Sharma',
    phone: '9876543212',
    age: 32,
    gender: 'female',
    address: '456 Park Street, Delhi, Delhi 110001',
    emergencyContact: '9876543213',
    bloodGroup: 'A+',
    createdAt: new Date('2024-02-20'),
    lastVisit: new Date('2024-12-14')
  },
  {
    id: '3',
    name: 'Mohammed Ali',
    phone: '9876543214',
    age: 28,
    gender: 'male',
    address: '789 Brigade Road, Bangalore, Karnataka 560001',
    emergencyContact: '9876543215',
    bloodGroup: 'B+',
    allergies: ['Sulfa drugs'],
    createdAt: new Date('2024-03-10'),
    lastVisit: new Date('2024-12-13')
  }
];

export const mockVisits: Visit[] = [
  {
    id: '1',
    patientId: '1',
    date: new Date('2024-12-15'),
    chiefComplaint: 'Fever and headache for 3 days',
    symptoms: ['Fever', 'Headache', 'Body ache', 'Fatigue'],
    vitals: {
      temperature: 101.5,
      bloodPressure: '140/90',
      pulse: 88,
      weight: 75
    },
    diagnosis: ['Viral fever', 'Hypertension'],
    prescriptions: [
      {
        id: '1',
        medicine: 'Paracetamol 500mg',
        dosage: '1 tablet',
        frequency: 'TID',
        duration: '5 days',
        instructions: 'After meals'
      },
      {
        id: '2',
        medicine: 'Amlodipine 5mg',
        dosage: '1 tablet',
        frequency: 'OD',
        duration: '30 days',
        instructions: 'Morning after breakfast'
      }
    ],
    advice: ['Rest and hydration', 'Avoid cold foods', 'Monitor BP regularly'],
    followUpDate: new Date('2024-12-20'),
    doctorNotes: 'Patient responded well to treatment. Continue monitoring BP.'
  },
  {
    id: '2',
    patientId: '2',
    date: new Date('2024-12-14'),
    chiefComplaint: 'Cough and cold for 1 week',
    symptoms: ['Dry cough', 'Runny nose', 'Throat irritation'],
    vitals: {
      temperature: 98.6,
      bloodPressure: '120/80',
      pulse: 72
    },
    diagnosis: ['Upper respiratory tract infection'],
    prescriptions: [
      {
        id: '3',
        medicine: 'Cetirizine 10mg',
        dosage: '1 tablet',
        frequency: 'HS',
        duration: '7 days',
        instructions: 'At bedtime'
      }
    ],
    advice: ['Warm water gargling', 'Avoid cold beverages'],
    followUpDate: new Date('2024-12-21'),
    doctorNotes: 'Mild URTI. Should resolve with symptomatic treatment.'
  }
];

export const mockAnalytics: AnalyticsData = {
  totalPatients: 156,
  todayVisits: 12,
  totalVisits: 324,
  topDiagnoses: [
    { name: 'Viral fever', count: 45 },
    { name: 'Hypertension', count: 32 },
    { name: 'Diabetes', count: 28 },
    { name: 'URTI', count: 25 },
    { name: 'Gastritis', count: 22 }
  ],
  topMedicines: [
    { name: 'Paracetamol', count: 67 },
    { name: 'Amlodipine', count: 34 },
    { name: 'Metformin', count: 29 },
    { name: 'Cetirizine', count: 26 },
    { name: 'Omeprazole', count: 23 }
  ],
  monthlyVisits: [
    { month: 'Jul', visits: 45 },
    { month: 'Aug', visits: 52 },
    { month: 'Sep', visits: 48 },
    { month: 'Oct', visits: 61 },
    { month: 'Nov', visits: 58 },
    { month: 'Dec', visits: 60 }
  ]
};