import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, Clock3, Layers3, LogOut, Plus, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react';
import { api, client, type Detail, type Organization, type Overview, type Plan } from './api';
import Connections from './Connections';
import OrganizationOperations from './OrganizationOperations';
import ProductIdentities from './ProductIdentities';

const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : 'Not started';
const label = (value: string) => value.replaceAll('_', ' ');
type Field = { name: string; label: string; type?: string; options?: { value: string; label: string }[]; value?: string; min?: string; max?: string; step?: string };
export type Dialog = { title: string; action: string; base?: Record<string, unknown>; fields: Field[]; note?: string };
const reason: Field = { name: 'reason', label: 'Reason for this change', type: 'text' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'organizations' | 'plans' | 'connections'>('organizations');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invitationLink, setInvitationLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const retries = useRef(new Map<string, string>());
  const principal = useRef<string | null>(null);
  const detailRequest = useRef(0);
  const listRequest = useRef(0);

  useEffect(() => {
    if (!client) { setAuthReady(true); return; }
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      const id = next?.user.id || null;
      if (principal.current !== id) {
        principal.current = id;
        setOverview(null); setDetail(null); setSelected(null); setDialog(null);
        setNotice(''); setError(''); setInvitationLink(''); retries.current.clear();
        detailRequest.current++; listRequest.current++;
      }
      setSession(next); setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadList = useCallback(async () => {
    const who = principal.current;
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const result = await api<Overview>('overview', { search: query, offset });
      if (principal.current === who && request === listRequest.current) setOverview(result);
    } finally { if (request === listRequest.current) setLoading(false); }
  }, [query, offset]);
  const loadDetail = async (id: string) => {
    const who = principal.current;
    const request = ++detailRequest.current;
    const result = await api<Detail>('detail', { organization_id: id });
    if (principal.current === who && request === detailRequest.current) setDetail(result);
  };
  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    void loadList().catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
    // A token refresh should not reload or reset an in-progress form.
  }, [session?.user.id, loadList]);

  const refresh = async () => {
    setError('');
    try { await Promise.all([loadList(), ...(selected ? [loadDetail(selected)] : [])]); }
    catch (e) { setError(message(e)); }
  };
  const openOrg = async (id: string) => {
    setSelected(id); setDetail(null); setError('');
    try { await loadDetail(id); } catch (e) { setError(message(e)); }
  };
  const mutate = async (action: string, values: Record<string, unknown>) => {
    if (busy) return;
    const who = principal.current;
    const signature = JSON.stringify({ action, values });
    const requestId = retries.current.get(signature) || crypto.randomUUID();
    retries.current.set(signature, requestId);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ organization_id?: string; invitation_url?: string }>(action, { ...values, request_id: requestId });
      if (principal.current !== who) return;
      retries.current.delete(signature);
      if (result.invitation_url) setInvitationLink(result.invitation_url);
      setDialog(null);
      setNotice(action === 'create_invitation' ? 'Invitation created. Share the link with the invited person; no email was sent.' : action === 'sync_product' ? 'Product synchronisation completed.' : 'Saved. Product changes remain pending until synchronisation completes.');
      await loadList();
      const id = action === 'create_organization' ? result.organization_id : selected;
      if (id) { setSelected(id); await loadDetail(id); }
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const orgDialog = (title: string, action: string, fields: Field[], base: Record<string, unknown> = {}, note?: string) => {
    setError('');
    setDialog({ title, action, fields, base: { organization_id: selected, ...base }, note });
  };
  const newOrganization = () => setDialog({ title: 'Create organisation', action: 'create_organization', fields: [
    { name: 'name', label: 'Organisation name' }, { name: 'owner_name', label: 'Owner’s full name' },
    { name: 'owner_email', label: 'Owner’s email', type: 'email' },
    { name: 'plan_code', label: 'Product plan', value: 'doctor_complete', options: overview?.plans.map(p => ({ value: p.code, label: p.name })) },
  ], note: 'Creates the central account and queues product setup. A seven-day trial begins only after all products are ready and you activate it. An owner without a verified OPD login remains pending.' });

  if (!authReady) return <div className="loading-screen">Opening Suite Admin…</div>;
  if (!session) return <Login busy={busy} error={error} setError={setError} setBusy={setBusy} />;
  const organization = detail?.organization;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Layers3 size={23} /></span><div>Doctor Suite<small>ADMINISTRATION</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${tab === 'organizations' ? 'active' : ''}`} onClick={() => { setTab('organizations'); setSelected(null); }}><Building2 size={18} /> Organisations <ChevronRight size={15} /></button>
      <button className={`nav-item ${tab === 'plans' ? 'active' : ''}`} onClick={() => { setTab('plans'); setSelected(null); }}><Layers3 size={18} /> Plans & pricing <ChevronRight size={15} /></button>
      <button className={`nav-item ${tab === 'connections' ? 'active' : ''}`} onClick={() => { setTab('connections'); setSelected(null); }}><RefreshCw size={18} /> Connections <ChevronRight size={15} /></button>
      <div className="sidebar-note"><ShieldCheck size={20} /><strong>One place to manage the suite</strong><p>Organisations, people and product access across your four apps.</p></div>
      <div className="account"><span className="avatar">{session.user.email?.slice(0, 1).toUpperCase()}</span><div><strong>Suite administrator</strong><small>{session.user.email}</small></div></div>
      <button className="signout" onClick={() => void client?.auth.signOut().then(({ error: e }) => { if (e) setError(e.message); })}><LogOut size={16} /> Sign out</button>
    </aside>
    <main>
      <header className="topbar"><span>Platform / {tab === 'plans' ? 'Plans & pricing' : tab === 'connections' ? 'Connections' : 'Organisations'}</span><span className="secure-label"><ShieldCheck size={14} /> Restricted administration</span></header>
      <div className="content">
        {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="alert success" role="status"><Check size={16} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {invitationLink && <section className="panel"><h2>Share invitation</h2><p>This link expires in seven days and requires the invited person's verified email.</p><label className="field">Invitation link<input readOnly value={invitationLink} onFocus={e => e.currentTarget.select()} /></label><div className="actions"><button className="secondary" onClick={() => void navigator.clipboard.writeText(invitationLink).then(() => setNotice('Invitation link copied.')).catch(() => setError('Select and copy the invitation link manually.'))}>Copy link</button><button className="text-button" onClick={() => setInvitationLink('')}>Close</button></div></section>}
        {!overview ? <section className="panel empty"><ShieldCheck size={30} /><h2>{loading ? 'Verifying administrator access…' : 'Admin service unavailable'}</h2><p>{loading ? 'Your access is checked by the server.' : 'Check the message above, then retry. No organisation data is shown until access is verified.'}</p><button className="secondary" onClick={() => void refresh()} disabled={loading}>Retry connection</button></section>
          : tab === 'connections' ? <Connections connectors={overview.connectors} /> : tab === 'plans' ? <>
            <PageTitle eyebrow="PRODUCT CATALOGUE" title="One suite. Flexible plans." description="Standalone products and a complete bundle, priced in one place." />
            <div className="alert info">New prices apply to future purchases. Publishing a price does not charge customers or change existing access.</div>
            <div className="plan-grid">{overview.plans.map(plan => <PlanCard key={plan.code} plan={plan} overview={overview} onPrice={() => setDialog({ title: `Price · ${plan.name}`, action: 'publish_price', base: { plan_code: plan.code }, fields: [
              { name: 'interval', label: 'Billing interval', options: [{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Annual' }] },
              { name: 'amount_rupees', label: 'Price in INR', type: 'number', min: '0.01', max: '10000000', step: '0.01' },
            ], note: 'Stores a new price version. Existing price records remain available for audit. Checkout is not enabled by this action.' })} />)}</div>
          </> : selected ? <>
            <button className="back" onClick={() => { setSelected(null); setDetail(null); detailRequest.current++; }}><ArrowLeft size={16} /> All organisations</button>
            {!detail || !organization ? <div className="panel empty">Loading organisation…</div> : <>
              <div className="page-title"><div><div className="eyebrow">ORGANISATION</div><h1>{organization.name}</h1><p>{organization.owner_email} <span className="dot">·</span> {overview.plans.find(p => p.code === organization.plan_code)?.name}</p></div><div className="actions"><Badge value={organization.status} /><button className="icon-button" aria-label="Refresh organisation" onClick={() => void refresh()}><RefreshCw size={17} /></button></div></div>
              <div className="detail-grid">
                <section className="panel"><div className="panel-title"><Clock3 size={18} /><h2>Trial & access</h2><Badge value={organization.trial_status} /></div><p className="muted">Trial expiry · India time</p><div className="expiry">{date(organization.trial_ends_at)}</div><p className="muted">{organization.ready_count} of {organization.product_count} products have confirmed setup. Access dates are enforced by each connected app.</p>
                  <div className="actions wrap">
                    {!organization.trial_started_at ? <button className="primary" disabled={busy || organization.ready_count !== organization.product_count || organization.status !== 'active'} onClick={() => orgDialog('Activate seven-day trial', 'start_trial', [], {}, 'The trial starts now and ends exactly 168 hours later. This organisation must have a verified owner and every product must be ready.')}>Start 7-day trial</button>
                      : <button className="secondary" onClick={() => orgDialog('Extend trial', 'extend_trial', [{ name: 'days', label: 'Additional days', type: 'number', min: '1', max: '30', value: '7' }, reason])}>Extend trial</button>}
                    <button className="secondary" onClick={() => orgDialog(organization.status === 'active' ? 'Suspend organisation' : 'Reactivate organisation', 'set_status', [reason], { status: organization.status === 'active' ? 'suspended' : 'active' }, 'This records the access decision centrally and queues synchronisation. Existing apps change access only after their integration receives it.')}>{organization.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                  </div>
                </section>
                <section className="panel"><div className="panel-title"><ShieldCheck size={18} /><h2>Access grants</h2></div><p className="muted">Dated access from recorded payments and manual exceptions. Payment records appear below.</p>
                  {detail.grants.length ? <ul className="grant-list">{detail.grants.map(g => <li key={g.id}><strong>{overview.products.find(p => p.code === g.product_code)?.name}</strong><span>Until {date(g.ends_at)}</span><small>{g.reason}</small>{g.revoked_at ? <span className="badge suspended">Revoked</span> : <button className="text-button" disabled={busy || detail.payments === undefined} onClick={() => orgDialog('Revoke access grant', 'revoke_grant', [reason], { grant_id: g.id }, 'This revokes only this grant. Other valid grants or an active trial may still permit access.')}>Revoke</button>}</li>)}</ul> : <p className="quiet">No access grants.</p>}
                  <button className="secondary" onClick={() => orgDialog('Grant temporary access', 'grant_access', [
                    { name: 'product_code', label: 'Product', options: detail.bindings.map(b => ({ value: b.product_code, label: overview.products.find(p => p.code === b.product_code)?.name || b.product_code })) },
                    { name: 'ends_at', label: 'Expires at (your device’s local time)', type: 'datetime-local' }, reason,
                  ])}>Add access grant</button>
                </section>
              </div>
              <section className="panel"><div className="panel-title"><Layers3 size={18} /><h2>Connected products</h2></div><div className="product-list">{detail.bindings.map(b => <div key={b.product_code} className="product-row"><div className="product-icon">{b.product_code.slice(0, 2).toUpperCase()}</div><div className="product-description"><strong>{overview.products.find(p => p.code === b.product_code)?.name}</strong><small>{b.local_tenant_id ? `Linked account: ${b.local_tenant_id}` : 'Awaiting product setup'}</small>{b.last_error && <small className="inline-error">{b.last_error}</small>}{!overview.adapters[b.product_code] && <small>Integration is not configured. Existing product access is unchanged.</small>}</div><Badge value={b.state} /><div className="actions">{!b.local_tenant_id && <button className="secondary small" disabled={busy} onClick={() => orgDialog('Link an existing product account', 'link_tenant', [{ name: 'local_tenant_id', label: 'Existing tenant/account ID' }, reason], { product_code: b.product_code }, 'This records a mapping for review. It does not mark the product ready or alter its data; the adapter must verify ownership and access enforcement.')}>Link account</button>}<button className="secondary small" disabled={busy || !overview.adapters[b.product_code]} onClick={() => void mutate('sync_product', { organization_id: selected, product_code: b.product_code })}><RefreshCw size={14} /> Sync</button></div></div>)}</div></section>
              <OrganizationOperations key={organization.id} detail={detail} busy={busy} open={next => setDialog({ ...next, base: { organization_id: selected, ...next.base } })} />
              <ProductIdentities key={`identities:${organization.id}`} detail={detail} busy={busy} open={setDialog} />
              <section className="panel"><div className="panel-title"><Users size={18} /><h2>People</h2><button className="secondary small push-right" onClick={() => orgDialog('Add a member', 'add_member', [{ name: 'name', label: 'Full name' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'role', label: 'Organisation role', options: ['owner', 'admin', 'member', 'billing'].map(r => ({ value: r, label: label(r) })) }], {}, 'Links an existing verified central login if available. Otherwise the person stays pending. Create an invitation link afterwards and share it with them.') }><Plus size={15} /> Add member</button></div>
                <div className="table-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Login status</th><th>Manage</th></tr></thead><tbody>{detail.members.map(m => <tr key={m.id}><td><strong>{m.name}</strong><small>{m.email}</small></td><td className="capitalize">{m.role}</td><td><Badge value={m.status} /></td><td>{m.status === 'pending' ? <><button className="text-button" disabled={busy} onClick={() => void mutate('create_invitation', { organization_id: selected, member_id: m.id })}>Create invitation link</button><button className="text-button" disabled={busy} onClick={() => void mutate('link_member', { organization_id: selected, member_id: m.id })}>Link verified login</button></> : <button className="text-button" onClick={() => orgDialog(m.status === 'active' ? 'Disable membership' : 'Restore membership', 'set_member_status', [reason], { member_id: m.id, status: m.status === 'active' ? 'disabled' : 'active' })}>{m.status === 'active' ? 'Disable' : 'Restore'}</button>}</td></tr>)}</tbody></table></div>
              </section>
              <section className="panel"><div className="panel-title"><Clock3 size={18} /><h2>Recent activity</h2><span className="muted">Latest 50 events</span></div><div className="audit-list">{detail.audit.map(a => <div key={a.id}><span className="audit-dot" /><div><strong className="capitalize">{label(a.action)}</strong>{a.reason && <p>{a.reason}</p>}<small>{date(a.created_at)} IST</small></div></div>)}</div></section>
            </>}
          </> : <>
            <PageTitle eyebrow="YOUR CUSTOMER WORKSPACE" title="Organisations" description="Bring every clinic, product and subscription together." action={<button className="primary" onClick={newOrganization}><Plus size={18} /> Create organisation</button>} />
            <div className="stats-grid"><Stat title="Organisations" value={overview.total} caption={query ? 'Matching your search' : 'Across the platform'} /><Stat title="Suite products" value={overview.products.length} caption="One shared administration" /><Stat title="Standard trial" value="7 days" caption="Starts after product setup" /><Stat title="Connected integrations" value={`${Object.values(overview.adapters).filter(Boolean).length} / 4`} caption="Configured server connections" /></div>
            <section className="panel organization-panel"><div className="list-toolbar"><h2>Customer directory</h2><form onSubmit={e => { e.preventDefault(); setOffset(0); setQuery(search); }} className="search"><Search size={17} /><input aria-label="Search organisations" placeholder="Search name or owner email" value={search} onChange={e => setSearch(e.target.value)} /><button type="submit" className="text-button">Search</button></form><button className="icon-button" aria-label="Refresh directory" disabled={loading} onClick={() => void refresh()}><RefreshCw size={17} /></button></div>
              {overview.organizations.length ? <div className="table-scroll"><table><thead><tr><th>Organisation</th><th>Plan</th><th>Products ready</th><th>Trial</th><th>Status</th><th /></tr></thead><tbody>{overview.organizations.map(o => <OrganizationRow key={o.id} organization={o} plans={overview.plans} open={() => void openOrg(o.id)} />)}</tbody></table></div> : <div className="empty"><div className="empty-icon"><Building2 size={28} /></div><h2>{query ? 'No matching organisations' : 'Your first clinic starts here'}</h2><p>{query ? 'Try a different name or email address.' : 'Create an organisation, choose its products, and manage the whole setup from one place.'}</p>{!query && <button className="secondary" onClick={newOrganization}><Plus size={16} /> Create organisation</button>}</div>}
              <div className="pagination"><span>{overview.total ? `${offset + 1}–${Math.min(offset + 50, overview.total)} of ${overview.total}` : '0 organisations'}</span><div className="actions"><button className="secondary small" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><button className="secondary small" disabled={offset + 50 >= overview.total || loading} onClick={() => setOffset(offset + 50)}>Next</button></div></div>
            </section>
            <p className="footnote">Product integration and trial activation are separate steps. Creating an organisation does not change access in existing apps.</p>
          </>}
      </div>
    </main>
    {dialog && <DialogForm dialog={dialog} busy={busy} error={error} close={() => { if (!busy) setDialog(null); }} submit={(values) => void mutate(dialog.action, { ...dialog.base, ...values })} setError={setError} />}
  </div>;
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please retry.'; }
function Badge({ value }: { value: string }) { return <span className={`badge ${value}`}>{label(value)}</span>; }
function Stat({ title, value, caption }: { title: string; value: string | number; caption: string }) { return <div className="stat"><span>{title}</span><strong>{value}</strong><small>{caption}</small></div>; }
function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function OrganizationRow({ organization: o, plans, open }: { organization: Organization; plans: Plan[]; open: () => void }) {
  return <tr><td><button className="org-name" onClick={open}>{o.name}</button><small>{o.owner_email}</small></td><td>{plans.find(p => p.code === o.plan_code)?.name}</td><td>{o.ready_count} / {o.product_count}</td><td><Badge value={o.trial_status} /></td><td><Badge value={o.status} /></td><td><button className="icon-button" aria-label={`Open ${o.name}`} onClick={open}><ArrowRight size={17} /></button></td></tr>;
}
function PlanCard({ plan, overview, onPrice }: { plan: Plan; overview: Overview; onPrice: () => void }) {
  return <section className={`panel plan-card ${plan.code === 'doctor_complete' ? 'featured' : ''}`}><div className="eyebrow">{plan.code === 'doctor_complete' ? 'THE COMPLETE BUNDLE' : 'STANDALONE PRODUCT'}</div><h2>{plan.name}</h2><ul>{plan.products.map(code => <li key={code}><Check size={15} />{overview.products.find(p => p.code === code)?.name}</li>)}</ul><div className="plan-limits">{Object.entries(plan.limits).map(([key, value]) => <span key={key}>{value} {label(key)}</span>)}</div><div className="prices">{plan.prices.length ? plan.prices.map(p => <p key={p.id}><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: p.currency, maximumFractionDigits: 2 }).format(p.amount_minor / 100)}</strong><span> / {p.interval}</span></p>) : <p className="muted">Price not set</p>}</div><button className="secondary" onClick={onPrice}>Publish price</button></section>;
}
function DialogForm({ dialog, busy, error, close, submit, setError }: { dialog: Dialog; busy: boolean; error: string; close: () => void; submit: (values: Record<string, unknown>) => void; setError: (error: string) => void }) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = modal.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={modal} onCancel={e => { e.preventDefault(); close(); }} className="modal"><div className="modal-header"><h2>{dialog.title}</h2><button aria-label="Close dialog" className="icon-button" disabled={busy} onClick={close}><X size={19} /></button></div><form onSubmit={e => {
    e.preventDefault();
    try {
      const values: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget));
      if ('days' in values) values.days = Number(values.days);
      if ('amount_rupees' in values) {
        const amount = String(values.amount_rupees);
        if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('Use a positive rupee amount with at most two decimal places.');
        const [whole, fraction = ''] = amount.split('.');
        values.amount_minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        delete values.amount_rupees;
      }
      if ('ends_at' in values) values.ends_at = new Date(String(values.ends_at)).toISOString();
      submit(values);
    } catch (e) { setError(message(e)); }
  }}>
    {dialog.note && <p className="modal-note">{dialog.note}</p>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {dialog.fields.map(f => <label className="field" key={f.name}>{f.label}{f.options ? <select name={f.name} defaultValue={f.value} required disabled={busy}>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input name={f.name} type={f.type || 'text'} defaultValue={f.value} required maxLength={f.name === 'reason' ? 1000 : 254} min={f.min} max={f.max} step={f.step} disabled={busy} />}</label>)}
    <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Confirm'}</button></div>
  </form></dialog>;
}
function Login({ busy, error, setError, setBusy }: { busy: boolean; error: string; setError: (value: string) => void; setBusy: (value: boolean) => void }) {
  return <div className="login-page"><div className="login-story"><div className="brand"><span className="brand-mark"><Layers3 /></span><div>Doctor Suite<small>ADMINISTRATION</small></div></div><div><div className="eyebrow">ONE WORKSPACE. FOUR PRODUCTS.</div><h1>Care for your<br />whole business.</h1><p>A shared home for your clinics, people and product access.</p><div className="login-products"><span>Clinic Operations</span><span>Clinic Growth</span><span>Communication</span><span>Staff & Tasks</span></div></div><small>Built for the people behind better care.</small></div><div className="login-form-wrap"><form className="login-form" onSubmit={async e => {
    e.preventDefault(); setError('');
    if (!client) { setError('Configure VITE_SUITE_SUPABASE_URL and its publishable key first.'); return; }
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const { error: loginError } = await client.auth.signInWithPassword({ email: String(data.get('email')).trim(), password: String(data.get('password')) });
      if (loginError) throw loginError;
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }}><div className="login-lock"><ShieldCheck size={27} /></div><div className="eyebrow">RESTRICTED ACCESS</div><h2>Welcome back.</h2><p>Sign in with your authorised OPD administrator account.</p>{error && <div className="alert error" role="alert">{error}</div>}<label className="field">Email address<input name="email" type="email" autoComplete="username" required disabled={busy} /></label><label className="field">Password<input name="password" type="password" autoComplete="current-password" required disabled={busy} /></label><button className="primary login-button" disabled={busy || !client}>{busy ? 'Signing in…' : 'Sign in to Suite Admin'}<ArrowRight size={18} /></button><small className="login-caption">Your account is verified on the server before any organisation data is available.</small></form></div></div>;
}

