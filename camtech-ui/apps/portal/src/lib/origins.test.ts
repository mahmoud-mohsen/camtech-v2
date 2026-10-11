import { describe, expect, it } from 'vitest';
import { validateOrigin, validateOrigins } from './origins';

describe('validateOrigin', () => {
  it.each([
    ['https://app.example.com', 'https://app.example.com'],
    ['https://app.example.com/', 'https://app.example.com'],
    ['  HTTPS://App.Example.COM  ', 'https://app.example.com'],
    ['https://app.example.com:8443', 'https://app.example.com:8443'],
    ['https://app.example.com:443', 'https://app.example.com'],
    ['https://sub-domain.my-app.co.uk', 'https://sub-domain.my-app.co.uk'],
    ['http://localhost:5175', 'http://localhost:5175'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['https://10.0.0.5', 'https://10.0.0.5'],
  ])('accepts %s', (input, expected) => {
    expect(validateOrigin(input)).toEqual({ ok: true, origin: expected });
  });

  it.each([
    ['', 'Enter an origin'],
    ['app.example.com', 'https://host'],
    ['http://app.example.com', 'http:// is allowed only for localhost'],
    ['ftp://app.example.com', 'scheme'],
    ['https://app.example.com/login', 'remove the path'],
    ['https://app.example.com?x=1', 'remove the path'],
    ['https://*.example.com', 'Wildcards'],
    ['https://user:pw@app.example.com', 'user name'],
    ['https://app.example.com:0', 'port'],
    ['https://app.example.com:70000', 'port'],
    ['https://-bad.example.com', 'not a valid host'],
    ['https://intranet', 'not a valid host'],
    ['https://exa mple.com', 'not a valid host'],
  ])('rejects %j', (input, message) => {
    const r = validateOrigin(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});

describe('validateOrigins', () => {
  it('normalises and de-duplicates', () => {
    expect(validateOrigins(['https://a.example.com/', 'https://A.example.com', 'http://localhost:5175'])).toEqual({
      ok: true,
      origins: ['https://a.example.com', 'http://localhost:5175'],
    });
  });

  it('reports the first bad entry with its index', () => {
    const r = validateOrigins(['https://ok.example.com', 'nope']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.index).toBe(1);
  });
});
