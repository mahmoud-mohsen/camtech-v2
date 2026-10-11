import { RightOutlined } from '@ant-design/icons';
import type { PartySummary } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Empty, Flex } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { FilterBar } from '../../components/FilterBar';
import { ListTable } from '../../components/ListTable';
import { LIST_REFETCH_MS } from '../../lib/queryClient';
import { PersonCell, TableFrame } from '../../components/ui';
import { t } from '../../i18n';
import { qk } from '../../lib/hooks';
import { PARTY_TYPE_LABELS, toOptions } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';

const KEYS = ['q', 'partyType'] as const;

export default function PeoplePage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: qk.parties(filters), queryFn: () => api.parties(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  const anyFilter = KEYS.some((k) => values[k]);

  return (
    <>
      <PageHeader
        title={t('people.title')}
        help={t('people.help')}
      />
      <FilterBar
        values={values}
        set={set}
        onClearAll={reset}
        query={q}
        search={{ key: 'q', placeholder: t('people.search'), width: 380 }}
        filters={[{ kind: 'select', key: 'partyType', label: t('people.col.type'), options: toOptions(PARTY_TYPE_LABELS), width: 140 }]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <TableFrame>
        <ListTable<PartySummary>
          mobileCard={(r) => (
            <Flex vertical gap={6}>
              <PersonCell name={r.displayName ?? '—'} sub={r.externalRef ? `${t('people.col.ref')}: ${r.externalRef}` : undefined} org={r.partyType === 'ORG'} />
              <span className="ct-meta">
                {t('people.col.documents')}: {r.documentsCount} · {t('people.col.verifications')}: {r.sessionsCount}
              </span>
            </Flex>
          )}
          rowKey="id"
          loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
          dataSource={q.data?.items}
          scroll={{ x: 860 }}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(`/people/${r.id}`) })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={anyFilter ? t('people.emptyFiltered') : t('people.empty')} /> }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (n) => t('people.total', { n: n.toLocaleString('en') }),
            style: { padding: '0 16px' },
            onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
          }}
          columns={[
            {
              title: t('people.col.name'),
              dataIndex: 'displayName',
              render: (v: string | null, r) => (
                <PersonCell name={v ?? '—'} sub={r.externalRef ? `${t('people.col.ref')}: ${r.externalRef}` : undefined} org={r.partyType === 'ORG'} />
              ),
            },
            { title: t('people.col.type'), dataIndex: 'partyType', width: 100, render: (v: string) => PARTY_TYPE_LABELS[v] ?? v },
            { title: t('people.col.documents'), dataIndex: 'documentsCount', width: 110, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
            { title: t('people.col.verifications'), dataIndex: 'sessionsCount', width: 120, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
            {
              title: t('people.col.lastVerified'),
              dataIndex: 'lastVerifiedAt',
              width: 140,
              render: (v: string | null) => (
                <span className="ct-meta">
                  <DateText value={v} relative />
                </span>
              ),
            },
            {
              title: t('people.col.added'),
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
