import { InfoCircleOutlined } from '@ant-design/icons';
import { Alert } from 'antd';
import { Link } from 'react-router-dom';
import { t } from '../../i18n';
import { useReviewSummary } from '../../lib/hooks';

/** Shown when the tenant handed verification reviews to CamTech: cases are read-only here. */
export function CamtechReviewsBanner() {
  const summary = useReviewSummary();
  if (summary.data?.owner !== 'CAMTECH') return null;
  return (
    <Alert
      type="info"
      showIcon
      icon={<InfoCircleOutlined />}
      style={{ marginBottom: 16 }}
      title={t('reviews.camtech')}
      description={
        <>
          {t('reviews.camtech.body')} <Link to="/settings/reviews">{t('reviews.camtech.change')}</Link>
        </>
      }
    />
  );
}
