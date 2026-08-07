/* ============================================================
   mentor.js — JARVIS, the voice of the Beyond Orbit mesh.

   A floating console available on every page. It listens (Web
   Speech Recognition), thinks (routes the request across the agent
   mesh), answers (renders the reports) and speaks (Web Speech
   Synthesis, one voice per mentor).

   Wake word: say "Jarvis" and the console opens itself, even when
   the page is only sitting in a background tab, provided the
   microphone was armed at least once.
   ============================================================ */

import { dispatch, speakable, AGENT_COUNT, MESH_STATS } from "./agents.js";
import { speak, stopSpeaking, canListen, canSpeak, createVoiceCommander } from "./voice.js";
import { escapeHtml } from "./ui.js";
import { getSettings, saveSettings, currentUser } from "./store.js";

const HISTORY_KEY = "bo_jarvis_log";
const MAX_HISTORY = 40;

const loadLog = () => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
};
const saveLog = (log) => localStorage.setItem(HISTORY_KEY, JSON.stringify(log.slice(-MAX_HISTORY)));

const SUGGESTIONS = [
  "where is the ISS right now",
  "how far is Mars today",
  "Hohmann transfer 400 km to 35786 km",
  "python code to track a satellite",
  "who launches rockets from India",
  "sun synchronous orbit at 700 km",
  "power budget 250 W at 550 km",
  "best launch site for a geostationary mission",
  "quantum key distribution over 1200 km",
  "is Europa habitable",
];

export function mountMentor() {
  if (document.getElementById("mentor-fab")) return;

  const fab = document.createElement("button");
  fab.id = "mentor-fab";
  fab.type = "button";
  fab.title = `Open JARVIS — ${AGENT_COUNT} agents standing by`;
  fab.setAttribute("aria-label", "Open the JARVIS console");
  fab.textContent = "🛰️";
  document.body.appendChild(fab);

  const panel = document.createElement("section");
  panel.id = "mentor-panel";
  panel.setAttribute("aria-label", "JARVIS console");
  panel.innerHTML = `
    <header class="mentor-head">
      <span class="avatar">🛰️</span>
      <div style="flex:1;line-height:1.25">
        <strong>JARVIS</strong><br>
        <span class="muted" style="font-size:.72rem">${AGENT_COUNT} agents · ${MESH_STATS.domains} domains · running in this browser</span>
      </div>
      <button class="btn ghost small" id="jarvis-mic" title="Toggle the microphone">🎙️</button>
      <button class="btn ghost small" id="jarvis-close" title="Close">✕</button>
    </header>
    <div class="mentor-log" id="jarvis-log"></div>
    <div class="jarvis-chips" id="jarvis-chips"></div>
    <form class="mentor-input" id="jarvis-form">
      <input id="jarvis-input" placeholder="Ask the mesh anything about space…" autocomplete="off" aria-label="Ask JARVIS">
      <button class="btn primary small" type="submit">Send</button>
    </form>`;
  document.body.appendChild(panel);

  const log = panel.querySelector("#jarvis-log");
  const input = panel.querySelector("#jarvis-input");
  const chips = panel.querySelector("#jarvis-chips");
  const micBtn = panel.querySelector("#jarvis-mic");

  for (const s of SUGGESTIONS.slice(0, 4)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = s;
    chip.addEventListener("click", () => ask(s));
    chips.appendChild(chip);
  }

  /* --------------------------------------------------- rendering */
  function bubble(html, kind) {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function renderResult(result) {
    const parts = [];
    for (const r of result.reports) {
      parts.push(`<div class="agent-report">
        <strong>${escapeHtml(r.title)}</strong>
        <div class="muted" style="font-size:.72rem;margin-bottom:.3rem">${escapeHtml(r.agent?.name || "mesh")} · ${escapeHtml(r.agent?.domain || "")}${r.source ? ` · data ${escapeHtml(r.source)}` : ""}</div>
        <ul>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
        ${r.code ? `<pre class="code"><code>${escapeHtml(r.code)}</code></pre>` : ""}
      </div>`);
    }
    parts.push(
      `<div class="muted" style="font-size:.7rem">${result.agents.length} agent(s) answered in ${result.ms} ms</div>`
    );
    return parts.join("");
  }

  let busy = false;
  async function ask(question) {
    const text = (question || "").trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    bubble(escapeHtml(text), "user");
    const thinking = bubble("<em>routing across the mesh…</em>", "penguin");

    const result = await dispatch(text, {
      limit: 3,
      context: { user: currentUser()?.username || null },
    });
    thinking.remove();
    bubble(renderResult(result), "penguin");

    const history = loadLog();
    history.push({ q: text, at: Date.now(), agents: result.agents.map((a) => a.name) });
    saveLog(history);

    if (getSettings().narration) speak(speakable(result), "penguin");
    busy = false;
  }

  panel.querySelector("#jarvis-form").addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });

  /* ------------------------------------------------------ opening */
  const open = (why) => {
    panel.classList.add("open");
    fab.textContent = "✕";
    if (!log.childElementCount) {
      const user = currentUser();
      bubble(
        `<strong>JARVIS online.</strong><br>${user ? `Good to see you, cadet ${escapeHtml(user.username)}. ` : ""}` +
          `${AGENT_COUNT} specialist agents are loaded — ${MESH_STATS.knowledge} on the codex, ${MESH_STATS.industry} on the space industry, ` +
          `${MESH_STATS.constellations} on live satellite groups, ${MESH_STATS.skills} engineering calculators. ` +
          `Ask in plain language, or say <b>“Jarvis”</b> out loud to summon me.`,
        "thorn"
      );
    }
    if (why === "voice" && canSpeak()) speak("Jarvis online. What do you need?", "penguin");
    input.focus();
  };
  const close = () => {
    panel.classList.remove("open");
    fab.textContent = "🛰️";
  };
  fab.addEventListener("click", () => (panel.classList.contains("open") ? close() : open("click")));
  panel.querySelector("#jarvis-close").addEventListener("click", close);

  /* -------------------------------------------------- voice input */
  let commander = null;
  let listening = false;

  const setMicState = (on, err) => {
    listening = on;
    micBtn.textContent = on ? "🔴" : "🎙️";
    micBtn.classList.toggle("mic-live", on);
    micBtn.title = err ? `Microphone: ${err}` : on ? "Listening — click to stop" : "Start listening";
  };

  /**
   * Handles a heard phrase. Anything after the wake word is treated
   * as a request; "stop" silences the narration immediately.
   */
  function handlePhrase(phrase) {
    const clean = phrase.trim().toLowerCase();
    if (!clean) return false;
    if (/^(stop|quiet|silence|hush|shut up)\b/.test(clean)) {
      stopSpeaking();
      return true;
    }
    const wake = clean.match(/\b(jarvis|jarvas|javis|service|garvis)\b[,:]?\s*(.*)$/);
    if (wake) {
      if (!panel.classList.contains("open")) open("voice");
      const request = wake[2];
      if (request && request.length > 2) ask(request);
      else if (canSpeak()) speak("Listening.", "penguin");
      return true;
    }
    // With the console already open, speak freely — no wake word needed.
    if (panel.classList.contains("open")) {
      ask(phrase);
      return true;
    }
    return false;
  }

  function toggleMic() {
    if (!canListen()) {
      bubble(
        "Voice input needs Chrome or Edge — this browser has no Speech Recognition. Typing works everywhere, and narration still speaks the answers.",
        "penguin"
      );
      if (!panel.classList.contains("open")) open("click");
      return;
    }
    if (listening) {
      commander?.stop();
      setMicState(false);
      return;
    }
    commander =
      commander ||
      createVoiceCommander({
        handlers: handlePhrase,
        onState: setMicState,
        onHeard: () => {},
      });
    commander.start();
    setMicState(true);
    saveSettings({ voiceCommands: true });
  }
  micBtn.addEventListener("click", toggleMic);

  // Re-arm the microphone automatically for cadets who left it on.
  if (getSettings().voiceCommands && canListen()) {
    setTimeout(toggleMic, 800);
  }

  /* ------------------------------------------------- keyboard */
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) close();
    if (e.key === "/" && e.ctrlKey) {
      e.preventDefault();
      panel.classList.contains("open") ? close() : open("click");
    }
    if (e.key.toLowerCase() === "j" && e.altKey) {
      e.preventDefault();
      toggleMic();
      if (!panel.classList.contains("open")) open("voice");
    }
  });

  return { ask, open, close, toggleMic };
}
