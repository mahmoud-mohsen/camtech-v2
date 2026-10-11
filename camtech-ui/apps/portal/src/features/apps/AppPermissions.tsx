import type { ClientApp, Permission } from '@camtech/api-client';
import { Alert, Flex, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { qk, useApiMutation } from '../../lib/hooks';
import { featureLabel, FLOW_HELP } from '../../lib/labels';
import { api } from '../../api/client';
import { useNoPermissionText, usePermissions, useTenantInfo } from '../../auth/useAuth';

interface Row {
  code: string;
  kind: 'Flow' | 'Feature';
  inPlan: boolean;
}

/** Per-app switches. An app can only be narrowed: it never gets more than the tenant's plan. */
export function AppPermissions({ app }: { app: ClientApp }) {
  const info = useTenantInfo();
  const { canBuild } = usePermissions();
  const noPermission = useNoPermissionText();
  const [pending, setPending] = useState<string | null>(null);
  const save = useApiMutation((perms: Permission[]) => api.updatePermissions(app.id, perms), {
    success: 'Permissions saved',
    invalidate: [qk.clientApps, qk.capabilities(app.id)],
    onSuccess: () => setPending(null),
    onError: () => {
      setPending(null);
    },
  });

  const rows: Row[] = [
    ...info.flows.map((f) => ({ code: f.code, kind: 'Flow' as const, inPlan: f.enabled })),
    ...info.features.map((f) => ({ code: f.code, kind: 'Feature' as const, inPlan: f.enabled })),
  ];
  const allowed = (c: string) => app.permissions.find((p) => p.featureCode === c)?.allowed ?? false;

  const change = (code: string, on: boolean) => {
    setPending(code);
    // PUT replaces the whole list, so always send every feature (tenant-disabled ones stay off).
    save.mutate(rows.map((r) => ({ featureCode: r.code, allowed: r.inPlan && (r.code === code ? on : allowed(r.code)) })));
  };

  return (
    <Flex vertical gap={12}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        Choose what this app may use. Anything outside your plan stays off; ask CamTech to add it to your tenant first. Turning off {featureLabel('FACE_ENROLLMENT')} also
        stops this app's selfie ID verifications from registering faces.
      </Typography.Paragraph>
      {app.status !== 'ACTIVE' && <Alert type="warning" showIcon title="This app is disabled, so it can't use anything until you enable it." />}
      <Table<Row>
        size="small"
        rowKey="code"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: 'Feature',
            render: (_, r) => (
              <Flex vertical>
                <span>
                  {featureLabel(r.code)}{' '}
                  <Tag variant="filled" className="ct-mono" style={{ fontSize: 12, marginInlineStart: 4 }}>
                    {r.code}
                  </Tag>
                </span>
                {FLOW_HELP[r.code] && (
                  <span className="ct-meta">{FLOW_HELP[r.code]}</span>
                )}
              </Flex>
            ),
          },
          { title: 'Type', dataIndex: 'kind', width: 90, render: (v: string) => <Typography.Text type="secondary">{v}</Typography.Text> },
          {
            title: 'Your plan',
            width: 120,
            render: (_, r) => (r.inPlan ? (
                <Tag color="success" variant="filled" className="ct-pill">
                  Included
                </Tag>
              ) : (
                <Tag variant="filled" className="ct-pill">
                  Not included
                </Tag>
              )),
          },
          {
            title: 'Allowed',
            width: 90,
            align: 'center',
            render: (_, r) => (
              <Tooltip title={!r.inPlan ? 'Not in your plan' : canBuild ? undefined : noPermission}>
                <Switch
                  checked={r.inPlan && allowed(r.code)}
                  disabled={!canBuild || !r.inPlan || (save.isPending && pending !== r.code)}
                  loading={save.isPending && pending === r.code}
                  onChange={(v) => change(r.code, v)}
                  aria-label={`Allow ${featureLabel(r.code)}`}
                />
              </Tooltip>
            ),
          },
        ]}
      />
    </Flex>
  );
}
