import { Empty, Flex, theme, Tooltip, Typography } from 'antd';

export interface BarListItem {
  key: string;
  label: React.ReactNode;
  value: number;
  hint?: string;
}

/** Simple horizontal bars with direct value labels (for small categorical breakdowns). */
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
                {i.value}
                {total ? (
                  <Typography.Text type="secondary" style={{ fontWeight: 400, marginInlineStart: 6 }}>
                    {Math.round((i.value / total) * 100)}%
                  </Typography.Text>
                ) : null}
              </Typography.Text>
            </Flex>
            <div style={{ height: 8, background: token.colorFillTertiary, borderRadius: 999 }}>
              <div style={{ width: `${(i.value / max) * 100}%`, height: '100%', background: color ?? token.colorPrimary, borderRadius: 999 }} />
            </div>
          </div>
        </Tooltip>
      ))}
    </Flex>
  );
}
