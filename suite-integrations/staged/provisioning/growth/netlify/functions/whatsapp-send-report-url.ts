import { runtimeFetch, guardNetlify } from './_shared/suite-runtime-guard';
/**
 * Send WhatsApp report via URL
 * POST /api/whatsapp-send-report-url
 * Body: { userId: string, to: string, reportUrl: string, fileName: string, mimeType: string, caption?: string }
 */

import { Handler } from '@netlify/functions';
import { parseRequestBody, error, corsHeaders } from './_shared/whatsappClient';

const WHATSAPP_API_BASE_URL = process.env.WHATSAPP_API_BASE_URL || 'https://lionfish-app-nmodi.ondigitalocean.app';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'whatsapp-lims-secure-api-key-2024';

function getSessionIdentifier(session: any): string | null {
  return session?.sessionId
    || session?.session_id
    || session?.id
    || session?._id
    || session?.session?.sessionId
    || session?.session?.id
    || null;
}

function isSessionReady(session: any): boolean {
  const status = String(session?.status || session?.state || session?.connectionState || session?.sessionStatus || '').toLowerCase();
  return session?.isConnected === true
    || session?.connected === true
    || session?.ready === true
    || session?.isAuthenticated === true
    || session?.authenticated === true
    || session?.is_authenticated === true
    || session?.is_active === true
    || ['connected', 'ready', 'open', 'authenticated'].includes(status);
}

async function getConnectedSessionId(userId: string): Promise<string | null> {
  console.log('[WhatsApp Send Report URL] Looking up connected session for userId:', userId);

  const response = await runtimeFetch(`${WHATSAPP_API_BASE_URL}/api/users/${userId}/whatsapp/status`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': WHATSAPP_API_KEY,
    },
  });

  const responseText = await response.text();
  console.log('[WhatsApp Send Report URL] Status lookup HTTP:', response.status);

  if (!response.ok) {
    console.error('[WhatsApp Send Report URL] Status lookup failed body:', responseText);
    return null;
  }

  let payload: any;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch (parseError) {
    console.error('[WhatsApp Send Report URL] Status lookup returned invalid JSON:', responseText);
    return null;
  }

  const rawSessions = payload?.data?.sessions
    || payload?.sessions
    || payload?.data?.session
    || payload?.session
    || [];
  const sessions = Array.isArray(rawSessions) ? rawSessions : [rawSessions].filter(Boolean);

  console.log('[WhatsApp Send Report URL] Status summary:', {
    topLevelKeys: Object.keys(payload || {}),
    dataKeys: Object.keys(payload?.data || {}),
    success: payload?.success,
    connected: payload?.connected,
    isConnected: payload?.isConnected,
    topLevelSessionId: payload?.sessionId,
    topLevelSession_id: payload?.session_id,
    topLevelId: payload?.id,
    dataSessionId: payload?.data?.sessionId,
    dataSession_id: payload?.data?.session_id,
    dataId: payload?.data?.id,
    sessionCount: sessions.length,
    sessions: sessions.map((session: any) => ({
          keys: Object.keys(session || {}),
          selectedIdentifier: getSessionIdentifier(session),
          sessionId: session?.sessionId,
          session_id: session?.session_id,
          id: session?.id,
          _id: session?._id,
          isConnected: session?.isConnected,
          connected: session?.connected,
          ready: session?.ready,
          isAuthenticated: session?.isAuthenticated,
          authenticated: session?.authenticated,
          is_authenticated: session?.is_authenticated,
          is_active: session?.is_active,
          phoneNumber: session?.phoneNumber,
          phone_number: session?.phone_number,
          status: session?.status,
          state: session?.state,
          connectionState: session?.connectionState,
          sessionStatus: session?.sessionStatus,
          lastActivity: session?.lastActivity,
        })),
  });

  const connectedSession = sessions.find(isSessionReady);

  if (!connectedSession && sessions.length > 0) {
    console.warn('[WhatsApp Send Report URL] No connected session found in status response. First session:', {
      selectedIdentifier: getSessionIdentifier(sessions[0]),
      sessionId: sessions[0]?.sessionId,
      session_id: sessions[0]?.session_id,
      id: sessions[0]?.id,
      _id: sessions[0]?._id,
      isConnected: sessions[0]?.isConnected,
      connected: sessions[0]?.connected,
      ready: sessions[0]?.ready,
      isAuthenticated: sessions[0]?.isAuthenticated,
      authenticated: sessions[0]?.authenticated,
      is_authenticated: sessions[0]?.is_authenticated,
      is_active: sessions[0]?.is_active,
      status: sessions[0]?.status,
      state: sessions[0]?.state,
      connectionState: sessions[0]?.connectionState,
      sessionStatus: sessions[0]?.sessionStatus,
    });
  }

  const selectedSessionId = getSessionIdentifier(connectedSession);
  console.log('[WhatsApp Send Report URL] Selected sessionId:', {
    selectedSessionId,
    source: connectedSession ? 'connected-session' : 'none',
  });

  return selectedSessionId;
}

export const handler: Handler = guardNetlify(async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return error('Method not allowed', 405);
  }

  try {
    const body = parseRequestBody(event.body);
    const { userId, to, reportUrl, fileName, mimeType, caption, labId, patientName, testName } = body;

    if (!userId || !to || !reportUrl || !fileName || !mimeType) {
      return error('Missing required fields: userId, to, reportUrl, fileName, mimeType', 400);
    }

    console.log('[WhatsApp Send Report URL] Request received:', {
      userId,
      to,
      reportUrl,
      fileName,
      mimeType,
      hasCaption: Boolean(caption),
      labId,
      patientName,
      testName,
      providedSessionId: body.sessionId,
    });

    const sessionId = body.sessionId || await getConnectedSessionId(userId);
    if (!sessionId) {
      return error('No connected WhatsApp session found for this user', 404);
    }

    const content = caption || `Report for ${patientName || 'patient'}`;

    const response = await runtimeFetch(`${WHATSAPP_API_BASE_URL}/api/external/reports/send-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': WHATSAPP_API_KEY,
      },
      body: JSON.stringify({
        userId,
        sessionId,
        phoneNumber: to,
        phone: to,
        to,
        reportUrl,
        fileUrl: reportUrl,
        fileName,
        mimeType,
        caption,
        content,
        labId,
        patientName,
        testName: testName || 'Smart Report',
      }),
    });

    const responseText = await response.text();
    console.log('[WhatsApp Send Report URL] External report URL send HTTP:', response.status);
    console.log('[WhatsApp Send Report URL] External report URL send body:', responseText);

    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: responseText || JSON.stringify({ success: response.ok }),
    };
  } catch (err) {
    console.error('[WhatsApp Send Report URL] Error:', err);
    return error('Failed to send report', 500);
  }
}, 'growth', 'whatsapp-send-report-url', false);
