import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler } from '../api/client';
import { authApi } from '../api/auth';
import type { AdminUser } from '../api/types';
import { getToken, setToken } from './tokenStore';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [initialising, setInitialising] = useState<boolean>(() => !!getToken());
  const [sessionExpired, setSessionExpired] = useState(false);

  // Any 401 from the API: drop the user (RequireAuth then redirects to /login).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser((prev) => {
        if (prev) setSessionExpired(true);
        return null;
      });
      qc.clear();
    });
  }, [qc]);

  // Restore the session from the token kept in sessionStorage.
  useEffect(() => {
    if (!getToken()) return;
    authApi
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setInitialising(false));
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await authApi.login(username, password);
      setToken(res.token);
      setSessionExpired(false);
      qc.clear();
      setUser(res.user);
      return res.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore: we sign out locally anyway */
    }
    setToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const refreshUser = useCallback(async () => {
    setUser(await authApi.me());
  }, []);

  const value = useMemo(
    () => ({ user, initialising, sessionExpired, login, logout, refreshUser }),
    [user, initialising, sessionExpired, login, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
