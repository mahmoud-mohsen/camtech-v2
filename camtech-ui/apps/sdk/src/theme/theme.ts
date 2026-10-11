// Tenant branding → CSS custom properties, with accessible text colours (WCAG 2.x contrast).
import type { Branding } from '@camtech/api-client';

export type Scheme = 'light' | 'dark';

export const DEFAULT_BRANDING: Branding = {
  tenant: 'DEFAULT',
  displayName: 'camtech',
  logoDataUrl: null,
  primaryColor: '#1554F0',
  accentColor: '#0EA5A4',
  backgroundColor: '#F6F7FB',
  surfaceColor: '#FFFFFF',
  textColor: '#101828',
  borderRadius: 12,
  fontFamily: 'Inter',
  themeMode: 'LIGHT',
  supportEmail: null,
  supportUrl: null,
  privacyUrl: null,
  showPoweredBy: true,
  texts: {},
  updatedAt: null,
};

const DARK = { background: '#0E1116', surface: '#181C23', text: '#EEF1F6' };

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(input: string | null | undefined): Rgb | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
  if (m) {
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  }
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (m) return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]) };
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance 0..1. */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 16, g: 24, b: 40 };

/** White or near-black, whichever reads better on `bg`. */
export function onColor(bg: Rgb): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(NEAR_BLACK, bg) ? '#FFFFFF' : '#101828';
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** Moves `fg` towards white or black until it reaches `min` contrast on `bg` (for links and focus rings). */
export function ensureContrast(fg: Rgb, bg: Rgb, min: number): Rgb {
  if (contrastRatio(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.5 ? { r: 0, g: 0, b: 0 } : WHITE;
  for (let t = 0.1; t <= 1; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return target;
}

/** Strips anything that could break out of a CSS value. */
export function sanitizeFontFamily(input: string | null | undefined): string {
  if (!input) return '';
  const cleaned = input.replace(/[^\w\s,'"-]/g, '').trim().slice(0, 120);
  return cleaned
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .map((f) => (/\s/.test(f) ? `"${f}"` : f))
    .join(', ');
}

/** Only inline raster/SVG images are accepted for the logo (no remote URLs, no scripts). */
export function safeLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml)(;[\w=-]+)*(;base64)?,/i.test(url) && url.length < 2_000_000 ? url : null;
}

export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function mergeBranding(server: Branding | null, overrides: Partial<Branding> | null): Branding {
  const base = { ...DEFAULT_BRANDING, ...(server ?? {}) };
  if (!overrides) return base;
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null)) as Partial<Branding>;
  return { ...base, ...clean, texts: { ...base.texts, ...(clean.texts ?? {}) } };
}

export function resolveScheme(mode: Branding['themeMode'], prefersDark: boolean): Scheme {
  if (mode === 'DARK') return 'dark';
  if (mode === 'AUTO') return prefersDark ? 'dark' : 'light';
  return 'light';
}

const FONT_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", "Noto Naskh Arabic", "Geeza Pro", Tahoma, Arial, sans-serif';

/** CSS variables for the SDK root. */
export function themeVars(b: Branding, scheme: Scheme): Record<string, string> {
  const fallbackLight = DEFAULT_BRANDING;
  let bg = parseColor(b.backgroundColor) ?? parseColor(fallbackLight.backgroundColor)!;
  let surface = parseColor(b.surfaceColor) ?? parseColor(fallbackLight.surfaceColor)!;
  let text = parseColor(b.textColor) ?? parseColor(fallbackLight.textColor)!;
  if (scheme === 'dark' && luminance(bg) > 0.4) {
    // The tenant colours are for a light page: use a neutral dark palette, keep the brand colours.
    bg = parseColor(DARK.background)!;
    surface = parseColor(DARK.surface)!;
    text = parseColor(DARK.text)!;
  }
  if (contrastRatio(text, surface) < 4.5) text = parseColor(onColor(surface))!;
  const primary = parseColor(b.primaryColor) ?? parseColor(fallbackLight.primaryColor)!;
  const accent = parseColor(b.accentColor) ?? primary;
  const isDark = luminance(bg) < 0.2;
  const muted = ensureContrast(mix(text, surface, 0.35), surface, 4.5);
  const border = mix(text, surface, isDark ? 0.8 : 0.85);
  const link = ensureContrast(primary, surface, 4.5);
  const focus = ensureContrast(primary, bg, 3);
  const radius = Math.max(0, Math.min(28, Number.isFinite(b.borderRadius) ? b.borderRadius : 12));
  const font = sanitizeFontFamily(b.fontFamily);
  return {
    '--ct-primary': toHex(primary),
    '--ct-on-primary': onColor(primary),
    '--ct-primary-soft': toHex(mix(primary, surface, 0.88)),
    '--ct-accent': toHex(accent),
    '--ct-on-accent': onColor(accent),
    '--ct-bg': toHex(bg),
    '--ct-surface': toHex(surface),
    '--ct-text': toHex(text),
    '--ct-muted': toHex(muted),
    '--ct-border': toHex(border),
    '--ct-link': toHex(link),
    '--ct-focus': toHex(focus),
    '--ct-success': isDark ? '#4ADE80' : '#127A3E',
    '--ct-success-soft': isDark ? '#12321F' : '#E6F4EC',
    '--ct-warning': isDark ? '#FBBF24' : '#8A5300',
    '--ct-warning-soft': isDark ? '#3A2C0B' : '#FFF4E0',
    '--ct-danger': isDark ? '#F87171' : '#B42318',
    '--ct-danger-soft': isDark ? '#3B1515' : '#FDECEA',
    '--ct-radius': `${radius}px`,
    '--ct-radius-sm': `${Math.round(radius * 0.66)}px`,
    '--ct-font': font ? `${font}, ${FONT_FALLBACK}` : FONT_FALLBACK,
    colorScheme: scheme,
  };
}
