import { useState } from 'react';
import { Check, RefreshCw, Server } from 'lucide-react';
import { api, type ConnectorSummary } from './api';

const components = [
  { code: 'opd', name: 'OPD', detail: 'Uses the legacy messaging service for clinic messages.' },
  { code: 'growth', name: 'GMB / Clinic Growth', detail: 'Uses the legacy messaging service for review messages.' },
  { code: 'workforce', name: 'Task Manager', detail: 'Shares the multi-user WhatsApp backend. Notification routing needs separate verification.' },
  { code: 'whatsapp', name: 'WhatsApp multi-user', detail: 'Messaging and automation app; also serves Task Manager.' },
  { code: 'legacy_whatsapp', name: 'OPD & GMB messaging service', detail: 'Preserves existing backend user IDs and connected sessions.' },
];

export default function Connections({ connectors }: { connectors?: ConnectorSummary[] }) {
  const [results, setResults] = useState<Record<string, { error?: string; checked_at?: string }>>({});
  const [pending, setPending] = useState<string | null>(null);
  const check = async (component: string) => {
    if (pending) return;
    setPending(component);
    setResults(previous => ({ ...previous, [component]: {} }));
    try {
      const result = await api<{ checked_at: string }>('check_connection', { component });
      setResults(previous => ({ ...previous, [component]: { checked_at: result.checked_at } }));
    } catch (error) {
      setResults(previous => ({ ...previous, [component]: { error: error instanceof Error ? error.message : 'Connection check failed.' } }));
    } finally { setPending(null); }
  };
  return <>
    <div className="page-title"><div><div className="eyebrow">APP CONNECTIONS</div><h1>Products and messaging services</h1><p>Verify each service before linking existing accounts.</p></div></div>
    <div className="alert info">Checks verify the service identity and database connection. They do not create users, change sessions or activate trials. Product provisioning is a separate step.</div>
    {!connectors && <div className="alert error">The central admin function needs the connector update before these checks are available.</div>}
    <section className="panel"><div className="product-list">{components.map(component => {
      const configured = connectors?.find(c => c.component === component.code)?.configured;
      const result = results[component.code];
      return <div className="product-row" key={component.code}>
        <div className="product-icon"><Server size={20} /></div>
        <div className="product-description"><strong>{component.name}</strong><small>{component.detail}</small>
          {result?.checked_at && <small><Check size={12} /> Verified {new Date(result.checked_at).toLocaleTimeString()} — provisioning is not enabled.</small>}
          {result?.error && <small className="inline-error" role="alert">{result.error}</small>}
          {!configured && <small>Connector deployment and server configuration pending.</small>}
        </div>
        <span className={`badge ${result?.error ? 'failed' : result?.checked_at ? 'ready' : 'pending'}`}>{result?.error ? 'Check failed' : result?.checked_at ? 'Connection verified' : configured ? 'Not checked' : 'Not configured'}</span>
        <button className="secondary small" disabled={!configured || Boolean(pending)} onClick={() => void check(component.code)}><RefreshCw size={14} />{pending === component.code ? 'Checking…' : 'Check connection'}</button>
      </div>;
    })}</div></section>
  </>;
}
