import { createClient } from 'npm:@supabase/supabase-js@2.51.0';
import { PRODUCTS, object, SuiteError, uuid } from '../_shared/suite-contract.ts';
import { sameSecret } from '../_shared/suite-connector-core.ts';
import { adapterConfigured, deliverProduct, type SuiteRpc } from '../_shared/suite-delivery.ts';

export async function handleSuiteWorker(req: Request): Promise<Response> {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (req.headers.has('Origin')) return reply({ error: 'Server requests only.' }, 403);
  try {
    const expected = Deno.env.get('SUITE_WORKER_TOKEN');
    if (!expected || expected.length < 32) throw new SuiteError('Worker is not configured.', 503);
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token || token.length > 512 || !await sameSecret(token, expected)) throw new SuiteError('Invalid worker credential.', 401);
    // Actor is pinned in server configuration, never accepted from the request.
    const actor = uuid(Deno.env.get('PLATFORM_SUPER_ADMIN_USER_ID'), 'configured administrator');
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new SuiteError('Platform is not configured.', 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rpc: SuiteRpc = async (name, args) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new SuiteError('Worker database operation failed.', error.code === 'P0001' ? 409 : 503);
      return data;
    };
    const configured = PRODUCTS.filter(adapterConfigured);
    if (!configured.length) return reply({ processed: 0, succeeded: 0, failed: 0, message: 'No product adapters configured.' });
    const candidates = await rpc('suite_pending_jobs', { p_products: configured, p_limit: 4 });
    if (!Array.isArray(candidates)) throw new SuiteError('Invalid queue response.', 503);
    const results = await Promise.all(candidates.map(async value => {
      const row = object(value);
      const org = uuid(row.organization_id, 'organisation'); const product = String(row.product_code);
      if (!configured.includes(product as typeof PRODUCTS[number])) throw new SuiteError('Invalid queued product.', 503);
      try { await deliverProduct(rpc, actor, org, product); return { organization_id: org, product_code: product, success: true }; }
      catch (error) { return { organization_id: org, product_code: product, success: false, retryable: true,
        error: error instanceof SuiteError ? error.message : 'Delivery unavailable.' }; }
    }));
    return reply({ processed: results.length, succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length, results });
  } catch (error) { return reply({ error: error instanceof SuiteError ? error.message : 'Worker unavailable.' }, error instanceof SuiteError ? error.status : 500); }
}
if (import.meta.main) Deno.serve(handleSuiteWorker);
