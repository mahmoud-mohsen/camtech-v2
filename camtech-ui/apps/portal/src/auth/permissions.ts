import type { TenantUserRole } from '@camtech/api-client';

export interface Permissions {
  role: TenantUserRole | null;
  /** Apps, credentials, webhooks, flows liveness, branding, OCR settings, playground. */
  canBuild: boolean;
  /** Cancel verifications, review document scans. */
  canReview: boolean;
  /** Users and everything else. */
  isOwner: boolean;
}

/** What a role may change (the server enforces the same rules; reading is open to every role). */
export function permissionsFor(role: TenantUserRole | null | undefined): Permissions {
  const r = role ?? null;
  return {
    role: r,
    canBuild: r === 'OWNER' || r === 'DEVELOPER',
    canReview: r === 'OWNER' || r === 'REVIEWER',
    isOwner: r === 'OWNER',
  };
}

export const ROLES: TenantUserRole[] = ['OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER'];
