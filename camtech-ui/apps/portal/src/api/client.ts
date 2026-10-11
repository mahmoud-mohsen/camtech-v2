import { CamtechTenantClient, type Transport } from '@camtech/api-client';
import { getToken } from '../auth/tokenStore';
import { API_BASE_URL } from '../env';

let transportPromise: Promise<Transport> | null = null;

/** The real network, or (mock mode) the in-memory backend, loaded lazily so it never ships in a real build's main chunk. */
function getTransport(): Promise<Transport> {
  if (!transportPromise) {
    // Inline env check (not the USE_MOCKS constant) so a real build drops the mock chunk entirely.
    transportPromise = import.meta.env.VITE_USE_MOCKS === 'true'
      ? import('../mocks/server').then((m) => m.mockFetch)
      : Promise.resolve<Transport>((url, init) => fetch(url, init));
  }
  return transportPromise;
}

/**
 * Auth failures every page can run into, handled once by the AuthProvider:
 * 401 UNAUTHORIZED (token expired / invalid), 403 PASSWORD_CHANGE_REQUIRED and 403 TENANT_SUSPENDED.
 */
export type AuthFailure = 'UNAUTHORIZED' | 'PASSWORD_CHANGE_REQUIRED' | 'TENANT_SUSPENDED';

let authFailureHandler: ((failure: AuthFailure) => void) | null = null;

export function setAuthFailureHandler(handler: ((failure: AuthFailure) => void) | null): void {
  authFailureHandler = handler;
}

/** The sign-in call: its 401 / 403 mean "wrong credentials" or "suspended", answered on the login page. */
const isSignInCall = (url: string) => /\/v2\/tenant\/auth\/login(\?|$)/.test(url);

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

const transport: Transport = async (url, init) => {
  const res = await (await getTransport())(url, init);
  if (authFailureHandler && (res.status === 401 || res.status === 403) && !isSignInCall(url)) {
    const code = await errorCode(res);
    if (res.status === 401) authFailureHandler('UNAUTHORIZED');
    else if (code === 'PASSWORD_CHANGE_REQUIRED' || code === 'TENANT_SUSPENDED') authFailureHandler(code);
  }
  return res;
};

/** The tenant API client every page uses. It speaks for the signed-in user (bearer token from the token store). */
export const api: CamtechTenantClient = new CamtechTenantClient({ baseUrl: API_BASE_URL, token: getToken, transport });
