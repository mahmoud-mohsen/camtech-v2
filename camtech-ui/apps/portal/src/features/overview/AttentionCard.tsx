import { CheckCircleOutlined, RightOutlined } from '@ant-design/icons';
import type { TenantAttention } from '@camtech/api-client';
import { Card, Flex } from 'antd';
import { Link } from 'react-router-dom';
import { IconTile, SectionTitle } from '../../components/ui';
import { t } from '../../i18n';
import { useClientApps, useEntitlements } from '../../lib/hooks';
import { attentionItems } from './attention';

/** "Needs attention" on the Overview. */
export function AttentionCard({ attention }: { attention: TenantAttention }) {
  const apps = useClientApps();
  const entitlements = useEntitlements();
  const appIds = Object.fromEntries((apps.data ?? []).map((a) => [a.code, a.id]));
  const items = attentionItems(attention, appIds, entitlements.data ?? []);
  if (items.length === 0) {
    return (
      <Flex align="center" gap={12} style={{ padding: '14px 20px', borderRadius: 14, background: 'var(--ct-success-soft)', color: 'var(--ct-success)' }}>
        <CheckCircleOutlined style={{ fontSize: 18 }} />
        <span style={{ fontWeight: 700 }}>{t('attention.clear')}</span>
      </Flex>
    );
  }
  return (
    <Card styles={{ body: { paddingBottom: 8 } }}>
      <SectionTitle title={t('attention.title')} />
      <Flex vertical>
        {items.map((i) => {
          const row = (
            <Flex align="center" gap={14} style={{ padding: '12px 0', borderTop: '1px solid var(--ct-border-subtle)' }}>
              <IconTile icon={i.icon} tone={i.tone} />
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--ct-text)', wordBreak: 'break-word' }}>{i.text}</span>
              {i.to && <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} />}
            </Flex>
          );
          return i.to ? (
            <Link key={i.key} to={i.to}>
              {row}
            </Link>
          ) : (
            <div key={i.key}>{row}</div>
          );
        })}
      </Flex>
    </Card>
  );
}
