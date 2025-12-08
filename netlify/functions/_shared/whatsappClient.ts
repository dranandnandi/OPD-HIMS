import type { HandlerResponse } from '@netlify/functions';

const DEFAULT_BASE_URL = 'https://lionfish-app-nmodi.ondigitalocean.app';
const JSON_HEADERS = ['application/json', 'text/json'];

export interface ProxyOptions {
  path: string;
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

export interface EventLike {
  headers?: Record<string, string | undefined>;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
};

export const ok = (body: unknown, statusCode = 200): HandlerResponse => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...corsHeaders
  },
  body: JSON.stringify(body)
});

export const error = (message: string, statusCode = 500, details?: unknown): HandlerResponse => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...corsHeaders
  },
  body: JSON.stringify({ success: false, message, details })
});

const getBaseUrl = () => process.env.WHATSAPP_API_BASE_URL || DEFAULT_BASE_URL;
const getApiKey = () => process.env.WHATSAPP_API_KEY || 'whatsapp-lims-secure-api-key-2024';

export const forwardToWhatsApp = async (options: ProxyOptions) => {
  const url = new URL(options.path, getBaseUrl());
  if (options.query) {
    Object.entries(options.query)
      .filter(([, value]) => value !== undefined && value !== null)
      .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  }

  const headers: Record<string, string> = {
    'X-API-Key': getApiKey(),
    ...options.headers
  };

  // Default to JSON content type when sending plain objects
  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    try {
      JSON.parse(options.body);
      headers['Content-Type'] = 'application/json';
    } catch {
      // ignore
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method || 'POST',
    headers,
    body: options.body ?? undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = JSON_HEADERS.some((token) => contentType.includes(token));
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage = typeof payload === 'string' 
      ? payload 
      : payload?.message || payload?.error || JSON.stringify(payload);
    throw new Error(`WhatsApp API error (${response.status}): ${errorMessage}`);
  }

  return payload;
};

export const parseRequestBody = (eventBody?: string | null) => {
  if (!eventBody) return {};
  try {
    return JSON.parse(eventBody);
  } catch {
    return {};
  }
};

export const ensureLabContext = (payload: Record<string, unknown>) => {
  if (!payload.labId && !payload.clinicId) {
    throw new Error('labId or clinicId is required for WhatsApp operations.');
  }
};
