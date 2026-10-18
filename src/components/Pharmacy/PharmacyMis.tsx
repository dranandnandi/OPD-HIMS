import React, { useState, useEffect, useMemo } from 'react';
import { Download, BarChart3, AlertTriangle, Trash2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
  pharmacyMisService,
  SalesByMedicineRow, DailySalesRow, PurchasesBySupplierRow, StockValuationRow,
  DeadStockRow, ExpiredStockRow, SalesByUserRow
} from '../../services/pharmacyMisService';
import { useAuth } from '../Auth/useAuth';
import { inr, toCsv, downloadCsv } from '../../utils/gst';

type Tab = 'medicine' | 'category' | 'daily' | 'suppliers' | 'valuation' | 'dead' | 'expired' | 'users';

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
const n2 = (n: number) => n.toFixed(2);
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');

/**
 * Pharmacy MIS: the monthly owner's view. Period reports use the date range;
 * stock reports are as of now.
 */
const PharmacyMis: React.FC = () => {
  const { user } = useAuth();
  const [from, setFrom] = useState(fmt(startOfMonth(new Date())));
  const [to, setTo] = useState(fmt(endOfMonth(new Date())));
  const [tab, setTab] = useState<Tab>('medicine');
  const [deadDays, setDeadDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [byMedicine, setByMedicine] = useState<SalesByMedicineRow[]>([]);
  const [daily, setDaily] = useState<DailySalesRow[]>([]);
  const [suppliers, setSuppliers] = useState<PurchasesBySupplierRow[]>([]);
  const [valuation, setValuation] = useState<StockValuationRow[]>([]);
  const [dead, setDead] = useState<DeadStockRow[]>([]);
  const [expired, setExpired] = useState<ExpiredStockRow[]>([]);
  const [byUser, setByUser] = useState<SalesByUserRow[]>([]);
  const [search, setSearch] = useState('');

  const isPeriodTab = tab === 'medicine' || tab === 'category' || tab === 'daily' || tab === 'suppliers' || tab === 'users';

  useEffect(() => {
    if (user) load();
  }, [user, tab, from, to, deadDays]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const f = new Date(`${from}T00:00:00`);
      const t = new Date(`${to}T00:00:00`);
      switch (tab) {
        case 'medicine':
        case 'category': setByMedicine(await pharmacyMisService.salesByMedicine(f, t)); break;
        case 'daily': setDaily(await pharmacyMisService.dailySales(f, t)); break;
        case 'suppliers': setSuppliers(await pharmacyMisService.purchasesBySupplier(f, t)); break;
        case 'valuation': setValuation(await pharmacyMisService.stockValuation()); break;
        case 'dead': setDead(await pharmacyMisService.deadStock(deadDays)); break;
        case 'expired': setExpired(await pharmacyMisService.expiredStock()); break;
        case 'users': setByUser(await pharmacyMisService.salesByUser(f, t)); break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const setMonth = (offset: number) => {
    const d = subMonths(new Date(), offset);
    setFrom(fmt(startOfMonth(d)));
    setTo(fmt(endOfMonth(d)));
  };

  const byCategory = useMemo(() => {
    const map = new Map<string, SalesByMedicineRow>();
    for (const r of byMedicine) {
      const c = map.get(r.category) || { medicineName: '', category: r.category, quantity: 0, invoiceCount: 0, taxableAmount: 0, taxAmount: 0, salesAmount: 0, costAmount: 0, marginAmount: 0 };
      c.quantity += r.quantity; c.invoiceCount += r.invoiceCount; c.taxableAmount += r.taxableAmount; c.taxAmount += r.taxAmount;
      c.salesAmount += r.salesAmount; c.costAmount += r.costAmount; c.marginAmount += r.marginAmount;
      map.set(r.category, c);
    }
    return [...map.values()].sort((a, b) => b.salesAmount - a.salesAmount);
  }, [byMedicine]);

  const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);
  const q = search.toLowerCase();
  const filterName = <T extends { medicineName: string; rackLocation?: string }>(rows: T[]) =>
    rows.filter(r => !q || r.medicineName.toLowerCase().includes(q) || r.rackLocation?.toLowerCase().includes(q));

  const handleWriteOff = async (row: ExpiredStockRow) => {
    const reason = prompt(`Write off ${row.quantity} × ${row.medicineName} (batch ${row.batchNumber})?\nReason:`, 'Expired');
    if (reason === null) return;
    try {
      await pharmacyMisService.writeOffBatch(row.batchId, reason || 'Expired');
      setExpired(expired.filter(e => e.batchId !== row.batchId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Write-off failed');
    }
  };

  const exportCurrent = () => {
    const stamp = `${from}-to-${to}`;
    switch (tab) {
      case 'medicine':
        downloadCsv(`sales-by-medicine-${stamp}.csv`, toCsv(['Medicine', 'Category', 'HSN', 'Qty', 'Invoices', 'Taxable', 'GST', 'Sales', 'Cost', 'Margin', 'Margin %'],
          byMedicine.map(r => [r.medicineName, r.category, r.hsnCode || '', r.quantity, r.invoiceCount, n2(r.taxableAmount), n2(r.taxAmount), n2(r.salesAmount), n2(r.costAmount), n2(r.marginAmount), pct(r.marginAmount, r.taxableAmount)])));
        break;
      case 'category':
        downloadCsv(`sales-by-category-${stamp}.csv`, toCsv(['Category', 'Qty', 'Taxable', 'GST', 'Sales', 'Cost', 'Margin', 'Margin %'],
          byCategory.map(r => [r.category, r.quantity, n2(r.taxableAmount), n2(r.taxAmount), n2(r.salesAmount), n2(r.costAmount), n2(r.marginAmount), pct(r.marginAmount, r.taxableAmount)])));
        break;
      case 'daily': {
        const methods = [...new Set(daily.flatMap(d => Object.keys(d.byMethod)))].sort();
        downloadCsv(`daily-pharmacy-sales-${stamp}.csv`, toCsv(['Date', 'Invoices', 'Billed', 'Taxable', 'GST', 'Collected', ...methods],
          daily.map(d => [format(d.day, 'dd/MM/yyyy'), d.invoiceCount, n2(d.billedAmount), n2(d.taxableAmount), n2(d.taxAmount), n2(d.collectedAmount), ...methods.map(m => n2(d.byMethod[m] || 0))])));
        break;
      }
      case 'suppliers':
        downloadCsv(`purchases-by-supplier-${stamp}.csv`, toCsv(['Supplier', 'GSTIN', 'Invoices', 'Debit notes', 'Taxable', 'GST', 'Total'],
          suppliers.map(r => [r.supplierName, r.supplierGstin || '', r.invoiceCount, r.debitNoteCount, n2(r.taxableAmount), n2(r.taxAmount), n2(r.totalAmount)])));
        break;
      case 'valuation':
        downloadCsv(`stock-valuation-${fmt(new Date())}.csv`, toCsv(['Medicine', 'Category', 'Rack', 'Batch qty', 'Pooled qty', 'Total qty', 'Value at cost', 'Value at MRP', 'Earliest expiry'],
          valuation.map(r => [r.medicineName, r.category, r.rackLocation || '', r.batchQuantity, r.pooledQuantity, r.totalQuantity, n2(r.costValue), n2(r.mrpValue), r.earliestExpiry ? format(r.earliestExpiry, 'dd/MM/yyyy') : ''])));
        break;
      case 'dead':
        downloadCsv(`dead-stock-${deadDays}d.csv`, toCsv(['Medicine', 'Category', 'Rack', 'Stock', 'Value at cost', 'Last sold', 'Days idle'],
          dead.map(r => [r.medicineName, r.category, r.rackLocation || '', r.currentStock, n2(r.costValue), r.lastSoldAt ? format(r.lastSoldAt, 'dd/MM/yyyy') : 'never', r.daysIdle])));
        break;
      case 'expired':
        downloadCsv(`expired-stock-${fmt(new Date())}.csv`, toCsv(['Medicine', 'Batch', 'Expiry', 'Qty', 'Purchase rate', 'MRP', 'Value at cost', 'Supplier', 'Rack'],
          expired.map(r => [r.medicineName, r.batchNumber, format(r.expiryDate, 'dd/MM/yyyy'), r.quantity, r.purchaseRate ?? '', r.mrp ?? '', n2(r.costValue), r.supplierName || '', r.rackLocation || ''])));
        break;
      case 'users':
        downloadCsv(`sales-by-pharmacist-${stamp}.csv`, toCsv(['Pharmacist', 'Invoices', 'Lines', 'Qty', 'Taxable', 'GST', 'Sales'],
          byUser.map(r => [r.userName, r.invoiceCount, r.lineCount, r.quantity, n2(r.taxableAmount), n2(r.taxAmount), n2(r.salesAmount)])));
        break;
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'medicine', label: 'Sales by medicine' },
    { id: 'category', label: 'Sales by category' },
    { id: 'daily', label: 'Daily sales' },
    { id: 'suppliers', label: 'Supplier purchases' },
    { id: 'valuation', label: 'Stock valuation' },
    { id: 'dead', label: 'Dead stock' },
    { id: 'expired', label: 'Expired stock' },
    { id: 'users', label: 'Pharmacist-wise' }
  ];

  const th = 'px-3 py-3 text-xs uppercase text-gray-500 whitespace-nowrap';
  const tdR = 'px-3 py-2 text-right whitespace-nowrap';
  const tfoot = 'bg-gray-100 font-semibold';
  const methods = useMemo(() => [...new Set(daily.flatMap(d => Object.keys(d.byMethod)))].sort(), [daily]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><BarChart3 className="w-6 h-6 text-blue-600" /> Pharmacy MIS</h2>
          <p className="text-gray-600">Sales, margin, purchases and stock health</p>
        </div>
        <button onClick={exportCurrent} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md p-4 flex flex-wrap items-end gap-4">
        {isPeriodTab ? (
          <>
            <div>
              <label className="block text-xs text-gray-600 mb-1">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMonth(0)} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">This month</button>
              <button onClick={() => setMonth(1)} className="px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">Last month</button>
            </div>
          </>
        ) : tab === 'dead' ? (
          <div>
            <label className="block text-xs text-gray-600 mb-1">No sale in the last</label>
            <select value={deadDays} onChange={(e) => setDeadDays(parseInt(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg">
              {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
        ) : (
          <p className="text-sm text-gray-600 py-2">As of now.</p>
        )}
        {(tab === 'medicine' || tab === 'valuation' || tab === 'dead' || tab === 'expired') && (
          <div className="ml-auto">
            <label className="block text-xs text-gray-600 mb-1">Filter</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Medicine or rack" className="px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-md">
        <div className="border-b border-gray-200 overflow-x-auto">
          <nav className="flex min-w-max">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-3 text-sm font-medium whitespace-nowrap ${tab === t.id ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-800'}`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {error && <div className="m-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>
        ) : (
          <div className="overflow-x-auto">
            {tab === 'medicine' && (() => {
              const rows = filterName(byMedicine);
              return (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className={`${th} text-left`}>Medicine</th><th className={`${th} text-left`}>Category</th>
                    <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Invoices</th>
                    <th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Sales</th>
                    <th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>Margin</th><th className={`${th} text-right`}>Margin %</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No pharmacy sales in this period</td></tr>}
                    {rows.map((r, i) => (
                      <tr key={r.medicineId || i} className={r.marginAmount < 0 ? 'bg-red-50' : ''}>
                        <td className="px-3 py-2">{r.medicineName}{r.hsnCode && <span className="ml-2 text-xs text-gray-400">HSN {r.hsnCode}</span>}</td>
                        <td className="px-3 py-2 capitalize">{r.category}</td>
                        <td className={tdR}>{r.quantity}</td><td className={tdR}>{r.invoiceCount}</td>
                        <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.taxAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.salesAmount)}</td>
                        <td className={tdR}>{n2(r.costAmount)}</td><td className={`${tdR} ${r.marginAmount < 0 ? 'text-red-700' : 'text-green-700'}`}>{n2(r.marginAmount)}</td><td className={tdR}>{pct(r.marginAmount, r.taxableAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 0 && <tfoot className={tfoot}><tr>
                    <td className="px-3 py-3" colSpan={2}>Total</td>
                    <td className={tdR}>{sum(rows, r => r.quantity)}</td><td className={tdR}></td>
                    <td className={tdR}>{n2(sum(rows, r => r.taxableAmount))}</td><td className={tdR}>{n2(sum(rows, r => r.taxAmount))}</td><td className={tdR}>{n2(sum(rows, r => r.salesAmount))}</td>
                    <td className={tdR}>{n2(sum(rows, r => r.costAmount))}</td><td className={tdR}>{n2(sum(rows, r => r.marginAmount))}</td><td className={tdR}>{pct(sum(rows, r => r.marginAmount), sum(rows, r => r.taxableAmount))}</td>
                  </tr></tfoot>}
                </table>
              );
            })()}

            {tab === 'category' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className={`${th} text-left`}>Category</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST</th>
                  <th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Cost</th><th className={`${th} text-right`}>Margin</th><th className={`${th} text-right`}>Margin %</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {byCategory.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">No pharmacy sales in this period</td></tr>}
                  {byCategory.map(r => (
                    <tr key={r.category}>
                      <td className="px-3 py-2 capitalize">{r.category}</td><td className={tdR}>{r.quantity}</td><td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.taxAmount)}</td>
                      <td className={`${tdR} font-medium`}>{n2(r.salesAmount)}</td><td className={tdR}>{pct(r.salesAmount, sum(byCategory, x => x.salesAmount))}</td>
                      <td className={tdR}>{n2(r.costAmount)}</td><td className={tdR}>{n2(r.marginAmount)}</td><td className={tdR}>{pct(r.marginAmount, r.taxableAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'daily' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className={`${th} text-left`}>Date</th><th className={`${th} text-right`}>Invoices</th><th className={`${th} text-right`}>Billed</th><th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST</th>
                  <th className={`${th} text-right`}>Collected</th>{methods.map(m => <th key={m} className={`${th} text-right capitalize`}>{m}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {daily.length === 0 && <tr><td colSpan={6 + methods.length} className="px-3 py-8 text-center text-gray-500">No pharmacy sales in this period</td></tr>}
                  {daily.map(d => (
                    <tr key={d.day.toISOString()} className={d.collectedAmount < d.billedAmount ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-2 whitespace-nowrap">{format(d.day, 'EEE dd MMM')}</td><td className={tdR}>{d.invoiceCount}</td><td className={`${tdR} font-medium`}>{n2(d.billedAmount)}</td>
                      <td className={tdR}>{n2(d.taxableAmount)}</td><td className={tdR}>{n2(d.taxAmount)}</td><td className={tdR}>{n2(d.collectedAmount)}</td>
                      {methods.map(m => <td key={m} className={tdR}>{d.byMethod[m] ? n2(d.byMethod[m]) : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
                {daily.length > 0 && <tfoot className={tfoot}><tr>
                  <td className="px-3 py-3">Total</td><td className={tdR}>{sum(daily, d => d.invoiceCount)}</td><td className={tdR}>{n2(sum(daily, d => d.billedAmount))}</td>
                  <td className={tdR}>{n2(sum(daily, d => d.taxableAmount))}</td><td className={tdR}>{n2(sum(daily, d => d.taxAmount))}</td><td className={tdR}>{n2(sum(daily, d => d.collectedAmount))}</td>
                  {methods.map(m => <td key={m} className={tdR}>{n2(sum(daily, d => d.byMethod[m] || 0))}</td>)}
                </tr></tfoot>}
              </table>
            )}

            {tab === 'suppliers' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className={`${th} text-left`}>Supplier</th><th className={`${th} text-left`}>GSTIN</th><th className={`${th} text-right`}>Invoices</th><th className={`${th} text-right`}>Debit notes</th>
                  <th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST (ITC)</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Share</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {suppliers.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No purchases in this period</td></tr>}
                  {suppliers.map((r, i) => (
                    <tr key={r.supplierId || i}>
                      <td className="px-3 py-2">{r.supplierName}</td><td className="px-3 py-2 font-mono text-xs">{r.supplierGstin || <span className="text-amber-600">missing</span>}</td>
                      <td className={tdR}>{r.invoiceCount}</td><td className={tdR}>{r.debitNoteCount || '—'}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.taxAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.totalAmount)}</td>
                      <td className={tdR}>{pct(r.totalAmount, sum(suppliers, x => x.totalAmount))}</td>
                    </tr>
                  ))}
                </tbody>
                {suppliers.length > 0 && <tfoot className={tfoot}><tr>
                  <td className="px-3 py-3" colSpan={2}>Total</td><td className={tdR}>{sum(suppliers, r => r.invoiceCount)}</td><td className={tdR}>{sum(suppliers, r => r.debitNoteCount)}</td>
                  <td className={tdR}>{n2(sum(suppliers, r => r.taxableAmount))}</td><td className={tdR}>{n2(sum(suppliers, r => r.taxAmount))}</td><td className={tdR}>{n2(sum(suppliers, r => r.totalAmount))}</td><td></td>
                </tr></tfoot>}
              </table>
            )}

            {tab === 'valuation' && (() => {
              const rows = filterName(valuation);
              return (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border-b border-gray-200 text-sm">
                    <div><div className="text-gray-500">SKUs in stock</div><div className="text-xl font-bold">{valuation.length}</div></div>
                    <div><div className="text-gray-500">Units</div><div className="text-xl font-bold">{sum(valuation, r => r.totalQuantity)}</div></div>
                    <div><div className="text-gray-500">Value at cost</div><div className="text-xl font-bold">{inr(sum(valuation, r => r.costValue))}</div></div>
                    <div><div className="text-gray-500">Value at MRP</div><div className="text-xl font-bold text-green-700">{inr(sum(valuation, r => r.mrpValue))}</div></div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50"><tr>
                      <th className={`${th} text-left`}>Medicine</th><th className={`${th} text-left`}>Rack</th><th className={`${th} text-right`}>Batch qty</th><th className={`${th} text-right`}>Pooled qty</th>
                      <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>At cost</th><th className={`${th} text-right`}>At MRP</th><th className={`${th} text-left`}>Earliest expiry</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-200">
                      {rows.map(r => (
                        <tr key={r.medicineId}>
                          <td className="px-3 py-2">{r.medicineName}<span className="ml-2 text-xs text-gray-400 capitalize">{r.category}</span></td>
                          <td className="px-3 py-2">{r.rackLocation ? <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs">{r.rackLocation}</span> : '—'}</td>
                          <td className={tdR}>{r.batchQuantity}</td><td className={`${tdR} ${r.pooledQuantity > 0 ? 'text-amber-700' : ''}`}>{r.pooledQuantity || '—'}</td>
                          <td className={`${tdR} font-medium`}>{r.totalQuantity}</td><td className={tdR}>{n2(r.costValue)}</td><td className={tdR}>{n2(r.mrpValue)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{r.earliestExpiry ? format(r.earliestExpiry, 'MMM yyyy') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="p-4 text-xs text-gray-500">Pooled quantity is stock that was never received with a batch number; it is valued at the clinic cost price. It clears as those SKUs are re-purchased with batches.</p>
                </>
              );
            })()}

            {tab === 'dead' && (() => {
              const rows = filterName(dead);
              return (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className={`${th} text-left`}>Medicine</th><th className={`${th} text-left`}>Rack</th><th className={`${th} text-right`}>Stock</th><th className={`${th} text-right`}>Value at cost</th><th className={`${th} text-left`}>Last sold</th><th className={`${th} text-right`}>Days idle</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Nothing idle for {deadDays} days. Good.</td></tr>}
                    {rows.map(r => (
                      <tr key={r.medicineId}>
                        <td className="px-3 py-2">{r.medicineName}<span className="ml-2 text-xs text-gray-400 capitalize">{r.category}</span></td>
                        <td className="px-3 py-2">{r.rackLocation || '—'}</td><td className={tdR}>{r.currentStock}</td><td className={`${tdR} font-medium`}>{n2(r.costValue)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.lastSoldAt ? format(r.lastSoldAt, 'dd MMM yyyy') : <span className="text-gray-400">never</span>}</td><td className={tdR}>{r.daysIdle}</td>
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 0 && <tfoot className={tfoot}><tr><td className="px-3 py-3" colSpan={2}>{rows.length} SKUs tying up</td><td className={tdR}>{sum(rows, r => r.currentStock)}</td><td className={tdR}>{n2(sum(rows, r => r.costValue))}</td><td colSpan={2}></td></tr></tfoot>}
                </table>
              );
            })()}

            {tab === 'expired' && (() => {
              const rows = filterName(expired);
              return (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className={`${th} text-left`}>Medicine</th><th className={`${th} text-left`}>Batch</th><th className={`${th} text-left`}>Expired on</th><th className={`${th} text-right`}>Qty</th>
                    <th className={`${th} text-right`}>Value at cost</th><th className={`${th} text-left`}>Supplier</th><th className={`${th} text-left`}>Rack</th><th className={th}></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No expired batches on the shelf.</td></tr>}
                    {rows.map(r => (
                      <tr key={r.batchId} className="bg-red-50/40">
                        <td className="px-3 py-2">{r.medicineName}</td><td className="px-3 py-2 font-mono">{r.batchNumber}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-red-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{format(r.expiryDate, 'dd MMM yyyy')}</td>
                        <td className={tdR}>{r.quantity}</td><td className={`${tdR} font-medium`}>{n2(r.costValue)}</td>
                        <td className="px-3 py-2">{r.supplierName || '—'}</td><td className="px-3 py-2">{r.rackLocation || '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => handleWriteOff(r)} className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-100">
                            <Trash2 className="w-3 h-3" /> Write off
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 0 && <tfoot className={tfoot}><tr><td className="px-3 py-3" colSpan={3}>{rows.length} batches</td><td className={tdR}>{sum(rows, r => r.quantity)}</td><td className={tdR}>{n2(sum(rows, r => r.costValue))}</td><td colSpan={3}></td></tr></tfoot>}
                </table>
              );
            })()}

            {tab === 'users' && (
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className={`${th} text-left`}>Pharmacist</th><th className={`${th} text-right`}>Invoices</th><th className={`${th} text-right`}>Lines</th><th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Taxable</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Share</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {byUser.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">No dispensing in this period</td></tr>}
                  {byUser.map((r, i) => (
                    <tr key={r.userId || i}>
                      <td className="px-3 py-2">{r.userName}</td><td className={tdR}>{r.invoiceCount}</td><td className={tdR}>{r.lineCount}</td><td className={tdR}>{r.quantity}</td>
                      <td className={tdR}>{n2(r.taxableAmount)}</td><td className={tdR}>{n2(r.taxAmount)}</td><td className={`${tdR} font-medium`}>{n2(r.salesAmount)}</td>
                      <td className={tdR}>{pct(r.salesAmount, sum(byUser, x => x.salesAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PharmacyMis;
