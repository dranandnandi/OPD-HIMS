import SuiteEntry from './suite/SuiteEntry';
import SuiteBoundary from './suite/SuiteBoundary';
import {supabase} from './services/supabaseClient';
import {hydrateSuiteUser,clearSuiteUser} from './suite/profile';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname==='/suite-entry'?<SuiteEntry client={supabase} onReady={hydrateSuiteUser}/>:<SuiteBoundary client={supabase} onAuthenticated={hydrateSuiteUser} onSignedOut={clearSuiteUser}><App /></SuiteBoundary>}
  </StrictMode>
);
