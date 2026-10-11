import { ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Flex, Input, Select, Table, Tabs, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { sessionsApi } from '../../api/operations';
import type { SessionSummary } from '../../api/types';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { BAND_INFO, similarityBand } from '../../lib/similarity';
import { DecisionTag, StatusTag } from '../../components/Tags';
import { PersonCell } from '../../components/ui';
import { dayjs, formatNumber } from '../../lib/format';
import { useClientApps, useSimilarityThresholds } from '../../lib/hooks';
import { CHANNEL_LABELS, channelLabel, DECISION_LABELS, docTypeLabel, FLOW_LABELS, flowLabel, SESSION_STATUS_LABELS } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

const KEYS = ['status', 'decision', 'flowCode', 'channel', 'clientAppCode', 'from', 'to', 'q'] as const;
const toOptions = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

/** Saved views: each one is a preset of the status/decision filters. */
const VIEWS = [
  { key: 'all', label: 'All', status: undefined, decision: undefined },
  { key: 'review', label: 'Needs review', status: undefined, decision: 'REVIEW' },
  { key: 'rejected', label: 'Rejected', status: undefined, decision: 'REJECTED' },
  { key: 'approved', label: 'Approved', status: undefined, decision: 'APPROVED' },
  { key: 'progress', label: 'In progress', status: 'IN_PROGRESS', decision: undefined },
] as const;

export default function SessionsPage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const apps = useClientApps();
  const thresholds = useSimilarityThresholds();
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: ['sessions', filters], queryFn: () => sessionsApi.list(filters), placeholderData: keepPreviousData });
  const anyFilter = KEYS.some((k) => values[k]);
  const view = VIEWS.find((v) => v.status === values.status && v.decision === values.decision)?.key ?? '';

  return (
    <>
      <PageHeader
        title="Verifications"
        help="Every identity check your customers have started, newest first. Open one to see each step, the images and the decision."
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => q.refetch()}>
            Refresh
          </Button>
        }
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
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder="Name, customer ref or document number"
          key={values.q ?? ''}
          defaultValue={values.q}
          onSearch={(v) => set({ q: v })}
          style={{ width: 340, maxWidth: '100%' }}
        />
        <Select allowClear placeholder="Flow" style={{ width: 200 }} value={values.flowCode} onChange={(v) => set({ flowCode: v })} options={toOptions(FLOW_LABELS)} />
        <Select allowClear placeholder="Result" style={{ width: 140 }} value={values.decision} onChange={(v) => set({ decision: v })} options={toOptions(DECISION_LABELS)} />
        <Select allowClear placeholder="Status" style={{ width: 140 }} value={values.status} onChange={(v) => set({ status: v })} options={toOptions(SESSION_STATUS_LABELS)} />
        <Select allowClear placeholder="Channel" style={{ width: 130 }} value={values.channel} onChange={(v) => set({ channel: v })} options={toOptions(CHANNEL_LABELS)} />
        <Select
          allowClear
          placeholder="Client app"
          style={{ width: 160 }}
          value={values.clientAppCode}
          onChange={(v) => set({ clientAppCode: v })}
          loading={apps.isPending}
          options={(apps.data ?? []).map((a) => ({ value: a.code, label: a.name }))}
        />
        <DatePicker.RangePicker
          allowEmpty={[true, true]}
          value={[values.from ? dayjs(values.from) : null, values.to ? dayjs(values.to) : null]}
          onChange={(r) => set({ from: r?.[0]?.format('YYYY-MM-DD'), to: r?.[1]?.format('YYYY-MM-DD') })}
        />
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
          <Table<SessionSummary>
            rowKey="publicId"
            loading={q.isFetching && !q.data ? true : q.isFetching ? { delay: 300 } : false}
            dataSource={q.data?.items}
            scroll={{ x: 900 }}
            rowClassName={() => 'clickable-row'}
            onRow={(r) => ({ onClick: () => navigate(`/verifications/${r.publicId}`) })}
            locale={{ emptyText: anyFilter ? 'No verifications match these filters' : 'No verifications yet' }}
            pagination={{
              current: page + 1,
              pageSize: size,
              total: q.data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t, [a, b]) => `Showing ${a}–${b} of ${formatNumber(t)}`,
              onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
              style: { padding: '0 16px' },
            }}
            columns={[
              {
                title: 'Person',
                render: (_, r) => (
                  <PersonCell
                    name={r.partyName ?? 'Unknown person'}
                    sub={r.subjectRef ? `Customer ref ${r.subjectRef}` : 'No customer ref'}
                    org={r.flowCode === 'BUSINESS_VERIFICATION'}
                  />
                ),
              },
              {
                title: 'Flow',
                render: (_, r) => (
                  <Flex vertical>
                    <span style={{ fontWeight: 600 }}>{flowLabel(r.flowCode)}</span>
                    <span className="ct-meta">
                      {channelLabel(r.channel)}
                      {r.documentType ? ` · ${docTypeLabel(r.documentType)}` : ''}
                    </span>
                  </Flex>
                ),
              },
              {
                title: 'Result',
                width: 150,
                render: (_, r) => (r.decision ? <DecisionTag value={r.decision} /> : <StatusTag value={r.status} />),
              },
              {
                title: 'Face match',
                dataIndex: 'finalSimilarity',
                width: 160,
                render: (v: number | null) => {
                  if (v === null || v === undefined) return <span className="ct-meta">—</span>;
                  const b = BAND_INFO[similarityBand(v, thresholds)];
                  return (
                    <Tag color={b.color} variant="filled" className="ct-pill">
                      {b.label}
                    </Tag>
                  );
                },
              },
              {
                title: 'Started',
                dataIndex: 'createdAt',
                width: 150,
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
