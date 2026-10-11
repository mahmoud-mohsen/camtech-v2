import { RightOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Flex, Input, Select, Table, Tooltip } from 'antd';
import { ExpiryText } from '../../components/ExpiryText';
import { useNavigate } from 'react-router-dom';
import { documentsApi } from '../../api/operations';
import type { DocumentSummary } from '../../api/types';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { DocStatusTag } from '../../components/Tags';
import { PersonCell } from '../../components/ui';
import { dayjs, daysUntil, formatNumber } from '../../lib/format';
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS, docTypeLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export default function DocumentsPage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(['q', 'docTypeCode', 'status', 'expiringBefore'] as const);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: ['documents', filters], queryFn: () => documentsApi.list(filters), placeholderData: keepPreviousData });
  const in30 = dayjs().add(30, 'day').format('YYYY-MM-DD');
  const anyFilter = !!(values.q || values.docTypeCode || values.status || values.expiringBefore);

  return (
    <>
      <PageHeader
        title="Documents"
        help="Identity documents and trade licences captured during verifications. Documents expiring within 30 days are highlighted."
      />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search key={values.q ?? ''} allowClear defaultValue={values.q} placeholder="Search document number or name" onSearch={(v) => set({ q: v })} style={{ width: 300, maxWidth: '100%' }} />
        <Select allowClear placeholder="Type" style={{ width: 160 }} value={values.docTypeCode} onChange={(v) => set({ docTypeCode: v })} options={toOptions(DOC_TYPE_LABELS)} />
        <Select allowClear placeholder="Status" style={{ width: 150 }} value={values.status} onChange={(v) => set({ status: v })} options={toOptions(DOC_STATUS_LABELS)} />
        <Tooltip title="Show documents that expire on or before this date">
          <DatePicker placeholder="Expiring before" value={values.expiringBefore ? dayjs(values.expiringBefore) : null} onChange={(d) => set({ expiringBefore: d?.format('YYYY-MM-DD') })} />
        </Tooltip>
        <Button type={values.expiringBefore === in30 ? 'primary' : 'default'} onClick={() => set({ expiringBefore: values.expiringBefore === in30 ? null : in30 })}>
          Expiring in 30 days
        </Button>
        {anyFilter && (
          <Button type="link" onClick={reset} style={{ fontWeight: 700 }}>
            Clear filters
          </Button>
        )}
      </Flex>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
          <Table<DocumentSummary>
            rowKey="id"
            loading={q.isPending}
            dataSource={q.data?.items}
            scroll={{ x: 900 }}
            rowClassName={(d) => {
              const n = daysUntil(d.expiryDate);
              return `clickable-row ${n !== null && n >= 0 && n <= 30 ? 'row-warning' : ''}`;
            }}
            onRow={(d) => ({ onClick: () => navigate(`/documents/${d.id}`) })}
            locale={{ emptyText: anyFilter ? 'No documents match these filters' : 'No documents yet' }}
            pagination={{
              current: page + 1,
              pageSize: size,
              total: q.data?.total ?? 0,
              showTotal: (t, [a, b]) => `Showing ${a}–${b} of ${formatNumber(t)}`,
              onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
              style: { padding: '0 16px' },
            }}
            columns={[
              {
                title: 'Document',
                dataIndex: 'docTypeCode',
                render: (v: string, d) => (
                  <Flex vertical>
                    <span style={{ fontWeight: 600 }}>{docTypeLabel(v)}</span>
                    <span className="ct-meta tabular">{d.documentNumber ?? 'No number read'}</span>
                  </Flex>
                ),
              },
              {
                title: 'Holder',
                dataIndex: 'partyName',
                render: (v: string | null, d) =>
                  v ? <PersonCell name={v} org={d.docTypeCode === 'TRADE_LICENCE'} /> : <span className="ct-meta">No holder linked</span>,
              },
              { title: 'Issuer', dataIndex: 'issuerCode', width: 130, render: (v: string | null) => v ?? <span className="ct-meta">—</span> },
              { title: 'Expires', dataIndex: 'expiryDate', width: 220, render: (v: string | null) => <ExpiryText date={v} /> },
              { title: 'Status', dataIndex: 'status', width: 110, render: (v: string) => <DocStatusTag value={v} /> },
              {
                title: 'Captured',
                dataIndex: 'createdAt',
                width: 130,
                render: (v: string) => (
                  <span className="ct-meta tabular">
                    <DateText value={v} relative />
                  </span>
                ),
              },
              { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
            ]}
          />
        </div>
      )}
    </>
  );
}
