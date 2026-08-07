/* Orbit Lab page: live satellites on a 3D globe, plus a pass predictor. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { createOrbitLab } from "./orbitlab.js";
import { tleGroup, TLE_GROUPS, snapshotDate } from "./live.js";
import { parseSatellite, propagateSatellite, nextPasses, orbitRegime } from "./orbit.js";

initShell("orbitlab.html");

const canvas = document.getElementById("orbit-canvas");
const loading = document.getElementById("lab-loading");
const status = document.getElementById("load-status");
const groupSelect = document.getElementById("group-select");

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

groupSelect.innerHTML = TLE_GROUPS.map((g) => `<option value="${g.id}">${g.emoji} ${escapeHtml(g.label)}</option>`).join("");

let lab;
try {
  lab = createOrbitLab(canvas, { onSelect: showSatellite, onTick: updateHud });
  loading.remove();
} catch (error) {
  loading.innerHTML = `<div class="center" style="padding:2rem"><p><b>WebGL unavailable.</b></p>
    <p class="muted">${escapeHtml(error.message)}</p></div>`;
  throw error;
}

let currentTles = [];
let selectedRecord = null;

/* ------------------------------------------------------ loading */
async function loadGroup(id) {
  status.textContent = `Fetching live elements for “${id}” from celestrak.org…`;
  const res = await tleGroup(id, 400);
  if (!res.ok) {
    status.innerHTML = `<span class="cross">Could not load this group: ${escapeHtml(res.error || "no response")}.</span>`;
    return;
  }
  currentTles = res.data;
  const { loaded, rejected } = lab.load(res.data);
  document.getElementById("hud-source").textContent = res.source;
  const when = res.at ? new Date(res.at).toUTCString().slice(5, 22) : snapshotDate().slice(0, 10);
  status.innerHTML =
    `<b>${loaded}</b> object(s) flying. Elements: <b>${escapeHtml(res.source)}</b> (${escapeHtml(when)} UTC).` +
    (rejected.length ? ` ${rejected.length} element set(s) rejected by SGP4 — usually objects that have already decayed.` : "") +
    (res.source === "offline-snapshot" ? " CelesTrak was unreachable, so the bundled snapshot is flying instead." : "");
  countRegimes();
}

function countRegimes() {
  const now = new Date();
  const b = { leo: 0, meo: 0, geo: 0, heo: 0, decaying: 0 };
  for (const t of currentTles) {
    try {
      const p = propagateSatellite(parseSatellite(t.line1, t.line2), now);
      if (p) b[orbitRegime(p.altKm).id]++;
    } catch { /* rejected elements are skipped */ }
  }
  document.getElementById("cnt-leo").textContent = b.leo;
  document.getElementById("cnt-meo").textContent = b.meo;
  document.getElementById("cnt-geo").textContent = b.geo;
  document.getElementById("cnt-heo").textContent = b.heo + b.decaying;
}

document.getElementById("btn-load").addEventListener("click", () => loadGroup(groupSelect.value));
groupSelect.addEventListener("change", () => loadGroup(groupSelect.value));

document.getElementById("sat-search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const found = lab.selectByName(e.target.value);
  if (found) {
    lab.focusSelected();
    toast(`🎯 Locked onto ${escapeHtml(found)}.`, "good");
  } else {
    toast("No satellite in this group matches that name. Try another group.", "bad");
  }
});

document.getElementById("btn-now").addEventListener("click", () => {
  lab.now();
  toast("🕒 Clock resynchronised with real time.");
});
const shellBtn = document.getElementById("btn-shells");
shellBtn.addEventListener("click", () => {
  shellBtn.textContent = `Reference shells: ${lab.toggleShells() ? "on" : "off"}`;
});
document.getElementById("btn-focus").addEventListener("click", () => lab.focusSelected());
document.getElementById("rate-select").addEventListener("change", (e) => lab.setTimeScale(parseFloat(e.target.value)));

/* ---------------------------------------------------------- HUD */
function updateHud(t) {
  document.getElementById("hud-count").textContent = t.count;
  document.getElementById("hud-clock").textContent = t.date.toISOString().slice(11, 19) + "Z";
  document.getElementById("hud-rate").textContent = `${t.timeScale}×`;
}

function showSatellite(s) {
  selectedRecord = s;
  document.getElementById("sel-name").textContent = `🛰️ ${s.name}`;
  document.getElementById("sel-hint").textContent = `NORAD catalogue number ${s.noradId} · ${s.regime.label}`;
  document.getElementById("sel-body").innerHTML = `
    <div class="row"><span>Latitude</span><span>${fmt(s.lat, 3)}°</span></div>
    <div class="row"><span>Longitude</span><span>${fmt(s.lon, 3)}°</span></div>
    <div class="row"><span>Altitude</span><span>${fmt(s.altKm, 1)} km</span></div>
    <div class="row"><span>Speed</span><span>${fmt(s.speedKms, 3)} km/s</span></div>
    <div class="row"><span>Period</span><span>${fmt(s.periodMinutes, 1)} min</span></div>
    <div class="row"><span>Inclination</span><span>${fmt(s.inclinationDeg, 3)}°</span></div>
    <div class="row"><span>Eccentricity</span><span>${fmt(s.eccentricity, 6)}</span></div>
    <div class="row"><span>Revs per day</span><span>${fmt(1440 / s.periodMinutes, 2)}</span></div>
    <details class="mt"><summary class="muted" style="font-size:.78rem;cursor:pointer">Raw element set</summary>
      <pre class="code" style="font-size:.66rem">${escapeHtml(s.line1)}\n${escapeHtml(s.line2)}</pre></details>`;
}

/* ----------------------------------------------- pass prediction */
document.getElementById("btn-locate").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("This browser will not share a location.", "bad");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("obs-lat").value = pos.coords.latitude.toFixed(4);
      document.getElementById("obs-lon").value = pos.coords.longitude.toFixed(4);
      toast("📍 Location set from your device.", "good");
    },
    () => toast("Location refused — type coordinates instead.", "bad")
  );
});

document.getElementById("btn-passes").addEventListener("click", () => {
  const out = document.getElementById("pass-out");
  if (!selectedRecord) {
    out.innerHTML = `<p class="cross">Select a satellite in the globe above first.</p>`;
    return;
  }
  const lat = parseFloat(document.getElementById("obs-lat").value);
  const lon = parseFloat(document.getElementById("obs-lon").value);
  const tle = currentTles.find((t) => t.noradId === selectedRecord.noradId);
  if (!tle) {
    out.innerHTML = `<p class="cross">Lost the element set for that object — reload the group.</p>`;
    return;
  }
  out.innerHTML = `<p class="muted">Scanning 24 hours of SGP4…</p>`;
  setTimeout(() => {
    const passes = nextPasses(parseSatellite(tle.line1, tle.line2), { lat, lon }, { hours: 24, minElevation: 10 });
    if (!passes.length) {
      out.innerHTML = `<p>No pass above 10° elevation from ${fmt(lat, 3)}°, ${fmt(lon, 3)}° in the next 24 hours.
        A satellite in a low-inclination orbit simply never reaches high latitudes.</p>`;
      return;
    }
    out.innerHTML = `<p><b>${passes.length}</b> pass(es) of <b>${escapeHtml(selectedRecord.name)}</b> above 10°:</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Rises (UTC)</th><th>Peak elevation</th><th>Peak at</th><th>Duration</th></tr></thead>
        <tbody>${passes
          .slice(0, 8)
          .map(
            (p) => `<tr><td class="mono">${p.start.toUTCString().slice(5, 22)}</td>
              <td>${fmt(p.peak, 0)}°</td>
              <td class="mono">${p.peakAt.toUTCString().slice(17, 22)}</td>
              <td>${p.durationMin ?? "—"} min</td></tr>`
          )
          .join("")}</tbody></table></div>
      <p class="hint">A pass above 40° is high overhead and, for the ISS just after sunset, unmistakably bright.</p>`;
  }, 30);
});

loadGroup("stations");
window.addEventListener("beforeunload", () => lab.dispose());
