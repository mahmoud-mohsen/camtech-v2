import { EyeOutlined } from '@ant-design/icons';
import { Alert } from 'antd';
import { usePermissions } from '../auth/useAuth';
import { t } from '../i18n';

/** Explains why the controls on a page are hidden or disabled for the signed-in user's role. */
export function ReadOnlyNotice({ compact = false }: { compact?: boolean }) {
  const { role } = usePermissions();
  return (
    <Alert
      type="info"
      showIcon
      icon={<EyeOutlined />}
      title={t('auth.readOnly', { role: role ? t(`role.${role}`) : '' })}
      style={compact ? undefined : { marginBottom: 16 }}
    />
  );
}

