import { useQuery } from '@tanstack/react-query';
import { Button, Flex, InputNumber, Table, Typography } from 'antd';
import { useState } from 'react';
import { retentionApi } from '../../api/configuration';
import type { RetentionPolicy } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { useApiMutation } from '../../lib/hooks';
import { retentionLabel } from '../../lib/labels';

function humanDays(d: number): string {
  if (d % 365 === 0) return `${d / 365} year${d === 365 ? '' : 's'}`;
  if (d >= 60 && d % 30 === 0) return `${d / 30} months`;
  return `${d} day${d === 1 ? '' : 's'}`;
}

function DaysEditor({ p }: { p: RetentionPolicy }) {
  const { isAdmin } = usePermissions();
  const [days, setDays] = useState<number>(p.retentionDays);
  const save = useApiMutation((d: number) => retentionApi.update(p.id, d), { success: 'Retention saved', invalidate: [['retention']] });
  return (
    <Flex gap={8} align="center" wrap>
      <InputNumber min={1} max={3650} precision={0} value={days} disabled={!isAdmin} onChange={(v) => setDays(v ?? 1)} suffix="days" style={{ width: 140 }} />
      <Typography.Text type="secondary">≈ {humanDays(days)}</Typography.Text>
      {isAdmin && days !== p.retentionDays && (
        <>
          <Button type="primary" size="small" loading={save.isPending} onClick={() => save.mutate(days)}>Save</Button>
          <Button size="small" onClick={() => setDays(p.retentionDays)}>Undo</Button>
        </>
      )}
    </Flex>
  );
}

export default function RetentionPage() {
  const q = useQuery({ queryKey: ['retention'], queryFn: retentionApi.list });
  return (
    <>
      <PageHeader
        title="Data retention"
        help="How long each kind of data is kept before it is deleted automatically. Deleted images show as 'deleted by the data retention policy' in the back office."
      />
      <ReadOnlyHint what="retention policies" />
      <DataState query={q} isEmpty={(d) => d.length === 0}>
        {(list) => (
          <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
            <Table<RetentionPolicy>
              rowKey="id"
              pagination={false}
              dataSource={list}
              scroll={{ x: 800 }}
              columns={[
                {
                  title: 'Data',
                  render: (_, p) => (
                    <div>
                      <div title={p.dataCategory} className="ct-strong">{retentionLabel(p.dataCategory)}</div>
                      <span className="ct-meta">{p.description}</span>
                    </div>
                  ),
                },
                { title: 'Keep for', width: 360, render: (_, p) => <DaysEditor key={`${p.id}-${p.retentionDays}`} p={p} /> },
                { title: 'Last changed', dataIndex: 'updatedAt', width: 150, render: (v: string) => <span className="ct-meta tabular"><DateText value={v} relative /></span> },
              ]}
            />
          </div>
        )}
      </DataState>
    </>
  );
}
