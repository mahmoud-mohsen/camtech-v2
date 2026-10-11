import { RightOutlined } from '@ant-design/icons';
import type { TenantSessionSummary } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Empty, Flex, Tabs } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { DecisionTag, StatusTag } from '../../components/Tags';
import { FilterBar } from '../../components/FilterBar';
import { ListTable } from '../../components/ListTable';
import { qk, useClientApps } from '../../lib/hooks';
import { CHANNEL_LABELS, channelLabel, DECISION_LABELS, docTypeLabel, flowLabel, SESSION_STATUS_LABELS, toOptions } from '../../lib/labels';
import { PersonCell, TableFrame } from '../../components/ui';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { useTenantInfo } from '../../auth/useAuth';
import { LIST_REFETCH_MS } from '../../lib/queryClient';

const KEYS = ['status', 'decision', 'flowCode', 'channel', 'clientAppCode', 'from', 'to', 'q'] as const;

/** Saved views: each one is a preset of the status/decision filters. */
const VIEWS = [
  { key: 'all', label: 'All', status: undefined, decision: undefined },
  { key: 'review', label: 'In review', status: undefined, decision: 'REVIEW' },
  { key: 'rejected', label: 'Rejected', status: undefined, decision: 'REJECTED' },
  { key: 'approved', label: 'Approved', status: undefined, decision: 'APPROVED' },
  { key: 'progress', label: 'In progress', status: 'IN_PROGRESS', decision: undefined },
] as const;

export default function VerificationsPage() {
  const navigate = useNavigate();
  const info = useTenantInfo();
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const apps = useClientApps();
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: qk.sessions(filters), queryFn: () => api.sessions(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  const anyFilter = KEYS.some((k) => values[k]);
  const view = VIEWS.find((v) => v.status === values.status && v.decision === values.decision)?.key ?? '';
  const flowOptions = info.flows.filter((f) => f.code !== 'DOCUMENT_SCAN').map((f) => ({ value: f.code, label: flowLabel(f.code) }));

  return (
    <>
      <PageHeader
        title="Verifications"
        help="Every verification your apps started: open one to see each step and the decision."
      />
      <Tabs
        activeKey={view}
        onChange={(k) => {
          const v = VIEWS.find((x) => x.key === k)!;
          set({ status: v.status, decision: v.decision });
        }}
        items={VIEWS.map((v) => ({ key: v.key, label: v.label }))}
        style={{ marginBottom: 4 }}
      />
      <FilterBar
        values={values}
        set={set}
        onClearAll={reset}
        query={q}
        search={{ key: 'q', placeholder: 'Search your user ref, name or document number', width: 340 }}
        filters={[
          { kind: 'select', key: 'flowCode', label: 'Flow', options: flowOptions, width: 200 },
          { kind: 'dateRange', from: 'from', to: 'to', label: 'Started' },
          { kind: 'select', key: 'status', label: 'Status', options: toOptions(SESSION_STATUS_LABELS), more: true },
          { kind: 'select', key: 'decision', label: 'Result', options: toOptions(DECISION_LABELS), more: true },
          { kind: 'select', key: 'channel', label: 'Channel', options: toOptions(CHANNEL_LABELS), more: true },
          { kind: 'select', key: 'clientAppCode', label: 'App', options: (apps.data ?? []).map((a) => ({ value: a.code, label: a.name })), loading: apps.isPending, more: true },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <TableFrame>
        <ListTable<TenantSessionSummary>
          mobileCard={(r) => (
            <Flex vertical gap={6}>
              <Flex justify="space-between" align="center" gap={8}>
                <PersonCell name={r.partyName ?? 'Not known yet'} sub={flowLabel(r.flowCode)} org={r.flowCode === 'BUSINESS_VERIFICATION'} />
                {r.decision ? <DecisionTag value={r.decision} /> : <StatusTag value={r.status} />}
              </Flex>
              <span className="ct-meta">
                {channelLabel(r.channel)} · <DateText value={r.createdAt} relative />
              </span>
            </Flex>
          )}
          rowKey="publicId"
          loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
          dataSource={q.data?.items}
          scroll={{ x: 860 }}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(`/verifications/${r.publicId}`) })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={anyFilter ? 'No verifications match these filters' : 'No verifications yet. Try one in the playground.'}
              >
                {!anyFilter && <Button onClick={() => navigate('/playground')}>Open playground</Button>}
              </Empty>
            ),
          }}
          pagination={{
            current: page + 1,
            pageSize: size,
            total: q.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t, [a, b]) => `Showing ${a}–${b} of ${t.toLocaleString('en')}`,
            style: { padding: '0 16px' },
            onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
          }}
          columns={[
            {
              title: 'Person',
              render: (_, r) => (
                <PersonCell name={r.partyName ?? 'Not known yet'} sub={r.subjectRef ? `Your ref ${r.subjectRef}` : 'No user ref'} org={r.flowCode === 'BUSINESS_VERIFICATION'} />
              ),
            },
            {
              title: 'Flow',
              render: (_, r) => (
                <Flex vertical>
                  <span style={{ fontWeight: 600 }}>{flowLabel(r.flowCode)}</span>
                  <span className="ct-meta">
                    {[channelLabel(r.channel), r.clientAppCode, r.documentType && docTypeLabel(r.documentType)].filter(Boolean).join(' · ')}
                  </span>
                </Flex>
              ),
            },
            { title: 'Result', width: 150, render: (_, r) => (r.decision ? <DecisionTag value={r.decision} /> : <StatusTag value={r.status} />) },
            {
              title: 'Started',
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
      )}
    </>
  );
}
