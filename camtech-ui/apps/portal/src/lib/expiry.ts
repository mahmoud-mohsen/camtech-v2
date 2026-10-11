// Document expiry: how a date compares with today and the tenant's warning period (document settings).

export type ExpiryState = 'EXPIRED' | 'SOON' | 'VALID';

const DAY_MS = 86_400_000;

/** Local YYYY-MM-DD of a date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `today` to `expiryDate` (YYYY-MM-DD); negative once expired. */
export function daysUntil(expiryDate: string, today: Date = new Date()): number {
  const [y, m, d] = expiryDate.slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / DAY_MS);
}

/** EXPIRED before today, SOON within the warning period (today included), else VALID. null without a date. */
export function expiryState(expiryDate: string | null | undefined, warningDays: number, today: Date = new Date()): ExpiryState | null {
  if (!expiryDate) return null;
  const days = daysUntil(expiryDate, today);
  if (days < 0) return 'EXPIRED';
  return days <= warningDays ? 'SOON' : 'VALID';
}

/**
 * The `expiringBefore` filter (exclusive, YYYY-MM-DD) that covers every document expiring within `warningDays`
 * of `today`, the last day included. Already expired documents match too.
 */
export function expiringBeforeFor(warningDays: number, today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + warningDays + 1);
  return ymd(d);
}
