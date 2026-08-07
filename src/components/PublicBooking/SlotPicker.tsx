import React from 'react';
import { Loader2, CalendarX } from 'lucide-react';
import {
  addDays,
  describeDate,
  formatSlotLabel,
  weekdayOf,
  type PublicDoctor,
  type PublicSlot,
} from '../../services/publicBookingService';

interface SlotPickerProps {
  doctor: PublicDoctor;
  /** Today in the CLINIC's timezone, from the server. */
  today: string;
  horizonDays: number;
  blackoutDates: string[];
  selectedDate: string;
  selectedSlot: string;
  slots: PublicSlot[];
  loading: boolean;
  onSelectDate: (dateKey: string) => void;
  onSelectSlot: (startIso: string) => void;
}

const SlotPicker: React.FC<SlotPickerProps> = ({
  doctor,
  today,
  horizonDays,
  blackoutDates,
  selectedDate,
  selectedSlot,
  slots,
  loading,
  onSelectDate,
  onSelectSlot,
}) => {
  const dates = Array.from({ length: horizonDays }, (_, index) => addDays(today, index));

  // The doctor's weekly pattern and the clinic's blackout list are both known
  // up front, so closed days are greyed out without a request per day.
  const isClosed = (dateKey: string) =>
    !doctor.openDays.includes(weekdayOf(dateKey)) || blackoutDates.includes(dateKey);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Pick a date</h2>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {dates.map((dateKey) => {
            const { weekday, day, month } = describeDate(dateKey);
            const closed = isClosed(dateKey);
            const isSelected = dateKey === selectedDate;

            return (
              <button
                key={dateKey}
                type="button"
                disabled={closed}
                onClick={() => onSelectDate(dateKey)}
                aria-pressed={isSelected}
                className={`flex w-16 flex-shrink-0 flex-col items-center rounded-xl border py-2 transition ${
                  closed
                    ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
                    : isSelected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                }`}
              >
                <span className="text-[11px] uppercase tracking-wide">{weekday}</span>
                <span className="text-lg font-semibold leading-tight">{day}</span>
                <span className="text-[11px]">{month}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Available times</h2>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking availability...
          </div>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-8 text-center">
            <CalendarX className="h-6 w-6 text-gray-400" />
            <p className="text-sm text-gray-600">No free slots on this day.</p>
            <p className="text-xs text-gray-500">Try another date.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => {
              const isSelected = slot.start === selectedSlot;

              return (
                <button
                  key={slot.start}
                  type="button"
                  onClick={() => onSelectSlot(slot.start)}
                  aria-pressed={isSelected}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition ${
                    isSelected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  {formatSlotLabel(slot.label)}
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default SlotPicker;
