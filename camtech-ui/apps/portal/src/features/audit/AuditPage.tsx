import { DownOutlined } from '@ant-design/icons';
import type { AuditEvent } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Empty, Flex, Pagination, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { JsonBlock } from '../../components/Misc';
import { FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { LIST_REFETCH_MS } from '../../lib/queryClient';
import { FORM_WIDTH, PersonAvatar } from '../../components/ui';
import { dayjs } from '../../lib/format';
import { qk } from '../../lib/hooks';
import { ACTOR_LABELS, AUDIT_ACTION_LABELS, auditActionLabel, humanize, toOptions } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';

const KEYS = ['actorType', 'action', 'from', 'to'] as const;

function dayLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.format('dddd, D MMMM YYYY');
}

function readable(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Details as plain label/value pairs, with a before/after view when the event records one. */
function EventDetails({ e }: { e: AuditEvent }) {
  const [raw, setRaw] = useState(false);
  const d = e.details ?? {};
  const { before, after, ...rest } = d as Record<string, unknown> & { before?: unknown; after?: unknown };
  const hasDiff = before !== undefined || after !== undefined;
  const entries = Object.entries(rest);
  return (
    <Flex vertical gap={12} style={{ padding: '0 20px 18px 70px' }}>
      {hasDiff && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--ct-error-soft)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ct-error)' }}>Before</div>
            <div className="ct-strong tabular" style={{ wordBreak: 'break-word' }}>{readable(before)}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--ct-success-soft)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ct-success)' }}>After</div>
            <div className="ct-strong tabular" style={{ wordBreak: 'break-word' }}>{readable(after)}</div>
          </div>
        </div>
      )}
      {entries.length > 0 && (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: 24 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ padding: '8px 0', borderBottom: '1px solid var(--ct-border-subtle)' }}>
              <dt className="ct-meta">{humanize(k)}</dt>
              <dd style={{ margin: 0, fontWeight: 600, wordBreak: 'break-word' }}>{readable(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="ct-meta">
        {e.entityId && (
          <>
            Record <span className="ct-mono">{e.entityId}</span> ·{' '}
          </>
        )}
        {e.ipAddress && (
          <>
            From <span className="ct-mono">{e.ipAddress}</span> ·{' '}
          </>
        )}
        <DateText value={e.at} />
        {e.details && (
          <>
            {' · '}
            <Typography.Link onClick={() => setRaw((r) => !r)} style={{ fontWeight: 700 }}>
              {raw ? 'Hide raw event' : 'Show raw event'}
            </Typography.Link>
          </>
        )}
      </span>
      {raw && <JsonBlock value={e.details} maxHeight={280} />}
    </Flex>
  );
}

function EventRow({ e, open, onToggle }: { e: AuditEvent; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderTop: '1px solid var(--ct-border-subtle)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          all: 'unset', boxSizing: 'border-box', width: '100%', display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px', cursor: 'pointer',
        }}
      >
        <PersonAvatar name={e.actor} org={e.actorType !== 'TENANT_USER'} />
        <Flex vertical gap={4} style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, lineHeight: '22px', color: 'var(--ct-text)' }}>
            <b style={{ color: 'var(--ct-heading)' }}>{e.actor}</b> · {auditActionLabel(e.action)}
            {e.entity && <span style={{ color: 'var(--ct-text-secondary)' }}> ({humanize(e.entity).toLowerCase()})</span>}
          </span>
          <Flex gap={8} align="center" wrap className="ct-meta">
            <span style={{ padding: '2px 8px', borderRadius: 999, background: 'var(--ct-subtle)', border: '1px solid var(--ct-border-subtle)', fontWeight: 700 }}>
              {ACTOR_LABELS[e.actorType] ?? humanize(e.actorType)}
            </span>
            <span className="tabular">{dayjs(e.at).format('HH:mm')}</span>
          </Flex>
        </Flex>
        <DownOutlined rotate={open ? 180 : 0} style={{ color: 'var(--ct-text-tertiary)', marginTop: 6 }} />
      </button>
      {open && <EventDetails e={e} />}
    </div>
  );
}

export default function AuditPage() {
  const { values, set, reset, page, size } = useSearchState(KEYS);
  const filters = { ...values, page, size };
  const q = useQuery({ queryKey: qk.audit(filters), queryFn: () => api.auditEvents(filters), placeholderData: keepPreviousData, refetchInterval: LIST_REFETCH_MS });
  const anyFilter = KEYS.some((k) => values[k]);
  const [open, setOpen] = useState<number | null>(null);

  const groups: { label: string; items: AuditEvent[] }[] = [];
  for (const e of q.data?.items ?? []) {
    const label = dayLabel(e.at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div style={{ maxWidth: FORM_WIDTH }}>
      <PageHeader
        title="Audit log"
        help="Who changed what in your account: your team, CamTech, your apps and the system."
      />
      <FilterBar
        values={values}
        set={set}
        onClearAll={reset}
        query={q}
        filters={[
          { kind: 'select', key: 'actorType', label: 'Who', options: toOptions(ACTOR_LABELS), width: 190 },
          { kind: 'select', key: 'action', label: 'What happened', options: toOptions(AUDIT_ACTION_LABELS), width: 240, searchable: true },
          { kind: 'dateRange', from: 'from', to: 'to', label: 'When' },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : groups.length === 0 ? (
        <Empty description={anyFilter ? 'No events match these filters' : 'Nothing recorded yet'} />
      ) : (
        <Flex vertical gap={24}>
          {groups.map((g) => (
            <section key={g.label}>
              <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ct-text-secondary)' }}>
                {g.label}
              </h2>
              <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)', overflow: 'hidden' }}>
                <div style={{ marginTop: -1 }}>
                  {g.items.map((e) => (
                    <EventRow key={e.id} e={e} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />
                  ))}
                </div>
              </div>
            </section>
          ))}
          <Pagination
            align="end"
            current={page + 1}
            pageSize={size}
            total={q.data?.total ?? 0}
            showSizeChanger
            showTotal={(t) => `${t.toLocaleString('en')} events`}
            onChange={(p, s) => set({ page: String(p - 1), size: String(s) })}
          />
        </Flex>
      )}
    </div>
  );
}
