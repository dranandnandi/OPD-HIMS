import { COMPONENTS, CONNECTION_CONTRACT, type Component } from './suite-connector-core.ts';
import { SuiteError, object } from './suite-contract.ts';

export function connectorConfig(component: Component) {
  const prefix = `SUITE_${component.toUpperCase()}`;
  return { url: Deno.env.get(`${prefix}_CONNECTOR_URL`), token: Deno.env.get(`${prefix}_CONNECTOR_TOKEN`),
    instanceId: Deno.env.get(`${prefix}_INSTANCE_ID`), environment: Deno.env.get('SUITE_ENVIRONMENT') };
}
export function connectorSummary() {
  return COMPONENTS.map(component => {
    const c = connectorConfig(component);
    return { component, configured: Boolean(c.url && c.token && c.instanceId && c.environment) };
  });
}
export async function inspectConnection(component: Component, localUserId?: string) {
  const c = connectorConfig(component);
  if (!c.url || !c.token || c.token.length < 32 || !c.instanceId || !['production', 'staging'].includes(c.environment || '')) {
    throw new SuiteError('Set this connector URL, token, instance ID and environment on the central server first.', 409);
  }
  let url: URL;
  try { url = new URL(c.url); } catch { throw new SuiteError('Connector URL is invalid.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new SuiteError('Connector requires an HTTPS URL without credentials, fragments or query parameters.', 503);
  const challenge = crypto.randomUUID();
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract: CONNECTION_CONTRACT, operation: localUserId ? 'identity' : 'health', local_user_id: localUserId, challenge, component,
        instance_id: c.instanceId, environment: c.environment }),
    });
    if (!response.ok) throw new SuiteError(`Connector check failed (HTTP ${response.status}).`, 502);
    const raw = await response.text();
    if (raw.length > 8192) throw new SuiteError('Connector returned an oversized response.', 502);
    const result = object(JSON.parse(raw));
    if (result.contract !== CONNECTION_CONTRACT || result.component !== component || result.instance_id !== c.instanceId ||
        result.environment !== c.environment || result.challenge !== challenge || result.database_available !== true ||
        result.read_only !== true || result.provisioning_ready !== false) throw new SuiteError('Connector identity or connection contract did not match. No account was changed.', 502);
    return result;
  } catch (error) {
    if (error instanceof SuiteError) throw error;
    throw new SuiteError('Connector could not be verified. Check its deployment, credentials and database configuration.', 502);
  }
}
export async function checkConnection(component: Component) {
  const result = await inspectConnection(component);
  return { component, instance_id: result.instance_id, environment: result.environment, connected: true,
    checked_at: new Date().toISOString(), provisioning_ready: false,
    dependencies: component === 'opd' || component === 'growth' ? ['legacy_whatsapp'] : component === 'workforce' ? ['whatsapp'] : [] };
}
