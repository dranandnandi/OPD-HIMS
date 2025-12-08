import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, Activity } from 'lucide-react';
import { authService } from '../../services/authService';

const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const signInResult = await authService.signIn(formData.email, formData.password);
      
      // After successful sign-in, ensure a profile exists
      if (signInResult?.user) {
        let profile = await authService.getCurrentProfile();
        if (!profile) {
          if (import.meta.env.DEV) {
            console.log('No profile found for user, creating default profile...');
          }
          
          // Get default role ID (we'll use a fallback if none exists)
          const roles = await authService.getRoles();
          const defaultRole = roles.find(role => role.name.toLowerCase() === 'doctor') || 
                             roles.find(role => role.name.toLowerCase() === 'user') ||
                             roles[0]; // Use first available role as fallback
          
          if (!defaultRole) {
            throw new Error('No roles found in system. Please contact administrator.');
          }
          
          // Create a basic profile for the user
          profile = await authService.createProfile(signInResult.user.id, {
            roleId: defaultRole.id,
            name: signInResult.user.email?.split('@')[0] || 'User',
            email: signInResult.user.email || '',
            phone: undefined,
            specialization: undefined,
            qualification: undefined,
            registrationNo: undefined,
            isActive: true
          });
          if (import.meta.env.DEV) {
            console.log('New profile created:', profile);
          }
        }
      }
      
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

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
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
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