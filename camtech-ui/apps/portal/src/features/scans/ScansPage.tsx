import { RightOutlined, SettingOutlined } from '@ant-design/icons';
import type { TenantScanSummary } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Empty, Flex, Tabs, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { Confidence } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { ScanStatusTag } from '../../components/Tags';
import { TableFrame } from '../../components/ui';
import { formatMs } from '../../lib/format';
import { FilterBar } from '../../components/FilterBar';
import { ListTable } from '../../components/ListTable';
import { LIST_REFETCH_MS } from '../../lib/queryClient';
import { qk } from '../../lib/hooks';
import { docTypeLabel, SCAN_STATUS_LABELS, SCAN_TYPES, toOptions } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { t } from '../../i18n';

const KEYS = ['status', 'docTypeCode', 'from', 'to'] as const;

/** Quick views: presets of the status filter. */
const VIEWS = [
  { key: 'all', label: 'All', status: undefined },
  { key: 'review', label: 'Waiting for review', status: 'NEEDS_REVIEW' },
  { key: 'failed', label: 'Failed', status: 'FAILED' },
] as const;

export default function ScansPage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: qk.scans(filters), queryFn: () => api.scans(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  const anyFilter = KEYS.some((k) => values[k]);
  const view = VIEWS.find((v) => v.status === values.status)?.key ?? '';

  return (
    <>
      <PageHeader
        title="Document scans"
        help="Documents your backend sent to be read: what was found and how each field was checked."
        extra={
          <Button icon={<SettingOutlined />} onClick={() => navigate('/settings/ocr')}>
            {t('settings.tab.ocr')}
          </Button>
        }
      />
      <Tabs activeKey={view} onChange={(k) => set({ status: VIEWS.find((v) => v.key === k)?.status })} items={VIEWS.map((v) => ({ key: v.key, label: v.label }))} style={{ marginBottom: 4 }} />
      <FilterBar
        values={values}
        set={set}
        onClearAll={reset}
        query={q}
        filters={[
          { kind: 'select', key: 'docTypeCode', label: 'Document type', options: SCAN_TYPES.map((c) => ({ value: c, label: docTypeLabel(c) })), width: 200 },
          { kind: 'dateRange', from: 'from', to: 'to', label: 'Scanned' },
          { kind: 'select', key: 'status', label: 'Status', options: toOptions(SCAN_STATUS_LABELS), more: true },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <TableFrame>
        <ListTable<TenantScanSummary>
          mobileCard={(r) => (
            <Flex vertical gap={6}>
              <Flex justify="space-between" align="center" gap={8}>
                <span className="ct-strong">{docTypeLabel(r.docTypeCode)}</span>
                <ScanStatusTag value={r.status} />
              </Flex>
              <Flex justify="space-between" align="center" gap={8}>
                <Confidence value={r.confidence} />
                <span className="ct-meta">
                  <DateText value={r.createdAt} relative />
                </span>
              </Flex>
              {r.errorMessage && <Typography.Text type="danger" ellipsis>{r.errorMessage}</Typography.Text>}
            </Flex>
          )}
          rowKey="id"
          loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
          dataSource={q.data?.items}
          scroll={{ x: 820 }}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(`/scans/${r.id}`) })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={anyFilter ? 'No scans match these filters' : 'No document scans yet'} /> }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (n, [a, b]) => `Showing ${a}–${b} of ${n.toLocaleString('en')}`,
            style: { padding: '0 16px' },
            onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
          }}
          columns={[
            {
              title: 'Document',
              dataIndex: 'docTypeCode',
              render: (v: string) => (
                <span className="ct-strong" title={v}>
                  {docTypeLabel(v)}
                </span>
              ),
            },
            { title: 'Status', dataIndex: 'status', width: 120, render: (v: string) => <ScanStatusTag value={v} /> },
            { title: 'Confidence', dataIndex: 'confidence', width: 130, render: (v: number | null) => <Confidence value={v} /> },
            { title: 'Time', dataIndex: 'processingMs', width: 90, align: 'right', render: (v: number | null) => <span className="tabular">{v === null ? '—' : formatMs(v)}</span> },
            {
              title: 'Error',
              dataIndex: 'errorMessage',
              render: (v: string | null) => (v ? <Typography.Text type="danger" ellipsis={{ tooltip: v }} style={{ maxWidth: 320 }}>{v}</Typography.Text> : <span className="ct-meta">—</span>),
            },
            {
              title: 'When',
              dataIndex: 'createdAt',
              width: 140,
              render: (v: string) => (
                <span className="ct-meta">
                  <DateText value={v} relative />
                </span>
              ),
            },
            { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
          ]}
        />
        </TableFrame>
      )}
    </>
  );
}
