import { Tooltip } from 'antd';
import { formatDate, formatDateTime, formatRelative } from '../lib/format';

/** Local date-time. `relative` shows "5 minutes ago" with the exact time on hover. */
export function DateText({ value, relative = false, dateOnly = false }: { value: string | null | undefined; relative?: boolean; dateOnly?: boolean }) {
  if (!value) return <span style={{ opacity: 0.55 }}>—</span>;
  if (dateOnly) return <span className="tabular">{formatDate(value)}</span>;
  if (!relative) return <span className="tabular">{formatDateTime(value)}</span>;
  return (
    <Tooltip title={formatDateTime(value)}>
      <span className="tabular">{formatRelative(value)}</span>
    </Tooltip>
  );
}
