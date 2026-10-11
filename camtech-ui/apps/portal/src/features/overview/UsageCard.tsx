import type { Entitlement } from '@camtech/api-client';
import { Card, Empty, Flex, Progress, Tag, theme, Tooltip, Typography } from 'antd';
import { DataState } from '../../components/DataState';
import { TONE_HEX } from '../../lib/colors';
import { formatDate } from '../../lib/format';
import { useEntitlements } from '../../lib/hooks';
import { featureLabel } from '../../lib/labels';
import { SectionTitle } from '../../components/ui';

/** What a counter includes beyond its own flow. */
const USAGE_NOTES: Record<string, string> = {
  FACE_ENROLLMENT: 'Includes selfie ID verifications that registered the face.',
};

function UsageRow({ e }: { e: Entitlement }) {
  const { token } = theme.useToken();
  const pct = e.quotaPerDay ? Math.min(100, (e.usedToday / e.quotaPerDay) * 100) : 0;
  const color = pct >= 90 ? TONE_HEX.error : pct >= 70 ? TONE_HEX.warning : token.colorPrimary;
  return (
    <div>
      <Flex justify="space-between" align="baseline" gap={8}>
        <Tooltip title={USAGE_NOTES[e.featureCode]}>
          <Typography.Text style={{ fontWeight: 600 }}>{featureLabel(e.featureCode)}</Typography.Text>
        </Tooltip>
        {e.quotaPerDay === null ? (
          <Flex gap={6} align="center">
            <Typography.Text className="tabular" type="secondary" style={{ fontSize: 12 }}>
              {e.usedToday.toLocaleString('en')} today
            </Typography.Text>
            <Tag color="blue" variant="filled" className="ct-pill">
              Unlimited
            </Tag>
          </Flex>
        ) : (
          <Typography.Text className="tabular" strong>
            {e.usedToday.toLocaleString('en')}{' '}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              / {e.quotaPerDay.toLocaleString('en')} today
            </Typography.Text>
          </Typography.Text>
        )}
      </Flex>
      {e.quotaPerDay !== null && (
        <Tooltip title={`${Math.max(0, e.quotaPerDay - e.usedToday).toLocaleString('en')} left today. The counter resets at midnight (UTC).`}>
          <Progress percent={pct} showInfo={false} strokeColor={color} aria-label={`${featureLabel(e.featureCode)} usage`} />
        </Tooltip>
      )}
      {e.validUntil && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Valid until {formatDate(e.validUntil)}
        </Typography.Text>
      )}
    </div>
  );
}

/** Daily usage of each enabled flow against its quota. */
export function UsageCard() {
  const q = useEntitlements();
  return (
    <Card style={{ height: '100%' }}>
      <SectionTitle title="Usage today" sub="Against your daily quotas. Counters reset at midnight (UTC)." />
      <DataState query={q} rows={4}>
        {(list) => {
          const flows = list.filter((e) => e.featureType === 'FLOW' && e.enabled);
          if (!flows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No flows are enabled for your tenant yet" />;
          return (
            <Flex vertical gap={14}>
              {flows.map((e) => (
                <UsageRow key={e.id} e={e} />
              ))}
            </Flex>
          );
        }}
      </DataState>
    </Card>
  );
}
