import { App, type FormInstance } from 'antd';
import { ApiError } from '../../api/client';
import type { TenantUserRole } from '../../api/types';
import { isStrongPassword, PASSWORD_RULE_TEXT } from '../../lib/password';

/** Tenant portal sign-in page. */
export const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL as string | undefined) || 'http://localhost:5174';

export const TENANT_ROLES: TenantUserRole[] = ['OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER'];
export const TENANT_ROLE_LABELS: Record<TenantUserRole, string> = { OWNER: 'Owner', DEVELOPER: 'Developer', REVIEWER: 'Reviewer', VIEWER: 'Viewer' };
export const TENANT_ROLE_HELP: Record<TenantUserRole, string> = {
  OWNER: 'Everything, including users, people erase/revoke and review settings.',
  DEVELOPER: 'Apps, credentials, webhooks, flows, branding, playground and OCR settings. Reads everything else.',
  REVIEWER: 'Review queue (scans and verifications), cancel verifications. Reads everything else.',
  VIEWER: 'Read-only.',
};
export const TENANT_ROLE_COLOR: Record<TenantUserRole, string> = { OWNER: 'magenta', DEVELOPER: 'purple', REVIEWER: 'blue', VIEWER: 'default' };

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;
export const USERNAME_RULE_TEXT = '3-40 letters, digits, dot, dash or underscore';

/** Field a tenant-user API error belongs to, with a clear message; null for other errors. */
export function tenantUserError(err: unknown): { field: 'username' | 'password' | 'role' | 'status' | null; message: string } | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case 'USERNAME_TAKEN':
      return { field: 'username', message: 'This username is already used. Usernames are unique across all tenants, so pick another one.' };
    case 'WEAK_PASSWORD':
      return { field: 'password', message: `The password is too weak. ${PASSWORD_RULE_TEXT}` };
    case 'LAST_OWNER':
      return {
        field: null,
        message: 'The tenant must keep at least one active owner. Make another user an active owner first, then try again.',
      };
    default:
      return null;
  }
}

/** Form rule for an optional password: empty is fine (the server generates one), else it must be strong. */
export const optionalPasswordRule = {
  validator: (_: unknown, v: string | undefined) => (!v || isStrongPassword(v) ? Promise.resolve() : Promise.reject(new Error(PASSWORD_RULE_TEXT))),
};

/**
 * Maps USERNAME_TAKEN / WEAK_PASSWORD / LAST_OWNER onto the form field (at `fieldPrefix` + field) and a clear toast.
 * Returns true when handled, so useApiMutation's onError can skip its generic toast.
 */
export function useTenantUserErrorHandler() {
  const { message } = App.useApp();
  return (err: unknown, form?: FormInstance, fieldPrefix: string[] = []): boolean => {
    const e = tenantUserError(err);
    if (!e) return false;
    if (form && e.field) form.setFields([{ name: [...fieldPrefix, e.field], errors: [e.message] }]);
    message.error(e.message);
    return true;
  };
}
