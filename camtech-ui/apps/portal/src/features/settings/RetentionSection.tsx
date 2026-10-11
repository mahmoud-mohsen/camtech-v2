import { LockOutlined } from '@ant-design/icons';
import type { RetentionPolicy } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Typography } from 'antd';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { SectionTitle, TableFrame } from '../../components/ui';
import { t } from '../../i18n';
import { qk } from '../../lib/hooks';
import { retentionCategoryLabel } from '../../lib/labels';
import { api } from '../../api/client';

/** Settings › Data retention: how long each kind of data is kept (read-only, set by CamTech). */
export function RetentionSection() {
  const q = useQuery({ queryKey: qk.retention, queryFn: api.retentionPolicies, staleTime: 5 * 60_000 });
  return (
    <>
      <SectionTitle
        title={t('retention.title')}
        sub={t('retention.help')}
        extra={
          <Tag icon={<LockOutlined />} variant="filled" className="ct-pill">
            {t('retention.readOnly')}
          </Tag>
        }
      />
      <DataState query={q} rows={4}>
        {(list) => (
          <TableFrame>
          <Table<RetentionPolicy>
            rowKey="id"
            pagination={false}
            dataSource={list}
            scroll={{ x: 720 }}
            columns={[
              {
                title: t('retention.col.category'),
                dataIndex: 'dataCategory',
                render: (v: string) => (
                  <span>
                    {retentionCategoryLabel(v)}{' '}
                    <Typography.Text type="secondary" className="ct-mono" style={{ fontSize: 12 }}>
                      {v}
                    </Typography.Text>
                  </span>
                ),
              },
              { title: t('retention.col.days'), dataIndex: 'retentionDays', width: 140, render: (v: number) => <Typography.Text strong className="tabular">{t('retention.days', { n: v })}</Typography.Text> },
              { title: t('retention.col.description'), dataIndex: 'description', render: (v: string | null) => v ?? '—' },
              { title: t('retention.col.updated'), dataIndex: 'updatedAt', width: 160, render: (v: string | null) => (
                  <span className="ct-meta">
                    <DateText value={v} dateOnly />
                  </span>
                ),
              },
            ]}
          />
          </TableFrame>
        )}
      </DataState>
    </>
  );
}
