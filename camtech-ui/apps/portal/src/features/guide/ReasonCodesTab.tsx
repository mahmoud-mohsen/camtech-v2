import { SearchOutlined } from '@ant-design/icons';
import type { ReasonCode } from '@camtech/api-client';
import { Flex, Input, Segmented, Table, Tag, Typography } from 'antd';
import { useMemo } from 'react';
import { DataState } from '../../components/DataState';
import { SectionTitle, TableFrame } from '../../components/ui';
import { useReasonCodes } from '../../lib/hooks';
import { reasonCategoryLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

function Codes({ list }: { list: ReasonCode[] }) {
  const { values, set } = useSearchState(['q', 'category'] as const);
  const q = (values.q ?? '').trim().toLowerCase();
  const categories = useMemo(() => [...new Set(list.map((r) => r.category))], [list]);
  const shown = list.filter(
    (r) =>
      (!values.category || r.category === values.category) &&
      (!q || r.code.toLowerCase().includes(q) || r.messageEn.toLowerCase().includes(q) || (r.messageAr ?? '').includes(values.q ?? '')),
  );
  return (
    <>
      <Flex gap={8} wrap align="center" style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
            placeholder="Search code or message"
            value={values.q ?? ''}
            onChange={(e) => set({ q: e.target.value })}
            style={{ width: 300, maxWidth: '100%' }}
            aria-label="Search reason codes"
          />
          <Segmented
            value={values.category ?? ''}
            onChange={(v) => set({ category: String(v) || null })}
            options={[{ value: '', label: 'All' }, ...categories.map((c) => ({ value: c, label: reasonCategoryLabel(c) }))]}
          />
      </Flex>
      <TableFrame>
      <Table<ReasonCode>
        rowKey="code"
        dataSource={shown}
        pagination={false}
        scroll={{ x: 960 }}
        locale={{ emptyText: 'No reason code matches' }}
        columns={[
          {
            title: 'Code',
            dataIndex: 'code',
            width: 230,
            render: (v: string) => (
              <Typography.Text code copyable style={{ fontSize: 12 }}>
                {v}
              </Typography.Text>
            ),
          },
          { title: 'Category', dataIndex: 'category', width: 140, render: (v: string) => <Tag variant="filled" className="ct-pill">{reasonCategoryLabel(v)}</Tag> },
          { title: 'English', dataIndex: 'messageEn' },
          {
            title: 'العربية',
            dataIndex: 'messageAr',
            render: (v: string | null) =>
              v ? (
                <div dir="rtl" lang="ar" style={{ textAlign: 'right' }}>
                  {v}
                </div>
              ) : (
                <span className="ct-meta">— (English shown)</span>
              ),
          },
        ]}
      />
      </TableFrame>
    </>
  );
}

/** Integration guide › Reason codes: what end users see when a step fails or a decision is made. */
export function ReasonCodesTab() {
  const q = useReasonCodes();
  return (
    <>
      <SectionTitle
        title="Reason codes"
        sub="What your users see when a step fails or a decision is made. Drive your app's logic from the stable code; show the message, which CamTech may refine over time."
      />
      <DataState query={q}>{(list) => <Codes list={list} />}</DataState>
    </>
  );
}
