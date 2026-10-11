import { RightOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Flex, Select, Table, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { documentsApi } from '../../api/operations';
import type { ScanSummary } from '../../api/types';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { Confidence } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { ScanStatusTag } from '../../components/Tags';
import { formatNumber } from '../../lib/format';
import { DOC_TYPE_LABELS, docTypeLabel, SCAN_STATUS_LABELS } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export default function ScansPage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(['status', 'docTypeCode'] as const);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: ['scans', filters], queryFn: () => documentsApi.listScans(filters), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Document scans"
        help="Every time the server read a document image (OCR). Use this to check reading quality and investigate failures."
      />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Select allowClear placeholder="Status" style={{ width: 160 }} value={values.status} onChange={(v) => set({ status: v })} options={toOptions(SCAN_STATUS_LABELS)} />
        <Select allowClear placeholder="Document type" style={{ width: 180 }} value={values.docTypeCode} onChange={(v) => set({ docTypeCode: v })} options={toOptions(DOC_TYPE_LABELS)} />
        {(values.status || values.docTypeCode) && (
          <Button type="link" onClick={reset} style={{ fontWeight: 700 }}>
            Clear filters
          </Button>
        )}
      </Flex>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
          <Table<ScanSummary>
            rowKey="id"
            loading={q.isPending}
            dataSource={q.data?.items}
            scroll={{ x: 900 }}
            rowClassName={() => 'clickable-row'}
            onRow={(s) => ({ onClick: () => navigate(`/scans/${s.id}`) })}
            locale={{ emptyText: 'No scans' }}
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
                title: 'When',
                dataIndex: 'createdAt',
                width: 140,
                render: (v: string) => (
                  <span className="ct-meta tabular">
                    <DateText value={v} relative />
                  </span>
                ),
              },
              { title: 'Type', dataIndex: 'docTypeCode', render: (v: string) => <span style={{ fontWeight: 600 }}>{docTypeLabel(v)}</span> },
              { title: 'Status', dataIndex: 'status', width: 120, render: (v: string) => <ScanStatusTag value={v} /> },
              { title: 'Confidence', dataIndex: 'confidence', width: 110, align: 'right', render: (v: number | null) => <Confidence value={v} /> },
              { title: 'Time', dataIndex: 'processingMs', width: 100, align: 'right', render: (v: number | null) => (v === null ? '—' : <span className="tabular">{v} ms</span>) },
              {
                title: 'Document',
                dataIndex: 'documentId',
                render: (v: number | null) =>
                  v ? (
                    <Link to={`/documents/${v}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 600 }}>
                      Open document
                    </Link>
                  ) : (
                    <span className="ct-meta">Standalone scan</span>
                  ),
              },
              { title: 'Error', dataIndex: 'errorMessage', render: (v: string | null) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : '') },
              { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
            ]}
          />
        </div>
      )}
    </>
  );
}
