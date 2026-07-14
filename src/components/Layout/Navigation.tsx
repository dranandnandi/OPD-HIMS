import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Users,
  FileText,
  Calendar,
  BarChart3,
  Settings,
  Activity,
  CalendarDays,
  CreditCard,
  LogOut,
  Pill,
  Star,
  TrendingUp,
  Bot,
  RefreshCw,
  ChevronDown,
  LayoutDashboard,
  BedDouble,
  UserPlus,
  Receipt,
  Warehouse
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../Auth/useAuth';
import InstallPWA from '../PWA/InstallPWA';

interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
  description: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const EXPANDED_GROUPS_KEY = 'sidebar_expanded_groups';

const Navigation: React.FC = () => {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const clinicTier = user?.clinic?.clinicTier ?? 'silver';
  const isBasic = clinicTier === 'basic';
  const ipdEnabled = user?.clinic?.ipdEnabled ?? false;
  const roleName = user?.roleName?.toLowerCase();
  const permissions = user?.permissions ?? [];
  const isAdmin = Boolean(
    user && (
      roleName === 'admin' ||
      roleName === 'super_admin' ||
      permissions.includes('admin') ||
      permissions.includes('all')
    )
  );
  const hasIpdPermission = (perm: string) =>
    isAdmin || permissions.includes(perm) || permissions.includes('all');

  // IPD items are permission-filtered per user; the whole group hides when the
  // clinic's ipd_enabled flag is off or the user holds no ipd_* permission.
  const ipdItems: NavItem[] = ipdEnabled
    ? ([
      { path: '/ipd/census', icon: LayoutDashboard, label: 'Census', description: 'Ward census & occupancy', perm: 'ipd_census' },
      { path: '/ipd/bed-board', icon: BedDouble, label: 'Bed Board', description: 'Live bed status', perm: 'ipd_census' },
      { path: '/ipd/admissions/new', icon: UserPlus, label: 'New Admission', description: 'Admit a patient', perm: 'ipd_admissions' },
      { path: '/ipd/billing', icon: Receipt, label: 'IPD Billing', description: 'Deposits, interim & final bills', perm: 'ipd_billing' },
      { path: '/ipd/stores', icon: Warehouse, label: 'Stores', description: 'Ward stores & indents', perm: 'ipd_stores' },
    ] as Array<NavItem & { perm: string }>)
      .filter(({ perm }) => hasIpdPermission(perm))
      .map(({ perm: _perm, ...item }) => item)
    : [];

  const groups: NavGroup[] = [
    {
      id: 'front-desk',
      label: 'Front Desk',
      items: [
        { path: '/', icon: CalendarDays, label: 'Appointments', description: 'Schedule & manage appointments' },
        { path: '/patients', icon: Users, label: 'Patients', description: 'Manage patient records' },
      ],
    },
    {
      id: 'opd',
      label: 'OPD',
      items: [
        { path: '/visits', icon: Activity, label: 'Visits', description: 'View all patient visits' },
        ...(!isBasic ? [{ path: '/follow-ups', icon: Calendar, label: 'Follow-ups', description: 'Track patient follow-ups' }] : []),
      ],
    },
    ...(ipdItems.length > 0 ? [{ id: 'ipd', label: 'IPD', items: ipdItems }] : []),
    {
      id: 'billing',
      label: 'Billing',
      items: [
        { path: '/billing', icon: CreditCard, label: 'OPD Billing', description: 'Manage bills & payments' },
        { path: '/billing/reconciliation', icon: TrendingUp, label: 'Daily Collection', description: 'Daily payment reconciliation' },
      ],
    },
    {
      id: 'pharmacy',
      label: 'Pharmacy',
      items: [
        { path: '/pharmacy', icon: Pill, label: 'Pharmacy', description: 'Manage medicine inventory' },
        { path: '/pharmacy/invoice-upload', icon: FileText, label: 'Invoice Upload', description: 'AI-powered invoice processing' },
      ],
    },
    ...(!isBasic
      ? [{
        id: 'growth',
        label: 'Growth & AI',
        items: [
          { path: '/gmb-review-requests', icon: Star, label: 'GMB Review Requests', description: 'Send review requests to patients' },
          { path: '/chatbots', icon: Bot, label: 'AI Health Assistant', description: 'Ayurvedic chatbot support' },
        ],
      }]
      : []),
  ];

  // Analytics & Settings stay pinned at the bottom of the list, outside groups.
  // Waiting Sequences, Doctor Availability, AI Master Data, User Management,
  // WhatsApp & AI and IPD Masters are reachable from the Settings page instead
  // of crowding the sidebar.
  const bottomItems: NavItem[] = [
    { path: '/analytics', icon: BarChart3, label: 'Analytics', description: 'Reports & insights' },
    { path: '/settings', icon: Settings, label: 'Settings', description: 'System configuration' },
  ];

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(EXPANDED_GROUPS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const isGroupExpanded = (group: NavGroup) =>
    expanded[group.id] ?? true; // default open

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try {
        localStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable — keep in-memory state only
      }
      return next;
    });
  };

  // Always reveal the group that owns the current route.
  const groupOfPath = groups.find((g) => g.items.some(({ path }) => path === location.pathname));

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const renderItem = ({ path, icon: Icon, label, description }: NavItem) => (
    <li key={path}>
      <Link
        to={path}
        title={description}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 group ${location.pathname === path
          ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600 shadow-sm'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
          }`}
      >
        <Icon className={`w-5 h-5 transition-colors ${location.pathname === path ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
          }`} />
        <span className="font-medium truncate">{label}</span>
      </Link>
    </li>
  );

  return (
    <nav className="bg-white border-r border-gray-200 h-screen w-64 fixed left-0 top-0 z-10 flex flex-col">
      <div className="flex-1 p-6 overflow-y-auto">
        {/* Logo & Title */}
        <div className="space-y-4 mb-6">
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
              ) : null}
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-blue-800 truncate">
                  {user.clinic.clinicName}
                </h2>
              </div>
            </div>
          )}

          {/* Platform Branding */}
          <div className="flex items-center gap-2">
            <img
              src="https://i.ibb.co/XxgNyzFj/DC-logo.png"
              alt="Doctorpreneur Academy Logo"
              className="w-6 h-6 object-contain"
            />
            <div>
              <p className="text-xs text-gray-500">Powered by The Doctorpreneur Academy</p>
            </div>
          </div>
        </div>

        {/* User Info */}
        {user && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{user?.name ?? 'User'}</p>
                <p className="text-xs text-gray-600 truncate">{user.roleName || 'User'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Grouped Navigation */}
        <div className="space-y-1">
          {groups.map((group) => {
            const open = isGroupExpanded(group) || group === groupOfPath;
            return (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                </button>
                {open && <ul className="space-y-0.5">{group.items.map(renderItem)}</ul>}
              </div>
            );
          })}

          {/* Bottom (ungrouped) */}
          <div className="pt-3 mt-2 border-t border-gray-100">
            <ul className="space-y-0.5">{bottomItems.map(renderItem)}</ul>
          </div>
        </div>
      </div>

      {/* Install PWA Button */}
      <div className="px-6 pb-2">
        <InstallPWA variant="sidebar" />
      </div>

      {/* Refresh & Sign Out Buttons */}
      <div className="p-6 pt-3 border-t border-gray-200 space-y-1">
        {/* Refresh Button - Useful for PWA */}
        <button
          onClick={() => {
            window.location.reload();
          }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
          title="Refresh to get latest data"
        >
          <RefreshCw className="w-5 h-5" />
          <span className="font-medium">Refresh App</span>
        </button>

        {/* Sign Out */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </nav>
  );
};

export default Navigation;
