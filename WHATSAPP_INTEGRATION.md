# WhatsApp Integration Documentation

## Overview
This document describes the complete WhatsApp messaging integration for the OPD Management System, using a shared DigitalOcean backend service with per-user session management.

---

## Architecture

### Backend Service
- **URL**: `https://lionfish-app-nmodi.ondigitalocean.app`
- **Authentication**: API Key-based
- **API Pattern**: Per-user endpoints (`/api/users/{userId}/whatsapp/*`)
- **Database**: Neon PostgreSQL for user synchronization

### Frontend Architecture
- **Proxy Layer**: Netlify Functions (12 serverless functions)
- **Client Library**: `src/services/whatsappApi.ts` - Type-safe WhatsApp API client
- **UI Components**: `src/components/WhatsApp/WhatsAppConnectionCard.tsx`
- **Auto-sync**: Users automatically synced to WhatsApp backend on login

---

## Environment Variables

### Required Netlify Environment Variables

```bash
# WhatsApp Backend Configuration
WHATSAPP_API_BASE_URL=https://lionfish-app-nmodi.ondigitalocean.app
WHATSAPP_API_KEY=whatsapp-lims-secure-api-key-2024

# Database Connection (for user sync)
WHATSAPP_DB_CONNECTION_STRING=postgresql://neondb_owner:npg_HclN2sBL5OIF@ep-solitary-salad-a1alphes-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

**To set in Netlify:**
1. Go to Netlify Dashboard → Site Settings → Environment Variables
2. Add each variable with the values above
3. Redeploy for changes to take effect

---

## Database Schema

### Users Table (WhatsApp Backend Database)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id TEXT UNIQUE NOT NULL,           -- OPD system user ID
  username TEXT UNIQUE NOT NULL,           -- Email from OPD system
  full_name TEXT,                         -- User's full name
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_username ON users(username);
```

**Key Points:**
- `id` (UUID): Internal WhatsApp backend user ID (used in all API calls)
- `auth_id`: Maps to OPD system's Supabase auth user ID
- Auto-sync creates/updates users on login

---

## API Endpoints Reference

### Connection Management

#### 1. Generate QR Code
**Endpoint**: `POST /api/users/{userId}/whatsapp/connect`

**Request:**
```json
{
  "userId": "backend-user-uuid",
  "labId": "clinic-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "uuid",
    "qrCode": "2@jp5ZGqI1IWR5...",  // Raw WhatsApp pairing string
    "success": true
  },
  "message": "WhatsApp connection initiated"
}
```

**Frontend Usage:**
- QR string is converted to scannable image using `qrcode` library
- Display QR for user to scan with WhatsApp mobile app
- QR expires in ~2 minutes

---

#### 2. Check Connection Status
**Endpoint**: `GET /api/users/{userId}/whatsapp/status`

**Response:**
```json
{
  "success": true,
  "data": {
    "sessions": [{
      "sessionId": "uuid",
      "isConnected": true,
      "phoneNumber": "919909249725",
      "lastActivity": "2025-11-18T04:49:42.232Z",
      "businessName": "Clinic Name",
      "queueSize": 0
    }]
  }
}
```

**Normalized Frontend Response:**
```json
{
  "connected": true,
  "phoneNumber": "919909249725",
  "sessionId": "uuid",
  "businessName": "Clinic Name",
  "lastSyncAt": "2025-11-18T04:49:42.232Z",
  "queueSize": 0
}
```

---

#### 3. Disconnect Session
**Endpoint**: `POST /api/users/{userId}/whatsapp/disconnect`

**Response:**
```json
{
  "success": true,
  "message": "Session disconnected successfully"
}
```

---

### Message Sending

#### 4. Send Text Message
**Endpoint**: `POST /api/users/{userId}/whatsapp/send-message`

**Request:**
```json
{
  "phoneNumber": "919909249725",
  "phone": "919909249725",        // Alias for compatibility
  "text": "Hello from clinic",
  "message": "Hello from clinic", // Alias for compatibility
  "labId": "clinic-id",
  "channel": "OPD"
}
```

**Field Mapping:**
- Both `phoneNumber` and `phone` sent for compatibility
- Both `text` and `message` sent for compatibility
- Backend uses whichever field it expects

**Response:**
```json
{
  "success": true,
  "messageId": "uuid",
  "message": "Message sent successfully"
}
```

---

#### 5. Send Document
**Endpoint**: `POST /api/users/{userId}/whatsapp/send-document`

**Request:**
```json
{
  "phoneNumber": "919909249725",
  "phone": "919909249725",
  "fileBase64": "base64-encoded-file-content",
  "fileName": "prescription.pdf",
  "caption": "Your prescription",
  "labId": "clinic-id"
}
```

---

#### 6. Send File via URL
**Endpoint**: `POST /api/users/{userId}/whatsapp/send-file-url`

**Request:**
```json
{
  "phoneNumber": "919909249725",
  "phone": "919909249725",
  "fileUrl": "https://example.com/document.pdf",
  "caption": "Your report",
  "labId": "clinic-id"
}
```

---

#### 7. Send Report (HTML/PDF)
**Endpoint**: `POST /api/users/{userId}/whatsapp/send-report`

**Request:**
```json
{
  "phoneNumber": "919909249725",
  "phone": "919909249725",
  "reportHtml": "<html>...</html>",
  "reportPdfBase64": "base64-pdf-content",
  "patient": { "name": "John Doe", "id": "uuid" },
  "visit": { "id": "uuid", "date": "2025-11-18" },
  "labId": "clinic-id"
}
```

---

#### 8. Send Report via URL
**Endpoint**: `POST /api/users/{userId}/whatsapp/send-report-url`

**Request:**
```json
{
  "phoneNumber": "919909249725",
  "phone": "919909249725",
  "reportUrl": "https://example.com/report.pdf",
  "caption": "Lab report",
  "labId": "clinic-id"
}
```

---

## Netlify Functions

### Function List

| Function | Purpose | API Endpoint |
|----------|---------|-------------|
| `whatsapp-qr.ts` | Generate QR code | `/api/users/{userId}/whatsapp/connect` |
| `whatsapp-status.ts` | Check connection status | `/api/users/{userId}/whatsapp/status` |
| `whatsapp-connect.ts` | Initiate connection | `/api/users/{userId}/whatsapp/connect` |
| `whatsapp-disconnect.ts` | Disconnect session | `/api/users/{userId}/whatsapp/disconnect` |
| `whatsapp-send-message.ts` | Send text message | `/api/users/{userId}/whatsapp/send-message` |
| `whatsapp-send-document.ts` | Send document (base64) | `/api/users/{userId}/whatsapp/send-document` |
| `whatsapp-send-file-url.ts` | Send file via URL | `/api/users/{userId}/whatsapp/send-file-url` |
| `whatsapp-send-report.ts` | Send report (HTML/PDF) | `/api/users/{userId}/whatsapp/send-report` |
| `whatsapp-send-report-url.ts` | Send report via URL | `/api/users/{userId}/whatsapp/send-report-url` |
| `whatsapp-sync-user.ts` | Manual user sync | `/api/whatsapp/sync-user` |
| `whatsapp-proxy.ts` | Generic proxy | Custom path |
| `sync-user-to-whatsapp-db.ts` | Sync user to database | N/A (internal) |

---

### Shared Helpers

#### `netlify/functions/_shared/whatsappClient.ts`
- **Purpose**: Common utilities for all WhatsApp functions
- **Exports**:
  - `forwardToWhatsApp()`: Proxy requests to backend with auth
  - `parseRequestBody()`: Parse JSON request bodies
  - `ensureLabContext()`: Validate required context fields
  - `ok()`, `error()`: Standardized response helpers
  - `corsHeaders`: CORS configuration

#### `netlify/functions/_shared/userLookup.ts`
- **Purpose**: Map OPD user ID to WhatsApp backend user ID
- **Key Function**:
```typescript
async function getUserIdFromAuthId(authId: string): Promise<string | null>
```
- Queries PostgreSQL database
- Returns internal UUID for API calls
- Returns null if user not found

---

## Frontend Integration

### WhatsApp API Client

**File**: `src/services/whatsappApi.ts`

**Usage Example:**
```typescript
import { whatsappApi } from '@/services/whatsappApi';

// Check status
const status = await whatsappApi.getStatus({}, { 
  userId: user.id, 
  clinicId: user.clinicId 
});

// Generate QR
const qrData = await whatsappApi.getQr({}, { 
  userId: user.id, 
  clinicId: user.clinicId 
});

// Send message
await whatsappApi.sendMessage({
  phone: '919909249725',
  message: 'Hello from clinic',
  metadata: { source: 'OPD_APP' }
}, { 
  userId: user.id, 
  clinicId: user.clinicId 
});
```

---

### UI Component

**File**: `src/components/WhatsApp/WhatsAppConnectionCard.tsx`

**Features:**
- Connection status indicator (Connected/Not Connected)
- QR code generation and display
- Session details (phone number, business name, last sync)
- Disconnect functionality
- Test message form

**QR Code Generation:**
```typescript
import QRCodeLib from 'qrcode';

// Convert raw WhatsApp pairing string to scannable QR image
const qrDataUrl = await QRCodeLib.toDataURL(qrString, {
  errorCorrectionLevel: 'M',
  type: 'image/png',
  margin: 4,
  width: 300,
  color: {
    dark: '#000000',
    light: '#FFFFFF'
  }
});
```

---

### User Synchronization

**Auto-sync on Login:**
- `src/components/Auth/AuthProvider.tsx` calls sync after profile load
- `src/services/whatsappUserSyncService.ts` handles sync logic

**Sync Process:**
1. Extract user data (id, email, name)
2. Call `sync-user-to-whatsapp-db` Netlify function
3. Function checks if user exists in database
4. UPDATE if exists, INSERT if new
5. UUID generated automatically for new users

**Manual Sync:**
```typescript
import { WhatsAppUserSyncService } from '@/services/whatsappUserSyncService';

await WhatsAppUserSyncService.syncCurrentUser();
```

---

## Data Flow

### 1. User Login Flow
```
User Login
    ↓
AuthProvider loads profile
    ↓
WhatsAppUserSyncService.syncCurrentUser()
    ↓
sync-user-to-whatsapp-db function
    ↓
PostgreSQL: INSERT/UPDATE user
    ↓
User ready for WhatsApp operations
```

---

### 2. Generate QR Code Flow
```
User clicks "Generate QR"
    ↓
whatsappApi.getQr({ userId, clinicId })
    ↓
whatsapp-qr Netlify function
    ↓
getUserIdFromAuthId(auth_id) → backend UUID
    ↓
POST /api/users/{backendUserId}/whatsapp/connect
    ↓
Backend returns raw QR string
    ↓
Normalize response: extract qrCode from nested data
    ↓
Frontend: QRCodeLib.toDataURL(qrString)
    ↓
Display scannable QR image
    ↓
User scans with WhatsApp mobile
    ↓
Session established
```

---

### 3. Send Message Flow
```
User enters phone & message
    ↓
whatsappApi.sendMessage({ phone, message, userId, clinicId })
    ↓
whatsapp-send-message Netlify function
    ↓
getUserIdFromAuthId(auth_id) → backend UUID
    ↓
POST /api/users/{backendUserId}/whatsapp/send-message
    ↓
Payload: { phoneNumber, phone, text, message, labId }
    ↓
Backend sends WhatsApp message
    ↓
Response: { success, messageId }
```

---

## Error Handling

### Common Error Scenarios

#### 1. User Not Found (404)
**Cause**: User not synced to WhatsApp backend database
**Solution**: 
- Auto-sync runs on login
- Manual sync: `WhatsAppUserSyncService.syncCurrentUser()`

#### 2. Invalid Phone Number
**Cause**: Phone number format incorrect
**Format**: Country code + number (e.g., `919909249725`)
**No spaces, dashes, or special characters**

#### 3. QR Code Expired
**Cause**: QR code not scanned within ~2 minutes
**Solution**: Click "Generate QR" again

#### 4. Session Disconnected
**Cause**: User logged out of WhatsApp Web/Mobile
**Solution**: Reconnect by generating new QR code

---

## Field Naming Reference

### User Identification
| Frontend | Netlify Function | Backend API | Database |
|----------|-----------------|-------------|----------|
| `user.id` | `authId` | N/A | `auth_id` |
| N/A | `backendUserId` | `userId` | `id` |

### Phone Number
| Field Name | Used By |
|------------|---------|
| `phone` | Frontend, legacy compatibility |
| `phoneNumber` | Backend API |
| `to` | Alternative alias |

**Best Practice**: Send both `phone` and `phoneNumber` in requests

### Message Content
| Field Name | Used By |
|------------|---------|
| `message` | Frontend, legacy compatibility |
| `text` | Backend API |

**Best Practice**: Send both `message` and `text` in requests

### Clinic/Lab Context
| Field Name | Used By |
|------------|---------|
| `clinicId` | OPD Frontend |
| `labId` | Backend API, LIMS system |

**Best Practice**: Send both, mapped automatically by functions

---

## Testing Guide

### 1. Test Connection Setup
```typescript
// Navigate to WhatsApp settings in UI
// Click "Connect" → "Generate QR"
// Scan QR with WhatsApp mobile app
// Verify status shows "Connected"
```

### 2. Test Message Sending
```typescript
// Use "Send Test Message" form
// Enter phone: 919909249725
// Click "Send Test Message"
// Verify message received on WhatsApp
```

### 3. Test Programmatic Sending
```typescript
import { whatsappApi } from '@/services/whatsappApi';

const context = { 
  userId: 'user-uuid', 
  clinicId: 'clinic-uuid' 
};

// Send simple message
await whatsappApi.sendMessage({
  phone: '919909249725',
  message: 'Test from API',
  metadata: { test: true }
}, context);

// Send document
await whatsappApi.sendDocument({
  phone: '919909249725',
  fileName: 'report.pdf',
  fileBase64: 'base64-content',
  caption: 'Your report'
}, context);
```

---

## Deployment Checklist

### Initial Setup
- [ ] Set environment variables in Netlify
- [ ] Deploy functions: `netlify deploy --prod`
- [ ] Verify database connection
- [ ] Test user auto-sync on login

### Per-deployment
- [ ] Run `npm run build` to compile frontend
- [ ] Deploy: `netlify deploy --prod --skip-functions-cache`
- [ ] Check function logs for errors
- [ ] Test QR generation
- [ ] Test message sending

### Monitoring
- [ ] Check Netlify function logs
- [ ] Monitor database connections
- [ ] Track API error rates
- [ ] Verify user sync success rate

---

## Troubleshooting

### QR Code Not Displaying
**Check:**
1. Browser console for errors
2. Response contains `qrCode` field
3. `qrcode` npm package installed
4. User synced to database

### Messages Not Sending
**Check:**
1. WhatsApp session connected (status check)
2. Phone number format correct (country code + number)
3. User ID mapping correct (check database)
4. Backend API responding (check Netlify logs)

### Status Shows "Not Connected" (but it is)
**Check:**
1. Response normalization in `whatsapp-status.ts`
2. Sessions array structure matches expected format
3. Frontend parsing `connected` field correctly

### Function Errors (404/500)
**Check:**
1. Environment variables set correctly
2. Database connection string valid
3. API key authentication working
4. User exists in WhatsApp backend database

---

## Dependencies

### NPM Packages
```json
{
  "dependencies": {
    "qrcode": "^1.5.x",
    "pg": "^8.16.x"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.x",
    "@types/pg": "^8.15.x"
  }
}
```

### Netlify Functions Dependencies
- `@netlify/functions`: Serverless function runtime
- Built-in: No additional dependencies needed (uses Node.js standard library)

---

## Security Considerations

1. **API Key Protection**: Never expose `WHATSAPP_API_KEY` in frontend code
2. **Database Credentials**: Stored only in Netlify environment variables
3. **User Authorization**: All functions validate user context
4. **QR Code Security**: QR strings not logged, cleared after session established
5. **CORS**: Properly configured in all Netlify functions
6. **SQL Injection**: Parameterized queries used throughout

---

## Performance Optimization

1. **Connection Pooling**: PostgreSQL connections pooled in `userLookup.ts`
2. **Response Caching**: Status can be cached client-side (60s TTL recommended)
3. **Parallel Requests**: Independent operations can run concurrently
4. **Error Handling**: Fast-fail on validation errors
5. **Auto-retry**: Not implemented (add if needed for production)

---

## Future Enhancements

### Planned
- [ ] Unit tests for Netlify functions
- [ ] Integration tests for end-to-end flows
- [ ] Message templates system
- [ ] Bulk message sending
- [ ] Message delivery status tracking
- [ ] Webhook support for incoming messages

### Nice-to-Have
- [ ] Message scheduling
- [ ] Rich media support (images, videos)
- [ ] Group messaging
- [ ] Analytics dashboard
- [ ] Rate limiting
- [ ] Message queue for high volume

---

## Support Resources

### Documentation
- WhatsApp Business API: [Official Docs](https://developers.facebook.com/docs/whatsapp)
- Netlify Functions: [Official Docs](https://docs.netlify.com/functions/overview/)
- QR Code Library: [npm qrcode](https://www.npmjs.com/package/qrcode)

### Backend Service
- **URL**: https://lionfish-app-nmodi.ondigitalocean.app
- **Status**: Check `/health` endpoint
- **Logs**: Access via DigitalOcean dashboard

### Database
- **Provider**: Neon PostgreSQL
- **Dashboard**: https://console.neon.tech
- **Connection**: Via connection string in env variables

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-11-18 | Initial implementation with per-user API support |
| 1.1 | 2025-11-18 | Added QR code generation and display |
| 1.2 | 2025-11-18 | Fixed status normalization for sessions array |
| 1.3 | 2025-11-18 | Updated all send functions to per-user paths |
| 1.4 | 2025-11-18 | Added field name compatibility (phone/phoneNumber, message/text) |

---

## Contact

For technical issues or questions about this integration:
- Review function logs in Netlify dashboard
- Check database connection in Neon console
- Verify environment variables are set correctly
- Test with provided examples in this documentation
