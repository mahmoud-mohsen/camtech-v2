// WCAG 2.x contrast helpers for the branding editor.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses #rgb, #rgba, #rrggbb or #rrggbbaa (alpha ignored). Returns null when it isn't a hex colour. */
export function parseHex(input: string): Rgb | null {
  const v = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(v)) return null;
  let hex: string;
  if (v.length === 3 || v.length === 4) hex = v.slice(0, 3).split('').map((c) => c + c).join('');
  else if (v.length === 6 || v.length === 8) hex = v.slice(0, 6);
  else return null;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contrast ratio between two colours (1 to 21). Returns null if either colour can't be parsed. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal text. */
export const AA_NORMAL = 4.5;

/**
 * Which text colour (white or black) reads best on a background, and how well.
 * The SDK uses the same rule for text on primary buttons.
 */
export function bestTextOn(background: string): { color: '#ffffff' | '#000000'; ratio: number } | null {
  const white = contrastRatio(background, '#ffffff');
  const black = contrastRatio(background, '#000000');
  if (white === null || black === null) return null;
  return white >= black ? { color: '#ffffff', ratio: white } : { color: '#000000', ratio: black };
}

/**
 * Contrast of white and of black text on a background (e.g. button labels on the primary colour).
 * One of the two always reaches about 4.58:1, so a design check must name the text colour it uses.
 */
export function textContrastOn(background: string): { white: number; black: number } | null {
  const white = contrastRatio(background, '#ffffff');
  const black = contrastRatio(background, '#000000');
  return white === null || black === null ? null : { white, black };
}

/** True when white text on this background is below `min` (default WCAG AA, 4.5:1). */
export function whiteTextFails(background: string, min = AA_NORMAL): boolean {
  const c = textContrastOn(background);
  return c !== null && c.white < min;
}
