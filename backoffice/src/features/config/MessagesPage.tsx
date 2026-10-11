import { EditOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Form, Input, Modal, Segmented, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { catalogApi } from '../../api/configuration';
import type { ReasonCode } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { useApiMutation, useReasonCodes } from '../../lib/hooks';
import { REASON_CATEGORY_LABELS } from '../../lib/labels';

function EditMessage({ r, onClose }: { r: ReasonCode; onClose: () => void }) {
  const [form] = Form.useForm<{ messageEn: string; messageAr: string }>();
  const save = useApiMutation((v: { messageEn: string; messageAr: string }) => catalogApi.updateReasonCode(r.code, { messageEn: v.messageEn.trim(), messageAr: v.messageAr?.trim() || null }), {
    success: 'Message saved',
    invalidate: [['reason-codes']],
    onSuccess: onClose,
  });
  return (
    <Modal open title={<span>Edit message <Typography.Text code>{r.code}</Typography.Text></span>} okText="Save" width={640} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">This text is shown to the person in the app when this happens. Keep it short and tell them what to do.</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ messageEn: r.messageEn, messageAr: r.messageAr ?? '' }} onFinish={(v) => save.mutate(v)}>
        <Form.Item name="messageEn" label="English" rules={[{ required: true, message: 'The English message is required' }]}>
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
        <Form.Item name="messageAr" label="Arabic (العربية)" extra="Optional. If empty the app falls back to English.">
          <Input.TextArea rows={2} maxLength={300} showCount dir="rtl" className="rtl-input" lang="ar" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function MessagesPage() {
  const { isAdmin } = usePermissions();
  const q = useReasonCodes();
  const [category, setCategory] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ReasonCode | null>(null);
  const categories = useMemo(() => [...new Set((q.data ?? []).map((r) => r.category))], [q.data]);

  return (
    <>
      <PageHeader title="Messages" help="What people see in the app when a check fails or something goes wrong, in English and Arabic. Grouped by where it happens." />
      <ReadOnlyHint what="messages" />
      <DataState query={q} isEmpty={(d) => d.length === 0}>
        {(codes) => {
          const s = search.trim().toLowerCase();
          const filtered = codes.filter(
            (r) => (category === 'ALL' || r.category === category) && (!s || r.code.toLowerCase().includes(s) || r.messageEn.toLowerCase().includes(s) || (r.messageAr ?? '').includes(search.trim())),
          );
          const groups = categories.filter((c) => filtered.some((r) => r.category === c));
          return (
            <>
              <Flex gap={8} wrap style={{ marginBottom: 16 }}>
                <Segmented
                  value={category}
                  onChange={(v) => setCategory(String(v))}
                  options={[{ label: 'All', value: 'ALL' }, ...categories.map((c) => ({ label: REASON_CATEGORY_LABELS[c] ?? c, value: c }))]}
                />
                <Input.Search allowClear placeholder="Search code or text" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
              </Flex>
              <Flex vertical gap={16}>
                {groups.map((c) => (
                  <Card key={c} size="small" title={REASON_CATEGORY_LABELS[c] ?? c}>
                    <Table<ReasonCode>
                      size="small"
                      rowKey="code"
                      pagination={false}
                      dataSource={filtered.filter((r) => r.category === c)}
                      scroll={{ x: 900 }}
                      columns={[
                        { title: 'Code', dataIndex: 'code', width: 200, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
                        { title: 'English', dataIndex: 'messageEn' },
                        {
                          title: 'Arabic',
                          dataIndex: 'messageAr',
                          render: (v: string | null) =>
                            v ? <div dir="rtl" lang="ar" style={{ textAlign: 'right' }}>{v}</div> : <Tag variant="filled" className="ct-pill" color="warning">Missing</Tag>,
                        },
                        { title: 'HTTP', dataIndex: 'httpStatus', width: 70, render: (v: number) => <span className="tabular">{v}</span> },
                        {
                          title: '',
                          width: 80,
                          align: 'right',
                          render: (_, r) => (
                            <Button size="small" icon={<EditOutlined />} disabled={!isAdmin} onClick={() => setEditing(r)}>
                              Edit
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ))}
                {groups.length === 0 && <Typography.Text type="secondary">No messages match.</Typography.Text>}
              </Flex>
            </>
          );
        }}
      </DataState>
      {editing && <EditMessage r={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
