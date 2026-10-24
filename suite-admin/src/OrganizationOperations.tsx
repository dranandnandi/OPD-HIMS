import { useEffect, useState } from 'react';
import { api, type Detail } from './api';
import type { Dialog } from './App';

type Route = { id: string; product_code: string; purpose: string; sender_user_id: string; source_user_id: string;
  session_name: string; enabled: boolean; version: number; identity_checked_at: string };
const purposes: Record<string, string[]> = { opd: ['opd.reminders'], growth: ['growth.review_requests'],
  whatsapp: ['whatsapp.campaigns'], workforce: ['workforce.notifications', 'workforce.hr_bot'] };
const date = (value: string) => new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const reason = { name: 'reason', label: 'Reason / payment notes' };

export default function OrganizationOperations({ detail, busy, open }: { detail: Detail; busy: boolean; open: (dialog: Dialog) => void }) {
  const [routes, setRoutes] = useState<Route[]>([]); const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  const organization = detail.organization.id;
  const version = detail.bindings.map(b => `${b.product_code}:${b.version}`).join(',');
  useEffect(() => {
    let active = true; setLoaded(false); setError('');
    void api<{ routes: Route[] }>('messaging_detail', { organization_id: organization }).then(result => {
      if (active) { setRoutes(result.routes); setLoaded(true); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Messaging mappings could not be loaded.'); });
    return () => { active = false; };
  }, [organization, version]);
  return <>
    <section className="panel"><div className="panel-title"><h2>Manual payments & paid access</h2></div>
      <p className="muted">Record money received outside the app and set access expiry for every product in this organisation’s plan. Suspension and product setup requirements still apply.</p>
      {detail.payments === undefined && <p className="inline-error">The central operations update is required before recording payments.</p>}
      <button className="secondary" disabled={busy || detail.payments === undefined} onClick={() => open({ title: 'Record payment and activate plan', action: 'record_payment',
        note: 'Confirm payment was received. Access starts now and ends at the selected date. This records the payment; it does not charge the customer or restart their trial.',
        fields: [{ name: 'amount_rupees', label: 'Amount received (INR)', type: 'number', min: '0.01', max: '10000000', step: '0.01' },
          { name: 'reference', label: 'Receipt / bank / UPI reference' }, { name: 'ends_at', label: 'Paid access expires (your device’s local time)', type: 'datetime-local' }, reason] })}>Record payment</button>
      {detail.payments?.length ? <div className="table-scroll"><table><thead><tr><th>Payment</th><th>Access expiry</th><th>Status</th><th>Manage</th></tr></thead><tbody>
        {detail.payments.map(p => <tr key={p.id}><td><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: p.currency }).format(p.amount_minor / 100)}</strong><small>{p.reference}</small><small>{date(p.created_at)} IST</small></td>
          <td>{date(p.ends_at)} IST</td><td>{p.voided_at ? 'Voided' : 'Recorded'}</td><td>{!p.voided_at && <button className="text-button" disabled={busy} onClick={() => open({ title: 'Void payment record and revoke its access', action: 'void_payment', base: { payment_id: p.id }, fields: [reason],
            note: 'This revokes only access grants created by this payment. Other valid grants or a trial may still allow access. Any refund must be handled separately.' })}>Void record</button>}</td></tr>)}
      </tbody></table></div> : <p className="quiet">No manual payments recorded.</p>}
    </section>
    <section className="panel"><div className="panel-title"><h2>Messaging sender mappings</h2></div>
      <p className="muted">Verify an existing product user against its messaging account. This saves the intended sender and session; it does not send messages, reconnect a phone or switch existing notification workers.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!loaded && !error && <p className="quiet">Loading mappings…</p>}
      {routes.map(route => <div className="product-row" key={route.id}><div className="product-description"><strong>{route.purpose.replaceAll('_', ' ')}</strong>
        <small>Sender: {route.sender_user_id} · Session: {route.session_name}</small><small>Identity checked {date(route.identity_checked_at)} IST</small></div>
        <span className={`badge ${route.enabled ? 'linked' : 'suspended'}`}>{route.enabled ? 'Mapped' : 'Disabled'}</span>
        <button className="secondary small" disabled={busy} onClick={() => open({ title: route.enabled ? 'Disable messaging purpose' : 'Enable messaging purpose', action: 'set_messaging_route',
          base: { route_id: route.id, version: route.version, enabled: !route.enabled }, fields: [reason],
          note: 'This changes only this product’s messaging permission. It does not disconnect the shared phone session. Existing workers require the suite integration before applying this permission.' })}>{route.enabled ? 'Disable' : 'Enable'}</button>
      </div>)}
      <div className="actions">{detail.bindings.map(binding => {
        const missing = (purposes[binding.product_code] || []).filter(p => !routes.some(r => r.purpose === p));
        return missing.length ? <button key={binding.product_code} className="secondary small" disabled={busy || !loaded || !binding.local_tenant_id} onClick={() => open({
          title: `Verify ${binding.product_code} sender`, action: 'save_messaging_route', base: { product_code: binding.product_code },
          note: 'Use exact existing IDs. OPD/GMB source and backend Auth IDs must match. Task/WhatsApp user and organisation IDs must match. Unmatched legacy accounts need reconciliation; email matches are not sufficient.',
          fields: [{ name: 'purpose', label: 'Messaging purpose', options: missing.map(p => ({ value: p, label: p.replaceAll('_', ' ') })) },
            { name: 'source_user_id', label: 'Product profile / public user ID' }, { name: 'sender_user_id', label: 'Messaging backend user ID' },
            { name: 'session_name', label: 'Existing session name', value: 'default' }, reason],
        })}>Map {binding.product_code} sender</button> : null;
      })}</div>
      <p className="quiet">Link the product tenant first. Sender verification requires both connectors to be deployed and configured.</p>
    </section>
  </>;
}
