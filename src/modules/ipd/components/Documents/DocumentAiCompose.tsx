import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Sparkles, Loader2, CheckCircle2, X, Wand2, Trash2, IndianRupee, Info, Plus,
} from 'lucide-react';
import {
  documentVoiceService, DocumentField, DictatedSection,
} from '../../services/documentVoiceService';
import {
  documentAiService, isCostedDocType, lineAmount, estimateTotal,
  AiComposeResult, ComposeSubject, EstimateLine, TariffSnapshot,
} from '../../services/documentAiService';
import { docTypeLabel } from '../../services/documentService';

interface Props {
  docType: string;
  documentNumber: string | null;
  /** who the document is for, and which rate card to price against */
  subject: ComposeSubject;
  /** live editor content — the sections offered are read out of this */
  contentHtml: string;
  /** hand back the rewritten HTML; the editor saves it as the draft */
  onApply: (html: string) => Promise<void> | void;
}

interface SectionDraft extends DictatedSection {
  include: boolean;
}

interface LineDraft extends EstimateLine {
  include: boolean;
}

/**
 * Where a generated cost table belongs. Matching on "estimat" alone is not
 * enough — "Estimated Length of Stay" sits above "Estimated Cost Breakup" in
 * the default template and would win. A heading only qualifies if it names
 * money, and headings about duration are excluded outright.
 */
const MONEY_SECTION = /(cost|charge|amount|expense|tariff|bill|fee|package|break-?up)/i;
const DURATION_SECTION = /(length|stay|duration|days)/i;

const findCostSection = (fields: DocumentField[]): DocumentField | undefined =>
  fields.find((f) => MONEY_SECTION.test(f.label) && !DURATION_SECTION.test(f.label));

const EXAMPLES: Record<string, string[]> = {
  estimate: [
    'typhoid fever, conservative management, 5 days',
    'severe dengue with thrombocytopenia, may need platelets, 4–5 days',
    'lap appendicectomy, day-2 discharge',
    'LSCS with 3 day stay, private room',
  ],
  default: [
    'admitted with fever and cough, treated with IV antibiotics, improved',
    'uncomplicated recovery, discharge on oral antibiotics, review after a week',
  ],
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * "Write with AI" — the typed counterpart to dictation. The clinician gives a
 * one-line brief and the whole document is drafted: prose for each of its own
 * headings, sections that don't apply flagged for removal, and — on an
 * estimate — a costed line list priced from this clinic's own rate card at the
 * admitted bed class. Every figure stays editable before it is written in.
 */
export default function DocumentAiCompose({
  docType, documentNumber, subject, contentHtml, onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [tariff, setTariff] = useState<TariffSnapshot | null>(null);
  const [result, setResult] = useState<AiComposeResult | null>(null);
  const [sections, setSections] = useState<SectionDraft[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [stayDays, setStayDays] = useState(1);
  const [dropIds, setDropIds] = useState<Set<string>>(new Set());

  const costed = isCostedDocType(docType);

  // Re-read only while the panel is open — the editor fires onChange per
  // keystroke and this parses the whole document.
  const fields: DocumentField[] = useMemo(
    () => (open ? documentVoiceService.extractDocumentFields(contentHtml, docType) : []),
    [open, contentHtml, docType]
  );

  // The rate card is fetched as soon as the panel opens so the header can show
  // what the estimate will be priced at before anything is generated. Refetched
  // when the quoted class changes — on a pre-admission estimate it is a picker.
  const rateKey = `${subject.tariff.bedTypeId ?? ''}|${subject.tariff.tariffPlanId ?? ''}`;
  useEffect(() => {
    if (!open || !costed) return;
    let alive = true;
    setTariff(null);
    documentAiService
      .buildTariffSnapshot(subject)
      .then((t) => { if (alive) setTariff(t); })
      .catch(() => { /* the compose call falls back to base prices */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, costed, rateKey]);

  const labelFor = (fieldId: string) =>
    fields.find((f) => f.id === fieldId)?.label ?? 'New section';

  const reset = () => {
    setResult(null);
    setSections([]);
    setLines([]);
    setDropIds(new Set());
  };

  const generate = async () => {
    if (instruction.trim().length < 3) {
      toast.error('Describe the case in a few words first');
      return;
    }
    setBusy(true);
    reset();
    try {
      const res = await documentAiService.compose({
        subject,
        docType,
        documentNumber,
        fields,
        instruction: instruction.trim(),
        tariff: costed ? tariff : null,
      });
      setResult(res);
      setSections(res.sections.map((s) => ({ ...s, include: true })));
      setLines((res.estimate?.lines ?? []).map((l) => ({ ...l, include: true })));
      setStayDays(res.estimate?.stayDays ?? 1);
      setDropIds(new Set(res.removeSections.map((r) => r.fieldId)));
      if (res.sections.length === 0 && !res.estimate) {
        toast('Nothing was drafted — try a more specific brief', { icon: '⚠️' });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateSection = (idx: number, patch: Partial<SectionDraft>) =>
    setSections((ss) => ss.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const updateLine = (idx: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const toggleDrop = (fieldId: string) =>
    setDropIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });

  const chosenLines = lines.filter((l) => l.include && l.unitRate > 0 && l.quantity > 0);
  const total = estimateTotal(chosenLines, stayDays);

  const apply = async () => {
    const chosenSections = sections.filter((s) => s.include && s.text.trim());
    const hasCost = costed && chosenLines.length > 0;
    if (chosenSections.length === 0 && !hasCost && dropIds.size === 0) {
      toast.error('Nothing selected to write into the document');
      return;
    }

    setApplying(true);
    try {
      const writes: DictatedSection[] = chosenSections.map(
        ({ fieldId, heading, text, mode }) => ({ fieldId, heading, text, mode })
      );

      if (hasCost) {
        const target = findCostSection(fields);
        writes.push({
          fieldId: target?.id ?? 'new',
          heading: target ? '' : 'Estimated Cost Breakup',
          // plain-text fallback; the HTML below is what actually lands
          text: `Estimated total ${rupees(total)} for ${stayDays} day(s)`,
          mode: 'replace',
          html: documentAiService.buildCostTableHtml(chosenLines, stayDays, {
            excluded: result?.estimate?.excluded,
          }),
        });
      }

      let html = contentHtml;
      const applied: string[] = [];

      // Write first, then delete. Section ids are slugged headings with a
      // dedupe counter, so deleting a heading can renumber a later duplicate —
      // doing it the other way round would aim a write at a shifted id.
      if (writes.length > 0) {
        const res = documentVoiceService.applyDictationToHtml(html, writes, docType);
        html = res.html;
        if (res.applied.length > 0) applied.push(res.applied.join(', '));
      }

      // A section that was written into must never then be deleted.
      const writtenIds = new Set(writes.map((w) => w.fieldId));
      const toDrop = [...dropIds].filter((id) => !writtenIds.has(id));
      if (toDrop.length > 0) {
        const res = documentVoiceService.removeSectionsFromHtml(html, toDrop, docType);
        html = res.html;
        if (res.removed.length > 0) applied.push(`removed ${res.removed.join(', ')}`);
      }

      await onApply(html);
      toast.success(`Draft updated — ${applied.join(' · ') || 'no change'}`, { duration: 5000 });
      reset();
      setInstruction('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-sm px-3 py-1.5 rounded-lg"
        title={
          costed
            ? "Type the case in one line — AI drafts the estimate and costs it from this clinic's rate card"
            : 'Type the case in one line — AI drafts this document from the chart'
        }
      >
        <Wand2 className="w-4 h-4" /> Write with AI
      </button>
    );
  }

  const examples = EXAMPLES[docType] ?? EXAMPLES.default;

  return (
    <div className="bg-white rounded-xl border border-amber-200 w-full overflow-hidden">
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-2.5 border-b border-amber-100 flex flex-wrap items-center gap-2">
        <Sparkles className="w-4 h-4 text-orange-600" />
        <span className="text-sm font-semibold text-slate-800">
          Write {docTypeLabel(docType).toLowerCase()} with AI
        </span>
        <span className="text-xs text-slate-500 hidden md:inline">
          {costed
            ? "describe the case — charges come from this clinic's own rate card"
            : 'describe the case in one line — every section stays editable'}
        </span>
        <button
          onClick={() => { setOpen(false); reset(); }}
          className="ml-auto p-1 rounded text-slate-400 hover:text-slate-700"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {costed && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              Bed class: <b>{tariff?.bedClass.name ?? subject.tariff.bedClassLabel}</b>
              {tariff?.bedClass.dailyRent
                ? ` · room rent ${rupees(tariff.bedClass.dailyRent)}/day`
                : ''}
            </span>
            {tariff?.payer && (
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                Tariff: <b>{tariff.payer}</b>
              </span>
            )}
            {tariff?.benchmark ? (
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Your average: <b>{rupees(tariff.benchmark.perDayTotal)}/day</b> over{' '}
                {tariff.benchmark.sampleAdmissions} past admissions
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                No billing history yet — ₹10,000–15,000/day assumed
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
              {tariff ? `${tariff.catalog.length} priced services` : 'loading rate card…'}
            </span>
          </div>
        )}

        <div className="space-y-2">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder={
              costed
                ? 'e.g. typhoid fever, conservative management, expected stay 5 days'
                : 'e.g. admitted with fever and cough, IV antibiotics 4 days, improved, for discharge'
            }
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={generate}
              disabled={busy || fields.length === 0}
              className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {busy ? 'Drafting…' : result ? 'Draft again' : 'Draft with AI'}
            </button>
            {fields.length === 0 && (
              <span className="text-xs text-amber-700">
                No headings found — add a section heading to the document first.
              </span>
            )}
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => setInstruction(ex)}
                className="text-xs px-2 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {result && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            {result.summary && (
              <p className="text-sm text-slate-600 flex items-start gap-1.5">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                {result.summary}
              </p>
            )}

            {/* ---------------- costing ---------------- */}
            {costed && lines.length > 0 && (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-2 border-b border-slate-200">
                  <IndianRupee className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-700">Cost breakup</span>
                  <label className="text-xs text-slate-500 flex items-center gap-1.5">
                    Stay
                    <input
                      type="number"
                      min={1}
                      value={stayDays}
                      onChange={(e) => setStayDays(Math.max(1, Number(e.target.value) || 1))}
                      className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-xs"
                    />
                    day(s)
                  </label>
                  <span className="ml-auto text-sm font-semibold text-slate-800">
                    {rupees(total)}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      ≈ {rupees(total / Math.max(1, stayDays))}/day
                    </span>
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="p-1.5 w-8"></th>
                        <th className="p-1.5 text-left">Head</th>
                        <th className="p-1.5 text-right">Rate ₹</th>
                        <th className="p-1.5 text-right">Qty</th>
                        <th className="p-1.5 text-center">Per day</th>
                        <th className="p-1.5 text-right">Amount</th>
                        <th className="p-1.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr
                          key={i}
                          className={`border-b border-slate-100 ${l.include ? '' : 'opacity-40'}`}
                        >
                          <td className="p-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={l.include}
                              onChange={() => updateLine(i, { include: !l.include })}
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              value={l.label}
                              onChange={(e) => updateLine(i, { label: e.target.value })}
                              className="w-full border border-transparent hover:border-slate-200 focus:border-slate-300 rounded px-1 py-0.5"
                            />
                            <span className="text-[11px] text-slate-400">
                              {l.category}
                              {l.serviceCode ? ` · ${l.serviceCode}` : ' · approx.'}
                              {l.note ? ` · ${l.note}` : ''}
                            </span>
                          </td>
                          <td className="p-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              value={l.unitRate}
                              onChange={(e) => updateLine(i, { unitRate: Number(e.target.value) || 0 })}
                              className="w-20 border border-slate-200 rounded px-1 py-0.5 text-right"
                            />
                          </td>
                          <td className="p-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={l.quantity}
                              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                              className="w-16 border border-slate-200 rounded px-1 py-0.5 text-right"
                            />
                          </td>
                          <td className="p-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={l.perDay}
                              onChange={() => updateLine(i, { perDay: !l.perDay })}
                            />
                          </td>
                          <td className="p-1.5 text-right font-medium text-slate-700">
                            {rupees(lineAmount(l, stayDays))}
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                              className="text-slate-300 hover:text-red-600"
                              title="Remove line"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-3 py-2 border-t border-slate-200 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        {
                          label: '', serviceCode: null, category: 'misc', unitRate: 0,
                          quantity: 1, perDay: false, note: '', estimated: true, include: true,
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add line
                  </button>
                  {(result.estimate?.excluded?.length ?? 0) > 0 && (
                    <span className="text-xs text-slate-500">
                      <b>Left out:</b> {result.estimate!.excluded.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- prose sections ---------------- */}
            {sections.map((s, i) => (
              <div
                key={i}
                className={`rounded-lg border p-2.5 text-sm ${
                  s.include ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200 opacity-70'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <input
                    type="checkbox"
                    checked={s.include}
                    onChange={() => updateSection(i, { include: !s.include })}
                  />
                  <select
                    value={s.fieldId}
                    onChange={(e) => updateSection(i, { fieldId: e.target.value })}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs max-w-64 bg-white"
                    title="Which section this goes into"
                  >
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                    <option value="new">+ New section{s.heading ? `: ${s.heading}` : ''}</option>
                  </select>
                  {s.fieldId === 'new' && (
                    <input
                      value={s.heading}
                      onChange={(e) => updateSection(i, { heading: e.target.value })}
                      placeholder="New section heading"
                      className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
                    />
                  )}
                  <div className="flex rounded-lg overflow-hidden border border-slate-300 text-xs">
                    {(['append', 'replace'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateSection(i, { mode })}
                        className={`px-2 py-1 ${
                          s.mode === mode ? 'bg-orange-600 text-white' : 'bg-white text-slate-600'
                        }`}
                        title={mode === 'append' ? 'Add below what is already there' : 'Replace this section'}
                      >
                        {mode === 'append' ? 'Add to' : 'Replace'}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-400 ml-auto">
                    → {s.fieldId === 'new' ? (s.heading || 'new section') : labelFor(s.fieldId)}
                  </span>
                </div>
                <textarea
                  value={s.text}
                  onChange={(e) => updateSection(i, { text: e.target.value })}
                  rows={Math.min(10, Math.max(2, s.text.split('\n').length))}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                />
              </div>
            ))}

            {/* ---------------- sections to drop ---------------- */}
            {result.removeSections.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm">
                <p className="font-semibold text-slate-700 mb-1.5">
                  Not applicable to this case — untick to keep
                </p>
                <div className="space-y-1">
                  {result.removeSections.map((r) => (
                    <label key={r.fieldId} className="flex items-start gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={dropIds.has(r.fieldId)}
                        onChange={() => toggleDrop(r.fieldId)}
                        className="mt-0.5"
                      />
                      <span>
                        <b>{labelFor(r.fieldId)}</b>
                        {r.reason ? ` — ${r.reason}` : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {result.estimate?.assumptions && (
              <p className="text-xs text-slate-500 border-l-2 border-slate-200 pl-2">
                <b>Assumptions:</b> {result.estimate.assumptions}
              </p>
            )}

            <p className="text-xs text-amber-700">
              AI draft — check every clinical statement and every figure before signing.
            </p>

            <button
              onClick={apply}
              disabled={applying}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {applying ? 'Writing into the draft…' : 'Insert & save draft'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
