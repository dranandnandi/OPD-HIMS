import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as rawClient } from '../lib/supabaseClient';

/**
 * Store indents — the IP Pharmacy / ward sub-store asks the MAIN pharmacy for
 * stock, and the main pharmacy dispatches it.
 *
 *   ordered → dispatched (or partial, on short supply) → received
 *
 * Both ends of the flow read this service: the IPD Stores page raises and
 * tracks indents, the OPD Pharmacy module gets the notification and dispatches.
 *
 * The store tables are not in the hand-written `Database` type, so queries go
 * through an untyped view of the same singleton client.
 */
function db(): SupabaseClient {
  if (!rawClient) throw new Error('Supabase client not initialized');
  return rawClient as unknown as SupabaseClient;
}

export type StoreIndentStatus = 'ordered' | 'partial' | 'dispatched' | 'received' | 'cancelled';
export type StoreIndentPriority = 'routine' | 'urgent' | 'stat';

export interface StoreIndentItem {
  id: string;
  indent_id: string;
  medicine_id: string;
  requested_qty: number;
  dispatched_qty: number;
  remarks: string | null;
  medicine?: { id: string; name: string; strength: string | null; current_stock: number } | null;
}

export interface StoreIndent {
  id: string;
  clinic_id: string;
  indent_no: string;
  store_id: string;
  status: StoreIndentStatus;
  priority: StoreIndentPriority;
  notes: string | null;
  requested_by: string | null;
  requested_at: string;
  pharmacy_seen_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  dispatch_remarks: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  store?: { id: string; name: string; code: string } | null;
  requester?: { id: string; name: string | null } | null;
  dispatcher?: { id: string; name: string | null } | null;
  items?: StoreIndentItem[];
}

export interface IndentLineInput {
  medicineId: string;
  quantity: number;
  remarks?: string;
}

/** Statuses the pharmacy still has work to do on */
export const OPEN_FOR_PHARMACY: StoreIndentStatus[] = ['ordered', 'partial'];
/** Statuses the requesting store is still waiting on / must acknowledge */
export const OPEN_FOR_STORE: StoreIndentStatus[] = ['ordered', 'partial', 'dispatched'];

export const INDENT_STATUS_LABEL: Record<StoreIndentStatus, string> = {
  ordered: 'Ordered',
  partial: 'Partly dispatched',
  dispatched: 'Dispatched',
  received: 'Received',
  cancelled: 'Cancelled',
};

/** Tailwind chip classes so both modules badge a status identically */
export const INDENT_STATUS_CLASS: Record<StoreIndentStatus, string> = {
  ordered: 'bg-amber-100 text-amber-800',
  partial: 'bg-sky-100 text-sky-800',
  dispatched: 'bg-emerald-100 text-emerald-800',
  received: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};

export const INDENT_PRIORITY_CLASS: Record<StoreIndentPriority, string> = {
  routine: 'bg-slate-100 text-slate-600',
  urgent: 'bg-orange-100 text-orange-700',
  stat: 'bg-red-100 text-red-700',
};

const INDENT_SELECT = `
  *,
  store:ipd_stores(id, name, code),
  requester:profiles!store_indents_requested_by_fkey(id, name),
  dispatcher:profiles!store_indents_dispatched_by_fkey(id, name),
  items:store_indent_items(
    id, indent_id, medicine_id, requested_qty, dispatched_qty, remarks,
    medicine:medicines_master(id, name, strength, current_stock)
  )
`;

export const storeIndentService = {
  /** Indents for a clinic, newest first. Filter by status and/or store. */
  async list(
    clinicId: string,
    opts: { statuses?: StoreIndentStatus[]; storeId?: string; limit?: number } = {}
  ): Promise<StoreIndent[]> {
    let query = db()
      .from('store_indents')
      .select(INDENT_SELECT)
      .eq('clinic_id', clinicId);

    if (opts.statuses && opts.statuses.length > 0) query = query.in('status', opts.statuses);
    if (opts.storeId) query = query.eq('store_id', opts.storeId);

    const { data, error } = await query
      .order('requested_at', { ascending: false })
      .limit(opts.limit ?? 50);
    if (error) throw error;
    return (data ?? []) as unknown as StoreIndent[];
  },

  async get(indentId: string): Promise<StoreIndent | null> {
    const { data, error } = await db()
      .from('store_indents')
      .select(INDENT_SELECT)
      .eq('id', indentId)
      .maybeSingle();
    if (error) throw error;
    return (data as unknown as StoreIndent) ?? null;
  },

  /**
   * What the pharmacy bell shows: how many indents are waiting on the
   * pharmacy, and how many of those it has never opened.
   */
  async pharmacyNotificationCounts(
    clinicId: string
  ): Promise<{ waiting: number; unseen: number }> {
    const [waiting, unseen] = await Promise.all([
      db()
        .from('store_indents')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .in('status', OPEN_FOR_PHARMACY),
      db()
        .from('store_indents')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('status', 'ordered')
        .is('pharmacy_seen_at', null),
    ]);
    if (waiting.error) throw waiting.error;
    if (unseen.error) throw unseen.error;
    return { waiting: waiting.count ?? 0, unseen: unseen.count ?? 0 };
  },

  /** Clears the "new" dot on the pharmacy bell. */
  async markSeen(clinicId: string): Promise<void> {
    const { error } = await db().rpc('mark_store_indents_seen', { p_clinic_id: clinicId });
    if (error) throw error;
  },

  /** Raise an indent from a sub-store to the main pharmacy. Returns its id. */
  async create(params: {
    clinicId: string;
    storeId: string;
    lines: IndentLineInput[];
    priority?: StoreIndentPriority;
    notes?: string;
    userId?: string;
  }): Promise<string> {
    const items = params.lines
      .filter((l) => l.medicineId && l.quantity > 0)
      .map((l) => ({
        medicine_id: l.medicineId,
        quantity: Math.round(l.quantity),
        remarks: l.remarks ?? null,
      }));
    if (items.length === 0) throw new Error('Add at least one medicine with a quantity');

    const { data, error } = await db().rpc('create_store_indent', {
      p_clinic_id: params.clinicId,
      p_store_id: params.storeId,
      p_items: items,
      p_priority: params.priority ?? 'routine',
      p_notes: params.notes ?? null,
      p_user_id: params.userId ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  /**
   * Dispatch from the main pharmacy pool. `lines` carries what is being sent
   * NOW, so a short supply can be topped up by dispatching against the same
   * indent again.
   */
  async dispatch(params: {
    indentId: string;
    lines: Array<{ itemId: string; quantity: number }>;
    userId?: string;
    remarks?: string;
  }): Promise<void> {
    const lines = params.lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ item_id: l.itemId, quantity: Math.round(l.quantity) }));
    if (lines.length === 0) throw new Error('Enter a quantity on at least one line');

    const { error } = await db().rpc('dispatch_store_indent', {
      p_indent_id: params.indentId,
      p_lines: lines,
      p_user_id: params.userId ?? null,
      p_remarks: params.remarks ?? null,
    });
    if (error) throw error;
  },

  /** The requesting store confirms the stock physically arrived. */
  async markReceived(indentId: string, userId?: string): Promise<void> {
    const { error } = await db().rpc('receive_store_indent', {
      p_indent_id: indentId,
      p_user_id: userId ?? null,
    });
    if (error) throw error;
  },

  async cancel(indentId: string, reason?: string, userId?: string): Promise<void> {
    const { error } = await db().rpc('cancel_store_indent', {
      p_indent_id: indentId,
      p_reason: reason ?? null,
      p_user_id: userId ?? null,
    });
    if (error) throw error;
  },

  /**
   * Live updates on this clinic's indents — the pharmacy bell lights up the
   * moment a ward orders, and the ward sees "Dispatched" without a refresh.
   * Returns an unsubscribe function.
   */
  subscribe(clinicId: string, onChange: () => void): () => void {
    const client = rawClient;
    if (!client) return () => undefined;

    const channel = client
      .channel(`store-indents-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_indents', filter: `clinic_id=eq.${clinicId}` },
        () => onChange()
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  },
};

/** Total requested vs total sent — drives the "3 of 5 items sent" line. */
export function indentTotals(indent: StoreIndent): {
  lines: number;
  requested: number;
  dispatched: number;
  pending: number;
} {
  const items = indent.items ?? [];
  const requested = items.reduce((s, i) => s + i.requested_qty, 0);
  const dispatched = items.reduce((s, i) => s + i.dispatched_qty, 0);
  return { lines: items.length, requested, dispatched, pending: requested - dispatched };
}
