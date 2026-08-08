/* ============================================================
   api.js — optional PHP/database backend.

   Beyond Orbit remains useful as a static/offline application. When
   it is served by PHP (or a configured API URL), this client upgrades
   it to real server-side accounts, bcrypt passwords, SQLite/MySQL
   persistence and Python ML classification.

   The important word is optional. A deployed GitHub Pages copy has no
   PHP runtime, so it detects the missing API quickly and continues to
   use the local implementation rather than showing a broken login.

   Local development:
     php -S 127.0.0.1:8081 server/router.php
     open http://127.0.0.1:8081
   ============================================================ */

const CONFIG = "bo_api_config";
const TOKEN = "bo_api_token";
const PROFILE = "bo_api_profile";
let healthCache = null;

const read = (key, fallback = null) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

/** Defaults to same-origin /api so PHP's router works with no setup. */
export function baseUrl() {
  const saved = read(CONFIG, {});
  const url = saved.url || "";
  if (url) return url.replace(/\/+$/, "");
  return `${location.origin}/api`;
}

export function configure(url) {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  write(CONFIG, { url: clean });
  healthCache = null;
  return baseUrl();
}

export function configuredUrl() {
  return read(CONFIG, {}).url || "";
}

export function token() {
  return localStorage.getItem(TOKEN) || "";
}

export function profile() {
  return read(PROFILE, null);
}

export function signedIn() {
  return !!token();
}

export function signOut() {
  localStorage.removeItem(TOKEN);
  localStorage.removeItem(PROFILE);
}

async function request(path, { method = "GET", body, auth = false, timeout = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(`${baseUrl()}/${path.replace(/^\//, "")}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.ok) {
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.fields = data.fields || {};
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** One probe per page load, cached for ten seconds. */
export async function health({ force = false } = {}) {
  if (!force && healthCache && Date.now() - healthCache.at < 10000) return healthCache.value;

  /* A static host (GitHub Pages, Netlify, the Python demo server) has no
     /api route. Probing it on every Operations-page load creates a noisy
     browser-console 404 even though fallback mode is expected. Only probe
     automatically for the documented PHP local port, an explicitly saved
     endpoint, or an existing server session. The Test server button forces
     a probe anywhere. */
  const explicitlyConfigured = !!configuredUrl();
  const phpLocal = location.hostname === "127.0.0.1" && location.port === "8081";
  if (!force && !explicitlyConfigured && !phpLocal && !token()) {
    healthCache = {
      at: Date.now(),
      value: { available: false, error: "No API endpoint configured; static/offline mode." },
    };
    return healthCache.value;
  }
  try {
    const value = await request("health", { timeout: 1800 });
    healthCache = { at: Date.now(), value: { available: true, ...value } };
  } catch (error) {
    healthCache = { at: Date.now(), value: { available: false, error: error.message } };
  }
  return healthCache.value;
}

export async function register(payload) {
  const data = await request("register", { method: "POST", body: payload });
  localStorage.setItem(TOKEN, data.token);
  write(PROFILE, data.user);
  return data;
}

export async function login(username, password) {
  const data = await request("login", { method: "POST", body: { username, password } });
  localStorage.setItem(TOKEN, data.token);
  write(PROFILE, data.user);
  return data;
}

export async function logout() {
  try { await request("logout", { method: "POST", auth: true }); } finally { signOut(); }
}

export async function me() {
  const data = await request("me", { auth: true });
  write(PROFILE, data.user);
  return data;
}

export const serverProgress = {
  level: (level_id, course_id, xp = 10) => request("progress/level", { method: "POST", auth: true, body: { level_id, course_id, xp } }),
  planet: (body_id) => request("progress/planet", { method: "POST", auth: true, body: { body_id } }),
  sync: (progress) => request("progress/sync", { method: "POST", auth: true, body: { progress } }),
  get: () => request("progress", { auth: true }),
};

export const serverMemory = {
  all: () => request("memory", { auth: true }),
  remember: (body, kind = "fact", confidence = 0.6, source = "you told me") =>
    request("memory", { method: "POST", auth: true, body: { body, kind, confidence, source } }),
  forget: (id) => request(`memory?id=${encodeURIComponent(id)}`, { method: "DELETE", auth: true }),
};

export const serverMl = {
  classify: (text, engine = "quantum") => request("classify", { method: "POST", auth: signedIn(), body: { text, engine } }),
  compare: () => request("ml/compare"),
};

export const serverFeeds = {
  get: (source) => request(`feed?source=${encodeURIComponent(source)}`),
};

/** A succinct state for the Operations page. */
export async function describeBackend() {
  const h = await health();
  return h.available
    ? {
        mode: "connected",
        driver: h.driver,
        schema: h.schema,
        users: h.users,
        python: h.python,
        url: baseUrl(),
      }
    : { mode: "offline", url: baseUrl(), reason: h.error };
}
