import { useEffect, useState } from 'react';
import { pharmacyService } from '../../services/pharmacyService';
import type { ControlledSaleRecord } from '../../types';
import { downloadCsv, toCsv } from '../../utils/gst';
import { useAuth } from '../Auth/useAuth';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export default function ControlledSalesRegister({ revision = 0 }: { revision?: number }) {
  const { user } = useAuth();
  const [from, setFrom] = useState(() => `${today().slice(0,7)}-01`), [to, setTo] = useState(today);
  const [kind, setKind] = useState('h1'), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ rows: ControlledSaleRecord[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true), [exporting, setExporting] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData({ rows: [], total: 0 });
    if (!from || !to || from > to) { setError('Choose a valid date range.'); setLoading(false); return; }
    pharmacyService.getControlledSales(from, to, kind, page).then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load register.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to, kind, page, refresh, revision, user?.clinicId]);
  async function exportAll() {
    setExporting(true); setError('');
    try {
      const rows: ControlledSaleRecord[] = [];
      for (let next = 0; ; next++) {
        const result = await pharmacyService.getControlledSales(from, to, kind, next);
        rows.push(...result.rows);
        if (rows.length >= result.total || !result.rows.length) break;
      }
      downloadCsv(`${kind}-supply-register-${from}-${to}.csv`, toCsv([
        'Entry','Clinic','Drug licence','Supply date (IST)','NRx','H1','Patient','Patient address','Prescriber','Prescriber address',
        'Prescription reference','Prescription date','Medicine','Manufacturer','Batch','Expiry','Quantity supplied',
        'Unit','Pack MRP','Invoice','Pharmacist','Pharmacist registration',
      ], rows.map(r => [r.id, r.clinic_name, r.drug_license_number, new Date(r.supplied_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        r.is_nrx ? 'Yes' : '', r.is_schedule_h1 ? 'Yes' : '', r.details.patientName,r.details.patientAddress,
        r.details.prescriberName,r.details.prescriberAddress,r.details.prescriptionReference,r.details.prescriptionDate,
        r.medicine_name,r.manufacturer,r.batch_number,r.expiry_date,r.quantity,r.unit,r.mrp,r.bill_number,
        r.details.pharmacistName,r.details.pharmacistRegistration])));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not export register.'); }
    finally { setExporting(false); }
  }
  return <section className="bg-white border rounded-xl p-4 space-y-4" aria-label="NRx and Schedule H1 supply register">
    <div><h3 className="text-lg font-semibold">NRx / Schedule H1 supply register</h3>
      <p className="text-sm font-medium">{user?.clinic?.clinicName}{user?.clinic?.drugLicenseNumber ? ` · Drug licence ${user.clinic.drugLicenseNumber}` : ''}</p>
      <p className="text-sm text-gray-600">Recorded at dispensing. Original supply details remain after refunds, product merges or patient edits. Export all entries in the selected period for inspection.</p>
      <p className="text-xs text-gray-500 mt-1">Schedule H1: retain for at least 3 years (Drugs Rules, rule 65(3)(h)). NRx is a separate product marking; additional NDPS and licence records depend on the substance. This register contains supplies recorded after activation.</p></div>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-sm">From<input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0); }} className="block border rounded px-2 py-1" /></label>
      <label className="text-sm">To<input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0); }} className="block border rounded px-2 py-1" /></label>
      <select aria-label="Register type" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }} className="border rounded px-3 py-2"><option value="h1">Schedule H1 register</option><option value="nrx">NRx register</option><option value="all">Both flags</option></select>
      <button disabled={loading || exporting} onClick={() => setRefresh(r => r+1)} className="border rounded px-3 py-2">Refresh</button>
      <button disabled={loading || exporting || !data.total || !!error} onClick={exportAll} className="border rounded px-3 py-2 text-blue-700">{exporting ? 'Exporting…' : 'Export full register (CSV)'}</button>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left bg-gray-50"><tr>{['Entry / Date','Patient','Prescriber / Address','Prescription','Medicine / Batch','Quantity supplied','Pharmacist / Registration','Invoice'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
      <tbody>{!loading && data.rows.map(r => <tr key={r.id} className="border-t align-top"><td className="p-2">#{r.id}<p className="text-xs">{new Date(r.supplied_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p></td>
        <td className="p-2">{r.details.patientName}<p className="text-xs text-gray-500">{r.details.patientAddress}</p></td>
        <td className="p-2">{r.details.prescriberName}<p className="text-xs text-gray-500">{r.details.prescriberAddress}</p></td>
        <td className="p-2">{r.details.prescriptionReference}<p className="text-xs">{r.details.prescriptionDate}</p></td>
        <td className="p-2">{r.medicine_name}<span className="text-red-700">{r.is_nrx ? ' · NRx' : ''}{r.is_schedule_h1 ? ' · H1' : ''}</span><p className="text-xs text-gray-500">{r.manufacturer} · {r.batch_number || 'No batch'} · Exp {r.expiry_date || '—'}</p></td>
        <td className="p-2 whitespace-nowrap">{r.quantity} {r.unit}</td><td className="p-2">{r.details.pharmacistName}<p className="text-xs">{r.details.pharmacistRegistration}</p></td><td className="p-2">{r.bill_number || 'Dispense only'}</td></tr>)}</tbody></table></div>
    {loading ? <p>Loading register…</p> : !data.total && !error ? <p className="text-gray-500">No recorded supplies in this period.</p> : null}
    <div className="flex justify-between text-sm"><span>{data.total} entries · Page {page+1}</span><div className="flex gap-3"><button disabled={loading || page===0} onClick={() => setPage(p => p-1)}>Previous</button><button disabled={loading || (page+1)*100>=data.total} onClick={() => setPage(p => p+1)}>Next</button></div></div>
  </section>;
}
