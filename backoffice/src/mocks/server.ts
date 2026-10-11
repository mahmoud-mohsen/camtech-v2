// In-memory mock of the admin API (docs/admin-api.md). Used when VITE_USE_MOCKS=true.
// It is a fetch-compatible function, so the real API client code path is exercised end to end.
import type {
  AdminFlowLiveness, AdminUser, Capabilities, ChallengeAction, ClientApp, ConfigKey, ConfigParam, Credential, Dashboard, DocumentSummary, Entitlement,
  LivenessMode, LivenessPolicy, LivenessSettings, Page, PartyDetail,
  ReviewCaseDetail, ReviewCaseSummary, Role, ScanSummary, SessionDetail, SessionSummary, TenantSummary, TenantUserRole, TenantUserView, WebhookDelivery, Webhook,
} from '../api/types';
import { CHALLENGE_ACTIONS, defaultSettings, LIVENESS_MODES, settingsConflict, startingPolicy, validatePolicy } from '../features/config/livenessLogic';
import { generatePassword, isStrongPassword } from '../lib/password';
import { CONFIG_KEYS, DOCUMENT_TYPES, FLOW_DOCS, ISSUERS } from './catalog';
import { renderMedia } from './images';
import { buildDb, type MockDb, type MockReview, type MockSession } from './seed';

const db: MockDb = buildDb();
const revokedTokens = new Set<string>();

// ---------- plumbing ----------
type Body = Record<string, unknown>;
interface Ctx {
  method: string;
  params: string[];
  query: URLSearchParams;
  body: Body;
  rawBody: unknown;
  user: AdminUser | null;
  token: string | null;
}
type Handler = (ctx: Ctx) => Response | Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  role: Role | 'PUBLIC' | 'ANY';
  handler: Handler;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};
const nowIso = () => new Date().toISOString();
const randHex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const ROLE_RANK: Record<Role, number> = { VIEWER: 1, REVIEWER: 2, ADMIN: 3 };

const routes: Route[] = [];
function on(method: string, path: string, role: Route['role'], handler: Handler) {
  const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
  routes.push({ method, pattern, role, handler });
}

function paginate<T>(items: T[], q: URLSearchParams): Page<T> {
  const page = Math.max(0, Number(q.get('page') ?? 0) || 0);
  const size = Math.min(200, Math.max(1, Number(q.get('size') ?? 20) || 20));
  return { items: items.slice(page * size, page * size + size), page, size, total: items.length };
}

function audit(ctx: Ctx, action: string, entity: string | null, entityId: string | number | null, details: Record<string, unknown> | null) {
  db.audit.push({
    id: db.seq.audit++, actorType: 'ADMIN', actor: ctx.user?.username ?? 'unknown', action, entity,
    entityId: entityId === null ? null : String(entityId), ipAddress: '127.0.0.1', details, at: nowIso(),
  });
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : v === null || v === undefined ? null : String(v));
const reqStr = (b: Body, k: string): string => {
  const v = b[k];
  if (typeof v !== 'string' || !v.trim()) fail(422, 'VALIDATION_ERROR', `${k} is required`);
  return (v as string).trim();
};

// ---------- view builders ----------
function sessionSummary(s: MockSession): SessionSummary {
  return {
    publicId: s.publicId, flowCode: s.flowCode, status: s.status, decision: s.decision?.decision ?? null, channel: s.channel,
    clientAppCode: s.clientAppCode, partyId: s.partyId, partyName: s.partyName, subjectRef: s.subjectRef,
    documentType: s.documentType, documentNumber: s.documentNumber, finalSimilarity: s.finalSimilarity,
    livenessAttempts: s.livenessAttempts, documentAttempts: s.documentAttempts, createdAt: s.createdAt,
    expiresAt: s.expiresAt, completedAt: s.completedAt,
  };
}
function docSummary(d: (typeof db.documents)[number]): DocumentSummary {
  const { fields: _f, media: _m, scans: _s, ...rest } = d;
  return rest;
}
function reviewSummary(r: MockReview): ReviewCaseSummary {
  const { actions: _a, ...rest } = r;
  return rest;
}
function sessionDetail(s: MockSession): SessionDetail {
  const doc = s.documentId ? db.documents.find((d) => d.id === s.documentId) : undefined;
  const review = db.reviews.find((r) => r.sessionPublicId === s.publicId);
  const { documentId: _d, ...rest } = s;
  return { ...rest, document: doc ? docSummary(doc) : null, reviewCase: review ? reviewSummary(review) : null };
}
function reviewDetail(r: MockReview): ReviewCaseDetail {
  const s = db.sessions.find((x) => x.publicId === r.sessionPublicId);
  if (!s) fail(404, 'NOT_FOUND', 'Session not found');
  return { ...reviewSummary(r), session: sessionDetail(s!), actions: [...r.actions] };
}
function scanSummary(s: (typeof db.scans)[number]): ScanSummary {
  const { fields: _f, media: _m, rawText: _r, ...rest } = s;
  return rest;
}

function findSession(id: string): MockSession {
  const s = db.sessions.find((x) => x.publicId === id);
  if (!s) fail(404, 'NOT_FOUND', 'Session not found');
  return s!;
}
function findReview(id: string): MockReview {
  const r = db.reviews.find((x) => x.id === Number(id));
  if (!r) fail(404, 'NOT_FOUND', 'Review case not found');
  return r!;
}

/** Receivers on example.test hosts are "down" in mock mode: their deliveries fail. */
const receiverDown = (w: Webhook) => w.url.includes('example.test');

/** consecutiveFailures / failing from the newest 5 deliveries (as the backend does). */
function refreshWebhookHealth(w: Webhook): Webhook {
  const recent = db.deliveries.filter((d) => d.webhookId === w.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id).slice(0, 5);
  const i = recent.findIndex((d) => d.status !== 'FAILED' && d.status !== 'RETRYING');
  w.consecutiveFailures = i === -1 ? recent.length : i;
  w.failing = w.consecutiveFailures >= 5;
  return w;
}

/** Sends an event to every active webhook subscribed to it. */
function deliverEvent(eventType: string) {
  const eventId = db.seq.event++;
  const createdAt = nowIso();
  for (const wh of db.webhooks) {
    if (wh.status !== 'ACTIVE' || !wh.events.includes(eventType)) continue;
    const ok = !receiverDown(wh);
    db.deliveries.push({
      id: db.seq.delivery++, webhookId: wh.id, eventType, eventId, attempt: 1, httpStatus: ok ? 200 : 502, status: ok ? 'DELIVERED' : 'RETRYING',
      error: ok ? null : 'HTTP 502 from receiver', nextRetryAt: ok ? null : new Date(Date.now() + 30_000).toISOString(), createdAt,
    });
    wh.lastDeliveryAt = createdAt;
    wh.lastStatus = ok ? 'DELIVERED' : 'RETRYING';
    refreshWebhookHealth(wh);
  }
}

function addSessionEvent(s: MockSession, eventType: string) {
  s.events.push({ eventType, status: 'DELIVERED', createdAt: nowIso() });
  deliverEvent(eventType);
}

// ---------- config resolution (global < flow < channel < client app) ----------
function scopeRank(p: ConfigParam): number {
  if (p.clientAppCode) return 3;
  if (p.channel) return 2;
  if (p.flowCode) return 1;
  return 0;
}
function resolveParam(key: string, ctx: { flowCode?: string; channel?: string; clientAppCode?: string }): string {
  const candidates = db.configParams.filter(
    (p) => p.paramKey === key &&
      (!p.flowCode || p.flowCode === ctx.flowCode) &&
      (!p.channel || p.channel === ctx.channel) &&
      (!p.clientAppCode || p.clientAppCode === ctx.clientAppCode),
  );
  candidates.sort((a, b) => scopeRank(b) - scopeRank(a));
  return candidates[0]?.paramValue ?? CONFIG_KEYS.find((k) => k.key === key)?.defaultValue ?? '';
}

function validateValue(key: ConfigKey, value: unknown): string {
  const v = str(value)?.trim() ?? '';
  if (!v) fail(422, 'VALIDATION_ERROR', 'A value is required');
  if (key.type === 'NUMBER' || key.type === 'INTEGER') {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(422, 'VALIDATION_ERROR', `${key.key} must be a number`);
    if (key.type === 'INTEGER' && !Number.isInteger(n)) fail(422, 'VALIDATION_ERROR', `${key.key} must be a whole number`);
    if (key.min !== null && n < key.min) fail(422, 'VALIDATION_ERROR', `${key.key} must be at least ${key.min}`);
    if (key.max !== null && n > key.max) fail(422, 'VALIDATION_ERROR', `${key.key} must be at most ${key.max}`);
  }
  if (key.type === 'BOOLEAN' && v !== 'true' && v !== 'false') fail(422, 'VALIDATION_ERROR', `${key.key} must be true or false`);
  return v;
}

// ---------- auth ----------
on('POST', '/v2/admin/auth/login', 'PUBLIC', ({ body }) => {
  const username = str(body.username)?.trim() ?? '';
  const password = str(body.password) ?? '';
  const u = db.users.find((x) => x.username === username);
  if (!u || db.passwords.get(u.id) !== password) {
    db.audit.push({ id: db.seq.audit++, actorType: 'ADMIN', actor: username || 'unknown', action: 'LOGIN_FAILED', entity: 'ADMIN_USER', entityId: null, ipAddress: '127.0.0.1', details: { reason: 'BAD_CREDENTIALS' }, at: nowIso() });
    fail(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
  }
  if (u!.status !== 'ACTIVE') fail(401, 'ACCOUNT_DISABLED', 'This account is disabled');
  u!.lastLoginAt = nowIso();
  const token = `mock.${u!.id}.${randHex(24)}`;
  db.audit.push({ id: db.seq.audit++, actorType: 'ADMIN', actor: u!.username, action: 'LOGIN', entity: 'ADMIN_USER', entityId: String(u!.id), ipAddress: '127.0.0.1', details: null, at: nowIso() });
  return json({ token, expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(), user: u });
});
on('POST', '/v2/admin/auth/logout', 'ANY', (ctx) => {
  if (ctx.token) revokedTokens.add(ctx.token);
  audit(ctx, 'LOGOUT', 'ADMIN_USER', ctx.user!.id, null);
  return noContent();
});
on('GET', '/v2/admin/auth/me', 'ANY', ({ user }) => json(user));
on('POST', '/v2/admin/auth/change-password', 'ANY', (ctx) => {
  const u = ctx.user!;
  if (db.passwords.get(u.id) !== str(ctx.body.currentPassword)) fail(400, 'INVALID_PASSWORD', 'The current password is wrong');
  const np = str(ctx.body.newPassword) ?? '';
  if (np.length < 10 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) fail(400, 'WEAK_PASSWORD', 'Use at least 10 characters with letters and numbers');
  if (np === str(ctx.body.currentPassword)) fail(422, 'WEAK_PASSWORD', 'The new password must be different from the current one');
  db.passwords.set(u.id, np);
  u.mustChangePassword = false;
  audit(ctx, 'PASSWORD_CHANGED', 'ADMIN_USER', u.id, null);
  return noContent();
});

// ---------- dashboard ----------
on('GET', '/v2/admin/dashboard', 'VIEWER', ({ query }) => {
  const days = Math.min(90, Math.max(1, Number(query.get('days') ?? 14) || 14));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const inWindow = db.sessions.filter((s) => Date.parse(s.createdAt) >= start.getTime());
  const dec = (s: MockSession) => s.decision?.decision ?? null;
  const totals = {
    sessions: inWindow.length,
    approved: inWindow.filter((s) => dec(s) === 'APPROVED').length,
    review: inWindow.filter((s) => dec(s) === 'REVIEW').length,
    rejected: inWindow.filter((s) => dec(s) === 'REJECTED').length,
    inProgress: inWindow.filter((s) => s.status === 'CREATED' || s.status === 'IN_PROGRESS').length,
    expired: inWindow.filter((s) => s.status === 'EXPIRED').length,
    failed: inWindow.filter((s) => s.status === 'FAILED').length,
  };
  const completed = totals.approved + totals.review + totals.rejected;
  const sims = inWindow.flatMap((s) => s.steps.filter((st) => st.stepCode === 'FACE_DOC_MATCH' && st.status === 'PASSED').map((st) => st.checks[0]?.score ?? null)).filter((x): x is number => x !== null);
  const daily: Dashboard['daily'] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = inWindow.filter((s) => {
      const c = new Date(s.createdAt);
      return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && c.getDate() === d.getDate();
    });
    daily.push({
      date: key,
      approved: day.filter((s) => dec(s) === 'APPROVED').length,
      review: day.filter((s) => dec(s) === 'REVIEW').length,
      rejected: day.filter((s) => dec(s) === 'REJECTED').length,
      other: day.filter((s) => dec(s) === null).length,
    });
  }
  const reasons = new Map<string, number>();
  inWindow.forEach((s) => s.steps.forEach((st) => {
    if (st.status === 'FAILED' && st.reasonCode) reasons.set(st.reasonCode, (reasons.get(st.reasonCode) ?? 0) + 1);
  }));
  const countBy = (key: (s: MockSession) => string) => {
    const m = new Map<string, number>();
    inWindow.forEach((s) => m.set(key(s), (m.get(key(s)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const result: Dashboard = {
    days, totals,
    approvalRate: completed ? totals.approved / completed : null,
    avgDocMatchSimilarity: sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null,
    pendingReviews: db.reviews.filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW').length,
    daily,
    topFailureReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, count]) => ({ code, count, message: db.reasonCodes.find((r) => r.code === code)?.messageEn ?? code })),
    byFlow: countBy((s) => s.flowCode).map(([flowCode, count]) => ({ flowCode, count })),
    byChannel: countBy((s) => s.channel).map(([channel, count]) => ({ channel, count })),
  };
  return json(result);
});

// ---------- sessions ----------
on('GET', '/v2/admin/sessions', 'VIEWER', ({ query }) => {
  const f = (k: string) => query.get(k) || null;
  const q = f('q')?.toLowerCase();
  const from = f('from');
  const to = f('to');
  const items = db.sessions
    .filter((s) => !f('status') || s.status === f('status'))
    .filter((s) => !f('decision') || s.decision?.decision === f('decision'))
    .filter((s) => !f('flowCode') || s.flowCode === f('flowCode'))
    .filter((s) => !f('channel') || s.channel === f('channel'))
    .filter((s) => !f('clientAppCode') || s.clientAppCode === f('clientAppCode'))
    .filter((s) => !from || s.createdAt.slice(0, 10) >= from)
    .filter((s) => !to || s.createdAt.slice(0, 10) <= to)
    .filter((s) => !q || [s.publicId, s.subjectRef, s.documentNumber, s.partyName].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(sessionSummary);
  return json(paginate(items, query));
});
on('GET', '/v2/admin/sessions/{id}', 'VIEWER', ({ params }) => json(sessionDetail(findSession(decodeURIComponent(params[0])))));
on('POST', '/v2/admin/sessions/{id}/cancel', 'REVIEWER', (ctx) => {
  const s = findSession(decodeURIComponent(ctx.params[0]));
  if (s.status !== 'CREATED' && s.status !== 'IN_PROGRESS') fail(409, 'INVALID_STATE', `A ${s.status.toLowerCase()} session can't be cancelled`);
  const prev = s.status;
  s.status = 'CANCELLED';
  s.completedAt = nowIso();
  s.steps.forEach((st) => {
    if (st.status === 'IN_PROGRESS' || st.status === 'PENDING') {
      st.status = 'SKIPPED';
      st.endedAt = nowIso();
      st.reasonCode = 'SESSION_CANCELLED';
      st.reasonMessage = 'The verification was cancelled.';
    }
  });
  audit(ctx, 'SESSION_CANCELLED', 'SESSION', s.publicId, { previousStatus: prev });
  return json(sessionDetail(s));
});

// ---------- media ----------
on('GET', '/v2/admin/media/{id}', 'VIEWER', ({ params }) => {
  const m = db.media.get(Number(params[0]));
  if (!m) fail(404, 'NOT_FOUND', 'Media not found');
  if (m!.purged) fail(410, 'MEDIA_PURGED', 'This image was deleted by the data retention policy');
  return new Response(new Blob([renderMedia(m!)], { type: 'image/svg+xml' }), { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
});

// ---------- review cases ----------
/** Tenants whose cases camtech decides: the default tenant (1) and DEMO (review.owner = CAMTECH). SELFREV (3) reviews its own. */
const CAMTECH_REVIEWED_TENANTS = new Set([1, 2]);
on('GET', '/v2/admin/review-cases', 'VIEWER', ({ query }) => {
  const status = query.get('status');
  const assignedTo = query.get('assignedTo');
  const items = db.reviews
    .filter((r) => CAMTECH_REVIEWED_TENANTS.has(r.tenantId))
    .filter((r) => !status || r.status === status)
    .filter((r) => !assignedTo || r.assignedTo === assignedTo)
    .sort((a, b) => (status === 'APPROVED' || status === 'REJECTED' ? b.updatedAt.localeCompare(a.updatedAt) : a.createdAt.localeCompare(b.createdAt)))
    .map(reviewSummary);
  return json(paginate(items, query));
});
on('GET', '/v2/admin/review-cases/{id}', 'VIEWER', ({ params }) => json(reviewDetail(findReview(params[0]))));
on('POST', '/v2/admin/review-cases/{id}/assign', 'REVIEWER', (ctx) => {
  const r = findReview(ctx.params[0]);
  if (r.status === 'APPROVED' || r.status === 'REJECTED') fail(409, 'CASE_CLOSED', 'This case is already decided');
  const assignee = str(ctx.body.assignee) ?? ctx.user!.username;
  if (!db.users.some((u) => u.username === assignee && u.role !== 'VIEWER')) fail(422, 'VALIDATION_ERROR', `${assignee} can't review cases`);
  r.assignedTo = assignee;
  r.status = 'IN_REVIEW';
  r.updatedAt = nowIso();
  r.actions.push({ id: db.seq.action++, action: 'ASSIGNED', actor: ctx.user!.username, note: assignee !== ctx.user!.username ? `Assigned to ${assignee}` : null, createdAt: r.updatedAt });
  audit(ctx, 'REVIEW_ASSIGNED', 'REVIEW_CASE', r.id, { assignee });
  return json(reviewDetail(r));
});
on('POST', '/v2/admin/review-cases/{id}/comment', 'REVIEWER', (ctx) => {
  const r = findReview(ctx.params[0]);
  const note = reqStr(ctx.body, 'note');
  r.updatedAt = nowIso();
  r.actions.push({ id: db.seq.action++, action: 'COMMENTED', actor: ctx.user!.username, note, createdAt: r.updatedAt });
  audit(ctx, 'REVIEW_COMMENTED', 'REVIEW_CASE', r.id, null);
  return json(reviewDetail(r));
});
on('POST', '/v2/admin/review-cases/{id}/decide', 'REVIEWER', (ctx) => {
  const r = findReview(ctx.params[0]);
  if (r.status === 'APPROVED' || r.status === 'REJECTED') fail(409, 'CASE_CLOSED', 'This case is already decided');
  const decision = str(ctx.body.decision);
  if (decision !== 'APPROVED' && decision !== 'REJECTED') fail(422, 'VALIDATION_ERROR', 'decision must be APPROVED or REJECTED');
  const note = reqStr(ctx.body, 'note');
  const at = nowIso();
  if (!r.assignedTo) {
    r.assignedTo = ctx.user!.username;
    r.actions.push({ id: db.seq.action++, action: 'ASSIGNED', actor: ctx.user!.username, note: null, createdAt: at });
  }
  r.status = decision as 'APPROVED' | 'REJECTED';
  r.updatedAt = at;
  r.actions.push({ id: db.seq.action++, action: decision as 'APPROVED' | 'REJECTED', actor: ctx.user!.username, note, createdAt: at });
  const s = findSession(r.sessionPublicId);
  s.decision = { decision: decision as 'APPROVED' | 'REJECTED', decidedBy: 'USER', decidedByUser: ctx.user!.username, reason: note, finalSimilarity: s.finalSimilarity, decidedAt: at };
  const doc = s.documentId ? db.documents.find((d) => d.id === s.documentId) : undefined;
  if (doc && doc.status === 'CAPTURED') doc.status = decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
  if (decision === 'APPROVED' && s.enrollFace) registerFace(s);
  addSessionEvent(s, 'REVIEW_DECIDED');
  audit(ctx, 'REVIEW_DECIDED', 'REVIEW_CASE', r.id, { decision, note });
  return json(reviewDetail(r));
});

/** An approved session asked to register the face: its selfie template becomes the person's registered face. */
function registerFace(s: MockSession) {
  const p = db.parties.find((x) => x.id === s.partyId);
  const live = s.steps.filter((st) => st.stepCode === 'LIVENESS' && st.status === 'PASSED').pop();
  const selfie = live?.media.find((m) => m.role === 'SELFIE_NORMAL');
  const t = selfie && p?.faceTemplates.find((x) => x.sourceMediaId === selfie.id);
  if (!p || !t) return;
  p.faceTemplates.forEach((x) => {
    if (x.status === 'ENROLLED') x.status = 'SESSION';
  });
  t.status = 'ENROLLED';
  s.faceRegistered = true;
}

// ---------- parties ----------
function partyDetail(id: number): PartyDetail {
  const p = db.parties.find((x) => x.id === id);
  if (!p) fail(404, 'NOT_FOUND', 'Person not found');
  const docs = db.documents.filter((d) => d.partyId === id).map(docSummary);
  const sessions = db.sessions.filter((s) => s.partyId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(sessionSummary);
  return { ...p!, documents: docs, sessions, documentsCount: docs.length, sessionsCount: sessions.length };
}
on('GET', '/v2/admin/parties', 'VIEWER', ({ query }) => {
  const q = query.get('q')?.toLowerCase();
  const type = query.get('partyType');
  const items = db.parties
    .filter((p) => !type || p.partyType === type)
    .filter((p) => !q || [p.displayName, p.externalRef, p.publicId, p.person?.fullNameAr, ...db.documents.filter((d) => d.partyId === p.id).map((d) => d.documentNumber)].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (b.lastVerifiedAt ?? b.createdAt).localeCompare(a.lastVerifiedAt ?? a.createdAt))
    .map((p) => {
      const { person: _p, organization: _o, faceTemplates: _f, relations: _r, ...rest } = p;
      return { ...rest, documentsCount: db.documents.filter((d) => d.partyId === p.id).length, sessionsCount: db.sessions.filter((s) => s.partyId === p.id).length };
    });
  return json(paginate(items, query));
});
on('GET', '/v2/admin/parties/{id}', 'VIEWER', ({ params }) => json(partyDetail(Number(params[0]))));
on('DELETE', '/v2/admin/parties/{id}', 'ADMIN', (ctx) => {
  const id = Number(ctx.params[0]);
  const p = db.parties.find((x) => x.id === id);
  if (!p) fail(404, 'NOT_FOUND', 'Person not found');
  const docIds = new Set(db.documents.filter((d) => d.partyId === id).map((d) => d.id));
  const sessionIds = new Set(db.sessions.filter((s) => s.partyId === id).map((s) => s.publicId));
  const counts = { documents: docIds.size, sessions: sessionIds.size, faceTemplates: p!.faceTemplates.length };
  db.sessions.filter((s) => sessionIds.has(s.publicId)).forEach((s) => s.steps.forEach((st) => st.media.forEach((m) => db.media.delete(m.id))));
  db.documents.filter((d) => docIds.has(d.id)).forEach((d) => d.media.forEach((m) => db.media.delete(m.id)));
  db.sessions = db.sessions.filter((s) => !sessionIds.has(s.publicId));
  db.reviews = db.reviews.filter((r) => !sessionIds.has(r.sessionPublicId));
  db.documents = db.documents.filter((d) => !docIds.has(d.id));
  db.scans = db.scans.filter((s) => s.documentId === null || !docIds.has(s.documentId));
  db.parties = db.parties.filter((x) => x.id !== id);
  db.parties.forEach((x) => (x.relations = x.relations.filter((r) => r.otherPartyId !== id)));
  audit(ctx, 'PARTY_ERASED', 'PARTY', id, { publicId: p!.publicId, ...counts });
  deliverEvent('PARTY_ERASED');
  return noContent();
});
on('POST', '/v2/admin/parties/{id}/face-templates/{tid}/revoke', 'ADMIN', (ctx) => {
  const p = db.parties.find((x) => x.id === Number(ctx.params[0]));
  if (!p) fail(404, 'NOT_FOUND', 'Person not found');
  const t = p!.faceTemplates.find((x) => x.id === Number(ctx.params[1]));
  if (!t) fail(404, 'NOT_FOUND', 'Face template not found');
  if (t!.status === 'REVOKED') fail(409, 'ALREADY_REVOKED', 'This face template is already revoked');
  t!.status = 'REVOKED';
  audit(ctx, 'FACE_TEMPLATE_REVOKED', 'FACE_TEMPLATE', t!.id, { partyId: p!.id });
  return noContent();
});

// ---------- documents & scans ----------
on('GET', '/v2/admin/documents', 'VIEWER', ({ query }) => {
  const q = query.get('q')?.toLowerCase();
  const type = query.get('docTypeCode');
  const status = query.get('status');
  const before = query.get('expiringBefore');
  const items = db.documents
    .filter((d) => !type || d.docTypeCode === type)
    .filter((d) => !status || d.status === status)
    .filter((d) => !before || (d.expiryDate !== null && d.expiryDate <= before))
    .filter((d) => !q || [d.documentNumber, d.partyName].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (before ? (a.expiryDate ?? '').localeCompare(b.expiryDate ?? '') : b.createdAt.localeCompare(a.createdAt)))
    .map(docSummary);
  return json(paginate(items, query));
});
on('GET', '/v2/admin/documents/{id}', 'VIEWER', ({ params }) => {
  const d = db.documents.find((x) => x.id === Number(params[0]));
  if (!d) fail(404, 'NOT_FOUND', 'Document not found');
  return json({ ...d!, scans: db.scans.filter((s) => s.documentId === d!.id).map(scanSummary) });
});
on('GET', '/v2/admin/document-scans', 'VIEWER', ({ query }) => {
  const status = query.get('status');
  const type = query.get('docTypeCode');
  const items = db.scans
    .filter((s) => !status || s.status === status)
    .filter((s) => !type || s.docTypeCode === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(scanSummary);
  return json(paginate(items, query));
});
on('GET', '/v2/admin/document-scans/{id}', 'VIEWER', ({ params }) => {
  const s = db.scans.find((x) => x.id === Number(params[0]));
  if (!s) fail(404, 'NOT_FOUND', 'Scan not found');
  return json(s);
});

const SCAN_DATE_FIELDS = new Set(['dateOfBirth', 'issueDate', 'expiryDate']);
/** Why a scan value is malformed, or null (a light version of the backend checks). */
function scanFormatError(code: string, v: string): string | null {
  if (code === 'emiratesIdNumber' && !/^784-?\d{4}-?\d{7}-?\d$/.test(v)) return 'not a valid Emirates ID number (784-YYYY-NNNNNNN-C)';
  if (SCAN_DATE_FIELDS.has(code) && !/^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/.test(v)) return 'not a valid date (dd/MM/yyyy)';
  return null;
}
on('POST', '/v2/admin/document-scans/{id}/review', 'REVIEWER', (ctx) => {
  const s = db.scans.find((x) => x.id === Number(ctx.params[0]));
  if (!s) fail(404, 'NOT_FOUND', 'Scan not found');
  const scan = s!;
  const decision = (str(ctx.body.decision) ?? '').trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'REJECT') fail(400, 'VALIDATION_ERROR', 'decision must be APPROVE or REJECT');
  if (scan.status !== 'NEEDS_REVIEW') fail(409, 'SCAN_NOT_IN_REVIEW', `Only scans waiting for review can be approved or rejected (this one is ${scan.status})`);
  const corrected: string[] = [];
  if (decision === 'APPROVE') {
    const raw = ctx.body.corrections;
    const corrections: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const next = scan.fields.map((f) => ({ ...f }));
    for (const [code, value] of Object.entries(corrections)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(code)) fail(400, 'VALIDATION_ERROR', `Unknown field '${code}'`);
      const v = (str(value) ?? '').trim();
      if (!v) fail(400, 'VALIDATION_ERROR', `${code}: a value is required`);
      const err = scanFormatError(code, v);
      if (err) fail(400, 'VALIDATION_ERROR', `${code}: ${err}`);
      let f = next.find((x) => x.fieldCode === code);
      if (!f) {
        f = { fieldCode: code, lang: code.endsWith('Ar') ? 'ar' : null, rawValue: null, confidence: null, validationStatus: null, validationMessage: null, source: null, reviewedValue: null };
        next.push(f);
      }
      if (v !== f.rawValue) corrected.push(code);
      f.reviewedValue = v;
    }
    const finalValue = (code: string) => {
      const f = next.find((x) => x.fieldCode === code);
      return (f?.reviewedValue ?? f?.rawValue ?? '').trim();
    };
    for (const r of scan.reviewReasons ?? []) {
      if (r.code === 'FIELD_MISSING' && r.field && !finalValue(r.field)) fail(400, 'VALIDATION_ERROR', `${r.field} was not read from the document: enter it before approving`);
    }
    for (const f of next) {
      const v = (f.reviewedValue ?? f.rawValue ?? '').trim();
      const err = v ? scanFormatError(f.fieldCode, v) : null;
      if (err) fail(400, 'VALIDATION_ERROR', `${f.fieldCode}: ${err}. Correct it before approving`);
    }
    scan.fields = next;
    scan.status = 'COMPLETED';
  } else {
    scan.status = 'REJECTED';
  }
  scan.reviewedBy = `ADMIN:${ctx.user!.username}`;
  scan.reviewedAt = nowIso();
  scan.reviewNote = str(ctx.body.note)?.trim() || null;
  audit(ctx, 'DOCUMENT_SCAN_REVIEWED', 'DOCUMENT_SCAN', scan.publicId, { decision, correctedFields: corrected });
  deliverEvent('SCAN_REVIEW_DECIDED');
  return json(scan);
});

// ---------- tenant & entitlements ----------
on('GET', '/v2/admin/tenant', 'VIEWER', () => json(db.tenant));
on('GET', '/v2/admin/entitlements', 'VIEWER', () => json(db.entitlements));
on('GET', '/v2/admin/tenants/{tid}/entitlements', 'VIEWER', (ctx) => json(storeOf(tenantOf(ctx.params[0]).id).entitlements));

// ---------- tenants (platform) ----------
const tenants: TenantSummary[] = [
  { ...db.tenant, status: 'ACTIVE', isDefault: true },
  { id: 2, code: 'DEMO', name: 'Demo Company', status: 'ACTIVE', isDefault: false, createdAt: nowIso() },
  { id: 3, code: 'SELFREV', name: 'Self-review Co', status: 'ACTIVE', isDefault: false, createdAt: nowIso() },
];
on('GET', '/v2/admin/tenants', 'VIEWER', () => json(tenants));

/** A tenant's plan, settings and apps. The default tenant's live in db; the others start as a copy of it (like the API). */
interface TenantStore {
  entitlements: Entitlement[];
  configParams: ConfigParam[];
  clientApps: ClientApp[];
}
const otherStores = new Map<number, TenantStore>();
function storeOf(tenantId: number): TenantStore {
  if (tenantId === db.tenant.id) return db;
  let s = otherStores.get(tenantId);
  if (!s) {
    s = {
      entitlements: db.entitlements.map((e) => ({ ...e, id: tenantId * 1000 + e.id, usedToday: 0 })),
      configParams: db.configParams.filter((p) => !p.clientAppCode).map((p) => ({ ...p, id: tenantId * 1000 + p.id })),
      clientApps: db.clientApps
        .filter((a) => a.code === 'MOBILE_APP' || a.code === 'WEB_APP')
        .map((a) => ({ ...a, id: tenantId * 1000 + a.id, credentialsCount: 0, permissions: a.permissions.map((x) => ({ ...x })) })),
    };
    otherStores.set(tenantId, s);
  }
  return s;
}

// ---------- tenant portal users ----------
interface MockTenantUser extends TenantUserView {
  tenantId: number;
}
const TENANT_ROLES: TenantUserRole[] = ['OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER'];
const tenantUsers: MockTenantUser[] = [
  {
    tenantId: db.tenant.id, id: 1, username: 'noqodi.owner', displayName: 'Noqodi Owner', email: 'owner@noqodi.example', role: 'OWNER',
    status: 'ACTIVE', mustChangePassword: false, lastLoginAt: new Date(Date.now() - 3 * 3600_000).toISOString(), createdAt: nowIso(),
  },
  {
    tenantId: db.tenant.id, id: 2, username: 'noqodi.dev', displayName: 'Noqodi Developer', email: null, role: 'DEVELOPER',
    status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, createdAt: nowIso(),
  },
  {
    tenantId: 2, id: 3, username: 'demo.owner', displayName: 'Demo Owner', email: 'owner@demo.example', role: 'OWNER',
    status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, createdAt: nowIso(),
  },
];
const tenantUserPasswords = new Map<number, string>();
let tenantUserSeq = 4;
const tenantUserView = ({ tenantId: _t, ...u }: MockTenantUser): TenantUserView => u;
function tenantOf(id: string): TenantSummary {
  const t = tenants.find((x) => x.id === Number(id));
  if (!t) fail(404, 'NOT_FOUND', 'Tenant not found');
  return t!;
}
function tenantUserOf(tenantId: number, userId: string): MockTenantUser {
  const u = tenantUsers.find((x) => x.tenantId === tenantId && x.id === Number(userId));
  if (!u) fail(404, 'NOT_FOUND', 'User not found');
  return u!;
}
/** Blank = generate 16 chars; else must be at least 10 characters with letters and digits. */
function tenantPassword(v: unknown): string {
  const p = str(v);
  if (!p) return generatePassword(16);
  if (!isStrongPassword(p)) fail(400, 'WEAK_PASSWORD', 'Password must be at least 10 characters, with letters and digits');
  return p;
}
/** Validates a new user's fields (throws USERNAME_TAKEN / WEAK_PASSWORD / VALIDATION_ERROR); does not store it. */
function newTenantUser(tenantId: number, b: Body, role: TenantUserRole): { user: MockTenantUser; password: string } {
  const username = (str(b.username) ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) fail(400, 'VALIDATION_ERROR', 'Username: 3-40 letters, digits, dot, dash or underscore');
  if (tenantUsers.some((u) => u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USERNAME_TAKEN', 'This username is already used');
  if (!TENANT_ROLES.includes(role)) fail(400, 'VALIDATION_ERROR', 'Pick a role');
  const password = tenantPassword(b.password);
  const user: MockTenantUser = {
    tenantId, id: tenantUserSeq++, username, displayName: str(b.displayName)?.trim() || null, email: str(b.email)?.trim() || null, role,
    status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, createdAt: nowIso(),
  };
  return { user, password };
}
function storeTenantUser(r: { user: MockTenantUser; password: string }) {
  tenantUsers.push(r.user);
  tenantUserPasswords.set(r.user.id, r.password);
}

on('GET', '/v2/admin/tenants/{id}/users', 'VIEWER', ({ params }) => {
  const t = tenantOf(params[0]);
  return json(tenantUsers.filter((u) => u.tenantId === t.id).map(tenantUserView));
});
on('POST', '/v2/admin/tenants/{id}/users', 'ADMIN', (ctx) => {
  const t = tenantOf(ctx.params[0]);
  const r = newTenantUser(t.id, ctx.body, str(ctx.body.role) as TenantUserRole);
  storeTenantUser(r);
  audit(ctx, 'TENANT_USER_CREATED', 'tenant_user', r.user.id, { tenant: t.code, username: r.user.username, role: r.user.role });
  return json({ user: tenantUserView(r.user), password: r.password }, 201);
});
on('PUT', '/v2/admin/tenants/{id}/users/{userId}', 'ADMIN', (ctx) => {
  const t = tenantOf(ctx.params[0]);
  const u = tenantUserOf(t.id, ctx.params[1]);
  const b = ctx.body;
  const role = b.role === undefined ? u.role : (str(b.role) as TenantUserRole);
  const status = b.status === undefined ? u.status : (str(b.status) as TenantUserView['status']);
  if (!TENANT_ROLES.includes(role)) fail(400, 'VALIDATION_ERROR', 'Pick a role');
  if (status !== 'ACTIVE' && status !== 'DISABLED') fail(400, 'VALIDATION_ERROR', 'status must be ACTIVE or DISABLED');
  const wasActiveOwner = u.role === 'OWNER' && u.status === 'ACTIVE';
  const staysActiveOwner = role === 'OWNER' && status === 'ACTIVE';
  if (wasActiveOwner && !staysActiveOwner && !tenantUsers.some((x) => x.tenantId === t.id && x.id !== u.id && x.role === 'OWNER' && x.status === 'ACTIVE')) {
    fail(409, 'LAST_OWNER', 'The tenant must keep at least one active owner');
  }
  if (b.displayName !== undefined) u.displayName = str(b.displayName)?.trim() || null;
  if (b.email !== undefined) u.email = str(b.email)?.trim() || null;
  u.role = role;
  u.status = status;
  audit(ctx, 'TENANT_USER_UPDATED', 'tenant_user', u.id, { tenant: t.code, role, status });
  return json(tenantUserView(u));
});
on('POST', '/v2/admin/tenants/{id}/users/{userId}/reset-password', 'ADMIN', (ctx) => {
  const t = tenantOf(ctx.params[0]);
  const u = tenantUserOf(t.id, ctx.params[1]);
  const password = tenantPassword(ctx.body.password);
  tenantUserPasswords.set(u.id, password);
  u.mustChangePassword = true;
  audit(ctx, 'TENANT_USER_PASSWORD_RESET', 'tenant_user', u.id, { tenant: t.code, username: u.username });
  return json({ password });
});
on('POST', '/v2/admin/tenants', 'ADMIN', (ctx) => {
  const code = (str(ctx.body.code) ?? '').trim().toUpperCase();
  const name = (str(ctx.body.name) ?? '').trim();
  if (!/^[A-Z0-9_]{2,30}$/.test(code)) fail(400, 'VALIDATION_ERROR', 'Code: 2-30 capital letters, digits or underscores');
  if (!name) fail(400, 'VALIDATION_ERROR', 'name is required');
  if (tenants.some((t) => t.code === code)) fail(409, 'CODE_TAKEN', 'A tenant with this code exists');
  const t: TenantSummary = { id: Math.max(...tenants.map((x) => x.id)) + 1, code, name, status: 'ACTIVE', isDefault: false, createdAt: nowIso() };
  const ownerBody = ctx.body.owner;
  // Validate the owner before creating anything (the real API does both in one transaction).
  const owner = ownerBody && typeof ownerBody === 'object' ? newTenantUser(t.id, ownerBody as Body, 'OWNER') : null;
  tenants.push(t);
  if (owner) storeTenantUser(owner);
  audit(ctx, 'TENANT_CREATED', 'tenant', code, { template: db.tenant.code, owner: owner?.user.username ?? null });
  return json({ ...t, owner: owner ? { user: tenantUserView(owner.user), password: owner.password } : null }, 201);
});
on('PUT', '/v2/admin/tenants/{id}', 'ADMIN', (ctx) => {
  const t = tenants.find((x) => x.id === Number(ctx.params[0]));
  if (!t) fail(404, 'NOT_FOUND', 'Tenant not found');
  const status = str(ctx.body.status);
  if (status && status !== 'ACTIVE' && status !== 'SUSPENDED') fail(400, 'VALIDATION_ERROR', 'status must be ACTIVE or SUSPENDED');
  if (status === 'SUSPENDED' && t!.isDefault) fail(409, 'DEFAULT_TENANT', 'The default tenant cannot be suspended');
  if (status) t!.status = status as TenantSummary['status'];
  const name = str(ctx.body.name);
  if (name) t!.name = name;
  audit(ctx, 'TENANT_UPDATED', 'tenant', t!.code, { status: t!.status });
  return json(t);
});
// ---------- liveness policy per tenant and flow ----------
const LIVENESS_FLOWS: Record<string, string> = {
  SELFIE_ID_VERIFICATION: 'Selfie ID verification',
  FACE_ENROLLMENT: 'Face registration',
  FACE_AUTHENTICATION: 'Face authentication',
  LIVENESS_CHECK: 'Liveness check',
};
interface MockLiveness {
  policy: LivenessPolicy;
  /** null = the tenant has not saved settings (policy defaults apply). */
  settings: LivenessSettings | null;
  updatedAt: string | null;
}
const liveness = new Map<string, MockLiveness>();
// The default tenant: camtech widened face authentication and the tenant saved its own choice (same as the portal mock).
liveness.set(`${db.tenant.id}:FACE_AUTHENTICATION`, {
  policy: { allowedModes: ['ACTIVE', 'PASSIVE'], allowedActions: [...CHALLENGE_ACTIONS], minActions: 1, maxActions: 4, requireSpareAction: true },
  settings: { mode: 'ACTIVE', actions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'SMILE', 'MOVE_CLOSER'], challengeCount: 2 },
  updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
});
// Liveness check: both modes, PASSIVE by default (face registration is never passive).
liveness.set(`${db.tenant.id}:LIVENESS_CHECK`, {
  policy: startingPolicy('LIVENESS_CHECK'),
  settings: null,
  updatedAt: null,
});
function livenessOf(tenantId: string, flowCode: string): MockLiveness {
  if (!tenants.some((t) => t.id === Number(tenantId))) fail(404, 'NOT_FOUND', 'Tenant not found');
  if (!(flowCode in LIVENESS_FLOWS)) fail(404, 'NOT_FOUND', `${flowCode} has no liveness check`);
  const key = `${Number(tenantId)}:${flowCode}`;
  if (!liveness.has(key)) liveness.set(key, { policy: startingPolicy(flowCode), settings: null, updatedAt: null });
  return liveness.get(key)!;
}
function flowLiveness(tenantId: string, flowCode: string): AdminFlowLiveness {
  const l = livenessOf(tenantId, flowCode);
  return {
    tenantId: Number(tenantId), flowCode, flowName: LIVENESS_FLOWS[flowCode], policy: structuredClone(l.policy),
    settings: structuredClone(l.settings ?? defaultSettings(l.policy, flowCode)), customized: l.settings !== null, updatedAt: l.updatedAt,
  };
}
on('GET', '/v2/admin/tenants/{id}/liveness-policies', 'VIEWER', ({ params }) => json(Object.keys(LIVENESS_FLOWS).map((f) => flowLiveness(params[0], f))));
on('GET', '/v2/admin/tenants/{id}/flows/{code}/liveness-policy', 'VIEWER', ({ params }) => json(flowLiveness(params[0], decodeURIComponent(params[1]))));
on('PUT', '/v2/admin/tenants/{id}/flows/{code}/liveness-policy', 'ADMIN', (ctx) => {
  const flowCode = decodeURIComponent(ctx.params[1]);
  const l = livenessOf(ctx.params[0], flowCode);
  const b = ctx.body;
  const list = <T extends string>(v: unknown, allowed: readonly T[], name: string): T[] => {
    if (!Array.isArray(v) || v.some((x) => !allowed.includes(x as T))) fail(400, 'VALIDATION_ERROR', `${name} must be a list of ${allowed.join(', ')}`);
    return v as T[];
  };
  const int = (v: unknown, name: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v)) fail(400, 'VALIDATION_ERROR', `${name} must be a whole number`);
    return v as number;
  };
  const policy: LivenessPolicy = {
    allowedModes: list<LivenessMode>(b.allowedModes, LIVENESS_MODES, 'allowedModes'),
    allowedActions: list<ChallengeAction>(b.allowedActions, CHALLENGE_ACTIONS, 'allowedActions'),
    minActions: int(b.minActions, 'minActions'),
    maxActions: int(b.maxActions, 'maxActions'),
    requireSpareAction: b.requireSpareAction !== false,
  };
  const issue = validatePolicy(flowCode, policy);
  if (issue) fail(400, issue.code, issue.message);
  const reset = b.resetTenant === true;
  const conflict = l.settings ? settingsConflict(l.settings, policy) : null;
  if (conflict && !reset) fail(409, 'TENANT_SETTINGS_CONFLICT', `The tenant's saved settings would no longer be valid: ${conflict}.`);
  l.policy = policy;
  if (reset && l.settings) {
    l.settings = null;
    l.updatedAt = nowIso();
  }
  const tenant = tenants.find((t) => t.id === Number(ctx.params[0]));
  audit(ctx, 'LIVENESS_POLICY_UPDATED', 'tenant', tenant?.code ?? ctx.params[0], { flowCode, ...policy, resetTenant: reset });
  return json(flowLiveness(ctx.params[0], flowCode));
});

function updateEntitlement(s: TenantStore, ctx: Ctx, id: string) {
  const e = s.entitlements.find((x) => x.id === Number(id));
  if (!e) fail(404, 'NOT_FOUND', 'Entitlement not found');
  const q = ctx.body.quotaPerDay;
  if (q !== null && (typeof q !== 'number' || !Number.isInteger(q) || q < 0)) fail(422, 'VALIDATION_ERROR', 'quotaPerDay must be a whole number ≥ 0 or null');
  e!.enabled = Boolean(ctx.body.enabled);
  e!.quotaPerDay = q as number | null;
  e!.validUntil = str(ctx.body.validUntil);
  audit(ctx, 'ENTITLEMENT_UPDATED', 'ENTITLEMENT', e!.id, { featureCode: e!.featureCode, enabled: e!.enabled, quotaPerDay: e!.quotaPerDay, validUntil: e!.validUntil });
  return json(e);
}
on('PUT', '/v2/admin/entitlements/{id}', 'ADMIN', (ctx) => updateEntitlement(db, ctx, ctx.params[0]));
on('PUT', '/v2/admin/tenants/{tid}/entitlements/{id}', 'ADMIN', (ctx) => updateEntitlement(storeOf(tenantOf(ctx.params[0]).id), ctx, ctx.params[1]));

// ---------- client apps ----------
function findApp(id: string): ClientApp {
  const a = db.clientApps.find((x) => x.id === Number(id));
  if (!a) fail(404, 'NOT_FOUND', 'Client app not found');
  return a!;
}
const origins = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
on('GET', '/v2/admin/client-apps', 'VIEWER', () => json(db.clientApps));
on('GET', '/v2/admin/tenants/{tid}/client-apps', 'VIEWER', (ctx) => json(storeOf(tenantOf(ctx.params[0]).id).clientApps));
on('POST', '/v2/admin/client-apps', 'ADMIN', (ctx) => {
  const code = reqStr(ctx.body, 'code').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) fail(422, 'VALIDATION_ERROR', 'Code must be letters, digits and underscores');
  if (db.clientApps.some((a) => a.code === code)) fail(409, 'DUPLICATE', `A client app with code ${code} already exists`);
  const channel = str(ctx.body.channel);
  if (channel !== 'MOBILE' && channel !== 'WEB' && channel !== 'ADMIN') fail(422, 'VALIDATION_ERROR', 'channel is required');
  const app: ClientApp = {
    id: db.seq.clientApp++, code, name: reqStr(ctx.body, 'name'), channel: channel as ClientApp['channel'], platform: str(ctx.body.platform),
    appIdentifier: str(ctx.body.appIdentifier), allowedOrigins: origins(ctx.body.allowedOrigins), status: 'ACTIVE',
    permissions: db.clientApps[0].permissions.map((p) => ({ featureCode: p.featureCode, allowed: false })), credentialsCount: 0, createdAt: nowIso(),
  };
  db.clientApps.push(app);
  audit(ctx, 'CLIENT_APP_CREATED', 'CLIENT_APP', app.id, { code });
  return json(app, 201);
});
on('PUT', '/v2/admin/client-apps/{id}', 'ADMIN', (ctx) => {
  const a = findApp(ctx.params[0]);
  a.name = reqStr(ctx.body, 'name');
  a.platform = str(ctx.body.platform);
  a.appIdentifier = str(ctx.body.appIdentifier);
  a.allowedOrigins = origins(ctx.body.allowedOrigins);
  const st = str(ctx.body.status);
  if (st === 'ACTIVE' || st === 'DISABLED') a.status = st;
  audit(ctx, 'CLIENT_APP_UPDATED', 'CLIENT_APP', a.id, { name: a.name, status: a.status });
  return json(a);
});
on('PUT', '/v2/admin/client-apps/{id}/permissions', 'ADMIN', (ctx) => {
  const a = findApp(ctx.params[0]);
  if (!Array.isArray(ctx.rawBody)) fail(422, 'VALIDATION_ERROR', 'Expected a list of permissions');
  for (const p of ctx.rawBody as { featureCode: string; allowed: boolean }[]) {
    const ex = a.permissions.find((x) => x.featureCode === p.featureCode);
    if (ex) ex.allowed = Boolean(p.allowed);
    else a.permissions.push({ featureCode: p.featureCode, allowed: Boolean(p.allowed) });
  }
  audit(ctx, 'CLIENT_APP_UPDATED', 'CLIENT_APP', a.id, { permissions: ctx.rawBody });
  return json(a);
});
on('GET', '/v2/admin/client-apps/{id}/credentials', 'VIEWER', ({ params }) => {
  const a = findApp(params[0]);
  return json(db.credentials.filter((c) => c.clientAppId === a.id).map(({ clientAppId: _c, ...c }) => c));
});
on('POST', '/v2/admin/client-apps/{id}/credentials', 'ADMIN', (ctx) => {
  const a = findApp(ctx.params[0]);
  const cred = { id: db.seq.credential++, clientAppId: a.id, keyId: `ck_${randHex(16)}`, status: 'ACTIVE' as const, createdAt: nowIso(), expiresAt: str(ctx.body.expiresAt), lastUsedAt: null };
  db.credentials.push(cred);
  a.credentialsCount++;
  audit(ctx, 'CREDENTIAL_CREATED', 'CREDENTIAL', cred.id, { clientApp: a.code, keyId: cred.keyId });
  const { clientAppId: _c, ...credential } = cred;
  return json({ credential, secret: `cs_${randHex(40)}` }, 201);
});
on('POST', '/v2/admin/credentials/{id}/revoke', 'ADMIN', (ctx) => {
  const c = db.credentials.find((x) => x.id === Number(ctx.params[0]));
  if (!c) fail(404, 'NOT_FOUND', 'Credential not found');
  if (c!.status === 'REVOKED') fail(409, 'ALREADY_REVOKED', 'This credential is already revoked');
  c!.status = 'REVOKED';
  audit(ctx, 'CREDENTIAL_REVOKED', 'CREDENTIAL', c!.id, { keyId: c!.keyId });
  const { clientAppId: _c, ...rest } = c!;
  return json(rest as Credential);
});
on('GET', '/v2/admin/client-apps/{id}/capabilities', 'VIEWER', ({ params }) => {
  const a = findApp(params[0]);
  const allowed = (code: string) => a.permissions.find((p) => p.featureCode === code)?.allowed ?? false;
  const ent = (code: string) => db.entitlements.find((e) => e.featureCode === code);
  const entitled = (code: string) => {
    const e = ent(code);
    return !!e && e.enabled && (!e.validUntil || e.validUntil >= new Date().toISOString().slice(0, 10));
  };
  const scope = { channel: a.channel, clientAppCode: a.code };
  const caps: Capabilities = {
    tenant: db.tenant.code, clientApp: a.code, channel: a.channel,
    flows: a.status !== 'ACTIVE' ? [] : db.flows.filter((f) => f.enabled && entitled(f.code) && allowed(f.code)).map((f) => {
      const ctx = { ...scope, flowCode: f.code };
      const e = ent(f.code)!;
      return {
        code: f.code,
        documents: (FLOW_DOCS[f.code] ?? []).filter((d) => entitled(d)),
        steps: [...f.steps].sort((x, y) => x.seq - y.seq).map((s) => s.stepCode),
        settings: {
          livenessMaxAttempts: Number(resolveParam('liveness.max_attempts', ctx)),
          documentMaxAttempts: Number(resolveParam('document.max_attempts', ctx)),
          sessionTtlMinutes: Number(resolveParam('session.ttl_minutes', ctx)),
          deviceAntispoofRequired: resolveParam('liveness.device_antispoof_required', ctx) === 'true' && allowed('DEVICE_ANTISPOOF'),
          fileUploadAllowed: resolveParam('document.file_upload_allowed', ctx) === 'true' && allowed('FILE_UPLOAD') && entitled('FILE_UPLOAD'),
          ...(f.code === 'SELFIE_ID_VERIFICATION' ? { faceEnrollmentAvailable: entitled('FACE_ENROLLMENT') && allowed('FACE_ENROLLMENT') } : {}),
        },
        quota: { perDay: e.quotaPerDay, remainingToday: e.quotaPerDay === null ? null : Math.max(0, e.quotaPerDay - e.usedToday) },
      };
    }),
    features: db.entitlements.filter((e) => e.featureType === 'FEATURE' && entitled(e.featureCode) && allowed(e.featureCode)).map((e) => e.featureCode),
    locales: resolveParam('ui.locales', scope).split(',').map((s) => s.trim()).filter(Boolean),
  };
  return json(caps);
});

// ---------- settings ----------
on('GET', '/v2/admin/config-keys', 'VIEWER', () => json(CONFIG_KEYS));
on('GET', '/v2/admin/config-params', 'VIEWER', () => json(db.configParams));
on('GET', '/v2/admin/tenants/{tid}/config-params', 'VIEWER', (ctx) => json(storeOf(tenantOf(ctx.params[0]).id).configParams));
function createConfigParam(s: TenantStore, ctx: Ctx) {
  const key = CONFIG_KEYS.find((k) => k.key === str(ctx.body.paramKey));
  if (!key) fail(422, 'UNKNOWN_KEY', 'Unknown setting key');
  const flowCode = str(ctx.body.flowCode) || null;
  const channel = str(ctx.body.channel) || null;
  const clientAppCode = str(ctx.body.clientAppCode) || null;
  if (!flowCode && !channel && !clientAppCode) fail(422, 'VALIDATION_ERROR', 'An override needs at least one scope (flow, channel or client app)');
  if (s.configParams.some((p) => p.paramKey === key!.key && p.flowCode === flowCode && p.channel === channel && p.clientAppCode === clientAppCode))
    fail(409, 'DUPLICATE', 'An override for this key and scope already exists');
  const param: ConfigParam = { id: db.seq.config++, flowCode, channel, clientAppCode, paramKey: key!.key, paramValue: validateValue(key!, ctx.body.paramValue), description: key!.description, updatedAt: nowIso(), updatedBy: ctx.user!.username };
  s.configParams.push(param);
  audit(ctx, 'CONFIG_CREATED', 'CONFIG_PARAM', param.id, { paramKey: param.paramKey, paramValue: param.paramValue, flowCode, channel, clientAppCode });
  return json(param, 201);
}
function updateConfigParam(s: TenantStore, ctx: Ctx, id: string) {
  const p = s.configParams.find((x) => x.id === Number(id));
  if (!p) fail(404, 'NOT_FOUND', 'Setting not found');
  const key = CONFIG_KEYS.find((k) => k.key === p!.paramKey);
  const old = p!.paramValue;
  p!.paramValue = key ? validateValue(key, ctx.body.paramValue) : (str(ctx.body.paramValue) ?? '');
  p!.updatedAt = nowIso();
  p!.updatedBy = ctx.user!.username;
  audit(ctx, 'CONFIG_UPDATED', 'CONFIG_PARAM', p!.id, { paramKey: p!.paramKey, oldValue: old, newValue: p!.paramValue });
  return json(p);
}
function deleteConfigParam(s: TenantStore, ctx: Ctx, id: string) {
  const p = s.configParams.find((x) => x.id === Number(id));
  if (!p) fail(404, 'NOT_FOUND', 'Setting not found');
  if (!p!.flowCode && !p!.channel && !p!.clientAppCode) fail(409, 'GLOBAL_DEFAULT', "A global default can't be deleted");
  s.configParams = s.configParams.filter((x) => x.id !== p!.id);
  audit(ctx, 'CONFIG_DELETED', 'CONFIG_PARAM', p!.id, { paramKey: p!.paramKey });
  return noContent();
}
const tenantStore = (ctx: Ctx) => storeOf(tenantOf(ctx.params[0]).id);
on('POST', '/v2/admin/config-params', 'ADMIN', (ctx) => createConfigParam(db, ctx));
on('PUT', '/v2/admin/config-params/{id}', 'ADMIN', (ctx) => updateConfigParam(db, ctx, ctx.params[0]));
on('DELETE', '/v2/admin/config-params/{id}', 'ADMIN', (ctx) => deleteConfigParam(db, ctx, ctx.params[0]));
on('POST', '/v2/admin/tenants/{tid}/config-params', 'ADMIN', (ctx) => createConfigParam(tenantStore(ctx), ctx));
on('PUT', '/v2/admin/tenants/{tid}/config-params/{id}', 'ADMIN', (ctx) => updateConfigParam(tenantStore(ctx), ctx, ctx.params[1]));
on('DELETE', '/v2/admin/tenants/{tid}/config-params/{id}', 'ADMIN', (ctx) => deleteConfigParam(tenantStore(ctx), ctx, ctx.params[1]));

// ---------- flows & catalogue ----------
on('GET', '/v2/admin/flows', 'VIEWER', () =>
  json(db.flows.map((f) => ({ ...f, enabledTenants: tenants.filter((t) => storeOf(t.id).entitlements.some((e) => e.featureCode === f.code && e.enabled)).length }))),
);
on('PUT', '/v2/admin/flows/{code}/steps/{stepId}', 'ADMIN', (ctx) => {
  const f = db.flows.find((x) => x.code === decodeURIComponent(ctx.params[0]));
  if (!f) fail(404, 'NOT_FOUND', 'Flow not found');
  const st = f!.steps.find((s) => s.id === Number(ctx.params[1]));
  if (!st) fail(404, 'NOT_FOUND', 'Step not found');
  const max = Number(ctx.body.maxAttempts);
  if (!Number.isInteger(max) || max < 1 || max > 10) fail(422, 'VALIDATION_ERROR', 'Max attempts must be between 1 and 10');
  if (typeof ctx.body.mandatory === 'boolean') st!.mandatory = ctx.body.mandatory;
  st!.maxAttempts = max;
  audit(ctx, 'CONFIG_UPDATED', 'FLOW_STEP', st!.id, { flowCode: f!.code, stepCode: st!.stepCode, mandatory: st!.mandatory, maxAttempts: max });
  return json(f);
});
on('GET', '/v2/admin/document-types', 'VIEWER', () => json(DOCUMENT_TYPES));
on('GET', '/v2/admin/issuers', 'VIEWER', () => json(ISSUERS));
on('GET', '/v2/admin/reason-codes', 'VIEWER', () => json(db.reasonCodes));
on('PUT', '/v2/admin/reason-codes/{code}', 'ADMIN', (ctx) => {
  const r = db.reasonCodes.find((x) => x.code === decodeURIComponent(ctx.params[0]));
  if (!r) fail(404, 'NOT_FOUND', 'Reason code not found');
  r!.messageEn = reqStr(ctx.body, 'messageEn');
  r!.messageAr = str(ctx.body.messageAr)?.trim() || null;
  audit(ctx, 'CONFIG_UPDATED', 'REASON_CODE', r!.code, { messageEn: r!.messageEn, messageAr: r!.messageAr });
  return json(r);
});

// ---------- webhooks ----------
const EVENTS = [
  'SESSION_COMPLETED', 'SESSION_EXPIRED', 'REVIEW_OPENED', 'REVIEW_DECIDED',
  'SCAN_REVIEW_REQUIRED', 'SCAN_REVIEW_DECIDED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED',
];
function validWebhook(body: Body): { url: string; events: string[] } {
  const url = reqStr(body, 'url');
  if (!/^https?:\/\/[^\s]+$/i.test(url)) fail(422, 'VALIDATION_ERROR', 'Enter a valid http(s) URL');
  const events = Array.isArray(body.events) ? body.events.map(String) : [];
  if (!events.length) fail(422, 'VALIDATION_ERROR', 'Pick at least one event');
  if (events.some((e) => !EVENTS.includes(e))) fail(422, 'VALIDATION_ERROR', 'Unknown event type');
  return { url, events };
}
function findWebhook(id: string): Webhook {
  const w = db.webhooks.find((x) => x.id === Number(id));
  if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
  return w!;
}
on('GET', '/v2/admin/webhooks', 'VIEWER', () => json(db.webhooks.map(refreshWebhookHealth)));
on('POST', '/v2/admin/webhooks', 'ADMIN', (ctx) => {
  const { url, events } = validWebhook(ctx.body);
  const w: Webhook = { id: db.seq.webhook++, url, events, status: 'ACTIVE', createdAt: nowIso(), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false };
  db.webhooks.push(w);
  audit(ctx, 'WEBHOOK_CREATED', 'WEBHOOK', w.id, { url, events });
  return json({ webhook: w, secret: `whsec_${randHex(32)}` }, 201);
});
on('PUT', '/v2/admin/webhooks/{id}', 'ADMIN', (ctx) => {
  const w = findWebhook(ctx.params[0]);
  const { url, events } = validWebhook(ctx.body);
  w.url = url;
  w.events = events;
  const st = str(ctx.body.status);
  if (st === 'ACTIVE' || st === 'DISABLED') w.status = st;
  audit(ctx, 'WEBHOOK_UPDATED', 'WEBHOOK', w.id, { url, events, status: w.status });
  return json(refreshWebhookHealth(w));
});
on('DELETE', '/v2/admin/webhooks/{id}', 'ADMIN', (ctx) => {
  const w = findWebhook(ctx.params[0]);
  db.webhooks = db.webhooks.filter((x) => x.id !== w.id);
  audit(ctx, 'WEBHOOK_UPDATED', 'WEBHOOK', w.id, { deleted: true, url: w.url });
  return noContent();
});
on('POST', '/v2/admin/webhooks/{id}/rotate-secret', 'ADMIN', (ctx) => {
  const w = findWebhook(ctx.params[0]);
  audit(ctx, 'WEBHOOK_UPDATED', 'WEBHOOK', w.id, { secretRotated: true });
  return json({ webhook: refreshWebhookHealth(w), secret: `whsec_${randHex(32)}` });
});
on('POST', '/v2/admin/webhooks/{id}/test', 'ADMIN', (ctx) => {
  const w = findWebhook(ctx.params[0]);
  const ok = w.status === 'ACTIVE' && !receiverDown(w);
  const d: WebhookDelivery = {
    id: db.seq.delivery++, webhookId: w.id, eventType: 'WEBHOOK_TEST', eventId: db.seq.event++, attempt: 1, httpStatus: ok ? 200 : 503,
    status: ok ? 'DELIVERED' : 'FAILED', error: ok ? null : 'Upstream returned 503 Service Unavailable', nextRetryAt: null, createdAt: nowIso(),
  };
  db.deliveries.push(d);
  w.lastDeliveryAt = d.createdAt;
  w.lastStatus = d.status;
  refreshWebhookHealth(w);
  return json(d);
});
on('GET', '/v2/admin/webhooks/{id}/deliveries', 'VIEWER', ({ params, query }) => {
  const w = findWebhook(params[0]);
  return json(paginate(db.deliveries.filter((d) => d.webhookId === w.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), query));
});
on('POST', '/v2/admin/webhook-deliveries/{id}/retry', 'ADMIN', (ctx) => {
  const d = db.deliveries.find((x) => x.id === Number(ctx.params[0]));
  if (!d) fail(404, 'NOT_FOUND', 'Delivery not found');
  if (d!.status === 'DELIVERED') fail(409, 'ALREADY_DELIVERED', 'This delivery already succeeded');
  if (d!.eventType === 'WEBHOOK_TEST') fail(409, 'TEST_DELIVERY', 'A test delivery cannot be retried: send a new test');
  d!.attempt++;
  d!.status = 'DELIVERED';
  d!.httpStatus = 200;
  d!.error = null;
  d!.nextRetryAt = null;
  const w = db.webhooks.find((x) => x.id === d!.webhookId);
  if (w) {
    w.lastDeliveryAt = nowIso();
    w.lastStatus = 'DELIVERED';
    refreshWebhookHealth(w);
  }
  return json(d);
});

// ---------- retention ----------
on('GET', '/v2/admin/retention-policies', 'VIEWER', () => json(db.retention));
on('PUT', '/v2/admin/retention-policies/{id}', 'ADMIN', (ctx) => {
  const p = db.retention.find((x) => x.id === Number(ctx.params[0]));
  if (!p) fail(404, 'NOT_FOUND', 'Policy not found');
  const days = Number(ctx.body.retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail(422, 'VALIDATION_ERROR', 'Retention must be between 1 and 3650 days');
  const old = p!.retentionDays;
  p!.retentionDays = days;
  p!.updatedAt = nowIso();
  audit(ctx, 'RETENTION_UPDATED', 'RETENTION_POLICY', p!.id, { dataCategory: p!.dataCategory, oldDays: old, newDays: days });
  return json(p);
});

// ---------- audit ----------
on('GET', '/v2/admin/audit-events', 'VIEWER', ({ query }) => {
  const actor = query.get('actor')?.toLowerCase();
  const action = query.get('action');
  const entity = query.get('entity');
  const from = query.get('from');
  const to = query.get('to');
  const items = db.audit
    .filter((a) => !actor || a.actor.toLowerCase().includes(actor))
    .filter((a) => !action || a.action === action)
    .filter((a) => !entity || a.entity === entity)
    .filter((a) => !from || a.at.slice(0, 10) >= from)
    .filter((a) => !to || a.at.slice(0, 10) <= to)
    .sort((a, b) => b.at.localeCompare(a.at));
  return json(paginate(items, query));
});

// ---------- users ----------
const tempPassword = () => `Tmp-${randHex(4)}-${randHex(4)}`;
on('GET', '/v2/admin/users', 'ADMIN', () => json(db.users));
on('POST', '/v2/admin/users', 'ADMIN', (ctx) => {
  const username = reqStr(ctx.body, 'username').toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(422, 'VALIDATION_ERROR', 'Username: 3-40 letters, digits, dot, dash or underscore');
  if (db.users.some((u) => u.username === username)) fail(409, 'DUPLICATE', 'This username is taken');
  const role = str(ctx.body.role) as Role;
  if (!ROLE_RANK[role]) fail(422, 'VALIDATION_ERROR', 'Pick a role');
  const user: AdminUser = { id: db.seq.user++, username, displayName: reqStr(ctx.body, 'displayName'), email: str(ctx.body.email) || null, role, status: 'ACTIVE', mustChangePassword: true, lastLoginAt: null, createdAt: nowIso() };
  const pwd = tempPassword();
  db.users.push(user);
  db.passwords.set(user.id, pwd);
  audit(ctx, 'USER_CREATED', 'ADMIN_USER', user.id, { username, role });
  return json({ user, temporaryPassword: pwd }, 201);
});
on('PUT', '/v2/admin/users/{id}', 'ADMIN', (ctx) => {
  const u = db.users.find((x) => x.id === Number(ctx.params[0]));
  if (!u) fail(404, 'NOT_FOUND', 'User not found');
  const role = str(ctx.body.role) as Role;
  const status = str(ctx.body.status) as AdminUser['status'];
  if (u!.id === ctx.user!.id && (role !== u!.role || status !== u!.status)) fail(409, 'SELF_CHANGE', "You can't change your own role or status");
  if (!ROLE_RANK[role]) fail(422, 'VALIDATION_ERROR', 'Pick a role');
  u!.displayName = reqStr(ctx.body, 'displayName');
  u!.email = str(ctx.body.email) || null;
  u!.role = role;
  u!.status = status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
  audit(ctx, 'USER_UPDATED', 'ADMIN_USER', u!.id, { role, status: u!.status });
  return json(u);
});
on('POST', '/v2/admin/users/{id}/reset-password', 'ADMIN', (ctx) => {
  const u = db.users.find((x) => x.id === Number(ctx.params[0]));
  if (!u) fail(404, 'NOT_FOUND', 'User not found');
  const pwd = tempPassword();
  db.passwords.set(u!.id, pwd);
  u!.mustChangePassword = true;
  audit(ctx, 'PASSWORD_RESET', 'ADMIN_USER', u!.id, null);
  return json({ temporaryPassword: pwd });
});

// ---------- entry point ----------
function userFromToken(token: string | null): AdminUser | null {
  if (!token || revokedTokens.has(token)) return null;
  const m = /^mock\.(\d+)\./.exec(token);
  if (!m) return null;
  const u = db.users.find((x) => x.id === Number(m[1]));
  return u && u.status === 'ACTIVE' ? u : null;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url, window.location.origin);
  // Routes start at /v2: drop the context path of the API base URL (e.g. /camtech-service).
  const path = u.pathname.replace(/^.*?(?=\/v2\/)/, '');
  const method = (init.method ?? 'GET').toUpperCase();
  await delay(method === 'GET' ? 120 + Math.random() * 250 : 250 + Math.random() * 300);
  const auth = new Headers(init.headers).get('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  let rawBody: unknown = undefined;
  if (typeof init.body === 'string' && init.body) rawBody = JSON.parse(init.body);
  const body: Body = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? (rawBody as Body) : {};

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    try {
      const user = userFromToken(token);
      if (r.role !== 'PUBLIC') {
        if (!user) return json({ code: 'UNAUTHORIZED', message: 'Please sign in again' }, 401);
        if (r.role !== 'ANY' && ROLE_RANK[user.role] < ROLE_RANK[r.role]) return json({ code: 'FORBIDDEN', message: "You don't have permission to do this" }, 403);
      }
      return await r.handler({ method, params: m.slice(1), query: u.searchParams, body, rawBody, user, token });
    } catch (e) {
      if (e instanceof HttpError) return json({ code: e.code, message: e.message }, e.status);
      console.error('[mock] handler error', e);
      return json({ code: 'INTERNAL_ERROR', message: 'Mock server error' }, 500);
    }
  }
  return json({ code: 'NOT_FOUND', message: `No mock route for ${method} ${path}` }, 404);
}
