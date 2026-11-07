import { useEffect, useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { ControlledSaleDetails } from '../../types';

interface ControlledSupplyPopupProps {
  details: ControlledSaleDetails;
  prescriptionChecked: boolean;
  today: string;
  onChange: (details: ControlledSaleDetails) => void;
  onPrescriptionChecked: (checked: boolean) => void;
  onContinue: () => void;
  onClose: () => void;
}

export default function ControlledSupplyPopup({ details, prescriptionChecked, today, onChange, onPrescriptionChecked, onContinue, onClose }: ControlledSupplyPopupProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="controlled-supply-title" aria-describedby="controlled-supply-description"
    className="w-[calc(100%_-_2rem)] max-w-2xl max-h-[90vh] rounded-xl p-0 shadow-xl backdrop:bg-black/50">
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="controlled-supply-title" className="flex items-center gap-2 text-lg font-semibold text-red-800"><AlertCircle className="w-5 h-5" />NRx / H1 medicine</h3>
        <button type="button" onClick={onClose} aria-label="Close NRx / H1 popup" className="p-2 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
      </div>
      <p id="controlled-supply-description" className="text-sm text-gray-700">This sale includes NRx / H1 medicine. You can continue now or add prescription and supply details below. All fields are optional.</p>
      <details className="border rounded-lg p-3">
        <summary className="cursor-pointer font-medium text-sm text-blue-700">Add prescription details (optional)</summary>
        <fieldset className="mt-4 space-y-3">
          <legend className="sr-only">NRx / H1 prescription and supply details</legend>
          <div className="grid md:grid-cols-2 gap-3">{([
            ['patientName', 'Patient name'], ['patientAddress', 'Patient address'],
            ['prescriberName', 'Prescriber name'], ['prescriberAddress', 'Prescriber address'],
            ['prescriptionReference', 'Prescription number / retained-copy reference'], ['prescriptionDate', 'Prescription date'],
            ['pharmacistName', 'Supervising pharmacist name'], ['pharmacistRegistration', 'Pharmacist registration number'],
          ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input type={key === 'prescriptionDate' ? 'date' : 'text'} max={key === 'prescriptionDate' ? today : undefined} maxLength={2000} value={details[key] ?? ''}
            onChange={e => { onChange({ ...details, [key]: e.target.value }); onPrescriptionChecked(false); }} className="block w-full mt-1 border rounded px-3 py-2" /></label>)}</div>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={prescriptionChecked} onChange={e => onPrescriptionChecked(e.target.checked)} />I checked the prescription, patient and prescriber details and retained the required prescription reference (optional).</label>
          <p className="text-xs text-gray-500">Available details are saved in the register with each flagged medicine.</p>
        </fieldset>
      </details>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Back</button>
        <button type="button" onClick={onContinue} autoFocus className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Continue</button>
      </div>
    </div>
  </dialog>;
}
