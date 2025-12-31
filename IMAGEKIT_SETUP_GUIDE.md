# ✅ ImageKit Integration - SIMPLIFIED VERSION

## What's Implemented

Single-URL optimization system: One optimized ImageKit URL saved directly to the database.

### **Transformation Rules:**

| Asset Type | Transform | Width | Result |
|-----------|-----------|-------|--------|
| **Signature** | `e-removedotbg` | 200px | Transparent background, 200px wide |
| **Header/Footer** | `e-upscale` | 1000px | Upscaled quality, 1000px wide |
| **Other** | `e-upscale` | 1600px | High quality, 1600px wide |

All use `fo-auto` (automatic format - WebP when supported, fallback to original)

---

## Setup Steps

### 1. Get ImageKit Credentials
- Sign up at [ImageKit.io](https://imagekit.io)
- Go to **Developer Options → API Keys**
- Copy: Public Key, Private Key, URL Endpoint

### 2. Set Environment Variables
```bash
supabase secrets set IMAGEKIT_PRIVATE_KEY=your_private_key
supabase secrets set IMAGEKIT_PUBLIC_KEY=your_public_key
supabase secrets set IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_id
```

### 3. Deploy Edge Function
```bash
supabase functions deploy imagekit-process
```

### 4. Run Migration
```bash
supabase db push
```

### 5. Create Storage Bucket
In Supabase Dashboard:
- Storage → New bucket → `pdf-assets`
- Make it **Public**

---

## How It Works

```
User uploads image
    ↓
Saved to Supabase Storage
    ↓
ImageKit edge function called
    ↓
Image downloaded from Supabase
    ↓
Uploaded to ImageKit with transform:
  - Signature: tr:e-removedotbg,w-200,fo-auto
  - Header/Footer: tr:e-upscale,w-1000,fo-auto
    ↓
Optimized URL saved to database:
  - clinic_settings.pdfHeaderUrl
  - clinic_settings.pdfFooterUrl
  - profiles.signatureUrl
    ↓
PDF generation uses optimized URL
```

---

## Database Schema

```sql
-- clinic_settings
pdfHeaderUrl       TEXT  -- ImageKit optimized header URL
pdfFooterUrl       TEXT  -- ImageKit optimized footer URL  
pdfMargins         TEXT  -- Default: "180px 20px 150px 20px"
pdfPrintMargins    TEXT  -- Default: "180px 20px 150px 20px"

-- profiles
signatureUrl       TEXT  -- ImageKit optimized signature (bg removed)
```

---

## Using in Your App

### Add to Settings Page:
```typescript
import { PDFSettings } from '../components/Settings/PDFSettings';

<PDFSettings clinicId={user?.clinicId} />
```

### Upload Flow:
1. User selects image → "Uploading..."
2. Saved to Supabase → "Processing..."
3. ImageKit optimizes → "Image optimized successfully!"
4. URL updates automatically

---

## Benefits

✅ **Automatic background removal** for signatures  
✅ **CDN-delivered** images (fast worldwide)  
✅ **Auto-format** (WebP when supported)  
✅ **Optimized size** (50-80% smaller files)  
✅ **Simple** - just one URL per asset  

---

## Example URLs

**Original Supabase:**
```
https://xyz.supabase.co/storage/v1/object/public/pdf-assets/clinic-pdf-assets/123/header.png
```

**Optimized ImageKit:**
```
https://ik.imagekit.io/your_id/tr:e-upscale,w-1000,fo-auto/clinic-assets/header/header.png
```

**Signature (bg removed):**
```
https://ik.imagekit.io/your_id/tr:e-removedotbg,w-200,fo-auto/clinic-assets/signature/sig.png
```

---

## Troubleshooting

**"ImageKit processing failed"**
- Check Edge Function logs
- Verify API keys are correct
- Ensure bucket exists and is public

**Background not removing**
- Only works for signatures (clear subject)
- ImageKit needs high-contrast image
- Try image with simpler background

**Image not showing in PDF**
- Check URL in database
-Verify ImageKit account is active
- Test URL directly in browser

---

**Ready!** Upload images and they'll be automatically optimized with ImageKit! 🚀
