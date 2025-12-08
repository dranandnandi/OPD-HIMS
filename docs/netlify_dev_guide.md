# Netlify WhatsApp Integration - Local Development Guide

## Prerequisites
- Node.js 18+
- Netlify CLI (`npm install -g netlify-cli`)
- Project linked to Netlify site `beautiful-caramel-ebc094`

## Environment Variables

### Local Development (.env)
```env
# Supabase
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# WhatsApp (Frontend - exposed to browser)
VITE_WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app
VITE_WHATSAPP_API_MODE=netlify-functions
VITE_WHATSAPP_WS_ENABLED=true
VITE_WHATSAPP_WS_URL=wss://lionfish-app-nmodi.ondigitalocean.app/ws
VITE_WHATSAPP_WS_DEBUG=false
```

### Netlify Functions (Server-side only)
Configure these in Netlify dashboard under **Site settings > Environment variables**:

```
WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app
WHATSAPP_API_KEY=whatsapp-lims-secure-api-key-2024
```

## Running Locally

### Option 1: Netlify Dev (Recommended)
Runs Vite + Netlify Functions together:

```bash
netlify dev
```

Access at: `http://localhost:8888`

### Option 2: Vite Only (No Functions)
```bash
npm run dev
```

Access at: `http://localhost:5173`  
⚠️ Functions won't work without `netlify dev`

## Testing WhatsApp Integration

### 1. Start Dev Server
```bash
netlify dev
```

### 2. Navigate to WhatsApp Settings
Open: `http://localhost:8888/settings/whatsapp-ai`

### 3. Connect WhatsApp
- Click **Connect** button
- Click **Generate QR** button
- Scan QR with WhatsApp mobile app (Linked Devices)
- Wait for connection confirmation

### 4. Send Test Message
- Enter a patient phone number (e.g., `919876543210`)
- Click **Send Test Message**
- Verify message received on WhatsApp

### 5. Test Billing Integration
- Go to **Billing** (`/billing`)
- Find any bill with patient phone number
- Click WhatsApp icon in Actions column
- Confirm message sent

## Function Endpoints (Local)

When running `netlify dev`, functions are available at:

```
POST http://localhost:8888/.netlify/functions/whatsapp-connect
POST http://localhost:8888/.netlify/functions/whatsapp-status
POST http://localhost:8888/.netlify/functions/whatsapp-qr
POST http://localhost:8888/.netlify/functions/whatsapp-send-message
POST http://localhost:8888/.netlify/functions/whatsapp-send-document
POST http://localhost:8888/.netlify/functions/whatsapp-send-file-url
POST http://localhost:8888/.netlify/functions/whatsapp-send-report
POST http://localhost:8888/.netlify/functions/whatsapp-send-report-url
POST http://localhost:8888/.netlify/functions/whatsapp-disconnect
POST http://localhost:8888/.netlify/functions/whatsapp-sync-user
POST http://localhost:8888/.netlify/functions/whatsapp-proxy
```

## Troubleshooting

### Functions not working
1. Ensure you're using `netlify dev` (not `npm run dev`)
2. Check Netlify CLI version: `netlify --version` (should be 17.0.0+)
3. Verify functions directory exists: `netlify/functions/`
4. Check function logs: `netlify functions:log whatsapp-status`

### WhatsApp connection fails
1. Verify `WHATSAPP_API_BASE_URL` in Netlify env vars
2. Check `WHATSAPP_API_KEY` is set correctly
3. Test backend directly: `curl https://lionfish-app-nmodi.ondigitalocean.app/api/health`
4. Check browser console for CORS errors

### QR code not appearing
1. Ensure WhatsApp session is not already active
2. Check function response in Network tab
3. Verify `qrImage` or `qr` field in response payload
4. QR expires after ~2 minutes - regenerate if needed

### Message sending fails
1. Confirm WhatsApp is connected (check status endpoint)
2. Verify phone number format: country code + number (no +, spaces, or dashes)
3. Check `clinicId` is included in request context
4. Review function logs: `netlify functions:log whatsapp-send-message`

## Deployment

### Deploy to Production
```bash
netlify deploy --prod
```

### Deploy Preview (Branch)
```bash
netlify deploy
```

### Set Environment Variables (Production)
```bash
netlify env:set WHATSAPP_API_KEY "your-actual-key"
netlify env:set WHATSAPP_API_BASE_URL "https://lionfish-app-nmodi.ondigitalocean.app"
```

## File Structure

```
project/
├── netlify/
│   └── functions/
│       ├── _shared/
│       │   └── whatsappClient.ts      # Shared helper (CORS, forwarding)
│       ├── whatsapp-connect.ts
│       ├── whatsapp-disconnect.ts
│       ├── whatsapp-status.ts
│       ├── whatsapp-qr.ts
│       ├── whatsapp-send-message.ts
│       ├── whatsapp-send-document.ts
│       ├── whatsapp-send-file-url.ts
│       ├── whatsapp-send-report.ts
│       ├── whatsapp-send-report-url.ts
│       ├── whatsapp-sync-user.ts
│       └── whatsapp-proxy.ts
├── src/
│   ├── services/
│   │   └── whatsappApi.ts            # Frontend API client
│   ├── hooks/
│   │   └── useWhatsApp.ts            # React hook for WhatsApp
│   └── components/
│       └── WhatsApp/
│           └── WhatsAppConnectionCard.tsx
├── netlify.toml                      # Netlify configuration
└── .env                              # Local environment variables
```

## Additional Resources

- [Netlify Functions Docs](https://docs.netlify.com/functions/overview/)
- [Netlify CLI Reference](https://cli.netlify.com/)
- [WhatsApp Integration Plan](./docs/whatsapp_integration_plan.md)
