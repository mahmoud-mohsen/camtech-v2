import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled, MinusCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Alert, Empty, Flex, Image, Table, theme, Timeline as AntTimeline, Typography } from 'antd';
import type { Check, Step } from '../api/types';
import { TONE_HEX } from '../lib/colors';
import { formatDateTime, formatDuration } from '../lib/format';
import { checkLabel, stepLabel } from '../lib/labels';
import { MediaImage } from './ImageViewer';
import { OutcomeTag, StepStatusTag } from './Tags';

const STATUS_ICON: Record<Step['status'], React.ReactNode> = {
  PASSED: <CheckCircleFilled style={{ color: TONE_HEX.success, fontSize: 16 }} />,
  FAILED: <CloseCircleFilled style={{ color: TONE_HEX.error, fontSize: 16 }} />,
  REVIEW: <ExclamationCircleFilled style={{ color: TONE_HEX.warning, fontSize: 16 }} />,
  IN_PROGRESS: <SyncOutlined spin style={{ color: TONE_HEX.processing, fontSize: 16 }} />,
  PENDING: <ClockCircleOutlined style={{ color: TONE_HEX.default, fontSize: 16 }} />,
  SKIPPED: <MinusCircleOutlined style={{ color: TONE_HEX.default, fontSize: 16 }} />,
};

function scoreText(c: Check): string {
  if (c.score === null) return '—';
  return Number.isInteger(c.score) ? String(c.score) : c.score.toFixed(3);
}

function thresholdText(c: Check): string {
  if (!c.thresholdUsed) return '—';
  const isMax = c.details && (c.details as { comparison?: string }).comparison === 'max';
  return `${isMax ? '≤' : '≥'} ${c.thresholdUsed}`;
}

function ChecksTable({ checks }: { checks: Check[] }) {
  if (!checks.length) return null;
  return (
    <Table<Check>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={checks}
      style={{ maxWidth: 640 }}
      columns={[
        { title: 'Check', dataIndex: 'checkCode', render: (c: string) => <span title={c}>{checkLabel(c)}</span> },
        { title: 'Score', align: 'right', render: (_, c) => <span className="tabular">{scoreText(c)}</span> },
        { title: 'Needed', align: 'right', render: (_, c) => <span className="tabular" style={{ opacity: 0.7 }}>{thresholdText(c)}</span> },
        { title: 'Result', dataIndex: 'outcome', width: 100, render: (o: string) => <OutcomeTag value={o} /> },
      ]}
      expandable={{
        rowExpandable: (c) => !!c.details && Object.keys(c.details).length > 0,
        expandedRowRender: (c) => (
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.details, null, 2)}</pre>
        ),
      }}
    />
  );
}

/**
 * Vertical timeline of every step attempt (each attempt is its own row), with checks and images.
 */
export function AttemptTimeline({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  const { token } = theme.useToken();
  if (!steps.length) return <Empty description="No steps have started yet" />;
  const attemptsPerStep = steps.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.stepCode]: Math.max(acc[s.stepCode] ?? 0, s.attemptNo) }), {});
  return (
    <Image.PreviewGroup>
      <AntTimeline
        items={steps.map((s) => ({
          key: s.id,
          icon: STATUS_ICON[s.status],
          content: (
            <div style={{ paddingBottom: compact ? 4 : 12 }}>
              <Flex align="center" gap={8} wrap>
                <Typography.Text strong title={s.stepCode}>
                  {stepLabel(s.stepCode)}
                </Typography.Text>
                {attemptsPerStep[s.stepCode] > 1 && <Typography.Text type="secondary">attempt {s.attemptNo}</Typography.Text>}
                <StepStatusTag value={s.status} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }} className="tabular">
                  {formatDateTime(s.startedAt)}
                  {s.endedAt && ` · ${formatDuration(s.startedAt, s.endedAt)}`}
                </Typography.Text>
              </Flex>
              {s.reasonCode && (
                <Alert
                  style={{ marginTop: 8, maxWidth: 640 }}
                  type={s.status === 'REVIEW' ? 'warning' : s.status === 'FAILED' ? 'error' : 'info'}
                  showIcon
                  title={
                    <span>
                      {s.reasonMessage ?? s.reasonCode}{' '}
                      <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                        {s.reasonCode}
                      </Typography.Text>
                    </span>
                  }
                />
              )}
              {!compact && s.checks.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <ChecksTable checks={s.checks} />
                </div>
              )}
              {s.media.length > 0 && (
                <Flex gap={10} wrap style={{ marginTop: 10 }}>
                  {s.media.map((m) => (
                    <MediaImage key={m.id} media={m} width={compact ? 64 : 92} height={compact ? 64 : 92} />
                  ))}
                </Flex>
              )}
            </div>
          ),
        }))}
        style={{ paddingTop: 8, color: token.colorText }}
      />
    </Image.PreviewGroup>
  );
}
