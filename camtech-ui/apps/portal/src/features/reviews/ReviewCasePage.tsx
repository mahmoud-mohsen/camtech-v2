import { CheckOutlined, CloseOutlined, CommentOutlined, UserAddOutlined } from '@ant-design/icons';
import type { ReviewCaseDetail, ReviewDecisionRequest } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Flex, Input, Popconfirm, Timeline, Typography } from 'antd';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImageGallery } from '../../components/AuthImage';
import { DataState, ErrorState } from '../../components/DataState';
import { DetailColumns, SummaryStrip } from '../../components/DetailLayout';
import { DateText } from '../../components/DateText';
import { IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { MatchLabelTag, ReviewStatusTag } from '../../components/Tags';
import { t } from '../../i18n';
import { qk, useApiMutation } from '../../lib/hooks';
import { docTypeLabel, mediaRoleLabel, reviewActionLabel, stepLabel } from '../../lib/labels';
import type { GalleryItem } from '../../lib/media';
import { api } from '../../api/client';
import { useAuth, usePermissions } from '../../auth/useAuth';
import { StepTimeline } from '../verifications/StepTimeline';
import { DecisionCard, DocumentCard, SummaryCard } from '../verifications/VerificationDetailPage';
import { CamtechReviewsBanner } from './CamtechReviewsBanner';
import { asQueue, useCaseQueue, type QueuePosition } from './queue';
import { AfterDecisionHint, QueueNav } from './QueueNav';

const ACTION_COLOR: Record<string, string> = { OPENED: 'gray', ASSIGNED: 'blue', COMMENTED: 'gray', APPROVED: 'green', REJECTED: 'red' };

/** Selfie first, then the document images. */
function evidenceItems(c: ReviewCaseDetail): GalleryItem[] {
  const order = (role: string) => (role.startsWith('SELFIE') ? 0 : 1);
  return [...c.evidence]
    .sort((a, b) => order(a.role) - order(b.role))
    .map((e) => ({
      key: `case-${c.id}-media-${e.mediaId}`,
      label: `${mediaRoleLabel(e.role)} · ${stepLabel(e.stepCode)}`,
      load: (signal: AbortSignal) => api.reviewCaseMedia(c.id, e.mediaId, signal),
    }));
}

/** Assign, comment and decide; a decision moves on to the next case of the queue. */
function DecideCard({ c, queue }: { c: ReviewCaseDetail; queue: QueuePosition | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  /** Captured when deciding: the queue list refreshes (without this case) right after. */
  const goTo = useRef<string | null>(null);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const onDone = (r: ReviewCaseDetail) => {
    qc.setQueryData(qk.reviewCase(c.id), r);
    void qc.invalidateQueries({ queryKey: ['review-cases'] });
    void qc.invalidateQueries({ queryKey: qk.reviewSummary });
    void qc.invalidateQueries({ queryKey: qk.session(c.sessionPublicId) });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const assign = useApiMutation(() => api.assignReviewCase(c.id), { success: t('case.assigned'), onSuccess: onDone });
  const addComment = useApiMutation((text: string) => api.commentReviewCase(c.id, text), {
    success: t('case.commented'),
    onSuccess: (r) => {
      setComment('');
      onDone(r);
    },
  });
  const decide = useApiMutation(
    (body: ReviewDecisionRequest) => {
      goTo.current = queue?.afterDecision ?? null;
      return api.decideReviewCase(c.id, body);
    },
    {
      success: (r) => (r.status === 'APPROVED' ? t('case.approved') : t('case.rejected')),
      onSuccess: (r) => {
        onDone(r);
        navigate(goTo.current ?? '/reviews?tab=verifications');
      },
    },
  );
  const noteText = note.trim();
  const mine = c.assignedTo === user?.username;

  return (
    <Card>
      <SectionTitle
        title={t('case.decide')}
        extra={
          !mine && (
            <Button size="small" icon={<UserAddOutlined />} loading={assign.isPending} onClick={() => assign.mutate(undefined)}>
              {t('case.assignMe')}
            </Button>
          )
        }
      />
      <Flex gap={8} style={{ marginBottom: 12 }}>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('case.comment.placeholder')}
          aria-label={t('case.comment')}
          maxLength={2000}
          onPressEnter={() => comment.trim() && addComment.mutate(comment.trim())}
        />
        <Button icon={<CommentOutlined />} disabled={!comment.trim()} loading={addComment.isPending} onClick={() => addComment.mutate(comment.trim())}>
          {t('case.comment')}
        </Button>
      </Flex>
      <Input.TextArea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('case.note')}
        aria-label={t('case.note')}
        maxLength={1000}
        autoSize={{ minRows: 2, maxRows: 5 }}
      />
      <Flex gap={8} justify="flex-end" align="center" wrap className="ct-sticky-actions ct-pinned">
        <span style={{ flex: '1 1 100%' }}>
          <AfterDecisionHint queue={queue} />
        </span>
        <Popconfirm
          title={t('case.reject.confirm')}
          description={t('case.decide.body')}
          okText={t('case.reject')}
          okButtonProps={{ danger: true }}
          onConfirm={() => decide.mutate({ decision: 'REJECTED', note: noteText })}
          disabled={!noteText}
        >
          <Button danger icon={<CloseOutlined />} disabled={!noteText} title={noteText ? undefined : t('case.noteRequired')} loading={decide.isPending && decide.variables?.decision === 'REJECTED'}>
            {t('case.reject')}
          </Button>
        </Popconfirm>
        <Popconfirm
          title={t('case.approve.confirm')}
          description={t('case.decide.body')}
          okText={t('case.approve')}
          onConfirm={() => decide.mutate({ decision: 'APPROVED', note: noteText })}
          disabled={!noteText}
        >
          <Button type="primary" icon={<CheckOutlined />} disabled={!noteText} title={noteText ? undefined : t('case.noteRequired')} loading={decide.isPending && decide.variables?.decision === 'APPROVED'}>
            {t('case.approve')}
          </Button>
        </Popconfirm>
      </Flex>
    </Card>
  );
}

function HistoryCard({ c }: { c: ReviewCaseDetail }) {
  return (
    <Card>
      <SectionTitle title={t('case.history')} />
      <Timeline
        style={{ paddingTop: 8 }}
        items={c.actions.map((a) => ({
          key: a.id,
          color: ACTION_COLOR[a.action] ?? 'gray',
          content: (
            <div>
              <Flex gap={8} wrap align="baseline">
                <Typography.Text strong>{reviewActionLabel(a.action)}</Typography.Text>
                <Typography.Text type="secondary">{a.actor}</Typography.Text>
                <span className="ct-meta">
                  <DateText value={a.createdAt} relative />
                </span>
              </Flex>
              {a.note && <Typography.Paragraph style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{a.note}</Typography.Paragraph>}
            </div>
          ),
        }))}
      />
    </Card>
  );
}

export default function ReviewCasePage() {
  const { id = '' } = useParams();
  const numeric = Number(id);
  const valid = Number.isInteger(numeric) && numeric > 0;
  const q = useQuery({ queryKey: qk.reviewCase(numeric), queryFn: () => api.reviewCase(numeric), enabled: valid });
  const { canReview } = usePermissions();
  const queueName = asQueue(useSearchParams()[0].get('queue'));
  const queue = useCaseQueue(numeric, queueName);
  if (!valid) return <ErrorState error={new Error('This review case id is not valid.')} />;
  return (
    <DataState query={q} rows={12}>
      {(c) => {
        const closed = c.status === 'APPROVED' || c.status === 'REJECTED';
        return (
          <>
            <PageHeader
              crumbs={[
                { label: t('reviews.title'), to: `/reviews?tab=verifications${queueName === 'OPEN' ? '' : `&queue=${queueName}`}` },
                { label: c.partyName ?? t('case.title', { id: c.id }) },
              ]}
              extra={<QueueNav queue={queue} />}
              avatar={<PersonAvatar name={c.partyName ?? t('case.title', { id: c.id })} size={56} org={!c.partyName} />}
              title={c.partyName ?? t('case.title', { id: c.id })}
              documentTitle={t('case.title', { id: c.id })}
              tags={
                <Flex gap={6}>
                  <ReviewStatusTag value={c.status} />
                  <MatchLabelTag value={c.matchLabel} />
                </Flex>
              }
              help={
                <>
                  {t('reviews.col.created')} <DateText value={c.createdAt} relative /> ·{' '}
                  <Link to={`/verifications/${c.sessionPublicId}`} style={{ fontWeight: 700 }}>
                    {t('case.openVerification')}
                  </Link>
                </>
              }
            />
            <CamtechReviewsBanner />
            <SummaryStrip
              items={[
                { label: t('reviews.col.reason'), value: c.reason ?? '—' },
                { label: t('reviews.col.docType'), value: c.documentType ? docTypeLabel(c.documentType) : '—' },
                { label: t('reviews.col.assigned'), value: c.assignedTo ?? '—' },
              ]}
            />
            <DetailColumns
              main={
                <>
                  <Card>
                    <SectionTitle title={t('case.evidence')} sub={c.evidence.length > 0 ? t('case.evidence.help') : undefined} />
                    {c.evidence.length > 0 ? (
                      <ImageGallery items={evidenceItems(c)} height={300} minWidth={240} />
                    ) : (
                      <Typography.Text type="secondary">{t('case.evidence.none')}</Typography.Text>
                    )}
                  </Card>
                  <Card>
                    <SectionTitle title={t('case.steps')} />
                    <StepTimeline steps={c.session.steps} />
                  </Card>
                  <HistoryCard c={c} />
                </>
              }
              side={
                <>
                  {c.canDecide && canReview && <DecideCard key={c.id} c={c} queue={queue} />}
                  {c.canDecide && !canReview && <Alert type="info" showIcon title={t('case.noPermission')} />}
                  {closed && <Alert type="success" showIcon title={t('case.closed')} />}
                  <DecisionCard s={c.session} />
                  <SummaryCard s={c.session} />
                  <DocumentCard s={c.session} />
                  <TechnicalDetails
                    items={[
                      { label: 'Review case', value: <IdText value={c.id} /> },
                      { label: 'Verification ID', value: <IdText value={c.sessionPublicId} /> },
                    ]}
                    summary="Review case and verification IDs"
                  />
                </>
              }
            />
          </>
        );
      }}
    </DataState>
  );
}
