import { describe, expect, it } from 'vitest';
import { CamtechApiError, CamtechPublicClient, CHALLENGE_ACTIONS, type LivenessChallengeTarget } from '@camtech/api-client';
import { createMockTransport } from '../mocks/server';
import { createTranslator } from '../i18n';
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';
import {
  contrastRatio, mergeBranding, onColor, parseColor, resolveScheme, safeLink, safeLogo, sanitizeFontFamily, themeVars,
  DEFAULT_BRANDING,
} from '../theme/theme';
import { EMPTY_FIELDS, humanizeKey, prefillFromScan, prefillFromScans, stringFields } from './fields';
import { apiPath, instrumented } from './transport';
import type { ApiCallEvent } from './protocol';

describe('theme', () => {
  it('parses colours and computes WCAG contrast', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#1554F0')).toEqual({ r: 21, g: 84, b: 240 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor('red')).toBeNull();
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 0);
  });

  it('picks a readable text colour on the brand colour', () => {
    expect(onColor({ r: 21, g: 84, b: 240 })).toBe('#FFFFFF');
    expect(onColor({ r: 255, g: 214, b: 0 })).toBe('#101828');
  });

  it('produces variables with sufficient contrast, also in dark mode', () => {
    const light = themeVars({ ...DEFAULT_BRANDING, primaryColor: '#FFD600' }, 'light');
    expect(light['--ct-on-primary']).toBe('#101828');
    const link = parseColor(light['--ct-link'])!;
    expect(contrastRatio(link, parseColor(light['--ct-surface'])!)).toBeGreaterThanOrEqual(4.5);
    const dark = themeVars(DEFAULT_BRANDING, 'dark');
    expect(contrastRatio(parseColor(dark['--ct-text'])!, parseColor(dark['--ct-surface'])!)).toBeGreaterThanOrEqual(4.5);
    expect(dark.colorScheme).toBe('dark');
    expect(resolveScheme('AUTO', true)).toBe('dark');
    expect(resolveScheme('LIGHT', true)).toBe('light');
  });

  it('sanitizes tenant-provided values', () => {
    expect(sanitizeFontFamily('Open Sans; } body { x')).toBe('"Open Sans  body  x"');
    expect(sanitizeFontFamily('Cairo, sans-serif')).toBe('Cairo, sans-serif');
    expect(safeLogo('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeLogo('https://evil.example/logo.png')).toBeNull();
    expect(safeLogo('data:text/html;base64,AAAA')).toBeNull();
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('https://bank.example/privacy')).toBe('https://bank.example/privacy');
  });

  it('merges overrides on top of the server branding', () => {
    const b = mergeBranding({ ...DEFAULT_BRANDING, displayName: 'Server', texts: { en: { welcomeTitle: 'Hi' } } },
      { primaryColor: '#000000', texts: { ar: { welcomeTitle: 'مرحبا' } } });
    expect(b.displayName).toBe('Server');
    expect(b.primaryColor).toBe('#000000');
    expect(b.texts.en?.welcomeTitle).toBe('Hi');
    expect(b.texts.ar?.welcomeTitle).toBe('مرحبا');
  });
});

describe('i18n', () => {
  it('has an Arabic translation for every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ar) || !ar[k].trim());
    expect(missing).toEqual([]);
  });

  it('interpolates, pluralises and labels fields', () => {
    const t = createTranslator('en');
    expect(t.t('challengeStep', { n: 2, total: 3 })).toBe('Step 2 of 3');
    expect(t.tn('attemptsLeft', 1)).toBe('1 attempt left');
    expect(t.tn('attemptsLeft', 3)).toBe('3 attempts left');
    expect(t.fieldLabel('licenseNo')).toBe('Licence number');
    expect(t.fieldLabel('someNewField')).toBe('Some new field');
    expect(t.tk('hint_UNKNOWN', undefined, 'fallback')).toBe('fallback');
    const a = createTranslator('ar');
    expect(a.dir).toBe('rtl');
    expect(a.tn('attemptsLeft', 2)).toBe('محاولتان متبقيتان');
    expect(a.tn('attemptsLeft', 5)).toBe('5 محاولات متبقية');
  });
});

describe('OCR fields', () => {
  it('prefills an Emirates ID', () => {
    const f = prefillFromScan('EMIRATES_ID', { idNumber: '784199012345676', nameEn: 'Ahmed Hassan', expiryDate: '28/02/2027', dateOfBirth: '15/01/1990' });
    expect(f).toMatchObject({ documentNumber: '784-1990-1234567-6', fullName: 'Ahmed Hassan', expiryDate: '2027-02-28', dateOfBirth: '1990-01-15', mrzLine2: '', issuingCountry: '' });
  });

  it('falls back to the Arabic name when no English name was read', () => {
    const f = prefillFromScan('EMIRATES_ID', { emiratesIdNumber: '784-1990-1234567-6', fullNameAr: 'أحمد حسن', expiryDate: '27/04/2027' });
    expect(f).toMatchObject({ documentNumber: '784-1990-1234567-6', fullName: 'أحمد حسن', expiryDate: '2027-04-27' });
    expect(prefillFromScan('EMIRATES_ID', { fullNameEn: 'Ahmed Hassan', fullNameAr: 'أحمد حسن' }).fullName).toBe('Ahmed Hassan');
  });

  it('prefills a passport from its MRZ when fields are missing', () => {
    const f = prefillFromScan('PASSPORT', { surname: 'ERIKSSON', givenNames: 'ANNA MARIA' },
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10');
    expect(f.mrzLine2).toBe('L898902C36UTO7408122F1204159ZE184226B<<<<<10');
    expect(f.documentNumber).toBe('L898902C3');
    expect(f.dateOfBirth).toBe('1974-08-12');
    expect(f.issuingCountry).toBe('UTO');
    expect(f.fullName).toBe('ANNA MARIA ERIKSSON');
  });

  describe('prefillFromScans (Emirates ID front + back)', () => {
    const front = { fields: { idNumber: '784199012345670', nameEn: 'Ahmed Hasan', expiryDate: '28/02/2027', dateOfBirth: '15/01/1991' } };
    const mrz = {
      emiratesIdNumber: '784-1990-1234567-6', cardNumber: '123456789', dateOfBirth: '15/01/1990', expiryDate: '27/04/2028',
      gender: 'Male', nationalityCode: 'EGY', fullNameEn: 'AHMED MOHAMED HASSAN',
    };

    it('lets a verified MRZ win over the front', () => {
      const r = prefillFromScans('EMIRATES_ID', front, { fields: { ...mrz, mrzVerified: true } });
      expect(r.ocrFailed).toBe(false);
      expect(r.fields).toMatchObject({
        documentNumber: '784-1990-1234567-6', dateOfBirth: '1990-01-15', expiryDate: '2028-04-27', fullName: 'AHMED MOHAMED HASSAN', issuingCountry: '',
      });
    });

    it('only fills gaps from an unverified MRZ', () => {
      const r = prefillFromScans('EMIRATES_ID', { fields: { idNumber: '784199012345670' } }, { fields: { ...mrz, mrzVerified: false } });
      expect(r.fields).toMatchObject({ documentNumber: '784-1990-1234567-0', dateOfBirth: '1990-01-15', expiryDate: '2028-04-27', fullName: 'AHMED MOHAMED HASSAN' });
      expect(prefillFromScans('EMIRATES_ID', front, { fields: mrz }).fields).toMatchObject({ documentNumber: '784-1990-1234567-0', fullName: 'Ahmed Hasan' });
    });

    it('prefers a Latin name from the back over the Arabic fallback of the front', () => {
      const r = prefillFromScans('EMIRATES_ID', { fields: { fullNameAr: 'أحمد حسن' } }, { fields: { fullNameEn: 'AHMED HASSAN' } });
      expect(r.fields.fullName).toBe('AHMED HASSAN');
    });

    it('uses whichever side was read and flags OCR failure only when both gave nothing', () => {
      expect(prefillFromScans('EMIRATES_ID', front, null).fields.documentNumber).toBe('784-1990-1234567-0');
      expect(prefillFromScans('EMIRATES_ID', null, { fields: { ...mrz, mrzVerified: true } }).fields.expiryDate).toBe('2028-04-27');
      expect(prefillFromScans('EMIRATES_ID', null, null)).toEqual({ fields: EMPTY_FIELDS, ocrFailed: true });
      expect(prefillFromScans('EMIRATES_ID', { fields: { nameEn: 'X' } }, { fields: { occupation: 'Engineer' } }).ocrFailed).toBe(true);
    });
  });

  it('flattens and humanizes fields', () => {
    expect(stringFields({ a: 'x', b: null, c: { d: 2 }, e: ['p', 'q'], f: '' })).toEqual({ a: 'x', 'c.d': '2', e: 'p, q' });
    expect(humanizeKey('licenseNo')).toBe('License no');
    expect(humanizeKey('date_of_expiry')).toBe('Date of expiry');
    expect(humanizeKey('MRZLine2')).toBe('Mrz line2');
  });
});

describe('debug transport', () => {
  it('reports method, path, status and duration only', async () => {
    const events: ApiCallEvent[] = [];
    const t = instrumented(async () => new Response('{}', { status: 201 }), 'https://api.example/camtech-service', (e) => events.push(e));
    await t('https://api.example/camtech-service/v2/selfie-verifications?x=secret', { method: 'POST', headers: { 'X-Sdk-Token': 'secret' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'api', method: 'POST', path: '/v2/selfie-verifications', status: 201 });
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(apiPath('https://other/v2/x?y=1', 'https://api.example')).toBe('/v2/x');
  });
});

describe('mock API through the real client', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const challengeFor = async (c: CamtechPublicClient, target: LivenessChallengeTarget) => {
    const ch = await c.createLivenessChallenge(target);
    return { challengeId: ch.challengeId, frames: [jpeg(), jpeg(), jpeg()] };
  };
  const client = (scenarios: string[] = []) => new CamtechPublicClient({
    baseUrl: 'http://mock.local/camtech-service', auth: { sdkToken: 'mock' },
    transport: createMockTransport({ scenarios, speed: 0 }),
  });

  it('runs a selfie verification to an approved result token', async () => {
    const c = client();
    const caps = await c.capabilities();
    expect(caps.flows.map((f) => f.code)).toContain('SELFIE_ID_VERIFICATION');
    const s = await c.startSelfieVerification({ subjectRef: 'demo-user' });
    const ch = await c.createLivenessChallenge({ sessionId: s.sessionId });
    expect(ch.actions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ch.actions).size).toBe(ch.actions.length);
    const l = await c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, { challengeId: ch.challengeId, frames: [jpeg()] });
    expect(l.nextStep).toBe('DOCUMENT');
    const d = await c.submitDocument(s.sessionId, { documentType: 'EMIRATES_ID', document: jpeg(), documentNumber: '784-1990-1234567-6', expiryDate: '2030-01-01' });
    expect(d).toMatchObject({ result: 'MATCH', decision: 'APPROVED', nextStep: 'DONE' });
    const r = await c.getResult(s.sessionId);
    expect(r.resultToken).toBeTruthy();
  });

  it('applies scenarios: first liveness too dark, document expired, face service busy', async () => {
    const c = client(['TOO_DARK']);
    const s = await c.startSelfieVerification();
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(c, s))).rejects.toMatchObject({ status: 422, code: 'TOO_DARK', nextStep: 'LIVENESS', attemptsRemaining: 4 });
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(c, s))).resolves.toMatchObject({ result: 'PASSED' });
    await expect(c.submitDocument(s.sessionId, { documentType: 'EMIRATES_ID', document: jpeg(), expiryDate: '2001-01-01' }))
      .rejects.toMatchObject({ code: 'ID_EXPIRED', nextStep: 'DOCUMENT' });
    const busy = client(['FACE_SERVICE_UNAVAILABLE']);
    const s2 = await busy.startSelfieVerification();
    const e = await busy.submitLiveness(s2.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(busy, s2)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CamtechApiError);
    expect((e as CamtechApiError).retryable).toBe(true);
  });

  it('answers face authentication and OCR', async () => {
    const fa = client();
    await expect(fa.faceAuthenticate('demo-user', jpeg(), jpeg(), undefined, undefined, await challengeFor(fa, { subjectRef: 'demo-user' }))).resolves.toMatchObject({ decision: 'APPROVED' });
    const ne = client(['NO_ENROLLED_FACE']);
    await expect(ne.faceAuthenticate('demo-user', jpeg(), jpeg(), undefined, undefined, await challengeFor(ne, { subjectRef: 'demo-user' }))).rejects.toMatchObject({ status: 404, code: 'NO_ENROLLED_FACE' });
    const scan = await client().scanDocument(jpeg(), 'PASSPORT', { store: false });
    expect(scan.success).toBe(true);
    const f = prefillFromScan('PASSPORT', scan.fields);
    expect(f.mrzLine2).toHaveLength(44);
    expect(f.documentNumber).toBe('A12345678');
    const back = await client().scanDocument(jpeg(), 'EMIRATES_ID_BACK', { store: false });
    expect(back.fields).toMatchObject({ mrzVerified: true, nationalityCode: 'EGY' });
    const eid = prefillFromScans('EMIRATES_ID', null, back);
    expect(eid.fields.documentNumber).toBe('784-1990-1234567-6');
    expect(eid.ocrFailed).toBe(false);
  });

  it('accepts the Emirates ID back with the document', async () => {
    const c = client();
    const s = await c.startSelfieVerification();
    await c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(c, s));
    await expect(c.submitDocument(s.sessionId, {
      documentType: 'EMIRATES_ID', document: jpeg(), documentBack: jpeg(), documentNumber: '784-1990-1234567-6', expiryDate: '2030-01-01',
    })).resolves.toMatchObject({ decision: 'APPROVED' });
    const c2 = client();
    const s2 = await c2.startSelfieVerification();
    await c2.submitLiveness(s2.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(c2, s2));
    await expect(c2.submitDocument(s2.sessionId, { documentType: 'EMIRATES_ID', document: jpeg(), documentBack: new Blob([]) }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('enforces the active-liveness challenge', async () => {
    const c = client();
    const s = await c.startSelfieVerification();
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg())).rejects.toMatchObject({ status: 400, code: 'CHALLENGE_REQUIRED' });
    const sub = await challengeFor(c, s);
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, sub)).resolves.toMatchObject({ result: 'PASSED' });
    const s2 = await c.startSelfieVerification();
    await expect(c.submitLiveness(s2.sessionId, jpeg(), jpeg(), undefined, undefined, sub)).rejects.toMatchObject({ status: 409, code: 'CHALLENGE_INVALID' });
    await expect(c.submitLiveness(s2.sessionId, jpeg(), jpeg(), undefined, undefined, { ...(await challengeFor(c, s2)), frames: [] }))
      .rejects.toMatchObject({ status: 400 });

    const failing = client(['CHALLENGE_FAILED']);
    const f = await failing.startSelfieVerification();
    await expect(failing.submitLiveness(f.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(failing, f)))
      .rejects.toMatchObject({ status: 422, code: 'CHALLENGE_FAILED', attemptsRemaining: 4, nextStep: 'LIVENESS' });
    const expiring = client(['CHALLENGE_EXPIRED']);
    const x = await expiring.startSelfieVerification();
    await expect(expiring.submitLiveness(x.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(expiring, x)))
      .rejects.toMatchObject({ status: 409, code: 'CHALLENGE_EXPIRED' });
    await expect(expiring.submitLiveness(x.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(expiring, x)))
      .resolves.toMatchObject({ result: 'PASSED' });

    const optional = client(['NO_CHALLENGE']);
    const caps = await optional.capabilities();
    expect(caps.flows[0].settings.livenessChallengeRequired).toBe(false);
    const o = await optional.startSelfieVerification();
    await expect(optional.createLivenessChallenge({ sessionId: o.sessionId })).rejects.toMatchObject({ status: 403 });
    await expect(optional.submitLiveness(o.sessionId, jpeg(), jpeg())).resolves.toMatchObject({ result: 'PASSED' });
  });

  it('draws challenges from the supported actions of the client and honours PASSIVE face authentication', async () => {
    const c = client();
    const caps = await c.capabilities();
    const selfie = caps.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')!;
    expect(selfie.settings).toMatchObject({ livenessMode: 'ACTIVE', challengeCount: 2 });
    expect(selfie.settings.challengeActions).toHaveLength(7);
    const s = await c.startSelfieVerification();
    // Without supportedActions only the original three are drawn (never MOVE_CLOSER).
    for (let i = 0; i < 8; i++) {
      const legacy = await c.createLivenessChallenge({ sessionId: s.sessionId });
      expect(legacy.actions.every((a) => ['TURN_LEFT', 'TURN_RIGHT', 'BLINK'].includes(a))).toBe(true);
    }
    const onlyNew = await c.createLivenessChallenge({ sessionId: s.sessionId, supportedActions: ['LOOK_UP', 'SMILE'] });
    expect([...onlyNew.actions].sort()).toEqual(['LOOK_UP', 'SMILE']);
    await expect(c.createLivenessChallenge({ sessionId: s.sessionId, supportedActions: ['BLINK'] }))
      .rejects.toMatchObject({ status: 400, code: 'CHALLENGE_REQUIRED' });
    // Up to 16 challenge frames are accepted.
    const ch = await c.createLivenessChallenge({ sessionId: s.sessionId, supportedActions: [...CHALLENGE_ACTIONS] });
    const frames = Array.from({ length: 16 }, jpeg);
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, { challengeId: ch.challengeId, frames })).resolves.toMatchObject({ result: 'PASSED' });

    const fresh = client(['NEW_ACTIONS']);
    const n = await fresh.createLivenessChallenge({ subjectRef: 'demo-user', supportedActions: [...CHALLENGE_ACTIONS] });
    expect(n.actions).toHaveLength(3);
    expect(n.actions.every((a) => ['LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'].includes(a))).toBe(true);
    const closer = client(['WITH_MOVE_CLOSER']);
    for (let i = 0; i < 5; i++) {
      const m = await closer.createLivenessChallenge({ subjectRef: 'demo-user', supportedActions: [...CHALLENGE_ACTIONS] });
      expect(m.actions).toContain('MOVE_CLOSER');
      expect(m.actions).toHaveLength(2);
    }

    const passive = client(['PASSIVE']);
    const pc = await passive.capabilities();
    expect(pc.flows.find((f) => f.code === 'FACE_AUTHENTICATION')?.settings).toMatchObject({ livenessMode: 'PASSIVE', livenessChallengeRequired: false });
    expect(pc.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')?.settings.livenessMode).toBe('ACTIVE');
    await expect(passive.createLivenessChallenge({ subjectRef: 'demo-user' })).rejects.toMatchObject({ status: 409, code: 'CHALLENGE_NOT_USED' });
    await expect(passive.faceAuthenticate('demo-user', jpeg(), null)).resolves.toMatchObject({ decision: 'APPROVED' });
  });

  it('uploads the normal selfie without a closer one (and still accepts a closer one from older clients)', async () => {
    const sent: FormData[] = [];
    const inner = createMockTransport({ scenarios: ['PASSIVE'], speed: 0 });
    const c = new CamtechPublicClient({
      baseUrl: 'http://mock.local/camtech-service', auth: { sdkToken: 'mock' },
      transport: (url, init) => {
        if (init.body instanceof FormData) sent.push(init.body);
        return inner(url, init);
      },
    });
    const s = await c.startSelfieVerification();
    await expect(c.submitLiveness(s.sessionId, jpeg(), null, undefined, undefined, await challengeFor(c, s))).resolves.toMatchObject({ result: 'PASSED' });
    // PASSIVE face authentication: the normal selfie only, no challenge.
    await expect(c.faceAuthenticate('demo-user', jpeg(), null)).resolves.toMatchObject({ decision: 'APPROVED' });
    expect(sent).toHaveLength(2);
    for (const form of sent) {
      expect(form.has('normal')).toBe(true);
      expect(form.has('closer')).toBe(false);
    }
    expect(sent[0].getAll('challengeFrames').length).toBeGreaterThan(0);
    expect(sent[1].has('challengeId')).toBe(false);
    const old = client();
    const o = await old.startSelfieVerification();
    await expect(old.submitLiveness(o.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(old, o))).resolves.toMatchObject({ result: 'PASSED' });
  });

  it('fails the first liveness with FACE_NOT_VISIBLE', async () => {
    const c = client(['FACE_NOT_VISIBLE']);
    const s = await c.startSelfieVerification();
    await expect(c.submitLiveness(s.sessionId, jpeg(), jpeg(), undefined, undefined, await challengeFor(c, s)))
      .rejects.toMatchObject({ status: 422, code: 'FACE_NOT_VISIBLE', nextStep: 'LIVENESS' });
  });

  it('runs a liveness check without a subject and binds challenges to their flow', async () => {
    const sent: FormData[] = [];
    const inner = createMockTransport({ scenarios: [], speed: 0 });
    const c = new CamtechPublicClient({
      baseUrl: 'http://mock.local/camtech-service', auth: { sdkToken: 'mock' },
      transport: (url, init) => {
        if (init.body instanceof FormData) sent.push(init.body);
        return inner(url, init);
      },
    });
    const caps = await c.capabilities();
    expect(caps.flows.find((f) => f.code === 'LIVENESS_CHECK')).toMatchObject({ steps: ['LIVENESS'], documents: [], settings: { livenessMode: 'ACTIVE' } });
    expect(caps.flows.find((f) => f.code === 'FACE_ENROLLMENT')?.steps).toEqual(['LIVENESS', 'DEDUP_SEARCH']);
    expect(caps.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')?.settings.faceEnrollmentAvailable).toBe(true);
    const ch = await challengeFor(c, { flow: 'LIVENESS_CHECK' });
    const res = await c.livenessCheck(null, jpeg(), null, undefined, undefined, ch);
    expect(res).toMatchObject({ decision: 'APPROVED', reasonCode: null });
    expect(res.resultToken).toBeTruthy();
    expect(sent[0].has('subjectRef')).toBe(false);
    // A face authentication challenge is not valid for a liveness check.
    await expect(c.livenessCheck(null, jpeg(), null, undefined, undefined, await challengeFor(c, { subjectRef: 'u1' })))
      .rejects.toMatchObject({ status: 409, code: 'CHALLENGE_INVALID' });
    await expect(c.createLivenessChallenge({ flow: 'FACE_ENROLLMENT' } as never)).rejects.toMatchObject({ status: 400 });
    // A failed liveness is a 200 REJECTED with the liveness code.
    const dark = client(['TOO_DARK']);
    await expect(dark.livenessCheck('u1', jpeg(), null, undefined, undefined, await challengeFor(dark, { subjectRef: 'u1', flow: 'LIVENESS_CHECK' })))
      .resolves.toMatchObject({ decision: 'REJECTED', reasonCode: 'TOO_DARK' });
  });

  it('registers a face, then authenticates it and refuses a second registration', async () => {
    const c = client(['NO_ENROLLED_FACE']);
    const target = { subjectRef: 'u1', flow: 'FACE_ENROLLMENT' } as const;
    await expect(c.faceAuthenticate('u1', jpeg(), null, undefined, undefined, await challengeFor(c, { subjectRef: 'u1' })))
      .rejects.toMatchObject({ status: 404, code: 'NO_ENROLLED_FACE' });
    await expect(c.faceEnroll('u1', jpeg(), null, undefined, undefined, await challengeFor(c, target))).resolves.toMatchObject({ decision: 'APPROVED' });
    await expect(c.faceAuthenticate('u1', jpeg(), null, undefined, undefined, await challengeFor(c, { subjectRef: 'u1' })))
      .resolves.toMatchObject({ decision: 'APPROVED' });
    await expect(c.createLivenessChallenge(target)).rejects.toMatchObject({ status: 409, code: 'FACE_ALREADY_ENROLLED' });
    await expect(c.faceEnroll('', jpeg(), null)).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });

    const already = client(['ALREADY_ENROLLED']);
    await expect(already.createLivenessChallenge(target)).rejects.toMatchObject({ status: 409, code: 'FACE_ALREADY_ENROLLED' });
    await expect(already.faceEnroll('u1', jpeg(), null)).rejects.toMatchObject({ status: 409, code: 'FACE_ALREADY_ENROLLED' });
    const codes = await already.reasonCodes();
    expect(codes.find((r) => r.code === 'FACE_ALREADY_ENROLLED')?.category).toBe('MATCH');

    const dup = client(['DUPLICATE']);
    await expect(dup.faceEnroll('u2', jpeg(), null, undefined, undefined, await challengeFor(dup, { subjectRef: 'u2', flow: 'FACE_ENROLLMENT' })))
      .resolves.toMatchObject({ decision: 'REVIEW', reasonCode: 'DUPLICATE_IDENTITY' });
    const dupOff = client(['DUPLICATE', 'REJECTED']);
    await expect(dupOff.faceEnroll('u2', jpeg(), null, undefined, undefined, await challengeFor(dupOff, { subjectRef: 'u2', flow: 'FACE_ENROLLMENT' })))
      .resolves.toMatchObject({ decision: 'REJECTED', reasonCode: 'DUPLICATE_IDENTITY' });
  });

  it('registers the face of an approved selfie verification unless enrollFace is false', async () => {
    const verify = async (c: CamtechPublicClient, enrollFace?: boolean) => {
      const s = await c.startSelfieVerification({ subjectRef: 'u3', enrollFace });
      await c.submitLiveness(s.sessionId, jpeg(), null, undefined, undefined, await challengeFor(c, s));
      await c.submitDocument(s.sessionId, { documentType: 'PASSPORT', document: jpeg() });
      return s;
    };
    const auth = async (c: CamtechPublicClient) => c.faceAuthenticate('u3', jpeg(), null, undefined, undefined, await challengeFor(c, { subjectRef: 'u3' }));
    const off = client(['NO_ENROLLED_FACE']);
    expect((await verify(off, false)).enrollFace).toBe(false);
    await expect(auth(off)).rejects.toMatchObject({ code: 'NO_ENROLLED_FACE' });
    const on = client(['NO_ENROLLED_FACE']);
    expect((await verify(on)).enrollFace).toBe(true);
    await expect(auth(on)).resolves.toMatchObject({ decision: 'APPROVED' });
  });

  it('requires authentication', async () => {
    const c = new CamtechPublicClient({ baseUrl: 'http://mock.local/camtech-service', auth: {}, transport: createMockTransport({ scenarios: [], speed: 0 }) });
    await expect(c.capabilities()).rejects.toMatchObject({ status: 401, code: 'CLIENT_AUTH_REQUIRED' });
  });
});
