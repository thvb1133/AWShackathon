/* ============================================================
   live.js — the real-data spine of Beyond Orbit.

   Every feed here is a free, public, no-signup-required source:
     · NASA Open APIs      (APOD, NeoWs, DONKI, EPIC)
     · JPL Solar System Dynamics (close approaches, small bodies)
     · CelesTrak           (two-line element sets for live satellites)
     · Open Notify         (ISS ground position)
     · The Space Devs      (upcoming launches, worldwide)

   Three rules the whole app relies on:
     1. Never block the interface — every call has a timeout.
     2. Never lose a good answer — successful responses are cached
        in localStorage with a per-feed time-to-live.
     3. Never show a dead page — if the network refuses, fall back
        to the cache, then to a bundled snapshot, and always say
        which of the three the user is looking at.
   ============================================================ */

import { TLE_SNAPSHOT, TLE_SNAPSHOT_DATE } from "./tle-fallback.js";

const CACHE_PREFIX = "bo_live_";
const KEY_STORE = "bo_nasa_key";
const RELAY_STORE = "bo_relay";

/* JPL's Solar System Dynamics service is superb and needs no key, but it
   does not send an Access-Control-Allow-Origin header, so a browser will
   refuse to read the response no matter how well the request goes. There
   is no way around that from client-side JavaScript alone.

   Rather than spray red CORS errors at the console and pretend the feed
   is "unavailable", these endpoints are only called when the user has
   supplied a relay prefix on Mission Control — any CORS-forwarding URL,
   or their own one-line proxy. Without one, the app says plainly that
   the browser is the obstacle. */
const NEEDS_RELAY = ["ssd-api.jpl.nasa.gov"];

export const getRelay = () => localStorage.getItem(RELAY_STORE) || "";
export const setRelay = (prefix) => {
  const clean = (prefix || "").trim();
  if (clean) localStorage.setItem(RELAY_STORE, clean);
  else localStorage.removeItem(RELAY_STORE);
  return getRelay();
};

export const relayRequired = (url) => NEEDS_RELAY.some((host) => url.includes(host));

const viaRelay = (url) => {
  const relay = getRelay();
  if (!relay) return url;
  return relay.includes("{url}")
    ? relay.replace("{url}", encodeURIComponent(url))
    : relay + encodeURIComponent(url);
};

/** Thrown when a feed cannot even be attempted from a browser. */
export class BlockedByBrowser extends Error {
  constructor(host) {
    super(`${host} does not send CORS headers, so a browser cannot read its response. Set a relay on Mission Control to use it.`);
    this.name = "BlockedByBrowser";
    this.blocked = true;
  }
}

/* NASA's DEMO_KEY works without registration but is rate limited to
   30 requests per hour per address. A personal key from api.nasa.gov
   lifts that to 1,000 per hour. */
export const DEMO_KEY = "DEMO_KEY";
export const getApiKey = () => localStorage.getItem(KEY_STORE) || DEMO_KEY;
export const setApiKey = (key) => {
  const clean = (key || "").trim();
  if (clean) localStorage.setItem(KEY_STORE, clean);
  else localStorage.removeItem(KEY_STORE);
  return getApiKey();
};
export const usingDemoKey = () => getApiKey() === DEMO_KEY;

/* ------------------------------------------------------- cache */
function cacheRead(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function cacheWrite(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full — the feed simply will not be cached */
  }
}
export function clearLiveCache() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  }
}

/* --------------------------------------------------- transport */
async function grab(url, { timeout = 12000, text = false } = {}) {
  if (relayRequired(url) && !getRelay()) {
    throw new BlockedByBrowser(NEEDS_RELAY.find((h) => url.includes(h)));
  }
  const target = relayRequired(url) ? viaRelay(url) : url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(target, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text ? await res.text() : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a feed with cache and fallback.
 * Resolves to { ok, data, source, at, error } — never rejects.
 */
async function feed(key, ttl, loader, fallback = null) {
  const cached = cacheRead(key);
  if (cached && Date.now() - cached.at < ttl) {
    return { ok: true, data: cached.data, source: "cache", at: cached.at };
  }
  try {
    const data = await loader();
    cacheWrite(key, data);
    return { ok: true, data, source: "live", at: Date.now() };
  } catch (error) {
    if (cached) return { ok: true, data: cached.data, source: "stale-cache", at: cached.at, error: error.message };
    if (fallback) return { ok: true, data: fallback(), source: "offline-snapshot", at: null, error: error.message };
    return {
      ok: false,
      data: null,
      source: error.blocked ? "needs-relay" : "unavailable",
      at: null,
      error: error.message,
      blocked: !!error.blocked,
    };
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (d) => d.toISOString().slice(0, 10);

/* ============================================================
   NASA Open APIs
   ============================================================ */

/** Astronomy Picture of the Day. */
export const apod = () =>
  feed("apod", 6 * HOUR, () =>
    grab(`https://api.nasa.gov/planetary/apod?api_key=${getApiKey()}&thumbs=true`)
  );

/** Near-Earth objects passing in the next `days` days (NeoWs). */
export const nearEarthObjects = (days = 2) =>
  feed(`neo-${days}`, 3 * HOUR, async () => {
    const start = new Date();
    const end = new Date(Date.now() + days * 864e5);
    const raw = await grab(
      `https://api.nasa.gov/neo/rest/v1/feed?start_date=${iso(start)}&end_date=${iso(end)}&api_key=${getApiKey()}`
    );
    const list = [];
    for (const [date, items] of Object.entries(raw.near_earth_objects || {})) {
      for (const o of items) {
        const approach = o.close_approach_data?.[0] || {};
        list.push({
          id: o.id,
          name: o.name.replace(/[()]/g, "").trim(),
          date,
          hazardous: !!o.is_potentially_hazardous_asteroid,
          diameterM: Math.round(
            ((o.estimated_diameter?.meters?.estimated_diameter_min || 0) +
              (o.estimated_diameter?.meters?.estimated_diameter_max || 0)) / 2
          ),
          missKm: Math.round(Number(approach.miss_distance?.kilometers || 0)),
          missLunar: Number(approach.miss_distance?.lunar || 0).toFixed(1),
          speedKmh: Math.round(Number(approach.relative_velocity?.kilometers_per_hour || 0)),
          url: o.nasa_jpl_url,
        });
      }
    }
    return list.sort((a, b) => a.missKm - b.missKm);
  });

/** Space-weather notifications from the DONKI database. */
export const spaceWeather = (days = 7) =>
  feed(`donki-${days}`, 2 * HOUR, async () => {
    const start = iso(new Date(Date.now() - days * 864e5));
    const raw = await grab(
      `https://api.nasa.gov/DONKI/notifications?startDate=${start}&endDate=${iso(new Date())}&type=all&api_key=${getApiKey()}`
    );
    return (Array.isArray(raw) ? raw : [])
      .map((n) => ({
        id: n.messageID,
        type: n.messageType,
        issued: n.messageIssueTime,
        body: (n.messageBody || "").split("\n").filter(Boolean).slice(0, 6).join(" "),
        url: n.messageURL,
      }))
      .slice(0, 25);
  });

/** Full-disc Earth photographs from the EPIC camera on DSCOVR. */
export const earthToday = () =>
  feed("epic", 6 * HOUR, async () => {
    const raw = await grab(`https://api.nasa.gov/EPIC/api/natural?api_key=${getApiKey()}`);
    return (raw || []).slice(0, 8).map((f) => {
      const [y, m, d] = f.date.slice(0, 10).split("-");
      return {
        caption: f.caption,
        date: f.date,
        image: `https://api.nasa.gov/EPIC/archive/natural/${y}/${m}/${d}/png/${f.image}.png?api_key=${getApiKey()}`,
        centroid: f.centroid_coordinates,
      };
    });
  });

/* ============================================================
   JPL Solar System Dynamics — no key required at all
   ============================================================ */

/** Close approaches of small bodies to Earth. */
export const closeApproaches = (maxAu = 0.05, limit = 25) =>
  feed(`cad-${maxAu}`, 6 * HOUR, async () => {
    const raw = await grab(
      `https://ssd-api.jpl.nasa.gov/cad.api?dist-max=${maxAu}&date-min=now&sort=date&limit=${limit}`
    );
    const cols = raw.fields || [];
    const at = (row, name) => row[cols.indexOf(name)];
    return (raw.data || []).map((row) => ({
      name: at(row, "des"),
      date: (at(row, "cd") || "").trim(),
      distAu: Number(at(row, "dist")),
      distKm: Math.round(Number(at(row, "dist")) * 149597870.7),
      speedKms: Number(at(row, "v_rel")).toFixed(2),
      magnitude: Number(at(row, "h")),
    }));
  });

/** Full orbital and physical record for any small body, by designation. */
export const smallBody = (designation) =>
  feed(`sbdb-${designation}`, 24 * HOUR, () =>
    grab(`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(designation)}&phys-par=1`)
  );

/** JPL's fireball (atmospheric impact) database. */
export const fireballs = (limit = 20) =>
  feed(`fireball-${limit}`, 12 * HOUR, async () => {
    const raw = await grab(`https://ssd-api.jpl.nasa.gov/fireball.api?limit=${limit}&sort=-date`);
    const cols = raw.fields || [];
    const at = (row, name) => row[cols.indexOf(name)];
    return (raw.data || []).map((row) => ({
      date: at(row, "date"),
      energyKt: Number(at(row, "impact-e")),
      lat: at(row, "lat"),
      lon: at(row, "lon"),
      altKm: at(row, "alt"),
    }));
  });

/* ============================================================
   CelesTrak — live two-line element sets
   ============================================================ */

/** Every satellite group CelesTrak publishes that this app understands. */
export const TLE_GROUPS = [
  { id: "stations", label: "Space stations", emoji: "🏗️" },
  { id: "science", label: "Space & Earth science", emoji: "🔬" },
  { id: "weather", label: "Weather satellites", emoji: "🌦️" },
  { id: "noaa", label: "NOAA", emoji: "🇺🇸" },
  { id: "goes", label: "GOES", emoji: "🛰️" },
  { id: "resource", label: "Earth resources", emoji: "🌍" },
  { id: "gps-ops", label: "GPS operational", emoji: "🧭" },
  { id: "galileo", label: "Galileo", emoji: "🇪🇺" },
  { id: "glo-ops", label: "GLONASS", emoji: "🇷🇺" },
  { id: "beidou", label: "BeiDou", emoji: "🇨🇳" },
  { id: "starlink", label: "Starlink", emoji: "✨" },
  { id: "oneweb", label: "OneWeb", emoji: "🌐" },
  { id: "geo", label: "Geostationary belt", emoji: "⭕" },
  { id: "amateur", label: "Amateur radio", emoji: "📻" },
  { id: "cubesat", label: "CubeSats", emoji: "📦" },
  { id: "military", label: "Miscellaneous military", emoji: "🎖️" },
  { id: "planet", label: "Planet Labs", emoji: "📸" },
  { id: "spire", label: "Spire Global", emoji: "🌪️" },
  { id: "iridium-NEXT", label: "Iridium NEXT", emoji: "📞" },
  { id: "intelsat", label: "Intelsat", emoji: "📡" },
  { id: "ses", label: "SES", emoji: "📺" },
  { id: "orbcomm", label: "Orbcomm", emoji: "📨" },
  { id: "globalstar", label: "Globalstar", emoji: "🌎" },
  { id: "swarm", label: "Swarm", emoji: "🐝" },
  { id: "active", label: "All active satellites", emoji: "🛰️" },
  { id: "last-30-days", label: "Launched in the last 30 days", emoji: "🆕" },
  { id: "visual", label: "Brightest — visible to the eye", emoji: "👁️" },
  { id: "tle-new", label: "Newest elements", emoji: "🔔" },
];

const parseTle = (text) => {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!name || !l1?.startsWith("1 ") || !l2?.startsWith("2 ")) continue;
    out.push({ name, line1: l1.trim(), line2: l2.trim(), noradId: l1.slice(2, 7).trim() });
  }
  return out;
};

/** Live element sets for a CelesTrak group, capped for rendering sanity. */
export const tleGroup = (group = "stations", cap = 400) =>
  feed(
    `tle-${group}`,
    2 * HOUR,
    async () => {
      const text = await grab(
        `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,
        { text: true, timeout: 20000 }
      );
      const parsed = parseTle(text);
      if (!parsed.length) throw new Error("CelesTrak returned no elements");
      return parsed.slice(0, cap);
    },
    () =>
      TLE_SNAPSHOT.filter(([, , , g]) => g === group || group === "active").map(([name, line1, line2]) => ({
        name,
        line1,
        line2,
        noradId: line1.slice(2, 7).trim(),
      }))
  );

/** Elements for one specific satellite, by NORAD catalogue number. */
export const tleByNorad = (id) =>
  feed(`tle-cat-${id}`, 2 * HOUR, async () => {
    const text = await grab(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(id)}&FORMAT=tle`,
      { text: true }
    );
    const parsed = parseTle(text);
    if (!parsed.length) throw new Error("No satellite with that catalogue number");
    return parsed[0];
  });

export const snapshotDate = () => TLE_SNAPSHOT_DATE;
export const snapshotSize = () => TLE_SNAPSHOT.length;

/* ============================================================
   Ground truth and schedules
   ============================================================ */

/** Where the ISS is, right now, over the Earth. */
export const issNow = () =>
  feed("iss", 20 * 1000, async () => {
    const raw = await grab("https://api.wheretheiss.at/v1/satellites/25544");
    return {
      lat: raw.latitude,
      lon: raw.longitude,
      altKm: raw.altitude,
      speedKmh: raw.velocity,
      visibility: raw.visibility,
      timestamp: raw.timestamp * 1000,
    };
  });

/** The next launches, from every provider on Earth. */
export const upcomingLaunches = (limit = 12) =>
  feed(`launches-${limit}`, HOUR, async () => {
    const raw = await grab(
      `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=${limit}&mode=list`
    );
    // In list mode the fields are flattened: lsp_name and pad are strings,
    // not the nested objects the detail mode returns.
    return (raw.results || []).map((l) => ({
      name: l.name,
      net: l.net,
      provider: l.lsp_name || l.launch_service_provider?.name || "—",
      pad: [l.pad, l.location].filter(Boolean).join(", ") || l.pad?.location?.name || "—",
      mission: l.mission || l.mission_type || "",
      status: l.status?.abbrev || l.status?.name || "TBD",
    }));
  });

/* NOAA's summary products come back as a one-element array of objects.
   Their key names differ per product, so each is read explicitly. */
const firstRow = (raw) => (Array.isArray(raw) ? raw[0] : raw) || {};

/** Solar-wind conditions straight from NOAA's space weather service. */
export const solarWind = () =>
  feed("solarwind", 30 * MIN, async () => {
    const speed = firstRow(await grab("https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json"));
    const mag = firstRow(
      await grab("https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json").catch(() => null)
    );
    return {
      speedKms: Number(speed.proton_speed ?? speed.WindSpeed ?? NaN),
      bz: Number(mag.bz_gsm ?? mag.Bz ?? NaN),
      bt: Number(mag.bt ?? mag.Bt ?? NaN),
      time: speed.time_tag || mag.time_tag || null,
    };
  });

/** Current planetary K-index — how disturbed Earth's magnetic field is. */
export const geomagneticIndex = () =>
  feed("kindex", 30 * MIN, async () => {
    const raw = await grab("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
    if (!Array.isArray(raw) || !raw.length) throw new Error("Unexpected K-index payload");
    // Older revisions of this product were a CSV-style array of arrays; the
    // current one is an array of objects. Both are accepted.
    const rows = Array.isArray(raw[0])
      ? raw.slice(1).map((r) => ({ time: r[0], kp: Number(r[1]) }))
      : raw.map((r) => ({ time: r.time_tag, kp: Number(r.Kp ?? r.kp_index ?? r.kp) }));
    const usable = rows.filter((r) => Number.isFinite(r.kp));
    if (!usable.length) throw new Error("No usable K-index readings");
    const last = usable[usable.length - 1];
    return { kp: last.kp, time: last.time, history: usable.slice(-24).map((r) => r.kp) };
  });

/* ============================================================
   Registry — what the Mission Control page lists as its sources
   ============================================================ */

export const SOURCES = [
  { id: "apod", name: "NASA Astronomy Picture of the Day", host: "api.nasa.gov", key: true, run: apod },
  { id: "neo", name: "NASA NeoWs — near-Earth objects", host: "api.nasa.gov", key: true, run: () => nearEarthObjects(2) },
  { id: "donki", name: "NASA DONKI — space weather notifications", host: "api.nasa.gov", key: true, run: () => spaceWeather(7) },
  { id: "epic", name: "NASA EPIC — whole Earth from DSCOVR", host: "api.nasa.gov", key: true, run: earthToday },
  { id: "cad", name: "JPL SSD — close approach data", host: "ssd-api.jpl.nasa.gov", key: false, run: () => closeApproaches() },
  { id: "fireball", name: "JPL SSD — fireball database", host: "ssd-api.jpl.nasa.gov", key: false, run: () => fireballs() },
  { id: "tle", name: "CelesTrak — live orbital elements", host: "celestrak.org", key: false, run: () => tleGroup("stations") },
  { id: "iss", name: "Where the ISS at — live ground track", host: "api.wheretheiss.at", key: false, run: issNow },
  { id: "launch", name: "The Space Devs — worldwide launch schedule", host: "ll.thespacedevs.com", key: false, run: () => upcomingLaunches(8) },
  { id: "swpc", name: "NOAA SWPC — solar wind & Kp index", host: "services.swpc.noaa.gov", key: false, run: solarWind },
];
