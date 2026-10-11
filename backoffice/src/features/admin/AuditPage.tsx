import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DatePicker, Flex, Input, Select, Table } from 'antd';
import { auditApi } from '../../api/operations';
import type { AuditEvent } from '../../api/types';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { JsonBlock } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { PersonCell } from '../../components/ui';
import { dayjs, formatNumber } from '../../lib/format';
import { AUDIT_ACTION_LABELS, auditActionLabel, humanize } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';

const ENTITIES = ['SESSION', 'REVIEW_CASE', 'PARTY', 'FACE_TEMPLATE', 'MEDIA', 'CONFIG_PARAM', 'FLOW_STEP', 'REASON_CODE', 'ENTITLEMENT', 'CLIENT_APP', 'CREDENTIAL', 'WEBHOOK', 'RETENTION_POLICY', 'ADMIN_USER'];

export default function AuditPage() {
  const { values, set, reset, page, size } = useSearchState(['actor', 'action', 'entity', 'from', 'to'] as const);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: ['audit', filters], queryFn: () => auditApi.list(filters), placeholderData: keepPreviousData });
  const anyFilter = !!(values.actor || values.action || values.entity || values.from || values.to);

  return (
    <>
      <PageHeader title="Audit log" help="Who did what and when: sign-ins, review decisions, configuration changes, erasures and API calls by client apps. Entries can't be changed." />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search key={values.actor ?? ''} allowClear defaultValue={values.actor} placeholder="Actor (user or app)" onSearch={(v) => set({ actor: v })} style={{ width: 220 }} />
        <Select
          allowClear
          showSearch
          placeholder="Action"
          style={{ width: 220 }}
          value={values.action}
          onChange={(v) => set({ action: v })}
          optionFilterProp="label"
          options={Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <Select allowClear placeholder="Entity" style={{ width: 180 }} value={values.entity} onChange={(v) => set({ entity: v })} options={ENTITIES.map((e) => ({ value: e, label: humanize(e) }))} />
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
          <Table<AuditEvent>
            rowKey="id"
            size="middle"
            loading={q.isPending}
            dataSource={q.data?.items}
            scroll={{ x: 900 }}
            locale={{ emptyText: anyFilter ? 'No entries match these filters' : 'No audit entries' }}
            expandable={{
              rowExpandable: (e) => !!(e.entityId || e.ipAddress || (e.details && Object.keys(e.details).length > 0)),
              expandedRowRender: (e) => (
                <Flex vertical gap={8}>
                  <span className="ct-meta">
                    {e.entityId && <>Record <span className="ct-mono">{e.entityId}</span></>}
                    {e.entityId && e.ipAddress && ' · '}
                    {e.ipAddress && <>From <span className="ct-mono">{e.ipAddress}</span></>}
                  </span>
                  {e.details && Object.keys(e.details).length > 0 && <JsonBlock value={e.details} />}
                </Flex>
              ),
            }}
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
                title: 'When',
                dataIndex: 'at',
                width: 170,
                render: (v: string) => (
                  <span className="ct-meta tabular">
                    <DateText value={v} />
                  </span>
                ),
              },
              {
                title: 'Actor',
                render: (_, e) => (
                  <PersonCell name={e.actor} sub={humanize(e.actorType)} org={e.actorType !== 'ADMIN'} />
                ),
              },
              { title: 'Action', dataIndex: 'action', render: (v: string) => <span title={v} style={{ fontWeight: 600 }}>{auditActionLabel(v)}</span> },
              {
                title: 'Entity',
                render: (_, e) =>
                  e.entity ? (
                    <span>{humanize(e.entity)}</span>
                  ) : (
                    <span className="ct-meta">—</span>
                  ),
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
