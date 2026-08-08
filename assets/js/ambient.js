/* ============================================================
   ambient.js — JARVIS that is simply on.

   A small orb docked in the bottom-right corner of every page. Once
   you have granted the microphone a single time, it arms itself on
   every visit and stays listening. You speak, it answers out loud,
   it listens again. There is no button to press to talk.

   Two ways to get its attention:

     · Just talk. With the wake word switched off, anything it hears
       that looks like a request is answered.
     · Clap. A clap is a sharp broadband transient — a very fast rise
       in level followed by a fast decay — which is easy to pick out
       of the same analyser node that drives the orb's animation, and
       hard to trigger by accident with speech. Two claps arm it, so
       a single door slam does not.

   Because it is always listening, three things are non-negotiable:
   the microphone can be cut with one click, the state is always
   visible in the orb's colour, and nothing is recorded or uploaded —
   recognition happens in the browser and only the transcript exists.
   ============================================================ */

import { createOrb, createLevelMeter } from "./orb.js";
import { ask } from "./llm.js";
import { speak, stopSpeaking, canListen, canSpeak, isSpeaking } from "./voice.js";
import { learnFrom } from "./memory.js";
import { unreadCount, onActivity } from "./automate.js";
import { getSettings, saveSettings } from "./store.js";
import { escapeHtml } from "./ui.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const FAREWELL = /^(?:that'?s all|thanks jarvis|thank you jarvis|goodbye|bye jarvis|stand down|go to sleep)\b/i;
const HUSH = /^(?:stop|quiet|silence|hush|shut up|enough)\b/i;
/* Things people say to nobody. Answering these is what makes an
   always-on assistant unbearable, so they are dropped. */
const NOISE = /^(?:yeah|yes|no|ok|okay|hmm+|uh+|um+|ah+|right|sure|what|huh|hello|hi|mm+|so|well|and|the|a)\.?$/i;

export function mountAmbient() {
  if (!canListen() && !canSpeak()) return null;
  if (document.getElementById("ambient-dock")) return null;

  /* ------------------------------------------------------- the dock */
  const dock = document.createElement("div");
  dock.id = "ambient-dock";
  dock.innerHTML = `
    <button id="ambient-expand" class="ambient-expand" aria-expanded="false"
            aria-label="Show the JARVIS panel" title="Show the panel">⌃</button>
    <button id="ambient-orb-btn" class="ambient-orb" aria-label="JARVIS — click to mute or unmute the microphone" title="JARVIS">
      <canvas id="ambient-canvas"></canvas>
      <span class="ambient-badge" id="ambient-badge" hidden>0</span>
    </button>
    <div class="ambient-caption" id="ambient-caption" aria-live="polite"></div>
    <div class="ambient-panel" id="ambient-panel">
      <div class="ambient-panel-head">
        <strong id="ambient-state">Off</strong>
        <button class="btn ghost small" id="ambient-open">Open console</button>
        <button class="btn ghost small" id="ambient-hide" title="Hide the dock for this page">✕</button>
      </div>
      <div class="ambient-log" id="ambient-log"></div>
      <form class="ambient-type" id="ambient-form">
        <input id="ambient-input" placeholder="…or type it" autocomplete="off" aria-label="Type a request to JARVIS">
        <button class="btn primary small" type="submit">Ask</button>
      </form>
      <label class="ambient-toggle"><input type="checkbox" id="ambient-wake"> Only answer after “Jarvis” or a double clap</label>
    </div>`;
  document.body.appendChild(dock);

  const canvas = document.getElementById("ambient-canvas");
  const caption = document.getElementById("ambient-caption");
  const stateLabel = document.getElementById("ambient-state");
  const log = document.getElementById("ambient-log");
  const badge = document.getElementById("ambient-badge");
  const wakeBox = document.getElementById("ambient-wake");

  let orb = null;
  try {
    orb = createOrb(canvas, { detail: 3, particles: 220 });
  } catch { /* no WebGL: the dock still works, it just does not glow */ }

  /* ------------------------------------------------------- state */
  let recognition = null;
  let meter = null;
  let listening = false;
  let suspended = false;
  let busy = false;
  let requireWake = getSettings().requireWake ?? false;
  let armed = !requireWake;          // armed means "a request will be answered"
  let armedUntil = 0;
  let lastFinal = "";
  let lastFinalAt = 0;
  let restartTimer = 0;
  let loudSince = 0;

  wakeBox.checked = requireWake;

  const setState = (state, text) => {
    orb?.setState(state);
    dock.dataset.state = state;
    stateLabel.textContent = text;
  };

  const line = (who, text) => {
    const el = document.createElement("div");
    el.className = `ambient-line ${who}`;
    el.innerHTML = `<b>${who === "you" ? "You" : "JARVIS"}</b> ${escapeHtml(text)}`;
    log.appendChild(el);
    while (log.children.length > 12) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };

  const showCaption = (text, sticky = false) => {
    caption.textContent = text;
    caption.classList.toggle("show", !!text);
    if (!sticky && text) {
      clearTimeout(showCaption.timer);
      showCaption.timer = setTimeout(() => caption.classList.remove("show"), 4200);
    }
  };

  /* ------------------------------------------------- clap detection */

  /* A clap is a very fast attack. Speech rises over tens of
     milliseconds; a clap rises within one animation frame and decays
     almost as quickly. Requiring two within a short window means a
     dropped book or a cough will not wake it. */
  const clap = { last: 0, count: 0, previous: 0, peak: 0 };

  function detectClap(level) {
    const rise = level - clap.previous;
    clap.previous = level * 0.6 + clap.previous * 0.4;
    const now = Date.now();

    if (level > 0.82 && rise > 0.45 && now - clap.last > 140) {
      clap.last = now;
      clap.count = now - clap.previousClapAt < 900 ? clap.count + 1 : 1;
      clap.previousClapAt = now;

      if (clap.count >= 2) {
        clap.count = 0;
        return true;
      }
    }
    if (now - clap.previousClapAt > 1400) clap.count = 0;
    return false;
  }

  function onLevel(level) {
    orb?.setLevel(level);

    if (detectClap(level)) {
      armed = true;
      armedUntil = Date.now() + 15000;
      orb?.ping();
      showCaption("👏 Heard that — go ahead.");
      if (canSpeak() && !isSpeaking()) speak("Yes?", "penguin");
      setState("listening", "Listening");
      return;
    }

    // Barge-in: talking over a reply stops it.
    if (isSpeaking() && level > 0.62) {
      if (!loudSince) loudSince = Date.now();
      else if (Date.now() - loudSince > 420) {
        loudSince = 0;
        stopSpeaking();
        setState("listening", "Listening");
        busy = false;
        resume();
      }
    } else if (!isSpeaking()) {
      loudSince = 0;
    }
  }

  /* --------------------------------------------------- recognition */

  function build() {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.addEventListener("result", (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim.trim()) showCaption(interim.trim());
      if (final.trim()) handle(final.trim());
    });

    rec.addEventListener("error", (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stop();
        saveSettings({ ambient: false });
        showCaption("Microphone blocked. Allow it in the address bar to turn JARVIS back on.", true);
      }
    });

    rec.addEventListener("end", () => {
      if (listening && !suspended) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { try { rec.start(); } catch { /* already going */ } }, 250);
      }
    });
    return rec;
  }

  async function handle(text) {
    if (busy) return;
    if (text === lastFinal && Date.now() - lastFinalAt < 2500) return;
    lastFinal = text;
    lastFinalAt = Date.now();

    if (HUSH.test(text)) {
      stopSpeaking();
      setState("listening", "Listening");
      return;
    }
    if (FAREWELL.test(text)) {
      speak("Standing by. Clap twice or say Jarvis when you need me.", "penguin");
      armed = false;
      requireWake = true;
      wakeBox.checked = true;
      saveSettings({ requireWake: true });
      return;
    }
    if (NOISE.test(text.trim())) return;

    let request = text;
    if (requireWake && !(armed && Date.now() < armedUntil)) {
      const wake = text.toLowerCase().match(/\b(?:jarvis|jarvas|javis|garvis)\b[,:]?\s*(.*)$/);
      if (!wake) return;
      request = wake[1] || "";
      if (request.trim().length < 3) {
        armed = true;
        armedUntil = Date.now() + 15000;
        speak("Listening.", "penguin");
        return;
      }
    }
    if (request.trim().length < 4) return;

    await respond(request.trim());
  }

  async function respond(request) {
    busy = true;
    suspend();
    setState("thinking", "Thinking");
    showCaption(request, true);
    line("you", request);

    // Anything durable in what was just said is kept before we answer,
    // so the reply itself can already use it.
    const learned = learnFrom(request);

    let reply;
    try {
      reply = await ask(request, {
        onStage: (_s, message) => showCaption(message, true),
      });
    } catch (error) {
      reply = { text: `That failed on my side: ${error.message}`, reports: [] };
    }

    line("jarvis", reply.text);
    showCaption("");
    orb?.ping();

    if (learned.length) {
      const note = `Noted: ${learned.map((l) => l.text).join("; ")}`;
      line("jarvis", note);
    }

    if (canSpeak() && getSettings().narration !== false) {
      setState("speaking", "Speaking");
      const mentor = /why|feel|beautiful|soul|alone|meaning/i.test(request) ? "thorn" : "penguin";
      const spoken = learned.length ? `${reply.text} I have remembered that.` : reply.text;
      const ok = speak(spoken, mentor, {
        onend: () => {
          setState(listening ? "listening" : "idle", listening ? "Listening" : "Off");
          busy = false;
          if (requireWake) armed = false;
          resume();
        },
      });
      if (!ok) {
        setState(listening ? "listening" : "idle", listening ? "Listening" : "Off");
        busy = false;
        resume();
      }
    } else {
      setState(listening ? "listening" : "idle", listening ? "Listening" : "Off");
      busy = false;
      resume();
    }
  }

  function suspend() {
    suspended = true;
    clearTimeout(restartTimer);
    try { recognition?.stop(); } catch { /* not started */ }
  }

  function resume() {
    if (!listening) return;
    suspended = false;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { try { recognition?.start(); } catch { /* already going */ } }, 320);
  }

  /* --------------------------------------------------- start / stop */

  async function start({ announce = false } = {}) {
    if (listening) return true;
    if (!SR) {
      showCaption("Voice needs Chrome or Edge. The console still works by typing.", true);
      return false;
    }
    try {
      meter = await createLevelMeter(onLevel);
    } catch {
      // No microphone permission means no ambient listening at all.
      showCaption("Microphone refused. Click the orb once you have allowed it.", true);
      return false;
    }
    listening = true;
    recognition = build();
    try { recognition.start(); } catch { /* already going */ }
    setState("listening", "Listening");
    saveSettings({ ambient: true });
    if (announce && canSpeak()) speak("Jarvis is listening.", "penguin");
    showCaption(requireWake ? "Say “Jarvis”, or clap twice." : "Just talk — I am listening.");
    return true;
  }

  function stop() {
    listening = false;
    suspended = false;
    clearTimeout(restartTimer);
    stopSpeaking();
    try { recognition?.stop(); } catch { /* not started */ }
    recognition = null;
    meter?.stop();
    meter = null;
    orb?.setLevel(0);
    setState("idle", "Off");
    saveSettings({ ambient: false });
    showCaption("Microphone off. Click the orb to turn it back on.");
  }

  document.getElementById("ambient-orb-btn").addEventListener("click", () => {
    if (listening) stop();
    else start({ announce: true });
  });
  document.getElementById("ambient-open").addEventListener("click", () => {
    location.href = "company.html";
  });

  // Typing goes through exactly the same pipeline as speaking, so people
  // without a microphone are not second-class.
  document.getElementById("ambient-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("ambient-input");
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    dock.classList.remove("collapsed");
    await respond(text);
  });
  document.getElementById("ambient-hide").addEventListener("click", () => {
    dock.classList.remove("open");
  });
  /* Hover opens the panel for a mouse, but a phone has no hover at all —
     without this toggle nobody on a touch screen could type to JARVIS. */
  const expandBtn = document.getElementById("ambient-expand");
  expandBtn.addEventListener("click", () => {
    const open = dock.classList.toggle("open");
    expandBtn.setAttribute("aria-expanded", String(open));
    expandBtn.textContent = open ? "⌄" : "⌃";
    if (open) document.getElementById("ambient-input").focus();
  });

  wakeBox.addEventListener("change", () => {
    requireWake = wakeBox.checked;
    armed = !requireWake;
    saveSettings({ requireWake });
    showCaption(requireWake ? "I will wait for “Jarvis” or a double clap." : "I will answer anything I hear.");
  });

  /* ----------------------------------------------------- the badge */
  function paintBadge() {
    const n = unreadCount();
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? "9+" : String(n);
  }
  paintBadge();
  onActivity((event) => {
    paintBadge();
    if (event.type === "done") {
      line("jarvis", `${event.item.title} is ready for your approval.`);
      showCaption(`✅ ${event.item.title} — ready for you`);
    }
  });
  setInterval(paintBadge, 15000);

  setState("idle", "Off");

  /* Auto-arm for anyone who has used it before. A browser will only
     grant the microphone silently if permission was already given, so
     this cannot surprise a first-time visitor. */
  if (getSettings().ambient && SR) {
    navigator.permissions?.query({ name: "microphone" })
      .then((p) => { if (p.state === "granted") start(); })
      .catch(() => { /* the Permissions API is not everywhere; wait for a click */ });
  }

  return { start, stop, say: respond, get listening() { return listening; } };
}
