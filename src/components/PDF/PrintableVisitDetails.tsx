import React from 'react';
import { Visit, Patient, Profile, ClinicSetting } from '../../types';
import { format } from 'date-fns';
import { toTitleCase } from '../../utils/stringUtils';

interface PrintableVisitDetailsProps {
  visit: Visit;
  patient: Patient;
  doctor?: Profile;
  clinicSettings: ClinicSetting;
}

const PrintableVisitDetails: React.FC<PrintableVisitDetailsProps> = ({ visit, patient, doctor, clinicSettings }) => {
  return (
    <div className="pdf-container p-8 text-black" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Clinic Header */}
      <div className="pdf-header text-center border-b-2 border-gray-300 pb-6 mb-6">
        {clinicSettings.logoUrl && clinicSettings.logoUrl.trim() && !clinicSettings.logoUrl.includes('example.com') && (
          <img 
            src={clinicSettings.logoUrl} 
            alt={clinicSettings.clinicName}
            className="mx-auto mb-4 h-16 object-contain"
            onError={(e) => {
              console.warn('Failed to load clinic logo:', clinicSettings.logoUrl);
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{clinicSettings.clinicName}</h1>
        <div className="text-sm text-gray-600 space-y-1">
          <p>{clinicSettings.address}</p>
          <div className="flex justify-center gap-4">
            <span>📞 {clinicSettings.phone}</span>
            {clinicSettings.email && <span>✉️ {clinicSettings.email}</span>}
            {clinicSettings.website && <span>🌐 {clinicSettings.website}</span>}
          </div>
          {clinicSettings.registrationNumber && (
            <p>Registration No: {clinicSettings.registrationNumber}</p>
          )}
        </div>
      </div>

      {/* Visit Header */}
      <div className="pdf-section text-center mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-2">PATIENT VISIT DETAILS</h2>
        <div className="text-sm text-gray-600">
          <p>Visit Date: {format(visit.date, 'dd/MM/yyyy HH:mm')}</p>
        </div>
      </div>

      {/* Patient & Doctor Information */}
      <div className="pdf-section grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="pdf-no-break-inside border border-gray-300 rounded p-4">
          <h3 className="font-bold text-gray-800 mb-3">PATIENT DETAILS</h3>
          <div className="text-sm space-y-1">
            <p><strong>Name:</strong> {toTitleCase(patient.name)}</p>
            <p><strong>Phone:</strong> {patient.phone}</p>
            <p><strong>Age:</strong> {patient.age} years</p>
            <p><strong>Gender:</strong> {toTitleCase(patient.gender)}</p>
            {patient.bloodGroup && <p><strong>Blood Group:</strong> {patient.bloodGroup}</p>}
            <p><strong>Address:</strong> {patient.address}</p>
            {patient.allergies && patient.allergies.length > 0 && (
              <p><strong>Allergies:</strong> {patient.allergies.join(', ')}</p>
            )}
          </div>
        </div>

        <div className="pdf-no-break-inside border border-gray-300 rounded p-4">
          <h3 className="font-bold text-gray-800 mb-3">ATTENDING DOCTOR</h3>
          <div className="text-sm space-y-1">
            <p><strong>Name:</strong> Dr. {toTitleCase(doctor?.name || 'Not specified')}</p>
            {doctor?.specialization && <p><strong>Specialization:</strong> {doctor.specialization}</p>}
            {doctor?.qualification && <p><strong>Qualification:</strong> {doctor.qualification}</p>}
            {doctor?.registrationNo && <p><strong>Registration No:</strong> {doctor.registrationNo}</p>}
            {doctor?.phone && <p><strong>Phone:</strong> {doctor.phone}</p>}
          </div>
        </div>
      </div>

      {/* Chief Complaint */}
      {visit.chiefComplaint && (
        <div className="pdf-section mb-6">
          <h3 className="font-bold text-gray-800 mb-2">CHIEF COMPLAINT</h3>
          <p className="text-sm border border-gray-300 rounded p-3">{visit.chiefComplaint}</p>
        </div>
      )}

      {/* Vitals */}
      {Object.values(visit.vitals).some(v => v) && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">VITALS</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {visit.vitals.temperature && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Temperature:</strong> {visit.vitals.temperature}°F
              </div>
            )}
            {visit.vitals.bloodPressure && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Blood Pressure:</strong> {visit.vitals.bloodPressure}
              </div>
            )}
            {visit.vitals.pulse && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Pulse:</strong> {visit.vitals.pulse} BPM
              </div>
            )}
            {visit.vitals.weight && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Weight:</strong> {visit.vitals.weight} kg
              </div>
            )}
            {visit.vitals.height && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Height:</strong> {visit.vitals.height} cm
              </div>
            )}
            {visit.vitals.oxygenSaturation && (
              <div className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>Oxygen Saturation:</strong> {visit.vitals.oxygenSaturation}%
              </div>
            )}
          </div>
        </div>
      )}

      {/* Symptoms */}
      {visit.symptoms && visit.symptoms.length > 0 && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">SYMPTOMS</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {visit.symptoms.map((symptom, index) => (
              <div key={symptom.id} className="pdf-no-break-inside border border-gray-300 rounded p-2">
                <strong>{index + 1}. {symptom.name}</strong>
                {symptom.severity && <span className="ml-2 text-gray-600">({symptom.severity})</span>}
                {symptom.duration && <div className="text-gray-600">Duration: {symptom.duration}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diagnoses */}
      {visit.diagnoses && visit.diagnoses.length > 0 && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">DIAGNOSIS</h3>
          <div className="space-y-2 text-sm">
            {visit.diagnoses.map((diagnosis, index) => (
              <div key={diagnosis.id} className="pdf-no-break-inside border border-gray-300 rounded p-3">
                <div className="flex items-center gap-2">
                  <strong>{index + 1}. {diagnosis.name}</strong>
                  {diagnosis.isPrimary && (
                    <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs">Primary</span>
                  )}
                </div>
                {diagnosis.icd10Code && (
                  <div className="text-gray-600 mt-1">ICD-10: {diagnosis.icd10Code}</div>
                )}
                {diagnosis.notes && (
                  <div className="text-gray-600 mt-1">Notes: {diagnosis.notes}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prescriptions */}
      {visit.prescriptions && visit.prescriptions.length > 0 && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">PRESCRIPTIONS</h3>
          <table className="w-full border-collapse border border-gray-300 text-sm">
            <thead>
              <tr className="pdf-no-break-inside bg-gray-100">
                <th className="border border-gray-300 px-3 py-2 text-left">S.No</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Medicine</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Dosage</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Frequency</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Duration</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Instructions</th>
              </tr>
            </thead>
            <tbody>
              {visit.prescriptions.map((prescription, index) => (
                <tr key={prescription.id} className="pdf-table-row">
                  <td className="border border-gray-300 px-3 py-2">{index + 1}</td>
                  <td className="border border-gray-300 px-3 py-2 font-medium">{prescription.medicine}</td>
                  <td className="border border-gray-300 px-3 py-2">{prescription.dosage}</td>
                  <td className="border border-gray-300 px-3 py-2">{prescription.frequency}</td>
                  <td className="border border-gray-300 px-3 py-2">{prescription.duration}</td>
                  <td className="border border-gray-300 px-3 py-2">{prescription.instructions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tests Ordered */}
      {visit.testsOrdered && visit.testsOrdered.length > 0 && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">TESTS ORDERED</h3>
          <div className="space-y-2 text-sm">
            {visit.testsOrdered.map((test, index) => (
              <div key={test.id} className="pdf-no-break-inside border border-gray-300 rounded p-3">
                <div className="flex items-center justify-between">
                  <strong>{index + 1}. {test.testName}</strong>
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs capitalize">
                    {test.testType} • {test.urgency}
                  </span>
                </div>
                {test.instructions && (
                  <div className="text-gray-600 mt-1">Instructions: {test.instructions}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advice */}
      {visit.advice && visit.advice.length > 0 && (
        <div className="pdf-section mb-6">
          <h3 className="pdf-section-header font-bold text-gray-800 mb-3">ADVICE</h3>
          <ul className="text-sm space-y-1">
            {visit.advice.map((advice, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>{advice}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Follow-up */}
      {visit.followUpDate && (
        <div className="pdf-section mb-6">
          <h3 className="font-bold text-gray-800 mb-2">FOLLOW-UP</h3>
          <p className="text-sm border border-gray-300 rounded p-3">
            Next visit scheduled for: <strong>{format(visit.followUpDate, 'dd/MM/yyyy')}</strong>
          </p>
        </div>
      )}

      {/* Doctor's Notes */}
      {visit.doctorNotes && (
        <div className="pdf-section mb-6">
          <h3 className="font-bold text-gray-800 mb-2">DOCTOR'S NOTES</h3>
          <p className="text-sm border border-gray-300 rounded p-3 italic">{visit.doctorNotes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="pdf-footer border-t-2 border-gray-300 pt-4 text-center text-xs text-gray-500">
        <p>This is a computer-generated visit report.</p>
        <p className="mt-1">Generated on {format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
        {clinicSettings.taxId && (
          <p className="mt-1">Tax ID: {clinicSettings.taxId}</p>
        )}
        <div className="pdf-no-break-inside mt-4 flex justify-between items-center">
          <div className="text-left">
            <p className="font-medium">Patient Signature</p>
            <div className="border-b border-gray-400 w-32 mt-4"></div>
          </div>
          <div className="text-right">
            <p className="font-medium">Doctor Signature</p>
            <div className="border-b border-gray-400 w-32 mt-4"></div>
            <p className="text-xs mt-1">Dr. {toTitleCase(doctor?.name || '')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintableVisitDetails;