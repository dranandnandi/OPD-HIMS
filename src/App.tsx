import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './components/Auth/AuthProvider';
import { useAuth } from './components/Auth/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import LoginForm from './components/Auth/LoginForm';
import Navigation from './components/Layout/Navigation';
import MobileNav from './components/Layout/MobileNav';
import './lib/supabaseClient'; // ✅ This ensures it initializes


// Patient Management
import PatientListWithTimeline from './components/Patients/PatientListWithTimeline';

// Case Upload & OCR
// import CaseUpload from './components/CaseUpload/CaseUpload';
import EnhancedCaseUpload from './components/CaseUpload/EnhancedCaseUpload';

// Visits
import VisitList from './components/Visits/VisitList';
import VisitDetails from './components/Visits/VisitDetails';

// Appointments
import AppointmentCalendar from './components/Appointments/AppointmentCalendar';

// Follow-ups
import FollowUps from './components/FollowUps/FollowUps';

// Billing
import BillingDashboard from './components/Billing/BillingDashboard';
import DailyReconciliation from './components/Billing/DailyReconciliation';

// Pharmacy
import PharmacyDashboard from './components/Pharmacy/PharmacyDashboard';
import InwardStock from './components/Pharmacy/InwardStock';
import StockReport from './components/Pharmacy/StockReport';
import SupplierManagement from './components/Pharmacy/SupplierManagement';
import InvoiceUpload from './components/Pharmacy/InvoiceUpload';

// Analytics & Reports
import Analytics from './components/Analytics/Analytics';

// Settings
import Settings from './components/Settings/Settings';
import ClinicSettings from './components/Settings/ClinicSettings';
import ProfileSettings from './components/Settings/ProfileSettings';
import UserManagement from './components/Settings/UserManagement';
import MasterDataManagement from './components/Settings/MasterDataManagement';
import PrescriptionPresetSettings from './components/Settings/PrescriptionPresetSettings';
import ExaminationTemplateSettings from './components/Settings/ExaminationTemplateSettings';
import SystemSettings from './components/Settings/SystemSettings';
import DoctorAvailabilitySettings from './components/Settings/DoctorAvailabilitySettings';
import WhatsappAndAIReviewSettings from './components/Settings/WhatsappAndAIReviewSettings';
import WhatsAppAutoSendSettings from './components/Settings/WhatsAppAutoSendSettings';
import WaitingSequenceSettings from './components/Settings/WaitingSequenceSettings';
import ChatbotUtility from './components/Chatbots/ChatbotUtility';
import { MessageQueueProcessor } from './components/WhatsApp/MessageQueueProcessor';

// GMB Review Requests
import GMBReviewRequests from './components/GMBReviewRequests/GMBReviewRequests';

// Verify Prescription (public page — no auth required)
import VerifyPrescription from './pages/VerifyPrescription';

// IPD module — lazy-loaded so OPD-only users never download it (CKEditor/xlsx are heavy)
const IpdCensusPage = React.lazy(() => import('./modules/ipd/pages/CensusPage'));
const IpdBedBoardPage = React.lazy(() => import('./modules/ipd/pages/BedBoardPage'));
const IpdNewAdmissionPage = React.lazy(() => import('./modules/ipd/pages/NewAdmissionPage'));
const IpdAdmissionDetailsPage = React.lazy(() => import('./modules/ipd/pages/AdmissionDetailsPage'));
const IpdBillingPage = React.lazy(() => import('./modules/ipd/pages/BillingPage'));
const IpdStoresPage = React.lazy(() => import('./modules/ipd/pages/StoresPage'));
const IpdMastersPage = React.lazy(() => import('./modules/ipd/pages/MastersPage'));

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, authError, tryLoadLocalProfile } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
          {authError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg max-w-md mx-auto">
              <p className="text-red-700 text-sm">{authError}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
              >
                Refresh Page
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (authError && !user) {
    // Check if there's a local profile available
    const hasLocalProfile = (() => {
      try {
        const stored = localStorage.getItem('bolt_user_profile');
        return !!stored;
      } catch {
        return false;
      }
    })();

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-600 mb-4">
            <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Authentication Error</h2>
          <p className="text-gray-600 mb-4">{authError}</p>
          <div className="space-y-2">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Refresh Page
            </button>
            {hasLocalProfile && (
              <button
                onClick={tryLoadLocalProfile}
                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Load Saved Profile
              </button>
            )}
            <button
              onClick={() => window.location.href = '/login'}
              className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Admin-Only Route Component - Requires admin/super_admin role
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, hasPermission } = useAuth();

  // Check if user has admin privileges
  const isAdmin = user && (
    user.roleName?.toLowerCase() === 'admin' ||
    user.roleName?.toLowerCase() === 'super_admin' ||
    hasPermission('admin') ||
    hasPermission('all')
  );

  if (!isAdmin) {
    // Redirect non-admin users to home page
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Tier-gated Route - Restricts pages to Silver/Gold clinics only (basic tier has no access)
const TIER_ORDER: Record<string, number> = { basic: 0, silver: 1, gold: 2 };

const TierRoute: React.FC<{ minTier?: 'silver' | 'gold'; children: React.ReactNode }> = ({
  minTier = 'silver',
  children,
}) => {
  const { user } = useAuth();
  const clinicTier = (user?.clinic?.clinicTier ?? 'basic') as string;
  const hasAccess = TIER_ORDER[clinicTier] >= TIER_ORDER[minTier];

  console.log('[TierRoute]', {
    clinicId: user?.clinicId,
    rawClinicTier: user?.clinic?.clinicTier,
    resolvedTier: clinicTier,
    minTier,
    hasAccess,
  });

  if (!hasAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Feature Locked</h2>
          <p className="text-gray-500 mb-1">
            This feature is available on the <span className="font-semibold capitalize">{minTier}</span> plan and above.
          </p>
          <p className="text-sm text-gray-400">
            Your clinic is currently on the <span className="font-semibold capitalize">{clinicTier}</span> plan.
            Contact The Doctorpreneur Academy to upgrade.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// IPD Route - clinic must have IPD enabled (platform flag) AND user needs the ipd_* permission
const IpdRoute: React.FC<{ perm: string; children: React.ReactNode }> = ({ perm, children }) => {
  const { user, hasPermission } = useAuth();

  const ipdEnabled = user?.clinic?.ipdEnabled ?? false;
  const roleName = user?.roleName?.toLowerCase();
  const isAdmin = Boolean(
    user && (
      roleName === 'admin' ||
      roleName === 'super_admin' ||
      hasPermission('admin') ||
      hasPermission('all')
    )
  );

  if (!ipdEnabled) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">IPD Module Not Enabled</h2>
          <p className="text-gray-500 mb-1">
            The inpatient (IPD) module is not enabled for your clinic.
          </p>
          <p className="text-sm text-gray-400">
            Contact The Doctorpreneur Academy to enable IPD for your clinic.
          </p>
        </div>
      </div>
    );
  }

  if (!isAdmin && !hasPermission(perm)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// /ipd landing: send the user to the first IPD page they may open
const IpdHome: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const roleName = user?.roleName?.toLowerCase();
  const isAdmin = Boolean(
    user && (roleName === 'admin' || roleName === 'super_admin' || hasPermission('admin') || hasPermission('all'))
  );
  const order: Array<[string, string]> = [
    ['/ipd/census', 'ipd_census'],
    ['/ipd/admissions/new', 'ipd_admissions'],
    ['/ipd/billing', 'ipd_billing'],
    ['/ipd/stores', 'ipd_stores'],
    ['/ipd/masters', 'ipd_masters'],
  ];
  const target = order.find(([, perm]) => isAdmin || hasPermission(perm));
  return <Navigate to={target ? target[0] : '/'} replace />;
};

// Suspense fallback for lazy-loaded IPD pages
const IpdPageLoader: React.FC = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
  </div>
);

// Admin-or-Reception Route Component - Requires admin/super_admin OR receptionist role
const AdminOrReceptionRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, hasPermission } = useAuth();

  const isAllowed = user && (
    user.roleName?.toLowerCase() === 'admin' ||
    user.roleName?.toLowerCase() === 'super_admin' ||
    user.roleName?.toLowerCase() === 'receptionist' ||
    user.roleName?.toLowerCase() === 'reception' ||
    hasPermission('admin') ||
    hasPermission('all')
  );

  if (!isAllowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Main App Layout Component

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-soft-gray">
      <MessageQueueProcessor />
      {/* Desktop Navigation */}
      <div className="hidden lg:block">
        <Navigation />
      </div>

      {/* Mobile Navigation */}
      <MobileNav />

      {/* Main Content */}
      <div className="lg:ml-64 pt-16 lg:pt-0">
        <main className="p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};

// App Content Component
const AppContent: React.FC = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginForm />} />
      <Route path="/verify" element={<VerifyPrescription />} />

      {/* Protected Routes */}
      <Route path="/" element={
        <ProtectedRoute>
          <AppLayout>
            <AppointmentCalendar />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Appointments */}
      <Route path="/appointments" element={
        <ProtectedRoute>
          <AppLayout>
            <AppointmentCalendar />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/waiting-sequences" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <WaitingSequenceSettings />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      {/* Visits */}
      <Route path="/visits" element={
        <ProtectedRoute>
          <AppLayout>
            <VisitList />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/visits/:visitId" element={
        <ProtectedRoute>
          <AppLayout>
            <VisitDetails />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Patient Management */}
      <Route path="/patients" element={
        <ProtectedRoute>
          <AppLayout>
            <PatientListWithTimeline />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Case Upload & OCR */}
      <Route path="/case-upload" element={
        <ProtectedRoute>
          <AppLayout>
            <EnhancedCaseUpload />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Follow-ups */}
      <Route path="/follow-ups" element={
        <ProtectedRoute>
          <AppLayout>
            <TierRoute>
              <FollowUps />
            </TierRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* GMB Review Requests */}
      <Route path="/gmb-review-requests" element={
        <ProtectedRoute>
          <AppLayout>
            <TierRoute>
              <GMBReviewRequests />
            </TierRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Billing */}
      <Route path="/billing" element={
        <ProtectedRoute>
          <AppLayout>
            <BillingDashboard />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Daily Reconciliation */}
      <Route path="/billing/reconciliation" element={
        <ProtectedRoute>
          <AppLayout>
            <DailyReconciliation />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Pharmacy */}
      <Route path="/pharmacy" element={
        <ProtectedRoute>
          <AppLayout>
            <PharmacyDashboard />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/inward" element={
        <ProtectedRoute>
          <AppLayout>
            <InwardStock />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/reports" element={
        <ProtectedRoute>
          <AppLayout>
            <StockReport />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/suppliers" element={
        <ProtectedRoute>
          <AppLayout>
            <SupplierManagement />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/invoice-upload" element={
        <ProtectedRoute>
          <AppLayout>
            <InvoiceUpload />
          </AppLayout>
        </ProtectedRoute>
      } />


      {/* Analytics & Reports */}
      <Route path="/analytics" element={
        <ProtectedRoute>
          <AppLayout>
            <Analytics />
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Settings */}
      <Route path="/settings" element={
        <ProtectedRoute>
          <AppLayout>
            <Settings />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/settings/clinic" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <ClinicSettings />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/profile" element={
        <ProtectedRoute>
          <AppLayout>
            <ProfileSettings />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/settings/availability" element={
        <ProtectedRoute>
          <AppLayout>
            <DoctorAvailabilitySettings />
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/settings/users" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <UserManagement />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/master-data" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <MasterDataManagement />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/system" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <SystemSettings />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/presets" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <PrescriptionPresetSettings />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/examination-templates" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <ExaminationTemplateSettings />
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/whatsapp-ai" element={
        <ProtectedRoute>
          <AdminOrReceptionRoute>
            <AppLayout>
              <TierRoute>
                <WhatsappAndAIReviewSettings />
              </TierRoute>
            </AppLayout>
          </AdminOrReceptionRoute>
        </ProtectedRoute>
      } />

      <Route path="/settings/whatsapp-auto-send" element={
        <ProtectedRoute>
          <AdminRoute>
            <AppLayout>
              <TierRoute>
                <WhatsAppAutoSendSettings />
              </TierRoute>
            </AppLayout>
          </AdminRoute>
        </ProtectedRoute>
      } />

      <Route path="/chatbots" element={
        <ProtectedRoute>
          <AppLayout>
            <TierRoute>
              <ChatbotUtility />
            </TierRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* IPD Module (clinic-gated via ipd_enabled + user ipd_* permissions) */}
      <Route path="/ipd" element={
        <ProtectedRoute>
          <AppLayout>
            <IpdHome />
          </AppLayout>
        </ProtectedRoute>
      } />

      {([
        ['census', 'ipd_census', <IpdCensusPage />],
        ['bed-board', 'ipd_census', <IpdBedBoardPage />],
        ['admissions/new', 'ipd_admissions', <IpdNewAdmissionPage />],
        ['admissions/:id', 'ipd_admissions', <IpdAdmissionDetailsPage />],
        ['billing', 'ipd_billing', <IpdBillingPage />],
        ['stores', 'ipd_stores', <IpdStoresPage />],
        ['masters', 'ipd_masters', <IpdMastersPage />],
      ] as Array<[string, string, React.ReactElement]>).map(([path, perm, element]) => (
        <Route key={path} path={`/ipd/${path}`} element={
          <ProtectedRoute>
            <AppLayout>
              <IpdRoute perm={perm}>
                <React.Suspense fallback={<IpdPageLoader />}>
                  {element}
                </React.Suspense>
              </IpdRoute>
            </AppLayout>
          </ProtectedRoute>
        } />
      ))}

      {/* Catch all route - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

// Main App Component
const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Toaster position="top-right" />
          <AppContent />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
