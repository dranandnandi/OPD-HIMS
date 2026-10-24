import React, { useState, useRef } from 'react';
import { X, Camera, Upload, CheckCircle, AlertTriangle, MapPin, Plus, Loader2 } from 'lucide-react';
import { MedicineWithPrice } from '../../types';
import { packSpec, stockBreakdown } from '../../utils/packUnits';
import { supabase } from '../../lib/supabase';
import { supabaseUrl } from '../../lib/supabaseClient';
import { masterDataService } from '../../services/masterDataService';

export interface IdentifiedMedicine {
  brandName: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  manufacturer: string | null;
  packSize: string | null;
  mrp: number | null;
  batchNumber: string | null;
  expiryDate: string | null;
  barcode: string | null;
  scheduleH: boolean | null;
  confidence: number;
  notes: string | null;
}

interface MedicineIdentifyModalProps {
  medicines: MedicineWithPrice[];
  /** The pharmacist picked a medicine (exact match or a substitute). */
  onPick: (medicine: MedicineWithPrice, identified: IdentifiedMedicine) => void;
  /** When set, an unknown medicine can be created in the master from the photo. */
  allowCreate?: boolean;
  onCreated?: (medicine: MedicineWithPrice, identified: IdentifiedMedicine) => void;
  onClose: () => void;
}

const norm = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (s?: string | null) => (s || '').replace(/\D/g, '');

/** Molecule tokens: "amoxicillin + clavulanic acid" -> ["amoxicillin", "clavulanic acid"] */
const molecules = (generic?: string | null): string[] =>
  norm(generic).split('+').map(x => x.trim()).filter(x => x.length > 2);

const sameMolecule = (a?: string | null, b?: string | null): boolean => {
  const ma = molecules(a);
  const mb = molecules(b);
  if (ma.length === 0 || mb.length === 0) return false;
  // every molecule in the photo appears in the candidate's generic name
  return ma.every(x => mb.some(y => y.includes(x) || x.includes(y)));
};

const sameStrength = (a?: string | null, b?: string | null): boolean => {
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return true; // unknown strength: don't exclude
  return da === db;
};

/** Shrink to keep the upload small; phone photos are 3-5 MB otherwise. */
async function fileToDataUrl(file: File, maxEdge = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Photo -> AI reads the pack -> match against the clinic master -> show
 * whether it is in stock and which same-molecule alternatives are.
 */
const MedicineIdentifyModal: React.FC<MedicineIdentifyModalProps> = ({ medicines, onPick, allowCreate, onCreated, onClose }) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identified, setIdentified] = useState<IdentifiedMedicine | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      setBusy(true);
      setError(null);
      setIdentified(null);
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);

      if (!supabase) throw new Error('Supabase client not initialized');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${supabaseUrl}/functions/v1/identify-medicine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ imageBase64: dataUrl })
      });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.details || body.error || 'Identification failed');
      setIdentified(body.medicine as IdentifiedMedicine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not identify the medicine');
    } finally {
      setBusy(false);
    }
  };

  // ---- matching against the clinic master ----
  const exact: MedicineWithPrice[] = identified ? medicines.filter(m => {
    if (identified.barcode && m.barcode && digits(m.barcode) === identified.barcode) return true;
    const brand = norm(identified.brandName);
    if (!brand) return false;
    const names = [m.name, m.brandName].map(norm).filter(Boolean);
    return names.some(n => n === brand || n.startsWith(brand) || brand.startsWith(n)) && sameStrength(identified.strength, m.strength);
  }) : [];

  const substitutes: MedicineWithPrice[] = identified ? medicines
    .filter(m => !exact.some(e => e.id === m.id))
    .filter(m => sameMolecule(identified.genericName, m.genericName || m.name) && sameStrength(identified.strength, m.strength))
    .sort((a, b) => b.currentStock - a.currentStock) : [];

  const inStock = (m: MedicineWithPrice) => m.currentStock > 0;

  const handleCreate = async () => {
    if (!identified) return;
    try {
      setCreating(true);
      const created = await masterDataService.addMedicine({
        name: identified.brandName || identified.genericName || 'New medicine',
        genericName: identified.genericName || undefined,
        brandName: identified.brandName || undefined,
        category: 'other',
        dosageForm: identified.dosageForm || 'other',
        strength: identified.strength || undefined,
        manufacturer: identified.manufacturer || undefined,
        description: `Created from pack photo${identified.packSize ? ` (${identified.packSize})` : ''}`,
        sideEffects: [],
        contraindications: [],
        currentStock: 0,
        reorderLevel: 10,
        barcode: identified.barcode || undefined,
        hsnCode: '3004',
        gstRate: 12,
        isActive: true
      } as any);
      const withPrice: MedicineWithPrice = { ...created, sellingPrice: identified.mrp || undefined };
      onCreated?.(withPrice, identified);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create medicine');
    } finally {
      setCreating(false);
    }
  };

  const Row: React.FC<{ m: MedicineWithPrice; tone: 'green' | 'blue' }> = ({ m, tone }) => (
    <button
      onClick={() => onPick(m, identified!)}
      disabled={!inStock(m)}
      className={`w-full text-left p-3 rounded-lg border flex items-center justify-between gap-3 ${
        inStock(m) ? (tone === 'green' ? 'border-green-300 bg-green-50 hover:bg-green-100' : 'border-blue-200 bg-white hover:bg-blue-50') : 'border-gray-200 bg-gray-50 opacity-70 cursor-not-allowed'
      }`}
    >
      <div>
        <div className="font-medium text-gray-800">{m.name}{m.strength ? ` ${m.strength}` : ''}</div>
        <div className="text-xs text-gray-600 flex flex-wrap gap-x-3">
          {m.genericName && <span>{m.genericName}</span>}
          {m.manufacturer && <span>{m.manufacturer}</span>}
          {m.sellingPrice ? <span>MRP ₹{m.sellingPrice}</span> : null}
          {m.rackLocation && <span className="inline-flex items-center gap-1 text-indigo-700"><MapPin className="w-3 h-3" />{m.rackLocation}</span>}
        </div>
      </div>
      <div className={`text-sm font-semibold whitespace-nowrap ${inStock(m) ? 'text-green-700' : 'text-red-600'}`}>
        {inStock(m) ? `${stockBreakdown(m.currentStock, packSpec(m))} in stock` : 'Out of stock'}
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            <div>
              <h2 className="text-lg font-bold">Identify medicine by photo</h2>
              <p className="text-xs text-gray-500">Reads the pack, finds it in your stock, suggests same-molecule alternatives</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => cameraRef.current?.click()} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Camera className="w-5 h-5" /> Take photo
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <Upload className="w-5 h-5" /> Upload image
            </button>
          </div>

          {preview && (
            <div className="flex gap-4 items-start">
              <img src={preview} alt="pack" className="w-28 h-28 object-cover rounded-lg border" />
              <div className="flex-1 text-sm">
                {busy && <div className="flex items-center gap-2 text-gray-600"><Loader2 className="w-4 h-4 animate-spin" /> Reading the pack…</div>}
                {error && <div className="text-red-700 flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5" />{error}</div>}
                {identified && (
                  <div className="space-y-1">
                    <div className="text-lg font-semibold text-gray-800">{identified.brandName || identified.genericName || 'Unreadable'}</div>
                    <div className="text-gray-700">
                      {identified.genericName && <span className="font-medium">{identified.genericName}</span>}
                      {identified.strength && <span> · {identified.strength}</span>}
                      {identified.dosageForm && <span className="capitalize"> · {identified.dosageForm}</span>}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                      {identified.manufacturer && <span>{identified.manufacturer}</span>}
                      {identified.packSize && <span>{identified.packSize}</span>}
                      {identified.mrp != null && <span>MRP ₹{identified.mrp}</span>}
                      {identified.batchNumber && <span>Batch {identified.batchNumber}</span>}
                      {identified.expiryDate && <span>Exp {identified.expiryDate}</span>}
                      {identified.barcode && <span className="font-mono">{identified.barcode}</span>}
                      {identified.scheduleH && <span className="text-red-600 font-medium">Schedule H</span>}
                    </div>
                    <div className="text-xs text-gray-400">Confidence {(identified.confidence * 100).toFixed(0)}%{identified.notes ? ` · ${identified.notes}` : ''}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {identified && !busy && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" /> This medicine in your stock
                </h3>
                {exact.length === 0 ? (
                  <div className="p-3 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600 flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="flex-1">Not in your medicine master{identified.brandName ? ` as "${identified.brandName}"` : ''}.</span>
                    {allowCreate && (
                      <button onClick={handleCreate} disabled={creating}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
                        <Plus className="w-4 h-4" /> {creating ? 'Creating…' : 'Create in master'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">{exact.map(m => <Row key={m.id} m={m} tone="green" />)}</div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  Same molecule, other brands{identified.genericName ? ` (${identified.genericName}${identified.strength ? ` ${identified.strength}` : ''})` : ''}
                </h3>
                {substitutes.length === 0 ? (
                  <p className="text-sm text-gray-500">No alternative with the same composition in stock.</p>
                ) : (
                  <div className="space-y-2">{substitutes.map(m => <Row key={m.id} m={m} tone="blue" />)}</div>
                )}
                <p className="text-xs text-gray-400 mt-2">Substitution matches on generic name and strength in your master. Confirm with the prescriber where the prescription says "no substitution".</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MedicineIdentifyModal;
