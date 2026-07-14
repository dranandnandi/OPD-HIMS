import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { masterService } from '../../services/masterService';
import type { BedType, ServiceMaster } from '../../types/ipd';

interface Props {
  clinicId: string;
  bedTypes: BedType[];
  services: ServiceMaster[];
  onChange: () => void;
}

/** Bed classes: create (auto room-rent service), edit name/rent/multiplier, deactivate */
export default function BedTypesCard({ clinicId, bedTypes, services, onChange }: Props) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rent, setRent] = useState('');
  const [multiplier, setMultiplier] = useState('1');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', rent: '', multiplier: '' });

  const rentOf = (bt: BedType) =>
    services.find((s) => s.id === bt.room_rent_service_id)?.base_price ?? 0;

  const create = async () => {
    if (!name.trim() || !code.trim() || !rent) {
      toast.error('Name, code and daily rent are required');
      return;
    }
    setSaving(true);
    try {
      await masterService.createBedType({
        clinicId,
        code: code.trim(),
        name: name.trim(),
        dailyRent: Number(rent),
        rateMultiplier: Number(multiplier) || 1,
      });
      toast.success('Bed class created (room-rent service auto-created)');
      setName(''); setCode(''); setRent(''); setMultiplier('1');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (bt: BedType) => {
    setEditingId(bt.id);
    setEdit({
      name: bt.name,
      rent: String(rentOf(bt)),
      multiplier: String(bt.rate_multiplier ?? 1),
    });
  };

  const saveEdit = async (bt: BedType) => {
    try {
      if (edit.name.trim() && edit.name !== bt.name) {
        await masterService.renameBedType(bt.id, edit.name.trim());
      }
      if (edit.rent && Number(edit.rent) !== rentOf(bt)) {
        await masterService.setBedTypeRent(bt.room_rent_service_id, Number(edit.rent));
      }
      if (edit.multiplier && Number(edit.multiplier) !== bt.rate_multiplier) {
        await masterService.updateBedTypeMultiplier(bt.id, Number(edit.multiplier));
      }
      toast.success('Bed class updated');
      setEditingId(null);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (bt: BedType) => {
    if (!confirm(`Deactivate "${bt.name}"? Existing beds keep this class; it disappears from pickers.`)) return;
    try {
      await masterService.deactivateBedType(bt.id);
      toast.success('Bed class deactivated');
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 md:col-span-2">
      <h2 className="text-sm font-medium text-slate-700 mb-1">Bed classes</h2>
      <p className="text-xs text-slate-400 mb-3">
        Rate multiplier applies the class uplift to every service without an explicit class rate
        (e.g. Private ×1.3 bills all services at 130% of base).
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name (Twin Sharing)"
          className="flex-1 min-w-36 border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (TWIN)"
          className="w-24 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="Rent ₹/day"
          className="w-28 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" step="0.05" value={multiplier} onChange={(e) => setMultiplier(e.target.value)}
          title="Rate multiplier" placeholder="×1.0"
          className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={create} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {bedTypes.map((bt) => (
          <div key={bt.id} className="border border-slate-200 rounded-lg p-2.5 text-sm">
            {editingId === bt.id ? (
              <div className="space-y-1.5">
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                <div className="flex gap-1.5 items-center">
                  <span className="text-xs text-slate-500">₹</span>
                  <input type="number" value={edit.rent} onChange={(e) => setEdit({ ...edit, rent: e.target.value })}
                    title="Daily rent" className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs" />
                  <span className="text-xs text-slate-500">/day · ×</span>
                  <input type="number" step="0.05" value={edit.multiplier}
                    onChange={(e) => setEdit({ ...edit, multiplier: e.target.value })}
                    title="Rate multiplier" className="w-16 border border-slate-300 rounded px-1.5 py-0.5 text-xs" />
                </div>
                <div className="flex gap-1">
                  <button onClick={() => saveEdit(bt)}
                    className="flex items-center gap-1 text-xs bg-emerald-600 text-white rounded px-2 py-1">
                    <Check className="w-3 h-3" /> Save
                  </button>
                  <button onClick={() => setEditingId(null)}
                    className="flex items-center gap-1 text-xs border border-slate-300 text-slate-500 rounded px-2 py-1">
                    <X className="w-3 h-3" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-1">
                  <p className="font-medium text-slate-800">
                    {bt.name} <span className="text-xs text-slate-400">({bt.code})</span>
                  </p>
                  <div className="flex gap-0.5 shrink-0">
                    <button onClick={() => startEdit(bt)} title="Edit"
                      className="p-1 text-slate-400 hover:text-navy-700">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(bt)} title="Deactivate"
                      className="p-1 text-slate-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  ₹{rentOf(bt).toLocaleString('en-IN')}/day · rate ×{bt.rate_multiplier ?? 1}
                  {bt.is_critical_care ? ' · critical care' : ''}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
