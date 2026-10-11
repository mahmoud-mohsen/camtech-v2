import type { ConfigKey, ConfigParam } from '../../api/types';
import { channelLabel, CONFIG_GROUP_LABELS, flowLabel, humanize } from '../../lib/labels';

export interface ResolveContext {
  flowCode?: string;
  channel?: string;
  clientAppCode?: string;
}

/** Precedence from the contract: global, then flow, then channel, then client app (most specific wins). */
export function scopeRank(p: ConfigParam): number {
  if (p.clientAppCode) return 3;
  if (p.channel) return 2;
  if (p.flowCode) return 1;
  return 0;
}

export function isGlobal(p: ConfigParam): boolean {
  return !p.flowCode && !p.channel && !p.clientAppCode;
}

export function appliesTo(p: ConfigParam, ctx: ResolveContext): boolean {
  return (!p.flowCode || p.flowCode === ctx.flowCode) && (!p.channel || p.channel === ctx.channel) && (!p.clientAppCode || p.clientAppCode === ctx.clientAppCode);
}

/** The param whose value is used for the given context (null when the key has no rows). */
export function winner(params: ConfigParam[], ctx: ResolveContext): ConfigParam | null {
  const candidates = params.filter((p) => appliesTo(p, ctx));
  candidates.sort((a, b) => scopeRank(b) - scopeRank(a) || scopeCount(b) - scopeCount(a));
  return candidates[0] ?? null;
}

function scopeCount(p: ConfigParam): number {
  return [p.flowCode, p.channel, p.clientAppCode].filter(Boolean).length;
}

export function scopeLabel(p: ConfigParam): string {
  if (isGlobal(p)) return 'Global default';
  const parts: string[] = [];
  if (p.flowCode) parts.push(`Flow: ${flowLabel(p.flowCode)}`);
  if (p.channel) parts.push(`Channel: ${channelLabel(p.channel)}`);
  if (p.clientAppCode) parts.push(`App: ${p.clientAppCode}`);
  return parts.join(' + ');
}

export function groupOf(key: string): string {
  const prefix = key.split('.')[0];
  return CONFIG_GROUP_LABELS[prefix] ?? humanize(prefix);
}

export function keyTitle(key: string): string {
  const rest = key.split('.').slice(1).join(' ');
  return humanize(rest || key);
}

/** Validation rule for antd Form matching the server-side checks (required, number, integer, min/max). */
export function valueRule(k: ConfigKey) {
  return {
    validator: (_: unknown, v: string | undefined) => {
      if (v === undefined || v === '') return Promise.reject(new Error('Enter a value'));
      if (k.type === 'NUMBER' || k.type === 'INTEGER') {
        const n = Number(v);
        if (!Number.isFinite(n)) return Promise.reject(new Error('Must be a number'));
        if (k.type === 'INTEGER' && !Number.isInteger(n)) return Promise.reject(new Error('Must be a whole number'));
        if (k.min !== null && n < k.min) return Promise.reject(new Error(`Must be at least ${k.min}`));
        if (k.max !== null && n > k.max) return Promise.reject(new Error(`Must be at most ${k.max}`));
      }
      return Promise.resolve();
    },
  };
}

export function rangeText(k: ConfigKey): string {
  const parts = [k.type.toLowerCase()];
  if (k.min !== null && k.max !== null) parts.push(`${k.min} – ${k.max}`);
  else if (k.min !== null) parts.push(`≥ ${k.min}`);
  else if (k.max !== null) parts.push(`≤ ${k.max}`);
  return parts.join(' · ');
}
