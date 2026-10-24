import SuiteEntry from './suite/SuiteEntry';
import SuiteBoundary from './suite/SuiteBoundary';
import {supabase} from './utils/supabaseClient';
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { applyBrandingToDocument } from './constants/branding'
import { Capacitor } from '@capacitor/core'

applyBrandingToDocument()

// Register the service worker (required by some browsers for the PWA install prompt).
// Skipped inside the native Android/iOS app and during local development.
if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => console.warn('Service worker registration failed', err))
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {location.pathname==='/suite-entry'?<SuiteEntry client={supabase}/>:<SuiteBoundary client={supabase}><App /></SuiteBoundary>}
    </BrowserRouter>
  </React.StrictMode>,
)