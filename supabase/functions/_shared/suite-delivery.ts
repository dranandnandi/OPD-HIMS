import { object, SuiteError, uuid, validateAdapterResponse } from './suite-contract.ts';
import {dependencyConfigured,deliverDependency} from './suite-dependencies.ts';

export type SuiteRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export const adapterConfig = (product: string) => ({
  url: Deno.env.get(`SUITE_${product.toUpperCase()}_ADAPTER_URL`),
  token: Deno.env.get(`SUITE_${product.toUpperCase()}_ADAPTER_TOKEN`),
  instance: Deno.env.get(`SUITE_${product.toUpperCase()}_INSTANCE_ID`),
  environment: Deno.env.get('SUITE_ENVIRONMENT'),
});
export function adapterConfigured(product: string): boolean {
  const config = adapterConfig(product);
  if (!config.url || !config.token || config.token.length < 32 || !config.instance || !['production','staging'].includes(config.environment || '')) return false;
  try {
    uuid(config.instance, 'configured product instance');
    const url = new URL(config.url);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && dependencyConfigured(product);
  } catch { return false; }
}

// Shared by audited manual sync and the scheduled worker. Neither path can
// bypass adapter enforcement acknowledgement or acknowledge a stale lease.
export async function deliverProduct(rpc: SuiteRpc, actor: string, organization: string, product: string) {
  const config = adapterConfig(product);
  if (!config.url || !config.token || config.token.length < 32) throw new SuiteError('This product adapter is not configured.', 409);
  if (!config.instance || !['production', 'staging'].includes(config.environment || '')) throw new SuiteError('Product deployment identity is not configured.', 503);
  if(!dependencyConfigured(product))throw new SuiteError('The messaging dependency is not configured.',409);
  const instance = uuid(config.instance, 'configured product instance');
  let target: URL;
  try { target = new URL(config.url); } catch { throw new SuiteError('Invalid adapter URL configuration.', 503); }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || target.search) throw new SuiteError('Adapter must use an HTTPS endpoint without credentials or query parameters.', 503);
  const claimed = await rpc('suite_claim_job', { p_org: organization, p_product: product });
  if (!claimed) return { success: true, already_synced: true };
  const job = object(claimed);
  try {
    const response = await fetch(target, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': String(job.job_id) },
      body: JSON.stringify({ ...job, target_instance_id: instance, environment: config.environment }),
    });
    if (!response.ok) throw new SuiteError(`Product adapter rejected synchronisation (HTTP ${response.status}).`, 502);
    const body = await response.text();
    if (body.length > 262144) throw new SuiteError('Adapter response is too large.', 502);
    const result = object(JSON.parse(body));
    const tenant = validateAdapterResponse(result, job);
    if (result.identities !== undefined) {
      const recorded = await rpc('suite_note_provisioning', { p_job: job.job_id, p_lease: job.lease_id, p_actor: actor, p_instance: instance, p_tenant: tenant, p_identities: result.identities });
      if (!recorded) throw new SuiteError('Provisioning lease or product version changed. Retry to reconcile safely.',409);
    }
    await deliverDependency(rpc,actor,job,tenant,result.identities,config.environment!);
    const completed = await rpc('suite_finish_job', { p_job: job.job_id, p_lease: job.lease_id, p_actor: actor, p_tenant: tenant });
    if (!completed) throw new SuiteError('The job lease expired. Retry to reconcile product status.', 409);
    return { success: true };
  } catch (cause) {
    const message = cause instanceof SuiteError ? cause.message : 'Product synchronisation failed or timed out. Retry safely to reconcile its state.';
    await rpc('suite_finish_job', { p_job: job.job_id, p_lease: job.lease_id, p_actor: actor, p_error: message });
    throw new SuiteError(message, 502);
  }
}
