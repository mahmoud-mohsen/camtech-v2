// fetch-compatible transports for the API client: XMLHttpRequest for upload progress, plus debug timing.
import type { Transport } from '@camtech/api-client';
import type { ApiCallEvent } from './protocol';

/** Receives upload progress (0..1) of the current multipart request. */
export class ProgressChannel {
  private listener: ((fraction: number) => void) | null = null;

  /** Listens until the returned function is called. */
  listen(fn: (fraction: number) => void): () => void {
    this.listener = fn;
    return () => {
      if (this.listener === fn) this.listener = null;
    };
  }

  emit(fraction: number): void {
    this.listener?.(Math.max(0, Math.min(1, fraction)));
  }
}

function parseHeaders(raw: string): Headers {
  const h = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    try {
      h.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } catch {
      /* invalid header name */
    }
  }
  return h;
}

/**
 * XMLHttpRequest transport: same contract as fetch (resolves with any HTTP status, rejects with TypeError on
 * network failure and AbortError on abort), and reports upload progress for FormData bodies.
 */
export function xhrTransport(progress: ProgressChannel): Transport {
  return (url, init) => new Promise<Response>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      fetch(url, init).then(resolve, reject);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? 'GET', url, true);
    xhr.responseType = 'text';
    const headers = new Headers(init.headers);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    const isUpload = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (isUpload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) progress.emit(e.loaded / e.total);
      };
      xhr.upload.onload = () => progress.emit(1);
    }
    const signal = init.signal;
    const onAbort = (): void => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (): void => signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      const status = xhr.status;
      if (status < 200 || status > 599) {
        reject(new TypeError('Network request failed'));
        return;
      }
      const nullBody = status === 204 || status === 205 || status === 304;
      resolve(new Response(nullBody ? null : xhr.responseText, {
        status, statusText: xhr.statusText, headers: parseHeaders(xhr.getAllResponseHeaders()),
      }));
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError('Network request failed'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      xhr.abort();
      return;
    }
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

/** Path relative to the API base, without query string (no ids beyond the path, no tokens). */
export function apiPath(url: string, baseUrl: string): string {
  let path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;
  try {
    if (!path.startsWith('/')) path = new URL(url).pathname;
  } catch {
    /* keep */
  }
  const q = path.indexOf('?');
  return q >= 0 ? path.slice(0, q) : path;
}

/** Wraps a transport to report each call (method, path, status, duration). Bodies and headers are never read. */
export function instrumented(inner: Transport, baseUrl: string, emit: (e: ApiCallEvent) => void): Transport {
  return async (url, init) => {
    const started = performance.now();
    const method = (init.method ?? 'GET').toUpperCase();
    const path = apiPath(url, baseUrl);
    try {
      const res = await inner(url, init);
      emit({ type: 'api', method, path, status: res.status, ms: Math.round(performance.now() - started) });
      return res;
    } catch (e) {
      emit({ type: 'api', method, path, status: 0, ms: Math.round(performance.now() - started) });
      throw e;
    }
  };
}
