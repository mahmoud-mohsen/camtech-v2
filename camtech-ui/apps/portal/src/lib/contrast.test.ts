import { describe, expect, it } from 'vitest';
import { bestTextOn, contrastRatio, luminance, parseHex, textContrastOn, whiteTextFails } from './contrast';

describe('parseHex', () => {
  it('reads 3, 4, 6 and 8 digit colours', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#0f08')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseHex('4f46e5')).toEqual({ r: 79, g: 70, b: 229 });
    expect(parseHex('#11223380')).toEqual({ r: 17, g: 34, b: 51 });
  });

  it('rejects anything else', () => {
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#ggg')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for equal colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777', '#777777')).toBeCloseTo(1, 5);
  });

  it('matches known WCAG values', () => {
    // #767676 on white is the classic 4.54:1 grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('returns null for unparseable colours', () => {
    expect(contrastRatio('nope', '#fff')).toBeNull();
  });
});

describe('bestTextOn / textContrastOn / whiteTextFails', () => {
  it('picks white on dark colours and black on light ones', () => {
    expect(bestTextOn('#4f46e5')?.color).toBe('#ffffff');
    expect(bestTextOn('#ffe066')?.color).toBe('#000000');
  });

  it('reports both ratios and flags primaries too light for white text', () => {
    const c = textContrastOn('#2fb36d');
    expect(c?.white).toBeLessThan(4.5);
    expect(c?.black).toBeGreaterThan(4.5);
    expect(whiteTextFails('#2fb36d')).toBe(true);
    expect(whiteTextFails('#0b7a5c')).toBe(false);
    expect(whiteTextFails('#4f46e5')).toBe(false);
    expect(whiteTextFails('not a colour')).toBe(false);
  });

  it('always lets white or black reach about 4.58:1', () => {
    for (const hex of ['#757b88', '#808080', '#3e7bfa', '#e5484d']) {
      const c = textContrastOn(hex);
      expect(Math.max(c?.white ?? 0, c?.black ?? 0)).toBeGreaterThanOrEqual(4.58);
    }
  });
});
