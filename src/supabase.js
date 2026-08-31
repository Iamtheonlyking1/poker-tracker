// A tiny Supabase REST client — GoTrue (auth) + PostgREST (data). No SDK, no
// vendored bundle: the whole surface we use is a handful of fetch calls, and
// staying dependency-free keeps the CSP to `connect-src <project>.supabase.co`.
// Realtime (a WebSocket protocol) is added in Phase 3.

import { getRaw, setRaw } from './store.js';
import { report } from './report.js';
import { getSupabaseUrl, getSupabaseAnonKey } from './config.js';

const SESSION_KEY = 'poker.sync.session'; // device-local
const REFRESH_SKEW_S = 60; // refresh this long before expiry

let session = null; // { access_token, refresh_token, expires_at (s), user }
let refreshing = null;
const listeners = new Set();

function loadSession() {
  try {
    return JSON.parse(getRaw(SESSION_KEY) || 'null');
  } catch (e) {
    return null;
  }
}
function persist(s) {
  session = s;
  if (s) setRaw(SESSION_KEY, JSON.stringify(s));
  else setRaw(SESSION_KEY, null);
  for (const fn of listeners) {
    try {
      fn(s);
    } catch (e) {
      report(e, { kind: 'supabase.authListener' });
    }
  }
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentUser() {
  return session && session.user ? session.user : null;
}
export function isSignedIn() {
  return !!(session && session.access_token);
}

function authHeaders(withToken = true) {
  const h = { apikey: getSupabaseAnonKey(), 'Content-Type': 'application/json' };
  if (withToken && session && session.access_token) {
    h.Authorization = `Bearer ${session.access_token}`;
  }
  return h;
}

async function req(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
  const res = await fetch(getSupabaseUrl() + path, {
    method,
    headers: { ...authHeaders(auth), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).msg || (await res.text());
    } catch (e) {
      /* ignore */
    }
    const err = new Error(`supabase ${method} ${path} → ${res.status} ${detail}`.trim());
    err.status = res.status;
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function storeTokenResponse(data) {
  if (!data || !data.access_token) return null;
  const expires_at =
    data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  persist({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    user: data.user || (session && session.user) || null,
  });
  return session;
}

// ---------------------------------------------------------------- auth
export const auth = {
  init() {
    session = loadSession();
    // OAuth / magic-link return: tokens land in the URL hash
    const m = location.hash.match(/access_token=([^&]+)/);
    if (m) {
      const params = new URLSearchParams(location.hash.slice(1));
      storeTokenResponse({
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_at: Number(params.get('expires_at')) || undefined,
        expires_in: Number(params.get('expires_in')) || undefined,
      });
      history.replaceState(null, '', location.pathname + location.search);
      // fetch the user record now that we have a token
      auth.refreshUser().catch(() => {});
    }
    return session;
  },

  /** Send a 6-digit code (and a magic link) to `email`. */
  async sendOtp(email) {
    await req('/auth/v1/otp', {
      method: 'POST',
      auth: false,
      body: { email, create_user: true },
    });
  },

  /** Exchange the 6-digit code for a session. */
  async verifyOtp(email, token) {
    const data = await req('/auth/v1/verify', {
      method: 'POST',
      auth: false,
      body: { type: 'email', email, token },
    });
    return storeTokenResponse(data);
  },

  async signInWithPassword(email, password) {
    const data = await req('/auth/v1/token?grant_type=password', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    return storeTokenResponse(data);
  },

  async signUpWithPassword(email, password) {
    const data = await req('/auth/v1/signup', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    return storeTokenResponse(data);
  },

  /** Anonymous session — a real auth.uid() with no email. For joining a shared game. */
  async signInAnonymously() {
    const data = await req('/auth/v1/signup', { method: 'POST', auth: false, body: {} });
    return storeTokenResponse(data);
  },

  /** Redirect to an OAuth provider ('google' | 'apple'). Returns via the hash. */
  signInWithOAuth(provider) {
    const redirect = encodeURIComponent(location.origin + location.pathname);
    location.href = `${getSupabaseUrl()}/auth/v1/authorize?provider=${provider}&redirect_to=${redirect}`;
  },

  async refreshUser() {
    if (!session || !session.access_token) return null;
    const user = await req('/auth/v1/user');
    persist({ ...session, user });
    return user;
  },

  /** Ensure the access token is fresh; refresh it if it is about to expire. */
  async ensureFresh() {
    if (!session || !session.refresh_token) return session;
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at - now > REFRESH_SKEW_S) return session;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await req('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          auth: false,
          body: { refresh_token: session.refresh_token },
        });
        return storeTokenResponse(data);
      } catch (e) {
        report(e, { kind: 'supabase.refresh' });
        if (e.status === 400 || e.status === 401) persist(null); // refresh token dead
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },

  async signOut() {
    try {
      if (session && session.access_token) await req('/auth/v1/logout', { method: 'POST' });
    } catch (e) {
      /* best effort */
    }
    persist(null);
  },
};

// ---------------------------------------------------------------- data (PostgREST)
export const db = {
  /**
   * Rows in `table` with updated_at >= cursor (ISO string), oldest first.
   * `>=` not `>` so a row written in the same instant as the cursor is not lost;
   * the engine de-dupes.
   */
  async selectSince(table, cursor) {
    await auth.ensureFresh();
    const q = new URLSearchParams({ select: '*', order: 'updated_at.asc' });
    if (cursor) q.set('updated_at', `gte.${cursor}`);
    return req(`/rest/v1/${table}?${q.toString()}`);
  },

  async selectAll(table) {
    await auth.ensureFresh();
    return req(`/rest/v1/${table}?select=*`);
  },

  /** GET /rest/v1/<table>?<query> — caller builds the PostgREST query string. */
  async select(table, query) {
    await auth.ensureFresh();
    return req(`/rest/v1/${table}?${query}`);
  },

  /** INSERT rows, returning the stored representations. */
  async insert(table, rows) {
    await auth.ensureFresh();
    return req(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: rows,
    });
  },

  /** PATCH rows matching <query> with <patch>. */
  async update(table, query, patch) {
    await auth.ensureFresh();
    return req(`/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: patch,
    });
  },

  /** Upsert rows on the primary key. Returns the stored representations. */
  async upsert(table, rows) {
    await auth.ensureFresh();
    return req(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: rows,
    });
  },

  async rpc(fn, args) {
    await auth.ensureFresh();
    return req(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });
  },
};
