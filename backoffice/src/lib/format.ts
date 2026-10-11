import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import localizedFormat from 'dayjs/plugin/localizedFormat';

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

export function formatSimilarity(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(3);
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function formatNumber(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return '';
  const ms = dayjs(toIso).diff(dayjs(fromIso));
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60000)} min`;
}

/** Days until a plain YYYY-MM-DD date (negative = in the past). */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  return dayjs(date).startOf('day').diff(dayjs().startOf('day'), 'day');
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}
