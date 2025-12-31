import React, { useEffect, useState } from 'react';
import { Download, X, Smartphone, Check, Share2 } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface InstallPWAProps {
  variant?: 'button' | 'banner' | 'sidebar';
  className?: string;
}

// Detect iOS
const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// Detect Android
const isAndroid = () => {
  return /Android/.test(navigator.userAgent);
};

// Check if running in standalone mode (already installed)
const isStandalone = () => {
  return window.matchMedia('(display-mode: standalone)').matches || 
    (window.navigator as any).standalone === true;
};

const InstallPWA: React.FC<InstallPWAProps> = ({ variant = 'button', className = '' }) => {
  const [promptInstall, setPromptInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    // Listen for the beforeinstallprompt event
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      console.log('PWA install prompt available');
      setPromptInstall(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Listen for successful installation
    window.addEventListener('appinstalled', () => {
      console.log('PWA was installed');
      setIsInstalled(true);
      setPromptInstall(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    // If we have the native prompt, use it
    if (promptInstall) {
      setInstalling(true);
      
      try {
        await promptInstall.prompt();
        const { outcome } = await promptInstall.userChoice;
        
        if (outcome === 'accepted') {
          console.log('User accepted the install prompt');
          setIsInstalled(true);
        } else {
          console.log('User dismissed the install prompt');
        }
      } catch (error) {
        console.error('Error during PWA installation:', error);
      } finally {
        setInstalling(false);
        setPromptInstall(null);
      }
    } else if (isIOS()) {
      // Show iOS-specific instructions
      setShowIOSInstructions(true);
    } else if (isAndroid()) {
      // Show Android instructions - Chrome menu
      alert('To install:\n\n1. Tap the menu (⋮) in Chrome\n2. Tap "Add to Home screen"\n3. Tap "Add"');
    } else {
      // Desktop - show generic instructions
      alert('To install:\n\n1. Click the install icon in your browser\'s address bar\n2. Or use the browser menu → "Install app"');
    }
  };

  const dismissBanner = () => {
    setShowBanner(false);
    // Store dismissal in localStorage to not show again for a while
    localStorage.setItem('pwa-banner-dismissed', Date.now().toString());
  };

  // Check if banner was recently dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem('pwa-banner-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      const dayInMs = 24 * 60 * 60 * 1000;
      // Show banner again after 7 days
      if (Date.now() - dismissedTime < 7 * dayInMs) {
        setShowBanner(false);
      }
    }
  }, []);

  // If already installed, show installed state
  if (isInstalled) {
    if (variant === 'sidebar') {
      return (
        <div className={`flex items-center gap-2 px-4 py-2 text-green-600 bg-green-50 rounded-lg ${className}`}>
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">App Installed</span>
        </div>
      );
    }
    return null;
  }

  // iOS Instructions Modal
  if (showIOSInstructions) {
    return (
      <>
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end justify-center" onClick={() => setShowIOSInstructions(false)}>
          <div className="bg-white rounded-t-2xl w-full max-w-md p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Install OPD Manager</h3>
              <button onClick={() => setShowIOSInstructions(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">1</span>
                </div>
                <div>
                  <p className="font-medium text-gray-800">Tap the Share button</p>
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <Share2 className="w-4 h-4" /> at the bottom of Safari
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">2</span>
                </div>
                <div>
                  <p className="font-medium text-gray-800">Scroll and tap "Add to Home Screen"</p>
                  <p className="text-sm text-gray-500">You may need to scroll down in the menu</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-bold">3</span>
                </div>
                <div>
                  <p className="font-medium text-gray-800">Tap "Add"</p>
                  <p className="text-sm text-gray-500">The app will appear on your home screen</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowIOSInstructions(false)}
              className="w-full mt-6 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
            >
              Got it!
            </button>
          </div>
        </div>
        {/* Keep the button visible behind the modal */}
        <button
          onClick={handleInstallClick}
          className={`w-full flex items-center gap-3 px-4 py-3 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ${className}`}
        >
          <Download className="w-5 h-5" />
          <div className="flex-1 text-left">
            <div className="font-medium">Install App</div>
            <div className="text-xs text-gray-500">Add to home screen</div>
          </div>
        </button>
      </>
    );
  }

  // Sidebar variant (for Navigation) - Always visible on mobile
  if (variant === 'sidebar') {
    return (
      <button
        onClick={handleInstallClick}
        disabled={installing}
        className={`w-full flex items-center gap-3 px-4 py-3 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ${className}`}
      >
        <Download className="w-5 h-5" />
        <div className="flex-1 text-left">
          <div className="font-medium">{installing ? 'Installing...' : 'Install App'}</div>
          <div className="text-xs text-gray-500">Add to home screen</div>
        </div>
      </button>
    );
  }

  // Banner variant (for mobile)
  if (variant === 'banner' && showBanner) {
    return (
      <div className={`fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-50 ${className}`}>
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-800">Install OPD Manager</h3>
            <p className="text-sm text-gray-600">Add to home screen for quick access</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={dismissBanner}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              onClick={handleInstallClick}
              disabled={installing}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {installing ? 'Installing...' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default button variant
  return (
    <button
      onClick={handleInstallClick}
      disabled={installing}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 ${className}`}
    >
      <Download className="w-4 h-4" />
      {installing ? 'Installing...' : 'Install App'}
    </button>
  );
};

export default InstallPWA;
