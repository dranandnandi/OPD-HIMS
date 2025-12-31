# PDF Report Generation & Delivery System

This workflow details the complete architecture for generating PDF reports, storing them, and delivering them via WhatsApp. It is designed to be replicated in other applications.

## 1. Architecture Overview

1.  **Trigger**: User or System initiates report generation.
2.  **Generation (Supabase Edge Function)**:
    *   Fetches data (Order, Patient, Results).
    *   Constructs HTML (Header, Body, Footer).
    *   Injects Signatures.
    *   Calls PDF.co API to convert HTML to PDF.
3.  **Storage (Supabase Storage)**:
    *   PDF Buffer is uploaded to a storage bucket.
    *   Public URL is generated.
4.  **Delivery (Netlify Function)**:
    *   Triggered with the Public URL.
    *   Proxies request to WhatsApp Backend API.

---

## 2. PDF Generation Service (`generate-pdf-auto`)

**Location**: Supabase Edge Function (`supabase/functions/generate-pdf-auto/index.ts`)

### Data Fetching
Fetch necessary data using Supabase Client:
- **Order**: Basic details, lab_id.
- **Patient**: Name, Age, Gender.
- **Lab Settings**: `header_html`, `footer_html`, `signature_url`, `branding_css`.

### HTML Construction

#### CSS & Styling
- Define a `BASELINE_CSS` constant containing reset styles, typography (Inter/Noto Sans), and table layouts.
- Inject Google Fonts for local language support (e.g., `Noto Sans Devanagari`).

#### Header & Footer
- **Source**: Stored in `labs` table or `report_settings` as HTML strings.
- **Injection**:
    - Passed to PDF.co API parameters (`header`, `footer`) directly, OR
    - Injected into the main HTML body if using a continuous layout.

#### Signature Injection
Signatures are injected into the HTML string using Regex before PDF conversion. This allows precise placement without breaking the layout.

**Logic:**
1.  Identify target signatory name (e.g., "Dr. Smith").
2.  Define Image HTML: `<img src="${signatureUrl}" style="max-height: 80px; display: block;" />`
3.  Execute Regex replacement (Matches strictly to avoid partial replacements):
    ```typescript
    // Pattern: Name in a table cell (common in report footers)
    // Matches: <td>[whitespace]name[whitespace]</td>
    // Replaces with: <td>[whitespace]SIGNATURE_IMG[whitespace]name[whitespace]</td>
    const escapedName = signatoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tdPattern = new RegExp(`(<td[^>]*>)(\\s*)(${escapedName})(\\s*)(</td>)`, 'gi');
    
    if (html.match(tdPattern)) {
      html = html.replace(tdPattern, `$1$2${imgHtml}$3$4$5`);
    } else {
       // Fallback: Try div/span
       const divPattern = new RegExp(`(<(?:div|span|p)[^>]*>)(\\s*)(${escapedName})(\\s*)(</(?:div|span|p)>)`, 'gi');
       html = html.replace(divPattern, `$1$2${imgHtml}$3$4$5`);
    }
    ```

### PDF.co Integration

Send a POST request to `https://api.pdf.co/v1/pdf/convert/from/html`.

**Payload:**
```json
{
  "html": "<!DOCTYPE html><html>...</html>",
  "header": "<div class='header'>...</div>", // Optional
  "footer": "<div class='footer'>Page <page></div>", // Optional
  "paperSize": "A4",
  "orientation": "Portrait",
  "marginTop": "40",
  "marginBottom": "40",
  "marginLeft": "20",
  "marginRight": "20"
}
```

**Response**: Returns a JSON object containing the `url` of the generated PDF (temporary link).

### Saving to Storage

1.  **Fetch PDF**: Download the content from the PDF.co temporary `url`.
2.  **Upload to Supabase**:
    ```typescript
    const response = await fetch(pdfCoBody.url);
    const pdfBuffer = await response.arrayBuffer();
    
    const { data, error } = await supabase.storage
      .from('reports') // Bucket Name
      .upload(`${labId}/${orderId}/${fileName}.pdf`, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    ```
3.  **Get Public URL**:
    ```typescript
    const { data } = supabase.storage
      .from('reports')
      .getPublicUrl(`${labId}/${orderId}/${fileName}.pdf`);
    return data.publicUrl;
    ```

---

## 3. WhatsApp Delivery Service

**Location**: Netlify Function (`netlify/functions/send-report-url.js`)

This function acts as a secure proxy to the core backend API that handles WhatsApp messaging.

### Request Structure
**Endpoint**: `POST /.netlify/functions/send-report-url`
**Headers**: `Content-Type: application/json`

**Body:**
```json
{
  "userId": "uuid-of-sender",
  "phoneNumber": "919876543210", // Country code required (without +)
  "url": "https://supabase.../report.pdf", // Public URL from Step 2
  "caption": "Your report is ready.",
  "patientName": "John Doe",
  "testName": "CBC",
  "templateData": {
    "PatientName": "John Doe",
    "TestName": "CBC"
  }
}
```

### Backend Integration
The Netlify function validates inputs, removes '+' prefixes from numbers, and forwards the request to the backend server.

**Upstream API**: `[BACKEND_BASE_URL]/api/external/reports/send-url`
**Auth**: `X-API-Key` (Secure Server-to-Server Key)

**Code Snippet:**
```javascript
const response = await fetch(apiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.WHATSAPP_PROXY_API_KEY
  },
  body: JSON.stringify({
    userId,
    phoneNumber: cleanPhoneNumber, // Remove '+'
    fileUrl: url,
    caption,
    templateData,
    fileName: 'report.pdf'
  })
});
```

---

## 4. Key Considerations for Implementation

*   **Fonts**: Ensure `Noto Sans` (or similar) is loaded in the HTML `<head>` to prevent "tofu" characters (squares) for Indic languages (Hindi, Marathi, etc.).
*   **Timeouts**: PDF generation can take time. Ensure Edge Functions have appropriate timeout settings (e.g., 60s).
*   **Security**: Do not expose the WhatsApp Backend API key on the client side. Always proxy through a middleware (like Netlify Functions).
*   **Layout**: Use CSS Grid or Flexbox for the report body, but stick to Tables for data presentation to ensure consistent page breaks in PDF.co.