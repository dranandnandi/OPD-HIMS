# 🚀 Mobile App Quick Commands

## Initial Setup (One Time)
```bash
# 1. Build web app
npm run build

# 2. Add Android platform
npm run cap:add:android

# 3. Place google-services.json in android/app/

# 4. Open in Android Studio
npm run cap:open:android

# 5. Configure as per MOBILE_APP_SETUP.md
```

## Daily Development Workflow
```bash
# Make changes to web code (src/*)
# Then sync to Android:
npm run cap:sync:android

# Open in Android Studio:
npm run cap:open:android

# Or directly run on device:
npm run cap:run:android
```

## Build Commands
```bash
# Debug APK (for testing)
npm run android:build
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Release APK (for distribution)
npm run android:release
# Output: android/app/build/outputs/apk/release/app-release.apk

# Clean build
npm run android:clean
```

## Testing Push Notifications

### 1. Get FCM Token
- Run app on device
- Open Android Studio → Logcat
- Filter by "FCM Token"
- Copy the token (starts with "d..." or "f...")

### 2. Test from Firebase Console
1. Go to Firebase Console → Cloud Messaging
2. Click "Send your first message"
3. Enter title and body
4. Click "Send test message"
5. Paste your FCM token
6. Click "Test"

### 3. Check Device Tokens in Database
```sql
-- In Supabase SQL Editor
SELECT * FROM device_tokens WHERE is_active = true;
```

## Troubleshooting Commands

### Get SHA-1 Fingerprint
```bash
cd android
.\\gradlew signingReport
# Copy SHA-1 from output and add to Firebase Console
```

### Clean Everything
```bash
npm run android:clean
cd android
.\\gradlew clean
cd ..
npm run build
npm run cap:sync:android
```

### View Real-Time Logs
```bash
# In Android Studio:
# View → Tool Windows → Logcat
# Filter: "MainActivity" or "FCM" or "Notification"
```

## Important Files

### Configuration
- `capacitor.config.ts` - App ID, name, plugins
- `android/app/google-services.json` - Firebase config (NEVER commit!)

### Code
- `src/services/notificationService.ts` - FCM logic
- `src/utils/mobileApp.ts` - Capacitor initialization

### Database
- `supabase/migrations/20251208000000_create_device_tokens_table.sql`

### Android Native
- `android/app/build.gradle` - Dependencies
- `android/app/src/main/AndroidManifest.xml` - Permissions
- `android/app/src/main/res/values/strings.xml` - Notification channel

## Common Issues & Quick Fixes

### ❌ "google-services.json not found"
```bash
# Make sure file exists at:
android/app/google-services.json
```

### ❌ "SHA-1 mismatch"
```bash
cd android
.\\gradlew signingReport
# Add SHA-1 to Firebase Console → Project Settings → Your Apps
# Re-download google-services.json
```

### ❌ No FCM token generated
```bash
# 1. Check Firebase Cloud Messaging API is enabled
# 2. Verify google-services.json is correct
# 3. Clean and rebuild:
npm run android:clean
npm run build
npm run cap:sync:android
```

### ❌ App crashes on launch
```bash
# Check Logcat for errors, then:
cd android
.\\gradlew clean
cd ..
npm run build
npm run cap:sync:android
```

## Integration with Existing App

### Update App.tsx
```typescript
import { useEffect } from 'react';
import { initializeMobileApp } from './utils/mobileApp';

function App() {
  useEffect(() => {
    initializeMobileApp();
    
    const handleNotification = (event: CustomEvent) => {
      // Handle notification tap
      const { type, patientId, appointmentId } = event.detail;
      // Navigate based on type
    };
    
    window.addEventListener('notification-received', handleNotification as EventListener);
    return () => window.removeEventListener('notification-received', handleNotification as EventListener);
  }, []);
  
  // Rest of your app...
}
```

## Next Steps

1. ✅ Run `npm run cap:add:android`
2. ✅ Set up Firebase project
3. ✅ Download `google-services.json`
4. ✅ Configure Android project (see MOBILE_APP_SETUP.md)
5. ✅ Build and test on device
6. ✅ Implement backend notification sending

---

📖 **Full Documentation**: See `MOBILE_APP_SETUP.md` for complete step-by-step guide.
