import { RightOutlined } from '@ant-design/icons';
import type { ReviewCaseSummary, TenantScanSummary } from '@camtech/api-client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Empty, Flex, Segmented, Tabs, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { Confidence } from '../../components/Misc';
import { RefreshStatus } from '../../components/FilterBar';
import { ListTable } from '../../components/ListTable';
import { PageHeader } from '../../components/PageHeader';
import { LIST_REFETCH_MS } from '../../lib/queryClient';
import { PersonCell, TableFrame } from '../../components/ui';
import { MatchLabelTag, ReviewStatusTag } from '../../components/Tags';
import { t, type MessageKey } from '../../i18n';
import { qk, useReviewSummary } from '../../lib/hooks';
import { docTypeLabel, fieldLabel, reviewReasonLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { CamtechReviewsBanner } from './CamtechReviewsBanner';
import { asQueue, caseInQueue, QUEUES, queueFilter, scanInQueue, type Queue } from './queue';

const KEYS = ['tab', 'queue'] as const;

/** Why a scan waits: the first reason in words, with a count of the others. */
function WaitReasons({ reasons }: { reasons: TenantScanSummary['reviewReasons'] }) {
  if (!reasons?.length) return <span className="ct-meta">—</span>;
  const [first, ...rest] = reasons;
  const text = `${reviewReasonLabel(first.code)}${first.field ? ` · ${fieldLabel(first.field)}` : ''}`;
  const all = reasons.map((r) => `${reviewReasonLabel(r.code)}${r.field ? ` · ${fieldLabel(r.field)}` : ''}${r.message ? ` — ${r.message}` : ''}`).join('\n');
  return (
    <Flex align="center" gap={6} style={{ minWidth: 0 }}>
      <Typography.Text ellipsis={{ tooltip: <span style={{ whiteSpace: 'pre-line' }}>{all}</span> }} style={{ maxWidth: 320 }}>
        {text}
      </Typography.Text>
      {rest.length > 0 && (
        <Tag variant="filled" className="ct-pill">
          {t('reviews.more', { n: rest.length })}
        </Tag>
      )}
    </Flex>
  );
}

function ScansTab({ page, size, onPage }: { page: number; size: number; onPage: (p: number, s: number) => void }) {
  const navigate = useNavigate();
  const filters = { status: 'NEEDS_REVIEW', page, size };
  const q = useQuery({ queryKey: qk.scans(filters), queryFn: () => api.scans(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <TableFrame>
    <ListTable<TenantScanSummary>
      mobileCard={(r) => (
        <Flex vertical gap={6}>
          <Flex justify="space-between" align="center" gap={8}>
            <span className="ct-strong">
              {docTypeLabel(r.docTypeCode)} <span className="ct-meta">#{r.id}</span>
            </span>
            <span className="ct-meta">
              <DateText value={r.createdAt} relative />
            </span>
          </Flex>
          <WaitReasons reasons={r.reviewReasons} />
        </Flex>
      )}
      rowKey="id"
      loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
      dataSource={q.data?.items}
      scroll={{ x: 640 }}
      rowClassName={() => 'clickable-row'}
      onRow={(r) => ({ onClick: () => navigate(scanInQueue(r.id)) })}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reviews.scans.empty')} /> }}
      pagination={{
        current: page + 1,
        pageSize: size,
        total: q.data?.total ?? 0,
        onChange: (p, s) => onPage(p - 1, s),
        showSizeChanger: true,
        showTotal: (n) => t('reviews.total', { n: n.toLocaleString('en') }),
        style: { padding: '0 16px' },
      }}
      columns={[
        {
          title: t('reviews.col.docType'),
          dataIndex: 'docTypeCode',
          width: 220,
          render: (v: string, r) => (
            <Flex vertical>
              <span className="ct-strong">{docTypeLabel(v)}</span>
              <span className="ct-meta tabular">#{r.id}</span>
            </Flex>
          ),
        },
        { title: t('reviews.col.waitingFor'), dataIndex: 'reviewReasons', render: (v: TenantScanSummary['reviewReasons']) => <WaitReasons reasons={v} /> },
        { title: t('reviews.col.confidence'), dataIndex: 'confidence', width: 140, render: (v: number | null) => <Confidence value={v} /> },
        {
          title: t('reviews.col.waiting'),
          dataIndex: 'createdAt',
          width: 150,
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
  );
}

function VerificationsTab({ queue, onQueue, page, size, onPage }: { queue: Queue; onQueue: (q: Queue) => void; page: number; size: number; onPage: (p: number, s: number) => void }) {
  const navigate = useNavigate();
  const filters = { ...queueFilter(queue), page, size };
  const q = useQuery({ queryKey: qk.reviewCases(filters), queryFn: () => api.reviewCases(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  return (
    <Flex vertical gap={12}>
      <Segmented<Queue>
        value={queue}
        onChange={onQueue}
        options={QUEUES.map((v) => ({ value: v, label: t(`reviews.filter.${v}` as MessageKey) }))}
        style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <TableFrame>
        <ListTable<ReviewCaseSummary>
          mobileCard={(r) => (
            <Flex vertical gap={6}>
              <Flex justify="space-between" align="center" gap={8}>
                <PersonCell name={r.partyName ?? '—'} sub={r.reason ?? undefined} />
                <ReviewStatusTag value={r.status} />
              </Flex>
              <Flex gap={8} align="center" className="ct-meta">
                <MatchLabelTag value={r.matchLabel} />
                <DateText value={r.createdAt} relative />
              </Flex>
            </Flex>
          )}
          rowKey="id"
          loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
          dataSource={q.data?.items}
          scroll={{ x: 980 }}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(caseInQueue(r.id, queue)) })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reviews.verifications.empty')} /> }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: q.data?.total ?? 0,
            onChange: (p, s) => onPage(p - 1, s),
            showSizeChanger: true,
            showTotal: (n) => t('reviews.total', { n: n.toLocaleString('en') }),
            style: { padding: '0 16px' },
          }}
          columns={[
            {
              title: t('reviews.col.person'),
              dataIndex: 'partyName',
              width: 240,
              render: (v: string | null, r) => <PersonCell name={v ?? '—'} sub={r.documentType ? docTypeLabel(r.documentType) : undefined} />,
            },
            {
              title: t('reviews.col.reason'),
              dataIndex: 'reason',
              render: (v: string | null) => (v ? <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 280 }}>{v}</Typography.Text> : '—'),
            },
            { title: t('reviews.col.match'), dataIndex: 'matchLabel', width: 120, render: (v: string | null) => <MatchLabelTag value={v} /> },
            { title: t('reviews.col.status'), dataIndex: 'status', width: 170, render: (v: string) => <ReviewStatusTag value={v} /> },
            { title: t('reviews.col.assigned'), dataIndex: 'assignedTo', width: 130, render: (v: string | null) => v ?? <span className="ct-meta">—</span> },
            {
              title: t('reviews.col.created'),
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
    </Flex>
  );
}

export default function ReviewsPage() {
  const qc = useQueryClient();
  const summary = useReviewSummary();
  const { values, set, page, size } = useSearchState(KEYS, { tab: 'scans', queue: 'OPEN' });
  const tab = values.tab === 'verifications' ? 'verifications' : 'scans';
  const queue = asQueue(values.queue);
  const onPage = (p: number, s: number) => set({ page: String(p), size: String(s) });
  const label = (key: MessageKey, n: number | undefined) => (
    <Flex align="center" gap={8}>
      {t(key)}
      {!!n && <Badge count={n} overflowCount={999} size="small" color="orange" />}
    </Flex>
  );

  return (
    <>
      <PageHeader
        title={t('reviews.title')}
        help={t('reviews.help')}
        extra={
          <RefreshStatus
            query={{
              dataUpdatedAt: summary.dataUpdatedAt,
              isFetching: summary.isFetching,
              refetch: () => {
                void qc.invalidateQueries({ queryKey: ['review-cases'] });
                void qc.invalidateQueries({ queryKey: ['scans'] });
                return summary.refetch();
              },
            }}
          />
        }
      />
      <CamtechReviewsBanner />
      <Tabs
        activeKey={tab}
        onChange={(k) => set({ tab: k, queue: null })}
        items={[
          { key: 'scans', label: label('reviews.tab.scans', summary.data?.scansToReview), children: <ScansTab page={page} size={size} onPage={onPage} /> },
          {
            key: 'verifications',
            label: label('reviews.tab.verifications', summary.data?.verificationsToReview),
            children: <VerificationsTab queue={queue} onQueue={(v) => set({ queue: v })} page={page} size={size} onPage={onPage} />,
          },
        ]}
      />
    </>
  );
}
