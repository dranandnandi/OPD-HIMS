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
  Star,
  TrendingUp,
  PieChart,
  RefreshCw,
  LayoutDashboard,
  BedDouble,
  UserPlus,
  Receipt,
  Warehouse,
  ShieldCheck,
  Percent,
  MessageCircle,
  ClipboardList, RotateCcw} from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import { hasReceptionAccess } from '../../utils/roleAccess';
import { hasModuleAccess } from '../../utils/modulePermissions';
import InstallPWA from '../PWA/InstallPWA';
import { brand } from '../../config/branding';

const MobileNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();

  const clinicTier = user?.clinic?.clinicTier ?? 'silver';
  const isBasic = clinicTier === 'basic';
  const ipdEnabled = user?.clinic?.ipdEnabled ?? false;

  // Mirrors AdminOrReceptionRoute in App.tsx, which guards /settings/whatsapp-ai.
  const isAdminOrReception = hasReceptionAccess(user);

  // Same grouped structure and the same module gating as the desktop sidebar
  // (Navigation.tsx) — keep the two in step. Items moved off the menu (Waiting
  // Sequences, Doctor Availability, AI Master Data, User Management, IPD
  // Masters) live in Settings. Items without a `perm` carry their own gate.
  const gatedGroups: Array<{
    label: string;
    items: Array<{ path: string; icon: typeof Users; label: string; perm?: string }>;
  }> = [
    {
      label: 'Front Desk',
      items: [
        { path: '/', icon: CalendarDays, label: 'Appointments', perm: 'opd_appointments' },
        { path: '/patients', icon: Users, label: 'Patients', perm: 'opd_patients' },
      ],
    },
    {
      label: 'OPD',
      items: [
        { path: '/visits', icon: Activity, label: 'Visits', perm: 'opd_visits' },
        ...(!isBasic ? [{ path: '/follow-ups', icon: Calendar, label: 'Follow-ups', perm: 'opd_followups' }] : []),
      ],
    },
    ...(ipdEnabled
      ? [{
        label: 'IPD',
        items: [
          { path: '/ipd/census', icon: LayoutDashboard, label: 'Census', perm: 'ipd_census' },
          { path: '/ipd/bed-board', icon: BedDouble, label: 'Bed Board', perm: 'ipd_census' },
          { path: '/ipd/admissions/new', icon: UserPlus, label: 'New Admission', perm: 'ipd_admissions' },
          { path: '/ipd/billing', icon: Receipt, label: 'IPD Billing', perm: 'ipd_billing' },
          { path: '/ipd/discharges', icon: LogOut, label: 'Discharges', perm: 'ipd_billing' },
          { path: '/ipd/tpa', icon: ShieldCheck, label: 'TPA / Insurance', perm: 'ipd_billing' },
          { path: '/ipd/doctor-share', icon: Percent, label: 'Doctor Share', perm: 'ipd_billing' },
          { path: '/ipd/stores', icon: Warehouse, label: 'Stores', perm: 'ipd_stores' },
        ],
      }]
      : []),
    {
      label: 'Billing',
      items: [
        { path: '/billing', icon: CreditCard, label: 'OPD Billing', perm: 'opd_billing' },
        { path: '/billing/reconciliation', icon: TrendingUp, label: 'Daily Collection', perm: 'opd_collections' },
        { path: '/billing/refunds', icon: RotateCcw, label: 'Refund Requests', perm: 'opd_billing' },
        { path: '/billing/income', icon: PieChart, label: 'Income Break-up', perm: 'analytics' },
      ],
    },
    {
      label: 'Pharmacy',
      items: [
        { path: '/pharmacy', icon: Pill, label: 'Pharmacy', perm: 'pharmacy' },
        { path: '/pharmacy/invoice-upload', icon: FileText, label: 'Invoice Upload', perm: 'pharmacy' },
        { path: '/pharmacy/indents', icon: ClipboardList, label: 'Ward Indents', perm: 'pharmacy' },
      ],
    },
    ...(!isBasic
      ? [{
        label: 'Growth & AI',
        items: [
          { path: '/gmb-review-requests', icon: Star, label: 'GMB Review Requests', perm: 'gmb_reviews' },
          ...(isAdminOrReception
            ? [{ path: '/settings/whatsapp-ai', icon: MessageCircle, label: 'WhatsApp & AI' }]
            : []),
        ],
      }]
      : []),
    {
      label: 'General',
      items: [
        { path: '/analytics', icon: BarChart3, label: 'Analytics', perm: 'analytics' },
        // Settings is never gated — it hosts every user's own profile page.
        { path: '/settings', icon: Settings, label: 'Settings' },
      ],
    },
  ];

  const navGroups = gatedGroups
    .map(({ label, items }) => ({
      label,
      items: items.filter(({ perm }) => !perm || hasModuleAccess(user, perm)),
    }))
    .filter((group) => group.items.length > 0);

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
              src={brand.logoUrl}
              alt={`${brand.company} Logo`}
              className={brand.navLogoClassSmall}
            />
            <div className="hidden sm:block">
              <p className="text-xs text-gray-500">{brand.companyShort}</p>
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
                  src={brand.logoUrl}
                  alt={`${brand.company} Logo`}
                  className={brand.navLogoClass}
                />
                <div>
                  <p className="text-xs text-gray-500">{brand.company}</p>
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
            <div className="space-y-4">
              {navGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </p>
                  <ul className="space-y-1">
                    {group.items.map(({ path, icon: Icon, label }) => (
                      <li key={path}>
                        <Link
                          to={path}
                          onClick={closeMenu}
                          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${location.pathname === path
                            ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                            }`}
                        >
                          <Icon className="w-5 h-5" />
                          <span className="font-medium">{label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

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
