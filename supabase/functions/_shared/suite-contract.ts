// Pure validation shared by the admin handler and its security tests.
export const PRODUCTS = ['opd', 'growth', 'whatsapp', 'workforce'] as const;
export const CONTRACT = 'suite.access.v1';
export const INITIAL_ADMIN_EMAIL = 'ajpriyadarshi@gmail.com';
export class SuiteError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SuiteError('Expected a JSON object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new SuiteError(`Invalid ${field}.`);
  return value.trim();
}
export function uuid(value: unknown, field: string): string {
  const result = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new SuiteError(`Invalid ${field}.`);
  return result.toLowerCase();
}
function choice(value: unknown, field: string, choices: readonly string[]): string {
  const result = text(value, field);
  if (!choices.includes(result)) throw new SuiteError(`Invalid ${field}.`);
  return result;
}
function email(value: unknown): string {
  const result = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new SuiteError('Enter a valid email.');
  return result;
}
function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new SuiteError(`Invalid ${field}.`);
  return value;
}
export function isPlatformAdmin(user: { id: string; email?: string; email_confirmed_at?: string | null }, configuredId?: string): boolean {
  if (!user.email_confirmed_at) return false;
  // A configured UUID replaces (rather than supplements) the bootstrap email.
  if (configuredId) return user.id.toLowerCase() === configuredId.trim().toLowerCase();
  return user.email?.trim().toLowerCase() === INITIAL_ADMIN_EMAIL;
}

export function parseCommand(raw: unknown): { action: string; payload: Record<string, unknown>; requestId?: string } {
  const input = object(raw);
  const action = text(input.action, 'action', 40);
  const payload: Record<string, unknown> = {};
  if (action === 'overview') {
    payload.search = input.search === undefined || input.search === '' ? '' : text(input.search, 'search');
    payload.offset = input.offset === undefined ? 0 : integer(input.offset, 'offset', 0, 1_000_000);
  } else if (action === 'check_connection') {
    payload.component = choice(input.component, 'component', [...PRODUCTS, 'legacy_whatsapp']);
  } else if (action === 'detail' || action === 'sync_product' || action === 'messaging_detail' || action === 'identity_detail') {
    payload.organization_id = uuid(input.organization_id, 'organisation ID');
    if (action === 'sync_product') payload.product_code = choice(input.product_code, 'product', PRODUCTS);
  } else {
    const requestId = uuid(input.request_id, 'request ID');
    if (!['create_organization', 'publish_price'].includes(action)) payload.organization_id = uuid(input.organization_id, 'organisation ID');
    if (['set_status', 'extend_trial', 'set_member_status', 'link_tenant', 'grant_access', 'revoke_grant', 'save_messaging_route', 'set_messaging_route', 'record_payment', 'void_payment', 'link_product_identity'].includes(action)) {
      payload.reason = text(input.reason, 'reason', 1000);
      if ((payload.reason as string).length < 5) throw new SuiteError('Please give a reason of at least five characters.');
    }
    switch (action) {
      case 'link_product_identity':
        payload.product_code = choice(input.product_code, 'product', PRODUCTS);
        payload.member_id = uuid(input.member_id, 'member ID');
        payload.local_user_id = text(input.local_user_id, 'local product user ID', 200);
        if (!/^[a-zA-Z0-9_-]+$/.test(String(payload.local_user_id))) throw new SuiteError('Invalid local user ID.');
        break;
      case 'revoke_grant': payload.grant_id = uuid(input.grant_id, 'grant ID'); break;
      case 'void_payment': payload.payment_id = uuid(input.payment_id, 'payment ID'); break;
      case 'record_payment': {
        payload.amount_minor = integer(input.amount_minor, 'amount in paise', 1, 1_000_000_000);
        payload.reference = text(input.reference, 'payment reference', 160);
        const expiry = text(input.ends_at, 'expiry', 40);
        if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(expiry) || !Number.isFinite(Date.parse(expiry))) throw new SuiteError('Expiry must include a timezone.');
        payload.ends_at = new Date(expiry).toISOString();
        break;
      }
      case 'set_messaging_route':
        payload.route_id = uuid(input.route_id, 'route ID');
        payload.version = integer(input.version, 'route version', 1, 2147483647);
        if (typeof input.enabled !== 'boolean') throw new SuiteError('Enabled must be a boolean.');
        payload.enabled = input.enabled;
        break;
      case 'save_messaging_route': {
        const product = choice(input.product_code, 'product', PRODUCTS);
        payload.product_code = product;
        payload.purpose = choice(input.purpose, 'messaging purpose', {
          opd: ['opd.reminders'], growth: ['growth.review_requests'], whatsapp: ['whatsapp.campaigns'],
          workforce: ['workforce.notifications', 'workforce.hr_bot'],
        }[product]!);
        for (const field of ['source_user_id', 'sender_user_id']) {
          payload[field] = text(input[field], field, 200);
          if (!/^[a-zA-Z0-9_-]+$/.test(String(payload[field]))) throw new SuiteError('Invalid local user ID.');
        }
        payload.session_name = text(input.session_name, 'session name', 80);
        if (!/^[a-zA-Z0-9_-]+$/.test(String(payload.session_name))) throw new SuiteError('Invalid session name.');
        break;
      }
      case 'create_organization':
        payload.name = text(input.name, 'organisation name');
        if ((payload.name as string).length < 2) throw new SuiteError('Organisation name is too short.');
        payload.owner_name = text(input.owner_name, 'owner name');
        payload.owner_email = email(input.owner_email);
        payload.plan_code = text(input.plan_code, 'plan code', 60);
        break;
      case 'publish_price':
        payload.plan_code = text(input.plan_code, 'plan code', 60);
        payload.interval = choice(input.interval, 'billing interval', ['month', 'year']);
        payload.amount_minor = integer(input.amount_minor, 'amount in paise', 1, 1_000_000_000);
        break;
      case 'set_status': payload.status = choice(input.status, 'status', ['active', 'suspended']); break;
      case 'start_trial': break;
      case 'extend_trial': payload.days = integer(input.days, 'extension days', 1, 30); break;
      case 'add_member':
        payload.email = email(input.email);
        payload.name = text(input.name, 'member name');
        payload.role = choice(input.role, 'role', ['owner', 'admin', 'member', 'billing']);
        break;
      case 'create_invitation':
      case 'link_member': payload.member_id = uuid(input.member_id, 'member ID'); break;
      case 'set_member_status':
        payload.member_id = uuid(input.member_id, 'member ID');
        payload.status = choice(input.status, 'status', ['active', 'disabled']);
        break;
      case 'link_tenant':
        payload.product_code = choice(input.product_code, 'product', PRODUCTS);
        payload.local_tenant_id = text(input.local_tenant_id, 'local tenant ID', 200);
        break;
      case 'grant_access': {
        payload.product_code = choice(input.product_code, 'product', PRODUCTS);
        const date = text(input.ends_at, 'expiry date', 40);
        if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date))) throw new SuiteError('Expiry must include a timezone.');
        payload.ends_at = new Date(date).toISOString();
        break;
      }
      default: throw new SuiteError('Unsupported admin operation.');
    }
    return { action, payload, requestId };
  }
  return { action, payload };
}

export function validateAdapterResponse(raw: unknown, job: Record<string, unknown>): string {
  const response = object(raw);
  const enforcement = object(response.enforcement);
  if (response.contract !== CONTRACT || response.organization_id !== job.organization_id ||
    response.product_code !== job.product_code || response.version !== job.version ||
    enforcement.server !== true || enforcement.workers !== true ||
    enforcement.expires_at !== true || enforcement.tenant_isolation !== true) {
    throw new SuiteError('Adapter has not confirmed the required tenant and access enforcement contract.', 502);
  }
  const tenant = text(response.local_tenant_id, 'adapter tenant ID', 200);
  if (job.local_tenant_id && job.local_tenant_id !== tenant) throw new SuiteError('Adapter returned a different tenant.', 502);
  return tenant;
}
