import {
  CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, ExclamationCircleFilled, LinkOutlined, MinusCircleOutlined, StopOutlined,
  SyncOutlined, UserOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Descriptions, Empty, Flex, Row, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { documentsApi, sessionsApi } from '../../api/operations';
import type { SessionDetail, Step } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { DocumentFieldsTable } from '../../components/DocumentFields';
import { FaceComparison } from '../../components/FaceComparison';
import { IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { DecisionTag, DeliveryStatusTag, DocStatusTag, ReviewStatusTag, StatusTag } from '../../components/Tags';
import { AttemptTimeline } from '../../components/Timeline';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { formatDuration, formatSimilarity } from '../../lib/format';
import { useApiMutation, useReasonMessage } from '../../lib/hooks';
import { channelLabel, docTypeLabel, flowLabel, NO_DOCUMENT_FLOWS, STEP_STATUS_LABELS, stepLabel, webhookEventLabel } from '../../lib/labels';

/** Whether the session registers the person's face (face registration, or a selfie ID verification asked to). */
function FaceRegistration({ s }: { s: SessionDetail }) {
  if (s.faceRegistered) return <Tag color="success" variant="filled" className="ct-pill">Registered</Tag>;
  if (!s.enrollFace) return <Typography.Text type="secondary">Not requested</Typography.Text>;
  if (s.decision?.decision === 'REVIEW') return <Tag color="warning" variant="filled" className="ct-pill">Waiting for the review</Tag>;
  return <Tag variant="filled" className="ct-pill">Requested, not registered</Tag>;
}

const STEP_ICON: Record<Step['status'], { icon: React.ReactNode; color: string }> = {
  PASSED: { icon: <CheckCircleFilled />, color: 'var(--ct-success)' },
  FAILED: { icon: <CloseCircleFilled />, color: 'var(--ct-error)' },
  REVIEW: { icon: <ExclamationCircleFilled />, color: 'var(--ct-warning)' },
  IN_PROGRESS: { icon: <SyncOutlined spin />, color: 'var(--ct-brand)' },
  PENDING: { icon: <ClockCircleOutlined />, color: 'var(--ct-text-tertiary)' },
  SKIPPED: { icon: <MinusCircleOutlined />, color: 'var(--ct-text-tertiary)' },
};

/** One card per step type, showing how its latest attempt ended. */
function CheckSummary({ steps }: { steps: Step[] }) {
  const byCode = new Map<string, Step[]>();
  for (const st of steps) byCode.set(st.stepCode, [...(byCode.get(st.stepCode) ?? []), st]);
  if (byCode.size === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
      {[...byCode.entries()].map(([code, attempts]) => {
        const last = attempts.reduce((a, b) => (b.attemptNo > a.attemptNo ? b : a));
        const ic = STEP_ICON[last.status];
        return (
          <div key={code}>
            <div style={{ height: '100%', padding: 20, borderRadius: 14, border: '1px solid var(--ct-border)', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
              <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
                <span style={{ color: ic.color, fontSize: 16, display: 'inline-flex' }}>{ic.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ct-text-secondary)' }}>{stepLabel(code)}</span>
              </Flex>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ct-heading)' }}>{STEP_STATUS_LABELS[last.status] ?? last.status}</div>
              <div className="ct-meta" style={{ marginTop: 4 }}>
                {last.reasonMessage ?? (attempts.length === 1 ? 'First attempt' : `${attempts.length} attempts`)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecisionCard({ s }: { s: SessionDetail }) {
  const reason = useReasonMessage();
  const d = s.decision;
  const tone = !d ? null : d.decision === 'APPROVED' ? 'success' : d.decision === 'REJECTED' ? 'error' : 'warning';
  return (
    <Card>
      <SectionTitle title="Decision" />
      {!d ? (
        <Typography.Text type="secondary">
          No decision yet. The verification is <StatusTag value={s.status} />
        </Typography.Text>
      ) : (
        <Flex vertical gap={12}>
          <div style={{ padding: 14, borderRadius: 12, background: `var(--ct-${tone}-soft)` }}>
            <Flex align="center" gap={8} style={{ marginBottom: 4 }}>
              <DecisionTag value={d.decision} />
              <span className="ct-strong">{d.decidedBy === 'SYSTEM' ? 'Decided automatically' : `By ${d.decidedByUser ?? 'a reviewer'}`}</span>
            </Flex>
            <div>{d.reason ? (reason(d.reason) ?? d.reason) : 'All checks passed.'}</div>
          </div>
          <span className="ct-meta">
            <DateText value={d.decidedAt} />
          </span>
        </Flex>
      )}
      {s.reviewCase && (
        <Alert
          style={{ marginTop: 12 }}
          type={s.reviewCase.status === 'OPEN' || s.reviewCase.status === 'IN_REVIEW' ? 'warning' : 'info'}
          showIcon
          title={
            <Flex justify="space-between" align="center" gap={8} wrap>
              <span>
                Review case <ReviewStatusTag value={s.reviewCase.status} />
              </span>
              <Link to={`/reviews/${s.reviewCase.id}`} style={{ fontWeight: 700 }}>
                Open review case
              </Link>
            </Flex>
          }
        />
      )}
    </Card>
  );
}

function Overview({ s }: { s: SessionDetail }) {
  return (
    <Card>
      <SectionTitle title="Details" />
      <Descriptions
        column={1}
        size="small"
        items={[
          {
            label: 'Person',
            children: s.partyId ? <Link to={`/people/${s.partyId}`}>{s.partyName ?? 'Open person'}</Link> : (s.partyName ?? '—'),
          },
          { label: 'Customer ref', children: s.subjectRef ?? '—' },
          { label: 'Flow', children: flowLabel(s.flowCode) },
          { label: 'Channel', children: channelLabel(s.channel) },
          { label: 'Expires', children: <DateText value={s.expiresAt} /> },
          { label: 'Attempts', children: <span className="tabular">{s.livenessAttempts} selfie · {s.documentAttempts} document</span> },
          ...(s.enrollFace !== undefined || s.faceRegistered !== undefined ? [{ label: 'Face registration', children: <FaceRegistration s={s} /> }] : []),
        ]}
      />
    </Card>
  );
}

function DocumentCard({ s }: { s: SessionDetail }) {
  const d = s.document;
  const detail = useQuery({ queryKey: ['document', d?.id], queryFn: () => documentsApi.get(d!.id), enabled: !!d });
  return (
    <Card>
      <SectionTitle
        title={d ? `Read from the ${docTypeLabel(d.docTypeCode)}` : 'Document'}
        extra={d && <DocStatusTag value={d.status} />}
      />
      {!d ? (
        <Typography.Text type="secondary">
          {NO_DOCUMENT_FLOWS.includes(s.flowCode) ? 'This flow has no document: only selfies are taken.' : 'No document captured.'}
        </Typography.Text>
      ) : (
        <>
          <Descriptions
            column={1}
            size="small"
            items={[
              { label: 'Number', children: <span className="tabular">{d.documentNumber ?? '—'}</span> },
              { label: 'Issued by', children: d.issuerCode ?? '—' },
              { label: 'Expires', children: <DateText value={d.expiryDate} dateOnly /> },
            ]}
          />
          {detail.data && <DocumentFieldsTable fields={detail.data.fields} compact />}
          <Link to={`/documents/${d.id}`} style={{ display: 'inline-block', marginTop: 12, fontWeight: 700 }}>
            Open document
          </Link>
        </>
      )}
    </Card>
  );
}

function EventsCard({ s }: { s: SessionDetail }) {
  const delivered = s.events.filter((e) => e.status === 'DELIVERED').length;
  return (
    <Card>
      <SectionTitle title="Notifications" sub={s.events.length ? `${delivered} of ${s.events.length} delivered to the client's system` : undefined} />
      {s.events.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications sent" />
      ) : (
        <Flex vertical>
          {s.events.map((e) => (
            <Flex key={`${e.eventType}-${e.createdAt}`} align="center" gap={12} style={{ padding: '10px 0', borderTop: '1px solid var(--ct-border-subtle)' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{webhookEventLabel(e.eventType)}</span>
              <span className="ct-meta">
                <DateText value={e.createdAt} relative />
              </span>
              <DeliveryStatusTag value={e.status} />
            </Flex>
          ))}
        </Flex>
      )}
    </Card>
  );
}

function technicalItems(s: SessionDetail) {
  const d = s.device;
  return [
    { label: 'Verification ID', value: <IdText value={s.publicId} /> },
    { label: 'Client app', value: <span className="ct-mono">{s.clientAppCode}</span> },
    { label: 'Face match score', value: s.finalSimilarity === null ? null : <span className="tabular">{formatSimilarity(s.finalSimilarity)}</span> },
    { label: 'Device', value: d ? [d.model, d.platform, d.osVersion, d.appVersion && `app ${d.appVersion}`].filter(Boolean).join(' · ') : 'No device registered (web)' },
    { label: 'Attestation', value: d?.attestationStatus },
    { label: 'Device ref', value: d ? <IdText value={d.deviceRef} /> : null },
    { label: 'IP address', value: s.ipAddress && <span className="ct-mono">{s.ipAddress}</span> },
    { label: 'User agent', value: s.userAgent && <span className="ct-mono">{s.userAgent}</span> },
  ];
}

export default function SessionDetailPage() {
  const { publicId = '' } = useParams();
  const { canReview } = usePermissions();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: ['session', publicId], queryFn: () => sessionsApi.get(publicId) });
  const cancel = useApiMutation(() => sessionsApi.cancel(publicId), {
    success: 'Verification cancelled',
    invalidate: [['session', publicId], ['sessions'], ['dashboard']],
  });
  const s = q.data;
  const cancellable = s && (s.status === 'CREATED' || s.status === 'IN_PROGRESS');
  const name = s ? (s.partyName ?? 'Unknown person') : 'Verification';
  const took = s ? formatDuration(s.createdAt, s.completedAt) : '';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Verifications', to: '/verifications' }, { label: name }]}
        avatar={s && <PersonAvatar name={s.partyName} size={56} org={s.flowCode === 'BUSINESS_VERIFICATION'} />}
        title={name}
        tags={s && (s.decision ? <DecisionTag value={s.decision.decision} /> : <StatusTag value={s.status} />)}
        help={
          s && (
            <Flex vertical gap={2} component="span">
              <span>
                {flowLabel(s.flowCode)} · {channelLabel(s.channel)}
                {s.subjectRef ? ` · Customer ref ${s.subjectRef}` : ''}
              </span>
              <span className="ct-meta">
                Started <DateText value={s.createdAt} />
                {took ? ` · finished in ${took}` : ''}
              </span>
            </Flex>
          )
        }
        extra={
          s && (
            <>
              <Button
                icon={<LinkOutlined />}
                onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => message.success('Link copied'))}
              >
                Copy link
              </Button>
              {s.partyId && (
                <Link to={`/people/${s.partyId}`}>
                  <Button icon={<UserOutlined />}>Open person</Button>
                </Link>
              )}
              {s.reviewCase && (s.reviewCase.status === 'OPEN' || s.reviewCase.status === 'IN_REVIEW') && (
                <Link to={`/reviews/${s.reviewCase.id}`}>
                  <Button type="primary">Review now</Button>
                </Link>
              )}
              {canReview && cancellable && (
                <ConfirmAction
                  danger
                  label="Cancel verification"
                  buttonProps={{ icon: <StopOutlined /> }}
                  title="Cancel this verification?"
                  description="The person won't be able to continue this session. They will have to start a new verification. This can't be undone."
                  okText="Cancel verification"
                  onConfirm={() => cancel.mutateAsync(undefined)}
                />
              )}
            </>
          )
        }
      />
      <DataState query={q} rows={14}>
        {(s) => (
          <Flex vertical gap={24}>
            <CheckSummary steps={s.steps} />
            <Row gutter={[24, 24]}>
              <Col xs={24} xl={15}>
                <Flex vertical gap={24}>
                  <FaceComparison session={s} title="Evidence" />
                  <Card>
                    <SectionTitle title="What happened, step by step" sub={`${s.steps.length} attempts`} />
                    <AttemptTimeline steps={s.steps} />
                  </Card>
                </Flex>
              </Col>
              <Col xs={24} xl={9}>
                <Flex vertical gap={24}>
                  <DecisionCard s={s} />
                  <DocumentCard s={s} />
                  <Overview s={s} />
                  <EventsCard s={s} />
                  <TechnicalDetails items={technicalItems(s)} summary="Verification ID, device, network and score" />
                </Flex>
              </Col>
            </Row>
          </Flex>
        )}
      </DataState>
    </>
  );
}
