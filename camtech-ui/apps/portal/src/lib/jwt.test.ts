import { describe, expect, it } from 'vitest';
import { base64UrlDecode, decodeJwt, secondsUntilExpiry } from './jwt';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const header = { alg: 'RS256', typ: 'JWT', kid: 'camtech-1' };
const payload = { iss: 'camtech', sub: 'usr_8812', sid: '3b6e1c0a', decision: 'APPROVED', name: 'سارة', iat: 1791450138, exp: 1791450738 };
const token = `${b64url(header)}.${b64url(payload)}.c2lnbmF0dXJl`;

describe('decodeJwt', () => {
  it('decodes header, claims (UTF-8 included) and times', () => {
    const r = decodeJwt(token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jwt.header).toEqual(header);
    expect(r.jwt.payload).toEqual(payload);
    expect(r.jwt.signature).toBe('c2lnbmF0dXJl');
    expect(r.jwt.expiresAt).toBe(1791450738);
    expect(r.jwt.issuedAt).toBe(1791450138);
  });

  it('tolerates surrounding whitespace', () => {
    expect(decodeJwt(`  ${token}\n`).ok).toBe(true);
  });

  it.each([
    ['mock', 'three base64url parts'],
    ['a.b', 'three base64url parts'],
    ['a.b.c.d', 'three base64url parts'],
    ['@@.@@.@@', 'three base64url parts'],
    [`${b64url(header)}.bm90IGpzb24.sig`, 'payload is not valid JSON'],
    [`${b64url([1, 2])}.${b64url(payload)}.sig`, 'header is not a JSON object'],
  ])('rejects %j', (input, message) => {
    const r = decodeJwt(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('leaves times null when the claims are missing or not numbers', () => {
    const r = decodeJwt(`${b64url(header)}.${b64url({ exp: 'soon' })}.`);
    expect(r.ok && r.jwt.expiresAt).toBeNull();
  });
});

describe('secondsUntilExpiry', () => {
  it('counts down to exp and goes negative after it', () => {
    const r = decodeJwt(token);
    if (!r.ok) throw new Error('expected a token');
    expect(secondsUntilExpiry(r.jwt, 1791450738 * 1000 - 90_000)).toBe(90);
    expect(secondsUntilExpiry(r.jwt, 1791450738 * 1000 + 5_000)).toBe(-5);
  });
});

describe('base64UrlDecode', () => {
  it('handles missing padding and url-safe characters', () => {
    expect(base64UrlDecode('aGk')).toBe('hi');
    expect(base64UrlDecode(Buffer.from('??>>').toString('base64url'))).toBe('??>>');
  });
});
