// In-memory mock of the tenant API (/v2/tenant/**). Used when VITE_USE_MOCKS=true.
// It is a fetch-compatible function passed to CamtechTenantClient({ transport }), so the real client
// code path (headers, errors, JSON) is exercised end to end.
import type {
  DocumentDetail, PartyDetail, PartySummary, ReviewCaseDetail, ReviewCaseSummary, ReviewOwner,
  AuditEvent, Branding, BrandingUpdate, Capabilities, ChallengeAction, ClientApp, DocumentOcrSettings, OcrReviewMode, FlowCapability, LivenessMode, LivenessSettings, Page, Permission, SdkTokenResponse,
  TenantDashboard, TenantFlowLiveness, TenantScanSummary, TenantSessionDetail, TenantSessionSummary, TenantUser, TenantUserRole, TenantUserStatus, Transport, Webhook,
  WebhookDelivery, WebhookEvent,
} from '@camtech/api-client';
import { CHALLENGE_ACTIONS } from '@camtech/api-client';
import { defaultSettings, validateLiveness } from '../lib/liveness';
import { validateOrigins } from '../lib/origins';
import { ALLOWED_FONTS, defaultBranding, REASON_CODES } from './catalog';
import { zip } from './images';
import { mediaRef, type MockDocument, type MockParty, type MockReviewCase } from './records';
import { buildDb, type MockDb, type MockTenant, type MockUser } from './seed';

type Body = Record<string, unknown>;

/** Flows made of liveness selfies only (no document): one liveness attempt per call, like the real API. */
const SELFIE_ONLY_FLOWS = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'];

interface Ctx {
  method: string;
  params: string[];
  query: URLSearchParams;
  body: Body;
  rawBody: unknown;
  tenant: MockTenant;
  /** The signed-in user (unset on the public login route). */
  user: MockUser;
  token: string | null;
}

type Handler = (ctx: Ctx) => Response | Promise<Response>;

/**
 * public: no token (login). session: any signed-in user, even one who must change their password (me, logout,
 * change-password). api: everything else, gated by role.
 */
type Access = 'public' | 'session' | 'api';

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  access: Access;
  roles: TenantUserRole[];
}

const ALL_ROLES: TenantUserRole[] = ['OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER'];
const BUILDERS: TenantUserRole[] = ['OWNER', 'DEVELOPER'];
const REVIEWERS: TenantUserRole[] = ['OWNER', 'REVIEWER'];
const OWNERS: TenantUserRole[] = ['OWNER'];
const TOKEN_TTL_MS = 8 * 3_600_000;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });
function fail(status: number, code: string, message: string): never {
  throw new HttpError(status, code, message);
}
const nowIso = () => new Date().toISOString();
const randHex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const isRecord = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const OCR_MODES: OcrReviewMode[] = ['AUTO', 'ALWAYS', 'NEVER'];
const OCR_DEFAULTS: DocumentOcrSettings = { reviewMode: 'AUTO', autoAcceptConfidence: 0.85, fieldMinConfidence: 0.7, requiredFields: [], acceptExpired: false };

/** 15 digits, 784 prefix, Luhn check digit (the server's rule). */
function validEid(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 15 || !d.startsWith('784')) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

const WEBHOOK_EVENTS: WebhookEvent[] = [
  'SESSION_COMPLETED', 'SESSION_EXPIRED', 'REVIEW_OPENED', 'REVIEW_DECIDED', 'SCAN_REVIEW_REQUIRED', 'SCAN_REVIEW_DECIDED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED',
];
/** Deliveries in a row that must fail before an endpoint is flagged as failing (the server's rule). */
const FAILING_AFTER = 5;
const REVIEW_OWNERS: ReviewOwner[] = ['TENANT', 'CAMTECH'];
const DAY_MS = 86_400_000;

/** "Borderline face match (similarity 0.33)" -> "Borderline face match": scores stay internal. */
export const withoutScore = (text: string | null) => (text === null ? null : text.replace(/\s*\((?:similarity|score)[^)]*\)/g, '').trim());

/** Local YYYY-MM-DD of a time. */
const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const OPEN_STATUSES = ['CREATED', 'IN_PROGRESS'];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function paginate<T>(items: T[], q: URLSearchParams): Page<T> {
  const page = Math.max(0, Number(q.get('page') ?? 0) || 0);
  const size = Math.min(200, Math.max(1, Number(q.get('size') ?? 20) || 20));
  return { items: items.slice(page * size, page * size + size), page, size, total: items.length };
}

function validDate(v: string | null, name: string): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'VALIDATION_ERROR', `${name}: use dates as YYYY-MM-DD`);
  return v;
}

function httpUrl(v: unknown, name: string, required = false): string | null {
  const s = str(v)?.trim() ?? '';
  if (!s) {
    if (required) fail(400, 'VALIDATION_ERROR', `${name} is required`);
    return null;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail(400, 'VALIDATION_ERROR', `${name}: enter a full http(s) URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(400, 'VALIDATION_ERROR', `${name}: enter a full http(s) URL`);
  if (s.length > 500) fail(400, 'VALIDATION_ERROR', `${name}: the URL is too long`);
  return s;
}

export function createMockTransport(options: { latency?: boolean; db?: MockDb; onSessionsChanged?: (tokens: MockDb['tokens']) => void } = {}): Transport {
  const db: MockDb = options.db ?? buildDb();
  const latency = options.latency ?? true;
  const routes: Route[] = [];
  /** Reads are open to every role; writes default to OWNER + DEVELOPER (the server's rule). */
  const on = (method: string, path: string, handler: Handler, opts: { access?: Access; roles?: TenantUserRole[] } = {}) => {
    const pattern = new RegExp('^/v2/tenant' + path.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
    routes.push({ method, pattern, handler, access: opts.access ?? 'api', roles: opts.roles ?? (method === 'GET' ? ALL_ROLES : BUILDERS) });
  };

  /** Username behind the current call (handlers run synchronously, one call at a time). */
  let actor = 'portal';

  function audit(t: MockTenant, action: string, entity: string | null, entityId: string | number | null, details: Record<string, unknown> | null) {
    t.audit.unshift({ id: db.seq.audit++, actorType: 'TENANT_USER', actor, action, entity, entityId: entityId === null ? null : String(entityId), ipAddress: '127.0.0.1', details, at: nowIso() });
  }

  const userView = (u: MockUser): TenantUser => {
    const { password: _p, failedLogins: _f, ...view } = u;
    return view;
  };

  // ---------------------------------------------------------------- sign-in
  function findUserByName(username: string): { tenant: MockTenant; user: MockUser } | null {
    const name = username.trim().toLowerCase();
    for (const tenant of db.tenants.values()) {
      const user = tenant.users.find((u) => u.username.toLowerCase() === name);
      if (user) return { tenant, user };
    }
    return null;
  }

  function checkStrong(password: string) {
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      fail(400, 'WEAK_PASSWORD', 'Use at least 10 characters with both letters and digits');
    }
  }

  function generated(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    for (;;) {
      const p = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      if (/[A-Za-z]/.test(p) && /\d/.test(p)) return p;
    }
  }

  on('POST', '/auth/login', ({ body }) => {
    const username = str(body.username) ?? '';
    const password = str(body.password) ?? '';
    const found = findUserByName(username);
    if (!found || found.user.password !== password) {
      if (found) found.user.failedLogins++;
      fail(401, 'INVALID_LOGIN', 'Wrong username or password');
    }
    const { tenant, user } = found;
    if (user.status !== 'ACTIVE' || user.failedLogins >= 5) fail(423, 'ACCOUNT_LOCKED', 'This account is locked');
    if (tenant.info.status !== 'ACTIVE') fail(403, 'TENANT_SUSPENDED', 'This tenant is suspended');
    user.failedLogins = 0;
    user.lastLoginAt = nowIso();
    const token = `mock.${randHex(32)}`;
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    db.tokens.set(token, { tenantCode: tenant.info.code, userId: user.id, expiresAt });
    actor = user.username;
    audit(tenant, 'TENANT_USER_LOGIN', 'TENANT_USER', user.id, null);
    return json({ token, expiresAt: new Date(expiresAt).toISOString(), user: userView(user), tenant: { code: tenant.info.code, name: tenant.info.name } });
  }, { access: 'public' });

  on('POST', '/auth/logout', ({ token }) => {
    if (token) db.tokens.delete(token);
    return noContent();
  }, { access: 'session' });

  on('GET', '/auth/me', ({ tenant, user }) => json({ user: userView(user), tenant: { code: tenant.info.code, name: tenant.info.name } }), { access: 'session' });

  on('POST', '/auth/change-password', ({ tenant, user, body }) => {
    const current = str(body.currentPassword) ?? '';
    const next = str(body.newPassword) ?? '';
    if (current !== user.password) fail(400, 'WRONG_PASSWORD', 'The current password is not correct');
    checkStrong(next);
    if (next === current) fail(400, 'WEAK_PASSWORD', 'Choose a password different from the current one');
    user.password = next;
    user.mustChangePassword = false;
    audit(tenant, 'TENANT_USER_PASSWORD_CHANGED', 'TENANT_USER', user.id, null);
    return noContent();
  }, { access: 'session' });

  // ---------------------------------------------------------------- portal users (OWNER only)
  const ROLE_SET = new Set<string>(ALL_ROLES);
  const USERNAME = /^[A-Za-z0-9._-]{3,64}$/;

  function findUser(t: MockTenant, id: string): MockUser {
    const u = t.users.find((x) => x.id === Number(id));
    if (!u) fail(404, 'NOT_FOUND', 'User not found');
    return u;
  }

  const activeOwners = (t: MockTenant) => t.users.filter((u) => u.role === 'OWNER' && u.status === 'ACTIVE');

  function optionalEmail(v: unknown): string | null {
    const e = str(v)?.trim() ?? '';
    if (!e) return null;
    if (!EMAIL.test(e) || e.length > 200) fail(400, 'VALIDATION_ERROR', 'email: enter a valid email address');
    return e;
  }

  function signOutEverywhere(userId: number) {
    for (const [k, v] of db.tokens) if (v.userId === userId) db.tokens.delete(k);
  }

  on('GET', '/users', ({ tenant }) => json(tenant.users.map(userView)), { roles: OWNERS });

  on('POST', '/users', ({ tenant, body }) => {
    const username = str(body.username)?.trim() ?? '';
    if (!USERNAME.test(username)) fail(400, 'VALIDATION_ERROR', 'username: 3 to 64 letters, digits, dots, dashes or underscores');
    const role = str(body.role) ?? '';
    if (!ROLE_SET.has(role)) fail(400, 'VALIDATION_ERROR', 'role: choose OWNER, DEVELOPER, REVIEWER or VIEWER');
    if (findUserByName(username)) fail(409, 'USERNAME_TAKEN', 'This username is already taken');
    const given = str(body.password) ?? '';
    if (given) checkStrong(given);
    const password = given || generated();
    const user: MockUser = {
      id: db.seq.user++,
      username,
      displayName: str(body.displayName)?.trim() || null,
      email: optionalEmail(body.email),
      role: role as TenantUserRole,
      status: 'ACTIVE',
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: nowIso(),
      password,
      failedLogins: 0,
    };
    tenant.users.push(user);
    audit(tenant, 'TENANT_USER_CREATED', 'TENANT_USER', user.id, { username, role });
    return json({ user: userView(user), password }, 201);
  }, { roles: OWNERS });

  on('PUT', '/users/{id}', ({ tenant, user: me, params, body }) => {
    const u = findUser(tenant, params[0]);
    const role = body.role === undefined ? u.role : str(body.role);
    if (!role || !ROLE_SET.has(role)) fail(400, 'VALIDATION_ERROR', 'role: choose OWNER, DEVELOPER, REVIEWER or VIEWER');
    const status = body.status === undefined ? u.status : str(body.status);
    if (status !== 'ACTIVE' && status !== 'DISABLED') fail(400, 'VALIDATION_ERROR', 'status: ACTIVE or DISABLED');
    if (u.id === me.id && (status !== 'ACTIVE' || role !== 'OWNER')) fail(409, 'SELF_LOCKOUT', 'You cannot disable yourself or remove your own owner role');
    const losesOwner = u.role === 'OWNER' && u.status === 'ACTIVE' && (role !== 'OWNER' || status !== 'ACTIVE');
    if (losesOwner && activeOwners(tenant).length <= 1) fail(409, 'LAST_OWNER', 'The tenant must keep at least one active owner');
    const email = body.email === undefined ? u.email : optionalEmail(body.email);
    if (body.displayName !== undefined) u.displayName = str(body.displayName)?.trim() || null;
    u.email = email;
    u.role = role as TenantUserRole;
    u.status = status as TenantUserStatus;
    if (u.status === 'DISABLED') signOutEverywhere(u.id);
    audit(tenant, 'TENANT_USER_UPDATED', 'TENANT_USER', u.id, { role: u.role, status: u.status });
    return json(userView(u));
  }, { roles: OWNERS });

  on('POST', '/users/{id}/reset-password', ({ tenant, params, body }) => {
    const u = findUser(tenant, params[0]);
    const given = str(body.password) ?? '';
    if (given) checkStrong(given);
    const password = given || generated();
    u.password = password;
    u.mustChangePassword = true;
    u.failedLogins = 0;
    signOutEverywhere(u.id);
    audit(tenant, 'TENANT_USER_PASSWORD_RESET', 'TENANT_USER', u.id, null);
    return json({ password });
  }, { roles: OWNERS });

  const tenantFeatureCodes = (t: MockTenant) => [...t.info.flows, ...t.info.features].map((f) => f.code);
  const tenantEnabled = (t: MockTenant, code: string) => [...t.info.flows, ...t.info.features, ...t.info.documentTypes].some((f) => f.code === code && f.enabled);

  function findApp(t: MockTenant, id: string): ClientApp {
    const app = t.apps.find((a) => a.id === Number(id));
    if (!app) fail(404, 'NOT_FOUND', 'App not found');
    return app;
  }

  function findWebhook(t: MockTenant, id: string): Webhook {
    const w = t.webhooks.find((x) => x.id === Number(id));
    if (!w) fail(404, 'NOT_FOUND', 'Webhook not found');
    return w;
  }

  function summary(s: TenantSessionDetail): TenantSessionSummary {
    const { device: _d, steps: _s, document: _doc, decisionDetail: _dd, review: _r, events: _e, enrollFace: _ef, faceRegistered: _fr, ...rest } = s;
    return rest;
  }

  function scanSummary(s: MockTenant['scans'][number]): TenantScanSummary {
    const { id, publicId, docTypeCode, status, confidence, processingMs, errorMessage, createdAt, reviewReasons } = s;
    return { id, publicId, docTypeCode, status, confidence, processingMs, errorMessage, createdAt, reviewReasons: reviewReasons ?? [] };
  }

  /** Sends an event to the tenant's active webhooks that subscribe to it (unreachable URLs fail). */
  function emit(t: MockTenant, eventType: WebhookEvent) {
    for (const w of t.webhooks.filter((x) => x.status === 'ACTIVE' && x.events.includes(eventType))) {
      const bad = unreachable(w.url);
      const d: WebhookDelivery = {
        id: db.seq.delivery++, webhookId: w.id, eventType, eventId: null, attempt: 1, httpStatus: bad ? 502 : 200, status: bad ? 'RETRYING' : 'DELIVERED',
        error: bad ? 'HTTP 502 Bad Gateway' : null, nextRetryAt: bad ? new Date(Date.now() + 30_000).toISOString() : null, createdAt: nowIso(),
      };
      t.deliveries.unshift(d);
      track(w, d);
    }
  }

  /** Last delivery and the failing streak of an endpoint. */
  function track(w: Webhook, d: WebhookDelivery) {
    w.lastDeliveryAt = d.createdAt;
    w.lastStatus = d.status;
    w.consecutiveFailures = d.status === 'DELIVERED' ? 0 : w.consecutiveFailures + 1;
    w.failing = w.consecutiveFailures >= FAILING_AFTER;
  }

  /** Test deliveries fail for URLs that look unreachable, so both outcomes can be tried. */
  function unreachable(url: string) {
    return /fail|invalid|unreachable|:9\d{3}/i.test(url);
  }

  function origins(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) fail(400, 'VALIDATION_ERROR', 'allowedOrigins must be a list of origins');
    const r = validateOrigins(raw as string[]);
    if (!r.ok) fail(400, 'VALIDATION_ERROR', `allowedOrigins[${r.index}]: ${r.error}`);
    return r.origins;
  }

  // ---------------------------------------------------------------- tenant and usage
  on('GET', '/info', ({ tenant }) => json(tenant.info));

  on('GET', '/entitlements', ({ tenant }) => json(tenant.entitlements));

  on('GET', '/dashboard', ({ tenant, query }) => {
    const days = Number(query.get('days') ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 365) fail(400, 'VALIDATION_ERROR', 'days must be between 1 and 365');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const from = start.getTime();
    const sessions = tenant.sessions.filter((s) => Date.parse(s.createdAt) >= from);
    const count = (p: (s: TenantSessionDetail) => boolean) => sessions.filter(p).length;
    const approved = count((s) => s.decision === 'APPROVED');
    const review = count((s) => s.decision === 'REVIEW');
    const rejected = count((s) => s.decision === 'REJECTED');
    const daily: TenantDashboard['daily'] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from + i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const inDay = sessions.filter((s) => {
        const c = new Date(s.createdAt);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth() && c.getDate() === d.getDate();
      });
      daily.push({
        date: key,
        approved: inDay.filter((s) => s.decision === 'APPROVED').length,
        review: inDay.filter((s) => s.decision === 'REVIEW').length,
        rejected: inDay.filter((s) => s.decision === 'REJECTED').length,
        other: inDay.filter((s) => !s.decision).length,
      });
    }
    const reasons = new Map<string, number>();
    for (const s of sessions) for (const st of s.steps) if (st.reasonCode && st.status === 'FAILED') reasons.set(st.reasonCode, (reasons.get(st.reasonCode) ?? 0) + 1);
    const group = <K extends string>(key: (s: TenantSessionDetail) => string | null, name: K) => {
      const m = new Map<string, number>();
      for (const s of sessions) {
        const k = key(s);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ [name]: k, count: c }) as Record<K, string> & { count: number });
    };
    const decided = approved + review + rejected;
    const body: TenantDashboard = {
      days,
      totals: {
        sessions: sessions.length, approved, review, rejected,
        inProgress: count((s) => OPEN_STATUSES.includes(s.status)), expired: count((s) => s.status === 'EXPIRED'), failed: count((s) => s.status === 'FAILED'),
      },
      approvalRate: decided ? approved / decided : null,
      pendingReviews: tenant.sessions.filter((s) => s.review && (s.review.status === 'OPEN' || s.review.status === 'IN_REVIEW')).length,
      scans: tenant.scans.filter((s) => Date.parse(s.createdAt) >= from).length,
      daily,
      topFailureReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, c]) => ({ code, count: c, message: REASON_CODES.find((r) => r.code === code)?.messageEn ?? code })),
      byFlow: group((s) => s.flowCode, 'flowCode'),
      byChannel: group((s) => s.channel, 'channel'),
      byClientApp: group((s) => s.clientAppCode, 'clientAppCode'),
      attention: attention(tenant),
    };
    return json(body);
  });

  function attention(t: MockTenant): TenantDashboard['attention'] {
    const soon = Date.now() + 14 * DAY_MS;
    const today = ymd(Date.now());
    const until = ymd(Date.now() + t.expiryWarningDays * DAY_MS);
    return {
      scansToReview: t.scans.filter((s) => s.status === 'NEEDS_REVIEW').length,
      verificationsToReview: t.reviewOwner === 'TENANT' ? openCases(t).length : 0,
      failingWebhooks: t.webhooks.filter((w) => w.status === 'ACTIVE' && w.failing).map((w) => ({ id: w.id, url: w.url, consecutiveFailures: w.consecutiveFailures, lastDeliveryAt: w.lastDeliveryAt })),
      credentialsExpiring: t.credentials
        .filter((c) => c.status === 'ACTIVE' && c.expiresAt && Date.parse(c.expiresAt) < soon)
        .map((c) => ({ clientAppCode: t.apps.find((a) => a.id === c.clientAppId)?.code ?? '—', keyId: c.keyId, expiresAt: c.expiresAt as string })),
      documentsExpiring: t.documents.filter((d) => d.expiryDate && d.expiryDate >= today && d.expiryDate <= until).length,
      expiryWarningDays: t.expiryWarningDays,
    };
  }

  // ---------------------------------------------------------------- verifications
  on('GET', '/sessions', ({ tenant, query }) => {
    const q = query.get('q')?.trim().toLowerCase();
    const from = validDate(query.get('from'), 'from');
    const to = validDate(query.get('to'), 'to');
    const eq = (k: string, v: string | null) => !query.get(k) || query.get(k) === v;
    const items = tenant.sessions
      .filter((s) => eq('status', s.status) && eq('decision', s.decision) && eq('flowCode', s.flowCode) && eq('channel', s.channel) && eq('clientAppCode', s.clientAppCode))
      .filter((s) => !from || s.createdAt.slice(0, 10) >= from)
      .filter((s) => !to || s.createdAt.slice(0, 10) <= to)
      .filter((s) => {
        if (!q) return true;
        const digits = q.replace(/[^0-9a-z]/g, '');
        return (
          s.publicId.toLowerCase().includes(q) ||
          (s.subjectRef ?? '').toLowerCase().includes(q) ||
          (s.partyName ?? '').toLowerCase().includes(q) ||
          (!!digits && (s.documentNumber ?? '').toLowerCase().replace(/[^0-9a-z]/g, '').includes(digits))
        );
      })
      .map(summary);
    return json(paginate(items, query));
  });

  on('GET', '/sessions/{id}', ({ tenant, params }) => {
    const s = tenant.sessions.find((x) => x.publicId === params[0]);
    if (!s) fail(404, 'NOT_FOUND', 'Verification not found');
    return json(s);
  });

  on('POST', '/sessions/{id}/cancel', ({ tenant, params }) => {
    const s = tenant.sessions.find((x) => x.publicId === params[0]);
    if (!s) fail(404, 'NOT_FOUND', 'Verification not found');
    if (!OPEN_STATUSES.includes(s.status)) fail(409, 'SESSION_CLOSED', 'Only a verification that is still open can be cancelled');
    s.status = 'CANCELLED';
    s.completedAt = nowIso();
    s.events.push({ eventType: 'SESSION_COMPLETED', status: 'DELIVERED', createdAt: s.completedAt });
    audit(tenant, 'SESSION_CANCELLED', 'SESSION', s.publicId, { by: actor });
    return json(s);
  }, { roles: REVIEWERS });

  on('GET', '/document-scans', ({ tenant, query }) => {
    const from = validDate(query.get('from'), 'from');
    const to = validDate(query.get('to'), 'to');
    const status = query.get('status');
    const type = query.get('docTypeCode');
    const items = tenant.scans
      .filter((s) => (!status || s.status === status) && (!type || s.docTypeCode === type))
      .filter((s) => (!from || s.createdAt.slice(0, 10) >= from) && (!to || s.createdAt.slice(0, 10) <= to))
      .map(scanSummary);
    return json(paginate(items, query));
  });

  on('GET', '/document-scans/{id}', ({ tenant, params }) => {
    const s = tenant.scans.find((x) => x.id === Number(params[0]));
    if (!s) fail(404, 'NOT_FOUND', 'Document scan not found');
    return json(s);
  });

  on('POST', '/document-scans/{id}/review', ({ tenant, params, body }) => {
    const s = tenant.scans.find((x) => x.id === Number(params[0]));
    if (!s) fail(404, 'NOT_FOUND', 'Scan not found');
    const decision = str(body.decision)?.toUpperCase();
    if (decision !== 'APPROVE' && decision !== 'REJECT') fail(400, 'VALIDATION_ERROR', 'decision must be APPROVE or REJECT');
    if (s.status !== 'NEEDS_REVIEW') fail(409, 'SCAN_NOT_IN_REVIEW', `Only scans waiting for review can be approved or rejected (this one is ${s.status})`);
    const corrections = isRecord(body.corrections) ? body.corrections : {};
    if (decision === 'APPROVE') {
      for (const [code, raw] of Object.entries(corrections)) {
        const v = str(raw)?.trim() ?? '';
        if (!v) fail(400, 'VALIDATION_ERROR', `${code}: a value is required`);
        if (/^(ID_NUMBER|emiratesIdNumber)$/.test(code) && !validEid(v)) {
          fail(400, 'VALIDATION_ERROR', `${code}: not a valid Emirates ID number (15 digits starting with 784, matching check digit)`);
        }
      }
      const stillInvalid = s.fields.find((f) => f.validationStatus === 'INVALID' && !(f.fieldCode in corrections));
      if (stillInvalid) fail(400, 'VALIDATION_ERROR', `${stillInvalid.fieldCode}: ${stillInvalid.validationMessage ?? 'invalid'}. Correct it before approving`);
      for (const [code, raw] of Object.entries(corrections)) {
        const v = (str(raw) ?? '').trim();
        let f = s.fields.find((x) => x.fieldCode === code);
        if (!f) {
          f = { fieldCode: code, lang: null, value: null, confidence: null, validationStatus: 'MISSING' };
          s.fields.push(f);
        }
        f.ocrValue = f.ocrValue ?? f.value;
        f.reviewedValue = v;
        f.value = v;
      }
    }
    s.status = decision === 'APPROVE' ? 'COMPLETED' : 'REJECTED';
    s.reviewedBy = actor;
    s.reviewedAt = nowIso();
    s.reviewNote = str(body.note)?.trim() || null;
    audit(tenant, 'DOCUMENT_SCAN_REVIEWED', 'document_scan', s.publicId, { decision, correctedFields: Object.keys(corrections) });
    emit(tenant, 'SCAN_REVIEW_DECIDED');
    return json(s);
  }, { roles: REVIEWERS });

  // ---------------------------------------------------------------- scan review settings
  const ocrView = (t: MockTenant) => ({
    settings: t.ocrSettings?.settings ?? OCR_DEFAULTS,
    defaults: OCR_DEFAULTS,
    customized: !!t.ocrSettings,
    updatedAt: t.ocrSettings?.updatedAt ?? null,
    reviewModes: OCR_MODES,
  });

  on('GET', '/document-ocr-settings', ({ tenant }) => json(ocrView(tenant)));

  on('PUT', '/document-ocr-settings', ({ tenant, body }) => {
    const next: DocumentOcrSettings = { ...(tenant.ocrSettings?.settings ?? OCR_DEFAULTS) };
    if (body.reviewMode !== undefined) {
      const m = str(body.reviewMode)?.toUpperCase() as OcrReviewMode | undefined;
      if (!m || !OCR_MODES.includes(m)) fail(400, 'VALIDATION_ERROR', `document.ocr.review_mode: Use ${OCR_MODES.join(', ')}`);
      next.reviewMode = m;
    }
    for (const k of ['autoAcceptConfidence', 'fieldMinConfidence'] as const) {
      if (body[k] === undefined) continue;
      const v = body[k];
      if (typeof v !== 'number' || v < 0 || v > 1) fail(400, 'VALIDATION_ERROR', `${k}: Must be between 0 and 1`);
      next[k] = v;
    }
    if (body.requiredFields !== undefined) {
      const list = body.requiredFields;
      if (!Array.isArray(list) || list.some((f) => typeof f !== 'string' || !/^[A-Za-z][A-Za-z0-9]{1,60}$/.test(f))) {
        fail(400, 'VALIDATION_ERROR', 'document.ocr.required_fields: Use a comma-separated list of field names, e.g. emiratesIdNumber,fullNameEn');
      }
      next.requiredFields = [...new Set(list as string[])];
    }
    if (body.acceptExpired !== undefined) {
      if (typeof body.acceptExpired !== 'boolean') fail(400, 'VALIDATION_ERROR', 'acceptExpired: Use true or false');
      next.acceptExpired = body.acceptExpired;
    }
    tenant.ocrSettings = { settings: next, updatedAt: nowIso() };
    audit(tenant, 'DOCUMENT_OCR_SETTINGS_UPDATED', 'tenant', tenant.info.code, { ...next });
    return json(ocrView(tenant));
  });

  on('DELETE', '/document-ocr-settings', ({ tenant }) => {
    tenant.ocrSettings = null;
    audit(tenant, 'DOCUMENT_OCR_SETTINGS_RESET', 'tenant', tenant.info.code, null);
    return json(ocrView(tenant));
  });

  // ---------------------------------------------------------------- client apps
  on('GET', '/client-apps', ({ tenant }) => json(tenant.apps));

  on('POST', '/client-apps', ({ tenant, body }) => {
    const code = str(body.code)?.trim() ?? '';
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) fail(400, 'VALIDATION_ERROR', 'code: 2-40 upper-case letters, digits and underscores, starting with a letter');
    if (tenant.apps.some((a) => a.code === code)) fail(409, 'CODE_TAKEN', 'An app with this code already exists');
    const name = str(body.name)?.trim() ?? '';
    if (!name) fail(400, 'VALIDATION_ERROR', 'name is required');
    if (name.length > 100) fail(400, 'VALIDATION_ERROR', 'name: at most 100 characters');
    const channel = body.channel;
    if (channel !== 'MOBILE' && channel !== 'WEB') fail(400, 'VALIDATION_ERROR', 'channel must be MOBILE or WEB');
    const app: ClientApp = {
      id: db.seq.app++, code, name, channel, platform: str(body.platform)?.trim() || null, appIdentifier: str(body.appIdentifier)?.trim() || null,
      allowedOrigins: origins(body.allowedOrigins), status: 'ACTIVE',
      permissions: tenantFeatureCodes(tenant).map((featureCode) => ({ featureCode, allowed: tenantEnabled(tenant, featureCode) && !(channel === 'WEB' && featureCode === 'DEVICE_ANTISPOOF') })),
      credentialsCount: 0, createdAt: nowIso(),
    };
    tenant.apps.push(app);
    audit(tenant, 'CLIENT_APP_CREATED', 'CLIENT_APP', app.id, { code, channel });
    return json(app, 201);
  });

  on('PUT', '/client-apps/{id}', ({ tenant, params, body }) => {
    const app = findApp(tenant, params[0]);
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = str(body.name)?.trim() ?? '';
      if (!name) fail(400, 'VALIDATION_ERROR', 'name is required');
      app.name = name;
      changes.name = name;
    }
    if (body.platform !== undefined) app.platform = str(body.platform)?.trim() || null;
    if (body.appIdentifier !== undefined) app.appIdentifier = str(body.appIdentifier)?.trim() || null;
    if (body.allowedOrigins !== undefined) {
      app.allowedOrigins = origins(body.allowedOrigins);
      changes.allowedOrigins = app.allowedOrigins;
    }
    if (body.status !== undefined) {
      if (body.status !== 'ACTIVE' && body.status !== 'DISABLED') fail(400, 'VALIDATION_ERROR', 'status must be ACTIVE or DISABLED');
      if (app.status !== body.status) changes.status = { from: app.status, to: body.status };
      app.status = body.status;
    }
    audit(tenant, 'CLIENT_APP_UPDATED', 'CLIENT_APP', app.id, changes);
    return json(app);
  });

  on('PUT', '/client-apps/{id}/permissions', ({ tenant, params, rawBody }) => {
    const app = findApp(tenant, params[0]);
    if (!Array.isArray(rawBody)) fail(400, 'VALIDATION_ERROR', 'Send a list of { featureCode, allowed }');
    const list: Permission[] = [];
    for (const p of rawBody as unknown[]) {
      if (!isRecord(p) || typeof p.featureCode !== 'string' || typeof p.allowed !== 'boolean') fail(400, 'VALIDATION_ERROR', 'Each permission needs featureCode and allowed');
      if (!tenantFeatureCodes(tenant).includes(p.featureCode)) fail(400, 'VALIDATION_ERROR', `${p.featureCode} is not a feature of your tenant`);
      if (p.allowed && !tenantEnabled(tenant, p.featureCode)) fail(400, 'VALIDATION_ERROR', `${p.featureCode} is not enabled for your tenant, so an app can't be allowed to use it`);
      list.push({ featureCode: p.featureCode, allowed: p.allowed });
    }
    app.permissions = tenantFeatureCodes(tenant).map((c) => list.find((p) => p.featureCode === c) ?? app.permissions.find((p) => p.featureCode === c) ?? { featureCode: c, allowed: false });
    audit(tenant, 'CLIENT_APP_PERMISSIONS_UPDATED', 'CLIENT_APP', app.id, Object.fromEntries(list.map((p) => [p.featureCode, p.allowed])));
    return json(app);
  });

  function livenessCaps(t: MockTenant, code: string) {
    const l = flowLiveness(t, code);
    return { livenessChallengeRequired: l.mode === 'ACTIVE', livenessMode: l.mode, challengeActions: l.actions, challengeCount: l.challengeCount };
  }

  on('GET', '/client-apps/{id}/capabilities', ({ tenant, params }) => {
    const app = findApp(tenant, params[0]);
    const allowed = (c: string) => app.status === 'ACTIVE' && tenantEnabled(tenant, c) && !!app.permissions.find((p) => p.featureCode === c)?.allowed;
    const docs = tenant.info.documentTypes.filter((d) => d.enabled && d.code !== 'TRADE_LICENCE').map((d) => d.code);
    const ent = (c: string) => tenant.entitlements.find((e) => e.featureCode === c);
    const dedupStep = allowed('DEDUP_SEARCH') && tenant.dedupEnabled ? ['DEDUP_SEARCH'] : [];
    const flowSteps: Record<string, string[]> = {
      SELFIE_ID_VERIFICATION: ['LIVENESS', 'DOC_CAPTURE', 'DOC_VALIDATION', 'FACE_DOC_MATCH', ...dedupStep],
      FACE_AUTHENTICATION: ['LIVENESS', 'FACE_TEMPLATE_MATCH'],
      LIVENESS_CHECK: ['LIVENESS'],
      FACE_ENROLLMENT: ['LIVENESS', ...dedupStep],
      DOCUMENT_SCAN: ['DOC_CAPTURE', 'DOC_VALIDATION'],
    };
    const flows: FlowCapability[] = tenant.info.flows
      .filter((f) => allowed(f.code))
      .map((f) => {
        const e = ent(f.code);
        const perDay = e?.quotaPerDay ?? null;
        return {
          code: f.code,
          documents: f.code === 'SELFIE_ID_VERIFICATION' ? docs : f.code === 'DOCUMENT_SCAN' ? tenant.info.documentTypes.filter((d) => d.enabled).map((d) => d.code) : [],
          steps: flowSteps[f.code] ?? [],
          settings: {
            livenessMaxAttempts: SELFIE_ONLY_FLOWS.includes(f.code) ? 1 : 5,
            documentMaxAttempts: 3,
            sessionTtlMinutes: 15,
            deviceAntispoofRequired: app.channel === 'MOBILE' && allowed('DEVICE_ANTISPOOF'),
            fileUploadAllowed: allowed('FILE_UPLOAD'),
            ...(f.code in tenant.liveness ? livenessCaps(tenant, f.code) : {}),
            ...(f.code === 'SELFIE_ID_VERIFICATION' ? { faceEnrollmentAvailable: allowed('FACE_ENROLLMENT') } : {}),
          },
          quota: { perDay, remainingToday: perDay === null ? null : Math.max(0, perDay - (e?.usedToday ?? 0)) },
        };
      });
    const caps: Capabilities = {
      tenant: tenant.info.code,
      clientApp: app.code,
      channel: app.channel,
      flows,
      features: tenant.info.features.filter((f) => allowed(f.code)).map((f) => f.code).sort(),
      locales: ['en', 'ar'],
    };
    return json(caps);
  });

  on('GET', '/client-apps/{id}/credentials', ({ tenant, params }) => {
    const app = findApp(tenant, params[0]);
    return json(tenant.credentials.filter((c) => c.clientAppId === app.id).map(({ clientAppId: _a, ...c }) => c).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  on('POST', '/client-apps/{id}/credentials', ({ tenant, params, body }) => {
    const app = findApp(tenant, params[0]);
    const expiresAt = str(body.expiresAt);
    if (expiresAt !== null) {
      const t = Date.parse(expiresAt);
      if (Number.isNaN(t)) fail(400, 'VALIDATION_ERROR', 'expiresAt must be an ISO date-time');
      if (t <= Date.now()) fail(400, 'VALIDATION_ERROR', 'expiresAt must be in the future');
    }
    const cred = { id: db.seq.credential++, clientAppId: app.id, keyId: `ck_${randHex(20)}`, status: 'ACTIVE' as const, createdAt: nowIso(), expiresAt, lastUsedAt: null };
    tenant.credentials.push(cred);
    app.credentialsCount = tenant.credentials.filter((c) => c.clientAppId === app.id).length;
    audit(tenant, 'CREDENTIAL_CREATED', 'CREDENTIAL', cred.id, { keyId: cred.keyId, clientAppCode: app.code, expiresAt });
    const { clientAppId: _a, ...credential } = cred;
    return json({ credential, secret: `cs_${randHex(48)}` }, 201);
  });

  on('POST', '/credentials/{id}/revoke', ({ tenant, params }) => {
    const c = tenant.credentials.find((x) => x.id === Number(params[0]));
    if (!c) fail(404, 'NOT_FOUND', 'API key not found');
    if (c.status === 'REVOKED') fail(409, 'ALREADY_REVOKED', 'This API key is already revoked');
    c.status = 'REVOKED';
    audit(tenant, 'CREDENTIAL_REVOKED', 'CREDENTIAL', c.id, { keyId: c.keyId });
    const { clientAppId: _a, ...rest } = c;
    return json(rest);
  });

  // ---------------------------------------------------------------- webhooks
  function webhookBody(body: Body, partial: boolean): { url?: string; events?: WebhookEvent[]; status?: Webhook['status'] } {
    const out: { url?: string; events?: WebhookEvent[]; status?: Webhook['status'] } = {};
    if (!partial || body.url !== undefined) out.url = httpUrl(body.url, 'url', true) ?? undefined;
    if (!partial || body.events !== undefined) {
      const ev = body.events;
      if (!Array.isArray(ev) || ev.length === 0) fail(400, 'VALIDATION_ERROR', 'Pick at least one event');
      for (const e of ev) if (!WEBHOOK_EVENTS.includes(e as WebhookEvent)) fail(400, 'VALIDATION_ERROR', `Unknown event ${String(e)}`);
      out.events = [...new Set(ev as WebhookEvent[])];
    }
    if (body.status !== undefined) {
      if (body.status !== 'ACTIVE' && body.status !== 'DISABLED') fail(400, 'VALIDATION_ERROR', 'status must be ACTIVE or DISABLED');
      out.status = body.status;
    }
    return out;
  }

  on('GET', '/webhooks', ({ tenant }) => json(tenant.webhooks));

  on('POST', '/webhooks', ({ tenant, body }) => {
    if (!tenantEnabled(tenant, 'WEBHOOKS')) fail(403, 'FEATURE_NOT_ENABLED', 'Webhooks are not enabled for your tenant');
    const v = webhookBody(body, false);
    const w: Webhook = {
      id: db.seq.webhook++, url: v.url ?? '', events: v.events ?? [], status: v.status ?? 'ACTIVE', createdAt: nowIso(), lastDeliveryAt: null, lastStatus: null,
      consecutiveFailures: 0, failing: false,
    };
    tenant.webhooks.push(w);
    audit(tenant, 'WEBHOOK_CREATED', 'WEBHOOK', w.id, { url: w.url, events: w.events });
    return json({ webhook: w, secret: `whsec_${randHex(40)}` }, 201);
  });

  on('PUT', '/webhooks/{id}', ({ tenant, params, body }) => {
    const w = findWebhook(tenant, params[0]);
    const v = webhookBody(body, true);
    Object.assign(w, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)));
    audit(tenant, 'WEBHOOK_UPDATED', 'WEBHOOK', w.id, v);
    return json(w);
  });

  on('DELETE', '/webhooks/{id}', ({ tenant, params }) => {
    const w = findWebhook(tenant, params[0]);
    tenant.webhooks = tenant.webhooks.filter((x) => x.id !== w.id);
    audit(tenant, 'WEBHOOK_DELETED', 'WEBHOOK', w.id, { url: w.url });
    return noContent();
  });

  on('POST', '/webhooks/{id}/rotate-secret', ({ tenant, params }) => {
    const w = findWebhook(tenant, params[0]);
    audit(tenant, 'WEBHOOK_SECRET_ROTATED', 'WEBHOOK', w.id, null);
    return json({ webhook: w, secret: `whsec_${randHex(40)}` });
  });

  on('POST', '/webhooks/{id}/test', ({ tenant, params }) => {
    const w = findWebhook(tenant, params[0]);
    const bad = unreachable(w.url);
    const d: WebhookDelivery = {
      id: db.seq.delivery++, webhookId: w.id, eventType: 'TEST', eventId: null, attempt: 1, httpStatus: bad ? 502 : 200, status: bad ? 'FAILED' : 'DELIVERED',
      error: bad ? 'HTTP 502 Bad Gateway' : null, nextRetryAt: null, createdAt: nowIso(),
    };
    tenant.deliveries.unshift(d);
    track(w, d);
    audit(tenant, 'WEBHOOK_TESTED', 'WEBHOOK', w.id, { status: d.status, httpStatus: d.httpStatus });
    return json(d);
  });

  on('GET', '/webhooks/{id}/deliveries', ({ tenant, params, query }) => {
    const w = findWebhook(tenant, params[0]);
    const status = query.get('status');
    return json(paginate(tenant.deliveries.filter((d) => d.webhookId === w.id && (!status || d.status === status)), query));
  });

  on('POST', '/webhook-deliveries/{id}/retry', ({ tenant, params }) => {
    const d = tenant.deliveries.find((x) => x.id === Number(params[0]));
    if (!d) fail(404, 'NOT_FOUND', 'Delivery not found');
    if (d.status === 'DELIVERED') fail(409, 'ALREADY_DELIVERED', 'This delivery already succeeded');
    const w = tenant.webhooks.find((x) => x.id === d.webhookId);
    const bad = !w || unreachable(w.url) || w.status !== 'ACTIVE';
    d.attempt += 1;
    d.status = bad ? 'FAILED' : 'DELIVERED';
    d.httpStatus = bad ? 502 : 200;
    d.error = bad ? (w?.status !== 'ACTIVE' ? 'The webhook is disabled' : 'HTTP 502 Bad Gateway') : null;
    d.nextRetryAt = null;
    if (w) track(w, { ...d, createdAt: nowIso() });
    audit(tenant, 'WEBHOOK_DELIVERY_RETRIED', 'WEBHOOK_DELIVERY', d.id, { status: d.status });
    return json(d);
  });

  // ---------------------------------------------------------------- branding
  const brandingOf = (t: MockTenant): Branding => t.branding ?? defaultBranding(t.info.code, t.info.name);

  on('GET', '/branding', ({ tenant }) => json(brandingOf(tenant)));

  on('PUT', '/branding', ({ tenant, body }) => {
    const b = body as Partial<BrandingUpdate>;
    const displayName = str(b.displayName)?.trim() ?? '';
    if (!displayName) fail(400, 'VALIDATION_ERROR', 'displayName is required');
    if (displayName.length > 60) fail(400, 'VALIDATION_ERROR', 'displayName: at most 60 characters');
    for (const k of ['primaryColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor'] as const) {
      if (typeof b[k] !== 'string' || !HEX.test(b[k])) fail(400, 'VALIDATION_ERROR', `${k} must be a hex colour like #4f46e5`);
    }
    if (typeof b.borderRadius !== 'number' || !Number.isInteger(b.borderRadius) || b.borderRadius < 0 || b.borderRadius > 24) fail(400, 'VALIDATION_ERROR', 'borderRadius must be 0 to 24');
    if (typeof b.fontFamily !== 'string' || !ALLOWED_FONTS.includes(b.fontFamily)) fail(400, 'VALIDATION_ERROR', `fontFamily must be one of ${ALLOWED_FONTS.join(', ')}`);
    if (b.themeMode !== 'LIGHT' && b.themeMode !== 'DARK' && b.themeMode !== 'AUTO') fail(400, 'VALIDATION_ERROR', 'themeMode must be LIGHT, DARK or AUTO');
    const logo = b.logoDataUrl ?? null;
    if (logo !== null) {
      if (typeof logo !== 'string' || !/^data:image\/(png|jpeg|svg\+xml)[;,]/.test(logo)) fail(400, 'VALIDATION_ERROR', 'logoDataUrl must be a PNG, JPEG or SVG data URL');
      if (logo.length > 300 * 1024) fail(400, 'VALIDATION_ERROR', 'The logo is larger than 300 KB');
    }
    const email = str(b.supportEmail)?.trim() || null;
    if (email && !EMAIL.test(email)) fail(400, 'VALIDATION_ERROR', 'supportEmail is not a valid e-mail address');
    const texts: Branding['texts'] = {};
    if (b.texts !== undefined && !isRecord(b.texts)) fail(400, 'VALIDATION_ERROR', 'texts must be an object');
    for (const lang of ['en', 'ar'] as const) {
      const tx = isRecord(b.texts) ? b.texts[lang] : undefined;
      if (!isRecord(tx)) continue;
      const clean = (k: string, max: number) => {
        const v = str(tx[k])?.trim() || null;
        if (v && v.length > max) fail(400, 'VALIDATION_ERROR', `texts.${lang}.${k}: at most ${max} characters`);
        return v;
      };
      texts[lang] = { welcomeTitle: clean('welcomeTitle', 80), welcomeBody: clean('welcomeBody', 400), doneTitle: clean('doneTitle', 80), doneBody: clean('doneBody', 400) };
    }
    const before = brandingOf(tenant);
    const next: Branding = {
      tenant: tenant.info.code, displayName, logoDataUrl: logo, primaryColor: b.primaryColor as string, accentColor: b.accentColor as string,
      backgroundColor: b.backgroundColor as string, surfaceColor: b.surfaceColor as string, textColor: b.textColor as string, borderRadius: b.borderRadius,
      fontFamily: b.fontFamily, themeMode: b.themeMode, supportEmail: email, supportUrl: httpUrl(b.supportUrl, 'supportUrl'), privacyUrl: httpUrl(b.privacyUrl, 'privacyUrl'),
      showPoweredBy: b.showPoweredBy !== false, texts, updatedAt: nowIso(),
    };
    const changed = (Object.keys(next) as (keyof Branding)[]).filter((k) => k !== 'updatedAt' && JSON.stringify(next[k]) !== JSON.stringify(before[k]));
    tenant.branding = next;
    audit(tenant, 'BRANDING_UPDATED', 'BRANDING', tenant.info.code, { fields: changed });
    return json(next);
  });

  on('DELETE', '/branding', ({ tenant }) => {
    tenant.branding = null;
    audit(tenant, 'BRANDING_RESET', 'BRANDING', tenant.info.code, null);
    return noContent();
  });

  // ---------------------------------------------------------------- liveness settings per flow
  function flowLiveness(t: MockTenant, code: string): TenantFlowLiveness {
    const l = t.liveness[code];
    const settings = l.settings ?? defaultSettings(l.policy, code);
    return {
      flowCode: code, flowName: t.info.flows.find((f) => f.code === code)?.name ?? code, ...structuredClone(settings),
      policy: structuredClone(l.policy), customized: l.settings !== null, updatedAt: l.updatedAt,
    };
  }

  /** Liveness flows the tenant is entitled to. */
  const livenessFlows = (t: MockTenant) => t.info.flows.filter((f) => f.enabled && f.code in t.liveness).map((f) => f.code);

  on('GET', '/flows', ({ tenant }) => json(livenessFlows(tenant).map((c) => flowLiveness(tenant, c))));

  on('PUT', '/flows/{code}/liveness', ({ tenant, params, body }) => {
    const code = params[0];
    if (!livenessFlows(tenant).includes(code)) fail(404, 'NOT_FOUND', 'This flow has no liveness settings for your tenant');
    const mode = body.mode;
    if (mode !== 'ACTIVE' && mode !== 'PASSIVE') fail(400, 'VALIDATION_ERROR', 'mode must be ACTIVE or PASSIVE');
    const actions = body.actions;
    if (!Array.isArray(actions) || actions.some((a) => !CHALLENGE_ACTIONS.includes(a as ChallengeAction))) {
      fail(400, 'VALIDATION_ERROR', `actions must be a list of ${CHALLENGE_ACTIONS.join(', ')}`);
    }
    const count = body.challengeCount;
    if (typeof count !== 'number' || !Number.isInteger(count)) fail(400, 'VALIDATION_ERROR', 'challengeCount must be a whole number');
    const settings: LivenessSettings = { mode: mode as LivenessMode, actions: actions as ChallengeAction[], challengeCount: count };
    const l = tenant.liveness[code];
    const issue = validateLiveness(code, settings, l.policy);
    if (issue) fail(400, issue.code, issue.message);
    l.settings = settings;
    l.updatedAt = nowIso();
    audit(tenant, 'LIVENESS_SETTINGS_UPDATED', 'FLOW', code, { ...settings });
    return json(flowLiveness(tenant, code));
  });

  // ---------------------------------------------------------------- documents, images and people
  function documentSummary(d: MockDocument) {
    const { fields: _f, mediaIds: _m, scanIds: _s, ...rest } = d;
    return rest;
  }

  function documentDetail(t: MockTenant, d: MockDocument): DocumentDetail {
    return {
      ...documentSummary(d),
      fields: d.fields,
      media: d.mediaIds.map((id) => db.media.get(id)).filter((m) => !!m).map(mediaRef),
      scans: d.scanIds.map((id) => t.scans.find((s) => s.id === id)).filter((s) => !!s).map(scanSummary),
    };
  }

  function findDocument(t: MockTenant, id: string): MockDocument {
    const d = t.documents.find((x) => x.id === Number(id));
    if (!d) fail(404, 'NOT_FOUND', 'Document not found');
    return d;
  }

  on('GET', '/documents', ({ tenant, query }) => {
    const q = query.get('q')?.trim().toLowerCase();
    const type = query.get('docTypeCode');
    const status = query.get('status');
    const before = validDate(query.get('expiringBefore'), 'expiringBefore');
    const items = tenant.documents
      .filter((d) => (!type || d.docTypeCode === type) && (!status || d.status === status))
      .filter((d) => !before || (!!d.expiryDate && d.expiryDate < before))
      .filter((d) => !q || (d.documentNumber ?? '').toLowerCase().includes(q) || (d.partyName ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(documentSummary);
    return json(paginate(items, query));
  });

  on('GET', '/documents/{id}', ({ tenant, params }) => json(documentDetail(tenant, findDocument(tenant, params[0]))));

  const image = (svg: string, mimeType: string) => new Response(svg, { status: 200, headers: { 'Content-Type': mimeType, 'Cache-Control': 'private, no-store' } });

  /** Document images only: selfies and face crops are never served here. */
  on('GET', '/media/{id}', ({ tenant, params }) => {
    const m = db.media.get(Number(params[0]));
    if (!m || m.tenantCode !== tenant.info.code || m.kind !== 'DOCUMENT') fail(404, 'NOT_FOUND', 'Image not found');
    return image(m.svg, m.mimeType);
  });

  const partySessions = (t: MockTenant, p: MockParty) => (p.subjectRef ? t.sessions.filter((s) => s.subjectRef === p.subjectRef) : []);

  function partySummary(t: MockTenant, p: MockParty): PartySummary {
    const sessions = partySessions(t, p);
    return {
      id: p.id, publicId: p.publicId, partyType: p.partyType, externalRef: p.subjectRef, status: p.status, displayName: p.displayName, nationality: p.nationality,
      dateOfBirth: p.dateOfBirth, documentsCount: t.documents.filter((d) => d.partyId === p.id).length, sessionsCount: sessions.length,
      lastVerifiedAt: sessions.find((s) => s.decision === 'APPROVED')?.completedAt ?? null, createdAt: p.createdAt,
    };
  }

  function partyDetail(t: MockTenant, p: MockParty): PartyDetail {
    const { externalRef: _e, ...sum } = partySummary(t, p);
    return {
      ...sum, subjectRef: p.subjectRef, person: p.person, organization: p.organization,
      documents: t.documents.filter((d) => d.partyId === p.id).map(documentSummary),
      faceTemplates: p.faceTemplates,
      sessions: partySessions(t, p).map(summary),
    };
  }

  function findParty(t: MockTenant, id: string): MockParty {
    const p = t.parties.find((x) => x.id === Number(id));
    if (!p) fail(404, 'NOT_FOUND', 'Person not found');
    return p;
  }

  on('GET', '/parties', ({ tenant, query }) => {
    const q = query.get('q')?.trim().toLowerCase();
    const type = query.get('partyType');
    const items = tenant.parties
      .filter((p) => !type || p.partyType === type)
      .filter((p) => {
        if (!q) return true;
        const docs = tenant.documents.filter((d) => d.partyId === p.id);
        return [p.subjectRef, p.displayName, p.publicId, ...docs.map((d) => d.documentNumber)].some((v) => (v ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => partySummary(tenant, p));
    return json(paginate(items, query));
  });

  on('GET', '/parties/{id}', ({ tenant, params }) => json(partyDetail(tenant, findParty(tenant, params[0]))));

  on('DELETE', '/parties/{id}', ({ tenant, params }) => {
    const p = findParty(tenant, params[0]);
    const sessionIds = new Set(partySessions(tenant, p).map((s) => s.publicId));
    for (const d of tenant.documents.filter((x) => x.partyId === p.id)) {
      for (const id of d.mediaIds) db.media.delete(id);
      for (const s of tenant.scans) if (s.documentId === d.id) s.documentId = null;
    }
    tenant.documents = tenant.documents.filter((d) => d.partyId !== p.id);
    tenant.reviewCases = tenant.reviewCases.filter((c) => !sessionIds.has(c.sessionPublicId));
    tenant.sessions = tenant.sessions.filter((s) => !sessionIds.has(s.publicId));
    tenant.parties = tenant.parties.filter((x) => x.id !== p.id);
    // An anonymised audit row: no name, no reference.
    audit(tenant, 'PARTY_ERASED', 'party', p.publicId, { verifications: sessionIds.size });
    emit(tenant, 'PARTY_ERASED');
    return noContent();
  }, { roles: OWNERS });

  on('POST', '/parties/{id}/face-templates/{templateId}/revoke', ({ tenant, params }) => {
    const p = findParty(tenant, params[0]);
    const tpl = p.faceTemplates.find((x) => x.id === Number(params[1]));
    if (!tpl) fail(404, 'NOT_FOUND', 'Face template not found');
    tpl.status = 'REVOKED';
    audit(tenant, 'FACE_TEMPLATE_REVOKED', 'face_template', tpl.id, { partyId: p.id });
    return noContent();
  }, { roles: OWNERS });

  on('GET', '/parties/{id}/export', ({ tenant, params }) => {
    const p = findParty(tenant, params[0]);
    const person = partyDetail(tenant, p);
    const documents = tenant.documents.filter((d) => d.partyId === p.id);
    const sessions = partySessions(tenant, p);
    const ids = new Set([p.publicId, String(p.id), ...sessions.map((s) => s.publicId), ...documents.map((d) => String(d.id))]);
    const auditEvents = tenant.audit
      .filter((a) => a.entityId !== null && ids.has(a.entityId))
      .map((a) => ({ ...a, actor: a.actorType === 'ADMIN' ? 'camtech' : a.actor, ipAddress: null }))
      .reverse();
    const payload = { exportedAt: nowIso(), tenant: tenant.info.code, person, verifications: sessions, documents: documents.map((d) => documentDetail(tenant, d)), auditEvents };
    const files: { name: string; data: string }[] = [{ name: 'person.json', data: JSON.stringify(payload, null, 2) }];
    for (const d of documents) {
      for (const id of d.mediaIds) {
        const m = db.media.get(id);
        if (m) files.push({ name: `documents/${d.id}/${m.role}-${m.id}.svg`, data: m.svg });
      }
    }
    audit(tenant, 'PARTY_EXPORTED', 'party', p.publicId, { verifications: sessions.length, documents: documents.length, images: files.length - 1 });
    return new Response(zip(files), {
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="person-${p.publicId}.zip"`, 'Cache-Control': 'no-store' },
    });
  }, { roles: OWNERS });

  // ---------------------------------------------------------------- reviews
  const CLOSED = ['APPROVED', 'REJECTED'];
  function openCases(t: MockTenant): MockReviewCase[] {
    return t.reviewCases.filter((c) => !CLOSED.includes(c.status));
  }

  /** Tenant users keep their name; camtech operators show as "camtech". */
  function masker(t: MockTenant) {
    const people = new Set(t.users.map((u) => u.username));
    return { people, mask: (who: string | null) => (who === null ? null : people.has(who) ? who : 'camtech') };
  }

  function caseSummary(t: MockTenant, c: MockReviewCase): ReviewCaseSummary {
    const s = t.sessions.find((x) => x.publicId === c.sessionPublicId);
    return {
      id: c.id, sessionPublicId: c.sessionPublicId, status: c.status, reason: withoutScore(c.reason), matchLabel: c.matchLabel, assignedTo: masker(t).mask(c.assignedTo),
      partyName: s?.partyName ?? null, documentType: s?.documentType ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
  }

  function caseDetail(t: MockTenant, c: MockReviewCase): ReviewCaseDetail {
    const { people, mask } = masker(t);
    const session = t.sessions.find((x) => x.publicId === c.sessionPublicId) as TenantSessionDetail;
    const canDecide = !CLOSED.includes(c.status) && t.reviewOwner === 'TENANT';
    return {
      ...caseSummary(t, c),
      canDecide,
      evidence: canDecide ? c.evidence : [],
      session,
      actions: c.actions.map((a) => ({
        ...a,
        actor: a.actor === 'system' ? 'system' : (mask(a.actor) as string),
        // camtech operators' notes stay internal
        note: people.has(a.actor) ? a.note : a.actor === 'system' ? withoutScore(a.note) : null,
      })),
    };
  }

  function findCase(t: MockTenant, id: string): MockReviewCase {
    const c = t.reviewCases.find((x) => x.id === Number(id));
    if (!c) fail(404, 'NOT_FOUND', 'Review case not found');
    return c;
  }

  /** A case the tenant may work on: it reviews its own verifications (and, for assign/decide, the case is open). */
  function workable(t: MockTenant, id: string, mustBeOpen: boolean): MockReviewCase {
    const c = findCase(t, id);
    if (t.reviewOwner !== 'TENANT') fail(409, 'REVIEW_OWNED_BY_CAMTECH', "camtech reviews this tenant's verifications");
    if (mustBeOpen && CLOSED.includes(c.status)) fail(409, 'REVIEW_CLOSED', 'This case was already decided');
    return c;
  }

  function addAction(c: MockReviewCase, action: string, note: string | null) {
    const at = nowIso();
    c.actions.push({ id: db.seq.reviewAction++, action, actor, note, createdAt: at });
    c.updatedAt = at;
  }

  const DEDUP_FLOWS = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT'];
  const duplicateSearch = (t: MockTenant) => ({
    available: tenantEnabled(t, 'DEDUP_SEARCH'),
    enabled: t.dedupEnabled,
    flows: t.info.flows.filter((f) => f.enabled && DEDUP_FLOWS.includes(f.code)).map((f) => f.code),
  });

  on('GET', '/duplicate-search', ({ tenant }) => json(duplicateSearch(tenant)));

  on('PUT', '/duplicate-search', ({ tenant, body }) => {
    if (!tenantEnabled(tenant, 'DEDUP_SEARCH')) fail(403, 'FEATURE_NOT_ENABLED', 'This feature is not enabled: DEDUP_SEARCH');
    if (typeof body.enabled !== 'boolean') fail(400, 'VALIDATION_ERROR', 'enabled is required');
    const before = tenant.dedupEnabled;
    tenant.dedupEnabled = body.enabled as boolean;
    audit(tenant, 'DUPLICATE_SEARCH_UPDATED', 'tenant', tenant.info.code, { from: before, to: tenant.dedupEnabled });
    return json(duplicateSearch(tenant));
  });

  on('GET', '/review-settings', ({ tenant }) => json({ owner: tenant.reviewOwner, owners: REVIEW_OWNERS }));

  on('PUT', '/review-settings', ({ tenant, body }) => {
    const owner = str(body.owner)?.trim().toUpperCase() as ReviewOwner | undefined;
    if (!owner || !REVIEW_OWNERS.includes(owner)) fail(400, 'VALIDATION_ERROR', `owner: use ${REVIEW_OWNERS.join(' or ')}`);
    const before = tenant.reviewOwner;
    tenant.reviewOwner = owner;
    audit(tenant, 'REVIEW_OWNER_CHANGED', 'tenant', tenant.info.code, { from: before, to: owner });
    return json({ owner, owners: REVIEW_OWNERS });
  }, { roles: OWNERS });

  on('GET', '/reviews/summary', ({ tenant }) =>
    json({ owner: tenant.reviewOwner, scansToReview: tenant.scans.filter((s) => s.status === 'NEEDS_REVIEW').length, verificationsToReview: openCases(tenant).length }),
  );

  on('GET', '/review-cases', ({ tenant, user, query }) => {
    const status = query.get('status');
    const mine = query.get('mine') === 'true';
    const items = tenant.reviewCases
      .filter((c) => (!status || c.status === status) && (!mine || c.assignedTo === user.username))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => caseSummary(tenant, c));
    return json(paginate(items, query));
  });

  on('GET', '/review-cases/{id}', ({ tenant, params }) => json(caseDetail(tenant, findCase(tenant, params[0]))));

  on('POST', '/review-cases/{id}/assign', ({ tenant, params, body }) => {
    const c = workable(tenant, params[0], true);
    const given = str(body.assignee)?.trim();
    if (given && !tenant.users.some((u) => u.username === given)) fail(400, 'VALIDATION_ERROR', 'Assign the case to one of your users');
    const assignee = given || actor;
    c.assignedTo = assignee;
    c.status = 'IN_REVIEW';
    addAction(c, 'ASSIGNED', `Assigned to ${assignee}`);
    audit(tenant, 'REVIEW_ASSIGNED', 'review_case', c.id, { assignee });
    return json(caseDetail(tenant, c));
  }, { roles: REVIEWERS });

  on('POST', '/review-cases/{id}/comment', ({ tenant, params, body }) => {
    const c = workable(tenant, params[0], false);
    const note = str(body.note)?.trim() ?? '';
    if (!note) fail(400, 'VALIDATION_ERROR', 'note is required');
    addAction(c, 'COMMENTED', note.slice(0, 2000));
    return json(caseDetail(tenant, c));
  }, { roles: REVIEWERS });

  on('POST', '/review-cases/{id}/decide', ({ tenant, params, body }) => {
    const c = workable(tenant, params[0], true);
    const decision = str(body.decision)?.toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') fail(400, 'VALIDATION_ERROR', 'decision must be APPROVED or REJECTED');
    const note = str(body.note)?.trim() ?? '';
    if (!note) fail(400, 'VALIDATION_ERROR', 'note is required');
    const at = nowIso();
    c.status = decision;
    if (!c.assignedTo) c.assignedTo = actor;
    addAction(c, decision, note.slice(0, 2000));
    const s = tenant.sessions.find((x) => x.publicId === c.sessionPublicId);
    if (s) {
      s.decision = decision;
      s.status = 'COMPLETED';
      s.completedAt = s.completedAt ?? at;
      s.decisionDetail = { decision, decidedBy: 'REVIEWER', reason: null, decidedAt: at };
      if (s.review) s.review = { ...s.review, status: decision, decidedAt: at };
      if (decision === 'APPROVED' && s.enrollFace) s.faceRegistered = true;
      s.events.push({ eventType: 'REVIEW_DECIDED', status: 'DELIVERED', createdAt: at });
    }
    audit(tenant, 'REVIEW_DECIDED', 'review_case', c.id, { decision });
    emit(tenant, 'REVIEW_DECIDED');
    return json(caseDetail(tenant, c));
  }, { roles: REVIEWERS });

  /** The selfie or document image of an open case the tenant reviews; nothing else of the session. */
  on('GET', '/review-cases/{id}/media/{mediaId}', ({ tenant, params }) => {
    const c = findCase(tenant, params[0]);
    const mediaId = Number(params[1]);
    const m = db.media.get(mediaId);
    if (CLOSED.includes(c.status) || tenant.reviewOwner !== 'TENANT' || !c.evidence.some((e) => e.mediaId === mediaId) || !m) fail(404, 'NOT_FOUND', 'Image not found');
    return image(m.svg, m.mimeType);
  }, { roles: REVIEWERS });

  // ---------------------------------------------------------------- settings
  const DOC_SETTINGS = { defaultExpiryWarningDays: 30, min: 1, max: 365 };
  on('GET', '/document-settings', ({ tenant }) => json({ expiryWarningDays: tenant.expiryWarningDays, ...DOC_SETTINGS }));

  on('PUT', '/document-settings', ({ tenant, body }) => {
    const v = body.expiryWarningDays;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < DOC_SETTINGS.min || v > DOC_SETTINGS.max) {
      fail(400, 'VALIDATION_ERROR', `document.expiry_warning_days: Must be between ${DOC_SETTINGS.min} and ${DOC_SETTINGS.max}`);
    }
    tenant.expiryWarningDays = v;
    audit(tenant, 'DOCUMENT_SETTINGS_UPDATED', 'tenant', tenant.info.code, { expiryWarningDays: String(v) });
    return json({ expiryWarningDays: v, ...DOC_SETTINGS });
  });

  on('GET', '/retention-policies', ({ tenant }) => json(tenant.retention));

  // ---------------------------------------------------------------- audit and reference
  on('GET', '/audit-events', ({ tenant, query }) => {
    const actorType = query.get('actorType');
    const action = query.get('action');
    const q = query.get('q')?.toLowerCase();
    const from = validDate(query.get('from'), 'from');
    const to = validDate(query.get('to'), 'to');
    const items: AuditEvent[] = tenant.audit
      .filter((a) => (!actorType || a.actorType === actorType) && (!action || a.action === action))
      .filter((a) => !q || [a.actor, a.action, a.entity, a.entityId].some((v) => (v ?? '').toLowerCase().includes(q)))
      .filter((a) => (!from || a.at.slice(0, 10) >= from) && (!to || a.at.slice(0, 10) <= to));
    return json(paginate(items, query));
  });

  on('GET', '/reason-codes', () => json(REASON_CODES));

  // ---------------------------------------------------------------- playground
  on('POST', '/playground/sdk-token', ({ tenant, body }) => {
    const code = str(body.clientAppCode)?.trim() ?? '';
    if (!code) fail(400, 'VALIDATION_ERROR', 'clientAppCode is required');
    const app = tenant.apps.find((a) => a.code === code);
    if (!app) fail(404, 'NOT_FOUND', 'App not found');
    if (app.status !== 'ACTIVE') fail(409, 'CLIENT_APP_DISABLED', 'This app is disabled. Enable it first.');
    const subjectRef = str(body.subjectRef)?.trim() || null;
    if (subjectRef && subjectRef.length > 100) fail(400, 'VALIDATION_ERROR', 'subjectRef: at most 100 characters');
    const ttl = typeof body.ttlMinutes === 'number' ? Math.min(60, Math.max(1, body.ttlMinutes)) : 30;
    audit(tenant, 'PLAYGROUND_TOKEN_ISSUED', 'CLIENT_APP', app.id, { clientAppCode: app.code, subjectRef });
    const res: SdkTokenResponse = { sdkToken: 'mock', expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(), tenantCode: tenant.info.code, clientAppCode: app.code, subjectRef };
    return json(res, 201);
  });

  // ---------------------------------------------------------------- entry point
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    if (latency) await delay(method === 'GET' ? 120 + Math.random() * 280 : 260 + Math.random() * 320);
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const path = u.pathname.replace(/^.*?(\/v2\/tenant)/, '$1');
    const route = routes.find((r) => r.method === method && r.pattern.test(path));
    const pathExists = routes.some((r) => r.pattern.test(path));
    if (!route) {
      return pathExists ? json({ code: 'METHOD_NOT_ALLOWED', message: `${method} is not supported here` }, 405) : json({ code: 'NOT_FOUND', message: `No mock route for ${method} ${path}` }, 404);
    }

    // Bearer token -> user -> tenant (the server never takes the tenant from the request).
    const headers = new Headers(init.headers);
    const auth = headers.get('Authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? null;
    let tenant: MockTenant | undefined;
    let user: MockUser | undefined;
    if (route.access !== 'public') {
      const session = token ? db.tokens.get(token) : undefined;
      if (session && session.expiresAt <= Date.now()) db.tokens.delete(token as string);
      tenant = session && session.expiresAt > Date.now() ? db.tenants.get(session.tenantCode) : undefined;
      user = tenant?.users.find((u) => u.id === session?.userId);
      if (!tenant || !user || user.status !== 'ACTIVE') return json({ code: 'UNAUTHORIZED', message: 'Sign in again' }, 401);
      if (tenant.info.status !== 'ACTIVE') return json({ code: 'TENANT_SUSPENDED', message: 'This tenant is suspended' }, 403);
      if (route.access === 'api') {
        if (user.mustChangePassword) return json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Choose a new password first' }, 403);
        if (!route.roles.includes(user.role)) return json({ code: 'FORBIDDEN', message: 'Your role does not allow this action' }, 403);
      }
      actor = user.username;
    }

    let rawBody: unknown = undefined;
    if (typeof init.body === 'string' && init.body) {
      try {
        rawBody = JSON.parse(init.body);
      } catch {
        return json({ code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON' }, 400);
      }
    }
    const body: Body = isRecord(rawBody) ? rawBody : {};
    const m = route.pattern.exec(path);
    try {
      // The login route has no session: it gets placeholders it never reads.
      return await route.handler({
        method, params: m ? m.slice(1).map(decodeURIComponent) : [], query: u.searchParams, body, rawBody,
        tenant: tenant as MockTenant, user: user as MockUser, token,
      });
    } catch (e) {
      if (e instanceof HttpError) return json({ code: e.code, message: e.message }, e.status);
      console.error('[mock] handler error', e);
      return json({ code: 'INTERNAL_ERROR', message: 'Mock server error' }, 500);
    } finally {
      if (method !== 'GET') options.onSessionsChanged?.(db.tokens);
    }
  };
}

// The app's mock keeps its sign-in sessions in sessionStorage, so a page reload keeps you signed in
// (the rest of the mock data is rebuilt on reload; user ids are stable, so the sessions still match).
const SESSIONS_KEY = 'camtech.portal.mockSessions';

function loadSessions(db: MockDb): void {
  try {
    const raw = sessionStorage.getItem(SESSIONS_KEY);
    if (!raw) return;
    for (const [token, s] of JSON.parse(raw) as [string, { tenantCode: string; userId: number; expiresAt: number }][]) db.tokens.set(token, s);
  } catch {
    /* no storage, or bad data: start signed out */
  }
}

function saveSessions(tokens: MockDb['tokens']): void {
  try {
    sessionStorage.setItem(SESSIONS_KEY, JSON.stringify([...tokens.entries()]));
  } catch {
    /* no storage */
  }
}

function appDb(): MockDb {
  const db = buildDb();
  loadSessions(db);
  return db;
}

/** The shared mock backend used by the app in mock mode. */
export const mockFetch: Transport = createMockTransport({ db: appDb(), onSessionsChanged: saveSessions });
