import { RightOutlined } from '@ant-design/icons';
import type { DocumentSummary } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Empty, Flex, Tabs } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar } from '../../components/FilterBar';
import { ListTable } from '../../components/ListTable';
import { DocStatusTag } from '../../components/Tags';
import { PersonCell, TableFrame } from '../../components/ui';
import { t } from '../../i18n';
import { expiringBeforeFor } from '../../lib/expiry';
import { LIST_REFETCH_MS } from '../../lib/queryClient';
import { qk, useDocumentSettings } from '../../lib/hooks';
import { DOC_STATUS_LABELS, docTypeLabel, toOptions } from '../../lib/labels';
import { maskDocumentNumber } from '../../lib/mask';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { useTenantInfo } from '../../auth/useAuth';
import { ExpiryText } from './ExpiryTag';

const KEYS = ['q', 'docTypeCode', 'status', 'expiringBefore'] as const;
const DEFAULT_WARNING_DAYS = 30;

export default function DocumentsPage() {
  const navigate = useNavigate();
  const info = useTenantInfo();
  const settings = useDocumentSettings();
  const warningDays = settings.data?.expiryWarningDays ?? DEFAULT_WARNING_DAYS;
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: qk.documents(filters), queryFn: () => api.documents(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  const anyFilter = KEYS.some((k) => values[k]);
  const soon = expiringBeforeFor(warningDays);
  const types = info.documentTypes.map((d) => d.code);

  return (
    <>
      <PageHeader
        title={t('documents.title')}
        help={t('documents.help')}
      />
      <Tabs
        activeKey={values.expiringBefore === soon ? 'soon' : values.expiringBefore ? '' : 'all'}
        onChange={(k) => set({ expiringBefore: k === 'soon' ? soon : null })}
        items={[
          { key: 'all', label: t('views.all') },
          { key: 'soon', label: t('documents.expiringSoon', { days: warningDays }) },
        ]}
        style={{ marginBottom: 4 }}
      />
      <FilterBar
        values={values}
        set={set}
        onClearAll={reset}
        query={q}
        search={{ key: 'q', placeholder: t('documents.search') }}
        filters={[
          { kind: 'select', key: 'docTypeCode', label: t('documents.filter.type'), options: types.map((c) => ({ value: c, label: docTypeLabel(c) })), width: 180 },
          { kind: 'select', key: 'status', label: t('documents.filter.status'), options: toOptions(DOC_STATUS_LABELS), width: 150 },
          { kind: 'date', key: 'expiringBefore', label: t('documents.filter.expiringBefore'), more: true },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <TableFrame>
        <ListTable<DocumentSummary>
          mobileCard={(r) => (
            <Flex vertical gap={6}>
              <Flex justify="space-between" align="center" gap={8}>
                <PersonCell name={r.partyName ?? '—'} sub={`${docTypeLabel(r.docTypeCode)}${r.documentNumber ? ` · ${maskDocumentNumber(r.documentNumber)}` : ''}`} />
                <DocStatusTag value={r.status} />
              </Flex>
              <span className="ct-meta">
                {t('documents.col.expiry')}: <ExpiryText value={r.expiryDate} warningDays={warningDays} hideExpired={r.status === 'EXPIRED'} />
              </span>
            </Flex>
          )}
          rowKey="id"
          loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
          dataSource={q.data?.items}
          scroll={{ x: 1100 }}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(`/documents/${r.id}`) })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={anyFilter ? t('documents.emptyFiltered') : t('documents.empty')} /> }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (n) => t('documents.total', { n: n.toLocaleString('en') }),
            style: { padding: '0 16px' },
            onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
          }}
          columns={[
            { title: t('documents.col.person'), dataIndex: 'partyName', width: 240, render: (v: string | null) => <PersonCell name={v ?? '—'} /> },
            { title: t('documents.col.type'), dataIndex: 'docTypeCode', width: 150, render: (v: string) => <span title={v}>{docTypeLabel(v)}</span> },
            {
              title: t('documents.col.number'),
              dataIndex: 'documentNumber',
              width: 190,
              render: (v: string | null) => <span className="ct-mono tabular">{v ? maskDocumentNumber(v) : '—'}</span>,
            },
            { title: t('documents.col.country'), dataIndex: 'issuingCountry', width: 120, render: (v: string | null) => v ?? '—' },
            { title: t('documents.col.expiry'), dataIndex: 'expiryDate', width: 230, render: (v: string | null, r) => <ExpiryText value={v} warningDays={warningDays} hideExpired={r.status === 'EXPIRED'} /> },
            { title: t('documents.col.status'), dataIndex: 'status', width: 110, render: (v: string) => <DocStatusTag value={v} /> },
            {
              title: t('documents.col.added'),
              dataIndex: 'createdAt',
              width: 130,
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
