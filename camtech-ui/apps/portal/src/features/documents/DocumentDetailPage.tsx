import type { DocumentField, TenantScanSummary } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Empty, Table, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImageGallery } from '../../components/AuthImage';
import { DataState, ErrorState } from '../../components/DataState';
import { DetailColumns, SummaryStrip } from '../../components/DetailLayout';
import { DateText } from '../../components/DateText';
import { DocumentNumber } from '../../components/DocumentNumber';
import { Confidence, IdText } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar, SectionTitle, TechnicalDetails } from '../../components/ui';
import { DocStatusTag, ScanStatusTag } from '../../components/Tags';
import { t } from '../../i18n';
import { qk, useDocumentSettings } from '../../lib/hooks';
import { docTypeLabel, FIELD_SOURCE_LABELS, fieldLabel, humanize } from '../../lib/labels';
import { documentImages } from '../../lib/media';
import { api } from '../../api/client';
import { ExpiryText } from './ExpiryTag';

function FieldsTable({ fields }: { fields: DocumentField[] }) {
  if (!fields.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('document.noFields')} />;
  return (
    <Table<DocumentField>
      size="small"
      rowKey={(f) => `${f.fieldCode}-${f.lang ?? ''}-${f.groupIdx ?? ''}`}
      pagination={false}
      dataSource={fields}
      scroll={{ x: 560 }}
      columns={[
        {
          title: t('document.col.field'),
          width: 190,
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
        {
          title: t('document.col.value'),
          render: (_, f) =>
            f.value === null ? (
              <Typography.Text type="secondary">—</Typography.Text>
            ) : (
              <Typography.Text copyable={{ text: f.value }} dir={f.lang === 'ar' ? 'rtl' : undefined} style={{ overflowWrap: 'anywhere' }}>
                {f.value}
              </Typography.Text>
            ),
        },
        { title: t('document.col.source'), dataIndex: 'source', width: 150, render: (v: string | null) => <Typography.Text type="secondary">{v ? (FIELD_SOURCE_LABELS[v] ?? humanize(v)) : '—'}</Typography.Text> },
        { title: t('document.col.confidence'), dataIndex: 'confidence', width: 120, render: (v: number | null) => <Confidence value={v} /> },
      ]}
    />
  );
}

function ScansCard({ scans }: { scans: TenantScanSummary[] }) {
  const navigate = useNavigate();
  return (
    <Card>
      <SectionTitle title={t('document.scans')} />
      {scans.length === 0 ? (
        <Typography.Text type="secondary">{t('document.noScans')}</Typography.Text>
      ) : (
        <Table<TenantScanSummary>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={scans}
          rowClassName={() => 'clickable-row'}
          onRow={(r) => ({ onClick: () => navigate(`/scans/${r.id}`) })}
          columns={[
            {
              title: t('reviews.col.scanned'),
              dataIndex: 'createdAt',
              render: (v: string) => (
                <span className="ct-meta">
                  <DateText value={v} relative />
                </span>
              ),
            },
            { title: t('documents.col.status'), dataIndex: 'status', width: 120, render: (v: string) => <ScanStatusTag value={v} /> },
            { title: t('reviews.col.confidence'), dataIndex: 'confidence', width: 110, render: (v: number | null) => <Confidence value={v} /> },
          ]}
        />
      )}
    </Card>
  );
}

export default function DocumentDetailPage() {
  const { id = '' } = useParams();
  const numeric = Number(id);
  const valid = Number.isInteger(numeric) && numeric > 0;
  const q = useQuery({ queryKey: qk.document(numeric), queryFn: () => api.document(numeric), enabled: valid });
  const warningDays = useDocumentSettings().data?.expiryWarningDays ?? 30;
  if (!valid) return <ErrorState error={new Error('This document id is not valid.')} />;
  return (
    <DataState query={q} rows={10}>
      {(d) => (
        <>
          <PageHeader
            crumbs={[{ label: t('documents.title'), to: '/documents' }, { label: docTypeLabel(d.docTypeCode) }]}
            avatar={d.partyName ? <PersonAvatar name={d.partyName} size={56} /> : undefined}
            title={`${docTypeLabel(d.docTypeCode)}${d.partyName ? ` · ${d.partyName}` : ''}`}
            documentTitle={`${docTypeLabel(d.docTypeCode)} #${d.id}`}
            tags={<DocStatusTag value={d.status} />}
            help={
              <span className="ct-meta">
                <DateText value={d.createdAt} relative />
              </span>
            }
          />
          <SummaryStrip
            items={[
              { label: t('documents.col.type'), value: docTypeLabel(d.docTypeCode) },
              { label: t('documents.col.number'), value: <DocumentNumber value={d.documentNumber} /> },
              { label: t('documents.col.expiry'), value: <ExpiryText value={d.expiryDate} warningDays={warningDays} hideExpired={d.status === 'EXPIRED'} /> },
              {
                label: t('document.person'),
                value: d.partyId ? <Link to={`/people/${d.partyId}`}>{d.partyName ?? `#${d.partyId}`}</Link> : (d.partyName ?? '—'),
              },
            ]}
          />
          <DetailColumns
            main={
              <>
                <Card>
                  <SectionTitle title={t('media.title')} />
                  <ImageGallery items={documentImages(d.media)} height={240} />
                </Card>
                <Card>
                  <SectionTitle title={t('document.fields', { n: d.fields.length })} />
                  <FieldsTable fields={d.fields} />
                </Card>
              </>
            }
            side={
              <>
                <Card>
                  <SectionTitle title={t('document.summary')} />
                  <Descriptions
                    size="small"
                    column={1}
                    items={[
                      { label: t('documents.col.country'), children: d.issuingCountry ?? '—' },
                      { label: t('document.issuer'), children: d.issuerCode ?? '—' },
                      { label: t('document.issueDate'), children: <DateText value={d.issueDate} dateOnly /> },
                      { label: t('documents.col.added'), children: <DateText value={d.createdAt} /> },
                    ]}
                  />
                </Card>
                <ScansCard scans={d.scans} />
                <TechnicalDetails items={[{ label: 'Document ID', value: <IdText value={d.id} /> }]} summary="Document ID" />
              </>
            }
          />
        </>
      )}
    </DataState>
  );
}
