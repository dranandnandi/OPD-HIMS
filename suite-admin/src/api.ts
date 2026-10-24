import { createClient } from '@supabase/supabase-js';

// Intentionally independent of the clinical client, its cache and fallback DB.
const url = import.meta.env.VITE_SUITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUITE_SUPABASE_PUBLISHABLE_KEY;
export const client = url && key ? createClient(url, key, {
  auth: { storageKey: 'doctor-suite-admin-session', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;

export async function api<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  if (!client) throw new Error('Configure the Suite Supabase URL and publishable key before signing in.');
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const response = await fetch(`${url}/functions/v1/suite-admin`, {
    method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...values, action }),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({ error: 'The admin service returned an invalid response.' }));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result as T;
}

export type Product = { code: string; name: string };
export type Plan = { code: string; name: string; products: string[]; limits: Record<string, number>; prices: Price[] };
export type Price = { id: string; interval: 'month' | 'year'; amount_minor: number; currency: string; created_at: string };
export type Organization = { id: string; name: string; owner_email: string; status: string; created_at: string; plan_code: string; trial_started_at: string | null; trial_ends_at: string | null; trial_status: string; ready_count: number; product_count: number };
export type Binding = { product_code: string; state: string; local_tenant_id: string | null; enforcement_version: string | null; last_error: string | null; version: number };
export type Member = { id: string; email: string; name: string; role: string; status: string; auth_user_id: string | null };
export type Audit = { id: number; action: string; reason: string | null; created_at: string; actor_id: string; details: Record<string, unknown> };
export type Grant = { id: string; product_code: string; kind: string; starts_at: string; ends_at: string; reason: string; revoked_at?: string | null; payment_id?: string | null };
export type ManualPayment = { id: string; amount_minor: number; currency: string; reference: string; created_at: string; ends_at: string; reason: string; voided_at: string | null };
export type ConnectorSummary = { component: string; configured: boolean };
export type Overview = { organizations: Organization[]; plans: Plan[]; products: Product[]; adapters: Record<string, boolean>; connectors?: ConnectorSummary[]; server_time: string; total: number };
export type Detail = { organization: Organization; bindings: Binding[]; members: Member[]; audit: Audit[]; grants: Grant[]; payments?: ManualPayment[] };
