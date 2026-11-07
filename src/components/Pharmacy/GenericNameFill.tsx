import React, { useEffect, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import type { MedicineMaster } from '../../types';
import { genericNameService } from '../../services/genericNameService';
import { genericNameReviewReason, hasVerifiedGenericName, lookupInput, sameLookupInput } from '../../utils/genericNameMatching';
import type { GenericNameReview } from '../../utils/genericNameMatching';

interface Props { clinicId: string; medicines: MedicineMaster[]; onSaved: () => Promise<void> }
interface Draft { medicine: MedicineMaster; review: GenericNameReview; genericName: string; selectedSourceId: string; verified: boolean }

const GenericNameFill: React.FC<Props> = ({ clinicId, medicines, onSaved }) => {
  const [reviews, setReviews] = useState<GenericNameReview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [reviewQueue, setReviewQueue] = useState<MedicineMaster[]>([]);
  const [reviewPage, setReviewPage] = useState(0);
  useEffect(() => {
    let current = true;
    setReviews(null);
    setError('');
    genericNameService.getReviews(clinicId).then(rows => { if (current) setReviews(rows); })
      .catch(err => { if (current) setError(err instanceof Error ? err.message : 'Could not load generic-name reviews.'); });
    return () => { current = false; };
  }, [clinicId]);

  const reviewById = new Map((reviews ?? []).map(review => [review.medicine_id, review]));
  const needsReview = medicines.filter(m => genericNameReviewReason(m) && !hasVerifiedGenericName(m, reviewById.get(m.id)));
  const missingCount = needsReview.filter(m => genericNameReviewReason(m) === 'missing').length;
  const copiedCount = needsReview.length - missingCount;
  const currentReview = (medicine: MedicineMaster) => {
    const review = reviewById.get(medicine.id);
    return review && sameLookupInput(lookupInput(medicine), review.input_snapshot) ? review : undefined;
  };
  const eligible = needsReview.filter(m => !currentReview(m)?.source_version.startsWith('claude-'));
  const pending = needsReview.filter(m => ['pending', 'verified'].includes(currentReview(m)?.status ?? ''));
  const unmatched = needsReview.filter(m => currentReview(m)?.status === 'no_match');
  const makeDrafts = (selected: MedicineMaster[], available = reviews ?? []): Draft[] => {
    const byId = new Map(available.map(review => [review.medicine_id, review]));
    return selected.flatMap(medicine => {
      const review = byId.get(medicine.id);
      if (!review || !sameLookupInput(lookupInput(medicine), review.input_snapshot)) return [];
      // The old community catalogue has only two composition fields and can
      // truncate combinations. Never prefill those cached suggestions again.
      const candidates = review.source_version.startsWith('claude-') ? review.candidates : [];
      const unambiguous = new Set(candidates.map(candidate => candidate.genericName.toLowerCase())).size === 1;
      const exact = candidates.filter(candidate => candidate.match === 'Exact product name');
      const exactUnambiguous = exact.length > 0 && new Set(exact.map(candidate => candidate.genericName.toLowerCase())).size === 1;
      const candidate = exactUnambiguous ? exact[0] : unambiguous ? candidates[0] : undefined;
      return [{ medicine, review, genericName: candidate?.genericName ?? '', selectedSourceId: candidate?.id ?? '', verified: false }];
    });
  };
  const openReviews = (selected: MedicineMaster[], available = reviews ?? []) => {
    setReviewQueue(selected);
    setReviewPage(0);
    setDrafts(makeDrafts(selected.slice(0, 10), available));
  };
  const moveReviewPage = (page: number) => {
    setReviewPage(page);
    setDrafts(makeDrafts(reviewQueue.slice(page * 10, page * 10 + 10)));
  };
  const runLookup = async (selected: MedicineMaster[]) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await genericNameService.lookup(selected);
      const updated = await genericNameService.getReviews(clinicId);
      setReviews(updated);
      openReviews(selected, updated);
      if (result.errors.length) setError(result.errors.map(row => `${row.name}: ${row.message}`).join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look up generic names.');
      // Completed SKUs may already have been persisted before a batch timeout.
      try { setReviews(await genericNameService.getReviews(clinicId)); } catch { /* Keep the original error. */ }
    }
    finally { setBusy(false); }
  };
  const updateDraft = (id: string, changes: Partial<Draft>) => setDrafts(rows => rows?.map(row => row.medicine.id === id ? { ...row, ...changes } : row) ?? null);
  const save = async () => {
    const selected = (drafts ?? []).filter(row => row.verified && row.genericName.trim().length >= 2);
    if (!selected.length) return;
    setBusy(true); setError('');
    try {
      const results = await genericNameService.saveVerified(selected.map(row => ({ review: row.review, genericName: row.genericName, selectedSourceId: row.selectedSourceId })));
      const saved = results.filter(row => row.result === 'saved').length;
      const skipped = results.length - saved;
      setMessage(`${saved} verified generic name${saved === 1 ? '' : 's'} saved.${skipped ? ` ${skipped} SKU(s) changed or already had a generic name; reload and review them.` : ''}`);
      // Remove only processed rows; unverified rows stay available for review.
      const processed = new Set(results.map(row => row.medicine_id));
      const updated = await genericNameService.getReviews(clinicId);
      setReviews(updated);
      const remaining = reviewQueue.filter(medicine => !processed.has(medicine.id));
      const retained = new Map((drafts ?? []).filter(row => !processed.has(row.medicine.id)).map(row => [row.medicine.id, row]));
      setReviewQueue(remaining); setReviewPage(0);
      setDrafts(remaining.length ? makeDrafts(remaining.slice(0, 10), updated).map(row => retained.get(row.medicine.id) ?? row) : null);
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save verified generic names.'); }
    finally { setBusy(false); }
  };
  const verifiedCount = drafts?.filter(row => row.verified && row.genericName.trim().length >= 2).length ?? 0;

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-gray-800">Fill or clean generic names</h3>
          <p className="text-sm text-gray-600">{missingCount} SKU(s) have no generic name; {copiedCount} repeat the brand or medicine name. Claude checks web sources for up to 10 SKUs, then you verify each replacement.</p>
          <p className="text-xs text-gray-500 mt-1">Completed web lookups are remembered. Older catalogue suggestions can be rechecked once with Claude. Lookups may take a minute.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !reviews || !eligible.length} onClick={() => runLookup(eligible.slice(0, 10))} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {busy ? 'Looking up sources…' : `Fill with Claude (${Math.min(10, eligible.length)})`}
          </button>
          {pending.length > 0 && <button disabled={busy} onClick={() => openReviews(pending)} className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 disabled:opacity-50">Review suggestions ({pending.length})</button>}
          {unmatched.length > 0 && <button disabled={busy} onClick={() => openReviews(unmatched)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 disabled:opacity-50">Review unmatched ({unmatched.length})</button>}
        </div>
      </div>
      {!reviews && !error && <p className="text-sm text-gray-500">Loading previous lookups…</p>}
      {message && <p role="status" className="text-sm text-green-800">{message}</p>}
      {error && !drafts && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {drafts && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="generic-review-title">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
          <div className="border-b p-5 flex items-start justify-between gap-4">
            <div>
              <h3 id="generic-review-title" className="text-lg font-semibold">Verify generic names</h3>
              <p className="text-sm text-gray-600">Compare the complete composition, strength and form with the medicine pack. Confirm each SKU you want to save.</p>
              <p className="text-xs text-gray-500">Claude web lookup · Sources are linked beside each composition.</p>
            </div>
            <button aria-label="Close generic-name review" disabled={busy} onClick={() => setDrafts(null)} className="p-1 text-gray-500 disabled:opacity-50"><X className="w-5 h-5" /></button>
          </div>
          <div className="overflow-y-auto p-5 space-y-4">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {drafts.length === 0 && <p className="text-sm text-gray-600">These SKUs changed or were already filled. Close this window and reload the medicine list.</p>}
            {drafts.map(row => {
              const candidate = row.review.candidates.find(c => c.id === row.selectedSourceId);
              const sourced = row.review.source_version.startsWith('claude-');
              return <div key={row.medicine.id} className="border rounded-lg p-4 space-y-3">
                <div><strong>{row.medicine.name}</strong><p className="text-xs text-gray-500">{[row.medicine.strength, row.medicine.dosageForm, row.medicine.manufacturer].filter(Boolean).join(' · ')}</p>
                  {row.medicine.genericName?.trim() && <p className="text-sm text-amber-800 mt-1">Current generic: {row.medicine.genericName} — repeats the brand or medicine name. Verify the replacement below.</p>}
                </div>
                {!sourced && <p className="text-sm text-amber-800">This older catalogue result may omit ingredients. Recheck with Claude or enter the complete composition from the pack.</p>}
                {sourced && row.review.candidates.length > 0 ? <>
                  <label className="block text-sm font-medium text-gray-700">Matched catalogue product
                    <select disabled={busy} value={row.selectedSourceId} onChange={e => {
                      const selected = row.review.candidates.find(c => c.id === e.target.value);
                      updateDraft(row.medicine.id, { selectedSourceId: e.target.value, genericName: selected?.genericName ?? '', verified: false });
                    }} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal">
                      <option value="">Choose a product, or enter manually from the pack</option>
                      {row.review.candidates.map(c => <option key={c.id} value={c.id}>{c.name} — {c.manufacturer}</option>)}
                    </select>
                  </label>
                  {candidate && <div className="rounded bg-amber-50 p-3 text-sm text-gray-700 space-y-1"><p className="font-medium">{candidate.match}</p><p>Composition: {candidate.composition}</p>
                    {candidate.ingredients && <ul className="list-disc pl-5">{candidate.ingredients.map((ingredient, index) => <li key={index}>{ingredient.name} — {ingredient.strength}</li>)}</ul>}
                    <p className="text-xs">{candidate.manufacturer} · {candidate.pack}</p>
                    {candidate.notes && <p className="text-sm text-amber-900">{candidate.notes}</p>}
                    {candidate.sources?.filter(source => /^https:\/\//i.test(source.url)).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block text-xs text-blue-700 underline">{source.title || source.url}</a>)}
                  </div>}
                  {!candidate && <p className="text-sm text-amber-800">Select the exact catalogue product or enter the generic names from the pack.</p>}
                </> : sourced ? <p className="text-sm text-amber-800">No complete source-backed match. Enter the complete composition from the pack or leave this SKU for later.</p> : null}
                <label className="block text-sm font-medium text-gray-700">Generic name(s)
                  <input disabled={busy} value={row.genericName} maxLength={500} onChange={e => updateDraft(row.medicine.id, { genericName: e.target.value, verified: false })} placeholder="e.g. Amoxycillin + Clavulanic Acid" className="mt-1 w-full border rounded-lg p-2 font-normal" />
                </label>
                <label className="flex gap-2 items-start text-sm text-gray-700"><input type="checkbox" disabled={busy || row.genericName.trim().length < 2} checked={row.verified} onChange={e => updateDraft(row.medicine.id, { verified: e.target.checked })} className="mt-0.5" />I checked this SKU's complete composition, strength and dosage form against the pack.</label>
              </div>;
            })}
          </div>
          <div className="border-t p-4 flex flex-wrap justify-end gap-3">
            {drafts.some(row => !row.review.source_version.startsWith('claude-')) && <button disabled={busy || verifiedCount > 0} onClick={() => runLookup(drafts.filter(row => !row.review.source_version.startsWith('claude-')).map(row => row.medicine))} className="rounded-lg border border-blue-300 px-3 py-2 text-sm text-blue-700 disabled:opacity-50">Recheck with Claude</button>}
            {reviewQueue.length > 10 && <div className="mr-auto flex items-center gap-2 text-sm">
              <span>Batch {reviewPage + 1} of {Math.ceil(reviewQueue.length / 10)}</span>
              <button disabled={busy || reviewPage === 0 || verifiedCount > 0} onClick={() => moveReviewPage(reviewPage - 1)} className="border rounded px-2 py-1 disabled:opacity-50">Previous</button>
              <button disabled={busy || (reviewPage + 1) * 10 >= reviewQueue.length || verifiedCount > 0} onClick={() => moveReviewPage(reviewPage + 1)} className="border rounded px-2 py-1 disabled:opacity-50">Next</button>
            </div>}
            <button disabled={busy} onClick={() => setDrafts(null)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Review later</button>
            <button disabled={busy || !verifiedCount} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-green-600 text-white px-4 py-2 text-sm disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Save verified ({verifiedCount})</button>
          </div>
        </div>
      </div>}
    </div>
  );
};

export default GenericNameFill;
