// Configuration. Everything else in the app reads it from here.
// The URLs come from /env-config.js (written at container start from the environment, see docker/env-config.sh)
// and fall back to the build-time Vite env.

/** Set by /env-config.js before the app loads; empty in dev. */
const RUNTIME: Partial<Record<'VITE_API_BASE_URL' | 'VITE_SDK_URL', string>> =
  (globalThis as { __CAMTECH_ENV__?: typeof RUNTIME }).__CAMTECH_ENV__ ?? {};

function trimSlash(v: string): string {
  return v.replace(/\/+$/, '');
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** CamTech backend, e.g. http://localhost:8080/camtech-service (no trailing slash). */
export const API_BASE_URL: string = trimSlash(RUNTIME.VITE_API_BASE_URL || (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8080/camtech-service');

/** Where the end-user SDK is served (no trailing slash). */
export const SDK_URL: string = trimSlash(RUNTIME.VITE_SDK_URL || (import.meta.env.VITE_SDK_URL as string | undefined) || 'http://localhost:5175');

/** Origin of the SDK: the only origin whose postMessages we accept, and the target of ours. */
export const SDK_ORIGIN: string = originOf(SDK_URL);

/** true = the in-memory mock backend answers every API call. */
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === 'true';

/** Public keys that sign result tokens. */
export const JWKS_URL = `${API_BASE_URL}/v2/.well-known/jwks.json`;
