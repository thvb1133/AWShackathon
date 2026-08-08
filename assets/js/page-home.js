/* Home page: the welcome, a live data strip and the mesh summary. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { currentUser, getProgress, rankTitle, BADGES } from "./store.js";
import { AGENT_COUNT, MESH_STATS } from "./agents.js";
import { CODEX_COUNT } from "./universe.js";
import { TOTAL_LEVELS } from "./lessons.js";
import { issNow, upcomingLaunches, geomagneticIndex, nearEarthObjects, tleGroup } from "./live.js";
import { propagateSatellite, parseSatellite, orbitRegime } from "./orbit.js";

initShell("index.html");

const user = currentUser();
document.getElementById("welcome-line").textContent = user
  ? `Welcome back, cadet ${user.username} — ${getProgress().xp} XP, rank ${rankTitle(getProgress().xp)}.`
  : "New here? Register to record XP, badges and your place on the leaderboard. You can explore everything without an account too.";

/* ------------------------------------------------------- features */
const FEATURES = [
  ["🌍", "Live 3D Solar System", "Every planet placed by solving Kepler's equation for the exact second on the clock. Drag time back to 1610 or forward to 2183.", "cosmos.html"],
  ["🛰️", "Earth Orbit Laboratory", "Real satellites flown from live NORAD elements with SGP4. Click one for altitude, speed, regime and ground track.", "orbitlab.html"],
  ["📚", `The Cosmic Codex — ${CODEX_COUNT} entries`, "Worlds, missions, people, theories and technology; past, present and future, each with who found it and when.", "codex.html"],
  ["📡", "Mission Control", "NASA, JPL, NOAA, CelesTrak and worldwide launch schedules, live, with every source named.", "mission-control.html"],
  ["🤖", `${AGENT_COUNT} agents`, "A mesh of specialists that calculates, retrieves and fetches. Talk to it by voice or keyboard.", "agents.html"],
  ["🪐", `${TOTAL_LEVELS} classroom levels`, "Two mentors, nineteen levels, narrated aloud. Reading is the gameplay; understanding is the score.", "classroom.html"],
];
document.getElementById("feature-grid").innerHTML = FEATURES.map(
  ([icon, title, body, href]) => `<a class="card" href="${href}" style="text-decoration:none;color:inherit">
      <h3>${icon} ${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(body)}</p>
    </a>`
).join("");

/* ----------------------------------------------------- mesh stats */
document.getElementById("mesh-summary").textContent =
  `${AGENT_COUNT} specialist agents across ${MESH_STATS.domains} domains, all running locally in your browser. ` +
  `No account, no server, no API key required — and every number they quote is either computed from physics or fetched from a named public feed.`;

document.getElementById("mesh-stats").innerHTML = [
  [MESH_STATS.skills, "engineering calculators"],
  [MESH_STATS.knowledge, "codex specialists"],
  [MESH_STATS.industry, "space-industry desks"],
  [MESH_STATS.constellations, "live constellations"],
  [MESH_STATS.feeds, "public data feeds"],
  [MESH_STATS.tutors, "classroom tutors"],
  [MESH_STATS.regions, "national programmes"],
  [MESH_STATS.spaceports, "launch ranges"],
  [MESH_STATS.observatories, "observatories"],
  [MESH_STATS.ground, "ground networks"],
].map(([n, label]) => `<span class="chip">${n} ${escapeHtml(label)}</span>`).join("");

/* ---------------------------------------------------- live strip */
const metrics = document.getElementById("live-metrics");
const cards = [];
const card = (label, value, note = "", tag = "") => {
  cards.push(`<div class="metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${value}</div>
      <div class="muted" style="font-size:.76rem">${note} ${tag}</div>
    </div>`);
  metrics.innerHTML = cards.join("");
};
const tag = (source) => {
  const cls = source === "live" ? "live" : source === "cache" ? "cache" : source === "unavailable" ? "down" : "offline";
  return `<span class="source-tag ${cls}">${escapeHtml(source)}</span>`;
};

(async () => {
  const iss = await issNow();
  if (iss.ok) {
    card(
      "International Space Station",
      `${iss.data.lat.toFixed(2)}°, ${iss.data.lon.toFixed(2)}°`,
      `${Math.round(iss.data.altKm)} km up at ${Math.round(iss.data.speedKmh).toLocaleString()} km/h`,
      tag(iss.source)
    );
  } else {
    // No network: fly the station from the bundled element set instead.
    const tles = await tleGroup("stations", 5);
    if (tles.ok) {
      const t = tles.data.find((x) => /ISS|ZARYA/i.test(x.name)) || tles.data[0];
      const p = propagateSatellite(parseSatellite(t.line1, t.line2), new Date());
      if (p) card("International Space Station", `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`, `${Math.round(p.altKm)} km — ${orbitRegime(p.altKm).label}, propagated locally with SGP4`, tag(tles.source));
    }
  }

  const kp = await geomagneticIndex();
  if (kp.ok) {
    const level = kp.data.kp >= 7 ? "severe storm" : kp.data.kp >= 5 ? "geomagnetic storm" : kp.data.kp >= 4 ? "unsettled" : "quiet";
    card("Geomagnetic activity", `Kp ${kp.data.kp.toFixed(2)}`, `Earth's field is ${level}`, tag(kp.source));
  }

  const launches = await upcomingLaunches(4);
  if (launches.ok && launches.data.length) {
    const next = launches.data[0];
    const when = new Date(next.net);
    const hours = (when - Date.now()) / 3600000;
    card(
      "Next launch on Earth",
      escapeHtml(next.name.split("|")[0].trim()),
      `${next.provider} · ${hours > 0 ? `in ${hours < 48 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`}` : "imminent"}`,
      tag(launches.source)
    );
  }

  const neo = await nearEarthObjects(2);
  if (neo.ok && neo.data.length) {
    const closest = neo.data[0];
    card(
      "Closest asteroid pass",
      escapeHtml(closest.name),
      `${closest.missLunar} lunar distances · ~${closest.diameterM} m across`,
      tag(neo.source)
    );
  }

  if (!cards.length) {
    metrics.innerHTML = `<div class="metric"><div class="label">Offline</div><div class="value">—</div>
      <div class="muted" style="font-size:.76rem">No feed reachable. Every other page still works from the bundled snapshot.</div></div>`;
  }
})();

/* -------------------------------------------------- progress card */
const card2 = document.getElementById("progress-card");
if (user) {
  const p = getProgress();
  const pct = Math.min(100, (p.xp / 500) * 100);
  card2.innerHTML = `
    <h2>🚀 Your flight record</h2>
    <div class="bar" style="margin:.6rem 0"><span style="width:${pct}%"></span></div>
    <p><b>${p.xp} XP</b> · rank <b>${escapeHtml(rankTitle(p.xp))}</b> · ${Object.keys(p.levels).length}/${TOTAL_LEVELS} levels ·
       ${p.planets.length} worlds visited · streak ${p.streak.count} day(s)</p>
    <div class="badge-grid mt">
      ${BADGES.map((b) => `<div class="badge ${p.badges.includes(b.id) ? "earned" : ""}" title="${escapeHtml(b.name)}">
          <span class="ico">${b.icon}</span>${escapeHtml(b.name)}</div>`).join("")}
    </div>`;
} else {
  card2.innerHTML = `
    <h2>🧑‍🚀 Join the crew</h2>
    <p>Registration is local: your account and progress are stored as JSON in this browser's localStorage. No server sees it.</p>
    <p class="lesson-actions">
      <a class="btn primary" href="register.html">Register</a>
      <a class="btn" href="login.html">Login</a>
    </p>`;
}

if (!user && !sessionStorage.getItem("bo_greeted")) {
  sessionStorage.setItem("bo_greeted", "1");
  setTimeout(() => toast("🛰️ Tip: press the JARVIS button, or say <b>“Jarvis”</b>, to talk to the mesh."), 1800);
}
