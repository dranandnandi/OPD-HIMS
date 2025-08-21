import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import CaseUpload from './components/CaseUpload/CaseUpload';
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
import SystemSettings from './components/Settings/SystemSettings';
import DoctorAvailabilitySettings from './components/Settings/DoctorAvailabilitySettings';
import WhatsappAndAIReviewSettings from './components/Settings/WhatsappAndAIReviewSettings';

// GMB Review Requests
import GMBReviewRequests from './components/GMBReviewRequests/GMBReviewRequests';

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
            <FollowUps />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      {/* GMB Review Requests */}
      <Route path="/gmb-review-requests" element={
        <ProtectedRoute>
          <AppLayout>
            <GMBReviewRequests />
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
      
      <Route path="/pharmacy/reports" element={
        <ProtectedRoute>
          <AppLayout>
            <StockReport />
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
          <AppLayout>
            <ClinicSettings />
          </AppLayout>
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
          <AppLayout>
            <UserManagement />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/settings/master-data" element={
        <ProtectedRoute>
          <AppLayout>
            <MasterDataManagement />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/settings/system" element={
        <ProtectedRoute>
          <AppLayout>
            <SystemSettings />
          </AppLayout>
        </ProtectedRoute>
      } />
      
      <Route path="/settings/whatsapp-ai" element={
        <ProtectedRoute>
          <AppLayout>
            <WhatsappAndAIReviewSettings />
          </AppLayout>
        </ProtectedRoute>
      } />
      
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
          <AppContent />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;