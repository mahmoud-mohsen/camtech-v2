import type { ApiErrorBody, NextStep } from './types';

/** fetch-compatible function, so tests and mock mode can replace the network. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export type Query = Record<string, string | number | boolean | null | undefined>;

/** Any non-2xx answer (or no answer). `code` is stable; drive the UI from it, show `message`. */
export class CamtechApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly step: string | null;
  readonly attemptsRemaining: number | null;
  readonly nextStep: NextStep | null;

  constructor(status: number, body: Partial<ApiErrorBody> & { code: string; message: string }) {
    super(body.message);
    this.name = 'CamtechApiError';
    this.status = status;
    this.code = body.code;
    this.step = body.step ?? null;
    this.attemptsRemaining = body.attemptsRemaining ?? null;
    this.nextStep = body.nextStep ?? null;
  }

  /** Network failures and 502/503 from the face service: the same upload can be sent again. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export interface HttpOptions {
  baseUrl: string;
  transport?: Transport;
  /** Extra headers for every call; a function is re-evaluated per call. */
  headers?: Record<string, string> | (() => Record<string, string>);
}

export interface RequestOptions {
  query?: Query;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class Http {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly headers: HttpOptions['headers'];

  constructor(opts: HttpOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.transport = opts.transport ?? ((url, init) => fetch(url, init));
    this.headers = opts.headers;
  }

  url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  async send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    const base = typeof this.headers === 'function' ? this.headers() : (this.headers ?? {});
    const headers: Record<string, string> = { Accept: 'application/json', ...base, ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.form) {
      body = opts.form;
    } else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    let res: Response;
    try {
      res = await this.transport(this.url(path, opts.query), { method, headers, body, signal: opts.signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new CamtechApiError(0, {
        code: 'NETWORK_ERROR',
        message: 'Cannot reach the server. Check your connection and try again.',
      });
    }
    if (!res.ok && res.status !== 304) {
      let parsed: Partial<ApiErrorBody> = {};
      try {
        parsed = (await res.json()) as ApiErrorBody;
      } catch {
        /* not JSON */
      }
      throw new CamtechApiError(res.status, {
        ...parsed,
        code: parsed.code ?? `HTTP_${res.status}`,
        message: parsed.message ?? `Request failed (${res.status})`,
      });
    }
    return res;
  }

  async json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const res = await this.send(method, path, opts);
    if (res.status === 204 || res.status === 304) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** Human-readable message for anything thrown by a client call. */
export function errorMessage(err: unknown): string {
  if (err instanceof CamtechApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
