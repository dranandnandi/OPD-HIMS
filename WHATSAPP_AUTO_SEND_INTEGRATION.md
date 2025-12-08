# WhatsApp Auto-Send Integration Guide

## Overview
This guide shows how to integrate WhatsApp auto-send functionality into existing components to automatically send messages for key events.

---

## Integration Points

### 1. Appointment Creation/Confirmation

**File**: `src/components/Appointments/AppointmentForm.tsx` or appointment service

**After appointment is created/confirmed:**

```typescript
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';

// After successful appointment creation
const handleAppointmentCreated = async (appointment: Appointment) => {
  try {
    // Existing appointment creation logic...
    
    // Trigger auto-send
    await WhatsAppAutoSendService.sendAppointmentConfirmation(
      appointment,
      patient,
      clinicSettings.clinicName,
      user.id,
      user.clinicId
    );
  } catch (error) {
    console.error('Failed to send appointment confirmation:', error);
    // Don't block the main flow - just log the error
  }
};
```

---

### 2. Bill Creation

**File**: `src/services/billingService.ts`

**Add to `createBill` function:**

```typescript
import { WhatsAppAutoSendService } from './whatsappAutoSendService';

export async function createBill(/* params */): Promise<Bill> {
  // Existing bill creation logic...
  
  const bill = /* created bill */;
  
  // Trigger auto-send (non-blocking)
  try {
    const clinicSettings = await getClinicSettings(user.clinicId);
    await WhatsAppAutoSendService.sendBillNotification(
      bill,
      patient,
      clinicSettings.clinicName,
      user.id,
      user.clinicId
    );
  } catch (error) {
    console.error('Failed to send bill notification:', error);
  }
  
  return bill;
}
```

---

### 3. Payment Receipt

**File**: `src/components/Billing/PaymentModal.tsx` or payment service

**After payment is recorded:**

```typescript
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';

const handlePaymentSuccess = async (bill: Bill, amountPaid: number) => {
  try {
    // Existing payment logic...
    
    // Trigger auto-send
    await WhatsAppAutoSendService.sendPaymentConfirmation(
      bill,
      patient,
      amountPaid,
      clinicSettings.clinicName,
      user.id,
      user.clinicId
    );
  } catch (error) {
    console.error('Failed to send payment confirmation:', error);
  }
};
```

---

### 4. GMB Review Request

**File**: `src/components/GMBReviewRequests/ReviewRequestForm.tsx`

**Replace Blueticks API with WhatsApp auto-send:**

**Before (with Blueticks):**
```typescript
const response = await fetch(\`\${VITE_SUPABASE_URL}/functions/v1/send-blueticks-message\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${session.access_token}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    clinicId,
    phoneNumber: patient.phone,
    message: reviewMessage
  })
});
```

**After (with WhatsApp auto-send):**
```typescript
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';

await WhatsAppAutoSendService.sendGMBReviewRequest(
  patient,
  clinicSettings.gmbLink || '',
  clinicSettings.clinicName,
  user.id,
  user.clinicId
);
```

---

### 5. Background Message Processing

**Create a new component**: `src/components/WhatsApp/MessageQueueProcessor.tsx`

```typescript
import React, { useEffect } from 'react';
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';
import { useAuth } from '../Auth/useAuth';

export const MessageQueueProcessor: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id || !user?.clinicId) return;

    // Process queue every 2 minutes
    const interval = setInterval(async () => {
      try {
        const sent = await WhatsAppAutoSendService.processPendingMessages(
          user.id,
          user.clinicId
        );
        if (sent > 0) {
          console.log(\`Processed \${sent} pending messages\`);
        }
      } catch (error) {
        console.error('Failed to process message queue:', error);
      }
    }, 2 * 60 * 1000); // 2 minutes

    return () => clearInterval(interval);
  }, [user?.id, user?.clinicId]);

  return null; // This is a background processor
};
```

**Add to App.tsx:**
```typescript
import { MessageQueueProcessor } from './components/WhatsApp/MessageQueueProcessor';

function App() {
  return (
    <AuthProvider>
      <MessageQueueProcessor />
      {/* Rest of your app */}
    </AuthProvider>
  );
}
```

---

## Settings Integration

**File**: `src/components/Settings/SettingsTabs.tsx`

**Add WhatsApp tab:**

```typescript
import WhatsAppAutoSendSettings from './WhatsAppAutoSendSettings';

const tabs = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'whatsapp', label: 'WhatsApp Auto-Send', icon: MessageSquare },
  // ... other tabs
];

{activeTab === 'whatsapp' && <WhatsAppAutoSendSettings />}
```

---

## Remove Blueticks Integration

### 1. Remove from Clinic Settings

**File**: `src/components/Settings/ClinicSettings.tsx`

**Remove these fields:**
- `blueticksApiKey`
- `enableBlueticksApiSend`

### 2. Update Types

**File**: `src/types/index.ts`

**Remove from ClinicSetting interface:**
```typescript
// Remove these lines:
blueticksApiKey?: string;
enableBlueticksApiSend?: boolean;
```

### 3. Delete Supabase Function

**Delete**: `supabase/functions/send-blueticks-message/`

### 4. Update Database Migration

Create new migration to remove Blueticks columns:

```sql
-- Remove Blueticks columns
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS blueticks_api_key;
ALTER TABLE clinic_settings DROP COLUMN IF EXISTS enable_blueticks_api_send;

-- Update delivery method enum if it exists
ALTER TABLE reviews ALTER COLUMN delivery_method TYPE TEXT;
-- Update any references to 'blueticks_api' to 'whatsapp'
UPDATE reviews SET delivery_method = 'whatsapp' WHERE delivery_method = 'blueticks_api';
```

---

## Complete Example: Appointment Flow

```typescript
// src/components/Appointments/AppointmentForm.tsx

import { useState } from 'react';
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';
import { useAuth } from '../Auth/useAuth';
import { appointmentService } from '@/services/appointmentService';

const AppointmentForm: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (formData: AppointmentFormData) => {
    try {
      setLoading(true);

      // 1. Create appointment
      const appointment = await appointmentService.createAppointment(formData);

      // 2. Trigger auto-send (non-blocking)
      WhatsAppAutoSendService.sendAppointmentConfirmation(
        appointment,
        formData.patient,
        user.clinic.clinicName,
        user.id,
        user.clinicId
      ).catch(error => {
        console.error('Failed to send WhatsApp notification:', error);
        // Don't show error to user - message will be in queue for retry
      });

      // 3. Show success to user
      alert('Appointment created! WhatsApp notification queued.');
      
    } catch (error) {
      console.error('Failed to create appointment:', error);
      alert('Failed to create appointment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
};
```

---

## Complete Example: Bill Creation Flow

```typescript
// src/services/billingService.ts

import { WhatsAppAutoSendService } from './whatsappAutoSendService';

export async function createBill(
  billData: CreateBillInput,
  userId: string,
  clinicId: string
): Promise<Bill> {
  // 1. Create bill in database
  const bill = await createBillInDatabase(billData);

  // 2. Fetch patient and clinic details
  const [patient, clinicSettings] = await Promise.all([
    getPatient(bill.patientId),
    getClinicSettings(clinicId)
  ]);

  // 3. Trigger auto-send notification (don't await - let it queue)
  WhatsAppAutoSendService.sendBillNotification(
    bill,
    patient,
    clinicSettings.clinicName,
    userId,
    clinicId
  ).catch(error => {
    console.error('Failed to queue bill notification:', error);
  });

  return bill;
}
```

---

## Testing Checklist

### Manual Testing

1. **Enable Auto-Send Rules**
   - Go to Settings → WhatsApp Auto-Send
   - Enable "Appointment Confirmed" rule
   - Verify toggle switches to active

2. **Test Appointment Confirmation**
   - Create a new appointment
   - Check `whatsapp_message_queue` table for pending message
   - Wait for background processor or manually trigger
   - Verify message sent in WhatsApp

3. **Test Bill Notification**
   - Create a bill for a patient
   - Check queue for pending message
   - Verify message contains correct bill details

4. **Test GMB Review Request**
   - Complete a visit
   - Trigger review request
   - Verify message includes GMB link

### Database Verification

```sql
-- Check if rules are created
SELECT * FROM whatsapp_auto_send_rules WHERE clinic_id = 'your-clinic-id';

-- Check queued messages
SELECT * FROM whatsapp_message_queue WHERE clinic_id = 'your-clinic-id' AND status = 'pending';

-- Check sent messages
SELECT * FROM whatsapp_message_log WHERE clinic_id = 'your-clinic-id' ORDER BY sent_at DESC LIMIT 10;

-- Check templates
SELECT * FROM whatsapp_message_templates WHERE clinic_id = 'your-clinic-id';
```

---

## Monitoring and Debugging

### Check Queue Status

```typescript
// In browser console or admin panel
const { data } = await supabase
  .from('whatsapp_message_queue')
  .select('*')
  .eq('clinic_id', 'your-clinic-id')
  .order('created_at', { ascending: false });

console.table(data);
```

### View Failed Messages

```typescript
const { data } = await supabase
  .from('whatsapp_message_queue')
  .select('*')
  .eq('status', 'failed')
  .eq('clinic_id', 'your-clinic-id');

console.table(data);
```

### Retry Failed Message

```typescript
import { WhatsAppAutoSendService } from '@/services/whatsappAutoSendService';

await WhatsAppAutoSendService.sendQueuedMessage(
  'failed-message-id',
  'user-id',
  'clinic-id'
);
```

---

## Production Considerations

1. **Rate Limiting**: Implement rate limiting to avoid overwhelming WhatsApp API
2. **Retry Logic**: Max 3 retries with exponential backoff
3. **Dead Letter Queue**: Move messages that fail after 3 retries to a separate table
4. **Monitoring**: Set up alerts for high failure rates
5. **Audit Trail**: All messages logged in `whatsapp_message_log`

---

## Migration from Blueticks

1. Run database migration to remove Blueticks columns
2. Update all components to use WhatsAppAutoSendService
3. Remove Blueticks Supabase function
4. Test all message sending flows
5. Deploy changes
6. Monitor for any issues
7. Delete Blueticks API key from clinic settings

---

## Support

For issues or questions:
- Check `whatsapp_message_queue` for pending/failed messages
- Review `whatsapp_message_log` for sent message history
- Verify rules are enabled in `whatsapp_auto_send_rules`
- Check WhatsApp connection status
- Ensure user is synced to WhatsApp backend database
