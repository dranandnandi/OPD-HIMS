// Cached ABDM bearer token and RSA certificate — G-07.
//
// The old shape: abdm-session existed but read/wrote a `_abdm_session` table no
// migration ever created, so it always failed; and the three live functions
// each minted their own token *and* re-fetched the certificate inline. That is
// three ABDM round-trips for one OTP request. NHA rate-limits the session API,
// and the latency landed on a receptionist standing in front of a patient.
//
// Both caches live in `_abdm_session` (created in 20260820000000), keyed by
// kind + env so a sandbox token is never served to a production caller.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { type AbdmConfig } from './abdmConfig.ts';

/**
 * Renew this far before nominal expiry.
 *
 * Covers clock skew between us and ABDM plus the round-trip of whatever call
 * the token was fetched for. A token that expires mid-flight fails the user's
 * action, not just ours.
 */
const TOKEN_SKEW_SECS = 120;

/** ABDM's signing certificate changes rarely; a day is conservative. */
const CERT_TTL_SECS = 24 * 60 * 60;

export class AbdmUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Upstream body — for server-side logging ONLY. Never return this (G-03). */
    readonly upstreamBody: string,
  ) {
    super(message);
  }
}

async function readCache(
  supabase: SupabaseClient,
  kind: 'token' | 'certificate',
  env: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('_abdm_session')
    .select('value')
    .eq('kind', kind)
    .eq('env', env)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

async function writeCache(
  supabase: SupabaseClient,
  kind: 'token' | 'certificate',
  env: string,
  value: string,
  ttlSecs: number,
): Promise<void> {
  // Best-effort: a caching failure must degrade to "fetch again next time",
  // never fail the patient-facing call that triggered it.
  try {
    await supabase.from('_abdm_session').insert({
      kind,
      env,
      value,
      expires_at: new Date(Date.now() + ttlSecs * 1000).toISOString(),
    });
    // Opportunistic sweep so the table cannot grow without bound.
    await supabase
      .from('_abdm_session')
      .delete()
      .eq('kind', kind)
      .eq('env', env)
      .lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  } catch (e) {
    console.warn(`[abdm] ${kind} cache write failed:`, e instanceof Error ? e.message : e);
  }
}

/** Bearer token for ABDM, from cache when possible. */
export async function getAccessToken(
  supabase: SupabaseClient,
  cfg: AbdmConfig,
): Promise<string> {
  const cached = await readCache(supabase, 'token', cfg.env);
  if (cached) return cached;

  const res = await fetch(`${cfg.gatewayBase}/gateway/v3/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'REQUEST-ID': crypto.randomUUID(),
      'TIMESTAMP': new Date().toISOString(),
      'X-CM-ID': cfg.cmId,
    },
    body: JSON.stringify({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      grantType: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new AbdmUpstreamError('ABDM session failed', res.status, await res.text());
  }

  const body = await res.json();
  const token: string | undefined = body.accessToken ?? body.token ?? body.access_token;
  if (!token) {
    // Deliberately does not include the body: a session response can carry
    // credential-adjacent material.
    throw new AbdmUpstreamError('ABDM session returned no token', 502, '<token field absent>');
  }

  const expiresIn = Number(body.expiresIn ?? body.expires_in ?? 1800);
  await writeCache(supabase, 'token', cfg.env, token, Math.max(60, expiresIn - TOKEN_SKEW_SECS));
  return token;
}

/** ABDM's RSA public certificate, from cache when possible. */
export async function getCertificate(
  supabase: SupabaseClient,
  cfg: AbdmConfig,
  accessToken: string,
): Promise<string> {
  const cached = await readCache(supabase, 'certificate', cfg.env);
  if (cached) return cached;

  const res = await fetch(`${cfg.abhaBase}/v3/profile/public/certificate`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'REQUEST-ID': crypto.randomUUID(),
      'TIMESTAMP': new Date().toISOString(),
      'X-CM-ID': cfg.cmId,
    },
  });

  if (!res.ok) {
    throw new AbdmUpstreamError('ABDM certificate fetch failed', res.status, await res.text());
  }

  const data = await res.json();
  const pem: string | undefined =
    data.publicKey ?? data.certificate ?? data.PublicKey ?? data.Certificate;
  if (!pem) {
    throw new AbdmUpstreamError('ABDM certificate not found in response', 502, '<field absent>');
  }

  await writeCache(supabase, 'certificate', cfg.env, pem, CERT_TTL_SECS);
  return pem;
}

/** Token + certificate together — what nearly every ABDM call needs. */
export async function getAbdmCredentials(
  supabase: SupabaseClient,
  cfg: AbdmConfig,
): Promise<{ accessToken: string; certificate: string }> {
  const accessToken = await getAccessToken(supabase, cfg);
  // Sequential, not parallel: the certificate call authenticates with the token.
  const certificate = await getCertificate(supabase, cfg, accessToken);
  return { accessToken, certificate };
}
