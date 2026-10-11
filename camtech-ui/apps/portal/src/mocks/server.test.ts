import { CamtechApiError, CamtechTenantClient } from '@camtech/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from './demoUsers';
import { zipEntries } from './images';
import { createMockTransport, withoutScore } from './server';

const BASE = 'http://localhost:8080/camtech-service';

let transport: ReturnType<typeof createMockTransport>;
/** Bearer token of each tenant's owner, signed in before every test. */
let tokens: Record<string, string>;

const withToken = (token: string | null) => new CamtechTenantClient({ baseUrl: BASE, token: () => token, transport });
/** A client signed in as the owner of NOQODI or DEMO. */
const client = (code: 'NOQODI' | 'DEMO') => withToken(tokens[code]);

async function signIn(username: string, password = DEMO_PASSWORD): Promise<CamtechTenantClient> {
  const res = await withToken(null).login(username, password);
  return withToken(res.token);
}

async function apiError(p: Promise<unknown>): Promise<CamtechApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CamtechApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

beforeEach(async () => {
  transport = createMockTransport({ latency: false });
  const anon = withToken(null);
  tokens = {
    NOQODI: (await anon.login('owner', DEMO_PASSWORD)).token,
    DEMO: (await anon.login('demo.owner', DEMO_PASSWORD)).token,
  };
});

describe('sign-in', () => {
  it('signs in and answers for the user\'s own tenant', async () => {
    const res = await withToken(null).login('owner', DEMO_PASSWORD);
    expect(res.user).toMatchObject({ username: 'owner', role: 'OWNER', status: 'ACTIVE', mustChangePassword: false });
    expect(res.user).not.toHaveProperty('password');
    expect(res.tenant).toEqual({ code: 'NOQODI', name: 'Noqodi' });
    expect((await client('NOQODI').info()).name).toBe('Noqodi');
    expect((await client('DEMO').info()).code).toBe('DEMO');
    expect((await client('DEMO').me()).user.username).toBe('demo.owner');
  });

  it('401 INVALID_LOGIN for a wrong password or unknown user', async () => {
    const bad = await apiError(withToken(null).login('owner', 'nope'));
    expect([bad.status, bad.code]).toEqual([401, 'INVALID_LOGIN']);
    const unknown = await apiError(withToken(null).login('ghost', DEMO_PASSWORD));
    expect(unknown.code).toBe('INVALID_LOGIN');
  });

  it('401 UNAUTHORIZED without a token, with a bad one, and after logout', async () => {
    expect((await apiError(withToken(null).info())).code).toBe('UNAUTHORIZED');
    expect((await apiError(withToken('forged').info())).status).toBe(401);
    const c = await signIn('viewer');
    await c.logout();
    expect((await apiError(c.info())).code).toBe('UNAUTHORIZED');
  });

  it('ignores an X-Tenant-Code header: the tenant comes from the token', async () => {
    const res = await transport(`${BASE}/v2/tenant/info`, { method: 'GET', headers: { 'X-Tenant-Code': 'DEMO', Authorization: `Bearer ${tokens.NOQODI}` } });
    expect(((await res.json()) as { code: string }).code).toBe('NOQODI');
  });

  it('forces the password change, then lets the user in', async () => {
    const res = await withToken(null).login('newbie', DEMO_PASSWORD);
    expect(res.user.mustChangePassword).toBe(true);
    const c = withToken(res.token);
    const blocked = await apiError(c.info());
    expect([blocked.status, blocked.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);
    expect((await c.me()).user.username).toBe('newbie');
    expect((await apiError(c.changePassword('wrong-one1', 'Brand1New2Pass'))).code).toBe('WRONG_PASSWORD');
    expect((await apiError(c.changePassword(DEMO_PASSWORD, 'short1'))).code).toBe('WEAK_PASSWORD');
    expect((await apiError(c.changePassword(DEMO_PASSWORD, 'onlyletterslong'))).code).toBe('WEAK_PASSWORD');
    await c.changePassword(DEMO_PASSWORD, 'Brand1New2Pass');
    expect((await c.me()).user.mustChangePassword).toBe(false);
    expect((await c.info()).code).toBe('NOQODI');
  });

  it('404 for unknown routes and 405 for a wrong method', async () => {
    const auth = { Authorization: `Bearer ${tokens.NOQODI}` };
    const res404 = await transport(`${BASE}/v2/tenant/nope`, { method: 'GET', headers: auth });
    expect(res404.status).toBe(404);
    const res405 = await transport(`${BASE}/v2/tenant/info`, { method: 'DELETE', headers: auth });
    expect(res405.status).toBe(405);
  });
});

describe('roles', () => {
  it('lets every role read, and only builders write apps', async () => {
    const viewer = await signIn('viewer');
    expect((await viewer.clientApps()).length).toBeGreaterThan(0);
    const denied = await apiError(viewer.createClientApp({ code: 'X_APP', name: 'X', platform: 'WEB' } as never));
    expect([denied.status, denied.code]).toEqual([403, 'FORBIDDEN']);
    const reviewer = await signIn('reviewer');
    expect((await apiError(reviewer.updateBranding({} as never))).code).toBe('FORBIDDEN');
  });

  it('lets reviewers (and owners) cancel verifications, not developers or viewers', async () => {
    const owner = client('NOQODI');
    const open = [...(await owner.sessions({ status: 'IN_PROGRESS', size: 50 })).items, ...(await owner.sessions({ status: 'CREATED', size: 50 })).items];
    expect(open.length).toBeGreaterThan(0);
    const dev = await signIn('developer');
    expect((await apiError(dev.cancelSession(open[0].publicId))).code).toBe('FORBIDDEN');
    const reviewer = await signIn('reviewer');
    expect((await reviewer.cancelSession(open[0].publicId)).status).toBe('CANCELLED');
  });

  it('keeps /users for owners', async () => {
    const dev = await signIn('developer');
    expect((await apiError(dev.users())).code).toBe('FORBIDDEN');
  });
});

describe('users', () => {
  it('lists users without passwords', async () => {
    const users = await client('NOQODI').users();
    expect(users.map((u) => u.username)).toEqual(expect.arrayContaining(['owner', 'developer', 'reviewer', 'viewer', 'newbie']));
    expect(users.every((u) => !('password' in u))).toBe(true);
    expect((await client('DEMO').users()).map((u) => u.username)).toEqual(['demo.owner']);
  });

  it('creates a user with a generated password, shown once, that must be changed', async () => {
    const c = client('NOQODI');
    const created = await c.createUser({ username: 'new.dev', displayName: 'New Dev', role: 'DEVELOPER' });
    expect(created.user).toMatchObject({ username: 'new.dev', role: 'DEVELOPER', mustChangePassword: true, status: 'ACTIVE' });
    expect(created.password).toMatch(/^[A-Za-z0-9]{16}$/);
    const res = await withToken(null).login('new.dev', created.password);
    expect(res.user.mustChangePassword).toBe(true);
    expect((await apiError(c.createUser({ username: 'NEW.DEV', role: 'VIEWER' }))).code).toBe('USERNAME_TAKEN');
    expect((await apiError(c.createUser({ username: 'weak', role: 'VIEWER', password: 'abc' }))).code).toBe('WEAK_PASSWORD');
    const typed = await c.createUser({ username: 'typed', role: 'VIEWER', password: 'Typed12345' });
    expect(typed.password).toBe('Typed12345');
  });

  it('protects the signed-in owner from locking themselves out', async () => {
    const c = client('DEMO');
    const [me] = await c.users();
    expect((await apiError(c.updateUser(me.id, { status: 'DISABLED' }))).code).toBe('SELF_LOCKOUT');
    expect((await apiError(c.updateUser(me.id, { role: 'VIEWER' }))).code).toBe('SELF_LOCKOUT');
    // With a second owner, the first one can be demoted by the second.
    await c.createUser({ username: 'second.owner', role: 'OWNER', password: 'Second1234' });
    const second = await signIn('second.owner', 'Second1234');
    await second.changePassword('Second1234', 'Second12345');
    expect((await second.updateUser(me.id, { role: 'VIEWER' })).role).toBe('VIEWER');
    expect((await apiError(c.users())).code).toBe('FORBIDDEN');
  });

  it('disables users (signing them out) and resets passwords', async () => {
    const c = client('NOQODI');
    const viewer = await signIn('viewer');
    const id = (await c.users()).find((u) => u.username === 'viewer')!.id;
    await c.updateUser(id, { status: 'DISABLED' });
    expect((await apiError(viewer.info())).code).toBe('UNAUTHORIZED');
    expect((await apiError(withToken(null).login('viewer', DEMO_PASSWORD))).code).toBe('ACCOUNT_LOCKED');
    await c.updateUser(id, { status: 'ACTIVE' });
    const { password } = await c.resetUserPassword(id);
    expect(password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect((await apiError(withToken(null).login('viewer', DEMO_PASSWORD))).code).toBe('INVALID_LOGIN');
    expect((await withToken(null).login('viewer', password)).user.mustChangePassword).toBe(true);
    expect((await c.resetUserPassword(id, 'Chosen12345')).password).toBe('Chosen12345');
    expect((await apiError(c.resetUserPassword(id, 'short'))).code).toBe('WEAK_PASSWORD');
  });
});

describe('dashboard and verifications', () => {
  it('builds a dashboard whose daily series covers the window', async () => {
    const d = await client('NOQODI').dashboard(14);
    expect(d.daily).toHaveLength(14);
    expect(d.totals.sessions).toBeGreaterThan(0);
    const daySum = d.daily.reduce((s, x) => s + x.approved + x.review + x.rejected + x.other, 0);
    expect(daySum).toBe(d.totals.sessions);
    expect(d.approvalRate).not.toBeNull();
  });

  it('is empty for the brand-new DEMO tenant', async () => {
    const d = await client('DEMO').dashboard(7);
    expect(d.totals.sessions).toBe(0);
    expect(d.approvalRate).toBeNull();
  });

  it('filters and paginates sessions', async () => {
    const c = client('NOQODI');
    const page = await c.sessions({ page: 0, size: 5, decision: 'APPROVED' });
    expect(page.items).toHaveLength(5);
    expect(page.items.every((s) => s.decision === 'APPROVED')).toBe(true);
    expect(page.total).toBeGreaterThan(5);
    const one = page.items[0];
    const found = await c.sessions({ q: one.subjectRef ?? '' });
    expect(found.items.some((s) => s.publicId === one.publicId)).toBe(true);
    const bad = await apiError(c.sessions({ from: '08/10/2026' }));
    expect(bad.code).toBe('VALIDATION_ERROR');
  });

  it('cancels only open sessions', async () => {
    const c = client('NOQODI');
    const open = (await c.sessions({ status: 'IN_PROGRESS', size: 1 })).items[0] ?? (await c.sessions({ status: 'CREATED', size: 1 })).items[0];
    expect(open).toBeDefined();
    const cancelled = await c.cancelSession(open.publicId);
    expect(cancelled.status).toBe('CANCELLED');
    const again = await apiError(c.cancelSession(open.publicId));
    expect([again.status, again.code]).toEqual([409, 'SESSION_CLOSED']);
    const missing = await apiError(c.session('nope'));
    expect([missing.status, missing.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('seeds face registrations, one waiting for review as a duplicate identity', async () => {
    const c = client('NOQODI');
    const page = await c.sessions({ flowCode: 'FACE_ENROLLMENT', decision: 'REVIEW', size: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    const s = await c.session(page.items[0].publicId);
    expect(s).toMatchObject({ document: null, enrollFace: true, faceRegistered: false, decisionDetail: { reason: 'DUPLICATE_IDENTITY' } });
    expect(s.steps.find((x) => x.stepCode === 'DEDUP_SEARCH')).toMatchObject({ status: 'REVIEW', reasonCode: 'DUPLICATE_IDENTITY', checks: [{ checkCode: 'DEDUP_1N', outcome: 'REVIEW' }] });
    expect(page.items[0]).not.toHaveProperty('enrollFace');

    const approved = (await c.sessions({ flowCode: 'FACE_ENROLLMENT', decision: 'APPROVED', size: 1 })).items[0];
    expect(await c.session(approved.publicId)).toMatchObject({ enrollFace: true, faceRegistered: true });
    const check = (await c.sessions({ flowCode: 'LIVENESS_CHECK', decision: 'APPROVED', size: 1 })).items[0];
    expect(await c.session(check.publicId)).toMatchObject({ document: null, enrollFace: false, faceRegistered: false });
  });
});

describe('client apps and credentials', () => {
  it('validates new apps like the server', async () => {
    const c = client('DEMO');
    const badCode = await apiError(c.createClientApp({ code: 'bad code', name: 'X', channel: 'WEB' }));
    expect([badCode.status, badCode.code]).toEqual([400, 'VALIDATION_ERROR']);
    const badOrigin = await apiError(c.createClientApp({ code: 'SITE', name: 'Site', channel: 'WEB', allowedOrigins: ['http://example.com'] }));
    expect(badOrigin.code).toBe('VALIDATION_ERROR');
    const app = await c.createClientApp({ code: 'SITE', name: 'Site', channel: 'WEB', allowedOrigins: ['https://site.example.com/'] });
    expect(app.allowedOrigins).toEqual(['https://site.example.com']);
    const taken = await apiError(c.createClientApp({ code: 'SITE', name: 'Again', channel: 'MOBILE' }));
    expect([taken.status, taken.code]).toEqual([409, 'CODE_TAKEN']);
  });

  it('only narrows permissions to what the tenant has', async () => {
    const c = client('DEMO');
    const app = await c.createClientApp({ code: 'APP', name: 'App', channel: 'MOBILE' });
    expect(app.permissions.find((p) => p.featureCode === 'DOCUMENT_SCAN')?.allowed).toBe(false);
    const err = await apiError(c.updatePermissions(app.id, [{ featureCode: 'DOCUMENT_SCAN', allowed: true }]));
    expect(err.code).toBe('VALIDATION_ERROR');
    const updated = await c.updatePermissions(app.id, [{ featureCode: 'FACE_AUTHENTICATION', allowed: false }]);
    expect(updated.permissions.find((p) => p.featureCode === 'FACE_AUTHENTICATION')?.allowed).toBe(false);
    const caps = await c.appCapabilities(app.id);
    expect(caps.flows.map((f) => f.code)).toEqual(['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT']);
    expect(caps.flows[0].quota.perDay).toBe(100);
  });

  it('reports face registration in the capabilities', async () => {
    const c = client('DEMO');
    const app = await c.createClientApp({ code: 'FACES', name: 'Faces', channel: 'MOBILE' });
    let caps = await c.appCapabilities(app.id);
    const enrollment = caps.flows.find((f) => f.code === 'FACE_ENROLLMENT');
    expect(enrollment).toMatchObject({ documents: [], steps: ['LIVENESS', 'DEDUP_SEARCH'], settings: { livenessMode: 'ACTIVE', livenessChallengeRequired: true } });
    expect(caps.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')?.settings.faceEnrollmentAvailable).toBe(true);

    await c.updatePermissions(app.id, [{ featureCode: 'FACE_ENROLLMENT', allowed: false }]);
    caps = await c.appCapabilities(app.id);
    expect(caps.flows.some((f) => f.code === 'FACE_ENROLLMENT')).toBe(false);
    expect(caps.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')?.settings.faceEnrollmentAvailable).toBe(false);
  });

  it('switches duplicate search, and the capabilities follow', async () => {
    const c = client('DEMO');
    const app = await c.createClientApp({ code: 'DUPS', name: 'Dups', channel: 'MOBILE' });
    expect(await c.duplicateSearch()).toEqual({ available: true, enabled: true, flows: ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT'] });
    expect((await apiError(c.updateDuplicateSearch(undefined as never))).code).toBe('VALIDATION_ERROR');
    expect((await c.updateDuplicateSearch(false)).enabled).toBe(false);
    const caps = await c.appCapabilities(app.id);
    expect(caps.flows.find((f) => f.code === 'FACE_ENROLLMENT')?.steps).toEqual(['LIVENESS']);
    expect(caps.flows.find((f) => f.code === 'SELFIE_ID_VERIFICATION')?.steps).not.toContain('DEDUP_SEARCH');
    expect((await client('NOQODI').duplicateSearch()).enabled).toBe(true);
  });

  it('returns a secret once and revokes keys', async () => {
    const c = client('DEMO');
    const app = await c.createClientApp({ code: 'KEYS', name: 'Keys', channel: 'MOBILE' });
    const created = await c.createCredential(app.id);
    expect(created.secret).toMatch(/^cs_[0-9a-f]{48}$/);
    const list = await c.credentials(app.id);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.secret);
    const past = await apiError(c.createCredential(app.id, '2000-01-01T00:00:00Z'));
    expect(past.code).toBe('VALIDATION_ERROR');
    expect((await c.revokeCredential(created.credential.id)).status).toBe('REVOKED');
    expect((await c.clientApps()).find((a) => a.id === app.id)?.credentialsCount).toBe(1);
  });

  it('issues the mock playground token only for active apps', async () => {
    const c = client('NOQODI');
    const t = await c.playgroundToken({ clientAppCode: 'WEB_PORTAL', subjectRef: 'playground-abc' });
    expect(t).toMatchObject({ sdkToken: 'mock', tenantCode: 'NOQODI', clientAppCode: 'WEB_PORTAL', subjectRef: 'playground-abc' });
    const disabled = await apiError(c.playgroundToken({ clientAppCode: 'MERCHANT_ONBOARDING' }));
    expect(disabled.status).toBe(409);
    const missing = await apiError(c.playgroundToken({ clientAppCode: 'NOPE' }));
    expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('webhooks', () => {
  it('creates, tests, retries and deletes', async () => {
    const c = client('DEMO');
    const bad = await apiError(c.createWebhook({ url: 'not a url', events: ['SESSION_COMPLETED'] }));
    expect(bad.code).toBe('VALIDATION_ERROR');
    const none = await apiError(c.createWebhook({ url: 'https://ok.example.com/h', events: [] }));
    expect(none.code).toBe('VALIDATION_ERROR');

    const { webhook, secret } = await c.createWebhook({ url: 'https://fail.example.com/h', events: ['SESSION_COMPLETED'] });
    expect(secret).toMatch(/^whsec_/);
    const failed = await c.testWebhook(webhook.id);
    expect(failed.status).toBe('FAILED');
    await c.updateWebhook(webhook.id, { url: 'https://ok.example.com/h' });
    const retried = await c.retryDelivery(failed.id);
    expect(retried.status).toBe('DELIVERED');
    const page = await c.deliveries(webhook.id, { page: 0, size: 10 });
    expect(page.total).toBe(1);
    const rotated = await c.rotateWebhookSecret(webhook.id);
    expect(rotated.secret).not.toBe(secret);
    await c.deleteWebhook(webhook.id);
    expect(await c.webhooks()).toHaveLength(0);
  });
});

describe('liveness settings per flow', () => {
  it('lists the liveness flows with the starting policy and defaults', async () => {
    const flows = await client('DEMO').flows();
    // LIVENESS_CHECK is not in the DEMO plan, so it has no settings to show.
    expect(flows.map((f) => f.flowCode)).toEqual(['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'FACE_ENROLLMENT']);
    expect(flows[0]).toMatchObject({
      mode: 'ACTIVE', actions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'], challengeCount: 2, customized: false, updatedAt: null,
      policy: { allowedModes: ['ACTIVE'], allowedActions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'], minActions: 2, maxActions: 4, requireSpareAction: true },
    });
    // face authentication starts PASSIVE, with ACTIVE available
    expect(flows[1]).toMatchObject({ mode: 'PASSIVE', customized: false, policy: { allowedModes: ['ACTIVE', 'PASSIVE'] } });
    expect(flows[2]).toMatchObject({ mode: 'ACTIVE', policy: { allowedModes: ['ACTIVE'] } });
  });

  it('validates and saves settings like the server', async () => {
    const c = client('DEMO');
    const passive = await apiError(c.updateFlowLiveness('SELFIE_ID_VERIFICATION', { mode: 'PASSIVE', actions: ['BLINK'], challengeCount: 2 }));
    expect([passive.status, passive.code]).toEqual([400, 'MODE_NOT_ALLOWED']);
    const dup = await apiError(c.updateFlowLiveness('FACE_AUTHENTICATION', { mode: 'ACTIVE', actions: ['SMILE', 'SMILE', 'MOVE_CLOSER'], challengeCount: 2 }));
    expect(dup.code).toBe('DUPLICATE_ACTION');
    const spare = await apiError(c.updateFlowLiveness('FACE_AUTHENTICATION', { mode: 'ACTIVE', actions: ['BLINK', 'TURN_LEFT', 'TURN_RIGHT'], challengeCount: 3 }));
    expect(spare.code).toBe('SPARE_ACTION_REQUIRED');
    const ok = await c.updateFlowLiveness('FACE_AUTHENTICATION', { mode: 'ACTIVE', actions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK'], challengeCount: 2 });
    expect(ok).toMatchObject({ customized: true, challengeCount: 2 });
    expect(ok.updatedAt).not.toBeNull();
    expect((await c.auditEvents({ action: 'LIVENESS_SETTINGS_UPDATED' })).total).toBe(1);
  });

  it('refuses PASSIVE for face registration but allows it for the liveness check where the policy does', async () => {
    const c = client('NOQODI');
    const flows = await c.flows();
    expect(flows.map((f) => f.flowCode)).toEqual(['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'FACE_ENROLLMENT', 'LIVENESS_CHECK']);
    const check = flows.find((f) => f.flowCode === 'LIVENESS_CHECK');
    expect(check?.policy.allowedModes).toContain('PASSIVE');
    expect((await c.updateFlowLiveness('LIVENESS_CHECK', { mode: 'PASSIVE', actions: check?.actions ?? [], challengeCount: check?.challengeCount ?? 2 })).mode).toBe('PASSIVE');
    const passive = await apiError(c.updateFlowLiveness('FACE_ENROLLMENT', { mode: 'PASSIVE', actions: ['BLINK'], challengeCount: 2 }));
    expect([passive.status, passive.code]).toEqual([400, 'MODE_NOT_ALLOWED']);
    const ok = await c.updateFlowLiveness('FACE_ENROLLMENT', { mode: 'ACTIVE', actions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK'], challengeCount: 2 });
    expect(ok).toMatchObject({ flowCode: 'FACE_ENROLLMENT', mode: 'ACTIVE', customized: true });
  });

  it('allows PASSIVE where the policy does, and reports it in the capabilities', async () => {
    const c = client('NOQODI');
    const face = (await c.flows()).find((f) => f.flowCode === 'FACE_AUTHENTICATION');
    expect(face?.policy.allowedModes).toContain('PASSIVE');
    await c.updateFlowLiveness('FACE_AUTHENTICATION', { mode: 'PASSIVE', actions: face?.actions ?? [], challengeCount: face?.challengeCount ?? 2 });
    const app = (await c.clientApps()).find((a) => a.code === 'MOBILE_APP');
    const caps = await c.appCapabilities(app?.id ?? 0);
    expect(caps.flows.find((f) => f.code === 'FACE_AUTHENTICATION')?.settings).toMatchObject({ livenessMode: 'PASSIVE', livenessChallengeRequired: false });
  });
});

describe('branding, audit and reference data', () => {
  it('saves, validates and resets branding', async () => {
    const c = client('DEMO');
    const defaults = await c.branding();
    expect(defaults.updatedAt).toBeNull();
    const { tenant: _t, updatedAt: _u, ...update } = defaults;
    const bad = await apiError(c.updateBranding({ ...update, primaryColor: 'blue' }));
    expect(bad.code).toBe('VALIDATION_ERROR');
    const radius = await apiError(c.updateBranding({ ...update, borderRadius: 30 }));
    expect(radius.code).toBe('VALIDATION_ERROR');
    const saved = await c.updateBranding({ ...update, primaryColor: '#0b7a5c', texts: { ar: { welcomeTitle: 'مرحباً' } } });
    expect(saved.primaryColor).toBe('#0b7a5c');
    expect(saved.texts.ar?.welcomeTitle).toBe('مرحباً');
    expect(saved.updatedAt).not.toBeNull();
    await c.resetBranding();
    expect((await c.branding()).primaryColor).toBe(defaults.primaryColor);
  });

  it('records tenant actions in the audit log, newest first', async () => {
    const c = client('DEMO');
    await c.createClientApp({ code: 'AUDITED', name: 'Audited', channel: 'MOBILE' });
    const page = await c.auditEvents({ actorType: 'TENANT_USER' });
    expect(page.items[0]).toMatchObject({ actorType: 'TENANT_USER', actor: 'demo.owner', action: 'CLIENT_APP_CREATED' });
  });

  it('serves reason codes with Arabic messages', async () => {
    const codes = await client('NOQODI').reasonCodes();
    expect(codes.find((r) => r.code === 'TOO_DARK')?.messageAr).toBeTruthy();
    expect(codes.find((r) => r.code === 'FACE_ALREADY_ENROLLED')).toMatchObject({ category: 'MATCH', messageEn: 'A face is already registered for this person.' });
  });
});

describe('document scan review', () => {
  it('holds scans that fail a check and lets the tenant correct and approve them', async () => {
    const c = client('NOQODI');
    const page = await c.scans({ status: 'NEEDS_REVIEW', size: 200 });
    expect(page.items.length).toBeGreaterThan(0);
    const scan = await c.scan(page.items[0].id);
    expect(scan.reviewReasons?.[0]?.code).toBe('FIELD_INVALID');
    const field = scan.fields.find((f) => f.validationStatus === 'INVALID');
    expect(field).toBeDefined();

    const notCorrected = await apiError(c.reviewScan(scan.id, { decision: 'APPROVE' }));
    expect([notCorrected.status, notCorrected.code]).toEqual([400, 'VALIDATION_ERROR']);
    const stillWrong = await apiError(c.reviewScan(scan.id, { decision: 'APPROVE', corrections: { [field!.fieldCode]: '784-1990-1234567-1' } }));
    expect(stillWrong.status).toBe(400);

    const approved = await c.reviewScan(scan.id, { decision: 'APPROVE', corrections: { [field!.fieldCode]: '784-1990-1234567-6' }, note: 'checked' });
    expect(approved.status).toBe('COMPLETED');
    const corrected = approved.fields.find((f) => f.fieldCode === field!.fieldCode)!;
    expect(corrected.value).toBe('784-1990-1234567-6');
    expect(corrected.ocrValue).toBe(field!.value);
    expect(approved.reviewNote).toBe('checked');

    const again = await apiError(c.reviewScan(scan.id, { decision: 'REJECT' }));
    expect([again.status, again.code]).toEqual([409, 'SCAN_NOT_IN_REVIEW']);
  });

  it('saves, validates and resets the review settings', async () => {
    const c = client('NOQODI');
    const initial = await c.documentOcrSettings();
    expect(initial.settings.reviewMode).toBe('AUTO');
    expect(initial.customized).toBe(false);

    const bad = await apiError(c.updateDocumentOcrSettings({ autoAcceptConfidence: 2 }));
    expect(bad.status).toBe(400);

    const saved = await c.updateDocumentOcrSettings({ reviewMode: 'ALWAYS', requiredFields: ['emiratesIdNumber', 'issueDate'] });
    expect(saved.settings.reviewMode).toBe('ALWAYS');
    expect(saved.settings.requiredFields).toEqual(['emiratesIdNumber', 'issueDate']);
    expect(saved.customized).toBe(true);

    const reset = await c.resetDocumentOcrSettings();
    expect(reset.customized).toBe(false);
    expect(reset.settings.reviewMode).toBe('AUTO');
  });
});

describe('documents and images', () => {
  it('lists, filters and shows documents with their images', async () => {
    const c = client('NOQODI');
    const all = await c.documents({ size: 200 });
    expect(all.total).toBeGreaterThan(20);
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const expiring = await c.documents({ expiringBefore: soon, size: 200 });
    expect(expiring.items.length).toBeGreaterThan(0);
    expect(expiring.items.every((d) => !!d.expiryDate && d.expiryDate < soon)).toBe(true);
    expect((await apiError(c.documents({ expiringBefore: '01/02/2026' }))).code).toBe('VALIDATION_ERROR');
    const one = all.items[0];
    expect((await c.documents({ q: one.documentNumber ?? '' })).items.some((d) => d.id === one.id)).toBe(true);

    const detail = await c.document(one.id);
    expect(detail.fields.length).toBeGreaterThan(0);
    expect(detail.media.length).toBeGreaterThan(0);
    const img = await c.media(detail.media[0].id);
    expect(img.type).toBe('image/svg+xml');
    expect(await img.text()).toContain('<svg');
    const res = await transport(`${BASE}/v2/tenant/media/${detail.media[0].id}`, { method: 'GET', headers: { Authorization: `Bearer ${tokens.NOQODI}` } });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    // Another tenant cannot read it.
    expect((await apiError(client('DEMO').media(detail.media[0].id))).status).toBe(404);
  });

  it('gives scans their images and links completed ones to the document', async () => {
    const c = client('NOQODI');
    const scans = (await c.scans({ status: 'COMPLETED', docTypeCode: 'EMIRATES_ID', size: 50 })).items;
    const details = await Promise.all(scans.slice(0, 10).map((s) => c.scan(s.id)));
    expect(details.every((d) => (d.media ?? []).length === 2)).toBe(true);
    const linked = details.find((d) => d.documentId);
    expect(linked).toBeDefined();
    expect((await c.document(linked?.documentId as number)).scans.some((s) => s.id === linked?.id)).toBe(true);
    expect(scans[0]).not.toHaveProperty('media');
  });
});

describe('people', () => {
  it('searches people and shows documents, face templates and verifications', async () => {
    const c = client('NOQODI');
    const page = await c.parties({ size: 100 });
    expect(page.total).toBeGreaterThan(20);
    const p = page.items[0];
    expect((await c.parties({ q: p.externalRef ?? '' })).items.map((x) => x.id)).toContain(p.id);
    const detail = await c.party(p.id);
    expect(detail.subjectRef).toBe(p.externalRef);
    expect(detail.documents.length).toBe(1);
    expect(detail.sessions.length).toBeGreaterThan(0);
    expect(detail).not.toHaveProperty('externalRef');
  });

  it('lets only owners revoke faces, export and erase', async () => {
    const owner = client('NOQODI');
    const dev = await signIn('developer');
    const withFace = (await owner.parties({ size: 100 })).items.find((x) => x.sessionsCount > 0);
    const person = await owner.party(withFace?.id as number);
    const tpl = person.faceTemplates[0];
    if (tpl) {
      expect((await apiError(dev.revokeFaceTemplate(person.id, tpl.id))).code).toBe('FORBIDDEN');
      await owner.revokeFaceTemplate(person.id, tpl.id);
      expect((await owner.party(person.id)).faceTemplates.find((x) => x.id === tpl.id)?.status).toBe('REVOKED');
    }
    expect((await apiError(dev.exportParty(person.id))).status).toBe(403);
    const zipBlob = await owner.exportParty(person.id);
    const names = zipEntries(new Uint8Array(await zipBlob.arrayBuffer()));
    expect(names[0]).toBe('person.json');
    expect(names.some((n) => n.startsWith(`documents/${person.documents[0].id}/`))).toBe(true);

    expect((await apiError(dev.eraseParty(person.id))).code).toBe('FORBIDDEN');
    await owner.eraseParty(person.id);
    expect((await apiError(owner.party(person.id))).status).toBe(404);
    expect((await apiError(owner.document(person.documents[0].id))).status).toBe(404);
    expect((await apiError(owner.session(person.sessions[0].publicId))).status).toBe(404);
    expect((await owner.auditEvents({ action: 'PARTY_ERASED' })).items[0]).toMatchObject({ entityId: person.publicId, actor: 'owner' });
  });
});

describe('reviews', () => {
  it('counts what waits and lists cases oldest first', async () => {
    const c = client('NOQODI');
    const summary = await c.reviewSummary();
    expect(summary.owner).toBe('TENANT');
    expect(summary.scansToReview).toBeGreaterThan(0);
    expect(summary.verificationsToReview).toBeGreaterThan(0);
    const open = await c.reviewCases({ status: 'OPEN', size: 100 });
    const inReview = await c.reviewCases({ status: 'IN_REVIEW', size: 100 });
    expect(open.total + inReview.total).toBe(summary.verificationsToReview);
    const dates = open.items.map((x) => x.createdAt);
    expect([...dates].sort()).toEqual(dates);
    expect(open.items.every((x) => !/similarity/.test(x.reason ?? ''))).toBe(true);
  });

  it('lets a reviewer see the evidence, assign, comment and decide with a note', async () => {
    const reviewer = await signIn('reviewer');
    const viewer = await signIn('viewer');
    const kase = (await reviewer.reviewCases({ status: 'OPEN', size: 1 })).items[0];
    const detail = await reviewer.reviewCase(kase.id);
    expect(detail.canDecide).toBe(true);
    expect(detail.evidence.some((e) => e.role === 'SELFIE_NORMAL')).toBe(true);
    expect(detail.session.publicId).toBe(kase.sessionPublicId);
    const selfie = detail.evidence.find((e) => e.role === 'SELFIE_NORMAL')?.mediaId as number;
    expect((await reviewer.reviewCaseMedia(kase.id, selfie)).type).toBe('image/svg+xml');
    // Selfies are never served as document images, and viewers get no evidence.
    expect((await apiError(reviewer.media(selfie))).status).toBe(404);
    expect((await apiError(viewer.reviewCaseMedia(kase.id, selfie))).code).toBe('FORBIDDEN');
    expect((await apiError(viewer.assignReviewCase(kase.id))).code).toBe('FORBIDDEN');

    const assigned = await reviewer.assignReviewCase(kase.id);
    expect(assigned).toMatchObject({ status: 'IN_REVIEW', assignedTo: 'reviewer' });
    expect((await reviewer.reviewCases({ mine: true })).items.map((x) => x.id)).toContain(kase.id);
    expect((await apiError(reviewer.assignReviewCase(kase.id, 'someone.else'))).code).toBe('VALIDATION_ERROR');
    const commented = await reviewer.commentReviewCase(kase.id, 'Asked for a clearer photo');
    expect(commented.actions.at(-1)).toMatchObject({ action: 'COMMENTED', actor: 'reviewer', note: 'Asked for a clearer photo' });
    expect((await apiError(reviewer.decideReviewCase(kase.id, { decision: 'APPROVED', note: ' ' }))).code).toBe('VALIDATION_ERROR');
    const decided = await reviewer.decideReviewCase(kase.id, { decision: 'APPROVED', note: 'Same person' });
    expect(decided).toMatchObject({ status: 'APPROVED', canDecide: false, evidence: [] });
    expect(await reviewer.session(kase.sessionPublicId)).toMatchObject({ decision: 'APPROVED', status: 'COMPLETED', decisionDetail: { decidedBy: 'REVIEWER' } });
    expect((await apiError(reviewer.decideReviewCase(kase.id, { decision: 'REJECTED', note: 'x' }))).code).toBe('REVIEW_CLOSED');
    expect((await apiError(reviewer.reviewCaseMedia(kase.id, selfie))).status).toBe(404);
  });

  it('shows camtech operators as "camtech" without their notes', async () => {
    const c = client('NOQODI');
    const decided = [...(await c.reviewCases({ status: 'APPROVED', size: 100 })).items, ...(await c.reviewCases({ status: 'REJECTED', size: 100 })).items];
    const byCamtech = decided.find((x) => x.assignedTo === 'camtech');
    expect(byCamtech).toBeDefined();
    const detail = await c.reviewCase(byCamtech?.id as number);
    expect(detail.actions.filter((a) => a.actor === 'camtech').every((a) => a.note === null)).toBe(true);
    expect(detail.actions.some((a) => a.actor === 'camtech.ops')).toBe(false);
  });

  it('hands reviews to camtech: read-only for the tenant', async () => {
    const owner = client('NOQODI');
    const dev = await signIn('developer');
    expect((await apiError(dev.updateReviewSettings('CAMTECH'))).code).toBe('FORBIDDEN');
    expect((await apiError(owner.updateReviewSettings('NOBODY' as never))).code).toBe('VALIDATION_ERROR');
    expect(await owner.updateReviewSettings('CAMTECH')).toEqual({ owner: 'CAMTECH', owners: ['TENANT', 'CAMTECH'] });
    const kase = (await owner.reviewCases({ status: 'OPEN', size: 1 })).items[0];
    const detail = await owner.reviewCase(kase.id);
    expect(detail).toMatchObject({ canDecide: false, evidence: [] });
    const err = await apiError(owner.decideReviewCase(kase.id, { decision: 'APPROVED', note: 'ok' }));
    expect([err.status, err.code]).toEqual([409, 'REVIEW_OWNED_BY_CAMTECH']);
    expect((await owner.reviewSummary()).owner).toBe('CAMTECH');
    expect((await owner.dashboard(7)).attention.verificationsToReview).toBe(0);
  });

  it('strips scores from reasons', () => {
    expect(withoutScore('Borderline face match (similarity 0.41)')).toBe('Borderline face match');
    expect(withoutScore(null)).toBeNull();
  });
});

describe('settings and attention', () => {
  it('validates the document expiry warning and lets builders change it', async () => {
    const owner = client('NOQODI');
    const viewer = await signIn('viewer');
    const dev = await signIn('developer');
    expect(await owner.documentSettings()).toEqual({ expiryWarningDays: 30, defaultExpiryWarningDays: 30, min: 1, max: 365 });
    expect((await apiError(viewer.updateDocumentSettings(45))).code).toBe('FORBIDDEN');
    expect((await apiError(dev.updateDocumentSettings(0))).code).toBe('VALIDATION_ERROR');
    expect((await apiError(dev.updateDocumentSettings(366))).code).toBe('VALIDATION_ERROR');
    expect((await dev.updateDocumentSettings(90)).expiryWarningDays).toBe(90);
    expect((await owner.dashboard(14)).attention.expiryWarningDays).toBe(90);
  });

  it('lists retention read-only', async () => {
    const list = await (await signIn('viewer')).retentionPolicies();
    expect(list.map((r) => r.dataCategory)).toEqual(['FAILED_ATTEMPT_MEDIA', 'VERIFIED_MEDIA', 'SCAN_ONLY_MEDIA', 'AUDIT_EVENTS']);
  });

  it('reports what needs attention on the dashboard', async () => {
    const a = (await client('NOQODI').dashboard(14)).attention;
    expect(a.scansToReview).toBeGreaterThan(0);
    expect(a.failingWebhooks).toHaveLength(1);
    expect(a.failingWebhooks[0].consecutiveFailures).toBeGreaterThanOrEqual(5);
    expect(a.credentialsExpiring.map((k) => k.clientAppCode)).toEqual(['MOBILE_APP']);
    expect(a.documentsExpiring).toBeGreaterThan(0);
    const demo = (await client('DEMO').dashboard(7)).attention;
    expect(demo).toEqual({ scansToReview: 0, verificationsToReview: 0, failingWebhooks: [], credentialsExpiring: [], documentsExpiring: 0, expiryWarningDays: 30 });
  });

  it('accepts the new webhook events and tracks failing endpoints', async () => {
    const c = client('DEMO');
    const { webhook } = await c.createWebhook({ url: 'https://unreachable.example.com/h', events: ['SCAN_REVIEW_REQUIRED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED', 'SCAN_REVIEW_DECIDED'] });
    expect(webhook).toMatchObject({ consecutiveFailures: 0, failing: false });
    for (let i = 0; i < 5; i++) await c.testWebhook(webhook.id);
    expect((await c.webhooks())[0]).toMatchObject({ consecutiveFailures: 5, failing: true });
    await c.updateWebhook(webhook.id, { url: 'https://ok.example.com/h' });
    await c.testWebhook(webhook.id);
    expect((await c.webhooks())[0]).toMatchObject({ consecutiveFailures: 0, failing: false });
    expect((await apiError(c.createWebhook({ url: 'https://ok.example.com/h', events: ['NOPE' as never] }))).code).toBe('VALIDATION_ERROR');
  });
});
