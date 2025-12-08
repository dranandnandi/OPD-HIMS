/**
 * Send Push Notifications to All Users
 * OPD Management System - Backend Script
 * 
 * Usage:
 *   node send-notification-to-all.js "Title" "Body" "ImageURL (optional)"
 * 
 * Example:
 *   node send-notification-to-all.js "System Update" "The system will be down for maintenance at 2 AM"
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Validate environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing environment variables!');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  console.error('Create a .env file with these variables.');
  process.exit(1);
}

// Initialize Firebase Admin
let serviceAccount;
try {
  serviceAccount = require('./firebase-service-account.json');
} catch (error) {
  console.error('❌ firebase-service-account.json not found!');
  console.error('Download it from Firebase Console → Project Settings → Service Accounts');
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

// Initialize Supabase with service_role key (admin access)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Send push notification to all registered devices
 */
async function sendNotificationToAll(title, body, imageUrl = null, data = {}) {
  try {
    console.log('\n🚀 Starting notification broadcast...\n');

    // Fetch all active device tokens
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('fcm_token, user_id, platform')
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    if (!tokens || tokens.length === 0) {
      console.log('⚠️  No active device tokens found.');
      console.log('Users need to open the mobile app to register their devices.');
      return;
    }

    console.log(`📱 Found ${tokens.length} active device(s)\n`);

    // Prepare notification message
    const notification = {
      title: title,
      body: body
    };

    if (imageUrl) {
      notification.imageUrl = imageUrl;
    }

    // Prepare data payload (always include title/body for tap handling)
    const messageData = {
      title: title,
      body: body,
      ...data
    };

    if (imageUrl) {
      messageData.image = imageUrl;
    }

    // Send to each token
    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    for (const tokenInfo of tokens) {
      try {
        const message = {
          notification: notification,
          data: messageData,
          token: tokenInfo.fcm_token,
          android: {
            notification: {
              imageUrl: imageUrl,
              channelId: 'fcm_default_channel',
              priority: 'high',
              sound: 'default'
            }
          }
        };

        const response = await getMessaging().send(message);
        console.log(`✅ Sent to ${tokenInfo.platform} device (User: ${tokenInfo.user_id.substring(0, 8)}...)`);
        successCount++;

        // Update last_used_at timestamp
        await supabase
          .from('device_tokens')
          .update({ last_used_at: new Date().toISOString() })
          .eq('fcm_token', tokenInfo.fcm_token);

      } catch (error) {
        console.error(`❌ Failed for token ${tokenInfo.fcm_token.substring(0, 10)}...`);
        
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          console.log('   → Token invalid, marking as inactive');
          invalidTokens.push(tokenInfo.fcm_token);
        } else {
          console.error('   → Error:', error.message);
        }
        
        failureCount++;
      }
    }

    // Deactivate invalid tokens
    if (invalidTokens.length > 0) {
      const { error: deactivateError } = await supabase
        .from('device_tokens')
        .update({ is_active: false })
        .in('fcm_token', invalidTokens);

      if (deactivateError) {
        console.error('⚠️  Failed to deactivate invalid tokens:', deactivateError);
      } else {
        console.log(`\n🧹 Deactivated ${invalidTokens.length} invalid token(s)`);
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   Total: ${tokens.length}`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failureCount}`);
    console.log('\n✨ Notification broadcast complete!\n');

  } catch (error) {
    console.error('❌ Error sending notifications:', error);
    process.exit(1);
  }
}

/**
 * Send notification to specific user
 */
async function sendNotificationToUser(userId, title, body, imageUrl = null, data = {}) {
  try {
    console.log(`\n🚀 Sending notification to user: ${userId}\n`);

    // Fetch user's active tokens
    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('fcm_token, platform')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    if (!tokens || tokens.length === 0) {
      console.log('⚠️  No active device tokens found for this user.');
      return;
    }

    console.log(`📱 Found ${tokens.length} device(s)\n`);

    // Prepare message
    const notification = {
      title: title,
      body: body
    };

    if (imageUrl) {
      notification.imageUrl = imageUrl;
    }

    const messageData = {
      title: title,
      body: body,
      ...data
    };

    if (imageUrl) {
      messageData.image = imageUrl;
    }

    // Send to each device
    let successCount = 0;
    let failureCount = 0;

    for (const tokenInfo of tokens) {
      try {
        const message = {
          notification: notification,
          data: messageData,
          token: tokenInfo.fcm_token,
          android: {
            notification: {
              imageUrl: imageUrl,
              channelId: 'fcm_default_channel',
              priority: 'high',
              sound: 'default'
            }
          }
        };

        await getMessaging().send(message);
        console.log(`✅ Sent to ${tokenInfo.platform} device`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed: ${error.message}`);
        failureCount++;
      }
    }

    console.log(`\n📊 Sent to ${successCount}/${tokens.length} device(s)\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// CLI Interface
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
📱 OPD Management - Push Notification Sender

Usage:
  Broadcast to all users:
    node send-notification-to-all.js "Title" "Body" "ImageURL (optional)"
  
  Send to specific user:
    node send-notification-to-all.js --user USER_ID "Title" "Body" "ImageURL (optional)"

Examples:
  node send-notification-to-all.js "System Update" "Maintenance at 2 AM tonight"
  
  node send-notification-to-all.js "New Feature" "Check out our new billing system!" "https://example.com/image.jpg"
  
  node send-notification-to-all.js --user abc123-def456 "Appointment Reminder" "You have an appointment tomorrow at 10 AM"

Environment Setup:
  Create .env file with:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
  
  Place firebase-service-account.json in project root
`);
  process.exit(0);
}

// Parse arguments
if (args[0] === '--user') {
  const [, userId, title, body, imageUrl] = args;
  if (!userId || !title || !body) {
    console.error('❌ Missing required arguments for user notification');
    process.exit(1);
  }
  sendNotificationToUser(userId, title, body, imageUrl);
} else {
  const [title, body, imageUrl] = args;
  if (!title || !body) {
    console.error('❌ Missing required arguments');
    console.error('Usage: node send-notification-to-all.js "Title" "Body" "ImageURL (optional)"');
    process.exit(1);
  }
  sendNotificationToAll(title, body, imageUrl);
}
