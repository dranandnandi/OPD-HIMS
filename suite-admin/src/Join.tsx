import { useEffect, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUITE_SUPABASE_PUBLISHABLE_KEY;
// Customer sessions never replace the administrator's session.
const member = url && key ? createClient(url, key, { auth: {
  storageKey: 'doctor-suite-member-session', detectSessionInUrl: true,
  persistSession: true, autoRefreshToken: true,
} }) : null;
const storageKey = 'doctor-suite-pending-invitation';
function readInvitation() {
  const token = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (token) {
    history.replaceState(null, '', '/join');
    if (!/^[a-f0-9]{64}$/.test(token)) return '';
    try { sessionStorage.setItem(storageKey, token); } catch { /* Token stays in memory. */ }
    return token;
  }
  try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; }
}
// Read once, outside React's development double rendering.
const invitation = readInvitation();
export default function Join() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!member) { setReady(true); return; }
    const { data: { subscription } } = member.auth.onAuthStateChange((event, next) => {
      setSession(next); setReady(true);
      if (event === 'SIGNED_OUT') { setAccepted(false); setError(''); }
    });
    return () => subscription.unsubscribe();
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Please retry.'); }
    finally { setBusy(false); }
  };
  return <div className="login-form-wrap" style={{ minHeight: '100vh' }}><section className="login-form">
    <div className="eyebrow">DOCTOR SUITE</div><h2>Join your organisation</h2>
    <p>Use the email address your administrator invited. Product access begins after your administrator completes setup.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!member ? <p>Member sign-in is not configured.</p> : !ready ? <p>Checking sign-in…</p> : accepted ? <p role="status">Your membership is linked. Your administrator can now finish connecting your products.</p> : !invitation ? <p>Open the invitation link shared by your administrator.</p> : session ? <>
      <p>Signed in as <strong>{session.user.email}</strong></p>
      <button className="primary" disabled={busy} onClick={() => void run(async () => {
        const { data: { session: current } } = await member.auth.getSession();
        if (!current) throw new Error('Please sign in again.');
        const response = await fetch(`${url}/functions/v1/suite-member`, {
          method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${current.access_token}`, apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept_invitation', invitation_token: invitation }),
        });
        const result = await response.json();
        if (!response.ok || result.accepted !== true) throw new Error(result.error || 'Unable to accept this invitation.');
        // Ignore an old response if the customer has changed accounts.
        const latest = (await member.auth.getSession()).data.session;
        if (latest?.user.id !== current.user.id) return;
        setAccepted(true); try { sessionStorage.removeItem(storageKey); } catch { /* No persisted token. */ }
      })}>Accept invitation</button>
    </> : <form onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      void run(async () => {
        const credentials = { email: String(data.get('email')).trim(), password: String(data.get('password')) };
        const result = signup ? await member.auth.signUp({ ...credentials, options: { emailRedirectTo: `${location.origin}/join` } }) : await member.auth.signInWithPassword(credentials);
        if (result.error) throw result.error;
        if (signup && !result.data.session) setNotice('Check your email to verify your account, then reopen this invitation link and sign in. If you already have an account, sign in with its password.');
      });
    }}>
      <label className="field">Invited email<input name="email" type="email" required autoComplete="username" disabled={busy} /></label>
      <label className="field">Password<input name="password" type="password" required minLength={signup ? 8 : undefined} autoComplete={signup ? 'new-password' : 'current-password'} disabled={busy} /></label>
      <button className="primary login-button" disabled={busy}>{signup ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setSignup(!signup); setError(''); setNotice(''); }}>{signup ? 'Use an existing account' : 'Create an account with my invited email'}</button>
    </form>}
    {session && <button className="text-button" disabled={busy} onClick={() => void run(async () => { const result = await member!.auth.signOut(); if (result.error) throw result.error; })}>Sign out</button>}
  </section></div>;
}
