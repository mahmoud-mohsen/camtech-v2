import { CameraOutlined, CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled, MinusCircleOutlined, SyncOutlined } from '@ant-design/icons';
import type { TenantStep } from '@camtech/api-client';
import { Alert, Empty, Flex, Tag, theme, Timeline, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { OutcomeTag, StepStatusTag } from '../../components/Tags';
import { TONE_HEX } from '../../lib/colors';
import { formatDateTime, formatDuration } from '../../lib/format';
import { checkLabel, stepLabel } from '../../lib/labels';

const STATUS_ICON: Record<string, ReactNode> = {
  PASSED: <CheckCircleFilled style={{ color: TONE_HEX.success, fontSize: 16 }} />,
  FAILED: <CloseCircleFilled style={{ color: TONE_HEX.error, fontSize: 16 }} />,
  REVIEW: <ExclamationCircleFilled style={{ color: TONE_HEX.warning, fontSize: 16 }} />,
  IN_PROGRESS: <SyncOutlined spin style={{ color: TONE_HEX.processing, fontSize: 16 }} />,
  PENDING: <ClockCircleOutlined style={{ color: TONE_HEX.default, fontSize: 16 }} />,
  SKIPPED: <MinusCircleOutlined style={{ color: TONE_HEX.default, fontSize: 16 }} />,
};

/**
 * Every step attempt in order, with the reason the user was given and the outcome of each check.
 * Scores and images are deliberately not exposed by the API: only how many images were stored.
 */
export function StepTimeline({ steps }: { steps: TenantStep[] }) {
  const { token } = theme.useToken();
  if (!steps.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No step has started yet" />;
  const maxAttempt = steps.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.stepCode]: Math.max(acc[s.stepCode] ?? 0, s.attemptNo) }), {});
  return (
    <Timeline
      style={{ paddingTop: 8 }}
      items={steps.map((s, i) => ({
        key: `${s.stepCode}-${s.attemptNo}-${i}`,
        icon: STATUS_ICON[s.status] ?? STATUS_ICON.PENDING,
        content: (
          <div style={{ paddingBottom: 10 }}>
            <Flex align="center" gap={8} wrap>
              <Typography.Text strong title={s.stepCode}>
                {stepLabel(s.stepCode)}
              </Typography.Text>
              {maxAttempt[s.stepCode] > 1 && <Typography.Text type="secondary">attempt {s.attemptNo}</Typography.Text>}
              <StepStatusTag value={s.status} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }} className="tabular">
                {formatDateTime(s.startedAt)}
                {s.endedAt && ` · ${formatDuration(s.startedAt, s.endedAt)}`}
              </Typography.Text>
              {s.imagesCount > 0 && (
                <Tooltip title="Images are stored by CamTech for the review and audit trail; they are not available through the tenant API.">
                  <Tag icon={<CameraOutlined />} variant="filled" style={{ marginInlineEnd: 0 }}>
                    {s.imagesCount} {s.imagesCount === 1 ? 'image' : 'images'} stored
                  </Tag>
                </Tooltip>
              )}
            </Flex>
            {s.reasonCode && (
              <Alert
                style={{ marginTop: 8, maxWidth: 680 }}
                type={s.status === 'REVIEW' ? 'warning' : s.status === 'FAILED' ? 'error' : 'info'}
                showIcon
                title={
                  <span>
                    {s.reasonMessage ?? s.reasonCode}{' '}
                    <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: token.fontFamilyCode }}>
                      {s.reasonCode}
                    </Typography.Text>
                  </span>
                }
              />
            )}
            {s.checks.length > 0 && (
              <Flex gap={6} wrap style={{ marginTop: 8 }}>
                {s.checks.map((c) => (
                  <Flex
                    key={c.checkCode}
                    align="center"
                    gap={6}
                    style={{ padding: '2px 4px 2px 8px', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 6, fontSize: 12 }}
                  >
                    <span title={c.checkCode}>{checkLabel(c.checkCode)}</span>
                    <OutcomeTag value={c.outcome} />
                  </Flex>
                ))}
              </Flex>
            )}
          </div>
        ),
      }))}
    />
  );
}
