import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './components/Auth/AuthProvider';
import { useAuth } from './components/Auth/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import { brand } from './config/branding';
import LoginForm from './components/Auth/LoginForm';
import Navigation from './components/Layout/Navigation';
import MobileNav from './components/Layout/MobileNav';
import './lib/supabaseClient'; // ✅ This ensures it initializes


// Patient Management
import PatientListWithTimeline from './components/Patients/PatientListWithTimeline';

// Case Upload & OCR
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
import RefundQueue from './components/Billing/RefundQueue';
import IncomeBreakup from './components/Reports/IncomeBreakup';

// Pharmacy
import PharmacyDashboard from './components/Pharmacy/PharmacyDashboard';
import InwardStock from './components/Pharmacy/InwardStock';
import StockReport from './components/Pharmacy/StockReport';
import SupplierManagement from './components/Pharmacy/SupplierManagement';
import InvoiceUpload from './components/Pharmacy/InvoiceUpload';
import StoreIndents from './components/Pharmacy/StoreIndents';

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

// GMB Review Requests
import GMBReviewRequests from './components/GMBReviewRequests/GMBReviewRequests';

// Verify Prescription (public page — no auth required)
import VerifyPrescription from './pages/VerifyPrescription';

// Patient document upload (public page — no auth required)
import PatientUpload from './pages/PatientUpload';

// Patient self-booking (public page — no auth required)
import PublicBooking from './pages/PublicBooking';
import { hasReceptionAccess } from './utils/roleAccess';
import { hasModuleAccess, resolveLandingPath } from './utils/modulePermissions';

// IPD module — lazy-loaded so OPD-only users never download it (CKEditor/xlsx are heavy)
const IpdCensusPage = React.lazy(() => import('./modules/ipd/pages/CensusPage'));
const IpdBedBoardPage = React.lazy(() => import('./modules/ipd/pages/BedBoardPage'));
const IpdNewAdmissionPage = React.lazy(() => import('./modules/ipd/pages/NewAdmissionPage'));
const IpdAdmissionDetailsPage = React.lazy(() => import('./modules/ipd/pages/AdmissionDetailsPage'));
const IpdBillingPage = React.lazy(() => import('./modules/ipd/pages/BillingPage'));
const IpdDischargesPage = React.lazy(() => import('./modules/ipd/pages/DischargesPage'));
const IpdTpaPage = React.lazy(() => import('./modules/ipd/pages/TpaClaimsPage'));
const IpdDoctorSharePage = React.lazy(() => import('./modules/ipd/pages/DoctorSharePage'));
const IpdStoresPage = React.lazy(() => import('./modules/ipd/pages/StoresPage'));
const IpdMastersPage = React.lazy(() => import('./modules/ipd/pages/MastersPage'));
// Ward alert bar — pending/missed doses and observations, shown above every
// IPD page. Lazy like the pages so it stays out of the main OPD bundle.
const IpdAlertBar = React.lazy(() => import('./modules/ipd/components/Alerts/IpdAlertBar'));

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

// Module Route - role-wise tab access. The user's role must be granted the
// module, otherwise they are sent to the first module they *can* open (not to
// "/", which is itself a gated module now). Roles that predate module
// permissions fall through open — see hasModuleAccess.
const ModuleRoute: React.FC<{ perm: string; children: React.ReactNode }> = ({ perm, children }) => {
  const { user } = useAuth();

  if (!hasModuleAccess(user, perm)) {
    const landing = resolveLandingPath(user);
    return <Navigate to={landing} replace />;
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
            {brand.supportContact} to upgrade.
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
            {brand.supportContact} to enable IPD for your clinic.
          </p>
        </div>
      </div>
    );
  }

  if (!isAdmin && !hasPermission(perm)) {
    return <Navigate to={resolveLandingPath(user)} replace />;
  }

  return (
    <>
      {/* Always on screen inside IPD: anything pending or missed surfaces here
          instead of staying buried in one patient's chart. */}
      <React.Suspense fallback={null}>
        <IpdAlertBar />
      </React.Suspense>
      {children}
    </>
  );
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
  return <Navigate to={target ? target[0] : resolveLandingPath(user)} replace />;
};

// Suspense fallback for lazy-loaded IPD pages
const IpdPageLoader: React.FC = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
  </div>
);

// Admin-or-Reception Route Component - admin/super_admin OR the `reception` permission
const AdminOrReceptionRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const isAllowed = hasReceptionAccess(user);

  if (!isAllowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Main App Layout Component

const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-soft-gray">
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
      <Route path="/patient-upload" element={<PatientUpload />} />

      {/*
        Public self-booking. Three URL shapes, one component — handled in the
        router rather than by host rewrites so they behave identically in dev,
        on opdapp.anprohealthtech.com and on docpreneur.academy.

          /book/meditrust                 canonical, safe to share anywhere
          /opd/meditrust/appointment      anprohealthtech vanity form
          /meditrust/appointment          docpreneur vanity form

        The last one is a bare top-level segment, so it is deliberately pinned
        to a literal "appointment" second segment. React Router ranks static
        segments above dynamic ones, so real app routes still win; only
        two-segment paths ending in /appointment fall through to here.
      */}
      <Route path="/book/:clinicSlug" element={<PublicBooking />} />
      <Route path="/opd/:clinicSlug/appointment" element={<PublicBooking />} />
      <Route path="/:clinicSlug/appointment" element={<PublicBooking />} />

      {/* Protected Routes */}
      <Route path="/" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_appointments">
              <AppointmentCalendar />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Appointments */}
      <Route path="/appointments" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_appointments">
              <AppointmentCalendar />
            </ModuleRoute>
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
            <ModuleRoute perm="opd_visits">
              <VisitList />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/visits/:visitId" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_visits">
              <VisitDetails />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Patient Management */}
      <Route path="/patients" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_patients">
              <PatientListWithTimeline />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Case Upload & OCR */}
      <Route path="/case-upload" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_patients">
              <EnhancedCaseUpload />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Follow-ups */}
      <Route path="/follow-ups" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_followups">
              <TierRoute>
                <FollowUps />
              </TierRoute>
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* GMB Review Requests */}
      <Route path="/gmb-review-requests" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="gmb_reviews">
              <TierRoute>
                <GMBReviewRequests />
              </TierRoute>
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Billing */}
      <Route path="/billing" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_billing">
              <BillingDashboard />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Daily Reconciliation */}
      <Route path="/billing/reconciliation" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_collections">
              <DailyReconciliation />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Clinic-wide refund worklist */}
      <Route path="/billing/refunds" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="opd_billing">
              <RefundQueue />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Income break-up across OPD and IPD */}
      <Route path="/billing/income" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="analytics">
              <IncomeBreakup />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      {/* Pharmacy */}
      <Route path="/pharmacy" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <PharmacyDashboard />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/inward" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <InwardStock />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/reports" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <StockReport />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/suppliers" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <SupplierManagement />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/indents" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <StoreIndents />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />

      <Route path="/pharmacy/invoice-upload" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="pharmacy">
              <InvoiceUpload />
            </ModuleRoute>
          </AppLayout>
        </ProtectedRoute>
      } />


      {/* Analytics & Reports */}
      <Route path="/analytics" element={
        <ProtectedRoute>
          <AppLayout>
            <ModuleRoute perm="analytics">
              <Analytics />
            </ModuleRoute>
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
            <ModuleRoute perm="chatbots">
              <TierRoute>
                <ChatbotUtility />
              </TierRoute>
            </ModuleRoute>
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
        ['discharges', 'ipd_billing', <IpdDischargesPage />],
        ['tpa', 'ipd_billing', <IpdTpaPage />],
        ['doctor-share', 'ipd_billing', <IpdDoctorSharePage />],
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
