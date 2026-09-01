// Verifying that an inbound ABDM callback really came from ABDM.
//
// Every other ABDM function in this project is OUTBOUND: we authenticate to
// them. Callbacks invert that, and the endpoint has to be public — ABDM cannot
// present a Supabase JWT, so `verify_jwt = false`. That makes these the only
// endpoints in the system a stranger can reach, and they carry health
// identifiers. An unverified callback handler is the worst failure mode
// available to us: anyone who guesses the URL could inject patients.
//
// ABDM signs callbacks with a JWT (RS512) issued by its Keycloak. The public
// keys are published as a JWKS at {gateway}/api/hiecm/gateway/v3/certs, which
// the OpenID configuration at .well-known/openid-configuration points to.
//
// Verify the SIGNATURE, not just the shape. Decoding a JWT without verifying
// it accepts anything well-formed, which is the same as no check at all.

import { createLocalJWKSet, jwtVerify } from 'https://deno.land/x/jose@v5.9.6/index.ts';
import { type AbdmConfig, abdmHeaders } from './abdmConfig.ts';

export class AbdmCallbackAuthError extends Error {
  constructor(message: string, readonly status: number = 401) {
    super(message);
  }
}

/**
 * ABDM's JWKS is NOT public.
 *
 * `{gateway}/v3/certs` and even `.well-known/openid-configuration` both answer
 * 401 without a session token — verified against sandbox 2026-08-26. So
 * `createRemoteJWKSet`, which fetches anonymously, cannot be used: it would
 * fail on every callback. We fetch the key set ourselves with the gateway
 * token and verify against a LOCAL JWKS.
 *
 * Consequence worth knowing: verifying an inbound callback requires an
 * OUTBOUND authenticated call the first time. If ABDM's session API is down,
 * callbacks cannot be verified — and we then reject them rather than trusting
 * them, so a gateway outage costs us shares rather than safety.
 */
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedJwks {
  keys: { keys: unknown[] };
  fetchedAt: number;
}

const jwksCache = new Map<string, CachedJwks>();

async function jwksFor(cfg: AbdmConfig, accessToken: string) {
  // `/gateway` matters: gatewayBase stops at `/api/hiecm` and the gateway's own
  // APIs sit under `/gateway` beneath it, exactly like `/gateway/v3/sessions`.
  const url = `${cfg.gatewayBase}/gateway/v3/certs`;
  const cached = jwksCache.get(url);

  if (!cached || Date.now() - cached.fetchedAt > JWKS_TTL_MS) {
    const res = await fetch(url, {
      method: 'GET',
      headers: abdmHeaders(cfg, accessToken, crypto.randomUUID()),
    });
    if (!res.ok) {
      // Serve a stale key set rather than failing shut on a transient blip:
      // ABDM rotates signing keys rarely, and a stale-but-valid key still
      // proves the signature. Only a cold isolate with no cache can fail here.
      if (cached) {
        console.warn(`[abdm-callback] certs fetch ${res.status}; using cached JWKS`);
        return createLocalJWKSet(cached.keys as never);
      }
      throw new AbdmCallbackAuthError('Cannot verify callback: ABDM key set unavailable', 503);
    }
    jwksCache.set(url, { keys: await res.json(), fetchedAt: Date.now() });
  }

  return createLocalJWKSet(jwksCache.get(url)!.keys as never);
}

export interface VerifiedCallback {
  /** Raw JWT claims, for audit. Never returned to any client. */
  claims: Record<string, unknown>;
  /** The HIP this callback was addressed to, from the X-HIP-ID header. */
  hipId: string;
}

/**
 * Verifies an inbound ABDM callback request.
 *
 * Checks, in order of what actually stops an attacker:
 *  1. A bearer token is present.
 *  2. Its signature verifies against ABDM's published JWKS.
 *  3. It is unexpired (jose enforces exp/nbf, with a small clock tolerance).
 *  4. X-HIP-ID is present — which HIP the callback is for.
 *
 * Deliberately NOT checked here: whether the HIP ID is one of ours. That is a
 * routing decision for the caller, which knows the clinic table; failing it
 * here would conflate "not from ABDM" with "not for us", and those need
 * different responses.
 */
export async function verifyAbdmCallback(
  req: Request,
  cfg: AbdmConfig,
  accessToken: string,
): Promise<VerifiedCallback> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new AbdmCallbackAuthError('Missing callback authorization');
  }

  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(token, await jwksFor(cfg, accessToken), {
      // 30s covers clock drift between ABDM and the edge without meaningfully
      // widening the window on a replayed token.
      clockTolerance: 30,
    });
    claims = payload as Record<string, unknown>;
  } catch (e) {
    // The reason goes to logs only. Telling a caller *why* their forged token
    // failed is free tuning feedback for forging a better one.
    console.error('[abdm-callback] JWT verification failed:', e instanceof Error ? e.message : e);
    throw new AbdmCallbackAuthError('Callback authorization is not valid');
  }

  const hipId = (req.headers.get('X-HIP-ID') ?? '').trim();
  if (!hipId) {
    throw new AbdmCallbackAuthError('Missing X-HIP-ID', 400);
  }

  return { claims, hipId };
}
