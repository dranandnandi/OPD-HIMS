import { expiryStatus, expiryDateKey, type ExpiryLot } from '../../utils/pharmacyExpiry';
import { packSpec, stockDisplay } from '../../utils/packUnits';

export default function ExpiryBadge({ expiryDate }: { expiryDate?: Date | string | null }) {
  const status = expiryStatus(expiryDate);
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>{status.label}</span>;
}

export function StockExpiryIndicators({ lots }: { lots: ExpiryLot[] }) {
  const labels: Record<string, string> = { expired: 'Expired', critical: 'Expires within 7 days', soon: 'Expires in 8–30 days', good: 'Expiry >30 days', unknown: 'Expiry not recorded' };
  const groups = new Map<string, ExpiryLot[]>();
  lots.forEach(lot => {
    const kind = expiryStatus(lot.expiryDate).kind;
    groups.set(kind, [...(groups.get(kind) || []), lot]);
  });
  return <div className="flex flex-col items-start gap-1">{['expired','critical','soon','unknown','good'].map(kind => {
    const group = groups.get(kind);
    if (!group?.length) return null;
    const quantity = group.reduce((sum, lot) => sum + lot.quantity, 0);
    return <span key={kind} className={`px-2 py-0.5 rounded text-xs font-medium ${expiryStatus(group[0].expiryDate).color}`}
      title={group.map(lot => `${lot.batchNumber || 'Pooled stock'}: ${expiryDateKey(lot.expiryDate) || 'expiry not recorded'}; ${stockDisplay(lot.quantity, packSpec(lot.medicine))}`).join('\n')}>
      {labels[kind]} · {stockDisplay(quantity, packSpec(group[0].medicine))}
    </span>;
  })}</div>;
}
