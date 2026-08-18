// Public, unauthenticated appointment booking.
//
// Reachable at /book/:clinicSlug on both deployed domains, plus the vanity
// rewrites configured in netlify.toml:
//   https://opdapp.anprohealthtech.com/book/meditrust
//   https://opdapp.anprohealthtech.com/opd/meditrust/appointment
//   https://docpreneur.academy/meditrust/appointment
//
// Intentionally NOT built on the staff booking modal in AppointmentCalendar.
// That form is welded to authenticated context -- clinic-wide patient search,
// QR scanning, AddVisitModal, waiting sequences -- none of which may be exposed
// to anonymous visitors. This page holds no Supabase client at all and talks
// only to the `public-booking` edge function.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, ArrowLeft, ArrowRight, Building2, AlertTriangle, Info } from 'lucide-react';
import { brand } from '../config/branding';
import {
  addDays,
  publicBookingService,
  PublicBookingError,
  weekdayOf,
  type BookingSuccess,
  type ClinicResponse,
  type PublicSlot,
} from '../services/publicBookingService';
import DoctorPicker from '../components/PublicBooking/DoctorPicker';
import SlotPicker from '../components/PublicBooking/SlotPicker';
import PatientDetailsForm, {
  type PatientDetails,
} from '../components/PublicBooking/PatientDetailsForm';
import BookingConfirmation from '../components/PublicBooking/BookingConfirmation';
import { createTranslator, type TextKey } from '../components/PublicBooking/i18n';

type Step = 'doctor' | 'slot' | 'details' | 'done';

const STEP_ORDER: Step[] = ['doctor', 'slot', 'details', 'done'];
const STEP_LABELS: Record<Step, TextKey> = {
  doctor: 'stepDoctor',
  slot: 'stepDateTime',
  details: 'stepDetails',
  done: 'stepConfirmed',
};

const EMPTY_DETAILS: PatientDetails = {
  name: '',
  phone: '',
  age: '',
  gender: '',
  notes: '',
};

const PublicBooking: React.FC = () => {
  const { clinicSlug = '' } = useParams<{ clinicSlug: string }>();
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get('embed') === '1';

  const [data, setData] = useState<ClinicResponse | null>(null);
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'not_found' | 'error'>(
    'loading',
  );
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState<Step>('doctor');
  const [doctorId, setDoctorId] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');

  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [details, setDetails] = useState<PatientDetails>(EMPTY_DETAILS);
  const [submitting, setSubmitting] = useState(false);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [banner, setBanner] = useState('');
  const [booking, setBooking] = useState<BookingSuccess | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // --- load clinic ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!clinicSlug) {
        setPageState('not_found');
        return;
      }

      try {
        const response = await publicBookingService.getClinic(clinicSlug);
        if (cancelled) return;

        if (!response) {
          setPageState('not_found');
          return;
        }

        setData(response);
        setTypeLabel(response.appointmentTypes[0]?.label ?? 'Consultation');
        if (response.doctors.length === 1) setDoctorId(response.doctors[0].id);
        setPageState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof PublicBookingError ? error.message : 'Something went wrong.',
        );
        setPageState('error');
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [clinicSlug]);

  useEffect(() => {
    if (data?.clinic.name) {
      document.title = `Book an appointment · ${data.clinic.name}`;
    }
  }, [data?.clinic.name]);

  // Let a host page size the iframe to its content.
  useEffect(() => {
    if (!isEmbed || !containerRef.current) return;

    const postHeight = () => {
      window.parent.postMessage(
        { type: 'opd-booking-resize', height: document.body.scrollHeight },
        '*',
      );
    };

    postHeight();
    const observer = new ResizeObserver(postHeight);
    observer.observe(document.body);

    return () => observer.disconnect();
  }, [isEmbed, step, slots.length]);

  // Page furniture renders as "English (regional)" once the clinic's chosen
  // language arrives. Doctor names, appointment types and the clinic's own
  // notice are passed through untouched -- see PublicBooking/i18n.ts.
  const t = useMemo(() => createTranslator(data?.clinic.language), [data?.clinic.language]);

  const selectedDoctor = useMemo(
    () => data?.doctors.find((doctor) => doctor.id === doctorId) ?? null,
    [data, doctorId],
  );

  /** First bookable day for a doctor, honouring their weekly pattern. */
  const firstOpenDate = useCallback(
    (openDays: string[]): string => {
      if (!data) return '';

      const { today, horizonDays, blackoutDates } = data.clinic;
      for (let offset = 0; offset < horizonDays; offset += 1) {
        const dateKey = addDays(today, offset);
        if (openDays.includes(weekdayOf(dateKey)) && !blackoutDates.includes(dateKey)) {
          return dateKey;
        }
      }
      return '';
    },
    [data],
  );

  // --- load slots ----------------------------------------------------------

  useEffect(() => {
    if (!doctorId || !selectedDate || !typeLabel) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);

    const load = async () => {
      try {
        const result = await publicBookingService.getSlots(
          clinicSlug,
          doctorId,
          selectedDate,
          typeLabel,
        );
        if (!cancelled) setSlots(result);
      } catch {
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [clinicSlug, doctorId, selectedDate, typeLabel]);

  // --- navigation ----------------------------------------------------------

  const goToSlots = () => {
    if (!selectedDoctor) return;

    if (!selectedDate) setSelectedDate(firstOpenDate(selectedDoctor.openDays));
    setBanner('');
    setStep('slot');
  };

  const goBack = () => {
    setBanner('');
    const index = STEP_ORDER.indexOf(step);
    if (index > 0) setStep(STEP_ORDER[index - 1]);
  };

  const handleSelectDoctor = (nextDoctorId: string) => {
    setDoctorId(nextDoctorId);
    // A different doctor means a different schedule; anything already picked is
    // no longer meaningful.
    setSelectedSlot('');

    const doctor = data?.doctors.find((entry) => entry.id === nextDoctorId);
    setSelectedDate(doctor ? firstOpenDate(doctor.openDays) : '');
  };

  const handleSelectType = (nextLabel: string) => {
    setTypeLabel(nextLabel);
    // Slot length changes with the appointment type, so the grid shifts.
    setSelectedSlot('');
  };

  const handleSelectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setSelectedSlot('');
  };

  const handleSelectSlot = (startIso: string) => {
    setSelectedSlot(startIso);
    setBanner('');
    setStep('details');
  };

  // --- submit --------------------------------------------------------------

  const handleSubmit = async () => {
    if (!data || submitting) return;

    setSubmitting(true);
    setInvalidField(null);
    setBanner('');

    try {
      const result = await publicBookingService.book({
        slug: clinicSlug,
        doctorId,
        typeLabel,
        start: selectedSlot,
        name: details.name,
        phone: details.phone,
        age: details.age,
        gender: details.gender,
        notes: details.notes,
      });

      switch (result.status) {
        case 'booked':
          setBooking(result);
          setStep('done');
          break;

        case 'slot_taken':
          // Someone else took it while this form was open. Send them back to a
          // freshly loaded grid rather than leaving a dead slot selected.
          setSelectedSlot('');
          setStep('slot');
          setBanner(t('slotTaken'));
          break;

        case 'rate_limited':
          setBanner(t('rateLimited'));
          break;

        case 'invalid':
          setInvalidField(result.field);
          setBanner(t('checkField'));
          break;
      }
    } catch (error) {
      setBanner(
        error instanceof PublicBookingError ? error.message : 'Something went wrong.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForAnother = () => {
    setBooking(null);
    setSelectedSlot('');
    setDetails(EMPTY_DETAILS);
    setInvalidField(null);
    setBanner('');
    setStep('doctor');
  };

  // --- render --------------------------------------------------------------

  if (pageState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (pageState === 'not_found') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-300" />
          <h1 className="text-lg font-semibold text-gray-900">Booking page unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">
            This booking link is not active. Please check the link with the clinic
            or contact them directly.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === 'error' || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-amber-400" />
          <h1 className="text-lg font-semibold text-gray-900">Could not load this page</h1>
          <p className="mt-2 text-sm text-gray-600">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { clinic } = data;
  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div
      ref={containerRef}
      className={isEmbed ? 'bg-white' : 'min-h-screen bg-gray-50 py-6 px-4'}
    >
      <div className={isEmbed ? 'mx-auto max-w-lg p-4' : 'mx-auto max-w-lg'}>
        {!isEmbed && (
          <header className="mb-5 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
            {clinic.logoUrl ? (
              <img
                src={clinic.logoUrl}
                alt=""
                className="h-12 w-12 flex-shrink-0 rounded-lg object-contain"
              />
            ) : (
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <Building2 className="h-6 w-6 text-blue-600" />
              </span>
            )}

            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-gray-900">
                {clinic.name}
              </h1>
              {clinic.address && (
                <p className="truncate text-sm text-gray-600">{clinic.address}</p>
              )}
            </div>
          </header>
        )}

        {step !== 'done' && (
          <ol className="mb-5 flex items-center gap-2" aria-label="Booking steps">
            {STEP_ORDER.slice(0, 3).map((entry, index) => (
              <li key={entry} className="flex flex-1 flex-col gap-1.5">
                <span
                  className={`h-1 rounded-full ${
                    index <= stepIndex ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
                <span
                  className={`text-[11px] ${
                    index <= stepIndex ? 'font-medium text-blue-700' : 'text-gray-400'
                  }`}
                >
                  {t(STEP_LABELS[entry])}
                </span>
              </li>
            ))}
          </ol>
        )}

        {clinic.notice && step === 'doctor' && (
          <div className="mb-4 flex gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{clinic.notice}</p>
          </div>
        )}

        {banner && (
          <div
            role="alert"
            className="mb-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{banner}</p>
          </div>
        )}

        <main className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          {step === 'doctor' && (
            <DoctorPicker
              doctors={data.doctors}
              appointmentTypes={data.appointmentTypes}
              selectedDoctorId={doctorId}
              selectedTypeLabel={typeLabel}
              currency={clinic.currency}
              t={t}
              onSelectDoctor={handleSelectDoctor}
              onSelectType={handleSelectType}
            />
          )}

          {step === 'slot' && selectedDoctor && (
            <SlotPicker
              doctor={selectedDoctor}
              today={clinic.today}
              horizonDays={clinic.horizonDays}
              blackoutDates={clinic.blackoutDates}
              selectedDate={selectedDate}
              selectedSlot={selectedSlot}
              slots={slots}
              loading={slotsLoading}
              t={t}
              onSelectDate={handleSelectDate}
              onSelectSlot={handleSelectSlot}
            />
          )}

          {step === 'details' && (
            <PatientDetailsForm
              value={details}
              invalidField={invalidField}
              t={t}
              onChange={setDetails}
            />
          )}

          {step === 'done' && booking && (
            <BookingConfirmation
              booking={booking}
              clinic={clinic}
              t={t}
              onBookAnother={resetForAnother}
            />
          )}
        </main>

        {step !== 'done' && (
          <div className="mt-4 flex items-center gap-3">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('back')}
              </button>
            )}

            {step === 'doctor' && (
              <button
                type="button"
                onClick={goToSlots}
                disabled={!doctorId}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {t('seeTimes')}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}

            {step === 'details' && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('bookingInProgress')}
                  </>
                ) : (
                  t('confirmAppointment')
                )}
              </button>
            )}
          </div>
        )}

        {!isEmbed && (
          <p className="mt-6 text-center text-xs text-gray-400">{brand.poweredBy}</p>
        )}
      </div>
    </div>
  );
};

export default PublicBooking;
