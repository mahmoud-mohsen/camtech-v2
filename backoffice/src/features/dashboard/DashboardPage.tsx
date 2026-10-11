import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, EyeOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Flex, Row, Segmented, Skeleton, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import { dashboardApi, reviewsApi } from '../../api/operations';
import type { Dashboard } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { BarList } from '../../components/BarList';
import { DataState, ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { BAND_INFO, similarityBand } from '../../lib/similarity';
import { PersonCell, SectionTitle, StatCard } from '../../components/ui';
import { TONE_HEX } from '../../lib/colors';
import { dayjs, formatNumber, formatPercent, formatSimilarity } from '../../lib/format';
import { useSimilarityThresholds, useTenantCode } from '../../lib/hooks';
import { channelLabel, docTypeLabel, flowLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { DailyChart } from './DailyChart';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Kpis({ d, days }: { d: Dashboard; days: number }) {
  const thresholds = useSimilarityThresholds();
  const decided = d.totals.approved + d.totals.review + d.totals.rejected;
  const avg = d.avgDocMatchSimilarity;
  const band = avg === null ? null : BAND_INFO[similarityBand(avg, thresholds)];
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} xl={6}>
        <StatCard
          to="/verifications"
          icon={<SafetyCertificateOutlined />}
          label="Verifications"
          value={formatNumber(d.totals.sessions)}
          hint={`${d.totals.inProgress} in progress · ${d.totals.expired} expired · last ${days} days`}
        />
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <StatCard
          icon={<CheckCircleOutlined />}
          tone="success"
          label="Approval rate"
          value={d.approvalRate === null ? '—' : formatPercent(d.approvalRate)}
          hint={`${formatNumber(d.totals.approved)} approved of ${formatNumber(decided)} decided`}
        />
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <StatCard
          to="/reviews"
          icon={<EyeOutlined />}
          tone={d.pendingReviews ? 'warning' : 'success'}
          label="Waiting for review"
          value={d.pendingReviews}
          note={d.pendingReviews ? 'Needs action' : 'All caught up'}
          noteTone={d.pendingReviews ? 'warning' : 'success'}
          hint="Open and in-review cases"
        />
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <StatCard
          icon={<UserOutlined />}
          label="Face match quality"
          value={band ? band.label : '—'}
          note={avg === null ? undefined : `${formatSimilarity(avg)} avg`}
          hint="Selfie vs document, passed matches"
        />
      </Col>
    </Row>
  );
}

function Outcomes({ d }: { d: Dashboard }) {
  const t = d.totals;
  const rows = [
    { key: 'approved', label: 'Approved', value: t.approved, color: TONE_HEX.processing },
    { key: 'review', label: 'Sent to review', value: t.review, color: TONE_HEX.warning },
    { key: 'rejected', label: 'Rejected', value: t.rejected, color: TONE_HEX.error },
    { key: 'expired', label: 'Expired or failed', value: t.expired + t.failed, color: TONE_HEX.default },
    { key: 'progress', label: 'In progress', value: t.inProgress, color: '#D0D5DD' },
  ];
  const total = Math.max(t.sessions, 1);
  return (
    <Card style={{ height: '100%' }}>
      <SectionTitle title="Outcomes" sub={`${formatNumber(t.sessions)} verifications`} />
      <Flex gap={2} style={{ height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 12, background: 'var(--ct-subtle)' }}>
        {rows.filter((r) => r.value > 0).map((r) => (
          <Tooltip key={r.key} title={`${r.label}: ${r.value}`}>
            <div style={{ flex: r.value, background: r.color }} />
          </Tooltip>
        ))}
      </Flex>
      {rows.map((r) => (
        <Flex key={r.key} align="center" gap={12} style={{ padding: '11px 0', borderBottom: '1px solid var(--ct-border-subtle)' }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: r.color }} />
          <span style={{ flex: 1, fontWeight: 600 }}>{r.label}</span>
          <span className="tabular ct-strong">{formatNumber(r.value)}</span>
          <span className="tabular ct-meta" style={{ width: 52, textAlign: 'right' }}>
            {Math.round((r.value / total) * 1000) / 10}%
          </span>
        </Flex>
      ))}
    </Card>
  );
}

function NeedsAttention() {
  const tenantCode = useTenantCode();
  const q = useQuery({ queryKey: ['review-cases', { status: 'OPEN', size: 6 }], queryFn: () => reviewsApi.list({ status: 'OPEN', size: 6 }) });
  return (
    <Card style={{ height: '100%' }} styles={{ body: { paddingBottom: 8 } }}>
      <SectionTitle
        title="Needs your attention"
        sub="Open review cases, oldest first"
        extra={
          <Link to="/reviews" style={{ fontWeight: 700 }}>
            Open review queue <ArrowRightOutlined />
          </Link>
        }
      />
      {q.isPending ? (
        <Skeleton active />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No open review cases. All caught up." />
      ) : (
        <Flex vertical>
          {[...q.data.items]
            .sort((a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf())
            .map((r) => (
              <Flex key={r.id} align="center" gap={14} wrap style={{ padding: '12px 0', borderTop: '1px solid var(--ct-border-subtle)' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <PersonCell name={r.partyName ?? 'Unknown person'} sub={`${tenantCode(r.tenantId)} · ${r.documentType ? docTypeLabel(r.documentType) : 'No document'}`} to={`/reviews/${r.id}`} />
                </div>
                <span className="ct-meta tabular" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ClockCircleOutlined /> <DateText value={r.createdAt} relative />
                </span>
                <Link to={`/reviews/${r.id}`}>
                  <Button>Review</Button>
                </Link>
              </Flex>
            ))}
        </Flex>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { values, set } = useSearchState(['days'] as const, { days: '14' });
  const days = Number(values.days) || 14;
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => dashboardApi.get(days) });
  // First name for people ("Sara Khan" -> Sara); generic account names stay whole.
  const parts = user?.displayName?.trim().split(/\s+/) ?? [];
  const firstName = parts.length > 1 && !parts[0].includes('-') ? parts[0] : user?.displayName;
  const pending = q.data?.pendingReviews ?? 0;

  return (
    <>
      <span className="ct-meta" style={{ fontWeight: 600 }}>{dayjs().format('dddd, D MMMM')}</span>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : 'Dashboard'}
        help={
          q.data
            ? pending
              ? `${pending} ${pending === 1 ? 'case is' : 'cases are'} waiting for review.`
              : 'No cases are waiting for review.'
            : 'How verifications are going, and what needs your attention.'
        }
        extra={
          <Segmented
            value={String(days)}
            onChange={(v) => set({ days: String(v) })}
            options={[
              { label: '7 days', value: '7' },
              { label: '14 days', value: '14' },
              { label: '30 days', value: '30' },
            ]}
          />
        }
      />
      <DataState query={q} rows={12}>
        {(d) => (
          <Flex vertical gap={16}>
            <Kpis d={d} days={days} />
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={16}>
                <Card style={{ height: '100%' }}>
                  <SectionTitle title="Verifications per day" sub={`Last ${days} days, by outcome`} />
                  <DailyChart daily={d.daily} />
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Outcomes d={d} />
              </Col>
            </Row>
            <Row gutter={[16, 16]}>
              <Col xs={24} xl={14}>
                <NeedsAttention />
              </Col>
              <Col xs={24} xl={10}>
                <Flex vertical gap={16} style={{ height: '100%' }}>
                  <Card>
                    <SectionTitle title="By flow" sub="Share of all verifications" />
                    <BarList total={d.totals.sessions} items={d.byFlow.map((f) => ({ key: f.flowCode, label: flowLabel(f.flowCode), value: f.count }))} />
                  </Card>
                  <Card>
                    <SectionTitle title="By channel" />
                    <BarList color={TONE_HEX.default} total={d.totals.sessions} items={d.byChannel.map((c) => ({ key: c.channel, label: channelLabel(c.channel), value: c.count }))} />
                  </Card>
                </Flex>
              </Col>
            </Row>
            <Card>
              <SectionTitle title="Most common reasons people fail" sub="Failed attempts in this period" />
              <BarList color={TONE_HEX.error} items={d.topFailureReasons.map((r) => ({ key: r.code, label: r.message, value: r.count }))} />
            </Card>
          </Flex>
        )}
      </DataState>
    </>
  );
}
