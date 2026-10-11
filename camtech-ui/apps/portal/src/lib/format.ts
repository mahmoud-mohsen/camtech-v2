import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export { dayjs };

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).format('D MMM YYYY, HH:mm:ss');
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('D MMM YYYY');
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).fromNow();
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function formatNumber(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString('en');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function formatDuration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return '';
  return formatMs(dayjs(toIso).diff(dayjs(fromIso)));
}

/** "4m 05s" style countdown; zero or less reads "expired". */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
