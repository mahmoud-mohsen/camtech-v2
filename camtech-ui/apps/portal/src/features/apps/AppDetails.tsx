import type { ClientApp, ClientAppUpdate } from '@camtech/api-client';
import { App, AutoComplete, Button, Descriptions, Flex, Form, Input, Switch, Typography } from 'antd';
import { useEffect } from 'react';
import { ActiveTag } from '../../components/Tags';
import { DateText } from '../../components/DateText';
import { qk, useApiMutation } from '../../lib/hooks';
import { channelLabel, PLATFORM_OPTIONS } from '../../lib/labels';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { OriginsEditor } from './OriginsEditor';
import { WebSecretWarning } from './WebSecretWarning';

interface Values {
  name: string;
  platform?: string;
  appIdentifier?: string;
  allowedOrigins: string[];
}

export function AppDetails({ app }: { app: ClientApp }) {
  const [form] = Form.useForm<Values>();
  const { modal } = App.useApp();
  const { canBuild } = usePermissions();
  useEffect(() => {
    form.setFieldsValue({ name: app.name, platform: app.platform ?? undefined, appIdentifier: app.appIdentifier ?? undefined, allowedOrigins: app.allowedOrigins });
  }, [app, form]);

  const save = useApiMutation(
    (v: Values) => {
      const body: ClientAppUpdate = {
        name: v.name.trim(),
        platform: v.platform?.trim() || null,
        appIdentifier: v.appIdentifier?.trim() || null,
        allowedOrigins: v.allowedOrigins ?? [],
      };
      return api.updateClientApp(app.id, body);
    },
    { success: 'App saved', invalidate: [qk.clientApps, qk.capabilities(app.id)] },
  );
  const setStatus = useApiMutation((status: ClientApp['status']) => api.updateClientApp(app.id, { status }), {
    success: (a) => (a.status === 'ACTIVE' ? 'App enabled' : 'App disabled'),
    invalidate: [qk.clientApps, qk.capabilities(app.id)],
  });

  const toggle = (on: boolean) => {
    if (on) {
      setStatus.mutate('ACTIVE');
      return;
    }
    modal.confirm({
      title: `Disable ${app.name}?`,
      content: "It can't start new verifications until you enable it again. Verifications already running are not affected.",
      okText: 'Disable app',
      okButtonProps: { danger: true },
      onOk: () => setStatus.mutateAsync('DISABLED'),
    });
  };

  return (
    <Flex vertical gap={16}>
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        items={[
          { label: 'Code', children: <Typography.Text code copyable>{app.code}</Typography.Text> },
          { label: 'Channel', children: channelLabel(app.channel) },
          { label: 'Created', children: <DateText value={app.createdAt} dateOnly /> },
          {
            label: 'Status',
            children: (
              <Flex gap={8} align="center">
                <Switch checked={app.status === 'ACTIVE'} loading={setStatus.isPending} onChange={toggle} disabled={!canBuild} aria-label="App enabled" />
                <ActiveTag value={app.status} />
              </Flex>
            ),
          },
        ]}
      />
      {!canBuild && <ReadOnlyNotice compact />}
      {app.channel === 'WEB' && <WebSecretWarning />}
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} requiredMark="optional" disabled={!canBuild}>
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { max: 100 }]}>
          <Input />
        </Form.Item>
        <Flex gap={16} wrap>
          <Form.Item name="platform" label="Platform" style={{ flex: '1 1 200px' }}>
            <AutoComplete options={(PLATFORM_OPTIONS[app.channel] ?? []).map((value) => ({ value }))} placeholder={app.channel === 'WEB' ? 'Browser' : 'iOS / Android'} />
          </Form.Item>
          {app.channel === 'MOBILE' && (
            <Form.Item name="appIdentifier" label="App identifier" extra="Bundle id / package name." style={{ flex: '1 1 200px' }}>
              <Input placeholder="com.example.app" style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          )}
        </Flex>
        {app.channel === 'WEB' && (
          <Form.Item name="allowedOrigins" label="Allowed origins" extra="Websites allowed to run the SDK for this app. Requests from any other origin are refused (ORIGIN_NOT_ALLOWED).">
            <OriginsEditor />
          </Form.Item>
        )}
        {canBuild && (
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            Save changes
          </Button>
        )}
      </Form>
    </Flex>
  );
}
