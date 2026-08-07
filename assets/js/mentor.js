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

import { AGENT_COUNT, MESH_STATS } from "./agents.js";
import { ask, describeSetup } from "./llm.js";
import { INTENTS } from "./qml.js";
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
    chip.addEventListener("click", () => askJarvis(s));
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

  /** The prose answer, then the agent reports that back it up. */
  function renderReply(reply) {
    const intentChip = reply.intent
      ? `<span class="chip">${INTENTS[reply.intent.intent]?.emoji || ""} ${escapeHtml(INTENTS[reply.intent.intent]?.label || "")} ${(reply.intent.confidence * 100).toFixed(0)}%</span>`
      : "";
    const sources = (reply.reports || [])
      .map((r) => `<li><b>${escapeHtml(r.agent?.name || "mesh")}</b> — ${escapeHtml(r.title)}
        ${r.source ? `<span class="muted">(data ${escapeHtml(r.source)})</span>` : ""}
        <ul>${r.lines.slice(0, 4).map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul></li>`)
      .join("");

    return `<div>${escapeHtml(reply.text)}</div>
      ${reply.code ? `<pre class="code"><code>${escapeHtml(reply.code.code)}</code></pre>` : ""}
      ${sources ? `<details style="margin-top:.5rem"><summary class="muted" style="font-size:.72rem;cursor:pointer">
        Show the ${reply.reports.length} agent report(s) behind this</summary>
        <ul style="font-size:.8rem;padding-left:1rem">${sources}</ul></details>` : ""}
      <div class="muted" style="font-size:.7rem;margin-top:.35rem">${intentChip}
        ${escapeHtml(reply.provider || "mesh")} · ${reply.ms} ms</div>`;
  }

  let busy = false;
  async function askJarvis(question) {
    const text = (question || "").trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    bubble(escapeHtml(text), "user");
    const thinking = bubble("<em>classifying on the quantum circuit…</em>", "penguin");

    const reply = await ask(text, {
      onStage: (_stage, message) => { thinking.innerHTML = `<em>${escapeHtml(message)}</em>`; },
    });
    thinking.remove();
    bubble(renderReply(reply), "penguin");

    const history = loadLog();
    history.push({ q: text, at: Date.now(), intent: reply.intent?.intent, provider: reply.provider });
    saveLog(history);

    if (getSettings().narration) speak(reply.text, "penguin");
    busy = false;
  }

  panel.querySelector("#jarvis-form").addEventListener("submit", (e) => {
    e.preventDefault();
    askJarvis(input.value);
  });

  /* ------------------------------------------------------ opening */
  const open = (why) => {
    panel.classList.add("open");
    fab.textContent = "✕";
    if (!log.childElementCount) {
      const user = currentUser();
      const setup = describeSetup();
      bubble(
        `<strong>JARVIS online.</strong><br>${user ? `Good to see you, cadet ${escapeHtml(user.username)}. ` : ""}` +
          `Your words are classified on a quantum circuit, answered by ${AGENT_COUNT} specialist agents, ` +
          `and phrased by <b>${escapeHtml(setup.provider)}</b>.<br>` +
          `Ask in plain language, or say <b>“Jarvis”</b> out loud. ` +
          `<a href="jarvis.html">Open the full orb console →</a>`,
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
      if (request && request.length > 2) askJarvis(request);
      else if (canSpeak()) speak("Listening.", "penguin");
      return true;
    }
    // With the console already open, speak freely — no wake word needed.
    if (panel.classList.contains("open")) {
      askJarvis(phrase);
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

  return { ask: askJarvis, open, close, toggleMic };
}
