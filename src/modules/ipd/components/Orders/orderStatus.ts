import type { IpdOrderItem } from '../../types/ipd';

export type OrderItemStatus = IpdOrderItem['status'];

/** Colour per order-item status — shared by the Orders tab and the plan chips. */
export const ORDER_STATUS_STYLE: Record<OrderItemStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  sent_external: 'bg-blue-100 text-blue-700',
  resulted: 'bg-violet-100 text-violet-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

/**
 * Doctors read a bare "pending" as "not ordered yet". The order *is* placed —
 * what is pending is the sample/scan — so spell that out wherever the chip sits
 * next to a "raise an order" button.
 */
export const ORDER_STATUS_LABEL: Record<OrderItemStatus, string> = {
  pending: 'ordered · awaiting sample',
  sent_external: 'sent to lab',
  resulted: 'resulted',
  done: 'done',
  cancelled: 'cancelled',
};

/** Statuses that still count as a live order when checking for duplicates. */
export const OPEN_ORDER_STATUSES: OrderItemStatus[] = ['pending', 'sent_external', 'resulted'];

export const isOpenOrder = (status: OrderItemStatus) => OPEN_ORDER_STATUSES.includes(status);
