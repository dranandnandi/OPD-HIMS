import React from 'react';
import { AlertCircle } from 'lucide-react';
import { englishOnly, type BookingTranslator } from './i18n';

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
  /** Bilingual label helper; defaults to English-only. */
  t?: BookingTranslator;
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
  t = englishOnly,
  onChange,
}) => {
  const update = (patch: Partial<PatientDetails>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="pb-name" className="mb-1 block text-sm font-medium text-gray-900">
          {t('patientName')} <span className="text-red-500">*</span>
        </label>
        <input
          id="pb-name"
          type="text"
          autoComplete="name"
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder={t('fullName')}
          className={inputClass(invalidField === 'name')}
        />
        {invalidField === 'name' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            {t('nameError')}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="pb-phone" className="mb-1 block text-sm font-medium text-gray-900">
          {t('mobileNumber')} <span className="text-red-500">*</span>
        </label>
        <input
          id="pb-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={value.phone}
          onChange={(event) => update({ phone: event.target.value })}
          placeholder={t('mobilePlaceholder')}
          className={inputClass(invalidField === 'phone')}
        />
        <p className="mt-1 text-xs text-gray-500">
          {t.en('mobileHint')}
          {t.bilingual && <span className="block">{t.regional('mobileHint')}</span>}
        </p>
        {invalidField === 'phone' && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" />
            {t('phoneError')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pb-age" className="mb-1 block text-sm font-medium text-gray-900">
            {t('age')}
          </label>
          <input
            id="pb-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={119}
            value={value.age}
            onChange={(event) => update({ age: event.target.value })}
            placeholder={t('years')}
            className={inputClass(false)}
          />
        </div>

        <div>
          <label htmlFor="pb-gender" className="mb-1 block text-sm font-medium text-gray-900">
            {t('gender')}
          </label>
          <select
            id="pb-gender"
            value={value.gender}
            onChange={(event) => update({ gender: event.target.value })}
            className={inputClass(false)}
          >
            <option value="">{t('select')}</option>
            <option value="male">{t('male')}</option>
            <option value="female">{t('female')}</option>
            <option value="other">{t('other')}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="pb-notes" className="mb-1 block text-sm font-medium text-gray-900">
          {t('reasonForVisit')}{' '}
          {/* Already inside brackets, so the two words are slashed, not nested. */}
          <span className="font-normal text-gray-500">
            ({t.en('optional')}
            {t.bilingual ? ` / ${t.regional('optional')}` : ''})
          </span>
        </label>
        <textarea
          id="pb-notes"
          rows={3}
          maxLength={500}
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          placeholder={t('notesPlaceholder')}
          className={inputClass(false)}
        />
      </div>

      <p className="text-xs leading-relaxed text-gray-500">
        {t.en('consent')}
        {t.bilingual && <span className="mt-1 block">{t.regional('consent')}</span>}
      </p>
    </div>
  );
};

export default PatientDetailsForm;
