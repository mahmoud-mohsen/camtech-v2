import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

export default function NotFoundPage() {
  const navigate = useNavigate();
  useDocumentTitle(t('notFound.title'));
  return (
    <Result
      status="404"
      title={t('notFound.title')}
      subTitle={t('notFound.subtitle')}
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          {t('error.home')}
        </Button>
      }
    />
  );
}
