import { ApiOutlined, AppstoreOutlined, CheckCircleFilled, ExperimentOutlined, KeyOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Progress, theme, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClientApps, useWebhooks } from '../../lib/hooks';

interface Step {
  key: string;
  title: string;
  body: string;
  icon: ReactNode;
  done: boolean;
  action: string;
  to: string;
}

/** Shown while the tenant has no verifications yet: the four steps to a first one. */
export function GetStarted({ hasSessions }: { hasSessions: boolean }) {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const apps = useClientApps();
  const hooks = useWebhooks();
  const list = apps.data ?? [];
  const steps: Step[] = [
    {
      key: 'app', title: 'Create an app', icon: <AppstoreOutlined />, done: list.length > 0, action: 'Create app', to: '/apps?new=1',
      body: 'One per mobile app or website. It decides which flows that app may run.',
    },
    {
      key: 'key', title: 'Create an API key', icon: <KeyOutlined />, done: list.some((a) => a.credentialsCount > 0), action: 'Create key', to: list[0] ? `/apps/${list[0].id}?tab=credentials` : '/apps',
      body: 'Your backend uses it to create short-lived SDK tokens. The secret is shown once.',
    },
    {
      key: 'hook', title: 'Add a webhook', icon: <ApiOutlined />, done: (hooks.data ?? []).length > 0, action: 'Add webhook', to: '/webhooks?new=1',
      body: 'Get notified when a verification completes, expires or is reviewed.',
    },
    {
      key: 'try', title: 'Try it in the playground', icon: <ExperimentOutlined />, done: hasSessions, action: 'Open playground', to: '/playground',
      body: 'Run the real end-user flow with your camera and see the signed result.',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card
      title={
        <Flex align="center" gap={12} wrap>
          <span>Get started</span>
          <Progress percent={(done / steps.length) * 100} steps={steps.length} size="small" showInfo={false} aria-label={`${done} of ${steps.length} done`} />
          <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
            {done} of {steps.length} done
          </Typography.Text>
        </Flex>
      }
      style={{ background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgContainer} 55%)` }}
    >
      <Flex vertical gap={4}>
        {steps.map((s, i) => (
          <Flex
            key={s.key}
            align="center"
            gap={14}
            wrap
            style={{ padding: '12px 4px', borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined, opacity: s.done ? 0.7 : 1 }}
          >
            <span
              style={{
                width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 16, flex: 'none',
                background: s.done ? token.colorSuccessBg : token.colorPrimaryBg, color: s.done ? token.colorSuccess : token.colorPrimary,
              }}
            >
              {s.done ? <CheckCircleFilled /> : s.icon}
            </span>
            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
              <Typography.Text strong delete={s.done}>
                {i + 1}. {s.title}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {s.body}
              </Typography.Text>
            </div>
            <Button type={s.done ? 'default' : i === done ? 'primary' : 'default'} onClick={() => navigate(s.to)} icon={<RightOutlined />} iconPlacement="end">
              {s.action}
            </Button>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}
