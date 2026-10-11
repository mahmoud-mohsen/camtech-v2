// Allowed-origin validation for WEB client apps. An origin is scheme + host + optional port, nothing else.

export type OriginCheck = { ok: true; origin: string } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function validHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;
  if (IPV4.test(host)) return true;
  if (host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  // The top-level label can't be all digits.
  return !/^\d+$/.test(labels[labels.length - 1]);
}

/**
 * Validates and normalises one origin: `https://host[:port]`.
 * Plain `http://` is accepted only for local development hosts (localhost, 127.0.0.1, [::1]).
 * A single trailing slash is tolerated and removed; paths, queries, fragments, credentials and wildcards are not.
 */
export function validateOrigin(input: string): OriginCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Enter an origin' };
  if (raw.includes('*')) return { ok: false, error: 'Wildcards are not allowed: list each origin' };
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)(\/)?$/.exec(raw);
  if (!m) {
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+[/?#]./i.test(raw)) return { ok: false, error: 'Only the origin: remove the path, query or fragment' };
    return { ok: false, error: 'Use the form https://host or https://host:port' };
  }
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  if (authority.includes('@')) return { ok: false, error: "Don't include a user name or password" };
  const hp = /^(\[[0-9a-f:]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return { ok: false, error: 'The host or port is not valid' };
  const host = hp[1];
  const port = hp[2];
  if (!validHost(host)) return { ok: false, error: `"${host}" is not a valid host name` };
  if (port !== undefined) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535 || String(n) !== port) return { ok: false, error: 'The port must be between 1 and 65535' };
  }
  const local = LOCAL_HOSTS.has(host);
  if (scheme === 'http' && !local) return { ok: false, error: 'Use https:// (http:// is allowed only for localhost)' };
  if (scheme !== 'https' && scheme !== 'http') return { ok: false, error: 'The scheme must be https://' };
  const defaultPort = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
  return { ok: true, origin: `${scheme}://${host}${port && !defaultPort ? `:${port}` : ''}` };
}

/** Validates a list: returns the normalised, de-duplicated list or the first error with its index. */
export function validateOrigins(list: readonly string[]): { ok: true; origins: string[] } | { ok: false; index: number; error: string } {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = validateOrigin(list[i]);
    if (!r.ok) return { ok: false, index: i, error: r.error };
    if (!out.includes(r.origin)) out.push(r.origin);
  }
  return { ok: true, origins: out };
}
