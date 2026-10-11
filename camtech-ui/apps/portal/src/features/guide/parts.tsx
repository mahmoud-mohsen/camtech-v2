// Small layout helpers shared by the integration guide tabs.
import { Flex, Table, theme, Typography } from 'antd';
import type { ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';

export function Value({ label, value }: { label: string; value: string }) {
  const { token } = theme.useToken();
  return (
    <Flex align="center" gap={6} style={{ minWidth: 0 }}>
      <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 12.5, wordBreak: 'break-all' }}>{value}</Typography.Text>
      <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
    </Flex>
  );
}

/** A numbered row with an icon (or the number itself when no icon is given). */
export function Step({ n, icon, title, children }: { n: number; icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex gap={14} align="flex-start">
      <span
        style={{
          width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', flex: 'none', fontSize: icon ? 16 : 14, fontWeight: 600,
          background: token.colorPrimaryBg, color: token.colorPrimary,
        }}
      >
        {icon ?? n}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Typography.Text strong>
          {icon ? `${n}. ` : ''}
          {title}
        </Typography.Text>
        {children && <div style={{ margin: '4px 0 0', color: token.colorTextSecondary }}>{children}</div>}
      </div>
    </Flex>
  );
}

export function Section({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <Flex vertical gap={10}>
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </Flex>
      {children}
    </Flex>
  );
}

export const Code = ({ children }: { children: ReactNode }) => <Typography.Text code>{children}</Typography.Text>;

export const Muted = ({ children }: { children: ReactNode }) => (
  <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
    {children}
  </Typography.Paragraph>
);

/** A compact reference table from rows of cells. The first column is shown as code. */
export function RefTable({ columns, rows, codeFirst = true }: { columns: string[]; rows: ReactNode[][]; codeFirst?: boolean }) {
  return (
    <Table
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      rowKey={(r) => String(r.key)}
      dataSource={rows.map((cells, i) => ({ key: i, cells }))}
      columns={columns.map((title, ci) => ({
        title,
        key: String(ci),
        render: (_: unknown, r: { cells: ReactNode[] }) =>
          ci === 0 && codeFirst && typeof r.cells[0] === 'string' ? <Typography.Text code>{r.cells[0]}</Typography.Text> : r.cells[ci],
      }))}
    />
  );
}
