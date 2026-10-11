import { BankOutlined, RightOutlined, UserOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Flex, Input, Segmented, Table, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { partiesApi } from '../../api/operations';
import type { PartySummary } from '../../api/types';
import { ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { PersonCell } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { useSearchState } from '../../lib/useSearchState';

export default function PeoplePage() {
  const navigate = useNavigate();
  const { values, set, reset, page, size } = useSearchState(['q', 'partyType'] as const);
  const filters = { q: values.q, partyType: values.partyType, page, size };
  const q = useQuery({ queryKey: ['parties', filters], queryFn: () => partiesApi.list(filters), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="People"
        help="Everyone (and every company) that has been verified or started a verification. Open a record to see their documents, faces and history."
      />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          key={values.q ?? ''}
          allowClear
          defaultValue={values.q}
          placeholder="Search name, customer ref or document number"
          onSearch={(v) => set({ q: v })}
          style={{ width: 360, maxWidth: '100%' }}
        />
        <Segmented
          value={values.partyType ?? ''}
          onChange={(v) => set({ partyType: String(v) })}
          options={[
            { label: 'All', value: '' },
            { label: 'People', value: 'PERSON', icon: <UserOutlined /> },
            { label: 'Companies', value: 'ORG', icon: <BankOutlined /> },
          ]}
        />
        {(values.q || values.partyType) && (
          <Button type="link" onClick={reset} style={{ fontWeight: 700 }}>
            Clear filters
          </Button>
        )}
      </Flex>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
          <Table<PartySummary>
            rowKey="id"
            loading={q.isPending}
            dataSource={q.data?.items}
            scroll={{ x: 900 }}
            rowClassName={() => 'clickable-row'}
            onRow={(r) => ({ onClick: () => navigate(`/people/${r.id}`) })}
            locale={{ emptyText: values.q ? 'Nobody matches this search' : 'No people yet' }}
            pagination={{
              current: page + 1,
              pageSize: size,
              total: q.data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (t, [a, b]) => `Showing ${a}–${b} of ${formatNumber(t)}`,
              onChange: (p, s) => set({ page: String(p - 1), size: String(s) }),
              style: { padding: '0 16px' },
            }}
            columns={[
              {
                title: 'Name',
                render: (_, r) => (
                  <PersonCell
                    name={r.displayName ?? 'No name'}
                    sub={r.externalRef ? `Customer ref ${r.externalRef}` : 'No customer ref'}
                    org={r.partyType === 'ORG'}
                  />
                ),
              },
              { title: 'Type', dataIndex: 'partyType', width: 100, render: (v: string) => (v === 'ORG' ? 'Company' : 'Person') },
              { title: 'Nationality', dataIndex: 'nationality', width: 110, render: (v: string | null) => v ?? <span className="ct-meta">—</span> },
              { title: 'Date of birth', dataIndex: 'dateOfBirth', width: 130, render: (v: string | null) => <DateText value={v} dateOnly /> },
              { title: 'Documents', dataIndex: 'documentsCount', width: 100, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
              { title: 'Verifications', dataIndex: 'sessionsCount', width: 110, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
              {
                title: 'Last verified',
                dataIndex: 'lastVerifiedAt',
                width: 150,
                render: (v: string | null) =>
                  v ? (
                    <span className="ct-meta tabular">
                      <DateText value={v} relative />
                    </span>
                  ) : (
                    <span className="ct-meta">Never</span>
                  ),
              },
              { title: 'Status', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={v === 'ACTIVE' ? 'success' : 'default'} variant="filled" className="ct-pill">{v === 'ACTIVE' ? 'Active' : v.charAt(0) + v.slice(1).toLowerCase()}</Tag> },
              { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
            ]}
          />
        </div>
      )}
    </>
  );
}
