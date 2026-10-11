// Bearer token kept in memory and mirrored to sessionStorage (survives reloads, not new tabs).
const KEY = 'camtech.bo.token';

let token: string | null = readInitial();

function readInitial(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null): void {
  token = value;
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: memory only */
  }
}
