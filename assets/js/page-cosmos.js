/* Cosmos page: drives the live 3D Solar System, its HUD and its voice verbs. */

import { initShell, toast, mountVoiceBar, escapeHtml } from "./ui.js";
import { createSolarSystem } from "./solar3d.js";
import { byId, PLANETS, DWARFS } from "./universe.js";
import { visitPlanet, currentUser } from "./store.js";
import { speak } from "./voice.js";
import { AU_KM } from "./orbit.js";

initShell("cosmos.html");

const canvas = document.getElementById("solar-canvas");
const labelHost = document.getElementById("sky-labels");
const loading = document.getElementById("cosmos-loading");

const hudDate = document.getElementById("hud-date");
const hudRate = document.getElementById("hud-rate");
const hudScale = document.getElementById("hud-scale");
const hudFps = document.getElementById("hud-fps");
const selName = document.getElementById("sel-name");
const selHint = document.getElementById("sel-hint");
const selBody = document.getElementById("sel-body");
const slider = document.getElementById("time-slider");
const readout = document.getElementById("time-readout");

const YEAR_MS = 365.25 * 864e5;
const BASE = Date.now();
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

let sky = null;
let sliderHeld = false;
let selected = null;

/* The scene starts rendering the moment it is constructed, and its
   first onTick fires before the next statement runs — so the HUD's
   own state has to exist before createSolarSystem() is called. */
let frames = 0;
let lastFps = performance.now();

/* --------------------------------------------------------- start */
try {
  sky = createSolarSystem(canvas, {
    labelHost,
    onSelect: showSelection,
    onTick: updateHud,
  });
  loading.remove();
} catch (error) {
  loading.innerHTML = `<div class="center" style="padding:2rem">
      <p><b>WebGL is not available in this browser.</b></p>
      <p class="muted">${escapeHtml(error.message)}</p>
      <p class="muted">Every other page — the codex, Mission Control, the classroom and the agent mesh — works without it.</p>
    </div>`;
  throw error;
}

/* ------------------------------------------------------- the HUD */
function updateHud(snap) {
  frames++;
  const now = performance.now();
  if (now - lastFps > 500) {
    hudFps.textContent = `${Math.round((frames * 1000) / (now - lastFps))} fps`;
    frames = 0;
    lastFps = now;
  }
  hudDate.textContent = snap.date.toISOString().slice(0, 10);
  hudRate.textContent = snap.paused ? "paused" : `${fmt(snap.speed, 4)} days/s`;
  hudScale.textContent = snap.scaleMode === "true" ? "true distances" : "compressed";
  if (!sliderHeld) {
    slider.value = ((snap.date.getTime() - BASE) / YEAR_MS).toFixed(2);
    readout.textContent = snap.date.getUTCFullYear();
  }
  if (selected && snap.selectedId === selected) refreshNumbers(snap);
}

function refreshNumbers(snap) {
  const rows = document.getElementById("sel-numbers");
  if (!rows) return;
  rows.innerHTML = `
    <div class="row"><span>Distance from the Sun</span><span>${snap.sunDistanceAu ? `${fmt(snap.sunDistanceAu, 4)} AU` : "—"}</span></div>
    <div class="row"><span>Distance from Earth</span><span>${snap.distanceFromEarthAu ? `${fmt(snap.distanceFromEarthAu, 4)} AU` : "—"}</span></div>
    <div class="row"><span>In kilometres</span><span>${snap.distanceFromEarthAu ? fmt(snap.distanceFromEarthAu * AU_KM, 0) : "—"}</span></div>
    <div class="row"><span>Light delay</span><span>${snap.lightMinutes ? `${fmt(snap.lightMinutes, 2)} min` : "—"}</span></div>`;
}

function showSelection(id, snap) {
  selected = id;
  const entry = byId(id);
  const probe = snap.probes.find((p) => p.id === id);

  if (probe) {
    selName.textContent = `📡 ${probe.name}`;
    selHint.textContent = "Deep-space probe, extrapolated from its published recession rate.";
    selBody.innerHTML = `<div class="row"><span>Distance from the Sun</span><span>${fmt(probe.au, 2)} AU</span></div>
      <div class="row"><span>In kilometres</span><span>${fmt(probe.au * AU_KM, 0)}</span></div>
      <div class="row"><span>One-way signal</span><span>${fmt((probe.au * AU_KM) / 1079252848.8, 2)} hours</span></div>`;
    return;
  }

  if (!entry) {
    selName.textContent = id;
    selBody.innerHTML = "";
    return;
  }

  selName.textContent = `${entry.emoji || "•"} ${entry.name}`;
  selHint.textContent = entry.who || "";
  selBody.innerHTML = `
    <div id="sel-numbers"></div>
    <p style="font-size:.82rem;margin:.5rem 0 .2rem"><b>Radius</b> ${fmt(entry.radiusKm, 0)} km${entry.moons !== undefined ? ` · <b>Moons</b> ${entry.moons}` : ""}</p>
    <ul style="padding-left:1.05rem;font-size:.82rem">${(entry.facts || []).slice(0, 4).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
    <p class="poetic" style="font-size:.82rem">${escapeHtml(entry.line || "")}</p>
    <p><a class="btn small ghost" href="codex.html?id=${encodeURIComponent(entry.id)}">Full codex entry →</a></p>`;
  refreshNumbers(snap);

  if (currentUser()) {
    const res = visitPlanet(entry.id);
    if (res?.gained) toast(`🪐 First visit to ${escapeHtml(entry.name)} — +${res.gained} XP.`, "good");
  }
}

/* ------------------------------------------------------ controls */
const pauseBtn = document.getElementById("btn-pause");
pauseBtn.addEventListener("click", () => {
  const p = sky.pause();
  pauseBtn.textContent = p ? "▶ Resume" : "⏸ Pause";
});
document.getElementById("btn-now").addEventListener("click", () => {
  sky.setDate(new Date());
  toast("🕒 Clock reset to this exact moment.");
});
document.getElementById("speed-select").addEventListener("change", (e) => sky.setSpeed(parseFloat(e.target.value)));

slider.addEventListener("pointerdown", () => (sliderHeld = true));
slider.addEventListener("pointerup", () => (sliderHeld = false));
slider.addEventListener("input", (e) => {
  const date = new Date(BASE + parseFloat(e.target.value) * YEAR_MS);
  readout.textContent = date.getUTCFullYear();
  sky.setDate(date);
});

const toggle = (id, label, fn) => {
  const btn = document.getElementById(id);
  btn.addEventListener("click", () => {
    const on = fn();
    btn.textContent = `${label}: ${on ? "on" : "off"}`;
  });
};
toggle("btn-orbits", "Orbit lines", () => sky.toggleOrbits());
toggle("btn-labels", "Labels", () => sky.toggleLabels());
toggle("btn-belts", "Belts", () => sky.toggleBelts());

const scaleBtn = document.getElementById("btn-scale");
scaleBtn.addEventListener("click", () => {
  const mode = sky.snapshot().scaleMode === "true" ? "compressed" : "true";
  sky.setScaleMode(mode);
  scaleBtn.textContent = `Scale: ${mode === "true" ? "true distances" : "compressed"}`;
  if (mode === "true") toast("📏 True distances. Now try to find Neptune — that is how empty it really is.");
});

document.getElementById("btn-reset").addEventListener("click", () => sky.resetView());

document.getElementById("btn-narrate").addEventListener("click", () => {
  const entry = byId(selected);
  if (!entry) return toast("Select a world first.", "bad");
  const who = ["mission", "tech", "vehicle", "telescope", "station"].includes(entry.cat) ? "penguin" : "thorn";
  speak(`${entry.name}. ${entry.facts.slice(0, 3).join(" ")} ${entry.line}`, who);
});

/* --------------------------------------------------- quick jumps */
document.getElementById("quick-jump").innerHTML =
  `<span class="muted" style="font-size:.82rem">Jump to:</span>` +
  [{ id: "sun", name: "Sun", emoji: "☀️", color: "#ffd166" }, ...PLANETS, ...DWARFS]
    .map(
      (b) => `<button class="planet-pill" data-id="${b.id}">
         <span class="dot" style="background:${b.color || "#fff"}"></span>${b.emoji || ""} ${escapeHtml(b.name)}</button>`
    )
    .join("");
document.getElementById("quick-jump").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-id]");
  if (btn) sky.focus(btn.dataset.id);
});

/* -------------------------------------------------------- voice */
const NAMES = sky.listBodies();
mountVoiceBar(document.getElementById("voice-host"), {
  hint: 'Try: “show me Saturn”, “go to year 1969”, “true scale”, “pause”.',
  handlers(phrase) {
    if (/\b(pause|stop moving|freeze)\b/.test(phrase)) {
      sky.pause(true);
      pauseBtn.textContent = "▶ Resume";
      return true;
    }
    if (/\b(resume|play|continue|go on)\b/.test(phrase)) {
      sky.pause(false);
      pauseBtn.textContent = "⏸ Pause";
      return true;
    }
    if (/\bfaster\b/.test(phrase)) {
      sky.setSpeed(sky.speed * 5);
      return true;
    }
    if (/\bslower\b/.test(phrase)) {
      sky.setSpeed(sky.speed / 5);
      return true;
    }
    if (/\breset\b/.test(phrase)) {
      sky.resetView();
      return true;
    }
    if (/\btrue scale\b/.test(phrase)) {
      sky.setScaleMode("true");
      scaleBtn.textContent = "Scale: true distances";
      return true;
    }
    if (/\b(compressed|normal scale)\b/.test(phrase)) {
      sky.setScaleMode("compressed");
      scaleBtn.textContent = "Scale: compressed";
      return true;
    }
    const year = phrase.match(/\b(1[5-9]\d\d|2[01]\d\d)\b/);
    if (year && /\b(year|go to|jump|set)\b/.test(phrase)) {
      const d = new Date(Date.UTC(parseInt(year[1], 10), 0, 1));
      sky.setDate(d);
      speak(`Clock set to ${year[1]}.`, "penguin");
      return true;
    }
    if (/\b(now|today|present)\b/.test(phrase) && /\b(go|set|jump)\b/.test(phrase)) {
      sky.setDate(new Date());
      return true;
    }
    const hit = NAMES.find((b) => phrase.includes(b.name.toLowerCase()) || phrase.includes(b.id));
    if (hit && /\b(show|focus|go|take|find|look)\b/.test(phrase)) {
      sky.focus(hit.id);
      speak(`Focusing on ${hit.name}.`, "penguin");
      return true;
    }
    return false;
  },
});

/* ------------------------------------------------ deep link ?id= */
const wanted = new URLSearchParams(location.search).get("id");
if (wanted) setTimeout(() => sky.focus(wanted), 400);

window.addEventListener("beforeunload", () => sky.dispose());
