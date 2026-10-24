import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { pharmacyImportService, openInvoiceFile } from '../../services/pharmacyImportService';
import { pharmacyService } from '../../services/pharmacyService';
import { mergeInvoicePages } from '../../utils/pharmacyImport';
import type { ImportDraft, InvoiceData } from '../../types/pharmacyImport';
import type { PharmacyInwardReceipt } from '../../types';
import InvoiceReviewModal from './InvoiceReviewModal';
import ManualInvoiceEntry from './ManualInvoiceEntry';

export default function PharmacyInvoiceImport() {
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [receipts, setReceipts] = useState<PharmacyInwardReceipt[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const current = useRef<ImportDraft | null>(null);
  const [mode, setMode] = useState('new');
  const [receiptId, setReceiptId] = useState('');
  const [billSearch, setBillSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  const [manual, setManual] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const cancelled = useRef(false);
  const setCurrent = (next: ImportDraft | null) => { current.current = next; setDraft(next); };
  const load = async () => {
    try { const [ds, rs] = await Promise.all([pharmacyImportService.list(), pharmacyService.getInwardReceipts()]); setDrafts(ds); setReceipts(rs); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); return () => { cancelled.current = true; }; }, []);
  const persist = async (payload: ImportDraft['payload']) => {
    if (!current.current) throw new Error('No active draft');
    const saved = await pharmacyImportService.save(current.current, payload);
    setCurrent(saved); return saved;
  };
  const start = async () => {
    if (mode === 'existing' && !receiptId) { setError('Select the existing supplier bill.'); return; }
    setBusy(true); setError('');
    try { setCurrent(await pharmacyImportService.create(mode === 'existing' ? receiptId : null)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const processFiles = async () => {
    if (!current.current || files.length === 0) return;
    setBusy(true); setError(''); cancelled.current = false;
    try {
      // Register every selected part first, so pausing cannot make an unstarted
      // second file disappear from the completeness check. Release each PDF.
      for (const file of files) {
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: use PDF, JPG, PNG or WebP.`);
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: maximum file size is 50 MB.`);
        setProgress(`Reading pages in ${file.name}`);
        const source = await openInvoiceFile(file);
        try {
          const pages = [...current.current!.payload.pages];
          for (let page = 1; page <= source.count; page++) {
            const key = `${source.hash}:${page}`;
            if (!pages.some(p => p.key === key)) pages.push({ key, fileHash: source.hash, fileName: file.name, page, status: 'pending' });
          }
          await persist({ ...current.current!.payload, pages });
        } finally { await source.close(); }
      }
      for (const file of files) {
        if (cancelled.current) break;
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: use PDF, JPG, PNG or WebP.`);
        if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name}: maximum file size is 50 MB.`);
        const source = await openInvoiceFile(file);
        try {
          let pages = [...current.current!.payload.pages];
          for (let page = 1; page <= source.count; page++) {
            if (cancelled.current) break;
            const key = `${source.hash}:${page}`;
            if (current.current!.payload.pages.find(p => p.key === key)?.status === 'complete') continue;
            setProgress(`${file.name}: page ${page}/${source.count}`);
            let result: Awaited<ReturnType<typeof pharmacyImportService.extract>> | undefined;
            let pageError = '';
            try {
              const image = await source.render(page);
              // One retry, isolated to this page; successful pages are never re-extracted.
              for (let attempt = 0; attempt < 2; attempt++) {
                try { result = await pharmacyImportService.extract(image, file.name, 'auto', 'fast', attempt > 0); break; }
                catch (e) {
                  pageError = e instanceof Error ? e.message : String(e);
                  if (attempt === 0 && !cancelled.current) await new Promise(resolve => setTimeout(resolve, 1200));
                  else break;
                }
              }
            } catch (e) { pageError = e instanceof Error ? e.message : String(e); }
            pages = current.current!.payload.pages.map(p => p.key === key ? { ...p, status: result ? 'complete' as const : 'failed' as const, data: result?.extractedData, model: result?.model, error: result ? undefined : pageError } : p);
            // Persist after every page. Keep reviewed edits when later parts are added.
            const old = current.current!.payload;
            const merged = mergeInvoicePages(pages);
            const savedReview = old.review ? {
              ...old.review,
              invoiceInfo: {
                ...old.review.invoiceInfo,
                invoiceNumber: old.review.invoiceInfo.invoiceNumber || merged.invoiceInfo.invoiceNumber || '',
                invoiceDate: old.review.invoiceInfo.invoiceDate || merged.invoiceInfo.invoiceDate || '',
                totalAmount: merged.invoiceInfo.totalAmount ?? old.review.invoiceInfo.totalAmount,
                extractedTaxable: merged.invoiceInfo.taxableAmount ?? old.review.invoiceInfo.extractedTaxable,
                extractedTax: [merged.invoiceInfo.cgstAmount, merged.invoiceInfo.sgstAmount, merged.invoiceInfo.igstAmount].some(v => v != null)
                  ? (merged.invoiceInfo.cgstAmount || 0) + (merged.invoiceInfo.sgstAmount || 0) + (merged.invoiceInfo.igstAmount || 0) : old.review.invoiceInfo.extractedTax,
                roundOff: merged.invoiceInfo.roundOff ?? old.review.invoiceInfo.roundOff,
              },
              medicineItems: [...old.review.medicineItems, ...merged.medicines.filter(m => !old.pages.some(p => p.status === 'complete' && m.sourceKey?.startsWith(`${p.key}:`))).map(m => ({ ...m }))],
            } : undefined;
            await persist({ pages, data: merged, review: savedReview });
          }
        } finally { await source.close(); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setProgress(''); }
  };
  const saveManual = async (data: InvoiceData) => {
    try { await persist({ ...current.current!.payload, data }); setManual(false); setReview(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const selectedReceipt = receipts.find(r => r.id === draft?.target_receipt_id);
  const pages = draft?.payload.pages || [];
  const incomplete = pages.some(p => p.status !== 'complete');
  const inputClass = 'border rounded-lg px-3 py-2 bg-white';
  return <div className="max-w-5xl mx-auto space-y-5">
    <h2 className="text-2xl font-bold">Supplier invoice upload</h2>
    <p className="text-gray-600">Upload all pages together, or add Part 2 to the same bill. Drafts do not change stock.</p>
    {error && <div role="alert" className="p-3 bg-red-50 text-red-800 rounded">{error}</div>}
    {!draft ? <>
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <select aria-label="Bill upload mode" className={inputClass} value={mode} onChange={e => setMode(e.target.value)}><option value="new">New bill</option><option value="existing">Continue existing bill / add missing items</option></select>
        {mode === 'existing' && <div className="space-y-2">
          <input aria-label="Search bills" className={inputClass} placeholder="Search supplier or bill number" value={billSearch} onChange={e => setBillSearch(e.target.value)} />
          <select aria-label="Existing bill" className={`${inputClass} w-full`} value={receiptId} onChange={e => setReceiptId(e.target.value)}>
            <option value="">Choose supplier bill</option>
            {receipts.filter(r => `${r.supplier?.name} ${r.invoiceNumber}`.toLowerCase().includes(billSearch.toLowerCase())).map(r => <option key={r.id} value={r.id}>{r.supplier?.name} — {r.invoiceNumber} — {(r.supplierInvoiceDate || r.receiptDate).toLocaleDateString()} — ₹{r.totalAmount}</option>)}
          </select>
        </div>}
        <button disabled={busy} onClick={start} className="bg-blue-600 text-white rounded-lg px-4 py-2">Start upload</button>
      </div>
      <div className="space-y-2"><h3 className="font-semibold">Saved drafts</h3>{drafts.length === 0 && <p className="text-gray-500">No unfinished bills.</p>}
        {drafts.map(d => <button key={d.id} className="block w-full text-left border rounded-lg p-3 bg-white" onClick={() => { setCurrent(d); setFiles([]); setError(''); }}>
          {String(d.payload.review?.invoiceInfo.invoiceNumber || d.payload.data?.invoiceInfo.invoiceNumber || 'Unnumbered bill')} · {d.payload.pages.length} pages · {d.payload.data?.medicines.length || 0} items · {new Date(d.updated_at).toLocaleString()}
        </button>)}
      </div>
    </> : <>
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div className="flex justify-between gap-3"><strong>{selectedReceipt ? `Adding to ${selectedReceipt.supplier?.name} / ${selectedReceipt.invoiceNumber}` : 'New bill draft'}</strong>
          <button disabled={busy} onClick={() => { setCurrent(null); setFiles([]); void load(); }} className="text-blue-600">Back to drafts</button></div>
        <label className="block border-2 border-dashed rounded-lg p-5"><Upload className="inline mr-2" /> PDF or photos — select multiple parts (up to 50 MB each)
          <input aria-label="Invoice files" disabled={busy} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="block mt-3" onChange={e => setFiles(Array.from(e.target.files || []))} />
        </label>
        <p className="text-sm text-gray-500">To resume failed pages after reopening, select the same file. Completed pages are retained.</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || !files.length} onClick={processFiles} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">Process files / retry unfinished pages</button>
          {busy && <button className={inputClass} onClick={() => { cancelled.current = true; }}>Pause after current page</button>}
          <button disabled={busy || !draft.payload.data} className={inputClass} onClick={() => setReview(true)}>Review {draft.payload.data?.medicines.length || 0} items</button>
          {!pages.length && !draft.payload.data && <button disabled={busy} className={inputClass} onClick={() => setManual(true)}>Manual entry</button>}
        </div>
        {busy && <p role="status" className="flex gap-2 items-center"><Loader2 className="animate-spin" />{progress || 'Saving draft…'}</p>}
        <p>{pages.filter(p => p.status === 'complete').length}/{pages.length} pages processed · {draft.payload.data?.medicines.length || 0} items found</p>
        {incomplete && <p className="text-amber-700">Unfinished pages must be processed before stock can be posted.</p>}
        <ul className="max-h-64 overflow-auto text-sm space-y-2">{pages.map(p => <li key={p.key}>{p.fileName} · page {p.page}: {p.status}{p.data ? ` · ${p.data.medicines.length} rows` : ''}{p.error && <span className="text-red-700"> — {p.error}</span>}</li>)}</ul>
      </div>
      {manual && <ManualInvoiceEntry onComplete={saveManual} onBack={() => setManual(false)} />}
      {review && draft.payload.data && <InvoiceReviewModal
        extractedData={draft.payload.data} rawText="" fileName={pages.map(p => p.fileName).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'Manual entry'}
        importDraft={draft} existingReceipt={selectedReceipt} incomplete={incomplete}
        onSaveDraft={async snapshot => persist({ ...current.current!.payload, review: snapshot })}
        onComplete={() => { setReview(false); setCurrent(null); setFiles([]); void load(); }} onClose={() => setReview(false)} />}
    </>}
  </div>;
}
