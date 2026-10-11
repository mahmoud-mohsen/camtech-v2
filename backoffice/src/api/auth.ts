import { http } from './client';
import type { AdminUser, LoginResponse } from './types';

export const authApi = {
  login: (username: string, password: string) =>
    http.post<LoginResponse>('/v2/admin/auth/login', { username, password }, { noAuthRedirect: true }),
  logout: () => http.post<void>('/v2/admin/auth/logout'),
  me: () => http.get<AdminUser>('/v2/admin/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<void>('/v2/admin/auth/change-password', { currentPassword, newPassword }),
};
