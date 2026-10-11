import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Empty, Flex, Form, Input, Modal, Popconfirm, Select, Table, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { settingsApi, tenantSettingsApi } from '../../api/configuration';
import type { ConfigKey, ConfigParam } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { useApiMutation, useFlows, useTenantClientApps, useTenantConfigParams, useTenants } from '../../lib/hooks';
import { CHANNEL_LABELS, flowLabel } from '../../lib/labels';
import { groupOf, isGlobal, keyTitle, rangeText, scopeLabel, scopeRank, valueRule, winner, type ResolveContext } from './settingsLogic';
import { ValueInput } from './ValueInput';

function displayValue(v: string, k: ConfigKey | undefined) {
  if (k?.type === 'BOOLEAN') return <Tag variant="filled" className="ct-pill" color={v === 'true' ? 'success' : 'default'}>{v === 'true' ? 'On' : 'Off'}</Tag>;
  if (k?.type === 'LIST') return <Flex gap={4} wrap>{v.split(',').filter(Boolean).map((x) => <Tag variant="filled" className="ct-pill" key={x}>{x.trim()}</Tag>)}</Flex>;
  return <Typography.Text strong className="tabular">{v}</Typography.Text>;
}

function EditModal({ tenantId, param, k, onClose }: { tenantId: number; param: ConfigParam; k: ConfigKey; onClose: () => void }) {
  const [form] = Form.useForm<{ paramValue: string }>();
  const save = useApiMutation((v: { paramValue: string }) => tenantSettingsApi(tenantId).update(param.id, v.paramValue), {
    success: 'Settings saved',
    invalidate: [['config-params'], ['capabilities']],
    onSuccess: onClose,
  });
  return (
    <Modal open title={`Edit ${param.paramKey}`} okText="Save" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">{k.description}</Typography.Paragraph>
      <Typography.Paragraph>Scope: <b>{scopeLabel(param)}</b></Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ paramValue: param.paramValue }} onFinish={(v) => save.mutate(v)}>
        <Form.Item name="paramValue" label="Value" extra={`${rangeText(k)} · default ${k.defaultValue}`} rules={[valueRule(k)]}>
          <ValueInput configKey={k} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface AddValues {
  paramKey: string;
  flowCode?: string;
  channel?: string;
  clientAppCode?: string;
  paramValue: string;
}

function AddOverrideModal({ tenantId, keys, initialKey, onClose }: { tenantId: number; keys: ConfigKey[]; initialKey?: string; onClose: () => void }) {
  const [form] = Form.useForm<AddValues>();
  const flows = useFlows();
  const apps = useTenantClientApps(tenantId);
  const keyCode = Form.useWatch('paramKey', form);
  const k = keys.find((x) => x.key === keyCode);
  const create = useApiMutation(
    (v: AddValues) => tenantSettingsApi(tenantId).create({ paramKey: v.paramKey, flowCode: v.flowCode ?? null, channel: v.channel ?? null, clientAppCode: v.clientAppCode ?? null, paramValue: v.paramValue }),
    { success: 'Override added', invalidate: [['config-params'], ['capabilities']], onSuccess: onClose },
  );
  return (
    <Modal open title="Add override" okText="Add override" width={600} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        An override changes a setting only for a specific flow, channel or client app. Pick at least one. The most specific match wins (client app &gt; channel &gt; flow &gt; global).
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ paramKey: initialKey, paramValue: keys.find((x) => x.key === initialKey)?.defaultValue }}
        onValuesChange={(changed) => {
          if ('paramKey' in changed) form.setFieldValue('paramValue', keys.find((x) => x.key === changed.paramKey)?.defaultValue);
        }}
        onFinish={(v) => create.mutate(v)}
      >
        <Form.Item name="paramKey" label="Setting" rules={[{ required: true, message: 'Pick a setting' }]} extra={k?.description}>
          <Select
            showSearch
            placeholder="Pick a setting"
            optionFilterProp="label"
            options={keys.map((x) => ({ value: x.key, label: x.key, title: x.description }))}
            optionRender={(o) => (
              <div>
                <div className="ct-mono">{o.value}</div>
                <span className="ct-meta" style={{ whiteSpace: 'normal' }}>{keys.find((x) => x.key === o.value)?.description}</span>
              </div>
            )}
          />
        </Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="flowCode" label="Flow" style={{ flex: '1 1 160px' }}>
            <Select allowClear placeholder="Any flow" options={(flows.data ?? []).map((f) => ({ value: f.code, label: f.name }))} />
          </Form.Item>
          <Form.Item name="channel" label="Channel" style={{ flex: '1 1 120px' }}>
            <Select allowClear placeholder="Any channel" options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="clientAppCode" label="Client app" style={{ flex: '1 1 140px' }}>
            <Select allowClear placeholder="Any app" options={(apps.data ?? []).map((a) => ({ value: a.code, label: a.name }))} />
          </Form.Item>
        </Flex>
        <Form.Item
          noStyle
          shouldUpdate={(a, b) => a.flowCode !== b.flowCode || a.channel !== b.channel || a.clientAppCode !== b.clientAppCode}
        >
          {({ getFieldsValue }) => {
            const v = getFieldsValue();
            return !v.flowCode && !v.channel && !v.clientAppCode ? (
              <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Pick a flow, channel or client app. To change the global default, edit it in the table instead." />
            ) : null;
          }}
        </Form.Item>
        {k && (
          <Form.Item name="paramValue" label="Value" extra={`${rangeText(k)} · default ${k.defaultValue}`} rules={[valueRule(k)]}>
            <ValueInput configKey={k} />
          </Form.Item>
        )}
        <Form.Item
          name="_scope"
          hidden
          dependencies={['flowCode', 'channel', 'clientAppCode']}
          rules={[
            ({ getFieldValue }) => ({
              validator: () =>
                getFieldValue('flowCode') || getFieldValue('channel') || getFieldValue('clientAppCode') ? Promise.resolve() : Promise.reject(new Error('Pick a scope')),
            }),
          ]}
        >
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function KeyCard({ tenantId, k, params, ctx, keys, onAdd }: { tenantId: number; k: ConfigKey; params: ConfigParam[]; ctx: ResolveContext; keys: ConfigKey[]; onAdd: (key: string) => void }) {
  const { isAdmin } = usePermissions();
  const [editing, setEditing] = useState<ConfigParam | null>(null);
  const remove = useApiMutation((p: ConfigParam) => tenantSettingsApi(tenantId).remove(p.id), { success: 'Override removed', invalidate: [['config-params'], ['capabilities']] });
  const win = winner(params, ctx);
  const rows = [...params].sort((a, b) => scopeRank(a) - scopeRank(b));
  const ctxSet = !!(ctx.flowCode || ctx.channel || ctx.clientAppCode);
  return (
    <Card
      size="small"
      title={
        <Flex vertical gap={0} style={{ padding: '4px 0', whiteSpace: 'normal' }}>
          <span>
            {keyTitle(k.key)} <span className="ct-mono" style={{ fontWeight: 400, color: 'var(--ct-text-secondary)' }}>{k.key}</span>
          </span>
          <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>{k.description}</Typography.Text>
        </Flex>
      }
      extra={
        <Flex gap={8} align="center">
          <Tooltip title={ctxSet ? 'Value used for the selected context' : 'Value used when no override applies'}>
            <Flex gap={6} align="center">
              <Typography.Text type="secondary">In effect:</Typography.Text>
              {win ? displayValue(win.paramValue, k) : displayValue(k.defaultValue, k)}
            </Flex>
          </Tooltip>
          {isAdmin && <Button size="small" icon={<PlusOutlined />} onClick={() => onAdd(k.key)}>Override</Button>}
        </Flex>
      }
    >
      <Table<ConfigParam>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={rows}
        rowClassName={(p) => (win?.id === p.id && ctxSet ? 'row-warning' : '')}
        columns={[
          {
            title: 'Scope',
            render: (_, p) => (
              <Flex gap={6} align="center" wrap>
                <span>{scopeLabel(p)}</span>
                {win?.id === p.id && <Tag variant="filled" className="ct-pill" color="success">Wins</Tag>}
                {!win || win.id !== p.id ? (ctxSet && !isGlobal(p) && win ? <span className="ct-meta">not used here</span> : null) : null}
              </Flex>
            ),
          },
          { title: 'Value', width: 220, render: (_, p) => displayValue(p.paramValue, k) },
          {
            title: 'Last changed',
            width: 200,
            render: (_, p) => (
              <span>
                <DateText value={p.updatedAt} relative />
                {p.updatedBy && <Typography.Text type="secondary"> by {p.updatedBy}</Typography.Text>}
              </span>
            ),
          },
          {
            title: '',
            width: 100,
            align: 'right',
            render: (_, p) => (
              <Flex gap={4} justify="flex-end">
                <Tooltip title={isAdmin ? 'Edit value' : 'Only administrators can change settings'}>
                  <Button size="small" type="text" icon={<EditOutlined />} disabled={!isAdmin} onClick={() => setEditing(p)} aria-label="Edit" />
                </Tooltip>
                {isAdmin && !isGlobal(p) && (
                  <Popconfirm title="Remove this override?" description={`${scopeLabel(p)} will use the next matching value.`} okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(p)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Remove" />
                  </Popconfirm>
                )}
                {isGlobal(p) && (
                  <Tooltip title="The global default can't be deleted">
                    <Button size="small" type="text" icon={<DeleteOutlined />} disabled aria-label="Can't delete" />
                  </Tooltip>
                )}
              </Flex>
            ),
          },
        ]}
      />
      {editing && <EditModal tenantId={tenantId} param={editing} k={keys.find((x) => x.key === editing.paramKey) ?? k} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** The settings of one tenant: each key with its value and overrides, and the value in effect for a flow, channel or app. */
export function TenantSettings({ tenantId }: { tenantId: number }) {
  const { isAdmin } = usePermissions();
  const keysQ = useQuery({ queryKey: ['config-keys'], queryFn: settingsApi.keys, staleTime: 5 * 60_000 });
  const paramsQ = useTenantConfigParams(tenantId);
  const flows = useFlows();
  const apps = useTenantClientApps(tenantId);
  const [ctx, setCtx] = useState<ResolveContext>({});
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null | undefined>(undefined);

  const groups = useMemo(() => {
    const keys = keysQ.data ?? [];
    const s = search.trim().toLowerCase();
    const filtered = keys.filter((k) => !s || k.key.toLowerCase().includes(s) || k.description.toLowerCase().includes(s));
    const map = new Map<string, ConfigKey[]>();
    filtered.forEach((k) => map.set(groupOf(k.key), [...(map.get(groupOf(k.key)) ?? []), k]));
    return [...map.entries()];
  }, [keysQ.data, search]);

  // Keys with params but missing from the catalogue are still shown.
  const unknownKeys = useMemo(() => {
    const known = new Set((keysQ.data ?? []).map((k) => k.key));
    return [...new Set((paramsQ.data ?? []).map((p) => p.paramKey))].filter((k) => !known.has(k));
  }, [keysQ.data, paramsQ.data]);

  return (
    <>
      <Flex gap={8} wrap align="center" style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder="Search settings" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>Show the value in effect for:</Typography.Text>
        <Select allowClear placeholder="Any flow" style={{ width: 200 }} value={ctx.flowCode} onChange={(v) => setCtx((c) => ({ ...c, flowCode: v }))} options={(flows.data ?? []).map((f) => ({ value: f.code, label: flowLabel(f.code) }))} />
        <Select allowClear placeholder="Any channel" style={{ width: 150 }} value={ctx.channel} onChange={(v) => setCtx((c) => ({ ...c, channel: v }))} options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
        <Select allowClear placeholder="Any client app" style={{ width: 170 }} value={ctx.clientAppCode} onChange={(v) => setCtx((c) => ({ ...c, clientAppCode: v }))} options={(apps.data ?? []).map((a) => ({ value: a.code, label: a.name }))} />
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(null)} style={{ marginInlineStart: 'auto' }}>
            Add override
          </Button>
        )}
      </Flex>
      <DataState query={keysQ} rows={10}>
        {(keys) => (
          <DataState query={paramsQ} rows={10}>
            {(params) =>
              groups.length === 0 ? (
                <Empty description="No settings match your search" />
              ) : (
                <Flex vertical gap={24}>
                  {groups.map(([group, list]) => (
                    <div key={group}>
                      <Typography.Title level={5} style={{ marginTop: 0 }}>{group}</Typography.Title>
                      <Flex vertical gap={12}>
                        {list.map((k) => (
                          <KeyCard key={k.key} tenantId={tenantId} k={k} keys={keys} ctx={ctx} params={params.filter((p) => p.paramKey === k.key)} onAdd={(key) => setAdding(key)} />
                        ))}
                      </Flex>
                    </div>
                  ))}
                  {unknownKeys.length > 0 && (
                    <Alert type="warning" showIcon title="Settings not in the catalogue" description={unknownKeys.join(', ')} />
                  )}
                </Flex>
              )
            }
          </DataState>
        )}
      </DataState>
      {adding !== undefined && keysQ.data && <AddOverrideModal tenantId={tenantId} keys={keysQ.data} initialKey={adding ?? undefined} onClose={() => setAdding(undefined)} />}
    </>
  );
}

export default function SettingsPage() {
  const tenants = useTenants();
  const [params, setParams] = useSearchParams();
  const fallback = tenants.data?.find((t) => t.isDefault) ?? tenants.data?.[0];
  const tenantId = Number(params.get('tenant')) || fallback?.id;
  return (
    <>
      <PageHeader
        title="Settings"
        help="Thresholds and limits used during verification, per tenant. Each setting has a tenant-wide value and optional overrides for a flow, a channel or a client app — the most specific one wins."
        extra={
          <Flex gap={8} align="center">
            <Typography.Text type="secondary">Tenant</Typography.Text>
            <Select
              style={{ width: 240 }}
              loading={tenants.isPending}
              value={tenantId}
              onChange={(v: number) => setParams((p) => { p.set('tenant', String(v)); return p; }, { replace: true })}
              options={(tenants.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
              showSearch
              optionFilterProp="label"
              aria-label="Tenant"
            />
          </Flex>
        }
      />
      <ReadOnlyHint what="settings" />
      {tenantId !== undefined && <TenantSettings key={tenantId} tenantId={tenantId} />}
    </>
  );
}
