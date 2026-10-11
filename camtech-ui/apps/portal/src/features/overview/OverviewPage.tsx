import { ArrowRightOutlined, ExperimentOutlined } from '@ant-design/icons';
import type { TenantDashboard } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Flex, Row, Segmented, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataState } from '../../components/DataState';
import { BarList } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { SectionTitle } from '../../components/ui';
import { TONE_HEX } from '../../lib/colors';
import { dayjs, formatPercent } from '../../lib/format';
import { t } from '../../i18n';
import { qk } from '../../lib/hooks';
import { channelLabel, flowLabel } from '../../lib/labels';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { useTenantInfo } from '../../auth/useAuth';
import { AttentionCard } from './AttentionCard';
import { DailyChart } from './DailyChart';
import { GetStarted } from './GetStarted';
import { UsageCard } from './UsageCard';

const DAY_OPTIONS = ['7', '14', '30', '90'];
const n = (v: number) => v.toLocaleString('en');

function HeroTile({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  const body = (
    <Flex vertical gap={4} style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.08)', height: '100%' }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>{label}</span>
      <span className="tabular" style={{ fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>
        {value}
      </span>
    </Flex>
  );
  return to ? (
    <Link to={to} style={{ display: 'block', height: '100%' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

/** Navy summary panel: total volume with the headline rates beside it. */
function Hero({ d }: { d: TenantDashboard }) {
  const decided = d.totals.approved + d.totals.review + d.totals.rejected;
  const done = Math.max(d.totals.sessions, 1);
  return (
    <div style={{ padding: 28, borderRadius: 16, background: 'var(--ct-hero)', color: '#FFFFFF' }}>
      <Row gutter={[32, 24]} align="middle">
        <Col xs={24} lg={12}>
          <Flex vertical gap={12}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>Verifications in the last {d.days} days</span>
            <Flex align="baseline" gap={12} wrap>
              <Link to="/verifications" className="tabular" style={{ fontSize: 44, lineHeight: '52px', fontWeight: 800, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                {n(d.totals.sessions)}
              </Link>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.75)' }}>
                {n(d.totals.inProgress)} open · {n(d.totals.expired)} expired · {n(d.totals.failed)} failed
              </span>
            </Flex>
            <Flex gap={2} style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.16)' }} aria-hidden>
              <div style={{ flex: d.totals.approved, background: '#84CAFF' }} />
              <div style={{ flex: d.totals.review, background: TONE_HEX.warning }} />
              <div style={{ flex: d.totals.rejected, background: '#F97066' }} />
              <div style={{ flex: Math.max(0, done - decided), background: 'transparent' }} />
            </Flex>
            <Flex gap={16} wrap style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
              <span>
                <b className="tabular">{n(d.totals.approved)}</b> approved
              </span>
              <span>
                <b className="tabular">{n(d.totals.review)}</b> in review
              </span>
              <span>
                <b className="tabular">{n(d.totals.rejected)}</b> rejected
              </span>
            </Flex>
          </Flex>
        </Col>
        <Col xs={24} lg={12}>
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <HeroTile label="Approval rate" value={d.approvalRate === null ? '—' : formatPercent(d.approvalRate)} to="/verifications?decision=APPROVED" />
            </Col>
            <Col span={12}>
              <HeroTile label="Waiting for review" value={n(d.pendingReviews)} to="/reviews?tab=verifications" />
            </Col>
            <Col span={12}>
              <HeroTile label="Rejected" value={n(d.totals.rejected)} to="/verifications?decision=REJECTED" />
            </Col>
            <Col span={12}>
              <HeroTile label="Document scans" value={n(d.scans)} to="/scans" />
            </Col>
          </Row>
        </Col>
      </Row>
    </div>
  );
}

function Breakdowns({ d }: { d: TenantDashboard }) {
  const from = dayjs().subtract(d.days - 1, 'day').format('YYYY-MM-DD');
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12}>
        <Card style={{ height: '100%' }}>
          <SectionTitle
            title="Why people fail"
            sub="Most common reasons, by failed attempts"
            extra={
              d.topFailureReasons.length > 0 && (
                <Link to="/guide?tab=reasons" style={{ fontWeight: 700 }}>
                  What end users see <ArrowRightOutlined />
                </Link>
              )
            }
          />
          <BarList
            color={TONE_HEX.error}
            items={d.topFailureReasons.map((r) => ({
              key: r.code,
              label: (
                <Link to={`/verifications?decision=REJECTED&from=${from}`} title={t('overview.reasons.link')}>
                  {r.message}
                </Link>
              ),
              value: r.count,
            }))}
          />
        </Card>
      </Col>
      <Col xs={24} md={12} xl={6}>
        <Card style={{ height: '100%' }}>
          <SectionTitle title="By flow" />
          <BarList
            total={d.totals.sessions}
            items={d.byFlow.map((f) => ({ key: f.flowCode, label: <Link to={`/verifications?flowCode=${f.flowCode}&from=${from}`}>{flowLabel(f.flowCode)}</Link>, value: f.count }))}
          />
        </Card>
      </Col>
      <Col xs={24} md={12} xl={6}>
        <Flex vertical gap={16} style={{ height: '100%' }}>
          <Card>
            <SectionTitle title="By channel" />
            <BarList
              color={TONE_HEX.default}
              total={d.totals.sessions}
              items={d.byChannel.map((c) => ({ key: c.channel, label: <Link to={`/verifications?channel=${c.channel}&from=${from}`}>{channelLabel(c.channel)}</Link>, value: c.count }))}
            />
          </Card>
          <Card style={{ flex: 1 }}>
            <SectionTitle title="By app" />
            <BarList color={TONE_HEX.default} total={d.totals.sessions} items={d.byClientApp.map((c) => ({ key: c.clientAppCode, label: c.clientAppCode, value: c.count }))} />
          </Card>
        </Flex>
      </Col>
    </Row>
  );
}

export default function OverviewPage() {
  const info = useTenantInfo();
  const { values, set } = useSearchState(['days'] as const, { days: '14' });
  const days = DAY_OPTIONS.includes(values.days ?? '') ? Number(values.days) : 14;
  const q = useQuery({ queryKey: qk.dashboard(days), queryFn: () => api.dashboard(days) });
  // Any verification ever? (the dashboard only covers the selected window)
  const anySession = useQuery({ queryKey: qk.sessions({ page: 0, size: 1 }), queryFn: () => api.sessions({ page: 0, size: 1 }) });
  const empty = anySession.data?.total === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        help={`How verifications are going for ${info.name}.`}
        extra={
          <>
            <Segmented value={String(days)} onChange={(v) => set({ days: String(v) })} options={DAY_OPTIONS.map((d) => ({ label: `${d} days`, value: d }))} />
            <Link to="/playground">
              <Button icon={<ExperimentOutlined />}>Try the playground</Button>
            </Link>
          </>
        }
      />
      <Flex vertical gap={16}>
        {anySession.isPending ? null : empty && <GetStarted hasSessions={false} />}
        <DataState
          query={q}
          skeleton={
            <Flex vertical gap={16}>
              <Card>
                <Skeleton active paragraph={{ rows: 3 }} />
              </Card>
              <Card>
                <Skeleton active paragraph={{ rows: 8 }} />
              </Card>
            </Flex>
          }
        >
          {(d) => (
            <Flex vertical gap={16}>
              <Hero d={d} />
              {d.attention && <AttentionCard attention={d.attention} />}
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={16}>
                  <Card style={{ height: '100%' }}>
                    <SectionTitle title="Verifications per day" sub="By decision" />
                    <DailyChart daily={d.daily} />
                  </Card>
                </Col>
                <Col xs={24} xl={8}>
                  <UsageCard />
                </Col>
              </Row>
              <Breakdowns d={d} />
            </Flex>
          )}
        </DataState>
      </Flex>
    </>
  );
}
