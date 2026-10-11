import { Tag, Tooltip } from 'antd';
import { DateText } from '../../components/DateText';
import { t } from '../../i18n';
import { daysUntil, expiryState } from '../../lib/expiry';
import { formatDate } from '../../lib/format';

/**
 * The expiry date, with a red "Expired" or orange "Expires in N days" tag inside the warning period.
 * `hideExpired` drops the "Expired" tag where a status next to it already says so.
 */
export function ExpiryText({ value, warningDays, hideExpired }: { value: string | null | undefined; warningDays: number; hideExpired?: boolean }) {
  const state = expiryState(value, warningDays);
  if (!value || !state) return <DateText value={value} dateOnly />;
  if (state === 'VALID' || (state === 'EXPIRED' && hideExpired)) return <DateText value={value} dateOnly />;
  const days = daysUntil(value);
  return (
    <Tooltip title={formatDate(value)}>
      <span>
        <DateText value={value} dateOnly />{' '}
        <Tag color={state === 'EXPIRED' ? 'red' : 'orange'} variant="filled" className="ct-pill" style={{ marginInlineStart: 4 }}>
          {state === 'EXPIRED' ? t('expiry.expired') : days === 0 ? t('expiry.today') : t('expiry.soon', { days })}
        </Tag>
      </span>
    </Tooltip>
  );
}
