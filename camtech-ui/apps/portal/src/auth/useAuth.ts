import { CamtechApiError, errorMessage, type TenantInfo, type TenantRef, type TenantUser } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api } from '../api/client';
import { authErrorKey, t } from '../i18n';
import { permissionsFor, type Permissions } from './permissions';

export interface AuthState {
  user: TenantUser | null;
  /** The signed-in user's company. */
  tenant: TenantRef | null;
  /** True while the stored token is being checked on first load. */
  initialising: boolean;
  /** Set when the user was signed out because the token expired or was revoked. */
  sessionExpired: boolean;
  /** Set when the server answered 403 TENANT_SUSPENDED. */
  suspended: boolean;
  login: (username: string, password: string) => Promise<TenantUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Role checks for hiding / disabling actions. */
export function usePermissions(): Permissions {
  const { user } = useAuth();
  return permissionsFor(user?.role);
}

/** Tooltip text for a control the user's role can't use. */
export function useNoPermissionText(): string {
  const { role } = usePermissions();
  return t('auth.noPermission', { role: role ? t(`role.${role}`) : '' });
}

export const tenantInfoKey = ['tenant-info'] as const;

/** Loads the signed-in tenant's details (flows, features, status). */
export function useTenantInfoQuery(enabled: boolean) {
  return useQuery({ queryKey: tenantInfoKey, queryFn: api.info, enabled, staleTime: 5 * 60_000 });
}

/** The signed-in tenant's info; only call it below <RequireAuth> (it is always loaded there). */
export function useTenantInfo(): TenantInfo {
  const { data } = useTenantInfoQuery(true);
  if (!data) throw new Error('useTenantInfo must be used inside <RequireAuth>');
  return data;
}

/** Text for an API error: a translated message for the sign-in / role / user codes, else the server's message. */
export function describeError(err: unknown): string {
  if (err instanceof CamtechApiError) {
    const key = authErrorKey(err.code);
    if (key) return t(key);
  }
  return errorMessage(err);
}
