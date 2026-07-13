/**
 * Client auth against Railway API (no Supabase).
 * Session token stored in localStorage.
 */
import {apiUrl} from './apiBase';
import Cookies from 'js-cookie';

const TOKEN_KEY = 'saraf_auth_token';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin';
  balance: number;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
  expiresAt?: string;
};

type Listener = (session: AuthSession | null) => void;
const listeners = new Set<Listener>();

function notify(session: AuthSession | null) {
  for (const fn of listeners) {
    try {
      fn(session);
    } catch {
      /* ignore */
    }
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function signup(input: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<AuthSession> {
  const res = await fetch(apiUrl('/api/auth/signup'), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      fullName: input.fullName,
    }),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    const err = String(json.error || 'signup_failed');
    const message = String(json.message || err);
    throw Object.assign(new Error(message), {code: err, status: res.status});
  }
  const token = String(json.token || '');
  const user = json.user as AuthUser;
  if (!token || !user?.id) throw new Error('signup_failed');
  setToken(token);
  Cookies.set('saraf_user_email', user.email, {expires: 365});
  const session: AuthSession = {
    token,
    user,
    expiresAt: json.expiresAt ? String(json.expiresAt) : undefined,
  };
  notify(session);
  return session;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(apiUrl('/api/auth/login'), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password}),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    const err = String(json.error || 'login_failed');
    throw Object.assign(new Error(err), {code: err, status: res.status});
  }
  const token = String(json.token || '');
  const user = json.user as AuthUser;
  if (!token || !user?.id) throw new Error('login_failed');
  setToken(token);
  Cookies.set('saraf_user_email', user.email, {expires: 365});
  const session: AuthSession = {
    token,
    user,
    expiresAt: json.expiresAt ? String(json.expiresAt) : undefined,
  };
  notify(session);
  return session;
}

export async function logout(): Promise<void> {
  const token = getToken();
  try {
    if (token) {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({token}),
      });
    }
  } catch {
    /* ignore network errors on logout */
  }
  setToken(null);
  notify(null);
}

export async function getSession(): Promise<AuthSession | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: {Authorization: `Bearer ${token}`},
      cache: 'no-store',
    });
    if (!res.ok) {
      if (res.status === 401) {
        setToken(null);
        notify(null);
      }
      return null;
    }
    const json = await parseJson(res);
    const user = json.user as AuthUser;
    if (!user?.id) return null;
    return {token, user};
  } catch {
    return null;
  }
}
