# Edge Function Critical Issues & Fixes

## 🚨 **CRITICAL ISSUES FOUND:**

### **Issue 1: ALWAYS Regenerates PDFs** ❌
- Every request calls PDF.co API
- No check for existing `pdf_url` or `print_pdf_url`
- Wastes API calls and processing time
- Results in unnecessary costs

### **Issue 2: Missing Print Version Support** ❌
- Doesn't accept `printVersion` parameter
- Print PDF is identical to display PDF  
- No grayscale filter applied
- Same margins (not letterhead-ready)
- No header/footer hiding

---

## ✅ **REQUIRED FIXES:**

### **Fix 1: Add PDF Existence Check**

**Add at line 16, BEFORE HTML generation:**

```typescript
const { type, data, printVersion } = await req.json()

// === NEW: PDF EXISTENCE CHECK ===
console.log('[PDF GEN] Request received:', { type, printVersion })

// Initialize Supabase Client for checking
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

// Check if PDF already exists in database
if (type === 'visit' && data.visit?.id) {
  const { data: existingVisit, error } = await supabaseAdmin
    .from('visits')
    .select(printVersion ? 'print_pdf_url' : 'pdf_url')
    .eq('id', data.visit.id)
    .single()
  
  if (!error && existingVisit) {
    const existingPdfUrl = printVersion ? existingVisit.print_pdf_url : existingVisit.pdf_url
    
    if (existingPdfUrl) {
      console.log(`[PDF GEN] ${printVersion ? 'Print' : 'Display'} PDF already exists, returning cached URL:`, existingPdfUrl)
      return new Response(
        JSON.stringify({ success: true, url: existingPdfUrl, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }
  console.log(`[PDF GEN] No cached ${printVersion ? 'print' : 'display'} PDF found, generating new one...`)
} else if (type === 'bill' && data.bill?.id) {
  const { data: existingBill, error } = await supabaseAdmin
    .from('bills')
    .select(printVersion ? 'printPdfUrl' : 'pdfUrl')
    .eq('id', data.bill.id)
    .single()
  
  if (!error && existingBill) {
    const existingPdfUrl = printVersion ? existingBill.printPdfUrl : existingBill.pdfUrl
    
    if (existingPdfUrl) {
      console.log(`[PDF GEN] ${printVersion ? 'Print' : 'Display'} PDF already exists, returning cached URL:`, existingPdfUrl)
      return new Response(
        JSON.stringify({ success: true, url: existingPdfUrl, cached: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }
  console.log(`[PDF GEN] No cached ${printVersion ? 'print' : 'display'} PDF found, generating new one...`)
}
// === END PDF EXISTENCE CHECK ===
```

---

### **Fix 2: Apply Print Version Styling**

**Update HTML generation for visits (around line 464) to wrap with print styles:**

```typescript
// BEFORE HTML GENERATION (line 464)
const isPrintVersion = printVersion === true

// WRAP HTML with print version styles if needed
if (isPrintVersion) {
  htmlContent = `
    <!DOCTYPE html>
    <html lang="${adviceLanguage === 'hindi' ? 'hi' : adviceLanguage === 'bengali' ? 'bn' : 'en'}">
    <head>
      <meta charset="UTF-8">
      <title>Visit Details for ${patient.name} (PRINT VERSION)</title>
      ${/* Include all your font links */}
      <style>
        /* FORCE GRAYSCALE FOR PRINT */
        html, body {
          filter: grayscale(100%) !important;
          -webkit-filter: grayscale(100%) !important;
        }
        
        /* HIDE HEADERS/FOOTERS */
        .custom-header, .custom-footer, .header, .footer {
          display: none !important;
        }
        
        /* ALL EXISTING STYLES... */
        ${/* Copy all your existing styles here */}
        
        /* FORCE BLACK TEXT */
        body, p, div, span, li, td {
          color: #000 !important;
        }
        
        /* Remove background colors */
        .section, .details-section > div {
          background: white !important;
        }
      </style>
    </head>
    <body>
      ${/* Your existing body content WITHOUT custom-header and custom-footer divs */}
    </body>
    </html>
  `
} else {
  // EXISTING REGULAR HTML GENERATION
  htmlContent = ` /* your current HTML */ `
}
```

**For Bills (line 46), apply same logic:**

```typescript
if (isPrintVersion) {
  filename = `Print_Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  // Apply grayscale wrapper...
} else {
  filename = `Bill_${bill.billNumber}_${patient.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  // Regular HTML...
}
```

---

### **Fix 3: Update Storage Path for Print Versions**

**Update storage path logic (line 820):**

```typescript
// Determine Storage Path
const bucketName = 'pdfs';
let storagePath = '';

// Use ID if available for folder structure
if (type === 'bill' && data.bill?.id) {
  const subfolder = printVersion ? 'print' : 'display'
  storagePath = `bills/${data.bill.id}/${subfolder}/${filename}`;
} else if (type === 'visit' && data.visit?.id) {
  const subfolder = printVersion ? 'print' : 'display'
  storagePath = `visits/${data.visit.id}/${subfolder}/${filename}`;
} else {
  storagePath = `temp/${crypto.randomUUID()}/${filename}`;
}

console.log(`[PDF GEN] Uploading ${printVersion ? 'PRINT' : 'DISPLAY'} PDF to: ${storagePath}`);
```

---

### **Fix 4: Update Database with Correct Column**

**Update database update logic (line 856):**

```typescript
if (recordId) {
  console.log(`[PDF GEN] Updating ${table} record ${recordId} with ${printVersion ? 'print' : 'display'} PDF URL...`)
  
  const column = printVersion 
    ? (type === 'bill' ? 'printPdfUrl' : 'print_pdf_url')
    : (type === 'bill' ? 'pdfUrl' : 'pdf_url')
  
  const { error: dbError } = await supabaseAdmin
    .from(table)
    .update({ [column]: publicUrl })
    .eq('id', recordId)

  if (dbError) {
    console.error(`[PDF GEN] Failed to update ${table}.${column}:`, dbError)
  } else {
    console.log(`[PDF GEN] ✅ Successfully saved ${printVersion ? 'print' : 'display'} PDF URL to ${table}.${column}`)
  }
}
```

---

## 📋 **Complete Implementation Checklist:**

- [ ] Add `printVersion` parameter extraction at line 16
- [ ] Add PDF existence check before HTML generation
- [ ] Add `isPrintVersion` flag before HTML generation
- [ ] Wrap HTML with grayscale styles for print version
- [ ] Hide headers/footers in print version HTML
- [ ] Update storage paths to include `print/` or `display/` subfolder
- [ ] Update database column selection based on `printVersion` flag
- [ ] Add comprehensive console logging for debugging
- [ ] Test with cached PDFs
- [ ] Test with new PDF generation
- [ ] Verify grayscale output
- [ ] Verify database updates

---

##  **Expected Behavior After Fix:**

### **First Request (Display PDF):**
```
[PDF GEN] Request received: { type: 'visit', printVersion: false }
[PDF GEN] No cached display PDF found, generating new one...
[PDF GEN] Uploading DISPLAY PDF to: visits/abc123/display/VisitDetails_...
[PDF GEN] ✅ Successfully saved display PDF URL to visits.pdf_url
Response: { success: true, url: "https://...", cached: false }
```

### **Second Request (Same Display PDF):**
```
[PDF GEN] Request received: { type: 'visit', printVersion: false }
[PDF GEN] Display PDF already exists, returning cached URL
Response: { success: true, url: "https://...", cached: true }
```

### **Third Request (Print PDF):**
```
[PDF GEN] Request received: { type: 'visit', printVersion: true }
[PDF GEN] No cached print PDF found, generating new one...
[PDF GEN] Uploading PRINT PDF to: visits/abc123/print/Print_VisitDetails_...
[PDF GEN] ✅ Successfully saved print PDF URL to visits.print_pdf_url
Response: { success: true, url: "https://...", cached: false }
```

---

## 🎯 **Performance Impact:**

**Before Fix:**
- Every click = 1 PDF.co API call (costs money)
- Slow response (~10-40 seconds)
- Redundant processing

**After Fix:**
- First click = 1 PDF.co call  
- Subsequent clicks = Instant response (cached)
- 95%+ reduction in API calls
- Faster user experience

---

## 🔍 **Testing Commands:**

```bash
# Test display PDF (first time)
curl -X POST https://YOUR_URL/functions/v1/generate-pdf-from-html \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"type":"visit", "data":{...}, "printVersion":false}'

# Should return: cached:false, url saved to pdf_url

# Test display PDF (second time - should be cached)
curl -X POST https://YOUR_URL/functions/v1/generate-pdf-from-html \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"type":"visit", "data":{...}, "printVersion":false}'

# Should return: cached:true, instant response

# Test print PDF
curl -X POST https://YOUR_URL/functions/v1/generate-pdf-from-html \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"type":"visit", "data":{...}, "printVersion":true}'

# Should return: cached:false, url saved to print_pdf_url
# PDF should be grayscale, no header/footer
```

---

**CRITICAL**: Implement these fixes ASAP to:
1. Reduce API costs
2. Improve performance  
3. Enable print version feature
4. Better user experience
