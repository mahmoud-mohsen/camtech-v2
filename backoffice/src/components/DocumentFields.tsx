import { Table, Tag, Tooltip, Typography } from 'antd';
import type { DocumentField } from '../api/types';
import { fieldLabel, FIELD_SOURCE_LABELS } from '../lib/labels';
import { Confidence } from './Misc';

const SOURCE_COLOR: Record<string, string> = { CLIENT_OCR: 'blue', SERVER_OCR: 'geekblue', MRZ: 'cyan', MANUAL: 'purple' };

export function SourceTag({ source }: { source: string }) {
  return (
    <Tooltip title={source}>
      <Tag color={SOURCE_COLOR[source] ?? 'default'} style={{ marginInlineEnd: 0 }}>
        {FIELD_SOURCE_LABELS[source] ?? source}
      </Tag>
    </Tooltip>
  );
}

/** Extracted document fields, with where each value came from. Grouped fields (e.g. partners) show their group. */
export function DocumentFieldsTable({ fields, compact = false }: { fields: DocumentField[]; compact?: boolean }) {
  const sorted = [...fields].sort((a, b) => (a.groupCode ?? '').localeCompare(b.groupCode ?? '') || (a.groupIdx ?? 0) - (b.groupIdx ?? 0));
  return (
    <Table<DocumentField>
      size="small"
      pagination={false}
      rowKey={(f) => `${f.fieldCode}-${f.lang}-${f.groupCode}-${f.groupIdx}`}
      dataSource={sorted}
      locale={{ emptyText: 'No fields extracted' }}
      columns={[
        {
          title: 'Field',
          render: (_, f) => (
            <span title={f.fieldCode}>
              {fieldLabel(f.fieldCode)}
              {f.groupCode && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {' '}
                  · {f.groupCode.toLowerCase()} {(f.groupIdx ?? 0) + 1}
                </Typography.Text>
              )}
            </span>
          ),
        },
        {
          title: 'Value',
          render: (_, f) => (
            <span dir={f.lang === 'ar' ? 'rtl' : undefined} className={f.lang === 'ar' ? undefined : 'tabular'}>
              {f.value ?? <Typography.Text type="secondary">empty</Typography.Text>}
            </span>
          ),
        },
        { title: 'Source', dataIndex: 'source', width: 130, render: (s: string) => <SourceTag source={s} /> },
        ...(compact ? [] : [{ title: 'Confidence', dataIndex: 'confidence', width: 100, align: 'right' as const, render: (c: number | null) => <Confidence value={c} /> }]),
      ]}
    />
  );
}
