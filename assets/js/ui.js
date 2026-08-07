/* ============================================================
   ui.js — shared chrome: starfield, navbar, toasts, settings,
   accessibility controls and the auth guard.
   ============================================================ */

import {
  currentUser, logout, getSettings, saveSettings, getProgress,
  rankTitle, seedDemoUsers, exportData, importData,
} from "./store.js";
import { speak, stopSpeaking, canSpeak, canListen, createVoiceCommander } from "./voice.js";

export const NAV = [
  { href: "index.html", label: "Home", icon: "🏠" },
  { href: "jarvis.html", label: "JARVIS", icon: "🔮" },
  { href: "classroom.html", label: "Classroom", icon: "🪐" },
  { href: "cosmos.html", label: "Live Cosmos", icon: "🌍" },
  { href: "orbitlab.html", label: "Orbit Lab", icon: "🛰️" },
  { href: "codex.html", label: "Codex", icon: "📚" },
  { href: "mission-control.html", label: "Mission Control", icon: "📡" },
  { href: "agents.html", label: "Agent Mesh", icon: "🤖" },
  { href: "quantum.html", label: "Quantum Core", icon: "⚛️" },
  { href: "quiz.html", label: "Quiz", icon: "📝" },
  { href: "rankings.html", label: "Rankings", icon: "📊" },
  { href: "about.html", label: "About", icon: "📖" },
];

/* ---------------------------------------------------- Starfield */
function starfield() {
  const canvas = document.createElement("canvas");
  canvas.id = "starfield";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stars = [];
  let shooting = null;

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const count = Math.min(260, Math.round((canvas.width * canvas.height) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.2,
      a: Math.random(),
      s: Math.random() * 0.02 + 0.004,
      hue: Math.random() < 0.15 ? 320 : Math.random() < 0.3 ? 195 : 250,
    }));
  };
  resize();
  window.addEventListener("resize", resize);

  const frame = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      if (!reduced) {
        s.a += s.s;
        if (s.a > 1 || s.a < 0.05) s.s *= -1;
      }
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 90%, 82%, ${s.a})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduced) {
      if (!shooting && Math.random() < 0.0035) {
        shooting = { x: Math.random() * canvas.width * 0.7, y: Math.random() * canvas.height * 0.4, life: 1 };
      }
      if (shooting) {
        const { x, y } = shooting;
        const len = 130 * shooting.life;
        const grad = ctx.createLinearGradient(x, y, x + len, y + len * 0.5);
        grad.addColorStop(0, `rgba(255,255,255,${shooting.life})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + len * 0.5);
        ctx.stroke();
        shooting.x += 6;
        shooting.y += 3;
        shooting.life -= 0.012;
        if (shooting.life <= 0) shooting = null;
      }
    }
    requestAnimationFrame(frame);
  };
  frame();
}

/* -------------------------------------------------------- Toasts */
export function toast(message, kind = "") {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .4s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, 4200);
}

/* -------------------------------------------------------- Navbar */
function buildNav(active) {
  const user = currentUser();
  const progress = getProgress();
  const nav = document.createElement("nav");
  nav.className = "nav";
  nav.innerHTML = `
    <div class="wrap nav-inner">
      <a class="brand" href="index.html"><span class="orb"></span> Beyond Orbit <span class="muted" style="font-weight:400;font-size:.8rem">A Tale of Two Souls</span></a>
      <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button>
      <div class="nav-links" id="nav-links">
        ${NAV.map((n) => `<a href="${n.href}" ${n.href === active ? 'class="active" aria-current="page"' : ""}>${n.icon} ${n.label}</a>`).join("")}
        <button class="btn ghost small" id="open-settings" title="Accessibility, voice and data">⚙️ Settings</button>
        ${
          user
            ? `<span class="nav-user"><span class="avatar">${user.avatar || "🚀"}</span>
                 <span>${user.username}<br><span class="muted">${progress.xp} XP · ${rankTitle(progress.xp)}</span></span>
                 <button class="btn ghost small" id="logout-btn">Log out</button></span>`
            : `<a href="login.html" class="btn small">Login</a><a href="register.html" class="btn primary small">Register</a>`
        }
      </div>
    </div>`;
  document.body.prepend(nav);

  nav.querySelector(".nav-toggle").addEventListener("click", (e) => {
    const links = nav.querySelector("#nav-links");
    links.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", links.classList.contains("open"));
  });
  nav.querySelector("#logout-btn")?.addEventListener("click", () => {
    stopSpeaking();
    logout();
    window.location.href = "index.html";
  });
  nav.querySelector("#open-settings").addEventListener("click", openSettings);
}

function buildFooter() {
  if (document.querySelector("footer")) return;
  const f = document.createElement("footer");
  f.innerHTML = `<div class="wrap">
      <p class="poetic">“Every orbit we travel is a circle within our own soul.”</p>
      <p>© 2025 Beyond Orbit: A Tale of Two Souls · Beejalben Amitkumar Patel · M01035595 · Web Application &amp; Database</p>
      <p class="muted">Runs fully offline — progress is stored as JSON in your browser's localStorage.</p>
    </div>`;
  document.body.appendChild(f);
}

/* ------------------------------------------------------ Settings */
export function applySettings() {
  const s = getSettings();
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.dataset.readable = s.readable ? "on" : "off";
  document.documentElement.style.setProperty("--scale", s.scale);
}

function openSettings() {
  const s = getSettings();
  const dlg = document.createElement("dialog");
  dlg.style.cssText = "border:1px solid var(--line);border-radius:18px;background:var(--panel-solid);color:var(--ink);width:min(460px,92vw);padding:1.3rem;box-shadow:var(--shadow)";
  dlg.innerHTML = `
    <h2 style="margin-top:0">⚙️ Mission Settings</h2>
    <div class="field"><label for="set-theme">Theme</label>
      <select id="set-theme">
        <option value="nebula">Nebula (default)</option>
        <option value="dawn">Cosmic Dawn (warmer)</option>
        <option value="contrast">High Contrast</option>
      </select></div>
    <div class="field"><label for="set-scale">Text size — <span id="scale-val"></span></label>
      <input type="range" id="set-scale" min="0.85" max="1.5" step="0.05"></div>
    <div class="field"><label><input type="checkbox" id="set-readable" style="width:auto"> Extra-readable font &amp; spacing</label></div>
    <div class="field"><label><input type="checkbox" id="set-narration" style="width:auto"> Mentor narration (text to speech)</label></div>
    <div class="field"><label for="set-rate">Narration speed — <span id="rate-val"></span>×</label>
      <input type="range" id="set-rate" min="0.6" max="1.6" step="0.1"></div>
    <hr style="border-color:var(--line);margin:1rem 0">
    <div class="lesson-actions">
      <button class="btn small" id="export-btn">💾 Export progress</button>
      <label class="btn small" style="margin:0">📂 Import<input type="file" id="import-input" accept="application/json" hidden></label>
      <button class="btn small ghost" id="close-settings" style="margin-left:auto">Close</button>
    </div>
    <p class="hint" id="settings-note"></p>`;
  document.body.appendChild(dlg);

  const theme = dlg.querySelector("#set-theme");
  const scale = dlg.querySelector("#set-scale");
  const readable = dlg.querySelector("#set-readable");
  const narration = dlg.querySelector("#set-narration");
  const rate = dlg.querySelector("#set-rate");
  theme.value = s.theme;
  scale.value = s.scale;
  readable.checked = s.readable;
  narration.checked = s.narration;
  rate.value = s.rate;
  dlg.querySelector("#scale-val").textContent = `${Math.round(s.scale * 100)}%`;
  dlg.querySelector("#rate-val").textContent = s.rate;

  const sync = () => {
    saveSettings({
      theme: theme.value,
      scale: parseFloat(scale.value),
      readable: readable.checked,
      narration: narration.checked,
      rate: parseFloat(rate.value),
    });
    dlg.querySelector("#scale-val").textContent = `${Math.round(scale.value * 100)}%`;
    dlg.querySelector("#rate-val").textContent = rate.value;
    applySettings();
  };
  [theme, scale, readable, narration, rate].forEach((el) => el.addEventListener("input", sync));

  dlg.querySelector("#export-btn").addEventListener("click", () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "beyond-orbit-capsule.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("💾 Time capsule exported.", "good");
  });
  dlg.querySelector("#import-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const count = importData(await file.text());
      dlg.querySelector("#settings-note").textContent = `Imported ${count} cadet record(s).`;
      toast("📂 Capsule restored.", "good");
    } catch (err) {
      dlg.querySelector("#settings-note").textContent = err.message;
    }
  });
  dlg.querySelector("#close-settings").addEventListener("click", () => { dlg.close(); dlg.remove(); });
  dlg.showModal();
}

/* --------------------------------------------------- Auth guard */
export function requireLogin() {
  if (currentUser()) return true;
  const main = document.querySelector("main .wrap") || document.querySelector("main") || document.body;
  main.innerHTML = `<div class="card" style="text-align:center">
      <h1>🔒 The airlock is closed, traveller</h1>
      <p class="poetic">“No soul crosses orbit without a name.”</p>
      <p>Log in or register to record your XP, badges and place on the leaderboard.</p>
      <p class="lesson-actions" style="justify-content:center">
        <a class="btn primary" href="login.html">Login</a>
        <a class="btn ice" href="register.html">Register</a>
        <a class="btn ghost" href="index.html">Back home</a>
      </p></div>`;
  return false;
}

/* ------------------------------------------------- Voice toolbar */
export function mountVoiceBar(host, { handlers, hint } = {}) {
  if (!host) return null;
  const bar = document.createElement("div");
  bar.className = "voice-bar";
  bar.innerHTML = `
    <strong>🎙️ Voice</strong>
    <button class="btn small" id="vc-toggle">${canListen() ? "Start listening" : "Not supported here"}</button>
    <button class="btn small ghost" id="vc-stop-speech">🔇 Stop narration</button>
    <span class="muted" id="vc-status">${hint || 'Try: “open cosmos”, “go to quiz”, “read this level”.'}</span>`;
  host.appendChild(bar);

  const btn = bar.querySelector("#vc-toggle");
  const status = bar.querySelector("#vc-status");
  bar.querySelector("#vc-stop-speech").addEventListener("click", stopSpeaking);

  if (!canListen()) {
    btn.disabled = true;
    status.textContent = "Voice commands need Chrome or Edge. Narration still works everywhere.";
    return null;
  }

  const commander = createVoiceCommander({
    handlers: handlers || (() => false),
    onHeard: (phrase) => (status.textContent = `heard: “${phrase}”`),
    onState: (on, err) => {
      btn.textContent = on ? "🔴 Listening… (stop)" : "Start listening";
      btn.classList.toggle("mic-live", on);
      if (err) status.textContent = `microphone: ${err}`;
    },
  });
  let on = false;
  btn.addEventListener("click", () => {
    on = !on;
    if (on) { commander.start(); speak("I am listening.", "penguin"); }
    else commander.stop();
  });
  return commander;
}

/* ------------------------------------------------------ Bootstrap */
export function initShell(activePage) {
  applySettings();
  seedDemoUsers();
  starfield();
  buildNav(activePage);
  buildFooter();
  if (!canSpeak()) console.info("Speech synthesis unavailable in this browser.");
  import("./mentor.js").then((m) => m.mountMentor()).catch(() => {});
  // Train the quantum classifier off the critical path, so a first visit
  // never waits on it. Cached weights make every later visit instant.
  import("./qml.js").then((m) => m.warmUp()).catch(() => {});
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

export const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
