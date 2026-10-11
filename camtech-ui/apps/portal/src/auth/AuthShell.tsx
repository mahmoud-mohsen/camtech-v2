import { Card, Flex, theme, Typography } from 'antd';
import type { ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark';

/** Centered card for the sign-in, change-password and suspended screens. */
export function AuthShell({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        minHeight: '100vh',
        padding: 16,
        background: `radial-gradient(1200px 600px at 10% -10%, ${token.colorPrimaryBg}, transparent 60%), radial-gradient(900px 500px at 110% 110%, ${token.colorInfoBg}, transparent 60%), ${token.colorBgLayout}`,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 440, boxShadow: token.boxShadowSecondary }} styles={{ body: { padding: 32 } }}>
        <Flex vertical gap={20}>
          <Flex align="center" gap={12}>
            <BrandMark size={40} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {title}
              </Typography.Title>
              {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
            </div>
          </Flex>
          {children}
        </Flex>
      </Card>
    </Flex>
  );
}
