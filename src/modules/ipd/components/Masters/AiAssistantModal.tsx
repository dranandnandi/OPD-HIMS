import { useState } from 'react';
import toast from 'react-hot-toast';
import { X, Sparkles, Wand2, Check } from 'lucide-react';
import { aiAssistantService, AiPlan } from '../../services/aiAssistantService';

interface Props {
  clinicId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function AiAssistantModal({ clinicId, onClose, onCreated }: Props) {
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resultLog, setResultLog] = useState<string[] | null>(null);

  const generate = async () => {
    if (!instruction.trim()) return;
    setGenerating(true);
    setPlan(null);
    try {
      const p = await aiAssistantService.generatePlan(clinicId, instruction.trim());
      setPlan(p);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const create = async () => {
    if (!plan) return;
    setCreating(true);
    try {
      const log = await aiAssistantService.executePlan(clinicId, plan);
      setResultLog(log);
      toast.success('Masters created');
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const total =
    (plan?.wards.length ?? 0) + (plan?.bed_types.length ?? 0) +
    (plan?.beds.reduce((s, b) => s + b.count, 0) ?? 0) +
    (plan?.services.length ?? 0) + (plan?.service_class_rates.length ?? 0) +
    (plan?.packages.length ?? 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5 max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-600" /> AI Masters Assistant
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {resultLog ? (
          <div>
            <p className="text-sm font-medium text-emerald-700 mb-2">✓ Created:</p>
            <ul className="text-sm text-slate-600 space-y-1 mb-4">
              {resultLog.map((line, i) => <li key={i}>• {line}</li>)}
            </ul>
            <button onClick={onClose} className="bg-navy-700 text-white text-sm rounded-lg px-4 py-2">
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-2">
              Describe in plain English — e.g. “5 beds in general ward, 7 in twin sharing on 2nd floor”,
              “add dressing large 800 rs private class”, “LSCS package 40k general 55k private,
              investigations limit 4000 general 6000 private, implants excluded”.
            </p>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="What should I set up?"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
            />
            <button
              onClick={generate}
              disabled={generating || !instruction.trim()}
              className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              <Wand2 className="w-4 h-4" />
              {generating ? 'Thinking…' : plan ? 'Regenerate' : 'Generate plan'}
            </button>

            {plan && (
              <div className="mt-4 border border-slate-200 rounded-lg p-3">
                <p className="text-sm font-medium text-slate-800 mb-2">{plan.summary}</p>
                <div className="text-sm text-slate-600 space-y-1.5 mb-3">
                  {plan.bed_types.map((bt, i) => (
                    <p key={`bt${i}`}>🛏 New bed class <b>{bt.name}</b> ({bt.code}) — ₹{bt.daily_rent}/day, rate ×{bt.rate_multiplier}{bt.is_critical_care ? ', critical care' : ''}</p>
                  ))}
                  {plan.wards.map((w, i) => (
                    <p key={`w${i}`}>🏥 New ward <b>{w.name}</b> ({w.ward_type}{w.floor ? `, floor ${w.floor}` : ''})</p>
                  ))}
                  {plan.beds.map((b, i) => (
                    <p key={`b${i}`}>🛏 <b>{b.count} beds</b> in {b.ward_name} — class {b.bed_type}, numbered {b.number_prefix}{b.start_number}–{b.number_prefix}{b.start_number + b.count - 1}</p>
                  ))}
                  {plan.services.map((s, i) => (
                    <p key={`s${i}`}>🧾 Service <b>{s.service_code}</b> {s.name} — ₹{s.price} ({s.charge_group_code}{s.is_sharable ? ', sharable' : ''})</p>
                  ))}
                  {plan.service_class_rates.map((r, i) => (
                    <p key={`cr${i}`}>💱 Class rate: <b>{r.service_code}</b> @ {r.bed_type} = ₹{r.rate.toLocaleString('en-IN')}</p>
                  ))}
                  {plan.packages.map((p, i) => (
                    <div key={`p${i}`}>
                      <p>📦 Package <b>{p.name}</b> — ₹{p.price.toLocaleString('en-IN')}
                        {p.stay_days ? `, ${p.stay_days} days` : ''}
                        {p.per_day_bed_cap ? `, bed cap ₹${p.per_day_bed_cap}/day` : ''}</p>
                      <ul className="ml-5 text-xs text-slate-500">
                        {p.inclusions.map((inc, j) => (
                          <li key={j}>+ {inc.charge_group_code ?? inc.service_code}
                            {inc.bed_type ? ` [${inc.bed_type}]` : ''}
                            {inc.max_amount ? ` max ₹${inc.max_amount}` : ''}
                            {inc.max_quantity ? ` max ${inc.max_quantity} qty` : ''}</li>
                        ))}
                        {p.exclusions.map((exc, j) => (
                          <li key={`e${j}`}>− {exc.charge_group_code ?? exc.service_code} (excluded)</li>
                        ))}
                        {p.class_prices.map((cp, j) => (
                          <li key={`c${j}`}>₹ {cp.bed_type}: ₹{cp.price.toLocaleString('en-IN')}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {total === 0 && <p className="text-slate-400">Nothing recognized to create — rephrase the request.</p>}
                </div>
                <button
                  onClick={create}
                  disabled={creating || total === 0}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
                >
                  <Check className="w-4 h-4" />
                  {creating ? 'Creating…' : `Create all (${total} items)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
