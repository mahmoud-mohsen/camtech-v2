import { CamtechApiError, type TenantRef, type TenantUser } from '@camtech/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAuthFailureHandler } from '../api/client';
import { getToken, setToken } from './tokenStore';
import { AuthContext, type AuthState } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<TenantUser | null>(null);
  const [tenant, setTenant] = useState<TenantRef | null>(null);
  const [initialising, setInitialising] = useState<boolean>(() => !!getToken());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [suspended, setSuspended] = useState(false);

  // Auth failures from any API call (see api/client.ts).
  useEffect(() => {
    setAuthFailureHandler((failure) => {
      if (failure === 'UNAUTHORIZED') {
        // Token expired or revoked: forget it; RequireAuth then sends the user to /login.
        setToken(null);
        setUser((prev) => {
          if (prev) setSessionExpired(true);
          return null;
        });
        setTenant(null);
        setSuspended(false);
        qc.clear();
      } else if (failure === 'PASSWORD_CHANGE_REQUIRED') {
        // RequireAuth sends the user to /change-password.
        setUser((prev) => (prev && !prev.mustChangePassword ? { ...prev, mustChangePassword: true } : prev));
      } else {
        setSuspended(true);
      }
    });
    return () => setAuthFailureHandler(null);
  }, [qc]);

  // Restore the session from the token kept in sessionStorage.
  useEffect(() => {
    if (!getToken()) return;
    let live = true;
    api
      .me()
      .then((me) => {
        if (!live) return;
        setUser(me.user);
        setTenant(me.tenant);
      })
      .catch((e: unknown) => {
        // A suspended tenant keeps its token (the suspended screen offers sign-out); anything else signs out.
        if (!(e instanceof CamtechApiError && e.code === 'TENANT_SUSPENDED')) setToken(null);
      })
      .finally(() => {
        if (live) setInitialising(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      setToken(res.token);
      qc.clear();
      setSessionExpired(false);
      setSuspended(false);
      setTenant(res.tenant);
      setUser(res.user);
      return res.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore: we sign out locally anyway */
    }
    setToken(null);
    setUser(null);
    setTenant(null);
    setSuspended(false);
    setSessionExpired(false);
    qc.clear();
  }, [qc]);

  const refreshUser = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setTenant(me.tenant);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, tenant, initialising, sessionExpired, suspended, login, logout, refreshUser }),
    [user, tenant, initialising, sessionExpired, suspended, login, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
