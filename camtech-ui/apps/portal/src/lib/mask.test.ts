import { describe, expect, it } from 'vitest';
import { maskDocumentNumber, shortKey } from './mask';

describe('maskDocumentNumber', () => {
  it('keeps the last 4 characters and the separators of an Emirates ID', () => {
    expect(maskDocumentNumber('784-1990-1234567-1')).toBe('•••-••••-••••567-1');
  });

  it('masks passports and plain numbers', () => {
    expect(maskDocumentNumber('N1234567')).toBe('••••4567');
    expect(maskDocumentNumber('784199012345671')).toBe('•••••••••••5671');
  });

  it('leaves short values visible and handles empty input', () => {
    expect(maskDocumentNumber('1234')).toBe('1234');
    expect(maskDocumentNumber('12')).toBe('12');
    expect(maskDocumentNumber(null)).toBe('');
    expect(maskDocumentNumber('')).toBe('');
  });

  it('accepts another number of visible characters', () => {
    expect(maskDocumentNumber('ABCDEFGH', 2)).toBe('••••••GH');
    expect(maskDocumentNumber('ABCD', 0)).toBe('••••');
  });
});

describe('shortKey', () => {
  it('shortens long ids and keeps short ones', () => {
    expect(shortKey('ck_0123456789abcdef0123')).toBe('ck_0123456…0123');
    expect(shortKey('ck_short')).toBe('ck_short');
  });
});
