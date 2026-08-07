import React from 'react';
import { Stethoscope, Check } from 'lucide-react';
import type { PublicAppointmentType, PublicDoctor } from '../../services/publicBookingService';

interface DoctorPickerProps {
  doctors: PublicDoctor[];
  appointmentTypes: PublicAppointmentType[];
  selectedDoctorId: string;
  selectedTypeLabel: string;
  currency: string;
  onSelectDoctor: (doctorId: string) => void;
  onSelectType: (label: string) => void;
}

const formatFee = (amount: number | null, currency: string): string | null => {
  if (amount === null || Number.isNaN(amount)) return null;

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return String(amount);
  }
};

const DoctorPicker: React.FC<DoctorPickerProps> = ({
  doctors,
  appointmentTypes,
  selectedDoctorId,
  selectedTypeLabel,
  currency,
  onSelectDoctor,
  onSelectType,
}) => {
  if (doctors.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        No doctors are currently accepting online appointments at this clinic.
        Please call the clinic to book.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {appointmentTypes.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Reason for visit</h2>
          <div className="flex flex-wrap gap-2">
            {appointmentTypes.map((type) => {
              const isSelected = type.label === selectedTypeLabel;

              return (
                <button
                  key={type.label}
                  type="button"
                  onClick={() => onSelectType(type.label)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    isSelected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400'
                  }`}
                >
                  {type.label}
                  <span className={isSelected ? 'text-blue-100' : 'text-gray-400'}>
                    {' '}· {type.duration} min
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Choose a doctor</h2>
        <div className="space-y-3">
          {doctors.map((doctor) => {
            const isSelected = doctor.id === selectedDoctorId;
            const fee = formatFee(doctor.fee, currency);

            return (
              <button
                key={doctor.id}
                type="button"
                onClick={() => onSelectDoctor(doctor.id)}
                aria-pressed={isSelected}
                className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                    : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {isSelected ? <Check className="h-5 w-5" /> : <Stethoscope className="h-5 w-5" />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900">
                    {doctor.name.toLowerCase().startsWith('dr') ? doctor.name : `Dr. ${doctor.name}`}
                  </span>

                  {doctor.specialization && (
                    <span className="block text-sm text-gray-600">{doctor.specialization}</span>
                  )}

                  {doctor.qualification && (
                    <span className="block text-xs text-gray-500">{doctor.qualification}</span>
                  )}

                  {fee && (
                    <span className="mt-1 inline-block text-sm font-medium text-gray-900">
                      {fee}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default DoctorPicker;
