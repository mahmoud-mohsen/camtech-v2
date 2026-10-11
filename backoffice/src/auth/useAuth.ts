import { createContext, useContext } from 'react';
import type { AdminUser, Role } from '../api/types';

export interface AuthState {
  user: AdminUser | null;
  /** True while the stored token is being checked on first load. */
  initialising: boolean;
  /** Set when the user was signed out because the token expired. */
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<AdminUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

const RANK: Record<Role, number> = { VIEWER: 1, REVIEWER: 2, ADMIN: 3 };

/** Role checks for hiding / disabling actions. */
export function usePermissions() {
  const { user } = useAuth();
  const rank = user ? RANK[user.role] : 0;
  return {
    role: user?.role ?? null,
    username: user?.username ?? null,
    canReview: rank >= RANK.REVIEWER,
    isAdmin: rank >= RANK.ADMIN,
  };
}
