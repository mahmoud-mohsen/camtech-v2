import { Button, Collapse, Result, Typography } from 'antd';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { t } from '../i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';

function describe(err: unknown): string {
  if (isRouteErrorResponse(err)) return `${err.status} ${err.statusText}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Per-route error boundary: a crash in one page never takes the console down. */
export function RouteError() {
  const err = useRouteError();
  const navigate = useNavigate();
  useDocumentTitle('Error');
  // A stale lazy chunk after a deploy: a reload fixes it.
  const chunk = err instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(err.message);
  return (
    <Result
      status="error"
      title={t('error.route.title')}
      subTitle={chunk ? 'A newer version of the console is available. Reload the page to continue.' : t('error.route.subtitle')}
      extra={[
        <Button key="reload" type="primary" onClick={() => window.location.reload()}>
          {t('error.reload')}
        </Button>,
        <Button key="home" onClick={() => navigate('/')}>
          {t('error.home')}
        </Button>,
      ]}
    >
      {import.meta.env.DEV && (
        <Collapse
          size="small"
          items={[{ key: 'd', label: 'Technical details', children: <Typography.Text code style={{ whiteSpace: 'pre-wrap' }}>{describe(err)}</Typography.Text> }]}
        />
      )}
    </Result>
  );
}
