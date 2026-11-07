import type { MedicineMaster } from '../../types';

export default function MedicineFlags({ medicine }: { medicine?: Pick<MedicineMaster, 'isNrx' | 'isScheduleH1'> | null }) {
  return <>
    {medicine?.isNrx && <span className="inline-block ml-2 px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-semibold">NRx</span>}
    {medicine?.isScheduleH1 && <span className="inline-block ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-semibold">H1</span>}
  </>;
}

export function MedicineFlagFields({ value, onChange }: {
  value: { isNrx?: boolean; isScheduleH1?: boolean };
  onChange: (patch: { isNrx?: boolean; isScheduleH1?: boolean }) => void;
}) {
  return <fieldset className="border rounded-lg p-3 space-y-2">
    <legend className="text-sm font-medium px-1">Medicine flags</legend>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={!!value.isNrx} onChange={e => onChange({ isNrx: e.target.checked })} />NRx — highlight in purchases and sales</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={!!value.isScheduleH1} onChange={e => onChange({ isScheduleH1: e.target.checked })} />Schedule H1</label>
    <p className="text-xs text-gray-500">Set these from the product label. Flagged sales appear in the NRx / H1 register.</p>
  </fieldset>;
}
