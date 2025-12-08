import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  Token,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Dialog } from '@capacitor/dialog';
import { supabase } from './supabaseClient';

interface NotificationData {
  title?: string;
  body?: string;
  image?: string;
  type?: string;
  patientId?: string;
  visitId?: string;
  appointmentId?: string;
  billId?: string;
  [key: string]: any;
}

class NotificationService {
  private static instance: NotificationService;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize push notifications (call once on app start)
   */
  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      console.log('Not running on native platform, skipping push notification setup');
      return;
    }

    if (this.isInitialized) {
      console.log('NotificationService already initialized');
      return;
    }

    try {
      // Request permission
      const permission = await PushNotifications.requestPermissions();
      
      if (permission.receive === 'granted') {
        // Register with FCM
        await PushNotifications.register();
        
        // Setup listeners
        this.setupListeners();
        
        this.isInitialized = true;
        console.log('✅ NotificationService initialized successfully');
      } else {
        console.log('❌ Push notification permission denied');
        await Dialog.alert({
          title: 'Notifications Disabled',
          message: 'Enable notifications in settings to receive important updates about appointments and visits.'
        });
      }
    } catch (error) {
      console.error('Failed to initialize NotificationService:', error);
    }
  }

  /**
   * Setup notification event listeners
   */
  private setupListeners(): void {
    // FCM token received
    PushNotifications.addListener('registration', async (token: Token) => {
      console.log('✅ FCM Token received:', token.value);
      await this.saveTokenToDatabase(token.value);
    });

    // Registration failed
    PushNotifications.addListener('registrationError', (error: any) => {
      console.error('❌ FCM Registration failed:', error);
    });

    // Notification received while app is in foreground
    PushNotifications.addListener('pushNotificationReceived', async (notification: PushNotificationSchema) => {
      console.log('📬 Foreground notification received:', notification);
      await this.handleForegroundNotification(notification);
    });

    // Notification tapped (app was in background or closed)
    PushNotifications.addListener('pushNotificationActionPerformed', async (notification: ActionPerformed) => {
      console.log('👆 Notification tapped:', notification);
      await this.handleNotificationTap(notification);
    });
  }

  /**
   * Save FCM token to Supabase database
   */
  private async saveTokenToDatabase(fcmToken: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        console.log('⚠️ No user logged in, token not saved');
        return;
      }

      // Get device info
      const deviceInfo = {
        platform: Capacitor.getPlatform(),
        isNative: Capacitor.isNativePlatform(),
        userAgent: navigator.userAgent,
      };

      // Call upsert function
      const { data, error } = await supabase.rpc('upsert_device_token', {
        p_user_id: user.id,
        p_fcm_token: fcmToken,
        p_device_info: deviceInfo,
        p_platform: 'android'
      });

      if (error) {
        console.error('❌ Failed to save token:', error);
        
        // Fallback: direct insert with conflict handling
        const { error: insertError } = await supabase
          .from('device_tokens')
          .upsert({
            user_id: user.id,
            fcm_token: fcmToken,
            device_info: deviceInfo,
            platform: 'android',
            is_active: true,
            last_used_at: new Date().toISOString()
          }, {
            onConflict: 'fcm_token'
          });

        if (insertError) {
          console.error('❌ Fallback insert also failed:', insertError);
        } else {
          console.log('✅ Token saved via fallback method');
        }
      } else {
        console.log('✅ Token saved to database:', data);
      }
    } catch (error) {
      console.error('❌ Error saving token:', error);
    }
  }

  /**
   * Handle notification received while app is in foreground
   */
  private async handleForegroundNotification(notification: PushNotificationSchema): Promise<void> {
    try {
      // Show local notification to display in system tray
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now(),
          title: notification.title || notification.data?.title || 'New Notification',
          body: notification.body || notification.data?.body || '',
          largeBody: notification.data?.body,
          summaryText: 'OPD Management',
          smallIcon: 'ic_stat_icon_notification',
          iconColor: '#3B82F6',
          extra: notification.data
        }]
      });

      // Dispatch custom event for in-app handling
      this.dispatchNotificationEvent(notification.data || {});
    } catch (error) {
      console.error('Failed to show foreground notification:', error);
    }
  }

  /**
   * Handle notification tap (from background/terminated state)
   */
  private async handleNotificationTap(notification: ActionPerformed): Promise<void> {
    try {
      const data = notification.notification.data as NotificationData;
      
      console.log('Processing notification tap with data:', data);

      // Show alert with notification details
      await Dialog.alert({
        title: data.title || notification.notification.title || 'Notification',
        message: data.body || notification.notification.body || 'You have a new notification'
      });

      // Handle deep linking based on notification type
      this.handleNotificationType(data);
      
      // Dispatch event for app-level routing
      this.dispatchNotificationEvent(data);
    } catch (error) {
      console.error('Failed to handle notification tap:', error);
    }
  }

  /**
   * Dispatch custom event for notification handling
   */
  private dispatchNotificationEvent(data: NotificationData): void {
    window.dispatchEvent(new CustomEvent('notification-received', { detail: data }));
  }

  /**
   * Handle different notification types with deep linking
   */
  private handleNotificationType(data: NotificationData): void {
    const type = data.type?.toLowerCase();

    switch (type) {
      case 'appointment':
        if (data.appointmentId) {
          // Navigate to appointments page
          window.location.hash = `#/appointments?id=${data.appointmentId}`;
        }
        break;

      case 'visit':
      case 'patient':
        if (data.patientId) {
          // Navigate to patient details
          window.location.hash = `#/patients/${data.patientId}`;
        }
        break;

      case 'bill':
      case 'payment':
        if (data.billId) {
          // Navigate to billing
          window.location.hash = `#/billing?id=${data.billId}`;
        }
        break;

      case 'followup':
        // Navigate to follow-ups
        window.location.hash = '#/followups';
        break;

      default:
        // Navigate to home
        window.location.hash = '#/';
    }
  }

  /**
   * Get current FCM token
   */
  async getToken(): Promise<string | null> {
    try {
      // This will trigger the 'registration' listener if successful
      await PushNotifications.register();
      return null; // Token will be available in the listener
    } catch (error) {
      console.error('Failed to get token:', error);
      return null;
    }
  }

  /**
   * Clear all delivered notifications
   */
  async clearNotifications(): Promise<void> {
    try {
      await PushNotifications.removeAllDeliveredNotifications();
      console.log('✅ All notifications cleared');
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  }
}

export default NotificationService.getInstance();
