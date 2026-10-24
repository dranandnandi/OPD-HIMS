import { inspectConnection } from './suite-connections.ts';
import { object, SuiteError, text } from './suite-contract.ts';
import type { Component } from './suite-connector-core.ts';
import type { SuiteRpc } from './suite-delivery.ts';

export function verifySenderMapping(product: string, sourceValue: unknown, backendValue: unknown, expectedTenant: string) {
  const source = object(sourceValue); const backend = object(backendValue);
  if (source.local_tenant_id !== expectedTenant) throw new SuiteError('Source user does not belong to the linked product tenant.', 409);
  if (!backend.local_tenant_id) throw new SuiteError('Messaging user has no tenant mapping.', 409);
  if (product === 'opd' || product === 'growth') {
    if (!source.local_auth_id || source.local_auth_id !== backend.local_auth_id) throw new SuiteError('Legacy sender Auth identity does not match the source user. Reconcile this mapping before linking.', 409);
  } else if (source.local_user_id !== backend.local_user_id || source.local_tenant_id !== backend.local_tenant_id) {
    throw new SuiteError('Messaging sender ID and organisation must match the source account.', 409);
  }
  return { source_tenant_id: text(source.local_tenant_id, 'source tenant', 200),
    backend_tenant_id: text(backend.local_tenant_id, 'backend tenant', 200) };
}

export async function saveMessagingRoute(rpc: SuiteRpc, actor: string, request: string, input: Record<string, unknown>) {
  // Check receipts before external reads: retries must survive changed bindings/outages.
  const prior = await rpc('suite_operation_receipt', { p_actor: actor, p_request: request, p_action: 'save_messaging_route', p_input: input });
  if (prior) return prior;
  const detail = object(await rpc('suite_detail', { p_id: input.organization_id }));
  const binding = Array.isArray(detail.bindings) ? detail.bindings.map(object).find(b => b.product_code === input.product_code) : undefined;
  if (!binding?.local_tenant_id) throw new SuiteError('Link the existing product tenant before mapping its sender.', 409);
  const component = String(input.product_code) as Component;
  const backend: Component = component === 'opd' || component === 'growth' ? 'legacy_whatsapp' : 'whatsapp';
  const [sourceResult, backendResult] = await Promise.all([
    inspectConnection(component, String(input.source_user_id)), inspectConnection(backend, String(input.sender_user_id)),
  ]);
  if (!sourceResult.identity || !backendResult.identity) throw new SuiteError('An exact source or messaging user ID was not found.', 409);
  const source = object(sourceResult.identity); const sender = object(backendResult.identity);
  if (source.local_user_id !== input.source_user_id || sender.local_user_id !== input.sender_user_id) throw new SuiteError('Connector returned a different identity.', 502);
  const mapping = verifySenderMapping(component, source, sender, String(binding.local_tenant_id));
  for (const [name, value] of [[component, sourceResult], [backend, backendResult]] as const) {
    await rpc('suite_record_connection', { p_component: name, p_instance: value.instance_id, p_environment: value.environment, p_actor: actor });
  }
  return rpc('suite_operate', { p_actor: actor, p_request: request, p_action: 'save_messaging_route', p_payload: {
    ...input, ...mapping, command: input, binding_version: binding.version,
    source_instance_id: sourceResult.instance_id, backend_instance_id: backendResult.instance_id,
  } });
}
