import { RightOutlined } from '@ant-design/icons';
import { Empty, Flex, Grid, Pagination, Skeleton, Table, type TableProps } from 'antd';
import type { ReactNode } from 'react';

type Props<T> = TableProps<T> & {
  /** How one row looks on a phone: a small card instead of a table row that scrolls sideways. */
  mobileCard: (row: T) => ReactNode;
};

/** A list table that turns into a list of cards on phones (same data, click, paging and empty text). */
export function ListTable<T extends object>({ mobileCard, ...table }: Props<T>) {
  const screens = Grid.useBreakpoint();
  if (screens.md !== false) return <Table<T> {...table} />;

  const rows = (table.dataSource ?? []) as readonly T[];
  const loading = table.loading === true || (typeof table.loading === 'object' && table.loading.spinning === true);
  const p = table.pagination;
  const rowKey = (r: T, i: number) =>
    typeof table.rowKey === 'function' ? table.rowKey(r, i) : String((r as Record<string, unknown>)[String(table.rowKey ?? 'key')] ?? i);

  if (loading && rows.length === 0) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 16 }} />;
  if (rows.length === 0) {
    const empty = table.locale?.emptyText;
    return <div style={{ padding: 24 }}>{empty ? (typeof empty === 'function' ? empty() : empty) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}</div>;
  }
  return (
    <div style={{ opacity: loading ? 0.6 : 1 }}>
      {rows.map((r, i) => {
        const onClick = table.onRow?.(r, i)?.onClick as (() => void) | undefined;
        return (
          <Flex
            key={rowKey(r, i)}
            align="center"
            gap={12}
            className={onClick ? 'ct-mobile-row clickable-row' : 'ct-mobile-row'}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={onClick}
            onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
          >
            <div style={{ flex: 1, minWidth: 0 }}>{mobileCard(r)}</div>
            {onClick && <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} />}
          </Flex>
        );
      })}
      {p && (p.total ?? 0) > (p.pageSize ?? 20) && (
        <Flex justify="center" style={{ padding: 12 }}>
          <Pagination simple size="small" current={p.current} pageSize={p.pageSize} total={p.total} onChange={p.onChange} />
        </Flex>
      )}
    </div>
  );
}
