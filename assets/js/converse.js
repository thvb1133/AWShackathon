/* ============================================================
   converse.js — the talking loop.

   Listen, understand, answer, speak, listen again. This is the piece
   that makes the orb a conversation rather than a search box.

   The awkward part of building this is that a browser will happily let
   the speech recogniser hear the speech synthesiser, at which point the
   assistant starts answering itself. So recognition is suspended for
   the duration of every reply and resumed the instant it finishes.

   Barge-in is handled from the other direction. While the assistant is
   speaking, the microphone level meter keeps running, and a sustained
   burst of loudness cuts the reply short and hands the turn back to
   you — which is what interrupting means.
   ============================================================ */

import { ask } from "./llm.js";
import { speak, stopSpeaking, canListen, canSpeak, isSpeaking } from "./voice.js";
import { createLevelMeter } from "./orb.js";
import { getSettings } from "./store.js";

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Phrases that end the conversation rather than being answered. */
const FAREWELLS = /^(?:that'?s all|thank you jarvis|goodbye|bye|stop listening|go to sleep|sleep now)\b/i;
/** Phrases that only silence the current reply. */
const INTERRUPTS = /^(?:stop|quiet|silence|hush|shut up|enough)\b/i;

export function createConversation({
  orb,
  onState,
  onTranscript,
  onReply,
  onStage,
  onError,
  requireWake = false,
} = {}) {
  let recognition = null;
  let meter = null;
  let running = false;
  let suspended = false;      // recognition paused while we speak
  let busy = false;           // a request is in flight
  let level = 0;
  let loudSince = 0;
  let restartTimer = 0;
  let lastFinal = "";
  let lastFinalAt = 0;

  const setState = (s) => {
    orb?.setState(s);
    onState?.(s);
  };

  /* ------------------------------------------------- recognition */

  function buildRecognition() {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    rec.addEventListener("result", (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) onTranscript?.(interim.trim(), false);
      if (final.trim()) handleFinal(final.trim());
    });

    rec.addEventListener("error", (event) => {
      // "no-speech" and "aborted" are routine; anything else is worth saying.
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        running = false;
        setState("idle");
        onError?.("Microphone permission was refused. Grant it in the address bar, then press Start again.");
        return;
      }
      onError?.(`Microphone: ${event.error}`);
    });

    rec.addEventListener("end", () => {
      // Chrome stops recognition on its own after a pause; restart unless
      // we deliberately suspended it to speak.
      if (running && !suspended) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          try { rec.start(); } catch { /* already running */ }
        }, 250);
      }
    });

    return rec;
  }

  /* --------------------------------------------------- the turn */

  async function handleFinal(text) {
    if (!text || busy) return;

    // Chrome sometimes repeats a final result; ignore an exact echo.
    if (text === lastFinal && Date.now() - lastFinalAt < 2500) return;
    lastFinal = text;
    lastFinalAt = Date.now();

    if (INTERRUPTS.test(text)) {
      stopSpeaking();
      setState("listening");
      onTranscript?.(text, true);
      return;
    }
    if (FAREWELLS.test(text)) {
      onTranscript?.(text, true);
      speak("Standing by. Say Jarvis when you need me.", "penguin");
      stop();
      return;
    }

    let request = text;
    if (requireWake) {
      const wake = text.toLowerCase().match(/\b(?:jarvis|jarvas|javis|garvis)\b[,:]?\s*(.*)$/);
      if (!wake) return;                       // not addressed to us
      request = wake[1] || "";
      if (request.trim().length < 2) {
        speak("Listening.", "penguin");
        return;
      }
    }
    if (request.trim().length < 2) return;

    onTranscript?.(request.trim(), true);
    await respond(request.trim());
  }

  /** Runs one request through the pipeline and speaks the answer. */
  async function respond(request) {
    busy = true;
    suspend();
    setState("thinking");

    let reply;
    try {
      reply = await ask(request, { onStage });
    } catch (error) {
      reply = { text: `Something failed on my side: ${error.message}`, reports: [], error: error.message };
    }

    onReply?.(reply);
    orb?.ping();

    if (!getSettings().narration || !canSpeak()) {
      // Narration switched off: hand the turn straight back.
      setState("listening");
      busy = false;
      resume();
      return;
    }

    setState("speaking");
    const mentor = /thorn|poet|beaut|feel|soul|why/i.test(request) ? "thorn" : "penguin";
    const spoke = speak(reply.text, mentor, {
      onend: () => {
        setState(running ? "listening" : "idle");
        busy = false;
        resume();
      },
    });

    if (!spoke) {
      setState(running ? "listening" : "idle");
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
    if (!running) return;
    suspended = false;
    clearTimeout(restartTimer);
    // A short delay lets the audio output tail off before the mic reopens.
    restartTimer = setTimeout(() => {
      try { recognition?.start(); } catch { /* already running */ }
    }, 320);
  }

  /* ------------------------------------------------ barge-in watch */

  function onMeter(normalised) {
    level = normalised;
    orb?.setLevel(normalised);

    if (!isSpeaking()) {
      loudSince = 0;
      return;
    }
    // Sustained loudness while we are talking means the user wants the floor.
    if (normalised > 0.62) {
      if (!loudSince) loudSince = Date.now();
      else if (Date.now() - loudSince > 420) {
        loudSince = 0;
        stopSpeaking();
        onStage?.("interrupted", "You interrupted — go ahead.");
        setState("listening");
        busy = false;
        resume();
      }
    } else {
      loudSince = 0;
    }
  }

  /* ------------------------------------------------------- control */

  async function start() {
    if (running) return { ok: true };
    if (!SR) {
      onError?.("This browser has no Speech Recognition. Chrome or Edge can listen; typing works everywhere and the orb still speaks its answers.");
      return { ok: false, reason: "no-recognition" };
    }
    running = true;

    // The meter is optional: refuse the microphone and you lose the
    // reactive visuals and barge-in, but the conversation still works.
    try {
      meter = await createLevelMeter(onMeter);
    } catch (error) {
      onError?.(`Level metering unavailable (${error.message}). The orb will still answer.`);
    }

    recognition = buildRecognition();
    try {
      recognition.start();
    } catch { /* already started */ }
    setState("listening");
    return { ok: true };
  }

  function stop() {
    running = false;
    suspended = false;
    clearTimeout(restartTimer);
    stopSpeaking();
    try { recognition?.stop(); } catch { /* not started */ }
    recognition = null;
    meter?.stop();
    meter = null;
    orb?.setLevel(0);
    setState("idle");
  }

  return {
    start,
    stop,
    get running() { return running; },
    get busy() { return busy; },
    get level() { return level; },
    /** Sends a typed request through exactly the same pipeline. */
    async say(text) {
      if (busy) return;
      onTranscript?.(text, true);
      await respond(text);
    },
    setRequireWake(v) { requireWake = !!v; },
    supported: { listen: canListen(), speak: canSpeak() },
  };
}
