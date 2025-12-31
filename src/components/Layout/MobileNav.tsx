import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Users,
  FileText,
  Calendar,
  BarChart3,
  Settings,
  Activity,
  Menu,
  X,
  CalendarDays,
  CreditCard,
  LogOut,
  User,
  Pill,
  Clock,
  Star,
  TrendingUp,
  Bot,
  RefreshCw
} from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import InstallPWA from '../PWA/InstallPWA';

const MobileNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();

  const navItems = [
    { path: '/', icon: CalendarDays, label: 'Appointments' },
    { path: '/visits', icon: Activity, label: 'Visits' },
    { path: '/patients', icon: Users, label: 'Patients' },
    { path: '/follow-ups', icon: Calendar, label: 'Follow-ups' },
    { path: '/gmb-review-requests', icon: Star, label: 'GMB Review Requests' },
    { path: '/billing', icon: CreditCard, label: 'Billing' },
    { path: '/billing/reconciliation', icon: TrendingUp, label: 'Daily Collection' },
    { path: '/pharmacy', icon: Pill, label: 'Pharmacy' },
    { path: '/pharmacy/invoice-upload', icon: FileText, label: 'Invoice Upload' },
    { path: '/chatbots', icon: Bot, label: 'AI Health Assistant' },
    { path: '/analytics', icon: BarChart3, label: 'Analytics' },
    { path: '/settings', icon: Settings, label: 'Settings' },
    ...(user?.isOpenForConsultation ? [{ path: '/settings/availability', icon: Clock, label: 'My Availability' }] : [])
  ];

  // Add admin-only navigation items
  if (user && (user.roleName?.toLowerCase() === 'admin' || user.roleName?.toLowerCase() === 'super_admin' || user.permissions.includes('admin') || user.permissions.includes('all'))) {
    navItems.splice(-1, 0,
      { path: '/settings/master-data', icon: Settings, label: 'AI Master Data' },
      { path: '/settings/users', icon: Users, label: 'User Management' },
      { path: '/settings/whatsapp-ai', icon: Settings, label: 'WhatsApp & AI' }
    );
  }

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsOpen(false);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const closeMenu = () => setIsOpen(false);

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 fixed top-0 left-0 right-0 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Clinic Logo/Name */}
            {user?.clinic && (
              <div className="flex items-center gap-2 mr-3">
                {user.clinic.logoUrl &&
                  user.clinic.logoUrl.trim() &&
                  !user.clinic.logoUrl.includes('example.com') ? (
                  <img
                    src={user.clinic.logoUrl}
                    alt={user.clinic.clinicName}
                    className="w-8 h-8 object-contain rounded bg-blue-50 p-1"
                    onError={(e) => {
                      console.warn('Failed to load clinic logo:', user.clinic?.logoUrl);
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                    <span className="text-blue-600 font-bold text-xs">
                      {user.clinic.clinicName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-gray-800 truncate max-w-32">
                    {user.clinic.clinicName}
                  </p>
                </div>
              </div>
            )}

            {/* Platform Branding */}
            <img
              src="https://i.ibb.co/XxgNyzFj/DC-logo.png"
              alt="Doctorpreneur Academy Logo"
              className="w-5 h-5 object-contain"
            />
            <div className="hidden sm:block">
              <p className="text-xs text-gray-500">Doctorpreneur Academy</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* User Avatar */}
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                  </span>
                </div>
              </div>
            )}

            {/* Menu Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={closeMenu}
        />
      )}

      {/* Mobile Menu */}
      <nav className={`lg:hidden fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-white border-l border-gray-200 transform transition-transform duration-300 ease-in-out z-40 ${isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <img
                  src="https://i.ibb.co/XxgNyzFj/DC-logo.png"
                  alt="Doctorpreneur Academy Logo"
                  className="w-6 h-6 object-contain"
                />
                <div>
                  <p className="text-xs text-gray-500">The Doctorpreneur Academy</p>
                </div>
              </div>
              <button
                onClick={closeMenu}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* User Info */}
            {user && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-medium">
                      {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{user?.name ?? 'User'}</p>
                    <p className="text-xs text-gray-600 truncate">{user.roleName || 'User'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation Items */}
          <div className="flex-1 p-6 overflow-y-auto">
            <ul className="space-y-2">
              {navItems.map(({ path, icon: Icon, label }) => {
                // Hide availability link for non-consultation users
                if (path === '/settings/availability' && !user?.isOpenForConsultation) {
                  return null;
                }

                return (
                  <li key={path}>
                    <Link
                      to={path}
                      onClick={closeMenu}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${location.pathname === path
                          ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                        }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Quick Actions */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Quick Actions</h3>
              <div className="space-y-3 flex-1">
                {/* Clinic Branding */}
                {user?.clinic && (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    {user.clinic.logoUrl &&
                      user.clinic.logoUrl.trim() &&
                      !user.clinic.logoUrl.includes('example.com') ? (
                      <img
                        src={user.clinic.logoUrl}
                        alt={user.clinic.clinicName}
                        className="w-10 h-10 object-contain rounded-lg bg-white p-1"
                        onError={(e) => {
                          console.warn('Failed to load clinic logo:', user.clinic?.logoUrl);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 font-bold text-sm">
                          {user.clinic.clinicName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-md font-bold text-blue-800 truncate">
                        {user.clinic.clinicName}
                      </h2>
                    </div>
                  </div>
                )}

                {/* Platform Branding */}
                <div className="flex items-center gap-2">
                  <Link
                    to="/settings/profile"
                    onClick={closeMenu}
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm"
                  >
                    <User className="w-4 h-4" />
                    Profile
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Install PWA Button */}
          <div className="px-6 pb-2">
            <InstallPWA variant="sidebar" />
          </div>

          {/* Refresh & Sign Out Buttons */}
          <div className="p-6 border-t border-gray-200 space-y-2">
            {/* Refresh Button - Useful for PWA */}
            <button
              onClick={() => window.location.reload()}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
              <span className="font-medium">Refresh App</span>
            </button>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </nav>
    </>
  );
};

export default MobileNav;