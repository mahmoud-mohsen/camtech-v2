import { Flex, Tag } from 'antd';
import { daysUntil } from '../lib/format';
import { DateText } from './DateText';

/** Expiry date with a red "Expired" or amber "Expires in N days" (within 30 days) hint. */
export function ExpiryText({ date }: { date: string | null }) {
  const d = daysUntil(date);
  return (
    <Flex gap={6} align="center" wrap>
      <DateText value={date} dateOnly />
      {d !== null && d < 0 && <Tag color="error" variant="filled" className="ct-pill">Expired</Tag>}
      {d !== null && d >= 0 && d <= 30 && <Tag color="warning" variant="filled" className="ct-pill">Expires in {d} {d === 1 ? 'day' : 'days'}</Tag>}
    </Flex>
  );
}
