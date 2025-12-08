# 📱 OPD Management - Mobile App Integration

## ✨ What's New

Your OPD Management system now includes a **native Android mobile app** with:

- 📲 **Push Notifications** via Firebase Cloud Messaging
- 🔔 **Real-time Updates** for appointments, visits, and bills
- 📱 **Native Android Experience** with offline support
- 🚀 **Easy Deployment** - build APK with one command

---

## 🎯 Quick Start

### Prerequisites
- Node.js 18+
- Android Studio
- Java JDK 17+
- Firebase account
- Existing Supabase project

### 5-Minute Setup

```bash
# 1. Install dependencies (already done)
✅ npm install

# 2. Build web app
npm run build

# 3. Add Android platform
npm run cap:add:android

# 4. Configure Firebase (see MOBILE_APP_SETUP.md)
# 5. Build and run
npm run cap:run:android
```

---

## 📚 Documentation

### For Developers
- **[Complete Setup Guide](MOBILE_APP_SETUP.md)** - Step-by-step instructions
- **[Quick Reference](MOBILE_QUICK_REFERENCE.md)** - Common commands and troubleshooting

### Key Files Created
- `capacitor.config.ts` - App configuration
- `src/services/notificationService.ts` - Push notification logic
- `src/utils/mobileApp.ts` - Mobile app initialization
- `supabase/migrations/20251208000000_create_device_tokens_table.sql` - Database schema
- `send-notification-to-all.js` - Backend notification sender

---

## 🔧 Available Commands

### Development
```bash
npm run dev                   # Web development server
npm run build                 # Build web app
npm run cap:sync:android      # Sync changes to Android
npm run cap:open:android      # Open in Android Studio
npm run cap:run:android       # Build and run on device
```

### Building
```bash
npm run android:build         # Build debug APK
npm run android:release       # Build release APK (production)
npm run android:clean         # Clean build cache
```

### Testing Notifications
```bash
# Send to all users
node send-notification-to-all.js "Title" "Message"

# Send to specific user
node send-notification-to-all.js --user USER_ID "Title" "Message"
```

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React + TypeScript + Vite
- **Mobile**: Capacitor (Android native)
- **Push**: Firebase Cloud Messaging
- **Database**: Supabase (PostgreSQL)
- **Build**: Gradle (Android)

### Data Flow
```
User Device → FCM Token Generated
           ↓
App saves token → Supabase database
           ↓
Backend sends notification → Firebase
           ↓
Firebase delivers → User's device
```

---

## 📦 What's Installed

### New Dependencies
- `@capacitor/core` - Capacitor framework
- `@capacitor/android` - Android platform
- `@capacitor/push-notifications` - FCM integration
- `@capacitor/local-notifications` - Local notifications
- `@capacitor/dialog` - Native dialogs
- `@capacitor/app` - App lifecycle

### New Files Structure
```
project/
├── android/                  # Native Android project
├── capacitor.config.ts       # Capacitor configuration
├── src/
│   ├── services/
│   │   └── notificationService.ts
│   └── utils/
│       └── mobileApp.ts
├── supabase/migrations/
│   └── 20251208000000_create_device_tokens_table.sql
├── MOBILE_APP_SETUP.md
├── MOBILE_QUICK_REFERENCE.md
└── send-notification-to-all.js
```

---

## 🔐 Security Setup

### 1. Database Migration
Run in Supabase SQL Editor:
```sql
-- File: supabase/migrations/20251208000000_create_device_tokens_table.sql
-- This creates the device_tokens table with RLS policies
```

### 2. Environment Variables
Create `.env` file (copy from `.env.example`):
```bash
VITE_SUPABASE_URL=your-url
VITE_SUPABASE_ANON_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. Firebase Configuration
1. Create Firebase project
2. Add Android app
3. Download `google-services.json`
4. Place in `android/app/google-services.json`
5. Download service account JSON for backend

**⚠️ IMPORTANT**: Never commit these files:
- `android/app/google-services.json`
- `firebase-service-account.json`
- `.env`

Already added to `.gitignore` ✅

---

## 🚀 Integration with Existing App

### Update Your App.tsx

Add this code to initialize mobile features:

```typescript
import { useEffect } from 'react';
import { initializeMobileApp, isMobileApp } from './utils/mobileApp';

function App() {
  useEffect(() => {
    // Initialize mobile app features
    initializeMobileApp();
    
    // Listen for notification taps
    const handleNotification = (event: CustomEvent) => {
      const { type, patientId, appointmentId, billId } = event.detail;
      
      // Handle navigation based on notification type
      switch (type) {
        case 'appointment':
          navigate(`/appointments?id=${appointmentId}`);
          break;
        case 'patient':
        case 'visit':
          navigate(`/patients/${patientId}`);
          break;
        case 'bill':
          navigate(`/billing?id=${billId}`);
          break;
        default:
          navigate('/');
      }
    };
    
    window.addEventListener('notification-received', handleNotification as EventListener);
    
    return () => {
      window.removeEventListener('notification-received', handleNotification as EventListener);
    };
  }, []);

  // Check if running on mobile
  if (isMobileApp()) {
    console.log('Running as mobile app!');
  }

  // Rest of your app...
}
```

---

## 📲 Sending Notifications from Your App

### Example: Send Appointment Reminder

```typescript
// In your backend or Supabase Edge Function
import { createClient } from '@supabase/supabase-js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// Initialize Firebase
const serviceAccount = require('./firebase-service-account.json');
initializeApp({ credential: cert(serviceAccount) });

async function sendAppointmentReminder(userId: string, appointmentDetails: any) {
  // Get user's device tokens
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('fcm_token')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (!tokens || tokens.length === 0) return;

  // Send notification to each device
  for (const tokenInfo of tokens) {
    const message = {
      notification: {
        title: 'Appointment Reminder',
        body: `Your appointment is tomorrow at ${appointmentDetails.time}`
      },
      data: {
        type: 'appointment',
        appointmentId: appointmentDetails.id,
        title: 'Appointment Reminder',
        body: `Your appointment is tomorrow at ${appointmentDetails.time}`
      },
      token: tokenInfo.fcm_token
    };

    await getMessaging().send(message);
  }
}
```

---

## 🧪 Testing

### Test Push Notifications

1. **Build and install app on device**
   ```bash
   npm run cap:run:android
   ```

2. **Get FCM token from Logcat**
   - Android Studio → Logcat
   - Filter: "FCM Token"
   - Copy the token

3. **Test from Firebase Console**
   - Firebase Console → Cloud Messaging
   - "Send your first message"
   - Paste token and send

4. **Test with backend script**
   ```bash
   node send-notification-to-all.js "Test" "This is a test notification"
   ```

### Verify Database
```sql
-- Check registered devices
SELECT * FROM device_tokens WHERE is_active = true;

-- Check by user
SELECT * FROM device_tokens WHERE user_id = 'USER_ID';
```

---

## 📈 Next Steps

### Immediate Tasks
1. ✅ Run database migration
2. ✅ Set up Firebase project
3. ✅ Configure `google-services.json`
4. ✅ Build and test on device
5. ✅ Test notifications

### Enhancement Ideas
- 🔔 Schedule appointment reminders
- 📊 Send daily/weekly reports
- 💊 Medicine intake reminders
- 📅 Follow-up notifications
- 🎯 Custom notification types per user role

### Production Deployment
1. Generate release keystore
2. Configure signing in `build.gradle`
3. Build release APK: `npm run android:release`
4. (Optional) Submit to Google Play Store

---

## 🆘 Troubleshooting

### Common Issues

**Problem**: No FCM token generated
- ✅ Check Firebase Cloud Messaging API is enabled
- ✅ Verify `google-services.json` is in `android/app/`
- ✅ Check SHA-1 fingerprint is added to Firebase

**Problem**: Notification not received
- ✅ Check device token is in database and active
- ✅ Verify notification payload format
- ✅ Test from Firebase Console first

**Problem**: App crashes on launch
- ✅ Check Logcat for error details
- ✅ Clean build: `npm run android:clean`
- ✅ Sync again: `npm run cap:sync:android`

See **[MOBILE_QUICK_REFERENCE.md](MOBILE_QUICK_REFERENCE.md)** for more troubleshooting tips.

---

## 📞 Support

### Resources
- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Complete Setup Guide](MOBILE_APP_SETUP.md)
- [Quick Reference](MOBILE_QUICK_REFERENCE.md)

### Need Help?
1. Check the troubleshooting section
2. Review Logcat for errors
3. Verify all configuration files
4. Refer to complete blueprint document

---

## 🎉 You're All Set!

Your OPD Management system now has a powerful mobile app with push notifications!

**Next step**: Follow **[MOBILE_APP_SETUP.md](MOBILE_APP_SETUP.md)** for detailed setup instructions.

Happy building! 🚀
