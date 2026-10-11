import { CheckOutlined, CloseOutlined, LeftOutlined, MessageOutlined, RightOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Flex, Input, Modal, Row, Tag, Timeline, Typography } from 'antd';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { documentsApi, reviewsApi } from '../../api/operations';
import type { ReviewCaseDetail, SessionDetail } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { FaceComparison } from '../../components/FaceComparison';
import { PageHeader } from '../../components/PageHeader';
import { ReviewStatusTag } from '../../components/Tags';
import { PersonAvatar } from '../../components/ui';
import { AttemptTimeline } from '../../components/Timeline';
import { TONE_HEX } from '../../lib/colors';
import { useApiMutation, useReasonMessage } from '../../lib/hooks';
import { channelLabel, docTypeLabel, fieldLabel, flowLabel, NO_DOCUMENT_FLOWS, REVIEW_ACTION_LABELS, stepLabel } from '../../lib/labels';
import { duplicateMatch } from '../../lib/session';

/** True when a key press happens inside a text field or with a modifier (shortcuts stay out of the way). */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return e.ctrlKey || e.metaKey || e.altKey || !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

/** Approving registers the face: face registration, or a selfie ID verification asked to register it. */
const registersFace = (s: SessionDetail) => s.flowCode === 'FACE_ENROLLMENT' || !!s.enrollFace;
/** No document to compare with: the case is about a face that matched someone else's registered face. */
const isDuplicateCase = (s: SessionDetail) => !s.document && duplicateMatch(s) !== null;

const KEY_FIELDS = ['FULL_NAME', 'FULL_NAME_AR', 'ID_NUMBER', 'DOCUMENT_NUMBER', 'DATE_OF_BIRTH', 'NATIONALITY', 'GENDER', 'EXPIRY_DATE'];

function KeyFacts({ c }: { c: ReviewCaseDetail }) {
  const s = c.session;
  const doc = useQuery({ queryKey: ['document', s.document?.id], queryFn: () => documentsApi.get(s.document!.id), enabled: !!s.document });
  const failed = s.steps.filter((x) => x.status === 'FAILED');
  const fields = (doc.data?.fields ?? []).filter((f) => KEY_FIELDS.includes(f.fieldCode));
  return (
    <Card title="Key facts">
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: 'Flow', children: `${flowLabel(s.flowCode)} · ${channelLabel(s.channel)}` },
          {
            label: 'Document',
            children: s.document
              ? `${docTypeLabel(s.document.docTypeCode)} · ${s.document.documentNumber ?? ''}`
              : NO_DOCUMENT_FLOWS.includes(s.flowCode)
                ? 'None (selfie only)'
                : '—',
          },
          ...(registersFace(s) ? [{ label: 'Face registration', children: s.faceRegistered ? 'Registered' : 'Registered if approved' }] : []),
          ...fields.map((f) => ({
            label: fieldLabel(f.fieldCode),
            children: <span dir={f.lang === 'ar' ? 'rtl' : undefined}>{f.value ?? '—'}</span>,
          })),
          {
            label: 'Failed attempts',
            children: failed.length ? (
              <Flex gap={4} wrap>
                {failed.map((f) => (
                  <Tag key={f.id} color="error" variant="filled" className="ct-pill" title={f.reasonCode ?? ''}>
                    {stepLabel(f.stepCode)}: {f.reasonMessage ?? f.reasonCode}
                  </Tag>
                ))}
              </Flex>
            ) : (
              'None'
            ),
          },
        ]}
      />
      <Link to={`/verifications/${s.publicId}`} style={{ display: 'inline-block', marginTop: 8, fontWeight: 700 }}>
        Open full verification
      </Link>
    </Card>
  );
}

function History({ c }: { c: ReviewCaseDetail }) {
  const color: Record<string, string> = { APPROVED: TONE_HEX.success, REJECTED: TONE_HEX.error, ASSIGNED: TONE_HEX.processing, COMMENTED: TONE_HEX.default, OPENED: TONE_HEX.warning };
  return (
    <Card title="History">
      <Timeline
        items={[...c.actions].reverse().map((a) => ({
          key: a.id,
          color: color[a.action],
          content: (
            <div>
              <Typography.Text strong>{REVIEW_ACTION_LABELS[a.action] ?? a.action}</Typography.Text>{' '}
              <Typography.Text type="secondary">by {a.actor} · <DateText value={a.createdAt} relative /></Typography.Text>
              {a.note && <div style={{ whiteSpace: 'pre-wrap' }}>{a.note}</div>}
            </div>
          ),
        }))}
      />
    </Card>
  );
}

function DecisionPanel({ c, nextId }: { c: ReviewCaseDetail; nextId: number | null }) {
  const navigate = useNavigate();
  const noteRef = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const { canReview, username } = usePermissions();
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [touched, setTouched] = useState(false);
  const invalidate = [['review-case', c.id], ['review-cases'], ['review-count'], ['session', c.sessionPublicId], ['sessions'], ['dashboard']];
  const decide = useApiMutation((d: 'APPROVED' | 'REJECTED') => reviewsApi.decide(c.id, d, note.trim()), {
    success: (_, d) => (d === 'APPROVED' ? 'Verification approved' : 'Verification rejected'),
    invalidate,
    onSuccess: () => {
      setConfirm(null);
      setNote('');
      navigate(nextId !== null ? `/reviews/${nextId}` : '/reviews');
    },
  });
  const comment = useApiMutation(() => reviewsApi.comment(c.id, note.trim()), { success: 'Comment added', invalidate, onSuccess: () => { setNote(''); setTouched(false); } });
  const assign = useApiMutation(() => reviewsApi.assign(c.id), { success: 'Assigned to you', invalidate });
  const closed = c.status === 'APPROVED' || c.status === 'REJECTED';
  const noteMissing = !note.trim();
  const ask = (d: 'APPROVED' | 'REJECTED') => {
    setTouched(true);
    if (noteMissing) noteRef.current?.focus();
    else setConfirm(d);
  };
  // A = approve, R = reject (outside text fields; a note is still required).
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });
  useEffect(() => {
    if (!canReview || closed) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === 'a' || e.key === 'A') askRef.current('APPROVED');
      else if (e.key === 'r' || e.key === 'R') askRef.current('REJECTED');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canReview, closed]);

  const s = c.session;
  if (closed) {
    const last = [...c.actions].reverse().find((a) => a.action === c.status);
    return (
      <Card title="Decision">
        <Alert
          type={c.status === 'APPROVED' ? 'success' : 'error'}
          showIcon
          title={`${c.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${last?.actor ?? 'a reviewer'}`}
          description={
            <>
              {last?.note && <div style={{ whiteSpace: 'pre-wrap' }}>{last.note}</div>}
              <DateText value={last?.createdAt ?? c.updatedAt} />
            </>
          }
        />
        <Button block style={{ marginTop: 12 }} onClick={() => navigate('/reviews')}>Back to queue</Button>
      </Card>
    );
  }


  return (
    <Card title="Your decision" style={{ boxShadow: 'var(--ct-shadow-md)' }}>
      {!canReview ? (
        <Alert type="info" showIcon title="Only reviewers and administrators can decide review cases." />
      ) : (
        <Flex vertical gap={12}>
          {isDuplicateCase(s) && (
            <Alert
              type="info"
              showIcon
              title="This face matches a face already registered to another person"
              description={`Approve if they are different people: the face is then registered for ${c.partyName ?? 'this person'}. Reject if it is the same person.`}
            />
          )}
          <Flex justify="space-between" align="center" gap={8} wrap>
            <Typography.Text type="secondary">
              {c.assignedTo ? <>Assigned to <b>{c.assignedTo === username ? 'you' : c.assignedTo}</b></> : 'Not assigned yet'}
            </Typography.Text>
            {c.assignedTo !== username && (
              <Button size="small" icon={<UserAddOutlined />} loading={assign.isPending} onClick={() => assign.mutate(undefined)}>
                Assign to me
              </Button>
            )}
          </Flex>
          <div>
            <Input.TextArea
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              maxLength={1000}
              placeholder={
                s.document
                  ? "Why? e.g. 'Same person, document photo is older' (required to decide)"
                  : "Why? e.g. 'Different people, only similar features' (required to decide)"
              }
              status={touched && noteMissing && confirm === null ? 'error' : undefined}
            />
            {touched && noteMissing && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>A note is required to approve or reject.</Typography.Text>
            )}
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Button block size="large" color="green" variant="solid" icon={<CheckOutlined />} onClick={() => ask('APPROVED')}>
                Approve <kbd className="ct-kbd">A</kbd>
              </Button>
            </Col>
            <Col span={12}>
              <Button block size="large" danger type="primary" icon={<CloseOutlined />} onClick={() => ask('REJECTED')}>
                Reject <kbd className="ct-kbd">R</kbd>
              </Button>
            </Col>
          </Row>
          <Button icon={<MessageOutlined />} disabled={noteMissing} loading={comment.isPending} onClick={() => comment.mutate(undefined)}>
            Add as comment only
          </Button>
        </Flex>
      )}
      <Modal
        open={confirm !== null}
        title={confirm === 'APPROVED' ? 'Approve this verification?' : 'Reject this verification?'}
        okText={confirm === 'APPROVED' ? 'Yes, approve' : 'Yes, reject'}
        okButtonProps={{ danger: confirm === 'REJECTED', loading: decide.isPending }}
        cancelText="Go back"
        onCancel={() => setConfirm(null)}
        onOk={() => confirm && decide.mutate(confirm)}
      >
        <Typography.Paragraph>
          {confirm === 'APPROVED'
            ? `${c.partyName ?? 'The person'} will be treated as verified.${registersFace(s) ? ' Their face will be registered, so face authentication can recognise them.' : ''}`
            : `${c.partyName ?? 'The person'} will be told the verification failed.${registersFace(s) ? ' No face will be registered.' : ''}`}{' '}
          The decision is final and the app is notified.{nextId !== null ? ' The next case opens after this.' : ''}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
          Note: {note.trim()}
        </Typography.Paragraph>
      </Modal>
    </Card>
  );
}

/** Open cases in queue order, for "case 3 of 7" and next/previous navigation (J / K). */
function useQueueNav(id: number) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['review-cases', { status: 'OPEN', size: 200, nav: true }],
    queryFn: () => reviewsApi.list({ status: 'OPEN', size: 200 }),
  });
  const ids = (q.data?.items ?? []).map((r) => r.id);
  const idx = ids.indexOf(id);
  const prevId = idx > 0 ? ids[idx - 1] : null;
  const nextId = idx >= 0 ? (ids[idx + 1] ?? null) : (ids.find((x) => x !== id) ?? null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if ((e.key === 'j' || e.key === 'J') && nextId !== null) navigate(`/reviews/${nextId}`);
      else if ((e.key === 'k' || e.key === 'K') && prevId !== null) navigate(`/reviews/${prevId}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, nextId, prevId]);
  return { position: idx >= 0 ? idx + 1 : null, total: ids.length, prevId, nextId };
}

export default function ReviewCasePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const reason = useReasonMessage();
  const q = useQuery({ queryKey: ['review-case', Number(id)], queryFn: () => reviewsApi.get(Number(id)) });
  const nav = useQueueNav(Number(id));
  const c = q.data;
  const name = c ? (c.partyName ?? 'Unknown person') : 'Review case';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Review queue', to: '/reviews' }, { label: name }]}
        avatar={c && <PersonAvatar name={c.partyName} size={56} />}
        title={name}
        tags={
          c && (
            <>
              <ReviewStatusTag value={c.status} />
              <Tag color="warning" variant="filled" className="ct-pill">
                {reason(c.reason) ?? c.reason}
              </Tag>
            </>
          )
        }
        help={
          c && (
            <span>
              {flowLabel(c.session.flowCode)} · waiting since <DateText value={c.createdAt} relative />.{' '}
              {isDuplicateCase(c.session) ? 'Are these different people?' : 'Is this the same person?'}
            </span>
          )
        }
        extra={
          nav.total > 0 && (
            <Flex align="center" gap={8}>
              {nav.position && (
                <span className="ct-meta tabular" style={{ fontWeight: 600 }}>
                  Case {nav.position} of {nav.total}
                </span>
              )}
              <Button
                aria-label="Previous case (K)"
                title="Previous case (K)"
                icon={<LeftOutlined />}
                disabled={nav.prevId === null}
                onClick={() => navigate(`/reviews/${nav.prevId}`)}
              />
              <Button
                aria-label="Next case (J)"
                title="Next case (J)"
                icon={<RightOutlined />}
                disabled={nav.nextId === null}
                onClick={() => navigate(`/reviews/${nav.nextId}`)}
              />
            </Flex>
          )
        }
      />
      <DataState query={q} rows={14}>
        {(c) => (
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={15} xxl={16}>
              <Flex vertical gap={24}>
                <FaceComparison session={c.session} large title={isDuplicateCase(c.session) ? 'Are these different people?' : 'Is this the same person?'} />
                <Card title="Attempts" extra={<Typography.Text type="secondary">{c.session.steps.length} attempts</Typography.Text>}>
                  <AttemptTimeline steps={c.session.steps} compact />
                </Card>
              </Flex>
            </Col>
            <Col xs={24} lg={9} xxl={8}>
              <Flex vertical gap={24}>
                <DecisionPanel key={c.id} c={c} nextId={nav.nextId} />
                <KeyFacts c={c} />
                <History c={c} />
              </Flex>
            </Col>
          </Row>
        )}
      </DataState>
    </>
  );
}
