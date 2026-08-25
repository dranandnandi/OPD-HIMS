import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { applyBrandToDocument } from './config/branding';

applyBrandToDocument();

// Keep installed/PWA clients on the same deployed bundle. Updates activate
// immediately and the page reloads as soon as the new worker takes control.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Browsers may keep an installed PWA open for days. Check on resume and at
    // a modest interval instead of waiting for the next navigation.
    const check = () => void registration.update().catch(() => undefined);
    window.setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
