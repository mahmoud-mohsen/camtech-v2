import { describe, expect, it } from 'vitest';
import { buildReturnUrl, parseHostedLocation, stripHash } from '../config/hosted';
import { normalizeOptions, serializableOptions, subjectFromSdkToken } from '../config/options';
import { isHostMessage, isPortalBrandingMessage, isSdkMessage, isTrustedEvent, originOf, sdkMessage } from './protocol';

describe('origins', () => {
  it('extracts http(s) origins only', () => {
    expect(originOf('https://bank.example/path?q=1#x')).toBe('https://bank.example');
    expect(originOf('http://localhost:5173/app')).toBe('http://localhost:5173');
    expect(originOf('/relative', 'https://sdk.example/index.html')).toBe('https://sdk.example');
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('data:text/html,hi')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf(null)).toBeNull();
  });

  it('trusts only the exact expected origin and window', () => {
    const win = {} as MessageEventSource;
    const other = {} as MessageEventSource;
    expect(isTrustedEvent({ origin: 'https://bank.example', source: win }, 'https://bank.example', win)).toBe(true);
    expect(isTrustedEvent({ origin: 'https://bank.example', source: other }, 'https://bank.example', win)).toBe(false);
    expect(isTrustedEvent({ origin: 'https://bank.example.evil.com', source: win }, 'https://bank.example', win)).toBe(false);
    expect(isTrustedEvent({ origin: 'http://bank.example', source: win }, 'https://bank.example', win)).toBe(false);
    expect(isTrustedEvent({ origin: 'https://bank.example', source: win }, null, win)).toBe(false);
    expect(isTrustedEvent({ origin: '*', source: win }, '*', win)).toBe(false);
    expect(isTrustedEvent({ origin: 'null', source: win }, 'null', win)).toBe(false);
    expect(isTrustedEvent({ origin: 'https://bank.example', source: null }, 'https://bank.example')).toBe(true);
  });
});

describe('message shapes', () => {
  it('builds and recognises SDK messages', () => {
    const m = sdkMessage('step', { flow: 'SELFIE_ID_VERIFICATION', step: 'LIVENESS' });
    expect(m).toEqual({ source: 'camtech-sdk', version: 1, type: 'step', payload: { flow: 'SELFIE_ID_VERIFICATION', step: 'LIVENESS' } });
    expect(isSdkMessage(m)).toBe(true);
    expect(isSdkMessage({ ...m, version: 2 })).toBe(false);
    expect(isSdkMessage({ ...m, type: 'hack' })).toBe(false);
    expect(isSdkMessage({ ...m, payload: 'x' })).toBe(false);
    expect(isSdkMessage(null)).toBe(false);
  });

  it('recognises host and portal messages', () => {
    expect(isHostMessage({ source: 'camtech-host', type: 'init', payload: { sdkToken: 't' } })).toBe(true);
    expect(isHostMessage({ source: 'camtech-host', type: 'eval', payload: {} })).toBe(false);
    expect(isHostMessage({ source: 'camtech-sdk', type: 'init', payload: {} })).toBe(false);
    expect(isPortalBrandingMessage({ source: 'camtech-portal', type: 'branding', payload: { primaryColor: '#000' } })).toBe(true);
    expect(isPortalBrandingMessage({ source: 'camtech-portal', type: 'branding', payload: null })).toBe(false);
  });

  it('serializes only data options (no callbacks, no DOM)', () => {
    const out = serializableOptions({
      sdkToken: 'tok', journey: ['DOCUMENT_SCAN'], lang: 'ar', onComplete: () => undefined, container: 'x',
    } as Parameters<typeof serializableOptions>[0]);
    expect(out).toEqual({ sdkToken: 'tok', journey: ['DOCUMENT_SCAN'], lang: 'ar' });
    expect(serializableOptions({ sdkToken: 'tok', enrollFace: false })).toEqual({ sdkToken: 'tok', enrollFace: false });
  });

  it('carries the new flows in the complete payload', () => {
    const m = sdkMessage('complete', { results: [
      { flow: 'LIVENESS_CHECK', sessionId: 's1', status: 'COMPLETED', decision: 'APPROVED', resultToken: 't1', resultTokenExpiresAt: null },
      { flow: 'FACE_ENROLLMENT', sessionId: 's2', status: 'COMPLETED', decision: 'REVIEW', resultToken: 't2', resultTokenExpiresAt: null },
    ] });
    expect(isSdkMessage(m)).toBe(true);
    expect(m.type === 'complete' && m.payload.results.map((r) => r.flow)).toEqual(['LIVENESS_CHECK', 'FACE_ENROLLMENT']);
  });
});

describe('hosted page URL', () => {
  it('reads secrets from the hash and options from the query', () => {
    const l = parseHostedLocation('https://sdk.example/?journey=SELFIE_ID_VERIFICATION,DOCUMENT_SCAN&lang=ar&subjectRef=u1&returnUrl=https%3A%2F%2Fbank.example%2Fdone&parentOrigin=https://bank.example#sdkToken=abc');
    expect(l.preview).toBeNull();
    expect(l.hasSecrets).toBe(true);
    expect(l.parentOrigin).toBe('https://bank.example');
    const c = normalizeOptions(l.options);
    expect(c.sdkToken).toBe('abc');
    expect(c.journey).toEqual(['SELFIE_ID_VERIFICATION', 'DOCUMENT_SCAN']);
    expect(c.lang).toBe('ar');
    expect(c.subjectRef).toBe('u1');
    expect(c.returnUrl).toBe('https://bank.example/done');
  });

  it('reads the new flows and enrollFace from the query', () => {
    const c = normalizeOptions(parseHostedLocation('https://sdk.example/?journey=LIVENESS_CHECK,face_enrollment&enrollFace=true#sdkToken=abc').options);
    expect(c.journey).toEqual(['LIVENESS_CHECK', 'FACE_ENROLLMENT']);
    expect(c.enrollFace).toBe(true);
    const enroll = (q: string) => normalizeOptions(parseHostedLocation(`https://sdk.example/?${q}#sdkToken=abc`).options).enrollFace;
    expect(enroll('enrollFace=false')).toBe(false);
    expect(enroll('enrollFace=0')).toBe(false);
    expect(enroll('enrollFace=1')).toBe(true);
    expect(enroll('enrollFace=maybe')).toBeNull();
    expect(enroll('')).toBeNull();
    expect(normalizeOptions({ enrollFace: false }).enrollFace).toBe(false);
    expect(normalizeOptions({ enrollFace: true }).enrollFace).toBe(true);
    expect(normalizeOptions({}).enrollFace).toBeNull();
  });

  it('accepts a session instead of an SDK token', () => {
    const l = parseHostedLocation('https://sdk.example/#sessionId=s1&sessionToken=t1');
    expect(l.hasSecrets).toBe(true);
    expect(normalizeOptions(l.options)).toMatchObject({ sessionId: 's1', sessionToken: 't1', journey: ['SELFIE_ID_VERIFICATION'] });
    expect(parseHostedLocation('https://sdk.example/#sessionId=s1').hasSecrets).toBe(false);
  });

  it('ignores unknown flows, bad return URLs and bad parent origins', () => {
    const l = parseHostedLocation('https://sdk.example/?journey=HACK,FACE_AUTHENTICATION&returnUrl=javascript:alert(1)&parentOrigin=javascript:x&scanTypes=PASSPORT,FOO');
    const c = normalizeOptions(l.options);
    expect(c.journey).toEqual(['FACE_AUTHENTICATION']);
    expect(c.returnUrl).toBeNull();
    expect(c.scanTypes).toEqual(['PASSPORT']);
    expect(l.parentOrigin).toBeNull();
  });

  it('parses the preview mode', () => {
    const l = parseHostedLocation('https://sdk.example/?preview=1&screen=result-review&lang=ar');
    expect(l.preview).toEqual({ screen: 'result-review', lang: 'ar' });
    expect(parseHostedLocation('https://sdk.example/?preview=1&screen=evil').preview?.screen).toBe('welcome');
  });

  it('strips the hash and builds the return URL without tokens', () => {
    expect(stripHash('https://sdk.example/?a=1#sdkToken=secret')).toBe('https://sdk.example/?a=1');
    const url = buildReturnUrl('https://bank.example/done?x=1', 'sess-1', 'completed');
    expect(url).toBe('https://bank.example/done?x=1&camtechSessionId=sess-1&camtechStatus=completed');
    expect(url).not.toContain('Token');
    expect(buildReturnUrl('javascript:alert(1)', null, 'failed')).toBeNull();
    expect(buildReturnUrl('https://bank.example/', null, 'cancelled')).toBe('https://bank.example/?camtechStatus=cancelled');
  });

  it('reads the subject from an SDK token (JWT) when present', () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(subjectFromSdkToken(`${b64({ alg: 'HS256' })}.${b64({ subjectRef: 'usr_1' })}.sig`)).toBe('usr_1');
    expect(subjectFromSdkToken(`${b64({ alg: 'HS256' })}.${b64({ sub: 'usr_2' })}.sig`)).toBe('usr_2');
    expect(subjectFromSdkToken('opaque-token')).toBeNull();
    expect(subjectFromSdkToken('a.b.c')).toBeNull();
  });
});
