import { CloseOutlined, FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import { Badge, Button, DatePicker, Flex, Grid, Popover, Select, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { dayjs } from '../lib/format';
import { useNow } from '../lib/hooks';
import { SearchBox } from './SearchBox';

type Option = { value: string; label: string };

/** A list filter kept in the URL. `more` filters live behind the "More filters" button (all do on phones). */
export type FilterDef =
  | { kind: 'select'; key: string; label: string; options: Option[]; width?: number; more?: boolean; searchable?: boolean; loading?: boolean }
  | { kind: 'dateRange'; from: string; to: string; label: string; more?: boolean; future?: boolean }
  | { kind: 'date'; key: string; label: string; more?: boolean };

type Values = Partial<Record<string, string>>;
type Setter = (patch: Record<string, string | null | undefined>) => void;

interface Props {
  values: Values;
  set: Setter;
  search?: { key: string; placeholder: string; width?: number };
  filters: FilterDef[];
  /** Clears every filter (and the search). */
  onClearAll: () => void;
  /** The list's query: shows when it was updated, with a refresh button. */
  query?: { dataUpdatedAt: number; isFetching: boolean; refetch: () => unknown };
  /** Extra controls on the right (e.g. a link to settings). */
  extra?: ReactNode;
}

const isActive = (f: FilterDef, v: Values) => (f.kind === 'dateRange' ? !!(v[f.from] || v[f.to]) : !!v[f.key]);
const fmt = (d: string | undefined) => (d ? dayjs(d).format('D MMM YYYY') : '…');

function chipText(f: FilterDef, v: Values): string {
  if (f.kind === 'select') return `${f.label}: ${f.options.find((o) => o.value === v[f.key])?.label ?? v[f.key]}`;
  if (f.kind === 'date') return `${f.label}: ${fmt(v[f.key])}`;
  return `${f.label}: ${fmt(v[f.from])} – ${fmt(v[f.to])}`;
}

function clearPatch(f: FilterDef): Record<string, null> {
  return f.kind === 'dateRange' ? { [f.from]: null, [f.to]: null } : { [f.key]: null };
}

function Control({ f, values, set, block }: { f: FilterDef; values: Values; set: Setter; block?: boolean }) {
  if (f.kind === 'select') {
    return (
      <Select
        allowClear
        showSearch={f.searchable ? { optionFilterProp: 'label' } : undefined}
        placeholder={f.label}
        aria-label={f.label}
        style={{ width: block ? '100%' : (f.width ?? 160) }}
        value={values[f.key]}
        onChange={(v?: string) => set({ [f.key]: v })}
        loading={f.loading}
        options={f.options}
      />
    );
  }
  if (f.kind === 'date') {
    return (
      <DatePicker
        placeholder={f.label}
        aria-label={f.label}
        value={values[f.key] ? dayjs(values[f.key]) : null}
        onChange={(d) => set({ [f.key]: d ? d.format('YYYY-MM-DD') : null })}
        style={{ width: block ? '100%' : 180 }}
      />
    );
  }
  return (
    <DatePicker.RangePicker
      allowEmpty={[true, true]}
      aria-label={f.label}
      value={[values[f.from] ? dayjs(values[f.from]) : null, values[f.to] ? dayjs(values[f.to]) : null]}
      onChange={(r) => set({ [f.from]: r?.[0]?.format('YYYY-MM-DD'), [f.to]: r?.[1]?.format('YYYY-MM-DD') })}
      disabledDate={f.future ? undefined : (d) => d.isAfter(dayjs(), 'day')}
      style={block ? { width: '100%' } : undefined}
    />
  );
}

/** "Updated 2 minutes ago" with a refresh button; lists also refresh on their own every minute. */
export function RefreshStatus({ query, compact }: { query: NonNullable<Props['query']>; compact?: boolean }) {
  useNow(30_000);
  const when = query.dataUpdatedAt ? dayjs(query.dataUpdatedAt).fromNow() : null;
  const updated = when ? t('filters.updated', { when }) : null;
  return (
    <Flex align="center" gap={4}>
      {updated && !compact && <span className="ct-meta">{updated}</span>}
      <Tooltip title={compact && updated ? `${updated} · ${t('common.refresh')}` : t('common.refresh')}>
        <Button type="text" size="small" icon={<ReloadOutlined spin={query.isFetching} />} aria-label={t('common.refresh')} onClick={() => void query.refetch()} />
      </Tooltip>
    </Flex>
  );
}

/**
 * The one filter bar of every list: search on the left, the main filters inline, the rest behind "More filters",
 * active hidden filters as removable chips, and "Clear all". On phones every filter moves behind the button.
 */
export function FilterBar({ values, set, search, filters, onClearAll, query, extra }: Props) {
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const inline = phone ? [] : filters.filter((f) => !f.more);
  const hidden = phone ? filters : filters.filter((f) => f.more);
  const hiddenActive = hidden.filter((f) => isActive(f, values));
  const anyActive = filters.some((f) => isActive(f, values)) || (!!search && !!values[search.key]);

  const panel = (
    <Flex vertical gap={12} style={{ width: 280 }}>
      {hidden.map((f) => (
        <Flex vertical gap={4} key={f.kind === 'dateRange' ? f.from : f.key}>
          <span className="ct-meta" style={{ fontWeight: 600 }}>
            {f.label}
          </span>
          <Control f={f} values={values} set={set} block />
        </Flex>
      ))}
    </Flex>
  );

  return (
    <Flex vertical gap={10} style={{ marginBottom: 16 }}>
      <Flex gap={8} wrap align="center">
        {search && (
          <SearchBox value={values[search.key]} onSearch={(v) => set({ [search.key]: v })} placeholder={search.placeholder} width={phone ? undefined : (search.width ?? 320)} />
        )}
        {inline.map((f) => (
          <Control key={f.kind === 'dateRange' ? f.from : f.key} f={f} values={values} set={set} />
        ))}
        {hidden.length > 0 && (
          <Popover content={panel} trigger="click" placement="bottomLeft" title={phone ? t('filters.title') : t('filters.more')}>
            <Badge count={hiddenActive.length} size="small" color="var(--ct-brand)">
              <Button icon={<FilterOutlined />}>{phone ? t('filters.title') : t('filters.more')}</Button>
            </Badge>
          </Popover>
        )}
        {anyActive && (
          <Button type="link" onClick={onClearAll} style={{ fontWeight: 700, paddingInline: 4 }}>
            {t('filters.clearAll')}
          </Button>
        )}
        <Flex gap={8} align="center" style={{ marginInlineStart: 'auto' }}>
          {extra}
          {query && <RefreshStatus query={query} compact={!screens.xxl} />}
        </Flex>
      </Flex>
      {hiddenActive.length > 0 && (
        <Flex gap={6} wrap>
          {hiddenActive.map((f) => (
            <Button
              key={f.kind === 'dateRange' ? f.from : f.key}
              size="small"
              shape="round"
              onClick={() => set(clearPatch(f))}
              aria-label={`${t('filters.remove')} ${chipText(f, values)}`}
              style={{ background: 'var(--ct-brand-soft)', borderColor: 'transparent', color: 'var(--ct-brand-strong)', fontWeight: 600 }}
            >
              {chipText(f, values)} <CloseOutlined style={{ fontSize: 12 }} />
            </Button>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
