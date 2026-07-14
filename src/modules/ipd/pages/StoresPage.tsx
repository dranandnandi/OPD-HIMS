import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Warehouse, ArrowRight, Syringe, Upload, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { storeService, Store, StoreStockRow, StoreTransfer } from '../services/storeService';
import { medicationService, MedicineOption } from '../services/medicationService';
import { admissionService } from '../services/admissionService';
import type { Admission } from '../types/ipd';

export default function StoresPage() {
  const { clinicId, profile } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [selected, setSelected] = useState<Store | null>(null);
  const [stock, setStock] = useState<StoreStockRow[]>([]);
  const [transfers, setTransfers] = useState<StoreTransfer[]>([]);
  // create store
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);

  // Auto-suggest store code from the name ("Dialysis Ward Store" → DWS,
  // "IP Pharmacy" → IPP), sequential suffix on conflict. Editable.
  const suggestStoreCode = (n: string) => {
    const words = n.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    let base =
      words.length === 1
        ? words[0].slice(0, 4)
        : words.map((w) => w[0]).join('').slice(0, 5);
    base = base.replace(/[^A-Z0-9]/g, '') || 'STR';
    let candidate = base;
    let i = 2;
    while (stores.some((s) => s.code.toUpperCase() === candidate)) {
      candidate = `${base}${i}`;
      i += 1;
    }
    return candidate;
  };

  const handleNameChange = (v: string) => {
    setName(v);
    if (!codeTouched) setCode(suggestStoreCode(v));
  };

  const reload = useCallback(() => {
    if (!clinicId) return;
    storeService.listStores(clinicId).then(setStores).catch((e) => toast.error(e.message));
    storeService.listTransfers(clinicId).then(setTransfers).catch(() => setTransfers([]));
  }, [clinicId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!selected) { setStock([]); return; }
    storeService.listStock(selected.id).then(setStock).catch((e) => toast.error(e.message));
  }, [selected]);

  const refreshStock = () => {
    if (selected) storeService.listStock(selected.id).then(setStock).catch(() => undefined);
    reload();
  };

  const createStore = async () => {
    if (!clinicId || !name.trim() || !code.trim()) return;
    try {
      await storeService.createStore({ clinicId, code, name });
      toast.success('Store created');
      setName(''); setCode(''); setCodeTouched(false);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-800 mb-1">Stores</h1>
      <p className="text-xs text-slate-400 mb-4">
        Main Pharmacy = the shared OPD stock pool. Sub-stores (IP Pharmacy, Dialysis, OT…)
        receive stock via transfer and consume it to wards/patients.
      </p>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* store list + create */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-700 mb-2">Sub-stores</h2>
          <div className="flex gap-1.5 mb-3">
            <input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Name (Dialysis Store)"
              className="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
            <input value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }}
              placeholder="CODE"
              title="Auto-suggested from name — editable"
              className={`w-20 border rounded-lg px-2 py-1.5 text-sm font-mono ${codeTouched ? 'border-slate-300' : 'border-emerald-300 bg-emerald-50/40'}`} />
            <button onClick={createStore} className="bg-blue-600 text-white rounded-lg px-2.5">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {stores.map((s) => (
              <li key={s.id}
                onClick={() => setSelected(s)}
                className={`py-2 px-2 flex items-center gap-2 cursor-pointer rounded ${
                  selected?.id === s.id ? 'bg-navy-50 text-navy-800 font-medium' : 'hover:bg-slate-50'
                }`}>
                <Warehouse className="w-4 h-4 text-navy-600" />
                {s.name} <span className="text-xs text-slate-400">({s.code})</span>
              </li>
            ))}
            {stores.length === 0 && (
              <li className="py-4 text-center text-slate-400">No sub-stores yet — create one</li>
            )}
          </ul>
        </div>

        {/* selected store: stock + actions */}
        <div className="lg:col-span-2 space-y-4">
          {selected ? (
            <>
              <TransferCard clinicId={clinicId!} stores={stores} defaultTo={selected} userId={profile?.id} onDone={refreshStock} />
              <UploadCard clinicId={clinicId!} store={selected} userId={profile?.id} onDone={refreshStock} />
              <ConsumeCard clinicId={clinicId!} store={selected} stock={stock} userId={profile?.id} onDone={refreshStock} />
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="text-sm font-medium text-slate-700 mb-2">{selected.name} — stock</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1.5">Medicine</th><th className="text-right">Qty here</th>
                      <th className="text-right">Main pool</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="py-1.5">{r.medicine?.name} {r.medicine?.strength ?? ''}</td>
                        <td className="text-right font-medium">{r.quantity}</td>
                        <td className="text-right text-slate-400">{r.medicine?.current_stock ?? '—'}</td>
                      </tr>
                    ))}
                    {stock.length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-center text-slate-400">Empty — transfer stock in from Main Pharmacy</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
              Select a store to see stock, transfer in, and consume to patients.
            </div>
          )}

          {/* recent transfers */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-medium text-slate-700 mb-2">Recent transfers</h2>
            <ul className="text-xs text-slate-500 space-y-1">
              {transfers.slice(0, 10).map((t) => (
                <li key={t.id}>
                  {t.quantity} × {t.medicine?.name} — {t.from_store?.name ?? 'Main Pharmacy'} → {t.to_store?.name ?? 'Main Pharmacy'}
                </li>
              ))}
              {transfers.length === 0 && <li className="text-slate-400">None yet</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MedicinePicker({
  clinicId, value, onPick, placeholder,
}: {
  clinicId: string; value: MedicineOption | null;
  onPick: (m: MedicineOption | null) => void; placeholder: string;
}) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<MedicineOption[]>([]);

  useEffect(() => {
    const h = setTimeout(() => {
      if (value || search.trim().length < 2) { setOptions([]); return; }
      medicationService.searchMedicines(clinicId, search).then(setOptions).catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(h);
  }, [clinicId, search, value]);

  return (
    <div className="relative flex-1 min-w-44">
      <input
        value={value ? `${value.name} ${value.strength ?? ''}` : search}
        onChange={(e) => { setSearch(e.target.value); onPick(null); }}
        placeholder={placeholder}
        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
      />
      {options.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow max-h-44 overflow-auto">
          {options.map((m) => (
            <li key={m.id} onClick={() => { onPick(m); setOptions([]); }}
              className="px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer flex justify-between">
              <span>{m.name} {m.strength ?? ''}</span>
              <span className="text-xs text-slate-400">main: {m.current_stock}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TransferCard({
  clinicId, stores, defaultTo, userId, onDone,
}: {
  clinicId: string; stores: Store[]; defaultTo: Store; userId?: string; onDone: () => void;
}) {
  const [fromId, setFromId] = useState('MAIN');
  const [toId, setToId] = useState(defaultTo.id);
  const [med, setMed] = useState<MedicineOption | null>(null);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => setToId(defaultTo.id), [defaultTo.id]);

  // available quantity in the SOURCE for the picked medicine
  useEffect(() => {
    if (!med) { setAvailable(null); return; }
    if (fromId === 'MAIN') {
      setAvailable(med.current_stock);
      return;
    }
    storeService
      .listStock(fromId)
      .then((rows) => setAvailable(rows.find((r) => r.medicine_id === med.id)?.quantity ?? 0))
      .catch(() => setAvailable(null));
  }, [med, fromId]);

  const transfer = async () => {
    if (!med || !qty || Number(qty) <= 0) { toast.error('Pick medicine and quantity'); return; }
    if (fromId !== 'MAIN' && fromId === toId) { toast.error('Source and destination are the same'); return; }
    if (available !== null && Number(qty) > available) {
      toast.error(`Only ${available} available in source`);
      return;
    }
    setBusy(true);
    try {
      if (fromId === 'MAIN') {
        await storeService.transferFromMain({
          clinicId, storeId: toId, medicineId: med.id, quantity: Number(qty), userId,
        });
      } else {
        await storeService.transferBetweenStores({
          clinicId, fromStoreId: fromId, toStoreId: toId, medicineId: med.id, quantity: Number(qty), userId,
        });
      }
      toast.success('Stock transferred');
      setMed(null); setQty('');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
        <ArrowRight className="w-4 h-4 text-navy-600" /> Transfer stock
      </h2>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={fromId} onChange={(e) => setFromId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="MAIN">Main Pharmacy</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-slate-400">→</span>
        <select value={toId} onChange={(e) => setToId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <MedicinePicker clinicId={clinicId} value={med} onPick={setMed} placeholder="Medicine…" />
        {med && available !== null && (
          <span className={`text-xs font-medium ${available > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {available > 0 ? `${available} available in source` : 'source empty — to purchase'}
          </span>
        )}
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty"
          max={available ?? undefined}
          className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={transfer} disabled={busy || (available !== null && available <= 0)}
          className="bg-navy-700 hover:bg-navy-800 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-1.5">
          {busy ? 'Moving…' : 'Transfer'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice / Excel upload → parsed rows → match against medicine master →
// receive into the selected store. Reuses the OPD app's AI parse functions
// (parse-pharmacy-invoice for images, parse-pharmacy-pdf for PDFs).
// ---------------------------------------------------------------------------

interface ParsedRow {
  name: string;
  strength?: string;
  quantity: number;
  matchedId: string | null;
  matchedName: string | null;
  create: boolean;
}

function UploadCard({
  clinicId, store, userId, onDone,
}: {
  clinicId: string; store: Store; userId?: string; onDone: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('');

  const matchRows = async (
    raw: Array<{ name: string; strength?: string; quantity: number }>
  ): Promise<ParsedRow[]> => {
    const out: ParsedRow[] = [];
    for (const r of raw) {
      if (!r.name || !r.quantity || r.quantity <= 0) continue;
      const match = await storeService.findMedicineByName(clinicId, r.name);
      out.push({
        name: r.name,
        strength: r.strength,
        quantity: Math.round(r.quantity),
        matchedId: match?.id ?? null,
        matchedName: match?.name ?? null,
        create: !match, // unmatched default to "create new medicine"
      });
    }
    return out;
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setRows([]);
    setSourceLabel(file.name);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

      if (['xlsx', 'xls', 'csv'].includes(ext)) {
        // client-side Excel/CSV parse with header heuristics
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        if (json.length === 0) throw new Error('Sheet is empty');
        const keys = Object.keys(json[0]);
        const nameKey = keys.find((k) => /name|item|medicine|drug|product|description/i.test(k)) ?? keys[0];
        const qtyKey = keys.find((k) => /qty|quantity|units|stock|count/i.test(k));
        if (!qtyKey) throw new Error('No quantity column found (expected a header like Qty/Quantity)');
        const raw = json.map((r) => ({
          name: String(r[nameKey] ?? '').trim(),
          quantity: Number(r[qtyKey]) || 0,
        }));
        setRows(await matchRows(raw));
      } else {
        // AI parse via the OPD app's deployed functions
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const isPdf = ext === 'pdf' || file.type === 'application/pdf';
        const { data, error } = await supabase.functions.invoke(
          isPdf ? 'parse-pharmacy-pdf' : 'parse-pharmacy-invoice',
          {
            body: isPdf
              ? { pdfBase64: base64, fileName: file.name }
              : { imageBase64: base64, fileName: file.name, mimeType: file.type },
          }
        );
        if (error) throw new Error(error.message ?? 'Parse failed');
        if (data?.error) throw new Error(data.error);

        const meds = (data?.medicines ?? data?.data?.medicines ?? []) as Array<{
          medicineName: string; quantity: number; strength?: string | null;
        }>;
        if (meds.length === 0) throw new Error('No medicines recognized in the document');
        setRows(await matchRows(meds.map((m) => ({
          name: m.medicineName,
          strength: m.strength ?? undefined,
          quantity: Number(m.quantity) || 0,
        }))));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const receive = async () => {
    setReceiving(true);
    try {
      const resolved: Array<{ medicineId: string; quantity: number }> = [];
      let created = 0;
      for (const r of rows) {
        if (r.quantity <= 0) continue;
        let id = r.matchedId;
        if (!id && r.create) {
          id = await storeService.createMedicine(clinicId, r.name, r.strength);
          created++;
        }
        if (id) resolved.push({ medicineId: id, quantity: r.quantity });
      }
      if (resolved.length === 0) throw new Error('Nothing to receive');
      await storeService.receiveIntoStore({
        clinicId,
        storeId: store.id,
        rows: resolved,
        remarks: `Upload: ${sourceLabel}`,
        userId,
      });
      toast.success(
        `Received ${resolved.length} item(s) into ${store.name}` +
        (created ? ` — ${created} new medicine(s) created (set selling prices in OPD pharmacy)` : '')
      );
      setRows([]);
      setSourceLabel('');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReceiving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
        <Upload className="w-4 h-4 text-navy-600" /> Receive into {store.name} — invoice / Excel upload
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer text-sm border border-dashed border-slate-300 rounded-lg px-4 py-2 text-slate-600 hover:bg-slate-50">
          {parsing ? 'Parsing…' : 'Choose file (image / PDF / Excel / CSV)'}
          <input
            type="file"
            accept="image/*,.pdf,.xlsx,.xls,.csv"
            className="hidden"
            disabled={parsing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-xs text-slate-400">
          Images/PDFs are read by AI (supplier invoice); Excel needs name + quantity columns.
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5">Parsed item</th>
                <th>Match</th>
                <th className="text-right w-24">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5">{r.name} {r.strength ?? ''}</td>
                  <td>
                    {r.matchedId ? (
                      <span className="text-emerald-700 text-xs">✓ {r.matchedName}</span>
                    ) : (
                      <label className="text-xs text-amber-700 flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={r.create}
                          onChange={(e) =>
                            setRows(rows.map((x, j) => (j === i ? { ...x, create: e.target.checked } : x)))
                          }
                        />
                        not found — create new
                      </label>
                    )}
                  </td>
                  <td className="text-right">
                    <input
                      type="number"
                      value={r.quantity}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x)))
                      }
                      className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-sm text-right"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={receive}
            disabled={receiving}
            className="mt-2 flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-1.5"
          >
            <Check className="w-4 h-4" />
            {receiving ? 'Receiving…' : `Receive ${rows.filter((r) => r.matchedId || r.create).length} item(s)`}
          </button>
        </div>
      )}
    </div>
  );
}

function ConsumeCard({
  clinicId, store, stock, userId, onDone,
}: {
  clinicId: string; store: Store; stock: StoreStockRow[]; userId?: string; onDone: () => void;
}) {
  const [medicineId, setMedicineId] = useState('');
  const [qty, setQty] = useState('');
  const [admissionId, setAdmissionId] = useState('');
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    admissionService.listActive(clinicId).then(setAdmissions).catch(() => setAdmissions([]));
  }, [clinicId]);

  const consume = async () => {
    const row = stock.find((r) => r.medicine_id === medicineId);
    if (!row || !qty || Number(qty) <= 0) { toast.error('Pick a stocked medicine and quantity'); return; }
    setBusy(true);
    try {
      await storeService.consume({
        clinicId,
        storeId: store.id,
        medicineId,
        medicineName: `${row.medicine?.name ?? 'Medicine'} ${row.medicine?.strength ?? ''}`.trim(),
        quantity: Number(qty),
        admissionId: admissionId || undefined,
        userId,
      });
      toast.success(admissionId ? 'Consumed & charged to patient' : 'Consumed (ward use)');
      setMedicineId(''); setQty(''); setAdmissionId('');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
        <Syringe className="w-4 h-4 text-navy-600" /> Consume from {store.name}
      </h2>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-44">
          <option value="">Medicine (from this store)…</option>
          {stock.map((r) => (
            <option key={r.medicine_id} value={r.medicine_id}>
              {r.medicine?.name} {r.medicine?.strength ?? ''} — {r.quantity} in stock
            </option>
          ))}
        </select>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty"
          className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-44">
          <option value="">Ward general use (no patient charge)</option>
          {admissions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.patient?.name} — {a.admission_number}
            </option>
          ))}
        </select>
        <button onClick={consume} disabled={busy}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-1.5">
          {busy ? 'Saving…' : 'Consume'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        With a patient selected: deducts this store, records the dispense, and posts the charge
        at the clinic selling price — package inclusion/exclusion rules apply automatically.
      </p>
    </div>
  );
}
