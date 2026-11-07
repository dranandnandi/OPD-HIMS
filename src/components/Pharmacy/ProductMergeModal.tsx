import { useState } from 'react';
import type { MedicineWithPrice } from '../../types';
import { masterDataService } from '../../services/masterDataService';
import MedicineSearchSelect from './MedicineSearchSelect';
import { packSpec, stockBreakdown } from '../../utils/packUnits';

export default function ProductMergeModal({ medicines, onClose, onMerged }: {
  medicines: MedicineWithPrice[]; onClose: () => void; onMerged: () => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(''), [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const source = medicines.find(m => m.id === sourceId), target = medicines.find(m => m.id === targetId);
  async function merge() {
    if (!source || !target || sourceId === targetId || !confirmed || reason.trim().length < 5) return;
    setBusy(true); setError('');
    try { await masterDataService.mergeMedicines(sourceId, targetId, reason); await onMerged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not merge products.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Merge duplicate products">
    <div className="bg-white rounded-xl p-6 max-w-2xl w-full space-y-4">
      <h3 className="text-lg font-semibold">Merge duplicate products</h3>
      <p className="text-sm text-gray-600">Merge the same medicine only when both products have the same recorded pack MRP. Batches retain their expiry and receipt order (FIFO). Invoice lines stay separate. Matching MRP alone does not identify the same medicine.</p>
      <fieldset disabled={busy} className="space-y-4">
        <div><label className="block text-sm mb-1">Duplicate product to retire</label><MedicineSearchSelect medicines={medicines.filter(m => m.id !== targetId)} value={sourceId} onChange={id => { setSourceId(id); setConfirmed(false); }} /></div>
        <div><label className="block text-sm mb-1">Product to keep (its name and selling price remain)</label><MedicineSearchSelect medicines={medicines.filter(m => m.id !== sourceId)} value={targetId} onChange={id => { setTargetId(id); setConfirmed(false); }} /></div>
        {source && target && <div className="bg-blue-50 rounded p-3 text-sm space-y-1">
          <p>Duplicate: {source.name} — {stockBreakdown(source.currentStock, packSpec(source))}</p>
          <p>Keep: {target.name} — {stockBreakdown(target.currentStock, packSpec(target))}</p>
          <p>Combined stock: {stockBreakdown(source.currentStock + target.currentStock, packSpec(target))}</p>
          <p>Recorded pack MRP, strength, form, manufacturer, GST and pack rules must match. Unknown or different MRPs, shared batch numbers or conflicting store balances require review first.</p>
        </div>}
        <label className="block text-sm">Reason<textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className="block border rounded p-2 w-full mt-1" /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I verified both records refer to the same medicine and pack. Retire the duplicate and retain an audit record.</label>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3"><button disabled={busy} onClick={onClose} className="border rounded px-4 py-2">Cancel</button><button disabled={busy || !confirmed || !source || !target || reason.trim().length < 5} onClick={merge} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">{busy ? 'Merging…' : 'Merge products'}</button></div>
    </div>
  </div>;
}
