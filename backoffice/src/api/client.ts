import { getToken, setToken } from '../auth/tokenStore';
import type { ApiErrorBody } from './types';

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8080/camtech-service';
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === 'true';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;

let transportPromise: Promise<Transport> | null = null;
function getTransport(): Promise<Transport> {
  if (!transportPromise) {
    transportPromise = USE_MOCKS
      ? import('../mocks/server').then((m) => m.mockFetch)
      : Promise.resolve((url: string, init: RequestInit) => fetch(url, init));
  }
  return transportPromise;
}

let onUnauthorized: () => void = () => {};
/** Registered by the auth provider: called when any call returns 401. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return `${API_BASE_URL.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Skip the global 401 handling (used by the login call). */
  noAuthRedirect?: boolean;
}

async function send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const transport = await getTransport();
  let res: Response;
  try {
    res = await transport(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && !opts.noAuthRedirect) {
      setToken(null);
      onUnauthorized();
    }
    const fallback =
      res.status === 403
        ? "You don't have permission to do this."
        : res.status === 401
          ? 'Your session has ended. Please sign in again.'
          : `Request failed (${res.status})`;
    throw new ApiError(res.status, body.code ?? `HTTP_${res.status}`, body.message ?? fallback);
  }
  return res;
}

async function json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
  const res = await send(method, path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => json<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) => json<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, { body }),
  del: <T = void>(path: string) => json<T>('DELETE', path),
  blob: async (path: string): Promise<Blob> => (await send('GET', path)).blob(),
};

/** Human-readable message for any thrown error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "You don't have permission to do this.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
