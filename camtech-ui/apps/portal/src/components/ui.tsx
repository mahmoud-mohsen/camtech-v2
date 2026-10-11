import { DownOutlined, SettingOutlined } from '@ant-design/icons';
import { Collapse, Flex, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Tone = 'brand' | 'success' | 'warning' | 'error' | 'neutral';

/** Width of forms and reading pages (settings, flows, audit log); lists and dashboards use the full layout width. */
export const FORM_WIDTH = 880;

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  brand: { bg: 'var(--ct-brand-soft)', fg: 'var(--ct-brand)' },
  success: { bg: 'var(--ct-success-soft)', fg: 'var(--ct-success)' },
  warning: { bg: 'var(--ct-warning-soft)', fg: 'var(--ct-warning)' },
  error: { bg: 'var(--ct-error-soft)', fg: 'var(--ct-error)' },
  neutral: { bg: 'var(--ct-subtle)', fg: 'var(--ct-text-secondary)' },
};

/** Round tinted tile holding an icon. */
export function IconTile({ icon, tone = 'brand', size = 36 }: { icon: ReactNode; tone?: Tone; size?: number }) {
  const t = TONE_STYLE[tone];
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: size / 3.6, background: t.bg, color: t.fg, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size / 2.2,
      }}
    >
      {icon}
    </span>
  );
}

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** Short coloured note beside the value, e.g. "+8%" or "Oldest 3 h". */
  note?: ReactNode;
  noteTone?: Tone;
  hint?: ReactNode;
  to?: string;
  loading?: boolean;
}

/** Headline number card used on dashboards. */
export function StatCard({ label, value, icon, tone = 'brand', note, noteTone = 'neutral', hint, to, loading }: StatCardProps) {
  const body = (
    <Flex vertical gap={12} className="ct-stat" style={{ height: '100%' }}>
      <Flex align="center" gap={10}>
        {icon && <IconTile icon={icon} tone={tone} />}
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ct-text-secondary)' }}>{label}</span>
      </Flex>
      <Flex align="baseline" gap={10} wrap>
        <span className="tabular" style={{ fontSize: 30, lineHeight: '38px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ct-heading)' }}>
          {loading ? '—' : value}
        </span>
        {note && !loading && (
          <span className="tabular" style={{ fontSize: 13, fontWeight: 700, color: TONE_STYLE[noteTone].fg }}>
            {note}
          </span>
        )}
      </Flex>
      {hint && <span className="ct-meta">{hint}</span>}
    </Flex>
  );
  const style: CSSProperties = {
    display: 'block', height: '100%', padding: 20, borderRadius: 14, border: '1px solid var(--ct-border)',
    background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)', color: 'inherit',
  };
  return to ? (
    <Link to={to} style={style} className="ct-card-link">
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Initials avatar for a person or company. */
export function PersonAvatar({ name, size = 36, org }: { name: string | null | undefined; size?: number; org?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0, fontWeight: 800, fontSize: Math.round(size * 0.36),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: org ? 'var(--ct-subtle)' : 'var(--ct-brand-soft)', color: org ? 'var(--ct-text-secondary)' : 'var(--ct-brand-strong)',
        border: org ? '1px solid var(--ct-border-subtle)' : 'none',
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Name with an optional secondary line, next to an initials avatar. */
export function PersonCell({ name, sub, org, to }: { name: ReactNode; sub?: ReactNode; org?: boolean; to?: string }) {
  const label = typeof name === 'string' ? name : undefined;
  return (
    <Flex align="center" gap={12} style={{ minWidth: 0 }}>
      <PersonAvatar name={label} org={org} />
      <Flex vertical style={{ minWidth: 0 }}>
        {to ? (
          <Link to={to} className="ct-strong" style={{ color: 'var(--ct-heading)' }} onClick={(e) => e.stopPropagation()}>
            {name}
          </Link>
        ) : (
          <span className="ct-strong">{name}</span>
        )}
        {sub && <span className="ct-meta">{sub}</span>}
      </Flex>
    </Flex>
  );
}

/**
 * Collapsed block for data operators rarely need: internal ids, device, network, model versions.
 * Keeps the main view clean while leaving everything one click away.
 */
export function TechnicalDetails({ items, title = 'Technical details', summary }: {
  items: { label: string; value: ReactNode }[];
  title?: string;
  summary?: string;
}) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
  if (shown.length === 0) return null;
  return (
    <Collapse
      bordered={false}
      expandIconPlacement="end"
      expandIcon={({ isActive }) => <DownOutlined rotate={isActive ? 180 : 0} />}
      style={{ background: 'var(--ct-card)', border: '1px solid var(--ct-border)', borderRadius: 14, boxShadow: 'var(--ct-shadow-xs)' }}
      items={[
        {
          key: 'tech',
          label: (
            <Flex align="center" gap={12}>
              <IconTile icon={<SettingOutlined />} tone="neutral" size={32} />
              <Flex vertical>
                <span className="ct-strong">{title}</span>
                <span className="ct-meta">{summary ?? shown.map((i) => i.label).slice(0, 4).join(', ')}</span>
              </Flex>
            </Flex>
          ),
          children: (
            <dl style={{ margin: 0 }}>
              {shown.map((i) => (
                <Flex key={i.label} gap={12} style={{ padding: '10px 0', borderTop: '1px solid var(--ct-border-subtle)' }}>
                  <dt className="ct-meta" style={{ width: 130, flexShrink: 0 }}>
                    {i.label}
                  </dt>
                  <dd style={{ margin: 0, minWidth: 0, wordBreak: 'break-all' }}>{i.value}</dd>
                </Flex>
              ))}
            </dl>
          ),
        },
      ]}
    />
  );
}

/** Card section title with optional subtitle, for custom-built panels. */
export function SectionTitle({ title, sub, extra }: { title: ReactNode; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <Flex align="center" gap={12} wrap style={{ marginBottom: 16 }}>
      <Flex vertical style={{ flex: 1, minWidth: 0 }}>
        <Typography.Title level={5} style={{ margin: 0, fontWeight: 700 }}>
          {title}
        </Typography.Title>
        {sub && <span className="ct-meta">{sub}</span>}
      </Flex>
      {extra}
    </Flex>
  );
}

/** Bordered, rounded frame around a list table (same look as the verifications list). */
export function TableFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
      {children}
    </div>
  );
}
