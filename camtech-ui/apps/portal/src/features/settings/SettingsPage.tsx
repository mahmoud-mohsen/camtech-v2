import { CalendarOutlined, DatabaseOutlined, ScanOutlined, SolutionOutlined, TeamOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { FORM_WIDTH } from '../../components/ui';
import { OwnerOnly } from '../../auth/RequireAuth';
import { usePermissions } from '../../auth/useAuth';
import { t, type MessageKey } from '../../i18n';
import { DocumentSettingsSection } from './DocumentSettingsSection';
import { OcrSettingsSection } from './OcrSettingsSection';
import { RetentionSection } from './RetentionSection';
import { ReviewSettingsSection } from './ReviewSettingsSection';
import { TeamSection } from './TeamSection';

interface Section {
  key: string;
  label: MessageKey;
  icon: ReactNode;
  /** Forms read best at a limited width; tables use the full width. */
  narrow?: boolean;
  ownerOnly?: boolean;
  render: () => ReactNode;
}

const SECTIONS: Section[] = [
  { key: 'team', label: 'settings.tab.team', icon: <TeamOutlined />, ownerOnly: true, render: () => <TeamSection /> },
  { key: 'reviews', label: 'settings.tab.reviews', icon: <SolutionOutlined />, narrow: true, render: () => <ReviewSettingsSection /> },
  { key: 'ocr', label: 'settings.tab.ocr', icon: <ScanOutlined />, narrow: true, render: () => <OcrSettingsSection /> },
  { key: 'documents', label: 'settings.tab.documents', icon: <CalendarOutlined />, narrow: true, render: () => <DocumentSettingsSection /> },
  { key: 'retention', label: 'settings.tab.retention', icon: <DatabaseOutlined />, render: () => <RetentionSection /> },
];

/** One page for every tenant setting, one tab per area; each tab has its own URL (/settings/<section>). */
export default function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { isOwner } = usePermissions();
  const shown = SECTIONS.filter((s) => isOwner || !s.ownerOnly);
  const active = SECTIONS.find((s) => s.key === section);
  if (!active) return <Navigate to={`/settings/${shown[0].key}`} replace />;
  const header = <PageHeader title={t('settings.title')} documentTitle={`${t(active.label)} · ${t('settings.title')}`} help={t('settings.help')} />;
  if (!shown.includes(active)) {
    return (
      <>
        {header}
        <OwnerOnly>{null}</OwnerOnly>
      </>
    );
  }
  return (
    <>
      {header}
      <Tabs
        activeKey={active.key}
        onChange={(k) => navigate(`/settings/${k}`)}
        destroyOnHidden
        items={shown.map((s) => ({
          key: s.key,
          icon: s.icon,
          label: t(s.label),
          children: <div style={{ maxWidth: s.narrow ? FORM_WIDTH : undefined, paddingTop: 8 }}>{s.render()}</div>,
        }))}
      />
    </>
  );
}
