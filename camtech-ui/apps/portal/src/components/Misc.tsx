import { Empty, Flex, theme, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';

/** Pretty-printed JSON block. */
export function JsonBlock({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  const { token } = theme.useToken();
  return (
    <pre
      style={{
        margin: 0, padding: 12, maxHeight, overflow: 'auto', fontSize: 12, background: token.colorFillQuaternary, fontFamily: token.fontFamilyCode,
        borderRadius: token.borderRadius, border: `1px solid ${token.colorBorderSecondary}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Small monospace id with copy. */
export function IdText({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined) return <span>—</span>;
  return (
    <Typography.Text copyable={{ text: String(value) }} className="ct-mono">
      {String(value)}
    </Typography.Text>
  );
}

/** Confidence 0..1 as a percentage, amber below `low`. */
export function Confidence({ value, low = 0.75 }: { value: number | null | undefined; low?: number }) {
  const { token } = theme.useToken();
  if (value === null || value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  const pct = Math.round(value * 100);
  return (
    <Tooltip title={value < low ? 'Low confidence: worth checking' : undefined}>
      <Flex align="center" gap={6} className="tabular" style={{ color: value < low ? token.colorWarningText : undefined }}>
        <span style={{ display: 'inline-block', width: 36, height: 5, borderRadius: 3, background: token.colorFillSecondary, overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: value < low ? token.colorWarning : token.colorSuccess }} />
        </span>
        {pct}%
      </Flex>
    </Tooltip>
  );
}

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  hint?: string;
}

/** Horizontal bars with direct value labels (for small categorical breakdowns). */
export function BarList({ items, color, total }: { items: BarListItem[]; color?: string; total?: number }) {
  const { token } = theme.useToken();
  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data for this period" />;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <Flex vertical gap={14}>
      {items.map((i) => (
        <Tooltip key={i.key} title={i.hint} placement="topLeft">
          <div>
            <Flex justify="space-between" gap={8} style={{ marginBottom: 4 }}>
              <Typography.Text ellipsis style={{ maxWidth: '75%', fontWeight: 600 }}>
                {i.label}
              </Typography.Text>
              <Typography.Text className="tabular" strong>
                {i.value.toLocaleString('en')}
                {total ? (
                  <Typography.Text type="secondary" style={{ fontWeight: 400, marginInlineStart: 6 }}>
                    {Math.round((i.value / total) * 100)}%
                  </Typography.Text>
                ) : null}
              </Typography.Text>
            </Flex>
            <div style={{ height: 8, background: token.colorFillTertiary, borderRadius: 999 }}>
              <div style={{ width: `${(i.value / max) * 100}%`, height: '100%', background: color ?? token.colorPrimary, borderRadius: 999, transition: 'width .3s' }} />
            </div>
          </div>
        </Tooltip>
      ))}
    </Flex>
  );
}
