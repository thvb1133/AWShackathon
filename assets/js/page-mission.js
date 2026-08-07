/* Mission Control: every live public feed, with its provenance shown. */

import { initShell, toast, escapeHtml } from "./ui.js";
import {
  apod, nearEarthObjects, spaceWeather, closeApproaches, fireballs,
  upcomingLaunches, solarWind, geomagneticIndex, issNow,
  getApiKey, setApiKey, usingDemoKey, clearLiveCache, SOURCES, getRelay, setRelay,
} from "./live.js";

initShell("mission-control.html");

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const tagFor = (source) => {
  const cls =
    source === "live" ? "live"
      : source === "cache" || source === "stale-cache" ? "cache"
      : source === "unavailable" || source === "needs-relay" ? "down"
      : "offline";
  return `<span class="source-tag ${cls}">${escapeHtml(source)}</span>`;
};

/** The panel shown when a feed is blocked by the browser rather than broken. */
const relayNotice = (title, host) => `<h2>${title}</h2>
  <p class="muted"><b>${escapeHtml(host)}</b> serves this data freely and without a key, but it does not send an
     <span class="mono">Access-Control-Allow-Origin</span> header. Browsers therefore refuse to read the response —
     the request succeeds and the answer is thrown away. No amount of client-side JavaScript can change that.</p>
  <p class="muted">Paste any CORS relay prefix in the field at the top of this page and the panel fills in immediately.
     A relay is one line of server code; the app never requires one for anything else.</p>
  <p class="hint">Everything else on this page — NASA, NOAA, CelesTrak, The Space Devs — is read directly, no relay involved.</p>`;

/* ------------------------------------------------------- API key */
const keyInput = document.getElementById("api-key");
const keyStatus = document.getElementById("key-status");
const refreshKeyStatus = () => {
  keyStatus.innerHTML = usingDemoKey()
    ? `Using NASA's shared <span class="mono">DEMO_KEY</span> — rate limited to 30 requests per hour for your whole address. Responses are cached so the page stays usable.`
    : `Using your personal key <span class="mono">${escapeHtml(getApiKey().slice(0, 6))}…</span> — 1,000 requests per hour.`;
};
refreshKeyStatus();

const relayInput = document.getElementById("relay");
const relayStatus = document.getElementById("relay-status");
const refreshRelayStatus = () => {
  relayInput.value = getRelay();
  relayStatus.textContent = getRelay()
    ? `Relay active: ${getRelay()} — the JPL panels will use it.`
    : "No relay set. The two JPL panels will explain why they are empty instead of failing silently.";
};
refreshRelayStatus();

document.getElementById("btn-save-relay").addEventListener("click", () => {
  setRelay(relayInput.value);
  refreshRelayStatus();
  clearLiveCache();
  loadAll();
  toast("🔁 Relay saved.", "good");
});
document.getElementById("btn-clear-relay").addEventListener("click", () => {
  setRelay("");
  refreshRelayStatus();
  loadAll();
});

document.getElementById("btn-save-key").addEventListener("click", () => {
  setApiKey(keyInput.value);
  refreshKeyStatus();
  clearLiveCache();
  toast("🔑 Key saved in this browser. Reloading feeds.", "good");
  loadAll();
});
document.getElementById("btn-clear-cache").addEventListener("click", () => {
  clearLiveCache();
  toast("🧹 Cached feeds cleared.");
  loadAll();
});
document.getElementById("btn-refresh").addEventListener("click", () => {
  clearLiveCache();
  loadAll();
});

/* -------------------------------------------------- metric strip */
async function loadMetrics() {
  const row = document.getElementById("metric-row");
  const cards = [];
  const push = (label, value, note, source) => {
    cards.push(`<div class="metric"><div class="label">${escapeHtml(label)}</div>
      <div class="value">${value}</div>
      <div class="muted" style="font-size:.76rem">${note} ${tagFor(source)}</div></div>`);
    row.innerHTML = cards.join("");
  };

  const iss = await issNow();
  if (iss.ok) push("ISS ground position", `${iss.data.lat.toFixed(2)}°, ${iss.data.lon.toFixed(2)}°`, `${Math.round(iss.data.altKm)} km · ${Math.round(iss.data.speedKmh).toLocaleString()} km/h · ${iss.data.visibility}`, iss.source);

  const wind = await solarWind();
  if (wind.ok) push("Solar wind", `${fmt(wind.data.speedKms, 0)} km/s`, `Bt ${fmt(wind.data.bt, 1)} nT · Bz ${fmt(wind.data.bz, 1)} nT`, wind.source);

  const kp = await geomagneticIndex();
  if (kp.ok) {
    const level = kp.data.kp >= 7 ? "severe storm — aurora far from the poles" : kp.data.kp >= 5 ? "geomagnetic storm" : kp.data.kp >= 4 ? "unsettled" : "quiet";
    push("Planetary K-index", `Kp ${fmt(kp.data.kp, 2)}`, level, kp.source);
  }

  if (!cards.length) row.innerHTML = `<div class="metric"><div class="label">Offline</div><div class="value">—</div><div class="muted" style="font-size:.76rem">No live feed reachable right now.</div></div>`;
}

/* ------------------------------------------------------- panels */
async function loadApod() {
  const card = document.getElementById("apod-card");
  const res = await apod();
  if (!res.ok) {
    card.innerHTML = `<h2>🖼️ NASA Astronomy Picture of the Day</h2><p class="cross">Unavailable: ${escapeHtml(res.error || "no response")}. The DEMO_KEY limit is a common cause.</p>`;
    return;
  }
  const d = res.data;
  const media = d.media_type === "image"
    ? `<img class="apod-img" src="${escapeHtml(d.url)}" alt="${escapeHtml(d.title)}" loading="lazy">`
    : `<p><a class="btn small" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">▶ Open today's video</a></p>`;
  card.innerHTML = `<h2>🖼️ ${escapeHtml(d.title)} ${tagFor(res.source)}</h2>
    <p class="muted">${escapeHtml(d.date)}${d.copyright ? ` · © ${escapeHtml(d.copyright)}` : " · public domain"}</p>
    ${media}
    <p class="mt" style="font-size:.88rem">${escapeHtml((d.explanation || "").slice(0, 700))}${(d.explanation || "").length > 700 ? "…" : ""}</p>`;
}

async function loadWeather() {
  const card = document.getElementById("weather-card");
  const [wind, kp, donki] = await Promise.all([solarWind(), geomagneticIndex(), spaceWeather(5)]);
  const bits = [`<h2>☀️ Space weather</h2>`];
  if (wind.ok) {
    bits.push(`<p><b>Solar wind:</b> ${fmt(wind.data.speedKms, 0)} km/s, Bt ${fmt(wind.data.bt, 1)} nT, Bz ${fmt(wind.data.bz, 1)} nT ${tagFor(wind.source)}<br>
      <span class="muted">A southward Bz below −10 nT is what opens Earth's magnetic field and lights the aurora.</span></p>`);
  }
  if (kp.ok) {
    const bars = kp.data.history.map((v) => `<span title="Kp ${v}" style="display:inline-block;width:9px;margin-right:2px;background:${v >= 5 ? "#ff7a7a" : v >= 4 ? "#ffd166" : "#5ce6a8"};height:${4 + v * 5}px"></span>`).join("");
    bits.push(`<p><b>Kp index, last 24 readings:</b> ${tagFor(kp.source)}<br>${bars}</p>`);
  }
  if (donki.ok && donki.data.length) {
    bits.push(`<p><b>NASA DONKI notifications (5 days):</b> ${tagFor(donki.source)}</p>
      <ul class="feed-list">${donki.data.slice(0, 6).map((n) => `<li><b>${escapeHtml(n.type)}</b> — ${escapeHtml((n.issued || "").slice(0, 16))}<br>
        <span class="muted">${escapeHtml((n.body || "").slice(0, 180))}…</span></li>`).join("")}</ul>`);
  } else if (donki.ok) {
    bits.push(`<p class="muted">No space-weather notifications issued in the last five days. The Sun is behaving.</p>`);
  }
  card.innerHTML = bits.join("");
}

async function loadNeo() {
  const card = document.getElementById("neo-card");
  const res = await nearEarthObjects(3);
  if (!res.ok) {
    card.innerHTML = `<h2>☄️ Asteroids passing Earth</h2><p class="cross">Unavailable: ${escapeHtml(res.error || "no response")}.</p>`;
    return;
  }
  const hazardous = res.data.filter((o) => o.hazardous).length;
  card.innerHTML = `<h2>☄️ Asteroids passing Earth ${tagFor(res.source)}</h2>
    <p class="muted">${res.data.length} object(s) in the next three days. ${hazardous} carry NASA's "potentially hazardous" flag —
       which means large and close, not "about to hit us".</p>
    <div class="scroll-x"><table><thead><tr><th>Object</th><th>Date</th><th>Miss distance</th><th>Size</th><th>Speed</th></tr></thead>
      <tbody>${res.data.slice(0, 12).map((o) => `<tr${o.hazardous ? ' class="me"' : ""}>
        <td>${escapeHtml(o.name)}${o.hazardous ? " ⚠️" : ""}</td>
        <td class="mono">${escapeHtml(o.date)}</td>
        <td>${o.missLunar} LD<br><span class="muted mono">${fmt(o.missKm, 0)} km</span></td>
        <td>~${fmt(o.diameterM, 0)} m</td>
        <td>${fmt(o.speedKmh, 0)} km/h</td></tr>`).join("")}</tbody></table></div>
    <p class="hint">LD = lunar distance, 384,400 km. The Moon is one LD away.</p>`;
}

async function loadLaunches() {
  const card = document.getElementById("launch-card");
  const res = await upcomingLaunches(12);
  if (!res.ok) {
    card.innerHTML = `<h2>🚀 Next launches worldwide</h2><p class="cross">Unavailable: ${escapeHtml(res.error || "no response")}.</p>`;
    return;
  }
  card.innerHTML = `<h2>🚀 Next launches worldwide ${tagFor(res.source)}</h2>
    <ul class="feed-list">${res.data.map((l) => {
      const when = new Date(l.net);
      const hrs = (when - Date.now()) / 3600000;
      return `<li><b>${escapeHtml(l.name)}</b><br>
        <span class="muted">${escapeHtml(l.provider)}${l.mission ? ` · ${escapeHtml(l.mission)}` : ""}<br>${escapeHtml(l.pad)}<br>
        ${when.toUTCString().slice(0, 22)} UTC · ${hrs > 0 ? `T−${hrs < 48 ? `${hrs.toFixed(1)} h` : `${(hrs / 24).toFixed(1)} days`}` : "past due"} · ${escapeHtml(l.status)}</span></li>`;
    }).join("")}</ul>`;
}

async function loadCad() {
  const card = document.getElementById("cad-card");
  const res = await closeApproaches(0.05, 20);
  if (!res.ok) {
    card.innerHTML = res.blocked
      ? relayNotice("🎯 JPL close approaches", "ssd-api.jpl.nasa.gov")
      : `<h2>🎯 JPL close approaches</h2><p class="cross">Unavailable: ${escapeHtml(res.error || "no response")}.</p>`;
    return;
  }
  card.innerHTML = `<h2>🎯 JPL close approaches ${tagFor(res.source)}</h2>
    <p class="muted">Small bodies coming within 0.05 AU (about 7.5 million km) of Earth, straight from JPL's Solar System
       Dynamics service. No API key is needed for this one.</p>
    <div class="scroll-x"><table><thead><tr><th>Body</th><th>Closest approach</th><th>Distance</th><th>Relative speed</th></tr></thead>
      <tbody>${res.data.slice(0, 12).map((c) => `<tr><td>${escapeHtml(c.name)}</td>
        <td class="mono">${escapeHtml(c.date)}</td>
        <td>${fmt(c.distAu, 5)} AU<br><span class="muted mono">${fmt(c.distKm, 0)} km</span></td>
        <td>${c.speedKms} km/s</td></tr>`).join("")}</tbody></table></div>`;
}

async function loadFireballs() {
  const card = document.getElementById("fireball-card");
  const res = await fireballs(15);
  if (!res.ok) {
    card.innerHTML = res.blocked
      ? relayNotice("💥 Recent fireballs", "ssd-api.jpl.nasa.gov")
      : `<h2>💥 Recent fireballs</h2><p class="cross">Unavailable: ${escapeHtml(res.error || "no response")}.</p>`;
    return;
  }
  card.innerHTML = `<h2>💥 Recent fireballs ${tagFor(res.source)}</h2>
    <p class="muted">Atmospheric impacts detected by US government sensors and published by JPL. About 48 tonnes of
       material reaches Earth every day; these are the pieces big enough to make a flash.</p>
    <div class="scroll-x"><table><thead><tr><th>Date (UTC)</th><th>Energy</th><th>Location</th><th>Altitude</th></tr></thead>
      <tbody>${res.data.slice(0, 12).map((f) => `<tr><td class="mono">${escapeHtml((f.date || "").slice(0, 16))}</td>
        <td>${fmt(f.energyKt, 2)} kt TNT</td>
        <td class="mono">${escapeHtml(String(f.lat ?? "—"))}, ${escapeHtml(String(f.lon ?? "—"))}</td>
        <td>${f.altKm ? `${f.altKm} km` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

/* ------------------------------------------------ source health */
document.getElementById("btn-test").addEventListener("click", testSources);

async function testSources() {
  const body = document.querySelector("#source-table tbody");
  body.innerHTML = SOURCES.map((s) => `<tr id="src-${s.id}">
    <td>${escapeHtml(s.name)}</td><td class="mono">${escapeHtml(s.host)}</td>
    <td>${s.key ? "NASA key" : "none"}</td><td class="muted">testing…</td><td>—</td></tr>`).join("");

  await Promise.all(
    SOURCES.map(async (s) => {
      const t0 = performance.now();
      let res;
      try {
        res = await s.run();
      } catch (err) {
        res = { ok: false, source: "unavailable", error: err.message };
      }
      const ms = Math.round(performance.now() - t0);
      const row = document.getElementById(`src-${s.id}`);
      row.children[3].innerHTML = res.ok
        ? `${tagFor(res.source)} ${res.error ? `<span class="muted">(${escapeHtml(res.error)})</span>` : ""}`
        : `<span class="cross">failed — ${escapeHtml(res.error || "no response")}</span>`;
      row.children[4].textContent = `${ms} ms`;
    })
  );
  toast("🔌 All sources tested.", "good");
}

document.querySelector("#source-table tbody").innerHTML = SOURCES.map(
  (s) => `<tr><td>${escapeHtml(s.name)}</td><td class="mono">${escapeHtml(s.host)}</td>
    <td>${s.key ? "NASA key" : "none"}</td><td class="muted">not tested</td><td>—</td></tr>`
).join("");

/* ----------------------------------------------------------- go */
function loadAll() {
  loadMetrics();
  loadApod();
  loadWeather();
  loadNeo();
  loadLaunches();
  loadCad();
  loadFireballs();
}
loadAll();
setInterval(loadMetrics, 60000);
