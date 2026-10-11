import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Flex, Segmented, Select, Table, Tabs, Tag } from 'antd';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { reviewsApi } from '../../api/operations';
import type { ReviewCaseSummary } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { SimilarityBand } from '../../components/SimilarityBand';
import { ReviewStatusTag } from '../../components/Tags';
import { PersonCell } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { useApiMutation, useReasonMessage, useSimilarityThresholds, useTenantCode } from '../../lib/hooks';
import { docTypeLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

type TabKey = 'open' | 'in_review' | 'decided';

export default function ReviewQueuePage() {
  const navigate = useNavigate();
  const { canReview, username } = usePermissions();
  const thresholds = useSimilarityThresholds();
  const reason = useReasonMessage();
  const tenantCode = useTenantCode();
  const { values, set, page, size } = useSearchState(['tab', 'decided', 'assignedTo'] as const, { tab: 'open', decided: 'APPROVED' });
  const tab = values.tab as TabKey;
  const status = tab === 'open' ? 'OPEN' : tab === 'in_review' ? 'IN_REVIEW' : (values.decided ?? 'APPROVED');
  const filters = { status, assignedTo: tab === 'open' ? undefined : values.assignedTo, page, size };
  const q = useQuery({ queryKey: ['review-cases', filters], queryFn: () => reviewsApi.list(filters), placeholderData: keepPreviousData });
  const counts = {
    open: useQuery({ queryKey: ['review-count', 'OPEN'], queryFn: () => reviewsApi.list({ status: 'OPEN', size: 1 }) }).data?.total,
    inReview: useQuery({ queryKey: ['review-count', 'IN_REVIEW'], queryFn: () => reviewsApi.list({ status: 'IN_REVIEW', size: 1 }) }).data?.total,
  };
  const assign = useApiMutation((id: number) => reviewsApi.assign(id), {
    success: 'Assigned to you',
    invalidate: [['review-cases'], ['review-count'], ['review-case']],
  });

  // The admin users list is ADMIN-only, so the assignee options are derived from what we see.
  const assignees = useMemo(() => {
    const set = new Set<string>();
    if (username) set.add(username);
    q.data?.items.forEach((r) => r.assignedTo && set.add(r.assignedTo));
    if (values.assignedTo) set.add(values.assignedTo);
    return [...set];
  }, [q.data, username, values.assignedTo]);

  const columns = [
    {
      title: 'Opened',
      dataIndex: 'createdAt',
      width: 130,
      render: (v: string) => (
        <span className="ct-meta tabular">
          <DateText value={v} relative />
        </span>
      ),
    },
    {
      title: 'Person',
      width: 260,
      render: (_: unknown, r: ReviewCaseSummary) => (
        <PersonCell name={r.partyName ?? 'Unknown person'} sub={r.documentType ? docTypeLabel(r.documentType) : 'No document'} />
      ),
    },
    { title: 'Tenant', dataIndex: 'tenantId', width: 120, render: (v: number) => <Tag variant="filled" className="ct-pill">{tenantCode(v)}</Tag> },
    { title: 'Face match', width: 240, render: (_: unknown, r: ReviewCaseSummary) => <SimilarityBand value={r.finalSimilarity} thresholds={thresholds} /> },
    { title: 'Why review', dataIndex: 'reason', width: 260, ellipsis: { showTitle: true }, render: (v: string) => <span title={reason(v) ?? v}>{reason(v) ?? v}</span> },
    { title: 'Assigned to', dataIndex: 'assignedTo', width: 140, render: (v: string | null) => (v ? <span style={{ fontWeight: 600 }}>{v}</span> : <span className="ct-meta">Nobody</span>) },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v: string) => <ReviewStatusTag value={v} /> },
    ...(tab === 'decided' ? [
          {
            title: 'Decided',
            dataIndex: 'updatedAt',
            width: 130,
            render: (v: string) => (
              <span className="ct-meta tabular">
                <DateText value={v} relative />
              </span>
            ),
          },
        ] : []),
    {
      title: '',
      width: 220,
      render: (_: unknown, r: ReviewCaseSummary) => (
        <Flex gap={8} justify="flex-end" onClick={(e) => e.stopPropagation()}>
          {canReview && (r.status === 'OPEN' || (r.status === 'IN_REVIEW' && r.assignedTo !== username)) && (
            <Button size="small" icon={<UserAddOutlined />} loading={assign.isPending && assign.variables === r.id} onClick={() => assign.mutate(r.id)}>
              Assign to me
            </Button>
          )}
          <Button size="small" type={r.status === 'APPROVED' || r.status === 'REJECTED' ? 'default' : 'primary'} onClick={() => navigate(`/reviews/${r.id}`)}>
            {r.status === 'APPROVED' || r.status === 'REJECTED' ? 'View' : 'Review'}
          </Button>
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Review queue"
        help="Verifications the system couldn't decide on its own (usually an uncertain face match, or a face already registered to someone else). Compare the selfie with the document photo or the registered face and approve or reject. The queue holds the default tenant's cases and those of tenants whose reviews CamTech handles; tenants that review their own decide in the tenant portal."
        extra={<Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>Refresh</Button>}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => set({ tab: k, assignedTo: null })}
        items={[
          { key: 'open', label: `Open${counts.open !== undefined ? ` (${counts.open})` : ''}` },
          { key: 'in_review', label: `In review${counts.inReview !== undefined ? ` (${counts.inReview})` : ''}` },
          { key: 'decided', label: 'Decided' },
        ]}
        style={{ marginBottom: 4 }}
      />
      {tab !== 'open' && (
        <Flex gap={8} wrap style={{ marginBottom: 16 }}>
          {tab === 'decided' && (
            <Segmented
              value={values.decided}
              onChange={(v) => set({ decided: String(v) })}
              options={[
                { label: 'Approved', value: 'APPROVED' },
                { label: 'Rejected', value: 'REJECTED' },
              ]}
            />
          )}
          <Select
            allowClear
            placeholder="Assigned to: anyone"
            style={{ width: 200 }}
            value={values.assignedTo}
            onChange={(v) => set({ assignedTo: v })}
            options={assignees.map((a) => ({ value: a, label: a === username ? `Me (${a})` : a }))}
          />
        </Flex>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
          <Table<ReviewCaseSummary>
            rowKey="id"
            loading={q.isPending}
            dataSource={q.data?.items}
            columns={columns}
            scroll={{ x: 1480 }}
            rowClassName={() => 'clickable-row'}
            onRow={(r) => ({ onClick: () => navigate(`/reviews/${r.id}`) })}
            locale={{ emptyText: tab === 'open' ? 'No open cases — all caught up.' : 'No cases here' }}
            pagination={{
              current: page + 1,
              pageSize: size,
              total: q.data?.total ?? 0,
              showTotal: (t, [a, b]) => `Showing ${a}–${b} of ${formatNumber(t)}`,
              onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
              style: { padding: '0 16px' },
            }}
          />
        </div>
      )}
    </>
  );
}
