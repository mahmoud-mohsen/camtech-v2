import { LinkOutlined, StopOutlined } from '@ant-design/icons';
import type { TenantSessionDetail } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Empty, Flex, Tooltip, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DetailColumns, SummaryStrip } from '../../components/DetailLayout';
import { DateText } from '../../components/DateText';
import { IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { formatDuration } from '../../lib/format';
import { DecisionTag, DeliveryStatusTag, DocStatusTag, ReviewStatusTag, StatusTag } from '../../components/Tags';
import { qk, useApiMutation, useReasonMessage } from '../../lib/hooks';
import { channelLabel, docTypeLabel, flowLabel, humanize, webhookEventLabel } from '../../lib/labels';
import { DocumentNumber } from '../../components/DocumentNumber';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { StepTimeline } from './StepTimeline';

const OPEN = ['CREATED', 'IN_PROGRESS'];
/** Flows that never capture a document. */
const SELFIE_ONLY_FLOWS = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'];
/** Flows that can register the person's face for face authentication. */
const FACE_REGISTERING_FLOWS = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT'];

/** "Registered" / "Requested, not registered (…)" / "Not requested", from enrollFace and faceRegistered. */
function faceRegistrationText(s: TenantSessionDetail): string {
  if (s.faceRegistered) return 'Registered';
  if (!s.enrollFace) return 'Not requested (verify only)';
  if (s.decision === 'REVIEW') return 'Requested, not registered yet (waiting for the review)';
  if (OPEN.includes(s.status)) return 'Requested, not registered yet';
  return s.decision === 'REJECTED' ? 'Requested, not registered (rejected)' : 'Requested, not registered';
}

export function SummaryCard({ s }: { s: TenantSessionDetail }) {
  return (
    <Card title="Details">
      <Descriptions
        column={1}
        size="small"
        items={[
          { label: 'Flow', children: <span title={s.flowCode}>{flowLabel(s.flowCode)}</span> },
          { label: 'App', children: `${s.clientAppCode ?? '—'} · ${channelLabel(s.channel)}` },
          { label: 'Person', children: s.partyName ?? '—' },
          { label: 'Your user ref', children: s.subjectRef ? <IdText value={s.subjectRef} /> : '—' },
          { label: OPEN.includes(s.status) ? 'Expires' : 'Expired at', children: <DateText value={s.expiresAt} /> },
          { label: 'Finished', children: <DateText value={s.completedAt} /> },
          { label: 'Attempts', children: <span className="tabular">{s.livenessAttempts} selfie · {s.documentAttempts} document</span> },
          ...(FACE_REGISTERING_FLOWS.includes(s.flowCode) && s.enrollFace !== undefined ? [{ label: 'Face registration', children: faceRegistrationText(s) }] : []),
        ]}
      />
    </Card>
  );
}

export function DecisionCard({ s }: { s: TenantSessionDetail }) {
  const reason = useReasonMessage();
  const d = s.decisionDetail;
  return (
    <Card title="Decision">
      {!d ? (
        <Typography.Text type="secondary">No decision yet ({humanize(s.status).toLowerCase()}).</Typography.Text>
      ) : (
        <Descriptions
          column={1}
          size="small"
          items={[
            { label: 'Decision', children: <DecisionTag value={d.decision} /> },
            { label: 'Decided by', children: d.decidedBy === 'SYSTEM' ? 'Automatically (CamTech system)' : 'A reviewer' },
            {
              label: 'Reason',
              children: d.reason ? (
                <Tooltip title={d.reason}>
                  <span>{reason(d.reason) ?? humanize(d.reason)}</span>
                </Tooltip>
              ) : (
                '—'
              ),
            },
            { label: 'When', children: <DateText value={d.decidedAt} /> },
          ]}
        />
      )}
      {s.review && (
        <Alert
          style={{ marginTop: 12 }}
          type={s.review.status === 'OPEN' || s.review.status === 'IN_REVIEW' ? 'warning' : 'info'}
          showIcon
          title={
            <Flex gap={8} align="center" wrap>
              Manual review <ReviewStatusTag value={s.review.status} />
            </Flex>
          }
          description={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Opened <DateText value={s.review.openedAt} relative />
              {s.review.decidedAt ? (
                <>
                  {' '}
                  · decided <DateText value={s.review.decidedAt} relative />
                </>
              ) : (
                '. The final answer arrives with the REVIEW_DECIDED webhook.'
              )}
            </Typography.Text>
          }
        />
      )}
    </Card>
  );
}

export function DocumentCard({ s }: { s: TenantSessionDetail }) {
  const d = s.document;
  return (
    <Card title="Document">
      {!d ? (
        <Typography.Text type="secondary">{SELFIE_ONLY_FLOWS.includes(s.flowCode) ? `${flowLabel(s.flowCode)} uses no document.` : 'No document captured.'}</Typography.Text>
      ) : (
        <Descriptions
          column={1}
          size="small"
          items={[
            { label: 'Type', children: docTypeLabel(d.docTypeCode) },
            { label: 'Number', children: <DocumentNumber value={d.documentNumber} /> },
            { label: 'Issuing country', children: d.issuingCountry ?? '—' },
            { label: 'Expires', children: <DateText value={d.expiryDate} dateOnly /> },
            { label: 'Status', children: <DocStatusTag value={d.status} /> },
          ]}
        />
      )}
    </Card>
  );
}

function technicalItems(s: TenantSessionDetail) {
  const d = s.device;
  return [
    { label: 'Verification ID', value: <IdText value={s.publicId} /> },
    { label: 'App', value: s.clientAppCode && <span className="ct-mono">{s.clientAppCode}</span> },
    { label: 'Device', value: d ? [d.model, d.platform, d.osVersion].filter(Boolean).join(' · ') || null : 'The app sent no device details' },
    { label: 'App version', value: d?.appVersion },
  ];
}

function EventsCard({ s }: { s: TenantSessionDetail }) {
  const delivered = s.events.filter((e) => e.status === 'DELIVERED').length;
  return (
    <Card>
      <SectionTitle
        title="Notifications to your system"
        sub={s.events.length ? `${delivered} of ${s.events.length} delivered` : undefined}
        extra={
          <Link to="/webhooks" style={{ fontWeight: 700 }}>
            Webhooks
          </Link>
        }
      />
      {s.events.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No events yet" />
      ) : (
        <Flex vertical>
          {s.events.map((e) => (
            <Flex key={`${e.eventType}-${e.createdAt}`} align="center" gap={12} style={{ padding: '10px 0', borderTop: '1px solid var(--ct-border-subtle)' }}>
              <span style={{ flex: 1, fontWeight: 600 }} title={e.eventType}>
                {webhookEventLabel(e.eventType)}
              </span>
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

export default function VerificationDetailPage() {
  const { publicId = '' } = useParams();
  const q = useQuery({
    queryKey: qk.session(publicId),
    queryFn: () => api.session(publicId),
    // Keep an open verification fresh while someone watches it.
    refetchInterval: (query) => (query.state.data && OPEN.includes(query.state.data.status) ? 5000 : false),
  });
  const { canReview } = usePermissions();
  const { message } = App.useApp();
  const cancel = useApiMutation(() => api.cancelSession(publicId), {
    success: 'Verification cancelled',
    invalidate: [qk.session(publicId), ['sessions'], ['dashboard']],
  });

  return (
    <DataState query={q} rows={12}>
      {(s) => (
        <>
          <PageHeader
            crumbs={[{ label: 'Verifications', to: '/verifications' }, { label: s.partyName ?? flowLabel(s.flowCode) }]}
            avatar={<PersonAvatar name={s.partyName ?? flowLabel(s.flowCode)} size={56} org={!s.partyName || s.flowCode === 'BUSINESS_VERIFICATION'} />}
            title={s.partyName ?? flowLabel(s.flowCode)}
            documentTitle={`Verification ${s.publicId.slice(0, 8)}`}
            tags={s.decision ? <DecisionTag value={s.decision} /> : <StatusTag value={s.status} />}
            help={s.subjectRef ? `Your ref ${s.subjectRef}` : undefined}
            extra={
              <>
              <Button icon={<LinkOutlined />} onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => message.success('Link copied'))}>
                Copy link
              </Button>
              {canReview && OPEN.includes(s.status) && (
                <ConfirmAction
                  danger
                  label="Cancel verification"
                  buttonProps={{ icon: <StopOutlined /> }}
                  title="Cancel this verification?"
                  description="The person won't be able to continue it and your webhook receives SESSION_COMPLETED with status CANCELLED. This can't be undone."
                  okText="Cancel verification"
                  onConfirm={() => cancel.mutateAsync(undefined)}
                />
              )}
              </>
            }
          />
          <SummaryStrip
            items={[
              { label: 'Flow', value: flowLabel(s.flowCode) },
              { label: 'App', value: [s.clientAppCode, channelLabel(s.channel)].filter(Boolean).join(' · ') },
              { label: 'Started', value: <DateText value={s.createdAt} relative /> },
              { label: 'Took', value: s.completedAt ? formatDuration(s.createdAt, s.completedAt) : 'Not finished' },
              { label: 'Attempts', value: <span className="tabular">{s.livenessAttempts} selfie · {s.documentAttempts} document</span> },
            ]}
          />
          <DetailColumns
            sideFirst
            main={
              <>
                <Card>
                  <SectionTitle title="What happened, step by step" sub="Including what the person was asked to fix" />
                  <StepTimeline steps={s.steps} />
                </Card>
                <EventsCard s={s} />
              </>
            }
            side={
              <>
                <DecisionCard s={s} />
                <DocumentCard s={s} />
                <SummaryCard s={s} />
                <TechnicalDetails items={technicalItems(s)} summary="Verification ID, app and device" />
              </>
            }
          />
        </>
      )}
    </DataState>
  );
}
