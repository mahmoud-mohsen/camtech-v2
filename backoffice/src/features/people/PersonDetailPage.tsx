import { DeleteOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Descriptions, Empty, Flex, Image, Row, Table, Tabs, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { partiesApi } from '../../api/operations';
import type { DocumentSummary, FaceTemplate, PartyDetail, SessionSummary } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { MediaImage } from '../../components/ImageViewer';
import { IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { ActiveTag, DecisionTag, DocStatusTag, StatusTag } from '../../components/Tags';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { daysUntil, formatDate, formatSimilarity } from '../../lib/format';
import { useApiMutation } from '../../lib/hooks';
import { docTypeLabel, flowLabel, humanize } from '../../lib/labels';

function PersonalData({ p }: { p: PartyDetail }) {
  if (p.organization) {
    const o = p.organization;
    return (
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: 'Legal name', children: o.legalNameEn ?? '—' },
          { label: 'Legal name (Arabic)', children: <span dir="rtl">{o.legalNameAr ?? '—'}</span> },
          { label: 'Legal form', children: o.legalForm ?? '—' },
          { label: 'Issuer', children: o.issuerCode ?? '—' },
          { label: 'Customer ref', children: p.externalRef ?? '—' },
        ]}
      />
    );
  }
  const x = p.person;
  return (
    <Descriptions
      size="small"
      column={1}
      items={[
        { label: 'Full name', children: x?.fullNameEn ?? '—' },
        { label: 'Full name (Arabic)', children: <span dir="rtl">{x?.fullNameAr ?? '—'}</span> },
        { label: 'Date of birth', children: <DateText value={x?.dateOfBirth} dateOnly /> },
        { label: 'Gender', children: x?.gender === 'M' ? 'Male' : x?.gender === 'F' ? 'Female' : (x?.gender ?? '—') },
        { label: 'Nationality', children: x?.nationality ?? '—' },
        { label: 'Customer ref', children: p.externalRef ?? '—' },
        { label: 'Last verified', children: <DateText value={p.lastVerifiedAt} relative /> },
      ]}
    />
  );
}

function DocumentsTable({ docs }: { docs: DocumentSummary[] }) {
  const navigate = useNavigate();
  return (
    <Table<DocumentSummary>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={docs}
      locale={{ emptyText: 'No documents' }}
      rowClassName={() => 'clickable-row'}
      onRow={(d) => ({ onClick: () => navigate(`/documents/${d.id}`) })}
      columns={[
        { title: 'Type', dataIndex: 'docTypeCode', render: (v: string) => docTypeLabel(v) },
        { title: 'Number', dataIndex: 'documentNumber', render: (v: string | null) => <span className="tabular">{v ?? '—'}</span> },
        {
          title: 'Expires',
          dataIndex: 'expiryDate',
          render: (v: string | null) => {
            const d = daysUntil(v);
            return (
              <Flex gap={6} align="center">
                <DateText value={v} dateOnly />
                {d !== null && d < 0 && (
                  <Tag color="error" variant="filled" className="ct-pill">
                    Expired
                  </Tag>
                )}
                {d !== null && d >= 0 && d <= 30 && (
                  <Tag color="warning" variant="filled" className="ct-pill">
                    in {d} days
                  </Tag>
                )}
              </Flex>
            );
          },
        },
        { title: 'Status', dataIndex: 'status', render: (v: string) => <DocStatusTag value={v} /> },
      ]}
    />
  );
}

function FaceTemplates({ p }: { p: PartyDetail }) {
  const { isAdmin } = usePermissions();
  const revoke = useApiMutation((t: FaceTemplate) => partiesApi.revokeTemplate(p.id, t.id), {
    success: 'Face template revoked',
    invalidate: [['party', p.id]],
  });
  if (!p.faceTemplates.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No face templates" />;
  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        A face template is the numeric fingerprint of a face used for matching. The <b>enrolled</b> (registered) one is used for face authentication;
        it comes from a face registration (selfie only, no document) or a selfie ID verification. Revoke it if it should no longer be trusted (e.g. it
        was captured from the wrong person).
      </Typography.Paragraph>
      <Image.PreviewGroup>
        <Table<FaceTemplate>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={p.faceTemplates}
          columns={[
            {
              title: 'Image',
              width: 80,
              render: (_, t) => (t.sourceMediaId ? <MediaImage media={{ id: t.sourceMediaId, role: t.role === 'SELFIE' ? 'SELFIE_NORMAL' : 'FACE_PHOTO', mimeType: 'image/jpeg', byteCount: 0, width: null, height: null, createdAt: t.createdAt }} width={56} height={56} caption={false} /> : '—'),
            },
            {
              title: 'From',
              render: (_, t) => <span title={`Model ${t.modelVersion} · ${t.dimension}d`}>{t.role === 'SELFIE' ? 'Selfie' : 'Document photo'}</span>,
            },
            { title: 'Status', dataIndex: 'status', render: (v: string) => <ActiveTag value={v} /> },
            { title: 'Quality', dataIndex: 'qualityScore', align: 'right', render: (v: number | null) => <span className="tabular">{formatSimilarity(v)}</span> },
            {
              title: 'Created',
              dataIndex: 'createdAt',
              render: (v: string) => (
                <span className="ct-meta tabular">
                  <DateText value={v} relative />
                </span>
              ),
            },
            {
              title: '',
              align: 'right',
              render: (_, t) =>
                isAdmin && t.status !== 'REVOKED' ? (
                  <ConfirmAction
                    danger
                    label="Revoke"
                    buttonProps={{ size: 'small' }}
                    title="Revoke this face template?"
                    description="It will no longer be used for matching or face authentication. This can't be undone."
                    okText="Revoke"
                    onConfirm={() => revoke.mutateAsync(t)}
                  />
                ) : null,
            },
          ]}
        />
      </Image.PreviewGroup>
    </>
  );
}

function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  const navigate = useNavigate();
  return (
    <Table<SessionSummary>
      size="small"
      rowKey="publicId"
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      dataSource={sessions}
      locale={{ emptyText: 'No verifications' }}
      rowClassName={() => 'clickable-row'}
      onRow={(s) => ({ onClick: () => navigate(`/verifications/${s.publicId}`) })}
      columns={[
        {
          title: 'Started',
          dataIndex: 'createdAt',
          render: (v: string) => (
            <span className="ct-meta tabular">
              <DateText value={v} relative />
            </span>
          ),
        },
        { title: 'Flow', dataIndex: 'flowCode', render: (v: string) => flowLabel(v) },
        { title: 'Status', dataIndex: 'status', render: (v: string) => <StatusTag value={v} /> },
        { title: 'Decision', dataIndex: 'decision', render: (v: string | null) => <DecisionTag value={v} empty="—" /> },
        { title: 'Similarity', dataIndex: 'finalSimilarity', align: 'right', render: (v: number | null) => <span className="tabular">{formatSimilarity(v)}</span> },
      ]}
    />
  );
}

export default function PersonDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const q = useQuery({ queryKey: ['party', Number(id)], queryFn: () => partiesApi.get(Number(id)) });
  const erase = useApiMutation(() => partiesApi.erase(Number(id)), {
    success: 'Person erased',
    invalidate: [['parties'], ['sessions'], ['documents'], ['dashboard']],
    onSuccess: () => navigate('/people', { replace: true }),
  });
  const p = q.data;
  const confirmText = p ? (p.displayName ?? p.publicId) : '';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'People', to: '/people' }, { label: p?.displayName ?? 'Person' }]}
        avatar={p && <PersonAvatar name={p.displayName} size={56} org={p.partyType === 'ORG'} />}
        title={p?.displayName ?? 'Person'}
        tags={
          p && (
            <Tag variant="filled" className="ct-pill">
              {p.partyType === 'ORG' ? 'Company' : 'Person'}
            </Tag>
          )
        }
        help={
          p && (
            <Flex vertical gap={2} component="span">
              <span>{p.externalRef ? `Customer ref ${p.externalRef}` : 'No customer ref'}</span>
              <span className="ct-meta">
                {p.documentsCount} {p.documentsCount === 1 ? 'document' : 'documents'} · {p.sessionsCount} {p.sessionsCount === 1 ? 'verification' : 'verifications'} · added {formatDate(p.createdAt)}
              </span>
            </Flex>
          )
        }
        extra={
          p &&
          isAdmin && (
            <ConfirmAction
              danger
              label="Erase person"
              buttonProps={{ icon: <DeleteOutlined /> }}
              title="Erase this person permanently?"
              description={
                <Alert
                  type="error"
                  showIcon
                  title="This permanently deletes all of their data"
                  description={`Personal data, ${p.documentsCount} documents, all images, face templates and ${p.sessionsCount} verifications will be erased. Only an audit entry is kept. This can't be undone.`}
                />
              }
              typeToConfirm={confirmText}
              okText="Erase permanently"
              onConfirm={() => erase.mutateAsync(undefined)}
            />
          )
        }
      />
      <DataState query={q} rows={12}>
        {(p) => (
          <Row gutter={[24, 24]}>
            <Col xs={24} xl={16}>
              <Card>
                <Tabs
                  items={[
                    { key: 'docs', label: `Documents (${p.documents.length})`, children: <DocumentsTable docs={p.documents} /> },
                    { key: 'sessions', label: `Verifications (${p.sessions.length})`, children: <SessionsTable sessions={p.sessions} /> },
                    ...(p.partyType === 'PERSON' ? [{ key: 'faces', label: `Face templates (${p.faceTemplates.length})`, children: <FaceTemplates p={p} /> }] : []),
                    {
                      key: 'relations',
                      label: `Relations (${p.relations.length})`,
                      children: (
                        <Table
                          size="small"
                          rowKey={(r) => `${r.relationType}-${r.otherPartyId}`}
                          pagination={false}
                          dataSource={p.relations}
                          locale={{ emptyText: 'No relations' }}
                          columns={[
                            { title: 'Relation', dataIndex: 'relationType', render: (v: string) => <span title={v}>{humanize(v)}</span> },
                            { title: 'With', render: (_, r) => <Link to={`/people/${r.otherPartyId}`}>{r.otherPartyName ?? `#${r.otherPartyId}`}</Link> },
                            { title: 'Share', dataIndex: 'sharePct', align: 'right', render: (v: number | null) => (v === null ? '—' : <span className="tabular">{v}%</span>) },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Flex vertical gap={24}>
                <Card>
                  <SectionTitle title={p.organization ? 'Company details' : 'Personal data'} />
                  <PersonalData p={p} />
                </Card>
                <TechnicalDetails
                  summary="Party ID and record status"
                  items={[
                    { label: 'Party ID', value: <IdText value={p.publicId} /> },
                    { label: 'Internal ID', value: <span className="ct-mono">{p.id}</span> },
                    { label: 'Record status', value: humanize(p.status) },
                  ]}
                />
              </Flex>
            </Col>
          </Row>
        )}
      </DataState>
    </>
  );
}
