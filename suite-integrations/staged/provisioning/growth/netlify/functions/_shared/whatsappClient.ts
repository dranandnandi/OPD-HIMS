import { messagingFetch } from './suite-runtime-guard';
/**
 * Shared WhatsApp Client Utilities for Netlify Functions
 * Provides common functionality for all WhatsApp integration functions
 */

const WHATSAPP_API_BASE_URL = process.env.WHATSAPP_API_BASE_URL || 'https://lionfish-app-nmodi.ondigitalocean.app';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'whatsapp-lims-secure-api-key-2024';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

/**
 * Forward request to WhatsApp backend with authentication
 * Returns Netlify-compatible response object
 */
export async function forwardToWhatsApp(
  path: string,
  method: string = 'POST',
  body?: any
): Promise<{ statusCode: number; headers: typeof corsHeaders; body: string }> {
  const url = `${WHATSAPP_API_BASE_URL}${path}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': WHATSAPP_API_KEY,
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await messagingFetch(url, options);
    const responseText = await response.text();
    
    return {
      statusCode: response.status,
      headers: corsHeaders,
      body: responseText || JSON.stringify({ success: response.ok }),
    };
  } catch (err) {
    console.error('[WhatsApp Client] Forward request failed:', err);
    return error('Failed to communicate with WhatsApp backend', 502);
  }
}

/**
 * Parse request body safely
 */
export function parseRequestBody(bodyString: string | null): any {
  try {
    if (!bodyString) {
      return {};
    }
    return JSON.parse(bodyString);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Ensure required lab/clinic context
 */
export function ensureLabContext(body: any): { labId: string } {
  const labId = body.clinicId || body.labId || 'default-clinic';
  return { labId };
}

/**
 * Standard success response
 */
export function ok(data: any) {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify(data),
  };
}

/**
 * Standard error response
 */
export function error(message: string, statusCode: number = 400) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify({ error: message }),
  };
}
