import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
const Join = React.lazy(() => import('./Join'));
const MemberApps = React.lazy(() => import('./MemberApps'));

createRoot(document.getElementById('root')!).render(<React.StrictMode>{['/join','/apps'].includes(location.pathname) ? <React.Suspense fallback={<div className="loading-screen">Opening Doctor Suite...</div>}>{location.pathname==='/join'?<Join/>:<MemberApps/>}</React.Suspense> : <App />}</React.StrictMode>);
