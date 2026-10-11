import { ClearOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Empty, Flex, Segmented, Tag, theme, Tooltip, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { dayjs } from '../../lib/format';
import { asApiCall, type SdkMessageType } from '../../lib/sdkMessages';

export interface LogEntry {
  id: number;
  at: number;
  type: SdkMessageType | 'portal';
  summary: string;
  payload: unknown;
}

const TYPE_COLOR: Record<LogEntry['type'], string> = {
  ready: 'blue',
  step: 'geekblue',
  complete: 'success',
  cancel: 'default',
  error: 'error',
  event: 'cyan',
  resize: 'default',
  portal: 'purple',
};

type Filter = 'all' | 'api' | 'flow';

function statusColor(status: number | null): string | undefined {
  if (status === null) return undefined;
  if (status >= 500) return '#e5484d';
  if (status >= 400) return '#f0a020';
  return '#2fb36d';
}

function Row({ e, start }: { e: LogEntry; start: number }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const call = e.type === 'event' ? asApiCall(e.payload) : null;
  const hasPayload = e.payload !== null && e.payload !== undefined;
  return (
    <div className="event-row" style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
      <Flex
        align="center"
        gap={8}
        style={{ padding: '6px 8px', cursor: hasPayload ? 'pointer' : 'default', fontSize: 12 }}
        onClick={() => hasPayload && setOpen((o) => !o)}
        role={hasPayload ? 'button' : undefined}
        aria-expanded={hasPayload ? open : undefined}
        tabIndex={hasPayload ? 0 : undefined}
        onKeyDown={(k) => hasPayload && (k.key === 'Enter' || k.key === ' ') && (k.preventDefault(), setOpen((o) => !o))}
      >
        <span style={{ width: 12, opacity: 0.5 }}>{hasPayload ? open ? <DownOutlined /> : <RightOutlined /> : null}</span>
        <Tooltip title={dayjs(e.at).format('HH:mm:ss.SSS')}>
          <Typography.Text type="secondary" className="tabular" style={{ width: 56, fontFamily: token.fontFamilyCode, fontSize: 12 }}>
            +{((e.at - start) / 1000).toFixed(1)}s
          </Typography.Text>
        </Tooltip>
        <Tag color={TYPE_COLOR[e.type]} style={{ marginInlineEnd: 0, minWidth: 64, textAlign: 'center' }}>
          {call ? 'api' : e.type}
        </Tag>
        {call ? (
          <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 12, flex: 1, minWidth: 0 }} ellipsis>
            <strong>{call.method}</strong> {call.path}
          </Typography.Text>
        ) : (
          <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
            {e.summary}
          </Typography.Text>
        )}
        {call && (
          <Flex gap={8} style={{ fontFamily: token.fontFamilyCode, fontSize: 12 }} className="tabular">
            {call.status !== null && <span style={{ color: statusColor(call.status), fontWeight: 600 }}>{call.status}</span>}
            {call.ms !== null && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{Math.round(call.ms)} ms</Typography.Text>}
          </Flex>
        )}
      </Flex>
      {open && hasPayload && (
        <pre style={{ margin: 0, padding: '6px 12px 10px 34px', fontSize: 12.5, fontFamily: token.fontFamilyCode, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: token.colorTextSecondary }}>
          {JSON.stringify(e.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Live log of what the SDK reports through postMessage. */
export function EventLog({ entries, onClear, height = 560 }: { entries: LogEntry[]; onClear: () => void; height?: number }) {
  const { token } = theme.useToken();
  const [filter, setFilter] = useState<Filter>('all');
  const end = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const shown = entries.filter((e) => {
    if (filter === 'all') return e.type !== 'resize';
    const isApi = e.type === 'event' && !!asApiCall(e.payload);
    return filter === 'api' ? isApi : !isApi && e.type !== 'resize';
  });
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: 'nearest' });
  }, [shown.length, follow]);
  const start = entries[0]?.at ?? 0;
  return (
    <Flex vertical style={{ height, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadiusLG, overflow: 'hidden', background: token.colorBgContainer }}>
      <Flex justify="space-between" align="center" gap={8} style={{ padding: '6px 8px', borderBottom: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillQuaternary }}>
        <Segmented<Filter>
          size="small"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${entries.filter((e) => e.type !== 'resize').length})` },
            { value: 'flow', label: 'Flow' },
            { value: 'api', label: 'API calls' },
          ]}
        />
        <Button size="small" type="text" icon={<ClearOutlined />} onClick={onClear} disabled={!entries.length}>
          Clear
        </Button>
      </Flex>
      <div
        style={{ flex: 1, overflow: 'auto' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        aria-live="polite"
        aria-label="SDK event log"
      >
        {shown.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Waiting for the SDK…" style={{ marginTop: 48 }} />
        ) : (
          shown.map((e) => <Row key={e.id} e={e} start={start} />)
        )}
        <div ref={end} />
      </div>
    </Flex>
  );
}
