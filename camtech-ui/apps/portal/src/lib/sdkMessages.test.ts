import { describe, expect, it } from 'vitest';
import { asApiCall, findResultTokens, parseSdkMessage, summarize } from './sdkMessages';

describe('parseSdkMessage', () => {
  it('accepts well-formed SDK messages', () => {
    expect(parseSdkMessage({ source: 'camtech-sdk', version: 1, type: 'ready', payload: null })).toEqual({ source: 'camtech-sdk', version: 1, type: 'ready', payload: null });
  });

  it('ignores anything else', () => {
    expect(parseSdkMessage(null)).toBeNull();
    expect(parseSdkMessage('hello')).toBeNull();
    expect(parseSdkMessage({ source: 'other', type: 'ready' })).toBeNull();
    expect(parseSdkMessage({ source: 'camtech-sdk', type: 'explode' })).toBeNull();
  });
});

describe('asApiCall / summarize', () => {
  it('reads API call events', () => {
    const msg = parseSdkMessage({ source: 'camtech-sdk', version: 1, type: 'event', payload: { method: 'post', path: '/v2/selfie-verifications', status: 201, ms: 183.4 } });
    expect(msg && asApiCall(msg.payload)).toEqual({ method: 'POST', path: '/v2/selfie-verifications', status: 201, ms: 183.4 });
    expect(msg && summarize(msg)).toBe('POST /v2/selfie-verifications → 201 · 183 ms');
  });

  it('summarises errors', () => {
    const msg = parseSdkMessage({ source: 'camtech-sdk', version: 1, type: 'error', payload: { code: 'ORIGIN_NOT_ALLOWED', message: 'Not allowed' } });
    expect(msg && summarize(msg)).toBe('ORIGIN_NOT_ALLOWED: Not allowed');
  });
});

describe('findResultTokens', () => {
  it('finds tokens anywhere, with their flow', () => {
    const payload = {
      results: [
        { flow: 'SELFIE_ID_VERIFICATION', decision: 'APPROVED', resultToken: 'a.b.c' },
        { flowCode: 'FACE_AUTHENTICATION', result: { resultToken: 'd.e.f' } },
        { flow: 'DOCUMENT_SCAN', resultToken: null },
      ],
    };
    expect(findResultTokens(payload)).toEqual([
      { path: 'results[0].resultToken', token: 'a.b.c', flow: 'SELFIE_ID_VERIFICATION' },
      { path: 'results[1].result.resultToken', token: 'd.e.f', flow: null },
    ]);
  });
});
