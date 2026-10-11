import { theme } from 'antd';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Dashboard } from '../../api/types';
import { TONE_HEX } from '../../lib/colors';
import { dayjs } from '../../lib/format';

const SERIES = [
  { key: 'approved', label: 'Approved', color: TONE_HEX.processing },
  { key: 'review', label: 'Needs review', color: TONE_HEX.warning },
  { key: 'rejected', label: 'Rejected', color: TONE_HEX.error },
  { key: 'other', label: 'No decision', color: TONE_HEX.default },
] as const;

/** Verifications per day, stacked by decision. */
export function DailyChart({ daily }: { daily: Dashboard['daily'] }) {
  const { token } = theme.useToken();
  const data = daily.map((d) => ({ ...d, label: dayjs(d.date).format('D MMM') }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={token.colorBorderSecondary} />
        <XAxis dataKey="label" tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={{ stroke: token.colorBorder }} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: token.colorFillTertiary }}
          contentStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, color: token.colorText }}
          labelStyle={{ color: token.colorText, fontWeight: 600 }}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, fontWeight: 600, color: token.colorTextSecondary }} />
        {SERIES.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="d"
            fill={s.key === 'approved' ? token.colorPrimary : s.color}
            stroke={token.colorBgContainer}
            strokeWidth={1}
            radius={i === SERIES.length - 1 ? [6, 6, 0, 0] : 0}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
