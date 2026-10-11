import { IdcardOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Descriptions, Flex, Row, Table } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { documentsApi } from '../../api/operations';
import type { ScanSummary } from '../../api/types';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { DocumentFieldsTable } from '../../components/DocumentFields';
import { MediaGallery } from '../../components/ImageViewer';
import { Confidence } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { DocStatusTag, ScanStatusTag } from '../../components/Tags';
import { IconTile, SectionTitle, TechnicalDetails } from '../../components/ui';
import { docTypeLabel } from '../../lib/labels';
import { ExpiryText } from '../../components/ExpiryText';

export default function DocumentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['document', Number(id)], queryFn: () => documentsApi.get(Number(id)) });
  const d = q.data;
  const title = d ? `${docTypeLabel(d.docTypeCode)} ${d.documentNumber ?? ''}`.trim() : 'Document';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Documents', to: '/documents' }, { label: title }]}
        avatar={d && <IconTile icon={<IdcardOutlined />} size={56} />}
        title={title}
        tags={d && <DocStatusTag value={d.status} />}
        help={
          d ? (
            <Flex vertical gap={2} component="span">
              <span>
                {d.partyName ? `Held by ${d.partyName}` : 'No holder linked'}
                {d.issuerCode ? ` · Issued by ${d.issuerCode}` : ''}
              </span>
              <span className="ct-meta">The values read from the document, where each value came from, and the images captured.</span>
            </Flex>
          ) : (
            'The values read from the document, where each value came from, and the images captured.'
          )
        }
      />
      <DataState query={q} rows={12}>
        {(d) => (
          <Row gutter={[24, 24]}>
            <Col xs={24} xl={15}>
              <Flex vertical gap={24}>
                <Card>
                  <SectionTitle title="Fields" sub="What was read and where each value came from" />
                  <DocumentFieldsTable fields={d.fields} />
                </Card>
                <Card>
                  <SectionTitle title="Server scans (OCR)" sub={d.scans.length ? `${d.scans.length} scans` : undefined} />
                  <Table<ScanSummary>
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={d.scans}
                    locale={{ emptyText: 'No server scans for this document' }}
                    rowClassName={() => 'clickable-row'}
                    onRow={(s) => ({ onClick: () => navigate(`/scans/${s.id}`) })}
                    columns={[
                      {
                        title: 'When',
                        dataIndex: 'createdAt',
                        render: (v: string) => (
                          <span className="ct-meta tabular">
                            <DateText value={v} relative />
                          </span>
                        ),
                      },
                      { title: 'Status', dataIndex: 'status', render: (v: string) => <ScanStatusTag value={v} /> },
                      { title: 'Confidence', dataIndex: 'confidence', align: 'right', render: (v: number | null) => <Confidence value={v} /> },
                      { title: 'Time', dataIndex: 'processingMs', align: 'right', render: (v: number | null) => (v === null ? '—' : <span className="tabular">{v} ms</span>) },
                      { title: 'Engine', dataIndex: 'ocrProvider', render: (v: string | null) => <span className="ct-meta">{v ?? '—'}</span> },
                    ]}
                  />
                </Card>
              </Flex>
            </Col>
            <Col xs={24} xl={9}>
              <Flex vertical gap={24}>
                <Card>
                  <SectionTitle title="Document" />
                  <Descriptions
                    column={1}
                    size="small"
                    items={[
                      { label: 'Type', children: docTypeLabel(d.docTypeCode) },
                      { label: 'Number', children: <span className="tabular">{d.documentNumber ?? '—'}</span> },
                      { label: 'Holder', children: d.partyId ? <Link to={`/people/${d.partyId}`}>{d.partyName ?? 'Open holder'}</Link> : '—' },
                      { label: 'Issuer', children: d.issuerCode ?? '—' },
                      { label: 'Country', children: d.issuingCountry ?? '—' },
                      { label: 'Issued', children: <DateText value={d.issueDate} dateOnly /> },
                      { label: 'Expires', children: <ExpiryText date={d.expiryDate} /> },
                      { label: 'Status', children: <DocStatusTag value={d.status} /> },
                      { label: 'Captured', children: <DateText value={d.createdAt} /> },
                    ]}
                  />
                </Card>
                <Card>
                  <SectionTitle title="Images" sub={d.media.length ? `${d.media.length} captured` : undefined} />
                  <MediaGallery items={d.media} size={110} />
                </Card>
                <TechnicalDetails
                  summary="Document ID, holder ID and image IDs"
                  items={[
                    { label: 'Document ID', value: <span className="ct-mono">{d.id}</span> },
                    { label: 'Holder ID', value: d.partyId === null ? null : <span className="ct-mono">{d.partyId}</span> },
                    { label: 'Document type', value: <span className="ct-mono">{d.docTypeCode}</span> },
                    { label: 'Image IDs', value: d.media.length ? <span className="ct-mono">{d.media.map((m) => m.id).join(', ')}</span> : null },
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
