import { SafetyCertificateFilled } from '@ant-design/icons';
import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';

/** Centered layout for the sign-in and change-password screens. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <Flex
      vertical
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: 16, background: 'linear-gradient(180deg, var(--ct-brand-soft) 0%, var(--ct-page) 420px)' }}
    >
      <Flex align="center" gap={12} style={{ marginBottom: 28 }}>
        <span
          style={{
            width: 44, height: 44, borderRadius: 12, background: '#0074C1', color: '#FFFFFF', fontSize: 22,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <SafetyCertificateFilled />
        </span>
        <div>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 800, letterSpacing: '-0.02em' }}>
            CamTech
          </Typography.Title>
          <Typography.Text type="secondary">Operations console</Typography.Text>
        </div>
      </Flex>
      <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </Flex>
  );
}
