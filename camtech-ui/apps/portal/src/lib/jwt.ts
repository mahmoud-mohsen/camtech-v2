// Decodes (does NOT verify) a JWT, for the result-token inspector. Verification belongs on the tenant backend.

export type JsonObject = { [key: string]: unknown };

export interface DecodedJwt {
  header: JsonObject;
  payload: JsonObject;
  signature: string;
  /** exp claim as epoch seconds, if present and numeric. */
  expiresAt: number | null;
  issuedAt: number | null;
}

export type JwtDecodeResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

/** base64url -> UTF-8 string. Works in browsers and Node (atob + TextDecoder). */
export function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parsePart(part: string, name: string): JsonObject {
  let text: string;
  try {
    text = base64UrlDecode(part);
  } catch {
    throw new Error(`The ${name} is not valid base64url`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The ${name} is not valid JSON`);
  }
  if (!isObject(parsed)) throw new Error(`The ${name} is not a JSON object`);
  return parsed;
}

export function decodeJwt(token: string): JwtDecodeResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1]) {
    return { ok: false, error: 'Not a JWT: expected three base64url parts separated by dots' };
  }
  try {
    const header = parsePart(parts[0], 'header');
    const payload = parsePart(parts[1], 'payload');
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { ok: true, jwt: { header, payload, signature: parts[2], expiresAt: num(payload.exp), issuedAt: num(payload.iat) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not decode the token' };
  }
}

/** Seconds until the token expires (negative when expired), or null without an exp claim. */
export function secondsUntilExpiry(jwt: DecodedJwt, nowMs: number = Date.now()): number | null {
  return jwt.expiresAt === null ? null : Math.floor(jwt.expiresAt - nowMs / 1000);
}
