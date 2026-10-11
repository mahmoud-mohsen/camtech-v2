import { CamtechApiError } from '@camtech/api-client';

export interface RetryOptions {
  /** Extra attempts after the first one. Default 2. */
  retries?: number;
  /** Delay before each retry, ms. Default [1500, 3500]. */
  delays?: number[];
  signal?: AbortSignal;
  onRetry?: (attempt: number, err: CamtechApiError) => void;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `fn` and retries it (same inputs, e.g. the captured images) when the error is retryable
 * (network failure, 502/503/504 from the face service). Other errors are thrown at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const delays = opts.delays ?? [1500, 3500];
  const wait = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof CamtechApiError) || !e.retryable || attempt >= retries) throw e;
      opts.onRetry?.(attempt + 1, e);
      await wait(delays[Math.min(attempt, delays.length - 1)] ?? 2000, opts.signal);
    }
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}
