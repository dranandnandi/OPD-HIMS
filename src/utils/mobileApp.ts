import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import NotificationService from '../services/notificationService';

/**
 * Initialize Capacitor mobile app features
 * Call this in your main App.tsx component on mount
 */
export async function initializeMobileApp(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    console.log('Running as web app - mobile features disabled');
    return;
  }

  console.log('🚀 Initializing Capacitor mobile app...');
  console.log('Platform:', Capacitor.getPlatform());

  try {
    // Initialize push notifications
    await NotificationService.initialize();

    // Setup app state listeners
    setupAppListeners();

    // Setup back button handler
    setupBackButtonHandler();

    console.log('✅ Mobile app initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize mobile app:', error);
  }
}

/**
 * Setup app state change listeners
 */
function setupAppListeners(): void {
  // App state change listener
  CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    console.log('App state changed. Is active:', isActive);
    
    if (isActive) {
      // App came to foreground - refresh data if needed
      window.dispatchEvent(new CustomEvent('app-resumed'));
    } else {
      // App went to background
      window.dispatchEvent(new CustomEvent('app-paused'));
    }
  });

  // App URL open listener (for deep links)
  CapacitorApp.addListener('appUrlOpen', (data) => {
    console.log('App opened with URL:', data.url);
    
    // Handle deep link
    const url = new URL(data.url);
    const path = url.pathname;
    
    if (path) {
      // Navigate to the path
      window.location.hash = path;
    }
  });
}

/**
 * Setup Android back button handler
 */
function setupBackButtonHandler(): void {
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack) {
      // On root page - show exit confirmation
      if (confirm('Do you want to exit the app?')) {
        CapacitorApp.exitApp();
      }
    } else {
      // Go back in navigation history
      window.history.back();
    }
  });
}

/**
 * Check if running on mobile device
 */
export function isMobileApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get platform name
 */
export function getPlatform(): 'web' | 'ios' | 'android' {
  return Capacitor.getPlatform() as 'web' | 'ios' | 'android';
}

/**
 * Check if running on Android
 */
export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
  return Capacitor.getPlatform() === 'ios';
}
