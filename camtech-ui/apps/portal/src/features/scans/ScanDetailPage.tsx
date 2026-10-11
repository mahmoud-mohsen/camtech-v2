import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { CamtechApiError, errorMessage, type ScanReviewRequest, type TenantScanDetail } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Empty, Flex, Form, Input, Popconfirm, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImageGallery } from '../../components/AuthImage';
import { t } from '../../i18n';
import { documentImages } from '../../lib/media';
import { DataState, ErrorState } from '../../components/DataState';
import { SummaryStrip } from '../../components/DetailLayout';
import { DateText } from '../../components/DateText';
import { Confidence, IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { SectionTitle, TechnicalDetails } from '../../components/ui';
import { ScanStatusTag, ValidationTag } from '../../components/Tags';
import { formatMs } from '../../lib/format';
import { qk, useApiMutation } from '../../lib/hooks';
import { docTypeLabel, fieldLabel, reviewReasonLabel, sourceLabel, VALIDATION_HELP } from '../../lib/labels';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { AfterDecisionHint, QueueNav } from '../reviews/QueueNav';
import { useScanQueue, type QueuePosition } from '../reviews/queue';

const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type Field = TenantScanDetail['fields'][number];

const NEEDS_LOOK = ['INVALID', 'MISMATCH', 'MISSING', 'LOW_CONFIDENCE'];
const DATE_FIELDS = ['dateOfBirth', 'issueDate', 'expiryDate'];
/** Fields that are not values a reviewer edits. */
const NOT_EDITABLE = ['mrzVerified'];

function FieldValue({ f }: { f: Field }) {
  if (f.value === null) return <Typography.Text type="secondary">Not found</Typography.Text>;
  const corrected = f.reviewedValue != null && f.ocrValue != null && f.reviewedValue !== f.ocrValue;
  return (
    <Flex vertical gap={2}>
      <Typography.Text
        copyable={{ text: f.value }}
        dir={f.lang === 'ar' ? 'rtl' : undefined}
        className={/^MRZ/.test(f.fieldCode) ? 'ct-mono' : undefined}
        style={{ overflowWrap: 'anywhere' }}
      >
        {f.value}
        {f.reviewedValue != null && (
          <Tag color={corrected ? 'blue' : 'green'} variant="filled" className="ct-pill" style={{ marginInlineStart: 6 }}>
            {corrected ? 'Corrected' : 'Confirmed'}
          </Tag>
        )}
      </Typography.Text>
      {corrected && (
        <Typography.Text type="secondary" className="ct-meta" delete>
          OCR: {f.ocrValue}
        </Typography.Text>
      )}
    </Flex>
  );
}

function FieldsTable({ fields }: { fields: Field[] }) {
  if (!fields.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No fields were extracted" />;
  return (
    <Table<Field>
      size="small"
      rowKey={(f) => `${f.fieldCode}-${f.lang ?? ''}`}
      pagination={false}
      dataSource={fields}
      scroll={{ x: 640 }}
      columns={[
        {
          title: 'Field',
          width: 160,
          render: (_, f) => (
            <span title={f.fieldCode}>
              {fieldLabel(f.fieldCode)}
              {f.lang && f.lang !== 'en' && (
                <Tag variant="filled" style={{ marginInlineStart: 6, fontSize: 12 }}>
                  {f.lang.toUpperCase()}
                </Tag>
              )}
            </span>
          ),
        },
        { title: 'Value', render: (_, f) => <FieldValue f={f} /> },
        {
          title: 'Read from',
          dataIndex: 'source',
          width: 120,
          render: (v: string | null | undefined) => (v ? <Typography.Text type="secondary">{sourceLabel(v)}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>),
        },
        { title: 'Confidence', dataIndex: 'confidence', width: 120, render: (v: number | null) => <Confidence value={v} low={0.7} /> },
        {
          title: 'Validation',
          width: 150,
          render: (_, f) => {
            const why = f.validationMessage ?? (f.validationStatus ? VALIDATION_HELP[f.validationStatus] : undefined);
            if (f.reviewedValue != null) {
              // The reviewer's value replaces the OCR check; keep what OCR's check said in the tooltip.
              return (
                <Tooltip title={`OCR check: ${f.validationStatus ?? '—'}${why ? ` — ${why}` : ''}`}>
                  <Tag color="success" variant="filled" className="ct-pill">
                    Reviewed
                  </Tag>
                </Tooltip>
              );
            }
            return (
              <Tooltip title={why}>
                <span>
                  <ValidationTag value={f.validationStatus} />
                </span>
              </Tooltip>
            );
          },
        },
      ]}
    />
  );
}

/**
 * Corrections form: the fields the checks flagged first, any other field on demand.
 * Opened from the review queue, a decision moves on to the next scan.
 */
function ReviewCard({ scan, queue }: { scan: TenantScanDetail; queue: QueuePosition | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  /** Captured when deciding: the queue list refreshes (without this scan) right after. */
  const goTo = useRef<string | null>(null);
  const [form] = Form.useForm<Record<string, string>>();
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const flagged = useMemo(() => {
    const fromReasons = (scan.reviewReasons ?? []).map((r) => r.field).filter((f): f is string => !!f);
    const fromChecks = scan.fields.filter((f) => f.validationStatus && NEEDS_LOOK.includes(f.validationStatus)).map((f) => f.fieldCode);
    return [...new Set([...fromReasons, ...fromChecks])].filter((c) => !NOT_EDITABLE.includes(c));
  }, [scan]);
  const shown = [...flagged, ...extra.filter((c) => !flagged.includes(c))];
  const current = (code: string) => scan.fields.find((f) => f.fieldCode === code)?.value ?? '';
  const addable = scan.fields.map((f) => f.fieldCode).filter((c) => !shown.includes(c) && !NOT_EDITABLE.includes(c));

  const onDone = (r: TenantScanDetail) => {
    qc.setQueryData(qk.scan(scan.id), r);
    void qc.invalidateQueries({ queryKey: ['scans'] });
    void qc.invalidateQueries({ queryKey: qk.reviewSummary });
    if (queue) navigate(goTo.current ?? '/reviews?tab=scans');
  };
  const onError = (err: unknown) => {
    setServerError(err instanceof CamtechApiError ? err.message : errorMessage(err));
    return true;
  };
  const submit = useApiMutation((body: ScanReviewRequest) => api.reviewScan(scan.id, body), {
    success: (r) => (r.status === 'REJECTED' ? 'Scan rejected' : 'Scan approved'),
    onSuccess: onDone,
    onError,
  });

  const approve = async () => {
    setServerError(null);
    goTo.current = queue?.afterDecision ?? null;
    const values = await form.validateFields();
    const corrections: Record<string, string> = {};
    for (const code of shown) {
      const v = (values[code] ?? '').trim();
      if (v && v !== current(code)) corrections[code] = v;
    }
    submit.mutate({ decision: 'APPROVE', corrections, note: note.trim() || undefined });
  };
  const reject = () => {
    setServerError(null);
    goTo.current = queue?.afterDecision ?? null;
    submit.mutate({ decision: 'REJECT', note: note.trim() || undefined });
  };

  // Ctrl/⌘ + Enter approves, from anywhere on the page (the usual "submit" shortcut).
  const approveRef = useRef(approve);
  approveRef.current = approve;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submit.isPending) {
        e.preventDefault();
        void approveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit.isPending]);

  return (
    <Card style={{ marginBottom: 24 }}>
      <SectionTitle
        title="Review"
        sub={
          <>
            Compare with the document image. Correct what OCR misread, then approve: the values are saved on the person&apos;s document only after approval.
            Reject when the document is not genuine, unreadable, or not the right one.
          </>
        }
      />
      {serverError && <Alert type="error" showIcon title={serverError} style={{ marginBottom: 12 }} closable onClose={() => setServerError(null)} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        {shown.length === 0 && <Typography.Text type="secondary">No field was flagged. Add one below to correct it, or approve as read.</Typography.Text>}
        <Row gutter={12}>
          {shown.map((code) => {
            const f = scan.fields.find((x) => x.fieldCode === code);
            return (
              <Col xs={24} md={12} key={code}>
                <Form.Item
                  name={code}
                  label={
                    <Space size={6}>
                      {fieldLabel(code)}
                      {f?.validationStatus && <ValidationTag value={f.validationStatus} />}
                    </Space>
                  }
                  extra={f?.validationMessage ?? undefined}
                  initialValue={current(code)}
                >
                  {code === 'gender' ? (
                    <Select options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} allowClear />
                  ) : (
                    <Input
                      dir={code.endsWith('Ar') ? 'rtl' : undefined}
                      placeholder={DATE_FIELDS.includes(code) ? 'dd/mm/yyyy' : code === 'emiratesIdNumber' ? '784-YYYY-NNNNNNN-C' : undefined}
                      allowClear
                    />
                  )}
                </Form.Item>
              </Col>
            );
          })}
        </Row>
      </Form>
      {addable.length > 0 && (
        <Select
          style={{ width: 260, marginBottom: 12 }}
          placeholder={
            <span>
              <PlusOutlined /> Correct another field
            </span>
          }
          value={null}
          onChange={(c: string) => {
            setExtra((x) => [...x, c]);
            form.setFieldValue(c, current(c));
          }}
          options={addable.map((c) => ({ value: c, label: fieldLabel(c) }))}
        />
      )}
      <Input.TextArea placeholder="Note (optional): what you checked or why you rejected" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} />
      <Flex gap={8} justify="flex-end" align="center" wrap className="ct-sticky-actions ct-pinned">
        <span style={{ flex: 1, minWidth: 160 }}>
          <AfterDecisionHint queue={queue} />
        </span>
        <Popconfirm title="Reject this scan?" description="Its values will not be used." okText="Reject" okButtonProps={{ danger: true }} onConfirm={reject}>
          <Button danger icon={<CloseOutlined />} loading={submit.isPending && submit.variables?.decision === 'REJECT'}>
            Reject
          </Button>
        </Popconfirm>
        <Button type="primary" icon={<CheckOutlined />} onClick={() => void approve()} loading={submit.isPending && submit.variables?.decision === 'APPROVE'} title={`${MOD_KEY} + Enter`}>
          Approve
          <span className="ct-kbd" aria-hidden>
            {MOD_KEY} ↵
          </span>
        </Button>
      </Flex>
    </Card>
  );
}

export default function ScanDetailPage() {
  const { id = '' } = useParams();
  const numeric = Number(id);
  const valid = Number.isInteger(numeric) && numeric > 0;
  const q = useQuery({ queryKey: qk.scan(numeric), queryFn: () => api.scan(numeric), enabled: valid });
  const { canReview } = usePermissions();
  const fromQueue = useSearchParams()[0].get('from') === 'reviews';
  const queue = useScanQueue(numeric, valid && fromQueue);
  if (!valid) return <ErrorState error={new Error('This scan id is not valid.')} />;
  return (
    <DataState query={q} rows={10}>
      {(s) => {
        const reasons = s.reviewReasons ?? [];
        const inReview = s.status === 'NEEDS_REVIEW';
        const low = s.fields.filter((f) => f.validationStatus && NEEDS_LOOK.includes(f.validationStatus)).length;
        return (
          <>
            <PageHeader
              crumbs={[
                fromQueue ? { label: t('reviews.title'), to: '/reviews?tab=scans' } : { label: 'Document scans', to: '/scans' },
                { label: docTypeLabel(s.docTypeCode) },
              ]}
              extra={fromQueue && <QueueNav queue={queue} />}
              title={docTypeLabel(s.docTypeCode)}
              documentTitle={`Scan #${s.id}`}
              tags={<ScanStatusTag value={s.status} />}
              help={
                <span className="ct-meta">
                  Scanned <DateText value={s.createdAt} relative />
                </span>
              }
            />
            <SummaryStrip
              items={[
                { label: 'Overall confidence', value: <Confidence value={s.confidence} /> },
                {
                  label: 'Issues',
                  value: s.issues?.length ? (
                    <Flex gap={4} wrap>
                      {s.issues.map((i) => (
                        <Tag key={i} color="orange" variant="filled" className="ct-pill">
                          {reviewReasonLabel(i)}
                        </Tag>
                      ))}
                    </Flex>
                  ) : (
                    'None'
                  ),
                },
                { label: 'Processing time', value: s.processingMs === null ? '—' : formatMs(s.processingMs) },
                { label: 'Saved to', value: s.documentId ? <Link to={`/documents/${s.documentId}`}>{t('document.link')}</Link> : '—' },
              ]}
            />
            {/* Images beside the review form: comparing them with the values is the task here. */}
            <Row gutter={[24, 24]}>
              <Col xs={{ span: 24, order: 2 }} xl={{ span: 14, order: 2 }}>
                {inReview && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 24 }}
                    title="Waiting for review: these values are not used until someone approves them"
                    description={
                      reasons.length > 0 && (
                        <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                          {reasons.map((r, i) => (
                            <li key={i}>
                              <Typography.Text strong>{reviewReasonLabel(r.code)}</Typography.Text>
                              {r.field && <> · {fieldLabel(r.field)}</>}
                              {r.message && <Typography.Text type="secondary"> — {r.message}</Typography.Text>}
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  />
                )}
                {inReview && canReview && <ReviewCard key={s.id} scan={s} queue={fromQueue ? queue : null} />}
                <Card>
                  <SectionTitle title={`Extracted fields (${s.fields.length})`} />
                  {s.errorMessage && <Alert type="error" showIcon title={s.errorMessage} style={{ marginBottom: 12 }} />}
                  {!inReview && low > 0 && s.status !== 'REJECTED' && !s.reviewedAt && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      title={`${low} field${low > 1 ? 's' : ''} need a second look`}
                      description="Low confidence or failed validation: confirm the value with the user, or ask for a clearer photo."
                    />
                  )}
                  <FieldsTable fields={s.fields} />
                </Card>
              </Col>
              <Col xs={{ span: 24, order: 1 }} xl={{ span: 10, order: 1 }}>
                <Flex vertical gap={24}>
                <Card>
                  <SectionTitle title={t('media.title')} />
                  <ImageGallery items={documentImages(s.media)} height={inReview ? 260 : 200} minWidth={200} />
                </Card>
                {s.reviewedAt && (
                  <Card>
                    <SectionTitle title="Review" />
                    <Descriptions
                      size="small"
                      column={1}
                      items={[
                        { label: 'Decision', children: <ScanStatusTag value={s.status} /> },
                        { label: 'By', children: s.reviewedBy ?? '—' },
                        { label: 'When', children: <DateText value={s.reviewedAt} /> },
                        { label: 'Note', children: s.reviewNote ?? '—' },
                      ]}
                    />
                  </Card>
                )}
                <TechnicalDetails
                  items={[
                    { label: 'Scan ID', value: <IdText value={s.publicId} /> },
                    { label: 'Number', value: <span className="ct-mono">{s.id}</span> },
                  ]}
                  summary="Scan ID for API calls"
                />
                </Flex>
              </Col>
            </Row>
          </>
        );
      }}
    </DataState>
  );
}
