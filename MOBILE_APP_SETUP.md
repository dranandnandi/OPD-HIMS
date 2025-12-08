# 📱 OPD Management - Android Mobile App Setup Guide

## Overview
This guide walks you through setting up the Android mobile app for OPD Management system using Capacitor with Firebase Cloud Messaging (FCM) for push notifications.

## Prerequisites

### Required Software
- ✅ Node.js 18+ and npm installed
- ✅ Android Studio (latest version)
- ✅ Java JDK 17+
- ✅ Firebase Console account
- ✅ Supabase project (already set up)

### Verify Installations
```bash
node -v        # Should be 18+
npm -v         # Should be 9+
java -version  # Should be 17+
```

## Step 1: Database Setup

### Run Migration
1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Run the migration file: `supabase/migrations/20251208000000_create_device_tokens_table.sql`
4. Verify the table was created:
   ```sql
   SELECT * FROM device_tokens;
   ```

## Step 2: Firebase Setup

### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **"Add project"**
3. Enter project name: `opd-management-app`
4. Disable Google Analytics (optional)
5. Click **"Create project"**

### Add Android App
1. In Firebase Console → **Project settings** → **Your apps**
2. Click Android icon to add Android app
3. Fill in details:
   - **Android package name**: `com.opdmanagement.clinic`
   - **App nickname**: `OPD Management Android`
   - **Debug signing certificate SHA-1**: (see below to get it)

### Get SHA-1 Fingerprint
```bash
# Windows PowerShell (run after adding Android platform)
cd android
.\\gradlew signingReport

# Look for "SHA1" under "Variant: debug"
# Copy the SHA-1 value and paste it in Firebase Console
```

### Download google-services.json
1. Click **"Download google-services.json"**
2. **IMPORTANT**: After adding Android platform (Step 3), place this file at:
   ```
   android/app/google-services.json
   ```

### Enable Firebase Cloud Messaging API (V1)
1. Firebase Console → **Project settings** → **Cloud Messaging** tab
2. Under **"Cloud Messaging API (V1)"**, click **"Manage"**
3. Enable the API in Google Cloud Console
4. Return to Firebase and verify it shows **"Enabled"**

### Create Service Account Key (for backend notifications)
1. Firebase Console → **Project settings** → **Service accounts** tab
2. Click **"Generate new private key"**
3. Save the JSON file as `firebase-service-account.json` in project root
4. **DO NOT commit this file** - add to `.gitignore`

## Step 3: Add Android Platform

### Initialize Capacitor and Add Android
```bash
# Build the web app first
npm run build

# Add Android platform
npm run cap:add:android
```

This creates the `android/` folder with native Android project.

## Step 4: Configure Android Project

### 1. Place google-services.json
Copy the downloaded `google-services.json` to:
```
android/app/google-services.json
```

### 2. Update android/app/build.gradle
Add Firebase dependencies by adding these lines:

At the top (after existing apply plugin lines):
```gradle
apply plugin: 'com.google.gms.google-services'
```

In the `dependencies` section:
```gradle
dependencies {
    // ... existing dependencies ...
    
    // Firebase BoM (Bill of Materials)
    implementation platform('com.google.firebase:firebase-bom:34.6.0')
    
    // Firebase Messaging
    implementation 'com.google.firebase:firebase-messaging'
    
    // Google Play Services
    implementation 'com.google.android.gms:play-services-base:18.5.0'
}
```

At the very bottom of the file:
```gradle
apply plugin: 'com.google.gms.google-services'
```

### 3. Update android/build.gradle
In the `dependencies` section of `buildscript`:
```gradle
buildscript {
    dependencies {
        // ... existing dependencies ...
        classpath 'com.google.gms:google-services:4.4.2'
    }
}
```

### 4. Update AndroidManifest.xml
File: `android/app/src/main/AndroidManifest.xml`

Add permissions before `<application>` tag:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
```

### 5. Update strings.xml
File: `android/app/src/main/res/values/strings.xml`

Add notification channel:
```xml
<resources>
    <string name="app_name">OPD Management</string>
    <string name="title_activity_main">OPD Management</string>
    <string name="package_name">com.opdmanagement.clinic</string>
    <string name="default_notification_channel_id">fcm_default_channel</string>
</resources>
```

## Step 5: Initialize Mobile Features in Your App

### Update src/App.tsx
Add this code in your main App component:

```typescript
import { useEffect } from 'react';
import { initializeMobileApp } from './utils/mobileApp';

function App() {
  useEffect(() => {
    // Initialize mobile app features
    initializeMobileApp();
    
    // Listen for notification events
    const handleNotification = (event: CustomEvent) => {
      console.log('Notification received in app:', event.detail);
      // Handle navigation or show in-app notification
    };
    
    window.addEventListener('notification-received', handleNotification as EventListener);
    
    return () => {
      window.removeEventListener('notification-received', handleNotification as EventListener);
    };
  }, []);

  // ... rest of your app
}
```

## Step 6: Build and Run

### Sync Capacitor
Every time you make changes to web code:
```bash
npm run cap:sync:android
```

### Open in Android Studio
```bash
npm run cap:open:android
```

### Build APK
```bash
# Debug APK
npm run android:build

# Release APK (requires keystore - see Step 7)
npm run android:release
```

### Run on Device/Emulator
1. Connect Android device via USB (enable USB debugging)
   OR start Android emulator
2. In Android Studio:
   - Click **Run** (green play button)
   - Select your device
   - Wait for app to install and launch

### View Logs
In Android Studio:
- Open **Logcat** (bottom panel)
- Filter by `MainActivity` or `FCM` to see notification logs
- Look for "✅ FCM Token received:" to get your device token

## Step 7: Release Build Setup (Optional)

### Generate Keystore
```bash
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias opd-management-key
```

Follow prompts to set passwords and details.

### Get Release SHA-1
```bash
keytool -list -v -keystore my-release-key.jks -alias opd-management-key
```

Copy the SHA-1 and add it to Firebase Console (same place as debug SHA-1).

### Configure Signing in build.gradle
File: `android/app/build.gradle`

Add signing config:
```gradle
android {
    signingConfigs {
        release {
            storeFile file('my-release-key.jks')
            storePassword 'YOUR_KEYSTORE_PASSWORD'
            keyAlias 'opd-management-key'
            keyPassword 'YOUR_KEY_PASSWORD'
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

## Step 8: Testing Push Notifications

### Test from Firebase Console
1. Firebase Console → **Cloud Messaging**
2. Click **"Send your first message"**
3. Enter notification details:
   - Title: "Test Notification"
   - Text: "This is a test from Firebase"
4. Click **"Send test message"**
5. Paste your FCM token (from Logcat)
6. Click **"Test"**

### Test with Backend Script
Create `send-test-notification.js`:
```javascript
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

const serviceAccount = require('./firebase-service-account.json');

initializeApp({
  credential: cert(serviceAccount)
});

const token = 'YOUR_FCM_TOKEN_FROM_LOGCAT';

const message = {
  notification: {
    title: 'New Appointment',
    body: 'You have a new appointment scheduled'
  },
  data: {
    type: 'appointment',
    appointmentId: '123',
    title: 'New Appointment',
    body: 'You have a new appointment scheduled'
  },
  token: token
};

getMessaging().send(message)
  .then((response) => {
    console.log('✅ Notification sent:', response);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
  });
```

Run:
```bash
npm install firebase-admin
node send-test-notification.js
```

## Step 9: Available Commands

### Development
```bash
npm run dev                   # Run web version
npm run build                 # Build web app
npm run cap:sync             # Sync all platforms
npm run cap:sync:android     # Sync Android only
npm run cap:open:android     # Open in Android Studio
npm run cap:run:android      # Build and run on device
```

### Android Building
```bash
npm run android:build        # Build debug APK
npm run android:release      # Build release APK
npm run android:clean        # Clean build cache
```

## Troubleshooting

### Issue: "google-services.json not found"
**Solution**: Make sure file is at `android/app/google-services.json`

### Issue: "SHA-1 fingerprint mismatch"
**Solution**: 
1. Run `cd android && .\\gradlew signingReport`
2. Copy SHA-1 from output
3. Add to Firebase Console
4. Re-download google-services.json

### Issue: No FCM token generated
**Solution**:
1. Check Firebase Cloud Messaging API is enabled
2. Verify google-services.json is in correct location
3. Check Logcat for errors
4. Try clean build: `npm run android:clean && npm run android:build`

### Issue: Notification permission not requested
**Solution**: Make sure Android 13+ device and `POST_NOTIFICATIONS` permission is in AndroidManifest.xml

### Issue: App crashes on launch
**Solution**:
1. Check Logcat for error messages
2. Verify all dependencies are installed
3. Try: `cd android && .\\gradlew clean`
4. Rebuild app

## File Structure

```
project/
├── android/                          # Native Android project
│   ├── app/
│   │   ├── google-services.json     # Firebase config (DO NOT COMMIT)
│   │   ├── build.gradle             # App dependencies
│   │   └── src/main/
│   │       ├── AndroidManifest.xml  # Permissions
│   │       └── res/values/
│   │           └── strings.xml      # Notification channel
│   └── build.gradle                 # Project dependencies
│
├── src/
│   ├── services/
│   │   └── notificationService.ts   # FCM integration
│   └── utils/
│       └── mobileApp.ts             # Capacitor initialization
│
├── supabase/migrations/
│   └── 20251208000000_create_device_tokens_table.sql
│
├── capacitor.config.ts              # Capacitor configuration
├── firebase-service-account.json    # Service account (DO NOT COMMIT)
└── package.json                     # Scripts and dependencies
```

## Security Notes

### Never Commit These Files:
- `android/app/google-services.json`
- `firebase-service-account.json`
- `android/my-release-key.jks`
- `.env` files with secrets

### Add to .gitignore:
```
android/app/google-services.json
firebase-service-account.json
*.jks
*.keystore
.env.local
```

## Next Steps

1. ✅ Set up Firebase project
2. ✅ Run database migration
3. ✅ Configure Android project
4. ✅ Build and test on device
5. 🔄 Implement notification sending from backend
6. 🔄 Test all notification types
7. 🔄 Deploy to Google Play Store (optional)

## Support Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Android Developer Guide](https://developer.android.com)

---

**Need Help?** Check the troubleshooting section or refer to the complete blueprint document for detailed information.
