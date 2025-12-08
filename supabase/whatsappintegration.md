# WhatsApp Integration Documentation - LIMS v2

## Overview

This LIMS application integrates with a custom WhatsApp backend service hosted on **DigitalOcean** to send messages, documents, and PDF reports to patients via WhatsApp. The system uses a proxy architecture where the React frontend calls Netlify Functions, which then forward requests to the WhatsApp backend API.

---

## Architecture

```
React Frontend (src/utils/whatsappAPI.ts)
    ↓
Netlify Functions (/.netlify/functions/whatsapp-*)
    ↓
WhatsApp Backend API (DigitalOcean)
    ↓
WhatsApp Business API / WhatsApp Web
```

---

## WhatsApp Backend Service

**Base URL**: `https://lionfish-app-nmodi.ondigitalocean.app`

**Environment Variable**: `VITE_WHATSAPP_API_BASE_URL` or `WHATSAPP_API_BASE_URL`

**API Authentication**: 
- Hardcoded API Key: `whatsapp-lims-secure-api-key-2024`
- Header Name: `X-API-Key`

**API Mode Configuration**: `VITE_WHATSAPP_API_MODE`
- Options: `rest`, `supabase-functions`, `netlify-functions`
- Default: `rest`
- **Currently using**: `netlify-functions` (proxy mode)

---

## Netlify Functions (Proxy Layer)

All WhatsApp operations go through Netlify Functions for CORS handling, authentication, and request transformation.

### Available Netlify Functions

| Function Name | Endpoint | Purpose |
|--------------|----------|---------|
| `whatsapp-connect.js` | `/.netlify/functions/whatsapp-connect` | Initialize WhatsApp connection and generate QR code |
| `whatsapp-disconnect.js` | `/.netlify/functions/whatsapp-disconnect` | Disconnect active WhatsApp session |
| `whatsapp-status.js` | `/.netlify/functions/whatsapp-status` | Check connection status and active sessions |
| `whatsapp-qr.js` | `/.netlify/functions/whatsapp-qr` | Retrieve latest QR code for scanning |
| `whatsapp-send-message.js` | `/.netlify/functions/whatsapp-send-message` | Send text messages |
| `whatsapp-send-document.js` | `/.netlify/functions/whatsapp-send-document` | Send PDF/document files (multipart upload) |
| `whatsapp-send-file-url.js` | `/.netlify/functions/whatsapp-send-file-url` | Send documents from URL |
| `sync-user-to-whatsapp.js` | `/.netlify/functions/sync-user-to-whatsapp` | Sync LIMS users to WhatsApp backend |
| `send-report.js` | `/.netlify/functions/send-report` | Send PDF reports with metadata |
| `send-report-url.js` | `/.netlify/functions/send-report-url` | Send reports from URL |
| `whatsapp-proxy.js` | `/.netlify/functions/whatsapp-proxy` | Generic proxy for all WhatsApp API calls |

---

## Backend API Endpoints

These are the actual endpoints on the DigitalOcean WhatsApp backend that Netlify Functions call.

### Connection Management

#### 1. Connect WhatsApp
**Endpoint**: `POST /api/users/{userId}/whatsapp/connect`
**Netlify Proxy**: `/.netlify/functions/whatsapp-connect`
**Purpose**: Generate QR code for WhatsApp connection
**Request**:
```json
{
  "userId": "uuid-string",
  "labId": "uuid-string"
}
```
**Response**:
```json
{
  "success": true,
  "qrCode": "base64-encoded-qr-image",
  "sessionId": "session-uuid"
}
```

#### 2. Check Connection Status
**Endpoint**: `GET /api/whatsapp/status?labId={labId}`
**Netlify Proxy**: `/.netlify/functions/whatsapp-status`
**Purpose**: Check if WhatsApp is connected
**Response**:
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "sessionId": "uuid",
        "isConnected": true,
        "phoneNumber": "+1234567890",
        "lastActivity": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

#### 3. Disconnect WhatsApp
**Endpoint**: `POST /api/whatsapp/disconnect`
**Netlify Proxy**: `/.netlify/functions/whatsapp-disconnect`
**Purpose**: Disconnect active WhatsApp session

---

### Message Sending

#### 4. Send Text Message
**Endpoint**: `POST /api/external/messages/send`
**Netlify Proxy**: `/.netlify/functions/whatsapp-send-message`
**Authentication**: `X-API-Key: whatsapp-lims-secure-api-key-2024`
**Request**:
```json
{
  "sessionId": "f1e86dc8-fd5a-4719-a94a-e49729d6ac14",
  "phoneNumber": "+1234567890",
  "content": "Your message text here"
}
```
**Response**:
```json
{
  "success": true,
  "messageId": "message-id-string",
  "message": "Message sent successfully"
}
```

#### 5. Send Document/PDF
**Endpoint**: `POST /api/external/reports/send`
**Netlify Proxy**: `/.netlify/functions/whatsapp-send-document`
**Content-Type**: `multipart/form-data`
**Authentication**: `X-API-Key: whatsapp-lims-secure-api-key-2024`
**Request** (multipart form):
```
sessionId: f1e86dc8-fd5a-4719-a94a-e49729d6ac14
phoneNumber: +1234567890
file: [binary file data]
fileName: report.pdf
caption: Your report is ready
```
**Response**:
```json
{
  "success": true,
  "messageId": "message-id",
  "message": "Document sent successfully"
}
```

---

### User Synchronization

#### 6. Sync User to WhatsApp Backend
**Endpoint**: `POST /api/whatsapp/sync-user`
**Netlify Proxy**: `/.netlify/functions/sync-user-to-whatsapp`
**Purpose**: Create/update users in WhatsApp backend database
**Request**:
```json
{
  "auth_id": "lims-user-uuid",
  "username": "user@example.com",
  "name": "Lab Name",
  "role": "admin",
  "clinic_name": "Example Lab",
  "clinic_address": "123 Main St, City",
  "contact_phone": "+1234567890",
  "contact_email": "lab@example.com",
  "whatsapp_integration_available": true,
  "max_sessions": 2
}
```

---

## Frontend API Layer

**Location**: `src/utils/whatsappAPI.ts`

### Main API Class: `WhatsAppAPI`

#### Key Methods

```typescript
// Connection Management
static async connectWhatsApp(): Promise<WhatsAppConnectionStatus>
static async disconnectWhatsApp(): Promise<WhatsAppConnectionStatus>
static async getConnectionStatus(): Promise<WhatsAppConnectionStatus>
static async getLatestQr(): Promise<{ qrCode?: string; rawQR?: string } | null>

// Message Sending
static async sendTextMessage(
  phoneNumber: string, 
  message: string,
  templateData?: Record<string, string>
): Promise<MessageResult>

static async sendReport(
  phoneNumber: string,
  reportFile: File,
  caption?: string,
  patientName?: string,
  testName?: string
): Promise<MessageResult>

static async sendReportFromUrl(
  phoneNumber: string,
  reportUrl: string,
  caption?: string,
  patientName?: string,
  testName?: string
): Promise<MessageResult>

static async sendDocument(
  phoneNumber: string,
  document: File,
  options?: {
    caption?: string;
    patientName?: string;
    testName?: string;
  }
): Promise<MessageResult>

// Session Management
static async getWhatsAppSessionId(): Promise<string | null>
static async getCurrentUserSession(): Promise<{ userId: string | null; user: any }>
```

### Helper Functions

```typescript
// Phone number validation and formatting
static validatePhoneNumber(phoneNumber: string): boolean
static formatPhoneNumber(phoneNumber: string): string // Returns E.164 format
```

---

## Database Schema

### WhatsApp Sync Fields in `users` Table

**Migration File**: `src/migrations/add_whatsapp_user_sync_fields.sql`

```sql
ALTER TABLE users ADD COLUMN whatsapp_user_id UUID;
ALTER TABLE users ADD COLUMN whatsapp_sync_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE users ADD COLUMN whatsapp_last_sync TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN whatsapp_sync_error TEXT;
ALTER TABLE users ADD COLUMN whatsapp_config JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN whatsapp_auto_sync BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN whatsapp_sync_version INTEGER DEFAULT 1;
```

**Sync Status Values**: `pending`, `synced`, `failed`

---

## React Components

### WhatsApp Page Components

**Location**: `src/components/WhatsApp/`

| Component | Purpose |
|-----------|---------|
| `WhatsAppDashboard.tsx` | Connection status and QR code display |
| `WhatsAppMessaging.tsx` | Send messages and reports interface |
| `MessageHistory.tsx` | View sent message history |
| `WhatsAppUserSyncManager.tsx` | Manage user synchronization |
| `WhatsAppConnectionManager.tsx` | Handle connection state |
| `WhatsAppSendButton.tsx` | Quick send button for reports |
| `WhatsAppSendModal.tsx` | Modal for sending messages |
| `QuickSendReport.tsx` | Quick report sending component |

### Main WhatsApp Page

**Location**: `src/pages/WhatsApp.tsx`

Provides tabbed interface:
1. **Connection Tab** - Connect/disconnect WhatsApp
2. **Send Message Tab** - Send text messages and documents
3. **Message History Tab** - View sent message log
4. **User Management Tab** - Sync users to WhatsApp backend

---

## User Synchronization System

**Location**: `src/utils/whatsappUserSync.ts`

### WhatsAppUserSyncService

Automatically syncs LIMS users to WhatsApp backend when:
- New users are created
- User details are updated (name, email, role, lab)
- Lab details are changed

**Auto-sync Hook**: `src/hooks/useWhatsAppAutoSync.ts`

```typescript
import { useWhatsAppAutoSync } from './hooks/useWhatsAppAutoSync';

// In your App component
const App = () => {
  useWhatsAppAutoSync(); // Enables automatic user synchronization
  // ... rest of app
};
```

### Sync Trigger Events

1. **New User Created** → Auto-sync to WhatsApp backend
2. **User Updated** → Re-sync if relevant fields changed
3. **Lab Updated** → Mark all lab users for re-sync

---

## Message Flow Examples

### Example 1: Send Text Message

```typescript
import { WhatsAppAPI } from './utils/whatsappAPI';

const sendTextMessage = async () => {
  const result = await WhatsAppAPI.sendTextMessage(
    '+1234567890',
    'Hello from LIMS!',
    { PatientName: 'John Doe' } // Optional template data
  );
  
  if (result.success) {
    console.log('Message sent:', result.messageId);
  } else {
    console.error('Failed:', result.message);
  }
};
```

### Example 2: Send PDF Report

```typescript
import { WhatsAppAPI } from './utils/whatsappAPI';

const sendReport = async (reportFile: File, patientPhone: string) => {
  const result = await WhatsAppAPI.sendReport(
    patientPhone,
    reportFile,
    'Your test report is ready',
    'John Doe',
    'Blood Test'
  );
  
  if (result.success) {
    console.log('Report sent:', result.messageId);
  }
};
```

### Example 3: Send Report from URL

```typescript
import { WhatsAppAPI } from './utils/whatsappAPI';

const sendReportUrl = async (reportUrl: string, patientPhone: string) => {
  const result = await WhatsAppAPI.sendReportFromUrl(
    patientPhone,
    reportUrl,
    'Your report is attached',
    'John Doe',
    'Complete Blood Count'
  );
  
  if (result.success) {
    console.log('Report URL sent:', result.messageId);
  }
};
```

---

## Configuration & Environment Variables

### Required Environment Variables

```env
# WhatsApp Backend URL
VITE_WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app

# API Mode (rest, supabase-functions, or netlify-functions)
VITE_WHATSAPP_API_MODE=netlify-functions

# WebSocket Support (optional)
VITE_WHATSAPP_WS_ENABLED=true
VITE_WHATSAPP_WS_URL=wss://lionfish-app-nmodi.ondigitalocean.app/ws

# Debug Logging (optional)
VITE_WHATSAPP_WS_DEBUG=true
```

### Hardcoded Configuration

**Active Session ID**: `f1e86dc8-fd5a-4719-a94a-e49729d6ac14` (in `whatsappAPI.ts`)
**API Key**: `whatsapp-lims-secure-api-key-2024` (in Netlify functions)

---

## Phone Number Format

All phone numbers must be in **E.164 format**:
- Include country code
- No spaces, dashes, or special characters
- Example: `+12345678901`

**Validation Pattern**: `/^\+?[1-9]\d{1,14}$/`

---

## Error Handling

### Common Error Responses

```typescript
interface MessageResult {
  success: boolean;
  messageId?: string;
  message: string;
  error?: string;
}
```

**Error Cases**:
- User not authenticated: `"User or lab not available"`
- Invalid phone number: `"Invalid phone number format"`
- Connection failed: `"Connection failed: [error details]"`
- Backend error: `"WhatsApp API error: [error message]"`

---

## Security & Authentication

1. **Supabase Authentication**: All API calls require valid Supabase session token
2. **Lab Context**: Every operation is scoped to user's lab (`lab_id`)
3. **API Key**: Backend requires `X-API-Key` header with hardcoded key
4. **CORS**: Netlify Functions handle CORS headers for all requests

---

## Deployment Checklist

To implement this WhatsApp integration in another app:

1. ✅ Set up DigitalOcean WhatsApp backend (or use same instance)
2. ✅ Configure environment variables (`VITE_WHATSAPP_API_BASE_URL`)
3. ✅ Copy Netlify Functions from `netlify/functions/whatsapp-*.js`
4. ✅ Copy frontend API layer: `src/utils/whatsappAPI.ts`
5. ✅ Copy user sync service: `src/utils/whatsappUserSync.ts`
6. ✅ Copy React components from `src/components/WhatsApp/`
7. ✅ Add WhatsApp fields to users table (run migration SQL)
8. ✅ Set up auto-sync hook: `src/hooks/useWhatsAppAutoSync.ts`
9. ✅ Add WhatsApp page route: `src/pages/WhatsApp.tsx`
10. ✅ Update Supabase policies for WhatsApp fields
11. ✅ Configure API key in Netlify environment variables

---

## Key Dependencies

**Frontend** (TypeScript/React):
- `@supabase/supabase-js` - Database and authentication
- React hooks for state management
- Fetch API for HTTP requests

**Backend** (Node.js - Netlify Functions):
- `globalThis.fetch` or `node-fetch` - HTTP client
- No external WhatsApp libraries (uses custom backend)

**No Twilio, no whatsapp-web.js** - Fully custom implementation

---

## WebSocket Support (Real-time Updates)

**Optional Feature**: Real-time connection status and message updates

**WebSocket URL**: `wss://lionfish-app-nmodi.ondigitalocean.app/ws`
**Enable**: Set `VITE_WHATSAPP_WS_ENABLED=true`

```typescript
// WebSocket connection managed in whatsappAPI.ts
// Provides real-time updates for:
// - QR code generation
// - Connection status changes
// - Message delivery updates
```

---

## Testing & Debugging

### Test Connection
```typescript
const status = await WhatsAppAPI.getConnectionStatus();
console.log('Connected:', status.isConnected);
console.log('Phone:', status.phoneNumber);
```

### Enable Debug Logging
```env
VITE_WHATSAPP_WS_DEBUG=true
```

### Check Netlify Function Logs
```bash
netlify functions:log whatsapp-send-message
```

---

## Summary

This LIMS application uses a **custom WhatsApp backend** hosted on **DigitalOcean** (`lionfish-app-nmodi.ondigitalocean.app`). The architecture uses:

1. **Netlify Functions** as a proxy layer for CORS and authentication
2. **Custom REST API** on DigitalOcean backend (not Twilio, not whatsapp-web.js)
3. **User synchronization** between LIMS and WhatsApp backend databases
4. **Multi-mode support** (REST, Supabase Functions, Netlify Functions)
5. **Real-time WebSocket** updates for connection status
6. **File upload** support for PDF reports and documents

All message sending, connection management, and user synchronization flows through this architecture.

---

## Contact & Support

**Backend Service**: DigitalOcean App Platform
**Service URL**: https://lionfish-app-nmodi.ondigitalocean.app
**API Documentation**: Custom REST API (no public docs)
**Authentication**: Supabase JWT + Custom API Key

For implementation in other apps, reuse the same backend service URL and follow the deployment checklist above.
