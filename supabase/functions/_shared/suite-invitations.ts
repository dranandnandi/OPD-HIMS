import { SuiteError, text } from './suite-contract.ts';
import type { SuiteRpc } from './suite-delivery.ts';
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2, '0')).join('');
export async function invitationHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new SuiteError('Invalid invitation.');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}
export async function createInvitation(rpc: SuiteRpc, actor: string, requestId: string, payload: Record<string, unknown>) {
  const secret = Deno.env.get('SUITE_INVITE_SIGNING_KEY'); const base = Deno.env.get('SUITE_MEMBER_PORTAL_URL');
  if (!secret || secret.length < 32 || !base) throw new SuiteError('Invitation settings are not configured.', 503);
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/join') throw new SuiteError('Member portal must be an HTTPS /join URL.', 503);
  // Deterministic per authorised operation: lost responses can be retried without
  // storing usable invitation tokens in the database, audit log or job payload.
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const token = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify([
    'suite.invitation.v1', actor, requestId, payload.organization_id, payload.member_id,
  ]))));
  const result = await rpc('suite_issue_invitation', { p_actor: actor, p_request: requestId,
    p_org: payload.organization_id, p_member: payload.member_id, p_hash: await invitationHash(token) });
  url.hash = `invite=${token}`;
  return { ...(result as Record<string,unknown>), invitation_url: url.href };
}
export const parseInvitationToken = (value: unknown) => text(value, 'invitation token', 64);
