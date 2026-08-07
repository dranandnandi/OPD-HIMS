import React from 'react';
import { CheckCircle2, Calendar, Clock, User, Hash, Phone, MapPin } from 'lucide-react';
import type { BookingSuccess, PublicClinic } from '../../services/publicBookingService';

interface BookingConfirmationProps {
  booking: BookingSuccess;
  clinic: PublicClinic;
  onBookAnother: () => void;
}

/**
 * Build a .ics file in-browser so the patient can add the visit to their phone
 * calendar without the clinic sending anything. Times are absolute UTC
 * instants, so no timezone declaration is needed in the file.
 */
const buildCalendarFile = (booking: BookingSuccess, clinic: PublicClinic): string => {
  const stamp = (value: Date) =>
    `${value.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

  const start = new Date(booking.start);
  const end = new Date(start.getTime() + booking.duration * 60_000);

  const escape = (text: string) => text.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OPD//Public Booking//EN',
    'BEGIN:VEVENT',
    `UID:${booking.ref}@opd`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(`${booking.appointmentType} with ${booking.doctorName}`)}`,
    `DESCRIPTION:${escape(`Booking reference: ${booking.ref}`)}`,
    ...(clinic.address ? [`LOCATION:${escape(clinic.address)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
};

const BookingConfirmation: React.FC<BookingConfirmationProps> = ({
  booking,
  clinic,
  onBookAnother,
}) => (
  <div className="space-y-5">
    <div className="flex flex-col items-center gap-3 rounded-xl bg-green-50 p-6 text-center">
      <CheckCircle2 className="h-12 w-12 text-green-600" />
      <div>
        <h2 className="text-lg font-semibold text-green-900">
          {booking.autoConfirmed ? 'Appointment confirmed' : 'Appointment requested'}
        </h2>
        <p className="mt-1 text-sm text-green-800">
          {booking.autoConfirmed
            ? 'We look forward to seeing you.'
            : 'The clinic will confirm your slot shortly on your mobile number.'}
        </p>
      </div>
    </div>

    <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-3 p-4">
        <Hash className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <dt className="sr-only">Booking reference</dt>
        <dd className="font-mono text-base font-semibold tracking-wider text-gray-900">
          {booking.ref}
        </dd>
      </div>

      <div className="flex items-center gap-3 p-4">
        <User className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <dt className="sr-only">Doctor</dt>
        <dd className="text-sm text-gray-900">{booking.doctorName}</dd>
      </div>

      <div className="flex items-center gap-3 p-4">
        <Calendar className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <dt className="sr-only">Date and time</dt>
        <dd className="text-sm text-gray-900">{booking.display}</dd>
      </div>

      <div className="flex items-center gap-3 p-4">
        <Clock className="h-4 w-4 flex-shrink-0 text-gray-400" />
        <dt className="sr-only">Duration</dt>
        <dd className="text-sm text-gray-900">
          {booking.appointmentType} &middot; {booking.duration} minutes
        </dd>
      </div>

      {clinic.address && (
        <div className="flex items-start gap-3 p-4">
          <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <dt className="sr-only">Address</dt>
          <dd className="text-sm text-gray-900">{clinic.address}</dd>
        </div>
      )}
    </dl>

    <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
      Please save your booking reference <strong>{booking.ref}</strong>. Bring it
      with you, and call the clinic if you need to reschedule or cancel.
    </p>

    <div className="flex flex-col gap-2 sm:flex-row">
      <a
        href={buildCalendarFile(booking, clinic)}
        download={`appointment-${booking.ref}.ics`}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        <Calendar className="h-4 w-4" />
        Add to calendar
      </a>

      {clinic.phone && (
        <a
          href={`tel:${clinic.phone}`}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Phone className="h-4 w-4" />
          Call clinic
        </a>
      )}
    </div>

    <button
      type="button"
      onClick={onBookAnother}
      className="w-full rounded-lg px-4 py-2 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
    >
      Book another appointment
    </button>
  </div>
);

export default BookingConfirmation;
