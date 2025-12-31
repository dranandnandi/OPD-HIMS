// Netlify Lambda: netlify/functions/whatsapp-send-bill.js
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    console.log('Processing bill PDF send request');
    const contentType = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    console.log('Incoming Content-Type:', contentType);

    if (!contentType.includes('application/json')) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Content-Type must be application/json' }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const {
      userId,
      email,
      phoneNumber,
      phone,
      fileUrl,
      caption,
      fileName,
      billNumber,
      patientName,
      totalAmount,
    } = body;

    const finalUserId = userId || null;
    const userEmail = email || null;
    let resolvedPhoneNumber = phoneNumber || phone || null;
    const resolvedFileUrl = fileUrl || null;

    if (!finalUserId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'userId is required' }),
      };
    }

    if (!resolvedPhoneNumber) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'phoneNumber or phone is required' }),
      };
    }

    // Normalize phone number: remove spaces, dashes, parentheses
    resolvedPhoneNumber = resolvedPhoneNumber.replace(/[\s\-\(\)]/g, '');

    // Remove + prefix if present
    if (resolvedPhoneNumber.startsWith('+')) {
      resolvedPhoneNumber = resolvedPhoneNumber.substring(1);
      console.log('Removed + prefix from phone number');
    }

    // Add country code 91 if not present (assuming India)
    if (!resolvedPhoneNumber.startsWith('91') && resolvedPhoneNumber.length === 10) {
      resolvedPhoneNumber = '91' + resolvedPhoneNumber;
      console.log('Added country code 91 to phone number');
    }

    console.log('Final normalized phone number:', resolvedPhoneNumber);

    if (!resolvedFileUrl) {
      return { 
        statusCode: 400, 
        headers: corsHeaders, 
        body: JSON.stringify({ success: false, error: 'fileUrl is required' }) 
      };
    }

    // Validate phone number format (should be digits only)
    const phoneRegex = /^[1-9]\d{7,14}$/;
    if (!phoneRegex.test(resolvedPhoneNumber)) {
      console.warn('Phone number format warning:', resolvedPhoneNumber, '- Expected numeric format');
    }

    console.log('Extracted values:', {
      finalUserId,
      phoneNumber: resolvedPhoneNumber,
      fileUrl: resolvedFileUrl,
      billNumber,
      fileName,
    });

    // Build caption from bill details
    let finalCaption = caption;
    if (!finalCaption && patientName && billNumber && totalAmount !== undefined) {
      finalCaption = `Hello ${patientName},\n\nThank you for your visit!\n\nYour bill ${billNumber} for ₹${totalAmount} is attached.\n\nPlease find your invoice attached.`;
    } else if (!finalCaption) {
      finalCaption = 'Your invoice is attached.';
    }

    const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://lionfish-app-nmodi.ondigitalocean.app';
    if (!process.env.WHATSAPP_API_BASE_URL && !process.env.VITE_WHATSAPP_API_BASE_URL) {
      console.warn('WHATSAPP_API_BASE_URL not configured, using default');
    }

    const apiUrl = `${base}/api/external/reports/send-url`;
    console.log('Calling backend URL:', apiUrl);

    const API_KEY = process.env.WHATSAPP_PROXY_API_KEY || 'whatsapp-lims-secure-api-key-2024';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    };
    
    console.log('Using API key for authentication');

    const templateData = {};
    if (patientName) templateData.PatientName = String(patientName);
    if (billNumber) templateData.BillNumber = String(billNumber);
    if (totalAmount !== undefined) templateData.Amount = String(totalAmount);

    const requestBody = { 
      userId: finalUserId,
      phoneNumber: resolvedPhoneNumber,
      fileUrl: resolvedFileUrl,
      caption: finalCaption,
      templateData: Object.keys(templateData).length ? templateData : undefined,
      fileName: fileName || `bill_${billNumber || 'invoice'}.pdf`,
    };
    
    if (!requestBody.templateData) delete requestBody.templateData;
    
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const fetchFn = globalThis.fetch;
    if (!fetchFn) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Fetch unavailable in runtime' }),
      };
    }

    // Helper function to make the API call
    const makeApiCall = async (userIdentifier) => {
      const payload = { 
        ...requestBody,
        userId: userIdentifier,
      };
      console.log('Making API call with userId:', userIdentifier);
      
      const response = await fetchFn(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      
      return { response, text, json };
    };

    // First attempt with userId
    let { response: upstream, text: responseText, json: data } = await makeApiCall(finalUserId);

    console.log('Upstream status:', upstream.status);
    console.log('Upstream response text (trim):', responseText ? responseText.substring(0, 2000) : '');

    // Check for session not found error and retry with email if available
    const isSessionNotFound = !upstream.ok && (
      (data && data.error && typeof data.error === 'string' && data.error.toLowerCase().includes('session not found')) ||
      (data && data.message && typeof data.message === 'string' && data.message.toLowerCase().includes('session not found')) ||
      (responseText && responseText.toLowerCase().includes('session not found'))
    );

    if (isSessionNotFound && userEmail) {
      console.log('Session not found for userId, retrying with email:', userEmail);
      const retryResult = await makeApiCall(userEmail);
      upstream = retryResult.response;
      responseText = retryResult.text;
      data = retryResult.json;
      console.log('Retry with email - status:', upstream.status);
      console.log('Retry with email - response:', responseText ? responseText.substring(0, 2000) : '');
    }

    if (!data) {
      console.error('Failed to parse backend response as JSON:', responseText);
      return {
        statusCode: upstream.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Backend returned invalid JSON response',
          status: upstream.status,
          bodyPreview: responseText ? responseText.substring(0, 1000) : null
        }),
      };
    }

    if (!upstream.ok) {
      console.error('Backend error:', upstream.status, data);
      return {
        statusCode: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // Success response
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error('Handler error:', err && err.stack ? err.stack : String(err));
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined
      }),
    };
  }
};
