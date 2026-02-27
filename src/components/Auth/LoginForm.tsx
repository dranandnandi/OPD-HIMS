import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, WifiOff, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';
import { AuthContext } from './AuthContext';

// 12-second timeout for login fetch calls
function withTimeout<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes('failed to fetch') || m.includes('network_timeout') || m.includes('networkerror') || m.includes('load failed');
}

const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const authCtx = useContext(AuthContext);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNetworkErr, setIsNetworkErr] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setIsNetworkErr(false);

    try {
      const signInResult = await withTimeout(authService.signIn(formData.email, formData.password));
      
      if (signInResult?.user) {
        let profile = await authService.getCurrentProfile();
        if (!profile) {
          const roles = await authService.getRoles();
          const defaultRole = roles.find(role => role.name.toLowerCase() === 'doctor') || 
                             roles.find(role => role.name.toLowerCase() === 'user') ||
                             roles[0];
          if (!defaultRole) throw new Error('No roles found in system. Please contact administrator.');
          profile = await authService.createProfile(signInResult.user.id, {
            roleId: defaultRole.id,
            name: signInResult.user.email?.split('@')[0] || 'User',
            email: signInResult.user.email || '',
            phone: undefined, specialization: undefined,
            qualification: undefined, registrationNo: undefined,
            isActive: true, isOpenForConsultation: false
          });
        }
      }
      navigate('/');
    } catch (err) {
      if (isNetworkError(err)) {
        setIsNetworkErr(true);
        setError('Cannot connect to the server. This is likely a DNS issue with your internet provider.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Show banner if AuthProvider detected network issue on initial load
  const showNetworkBanner = authCtx?.isNetworkDown || isNetworkErr;

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-soft-gray">
      <div className="max-w-[480px] w-full bg-white rounded-lg p-8 shadow-lg">
        <div>
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-black rounded-full flex items-center justify-center shadow-md">
              <img 
                src="https://i.ibb.co/8Lm1rMhv/DC-logo.png" 
                alt="Doctorpreneur Academy Logo" 
                className="w-12 h-12 object-contain"
              />
            </div>
          </div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900 mb-2">
            Welcome to The Doctorpreneur Academy
          </h2>
          <h3 className="text-center text-xl font-medium text-blue-600 mb-2">
            OPD Management Module
          </h3>
          <p className="text-center text-sm text-gray-600 mb-8">
            Sign in to manage your clinic's OPD
          </p>
        </div>
        
        <form className="space-y-4" onSubmit={handleSubmit}>

          {/* DNS / Network error banner */}
          {showNetworkBanner && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <WifiOff className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">Network / DNS Issue Detected</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Your internet provider's DNS may be blocking the server.<br />
                    <strong>Fix:</strong> Change your DNS to <code className="bg-amber-100 px-1 rounded">8.8.8.8</code> (Google DNS) or <code className="bg-amber-100 px-1 rounded">1.1.1.1</code> (Cloudflare).
                  </p>
                  <button
                    type="button"
                    onClick={() => { setIsNetworkErr(false); setError(null); authCtx?.retryConnection(); }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-md transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry Connection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Generic error */}
          {error && !showNetworkBanner && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="block w-full px-4 py-3 h-12 border border-gray-300 rounded-lg focus:outline-none"
                placeholder="Enter your email address"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="block w-full px-4 pr-10 py-3 h-12 border border-gray-300 rounded-lg focus:outline-none"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="keep-signed-in"
                name="keep-signed-in"
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="keep-signed-in" className="ml-2 block text-xs text-gray-600">
                Keep me signed in
              </label>
            </div>
            <button
              type="button"
              className="text-xs text-gray-600 hover:text-blue-600 transition-colors"
              onClick={() => alert('Password reset functionality will be implemented soon')}
            >
              Forgot Password?
            </button>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center px-4 h-12 border border-transparent text-base font-semibold rounded-lg text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
          
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 mb-2">
              Need help? Contact your system administrator
            </p>
            <p className="text-xs text-gray-500">
              Powered by The Doctorpreneur Technologies © 2025
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;