import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FlaskConical, FileStack, Ban, Check, Truck, Printer } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { orderService, categoryOfServiceType, OrderCategory } from '../../services/orderService';
import { documentService } from '../../services/documentService';
import OrderComposer from './OrderComposer';
import ReportsSection from './ReportsSection';
import { ORDER_STATUS_STYLE } from './orderStatus';
import type { Admission, IpdOrderItem } from '../../types/ipd';

interface Props {
  admission: Admission;
  readOnly: boolean;
}

type Section = 'orders' | 'reports';

const CATEGORY_LABEL: Record<OrderCategory, string> = {
  pathology: 'Pathology',
  radiology: 'Radiology',
  procedure: 'Procedures',
  other: 'Other',
};

/** Investigations ordered on the chart + the reports that answer them. */
export default function OrdersTab({ admission, readOnly }: Props) {
  const { clinicId, profile } = useAuth();
  const [section, setSection] = useState<Section>('orders');
  const [items, setItems] = useState<IpdOrderItem[]>([]);

  const reload = useCallback(() => {
    orderService.listItems(admission.id).then(setItems).catch((e) => toast.error(e.message));
  }, [admission.id]);

  useEffect(reload, [reload]);

  const pending = items.filter((i) => i.status === 'pending').length;
  const awaitingReport = items.filter((i) => ['pending', 'sent_external'].includes(i.status)).length;

  const grouped = new Map<OrderCategory, IpdOrderItem[]>();
  for (const i of items) {
    const cat = categoryOfServiceType(i.service?.service_type);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(i);
  }

  const setStatus = async (item: IpdOrderItem, status: IpdOrderItem['status']) => {
    if (!clinicId) return;
    try {
      await orderService.setItemStatus({ clinicId, itemId: item.id, status, userId: profile?.id });
      toast.success(`Marked ${status.replace('_', ' ')}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const cancel = async (item: IpdOrderItem) => {
    if (!clinicId) return;
    const reason = prompt(`Cancel "${item.service?.name ?? 'order'}" — reason?`);
    if (reason === null) return;
    try {
      await orderService.cancelItem({ clinicId, item, reason: reason || 'Cancelled', userId: profile?.id });
      toast.success('Order cancelled — charge reversed');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setSection('orders')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
            section === 'orders' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          Orders ({pending} pending)
        </button>
        <button
          onClick={() => setSection('reports')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${
            section === 'reports' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'
          }`}
        >
          <FileStack className="w-4 h-4" />
          Reports
          {awaitingReport > 0 && (
            <span className="bg-amber-500 text-white text-xs rounded-full px-1.5">{awaitingReport} awaited</span>
          )}
        </button>
        {items.length > 0 && (
          <button
            onClick={() =>
              documentService.printOrderSheet({
                admission, clinicId: clinicId!, items,
              })
            }
            title="Print the ward file order sheet"
            className="ml-auto flex items-center gap-1.5 border border-slate-300 text-slate-600 text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50"
          >
            <Printer className="w-4 h-4" /> Order sheet
          </button>
        )}
      </div>

      {section === 'reports' ? (
        <ReportsSection
          admissionId={admission.id}
          orderItems={items}
          readOnly={readOnly}
          onChange={reload}
        />
      ) : (
        <div>
          {!readOnly && (
            <OrderComposer
              clinicId={clinicId!}
              admission={admission}
              userId={profile?.id}
              existingItems={items}
              onPlaced={reload}
            />
          )}

          {[...grouped.entries()].map(([cat, rows]) => (
            <div key={cat} className="bg-white rounded-xl border border-slate-200 mb-3 overflow-hidden">
              <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-navy-700 bg-slate-50 border-b border-slate-200">
                {CATEGORY_LABEL[cat]} ({rows.length})
              </p>
              <div className="divide-y divide-slate-100">
                {rows.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                    <div className="flex-1 min-w-48">
                      <p className={`text-slate-800 ${i.status === 'cancelled' ? 'line-through text-slate-400' : ''}`}>
                        {i.service?.name ?? 'Service'}
                        {i.quantity > 1 && <span className="text-slate-400"> × {i.quantity}</span>}
                        {i.parent_order?.priority && i.parent_order.priority !== 'routine' && (
                          <span className="ml-1.5 text-[10px] uppercase font-semibold text-red-700 bg-red-100 rounded px-1">
                            {i.parent_order.priority}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        ordered {i.parent_order?.order_datetime
                          ? format(new Date(i.parent_order.order_datetime), 'dd MMM, HH:mm')
                          : '—'}
                        {i.parent_order?.clinical_notes ? ` · ${i.parent_order.clinical_notes}` : ''}
                        {i.reports?.length ? ` · ${i.reports.length} report(s) filed` : ''}
                      </p>
                    </div>
                    <span
                      title={i.status === 'pending' ? 'Order placed — sample / scan not sent yet' : undefined}
                      className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${ORDER_STATUS_STYLE[i.status]}`}
                    >
                      {i.status === 'pending' ? 'awaiting sample' : i.status.replace('_', ' ')}
                    </span>
                    {!readOnly && !['cancelled', 'done'].includes(i.status) && (
                      <div className="flex gap-1">
                        {i.status === 'pending' && (
                          <button
                            onClick={() => setStatus(i, 'sent_external')}
                            title="Sample sent / patient sent to imaging"
                            className="p-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100"
                          >
                            <Truck className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setStatus(i, 'done')}
                          title="Mark completed"
                          className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => cancel(i)}
                          title="Cancel order (reverses the charge)"
                          className="p-1.5 rounded-lg bg-slate-50 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {items.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
              No investigations ordered yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
