import React, { useEffect, useState, useRef } from 'react';
import { Profile } from '../../types';
import { authService } from '../../services/authService';
import { getCurrentProfile, getProfileFromLocalStorage } from '../../services/profileService';
import { AuthContext } from './AuthContext';
import { WhatsAppUserSyncService } from '../../services/whatsappUserSyncService';

interface AuthProviderProps {
  children: React.ReactNode;
}

const fetchWithTimeout = <T,>(promise: Promise<T>): Promise<T> => {
  return promise;
};

async function fetchWithRetry<T>(fetchFn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      return await fetchWithTimeout(fetchFn());
    } catch (err) {
      console.error('Fetch attempt failed, retrying...', err);
      await new Promise((res) => setTimeout(res, 300));
    }
  }
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const lastProfileRef = useRef<Profile | null>(null);
  const lastHandledAt = useRef<number>(0);

  const isProfileChanged = (newProfile: Profile | null, oldProfile: Profile | null): boolean => {
    if ((newProfile === null) !== (oldProfile === null)) return true;
    if (newProfile === null && oldProfile === null) return false;
    return newProfile!.id !== oldProfile!.id;
  };

  const updateUserIfChanged = (newProfile: Profile | null) => {
    if (isProfileChanged(newProfile, lastProfileRef.current)) {
      if (import.meta.env.DEV) {
        console.log('🔄 User profile changed, updating state:', newProfile?.id || 'null');
      }
      setUser(newProfile);
    } else {
      if (import.meta.env.DEV) {
        console.log('✅ User profile unchanged, skipping state update');
      }
    }
    lastProfileRef.current = newProfile;
  };

  const tryLoadLocalProfile = () => {
    if (import.meta.env.DEV) {
      console.log('🔄 Attempting to load profile from local storage...');
    }
    try {
      const localProfile = getProfileFromLocalStorage();
      if (localProfile) {
        if (import.meta.env.DEV) {
          console.log('✅ Found local profile:', localProfile.name);
        }
        updateUserIfChanged(localProfile);
        setAuthError(null);
        setLoading(false);
      } else {
        if (import.meta.env.DEV) {
          console.log('❌ No local profile found');
        }
        setAuthError('No saved profile found locally. Please log in again.');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('❌ Error loading local profile:', error);
      }
      setAuthError('Failed to load saved profile. Please log in again.');
    }
  };
  useEffect(() => {
    const checkSession = async () => {
      if (import.meta.env.DEV) {
        console.log('🔐 Starting session check...');
      }

      try {
        if (!authService.isSupabaseAvailable()) {
          throw new Error('Supabase client not initialized. Check environment config.');
        }

        const sessionResult = await fetchWithRetry(() => authService.getSession());
        if (!sessionResult) throw new Error('No session response received from Supabase.');

        const { session, error: sessionError } = sessionResult;
        
        // Log detailed session information for initial check
        if (import.meta.env.DEV) {
          console.log('🔐 [InitialSession] Session user ID:', session?.user?.id);
          console.log('🔐 [InitialSession] Session access token present:', !!session?.access_token);
          console.log('⚠️ [InitialSession] sessionError details:', sessionError);
        }
        
        if (sessionError) throw new Error(sessionError.message);

        if (!session?.user) {
          const localProfile = getProfileFromLocalStorage();
          if (localProfile) {
            if (import.meta.env.DEV) {
              console.log('🧹 No session found, clearing cached profile data');
            }
            localStorage.removeItem('bolt_user_profile');
            updateUserIfChanged(null);
            setAuthError('Session expired. Please log in again.');
          } else {
            updateUserIfChanged(null);
            setAuthError(null);
          }
          setLoading(false);
          return;
        }

        // Pass the userId directly from the session to avoid auth.getUser() issues
        if (import.meta.env.DEV) {
          console.log('🔄 [InitialSession] Calling getCurrentProfile with userId from session:', session.user.id);
        }
        
        // Use setTimeout to defer profile fetching until after hydration
        setTimeout(async () => {
          try {
            const profile = await fetchWithRetry(() => getCurrentProfile(session.user.id, session.access_token));
            if (profile) {
              updateUserIfChanged(profile);
              setAuthError(null);
              
              // Sync user to WhatsApp backend database
              try {
                await WhatsAppUserSyncService.syncCurrentUser({
                  id: profile.id,
                  email: profile.email,
                  user_metadata: {
                    full_name: profile.fullName,
                    name: profile.fullName
                  },
                  clinic: profile.clinic ? {
                    clinicName: profile.clinic.clinicName,
                    clinicAddress: profile.clinic.clinicAddress,
                    contactPhone: profile.clinic.contactPhone,
                    contactEmail: profile.clinic.contactEmail
                  } : undefined,
                  role: profile.role
                });
                if (import.meta.env.DEV) {
                  console.log('✅ User synced to WhatsApp backend');
                }
              } catch (syncError) {
                // Don't block login if sync fails
                if (import.meta.env.DEV) {
                  console.warn('⚠️ Failed to sync user to WhatsApp backend:', syncError);
                }
              }
            } else {
              localStorage.removeItem('bolt_user_profile');
              updateUserIfChanged(null);
              setAuthError('Could not load user profile. Please check your profile setup or contact support.');
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.error('Failed to load profile during initial session check (deferred):', err);
            }
            const fallback = getProfileFromLocalStorage();
            if (fallback) {
              updateUserIfChanged(fallback);
              setAuthError('Auth service failed. Using cached profile.');
            } else {
              localStorage.removeItem('bolt_user_profile');
              updateUserIfChanged(null);
              setAuthError('Could not load user profile. Please check your profile setup or contact support.');
            }
          } finally {
            setLoading(false);
          }
        }, 0);
        
        // Don't set loading to false here since we're deferring the actual work
        return;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('🔴 Session check failed:', error);
        }
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed.';

        if (
          errorMessage.includes('session') ||
          errorMessage.includes('token') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('expired')
        ) {
          if (import.meta.env.DEV) {
            console.log('🧹 Auth error detected, clearing cached profile data');
          }
          localStorage.removeItem('bolt_user_profile');
          updateUserIfChanged(null);
          setAuthError('Session expired. Please log in again.');
        } else {
          const fallback = getProfileFromLocalStorage();
          if (fallback) {
            updateUserIfChanged(fallback);
            setAuthError('Auth service failed. Using cached profile.');
          } else {
            localStorage.removeItem('bolt_user_profile');
            updateUserIfChanged(null);
            setAuthError(errorMessage);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    const { data } = authService.onAuthStateChange(async (event, session) => {
      if (import.meta.env.DEV) {
        console.log('🔄 Auth state change:', event);
        console.log('🔄 [AuthStateChange] Session present:', !!session);
        console.log('🔄 [AuthStateChange] Session user ID:', session?.user?.id);
      }
      
      const now = Date.now();
      if (event === 'SIGNED_IN' && session?.user) {
        if (now - lastHandledAt.current < 1000) {
          if (import.meta.env.DEV) {
            console.log('⚠️ Already signed in recently, skipping profile fetch');
          }
          return;
        }
        lastHandledAt.current = now;

        try {
          // Pass the userId directly from the session to avoid auth.getUser() issues
          if (import.meta.env.DEV) {
            console.log('🔄 [SIGNED_IN] Calling getCurrentProfile with userId from session:', session.user.id);
          }
          // Use setTimeout to defer profile fetching until after hydration
          setTimeout(async () => {
            try {
              const profile = await fetchWithRetry(() => getCurrentProfile(session.user.id, session.access_token));
              if (profile) {
                updateUserIfChanged(profile);
                setAuthError(null);
              } else {
                updateUserIfChanged(null);
                setAuthError('Could not load profile after sign-in.');
              }
            } catch (err) {
              if (import.meta.env.DEV) {
                console.error('Failed to load profile after sign-in (deferred):', err);
              }
              updateUserIfChanged(null);
              setAuthError('Error loading profile after login.');
            }
          }, 0);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('Error setting up deferred profile loading:', err);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        if (import.meta.env.DEV) {
          console.log('🧹 User signed out, clearing all cached data');
        }
        localStorage.removeItem('bolt_user_profile');
        updateUserIfChanged(null);
        setAuthError(null);
      } else if (event === 'TOKEN_REFRESHED') {
        if (import.meta.env.DEV) {
          console.log('🔄 Token refreshed, maintaining current user state');
        }
        // For token refresh, we can still use the fallback method since session is stable
      } else if (event === 'USER_UPDATED') {
        if (import.meta.env.DEV) {
          console.log('👤 User updated, refreshing profile');
        }
        // Use setTimeout to defer profile fetching until after hydration
        setTimeout(async () => {
          try {
            // For user updates, use fallback method or session userId if available
            const profile = session?.user?.id 
              ? await getCurrentProfile(session.user.id, session.access_token)
              : await getCurrentProfile();
            if (profile) {
              updateUserIfChanged(profile);
              setAuthError(null);
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.error('Failed to refresh profile after user update (deferred):', err);
            }
          }
        }, 0);
      }
    });

    return () => {
      data?.subscription?.unsubscribe?.();
    };
  }, []);

  const signOut = async () => {
    if (import.meta.env.DEV) {
      console.log('🚪 Signing out user...');
    }
    localStorage.removeItem('bolt_user_profile');
    await authService.signOut();
    updateUserIfChanged(null);
  };

  const hasPermission = (permission: string): boolean => {
    if (!user?.permissions) return false;
    return user.permissions.includes(permission) || user.permissions.includes('all');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        signOut,
        hasPermission,
        tryLoadLocalProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
