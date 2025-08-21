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
  Clock,
  Star,
  TrendingUp
} from 'lucide-react';
import { useAuth } from '../Auth/useAuth';

const Navigation: React.FC = () => {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const navItems = [
    { path: '/', icon: CalendarDays, label: 'Appointments', description: 'Schedule & manage appointments' },
    { path: '/visits', icon: Activity, label: 'Visits', description: 'View all patient visits' },
    { path: '/patients', icon: Users, label: 'Patients', description: 'Manage patient records' },
    { path: '/follow-ups', icon: Calendar, label: 'Follow-ups', description: 'Track patient follow-ups' },
    { path: '/gmb-review-requests', icon: Star, label: 'GMB Review Requests', description: 'Send review requests to patients' },
    { path: '/billing', icon: CreditCard, label: 'Billing', description: 'Manage bills & payments' },
    { path: '/billing/reconciliation', icon: TrendingUp, label: 'Daily Collection', description: 'Daily payment reconciliation' },
    { path: '/pharmacy', icon: Pill, label: 'Pharmacy', description: 'Manage medicine inventory' },
    { path: '/pharmacy/invoice-upload', icon: FileText, label: 'Invoice Upload', description: 'AI-powered invoice processing' },
    { path: '/analytics', icon: BarChart3, label: 'Analytics', description: 'Reports & insights' },
    { path: '/settings', icon: Settings, label: 'Settings', description: 'System configuration' },
    ...(user?.isOpenForConsultation ? [{ path: '/settings/availability', icon: Clock, label: 'My Availability', description: 'Set consultation hours' }] : [])
  ];

  // Add admin-only navigation items
  if (user && (user.roleName === 'admin' || user.roleName === 'super_admin')) {
    navItems.splice(-1, 0, 
      { path: '/settings/master-data', icon: Settings, label: 'AI Master Data', description: 'AI-powered data entry' },
      { path: '/settings/users', icon: Users, label: 'User Management', description: 'Manage clinic staff' },
      { path: '/settings/whatsapp-ai', icon: Settings, label: 'WhatsApp & AI', description: 'Messaging & review settings' }
    );
  }

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <nav className="bg-white border-r border-gray-200 h-screen w-64 fixed left-0 top-0 z-10 flex flex-col">
      <div className="flex-1 p-6 overflow-y-auto">
        {/* Logo & Title */}
        <div className="space-y-4 mb-8">
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
          <div className="mb-6 p-3 bg-blue-50 rounded-lg">
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
        
        {/* Navigation Items */}
        <ul className="space-y-1">
          {navItems.map(({ path, icon: Icon, label, description }) => {
            // Hide availability link for non-consultation users
            if (path === '/settings/availability' && !user?.isOpenForConsultation) {
              return null;
            }
            
            return (
            <li key={path}>
              <Link
                to={path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group ${
                  location.pathname === path
                    ? 'bg-blue-50 text-blue-600 border-r-2 border-blue-600 shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <Icon className={`w-5 h-5 transition-colors ${
                  location.pathname === path ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-gray-500 truncate">{description}</div>
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      </div>
      
      {/* Sign Out Button */}
      <div className="p-6 border-t border-gray-200">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-3 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Sign Out</span>
        </button>
      </div>
    </nav>
  );
};

export default Navigation;