import type { TenantDashboard } from '@camtech/api-client';
import { theme } from 'antd';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TONE_HEX } from '../../lib/colors';
import { dayjs } from '../../lib/format';

const SERIES = [
  { key: 'approved', label: 'Approved', color: TONE_HEX.processing },
  { key: 'review', label: 'In review', color: TONE_HEX.warning },
  { key: 'rejected', label: 'Rejected', color: TONE_HEX.error },
  { key: 'other', label: 'No decision', color: TONE_HEX.default },
] as const;

/** Verifications per day, stacked by decision. */
export function DailyChart({ daily }: { daily: TenantDashboard['daily'] }) {
  const { token } = theme.useToken();
  const data = daily.map((d) => ({ ...d, label: dayjs(d.date).format(daily.length > 31 ? 'D/M' : 'D MMM') }));
  return (
    <div role="img" aria-label="Verifications per day by decision">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={daily.length > 31 ? '10%' : '24%'}>
          <CartesianGrid vertical={false} stroke={token.colorBorderSecondary} />
          <XAxis dataKey="label" tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={{ stroke: token.colorBorder }} tickLine={false} minTickGap={12} />
          <YAxis allowDecimals={false} tick={{ fill: token.colorTextSecondary, fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: token.colorFillTertiary }}
            contentStyle={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, color: token.colorText, fontSize: 12 }}
            labelStyle={{ color: token.colorText, fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: token.colorTextSecondary }} iconType="circle" iconSize={8} />
          {SERIES.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="d"
              fill={s.key === 'approved' ? token.colorPrimary : s.color}
              stroke={token.colorBgContainer}
              strokeWidth={1}
              radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
