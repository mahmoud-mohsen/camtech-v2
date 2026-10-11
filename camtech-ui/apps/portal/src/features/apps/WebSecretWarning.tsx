import { SafetyOutlined } from '@ant-design/icons';
import { Alert } from 'antd';
import { Link } from 'react-router-dom';

/** The one rule for WEB apps: the browser never sees the client secret. */
export function WebSecretWarning({ compact = false }: { compact?: boolean }) {
  return (
    <Alert
      type="info"
      showIcon
      icon={<SafetyOutlined />}
      title="Web apps must never hold the secret"
      description={
        compact ? (
          <>Keep the API key on your backend; the browser only gets a short-lived SDK token.</>
        ) : (
          <>
            Anything in a web page can be read by its visitors. Keep this API key on <strong>your backend</strong>: it calls{' '}
            <code>POST /v2/sdk-tokens</code> for each user and hands the browser only the short-lived <code>sdkToken</code>. See the{' '}
            <Link to="/guide">integration guide</Link>.
          </>
        )
      }
    />
  );
}
