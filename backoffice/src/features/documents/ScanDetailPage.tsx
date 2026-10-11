import { CheckOutlined, CloseOutlined, ScanOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Descriptions, Flex, Form, Input, Modal, Row, Table, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { documentsApi } from '../../api/operations';
import type { ScanDetail, ScanField, ScanReviewReason } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { MediaGallery } from '../../components/ImageViewer';
import { Confidence, IdText, RawTextBlock } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { ScanStatusTag } from '../../components/Tags';
import { IconTile, SectionTitle, TechnicalDetails } from '../../components/ui';
import { useApiMutation } from '../../lib/hooks';
import { docTypeLabel, fieldLabel, humanize, scanReviewReasonLabel } from '../../lib/labels';
import { changedCorrections, correctionRows, reviewerLabel } from './scanReviewLogic';

const INVALIDATE = [['scan'], ['scans'], ['document'], ['documents']];

/** Why the scan waits for a person, shown at the top of the page. */
function ReviewReasons({ reasons }: { reasons: ScanReviewReason[] }) {
  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      title="This scan is waiting for a person to check it"
      description={
        reasons.length === 0 ? (
          'No reason was recorded.'
        ) : (
          <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
            {reasons.map((r, i) => (
              <li key={`${r.code}-${r.field}-${i}`}>
                <Typography.Text strong>{scanReviewReasonLabel(r.code)}</Typography.Text>
                {r.field && <> · {fieldLabel(r.field)}</>}
                {r.message && <Typography.Text type="secondary"> · {r.message}</Typography.Text>}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

function ApproveModal({ scan, onClose }: { scan: ScanDetail; onClose: () => void }) {
  const [form] = Form.useForm<{ values: Record<string, string>; note?: string }>();
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => correctionRows(scan.fields, scan.reviewReasons), [scan.fields, scan.reviewReasons]);
  const approve = useApiMutation(
    (v: { values: Record<string, string>; note?: string }) =>
      documentsApi.reviewScan(scan.id, { decision: 'APPROVE', corrections: changedCorrections(rows, v.values ?? {}), note: v.note?.trim() || null }),
    {
      success: 'Scan approved',
      invalidate: INVALIDATE,
      onSuccess: onClose,
      onError: (err) => {
        setError(errorMessage(err));
        return true;
      },
    },
  );
  return (
    <Modal
      open
      width={640}
      title="Approve the scan"
      okText="Approve"
      onCancel={onClose}
      onOk={() => form.submit()}
      okButtonProps={{ loading: approve.isPending, icon: <CheckOutlined /> }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        Check each value against the image and correct the wrong ones. Only the values you change are sent as corrections; the values are then saved on the person's document.
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ values: Object.fromEntries(rows.map((r) => [r.fieldCode, r.original])) }}
        onFinish={(v) => {
          setError(null);
          approve.mutate(v);
        }}
      >
        {rows.length === 0 && <Typography.Paragraph type="secondary">No fields were read.</Typography.Paragraph>}
        {rows.map((r) => (
          <Form.Item
            key={r.fieldCode}
            name={['values', r.fieldCode]}
            label={
              <Flex gap={6} align="center" wrap>
                <span title={r.fieldCode}>{fieldLabel(r.fieldCode)}</span>
                {r.reasons.map((c) => (
                  <Tag key={c} color="warning" style={{ fontSize: 11 }}>{scanReviewReasonLabel(c)}</Tag>
                ))}
              </Flex>
            }
            rules={r.original ? [{ required: true, whitespace: true, message: 'Enter a value (or cancel to keep the one read)' }] : []}
            style={{ marginBottom: 12 }}
            extra={r.original ? undefined : 'Not read from the document'}
          >
            <Input dir={r.fieldCode.endsWith('Ar') ? 'rtl' : undefined} placeholder={r.original ? undefined : 'Enter the value from the image'} />
          </Form.Item>
        ))}
        <Form.Item name="note" label="Note (optional)">
          <Input.TextArea rows={2} maxLength={1000} placeholder="What you checked or corrected" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RejectModal({ scan, onClose }: { scan: ScanDetail; onClose: () => void }) {
  const [form] = Form.useForm<{ note: string }>();
  const reject = useApiMutation((v: { note: string }) => documentsApi.reviewScan(scan.id, { decision: 'REJECT', note: v.note.trim() }), {
    success: 'Scan rejected',
    invalidate: INVALIDATE,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      title="Reject the scan"
      okText="Reject"
      okButtonProps={{ danger: true, loading: reject.isPending, icon: <CloseOutlined /> }}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">The values are not used and nothing is saved on the person's document.</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => reject.mutate(v)}>
        <Form.Item name="note" label="Why" rules={[{ required: true, whitespace: true, message: 'Say why the scan is rejected' }]}>
          <Input.TextArea rows={3} maxLength={1000} placeholder="e.g. The image is not a real document" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function ScanDetailPage() {
  const { id = '' } = useParams();
  const { canReview } = usePermissions();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const q = useQuery({ queryKey: ['scan', Number(id)], queryFn: () => documentsApi.getScan(Number(id)) });
  const s = q.data;
  const inReview = s?.status === 'NEEDS_REVIEW';
  const title = s ? `${docTypeLabel(s.docTypeCode)} scan` : 'Document scan';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Document scans', to: '/scans' }, { label: title }]}
        avatar={s && <IconTile icon={<ScanOutlined />} size={56} />}
        title={title}
        tags={s && <ScanStatusTag value={s.status} />}
        help={
          s ? (
            <Flex vertical gap={2} component="span">
              <span>
                {s.documentId ? 'Linked to a document' : 'Standalone scan'}
                {s.processingMs === null ? '' : ` · read in ${s.processingMs} ms`}
              </span>
              <span className="ct-meta">
                Scanned <DateText value={s.createdAt} />
              </span>
            </Flex>
          ) : (
            "The raw result of reading a document image on the server: each field as read, with the engine's confidence. Scans that need a person are approved (with corrections) or rejected here."
          )
        }
        extra={
          inReview &&
          canReview && (
            <>
              <Button danger icon={<CloseOutlined />} onClick={() => setDialog('reject')}>Reject</Button>
              <Button type="primary" icon={<CheckOutlined />} onClick={() => setDialog('approve')}>Approve…</Button>
            </>
          )
        }
      />
      <DataState query={q} rows={12}>
        {(s) => {
          const reviewed = s.fields.some((f) => f.reviewedValue != null);
          return (
            <Flex vertical gap={24}>
              {s.status === 'NEEDS_REVIEW' && <ReviewReasons reasons={s.reviewReasons ?? []} />}
              <Row gutter={[24, 24]}>
                <Col xs={24} xl={15}>
                  <Flex vertical gap={24}>
                    <Card>
                      <SectionTitle title="Fields as read" sub={`${s.fields.length} fields, with the engine's confidence`} />
                      <Table<ScanField>
                        size="small"
                        rowKey={(f) => `${f.fieldCode}-${f.lang}`}
                        pagination={false}
                        dataSource={s.fields}
                        scroll={{ x: 560 }}
                        locale={{ emptyText: 'No fields were read' }}
                        columns={[
                          { title: 'Field', dataIndex: 'fieldCode', render: (v: string) => <span title={v} style={{ fontWeight: 600 }}>{fieldLabel(v)}</span> },
                          { title: 'Raw value', render: (_, f) => <span dir={f.lang === 'ar' ? 'rtl' : undefined}>{f.rawValue ?? '—'}</span> },
                          ...(reviewed
                            ? [
                                {
                                  title: 'Reviewed value',
                                  render: (_: unknown, f: ScanField) =>
                                    f.reviewedValue == null ? (
                                      <span className="ct-meta">—</span>
                                    ) : (
                                      <Flex gap={4} align="center">
                                        <span dir={f.lang === 'ar' ? 'rtl' : undefined}>{f.reviewedValue}</span>
                                        {f.reviewedValue !== f.rawValue && (
                                          <Tag color="processing" variant="filled" className="ct-pill">
                                            Corrected
                                          </Tag>
                                        )}
                                      </Flex>
                                    ),
                                },
                              ]
                            : []),
                          { title: 'Confidence', dataIndex: 'confidence', align: 'right', width: 110, render: (v: number | null) => <Confidence value={v} /> },
                          {
                            title: 'Validation',
                            dataIndex: 'validationStatus',
                            width: 140,
                            render: (v: string | null, f) =>
                              v ? (
                                <Tooltip title={f.validationMessage ?? undefined}>
                                  <Tag color={v === 'VALID' ? 'success' : 'warning'} variant="filled" className="ct-pill">
                                    {humanize(v)}
                                  </Tag>
                                </Tooltip>
                              ) : (
                                '—'
                              ),
                          },
                        ]}
                      />
                    </Card>
                    <RawTextBlock text={s.rawText} label="Raw OCR text" />
                  </Flex>
                </Col>
                <Col xs={24} xl={9}>
                  <Flex vertical gap={24}>
                    <Card>
                      <SectionTitle title="Scan" />
                      <Descriptions
                        column={1}
                        size="small"
                        items={[
                          { label: 'Document', children: s.documentId ? <Link to={`/documents/${s.documentId}`}>Open document</Link> : 'Standalone scan' },
                          { label: 'Confidence', children: <Confidence value={s.confidence} /> },
                          { label: 'Processing time', children: s.processingMs === null ? '—' : `${s.processingMs} ms` },
                          { label: 'When', children: <DateText value={s.createdAt} /> },
                          ...(s.issues?.length
                            ? [
                                {
                                  label: 'Issues',
                                  children: (
                                    <Flex gap={4} wrap>
                                      {s.issues.map((i) => (
                                        <Tag key={i} variant="filled" className="ct-pill">
                                          {humanize(i)}
                                        </Tag>
                                      ))}
                                    </Flex>
                                  ),
                                },
                              ]
                            : []),
                        ]}
                      />
                      {s.errorMessage && <Alert style={{ marginTop: 12 }} type="error" showIcon title={s.errorMessage} />}
                    </Card>
                    {s.reviewedAt && (
                      <Card>
                        <SectionTitle title="Review" />
                        <Descriptions
                          column={1}
                          size="small"
                          items={[
                            { label: 'Decision', children: <ScanStatusTag value={s.status} /> },
                            { label: 'By', children: reviewerLabel(s.reviewedBy) },
                            { label: 'When', children: <DateText value={s.reviewedAt} /> },
                            { label: 'Note', children: s.reviewNote ?? '—' },
                          ]}
                        />
                      </Card>
                    )}
                    <Card>
                      <SectionTitle title="Images" sub={s.media.length ? `${s.media.length} captured` : undefined} />
                      <MediaGallery items={s.media} size={110} />
                    </Card>
                    <TechnicalDetails
                      summary="Scan ID, engine and image IDs"
                      items={[
                        { label: 'Scan ID', value: <IdText value={s.publicId} /> },
                        { label: 'Internal ID', value: <span className="ct-mono">{s.id}</span> },
                        { label: 'Document ID', value: s.documentId === null ? null : <span className="ct-mono">{s.documentId}</span> },
                        { label: 'Engine', value: s.ocrProvider && <span className="ct-mono">{s.ocrProvider}</span> },
                        { label: 'Image IDs', value: s.media.length ? <span className="ct-mono">{s.media.map((m) => m.id).join(', ')}</span> : null },
                      ]}
                    />
                  </Flex>
                </Col>
              </Row>
            </Flex>
          );
        }}
      </DataState>
      {s && dialog === 'approve' && <ApproveModal scan={s} onClose={() => setDialog(null)} />}
      {s && dialog === 'reject' && <RejectModal scan={s} onClose={() => setDialog(null)} />}
    </>
  );
}
