import React from 'react';
import { AlertCircle } from 'lucide-react';

export interface PatientDetails {
  name: string;
  phone: string;
  age: string;
  gender: string;
  notes: string;
}

interface PatientDetailsFormProps {
  value: PatientDetails;
  /** Field name flagged by the server, e.g. "phone". */
  invalidField: string | null;
  onChange: (next: PatientDetails) => void;
}

const inputClass = (hasError: boolean) =>
  `w-full rounded-lg border px-3 py-2.5 text-base outline-none transition focus:ring-2 ${
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
      : 'border-gray-300 focus:border-blue-500 focus:ring-blue-100'
  }`;

const PatientDetailsForm: React.FC<PatientDetailsFormProps> = ({
  value,
  invalidField,
  onChange,
}) => {
  const update = (patch: Partial<PatientDetails>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="pb-name" className="mb-1 block text-sm font-medium text-gray-900">
          Patient name <span className="text-red-500">*</span>
        </label>
        <input
          id="pb-name"
          type="text"
          autoComplete="name"
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Full name"
          className={inputClass(invalidField === 'name')}
        />
        {invalidField === 'name' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Please enter the patient's full name.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="pb-phone" className="mb-1 block text-sm font-medium text-gray-900">
          Mobile number <span className="text-red-500">*</span>
        </label>
        <input
          id="pb-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={value.phone}
          onChange={(event) => update({ phone: event.target.value })}
          placeholder="10-digit mobile number"
          className={inputClass(invalidField === 'phone')}
        />
        <p className="mt-1 text-xs text-gray-500">
          The clinic will call or message you on this number to confirm.
        </p>
        {invalidField === 'phone' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Please enter a valid mobile number.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pb-age" className="mb-1 block text-sm font-medium text-gray-900">
            Age
          </label>
          <input
            id="pb-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={119}
            value={value.age}
            onChange={(event) => update({ age: event.target.value })}
            placeholder="Years"
            className={inputClass(false)}
          />
        </div>

        <div>
          <label htmlFor="pb-gender" className="mb-1 block text-sm font-medium text-gray-900">
            Gender
          </label>
          <select
            id="pb-gender"
            value={value.gender}
            onChange={(event) => update({ gender: event.target.value })}
            className={inputClass(false)}
          >
            <option value="">Select</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="pb-notes" className="mb-1 block text-sm font-medium text-gray-900">
          Reason for visit <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="pb-notes"
          rows={3}
          maxLength={500}
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          placeholder="Briefly describe your symptoms or concern"
          className={inputClass(false)}
        />
      </div>

      <p className="text-xs leading-relaxed text-gray-500">
        By booking you agree to the clinic contacting you about this appointment.
        Please do not use this form for medical emergencies &mdash; call the clinic directly.
      </p>
    </div>
  );
};

export default PatientDetailsForm;
