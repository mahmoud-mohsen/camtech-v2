import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import type { DocumentSummary, FaceTemplate, PartyDetail, TenantSessionSummary } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Empty, Flex, Table, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState, ErrorState } from '../../components/DataState';
import { DetailColumns, SummaryStrip } from '../../components/DetailLayout';
import { DateText } from '../../components/DateText';
import { IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { DecisionTag, DocStatusTag, StatusTag, TemplateStatusTag } from '../../components/Tags';
import { t } from '../../i18n';
import { exportFileName, saveBlob } from '../../lib/download';
import { qk, useApiMutation, useDocumentSettings } from '../../lib/hooks';
import { docTypeLabel, flowLabel, mediaRoleLabel, PARTY_TYPE_LABELS } from '../../lib/labels';
import { maskDocumentNumber } from '../../lib/mask';
import { api } from '../../api/client';
import { describeError, usePermissions } from '../../auth/useAuth';
import { ExpiryText } from '../documents/ExpiryTag';

function ProfileCard({ p }: { p: PartyDetail }) {
  return (
    <Card>
      <SectionTitle title={t('person.profile')} />
      <Descriptions
        size="small"
        column={1}
        items={[
          { label: t('person.ref'), children: p.subjectRef ? <IdText value={p.subjectRef} /> : '—' },
          { label: t('people.col.type'), children: PARTY_TYPE_LABELS[p.partyType] ?? p.partyType },
          ...(p.organization
            ? [
                { label: 'Legal name', children: p.organization.legalNameEn ?? '—' },
                { label: 'Legal form', children: p.organization.legalForm ?? '—' },
              ]
            : []),
          { label: t('person.nationality'), children: p.nationality ?? p.person?.nationality ?? '—' },
          { label: t('person.dob'), children: <DateText value={p.dateOfBirth ?? p.person?.dateOfBirth} dateOnly /> },
          ...(p.person?.gender ? [{ label: t('person.gender'), children: p.person.gender }] : []),
          ...(p.person?.fullNameAr ? [{ label: 'الاسم', children: <span dir="rtl">{p.person.fullNameAr}</span> }] : []),
          { label: t('person.created'), children: <DateText value={p.createdAt} /> },
          { label: t('person.lastVerified'), children: <DateText value={p.lastVerifiedAt} relative /> },
        ]}
      />
    </Card>
  );
}

function DocumentsCard({ docs }: { docs: DocumentSummary[] }) {
  const navigate = useNavigate();
  const warningDays = useDocumentSettings().data?.expiryWarningDays ?? 30;
  return (
    <Card>
      <SectionTitle title={`${t('person.documents')} (${docs.length})`} />
      <Table<DocumentSummary>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={docs}
        scroll={{ x: 620 }}
        rowClassName={() => 'clickable-row'}
        onRow={(d) => ({ onClick: () => navigate(`/documents/${d.id}`) })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('documents.empty')} /> }}
        columns={[
          { title: t('documents.col.type'), dataIndex: 'docTypeCode', render: (v: string) => <span className="ct-strong">{docTypeLabel(v)}</span> },
          { title: t('documents.col.number'), dataIndex: 'documentNumber', render: (v: string | null) => <span className="ct-mono">{v ? maskDocumentNumber(v) : '—'}</span> },
          { title: t('documents.col.expiry'), dataIndex: 'expiryDate', width: 220, render: (v: string | null) => <ExpiryText value={v} warningDays={warningDays} /> },
          { title: t('documents.col.status'), dataIndex: 'status', width: 110, render: (v: string) => <DocStatusTag value={v} /> },
        ]}
      />
    </Card>
  );
}

function FacesCard({ p }: { p: PartyDetail }) {
  const { isOwner } = usePermissions();
  const revoke = useApiMutation((tpl: FaceTemplate) => api.revokeFaceTemplate(p.id, tpl.id), {
    success: t('person.revoked'),
    invalidate: [qk.party(p.id)],
  });
  return (
    <Card>
      <SectionTitle title={`${t('person.faces')} (${p.faceTemplates.length})`} sub={t('person.faces.help')} />
      <Table<FaceTemplate>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={p.faceTemplates}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('person.faces.empty')} /> }}
        columns={[
          { title: t('person.faces.col.role'), dataIndex: 'role', render: (v: string) => mediaRoleLabel(v) },
          { title: t('person.faces.col.status'), dataIndex: 'status', width: 200, render: (v: string) => <TemplateStatusTag value={v} /> },
          {
            title: t('person.faces.col.created'),
            dataIndex: 'createdAt',
            width: 150,
            render: (v: string) => (
              <span className="ct-meta">
                <DateText value={v} relative />
              </span>
            ),
          },
          {
            title: '',
            width: 110,
            align: 'right',
            render: (_, tpl) =>
              isOwner && tpl.status !== 'REVOKED' ? (
                <ConfirmAction
                  danger
                  label={t('person.revoke')}
                  buttonProps={{ size: 'small' }}
                  title={t('person.revoke.title')}
                  description={t('person.revoke.body')}
                  okText={t('person.revoke')}
                  onConfirm={() => revoke.mutateAsync(tpl)}
                />
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function VerificationsCard({ sessions }: { sessions: TenantSessionSummary[] }) {
  const navigate = useNavigate();
  return (
    <Card>
      <SectionTitle title={`${t('person.verifications')} (${sessions.length})`} />
      <Table<TenantSessionSummary>
        size="small"
        rowKey="publicId"
        pagination={sessions.length > 10 ? { pageSize: 10, size: 'small' } : false}
        dataSource={sessions}
        scroll={{ x: 620 }}
        rowClassName={() => 'clickable-row'}
        onRow={(s) => ({ onClick: () => navigate(`/verifications/${s.publicId}`) })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        columns={[
          { title: 'Flow', dataIndex: 'flowCode', render: (v: string) => <span className="ct-strong">{flowLabel(v)}</span> },
          { title: t('documents.col.status'), dataIndex: 'status', width: 120, render: (v: string) => <StatusTag value={v} /> },
          { title: 'Decision', dataIndex: 'decision', width: 120, render: (v: string | null) => <DecisionTag value={v} empty="—" /> },
          {
            title: t('reviews.col.created'),
            dataIndex: 'createdAt',
            width: 140,
            render: (v: string) => (
              <span className="ct-meta">
                <DateText value={v} relative />
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

export default function PersonDetailPage() {
  const { id = '' } = useParams();
  const numeric = Number(id);
  const valid = Number.isInteger(numeric) && numeric > 0;
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { isOwner } = usePermissions();
  const [exporting, setExporting] = useState(false);
  const q = useQuery({ queryKey: qk.party(numeric), queryFn: () => api.party(numeric), enabled: valid });
  const erase = useApiMutation(() => api.eraseParty(numeric), {
    success: t('person.erased'),
    invalidate: [['parties'], ['documents'], ['sessions'], ['dashboard'], ['review-cases'], qk.reviewSummary],
    onSuccess: () => navigate('/people', { replace: true }),
  });

  const exportData = async (p: PartyDetail) => {
    setExporting(true);
    try {
      saveBlob(await api.exportParty(p.id), exportFileName(p.publicId));
      message.success(t('person.exported'));
    } catch (e) {
      message.error(describeError(e));
    } finally {
      setExporting(false);
    }
  };

  if (!valid) return <ErrorState error={new Error('This person id is not valid.')} />;
  return (
    <DataState query={q} rows={10}>
      {(p) => {
        const confirmText = p.subjectRef ?? p.publicId;
        return (
          <>
            <PageHeader
              crumbs={[{ label: t('people.title'), to: '/people' }, { label: p.displayName ?? p.subjectRef ?? p.publicId }]}
              avatar={<PersonAvatar name={p.displayName ?? p.subjectRef} size={56} org={p.partyType === 'ORG'} />}
              title={p.displayName ?? p.subjectRef ?? p.publicId}
              documentTitle={p.displayName ?? t('people.title')}
              tags={
                <Flex gap={6}>
                  <Tag variant="filled" className="ct-pill">
                    {PARTY_TYPE_LABELS[p.partyType] ?? p.partyType}
                  </Tag>
                  {p.status !== 'ACTIVE' && (
                    <Tag color="default" variant="filled" className="ct-pill">
                      {p.status}
                    </Tag>
                  )}
                </Flex>
              }
              help={p.subjectRef ? `${t('person.ref')}: ${p.subjectRef}` : undefined}
              extra={
                isOwner && (
                  <>
                    <Tooltip title={t('person.export.tooltip')}>
                      <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportData(p)}>
                        {t('person.export')}
                      </Button>
                    </Tooltip>
                    <ConfirmAction
                      danger
                      label={t('person.erase')}
                      buttonProps={{ icon: <DeleteOutlined /> }}
                      title={t('person.erase.title')}
                      description={t('person.erase.body')}
                      okText={t('person.erase')}
                      typeToConfirm={confirmText}
                      onConfirm={() => erase.mutateAsync(undefined)}
                    />
                  </>
                )
              }
            />
            {!isOwner && <Alert type="info" showIcon title={t('person.ownerOnly')} style={{ marginBottom: 16 }} />}
            <SummaryStrip
              items={[
                { label: t('person.documents'), value: <span className="tabular">{p.documents.length}</span> },
                { label: t('people.col.verifications'), value: <span className="tabular">{p.sessions.length}</span> },
                { label: t('person.lastVerified'), value: <DateText value={p.lastVerifiedAt} relative /> },
                { label: t('person.created'), value: <DateText value={p.createdAt} relative /> },
              ]}
            />
            <DetailColumns
              main={
                <>
                  <DocumentsCard docs={p.documents} />
                  <VerificationsCard sessions={p.sessions} />
                  <FacesCard p={p} />
                </>
              }
              side={
                <>
                  <ProfileCard p={p} />
                  <TechnicalDetails items={[{ label: t('person.id'), value: <IdText value={p.publicId} /> }]} summary={t('person.id')} />
                </>
              }
            />
          </>
        );
      }}
    </DataState>
  );
}
