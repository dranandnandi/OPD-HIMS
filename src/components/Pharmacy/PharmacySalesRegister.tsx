import { useEffect, useState } from 'react';
import { Download, Eye, FileText, RefreshCw, X, CreditCard } from 'lucide-react';
import { billingService } from '../../services/billingService';
import { pharmacyInvoiceService } from '../../services/pharmacyInvoiceService';
import type { Bill } from '../../types';
import { useAuth } from '../Auth/useAuth';
import { canReceiveBillPayment } from '../../utils/billingPayments';
import PaymentForm from '../Billing/PaymentForm';
import { inr } from '../../utils/gst';

export default function PharmacySalesRegister({ revision = 0 }: { revision?: number }) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', status: 'all', source: 'all', from: '', to: '', page: 0 });
  const [data, setData] = useState<{ bills: Bill[]; total: number; sales: number; outstanding: number }>({ bills: [], total: 0, sales: 0, outstanding: 0 });
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [detail, setDetail] = useState<Bill | null>(null), [payment, setPayment] = useState<Bill | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setFilters(f => ({ ...f, search, page: 0 })), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (filters.from && filters.to && filters.from > filters.to) {
      setError('The end date must be on or after the start date.'); setLoading(false); return;
    }
    billingService.getPharmacyBills(filters).then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load bills.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, refresh, revision, user?.clinicId]);
  const filter = (key: string, value: string) => setFilters(f => ({ ...f, [key]: value, page: 0 }));
  async function openDetails(bill: Bill) {
    setBusy(bill.id); setError('');
    try {
      const full = await billingService.getBillById(bill.id);
      if (!full || full.billType !== 'pharmacy') throw new Error('This pharmacy invoice is no longer available.');
      setDetail(full);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load invoice.'); }
    finally { setBusy(''); }
  }
  async function pdf(bill: Bill, download = false, regenerate = false) {
    setBusy(bill.id); setError(''); setNotice('');
    try {
      const result = download ? await pharmacyInvoiceService.generate(bill.id, { forceRegenerate: regenerate }) : await pharmacyInvoiceService.open(bill.id, regenerate);
      if (download) {
        const response = await fetch(result.url); if (!response.ok) throw new Error('Could not download the saved PDF.');
        const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
        link.href = url; link.download = `${bill.billNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      setNotice(result.cached ? 'Saved invoice PDF opened.' : 'Invoice PDF generated locally and saved.');
      setData(d => ({ ...d, bills: d.bills.map(b => b.id === bill.id ? { ...b, pdfUrl: result.url } : b) }));
      setDetail(d => d?.id === bill.id ? { ...d, pdfUrl: result.url } : d);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare invoice PDF.'); }
    finally { setBusy(''); }
  }
  return <section className="space-y-4" aria-label="Pharmacy sales and bills">
    <div className="grid sm:grid-cols-3 gap-4">
      {[[String(data.total), 'Matching invoices'], [inr(data.sales), 'Invoice value (excludes cancelled)'], [inr(data.outstanding), 'Outstanding balance']].map(([value, label]) =>
        <div key={label} className="bg-white border rounded-lg p-4"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-semibold mt-1">{loading ? '...' : value}</p></div>)}
    </div>
    <div className="bg-white rounded-lg border">
      <div className="p-4 flex flex-wrap gap-3 border-b">
        <input aria-label="Search pharmacy bills" placeholder="Bill number, customer or phone" value={search} onChange={e => setSearch(e.target.value)} className="border rounded px-3 py-2 text-sm min-w-[240px] flex-1" />
        <select aria-label="Payment status" value={filters.status} onChange={e => filter('status', e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="all">All payment statuses</option>{['paid', 'pending', 'partial', 'overdue', 'cancelled'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select aria-label="Sale type" value={filters.source} onChange={e => filter('source', e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="all">All pharmacy sales</option><option value="counter">Counter sales</option><option value="visit">Visit-linked sales</option>
        </select>
        <label className="text-xs text-gray-500">From<input type="date" value={filters.from} onChange={e => filter('from', e.target.value)} className="block border rounded px-2 py-1 text-sm text-gray-700" /></label>
        <label className="text-xs text-gray-500">To<input type="date" value={filters.to} onChange={e => filter('to', e.target.value)} className="block border rounded px-2 py-1 text-sm text-gray-700" /></label>
        <button onClick={() => { setSearch(''); setFilters({ search: '', status: 'all', source: 'all', from: '', to: '', page: 0 }); }} className="text-sm text-gray-600">Clear</button>
        <button onClick={() => setRefresh(r => r + 1)} disabled={loading} className="border rounded px-3 py-2 text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div>
      {error && <p role="alert" className="p-4 text-sm text-red-700 bg-red-50">{error}</p>}
      {notice && <p role="status" className="p-3 text-sm text-green-700 bg-green-50">{notice}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr>{['Invoice / Date', 'Customer', 'Sale type', 'Total', 'Paid / Balance', 'Status', 'PDF', 'Actions'].map(h => <th key={h} className="p-3 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{!loading && data.bills.map(bill => <tr key={bill.id} className="border-t hover:bg-gray-50">
            <td className="p-3"><button onClick={() => openDetails(bill)} disabled={!!busy} className="font-medium text-blue-700">{bill.billNumber}</button><p className="text-xs text-gray-500">{bill.billDate.toLocaleDateString('en-IN')}</p></td>
            <td className="p-3">{bill.patient?.name || 'Customer'}<p className="text-xs text-gray-500">{bill.patient?.phone}</p></td>
            <td className="p-3 whitespace-nowrap">{bill.visitId ? 'Visit-linked' : 'Counter'}</td>
            <td className="p-3 whitespace-nowrap font-medium">{inr(bill.totalAmount)}</td>
            <td className="p-3 whitespace-nowrap">{inr(bill.paidAmount)} paid<p className={`text-xs ${bill.balanceAmount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>{inr(bill.balanceAmount)} due</p></td>
            <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs capitalize ${bill.paymentStatus === 'paid' ? 'bg-green-100 text-green-800' : bill.paymentStatus === 'cancelled' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>{bill.paymentStatus}</span>{Number(bill.totalRefundedAmount) > 0 && <p className="text-xs mt-2">Refunded {inr(bill.totalRefundedAmount)}</p>}</td>
            <td className="p-3 text-xs whitespace-nowrap">{bill.pdfUrl ? 'Saved' : 'Not generated'}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2 min-w-[230px]">
              <button title="View invoice" aria-label={`View ${bill.billNumber}`} disabled={!!busy} onClick={() => openDetails(bill)} className="p-2 border rounded hover:bg-white"><Eye className="w-4 h-4" /></button>
              <button disabled={!!busy} onClick={() => pdf(bill)} className="px-2 py-1.5 border rounded text-blue-700 flex gap-1 items-center"><FileText className="w-4 h-4" />{busy === bill.id ? 'Preparing...' : bill.pdfUrl ? 'Open PDF' : 'Generate PDF'}</button>
              <button title="Download invoice PDF" aria-label={`Download ${bill.billNumber}`} disabled={!!busy} onClick={() => pdf(bill, true)} className="p-2 border rounded"><Download className="w-4 h-4" /></button>
              {canReceiveBillPayment(user, bill) && <button disabled={!!busy} onClick={() => setPayment(bill)} className="px-2 py-1 border rounded text-green-700">Receive payment</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
        {loading ? <p className="p-8 text-center text-gray-500">Loading pharmacy bills...</p> : !data.bills.length && !error ? <p className="p-8 text-center text-gray-500">No pharmacy bills match these filters. Create a counter sale to raise an invoice.</p> : null}
      </div>
      <div className="p-4 border-t flex items-center justify-between text-sm text-gray-600"><span>{data.total ? `${filters.page * 25 + 1}-${Math.min((filters.page + 1) * 25, data.total)} of ${data.total}` : '0 invoices'}</span><div className="flex gap-3">
        <button disabled={loading || filters.page === 0} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} className="border rounded px-3 py-1 disabled:opacity-40">Previous</button>
        <button disabled={loading || (filters.page + 1) * 25 >= data.total} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} className="border rounded px-3 py-1 disabled:opacity-40">Next</button>
      </div></div>
    </div>
    {payment && <PaymentForm billId={payment.id} billNumber={payment.billNumber} patientName={payment.patient?.name}
      billAmount={payment.totalAmount} paidAmount={payment.paidAmount} onCancel={() => setPayment(null)}
      onPaymentRecorded={() => { setPayment(null); setDetail(null); setRefresh(r => r + 1); }} />}
    {detail && <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pharmacy invoice details">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex justify-between items-start"><div><h3 className="text-lg font-semibold">{detail.billNumber}</h3><p className="text-sm text-gray-500">{detail.patient?.name} · {detail.billDate.toLocaleDateString('en-IN')} · {detail.paymentStatus}</p></div><button aria-label="Close invoice" onClick={() => setDetail(null)}><X /></button></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left"><tr>{['Medicine / Batch', 'Quantity', 'Pack MRP', 'Rate', 'GST', 'Total'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
          {detail.billItems.map(item => <tr key={item.id} className="border-t"><td className="p-2">{item.itemName}<p className="text-xs text-gray-500">Batch {item.batchNumber || '-'} · HSN {item.hsnCode || '-'}</p></td><td className="p-2">{item.billedQuantity ?? item.quantity} {item.billedUnit || 'Pack'}</td><td className="p-2">{inr(item.mrp ?? item.unitPrice)}</td><td className="p-2">{inr(item.unitPrice)}</td><td className="p-2">{item.gstRate || 0}%</td><td className="p-2">{inr(item.totalPrice)}</td></tr>)}
        </tbody></table></div>
        <div className="text-right space-y-1"><p>Total: <strong>{inr(detail.totalAmount)}</strong></p><p>Paid: {inr(detail.paidAmount)} · Balance: {inr(detail.balanceAmount)}</p></div>
        {detail.notes && <p className="text-sm text-gray-600">{detail.notes}</p>}
        {error && <p className="text-red-700 text-sm" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3 justify-end"><button disabled={!!busy} onClick={() => pdf(detail, false, true)} className="border rounded px-3 py-2 text-sm">Regenerate PDF</button><button disabled={!!busy} onClick={() => pdf(detail)} className="bg-blue-600 text-white rounded px-3 py-2 text-sm">{busy ? 'Preparing...' : 'Open / Print PDF'}</button>
          {canReceiveBillPayment(user, detail) && <button onClick={() => { setPayment(detail); setDetail(null); }} className="bg-green-600 text-white rounded px-3 py-2 text-sm flex items-center gap-2"><CreditCard className="w-4 h-4" />Receive payment</button>}
        </div>
      </div>
    </div>}
  </section>;
}
