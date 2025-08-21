import { createContext } from 'react';
import { Profile } from '../../types';

export interface AuthContextType {
  user: Profile | null;
  loading: boolean;
  authError: string | null;
  signOut: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  tryLoadLocalProfile: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);