/* ============================================================
   voice.js — the two souls speak, and the cosmos listens.
   Narration  : Web Speech Synthesis, one voice per mentor.
   Commands   : Web Speech Recognition (Chrome/Edge), optional.
   ============================================================ */

import { getSettings, saveSettings } from "./store.js";

const synth = window.speechSynthesis || null;
export const canSpeak = () => !!synth;

let voices = [];
const loadVoices = () => {
  if (!synth) return;
  voices = synth.getVoices();
};
loadVoices();
if (synth) synth.addEventListener("voiceschanged", loadVoices);

/* Mentor voice personalities. THORN BIRD = warm and high, PENGUIN = cool and low. */
const PROFILES = {
  thorn: { pitch: 1.35, rate: 0.94, prefer: ["female", "zira", "samantha", "victoria", "google uk english female", "karen"] },
  penguin: { pitch: 0.72, rate: 1.02, prefer: ["male", "david", "daniel", "alex", "google uk english male", "fred"] },
  narrator: { pitch: 1, rate: 1, prefer: ["google us english", "samantha"] },
};

function pickVoice(who) {
  if (!voices.length) loadVoices();
  const wanted = PROFILES[who] || PROFILES.narrator;
  const english = voices.filter((v) => /^en/i.test(v.lang));
  const pool = english.length ? english : voices;
  for (const hint of wanted.prefer) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(hint));
    if (hit) return hit;
  }
  if (who === "penguin" && pool.length > 1) return pool[pool.length - 1];
  return pool[0] || null;
}

export function stopSpeaking() {
  if (synth) synth.cancel();
}

/** Speak text as a mentor. Strips emoji so the voice does not read "rocket". */
export function speak(text, who = "narrator", { onend } = {}) {
  if (!synth) return false;
  const settings = getSettings();
  if (!settings.narration) return false;
  synth.cancel();
  const clean = String(text)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/[*_#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;

  // Long lessons are chunked: some browsers silently cut off after ~250 chars.
  const chunks = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const profile = PROFILES[who] || PROFILES.narrator;
  const voice = pickVoice(who);
  const batched = [];
  let buffer = "";
  for (const c of chunks) {
    if ((buffer + c).length > 200) {
      batched.push(buffer);
      buffer = c;
    } else buffer += c;
  }
  if (buffer.trim()) batched.push(buffer);

  batched.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part.trim());
    if (voice) u.voice = voice;
    u.pitch = profile.pitch;
    u.rate = profile.rate * (settings.rate || 1);
    u.volume = 1;
    if (i === batched.length - 1 && onend) u.addEventListener("end", onend);
    synth.speak(u);
  });
  return true;
}

export const isSpeaking = () => !!synth && (synth.speaking || synth.pending);

/* ------------------------------------------------ Voice commands */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;

const ROUTES = [
  [/\b(home|start page)\b/, "index.html"],
  [/\b(classroom|class room|lessons?)\b/, "classroom.html"],
  [/\b(cosmos|solar system|planets?|3d|three d)\b/, "cosmos.html"],
  [/\b(orbit lab|orbitlab|satellites?|globe|earth orbit)\b/, "orbitlab.html"],
  [/\b(codex|encyclopedia|encyclopaedia|library|search)\b/, "codex.html"],
  [/\b(mission control|live data|dashboard|nasa)\b/, "mission-control.html"],
  [/\b(agents?|mesh|jarvis console)\b/, "agents.html"],
  [/\b(operations?|company|inbox|memory|automations?|crew)\b/, "company.html"],
  [/\b(quiz|test|reflection)\b/, "quiz.html"],
  [/\b(ranking|leaderboard|scores?)\b/, "rankings.html"],
  [/\b(about|story|legend)\b/, "about.html"],
  [/\b(thorn ?bird|thorn)\b/, "mrs-thorn-bird-1.html"],
  [/\b(penguin|tech)\b/, "mr-penguin-1.html"],
  [/\b(log ?in|sign in)\b/, "login.html"],
  [/\b(register|sign up)\b/, "register.html"],
];

/**
 * Starts continuous listening. `handlers` may implement page-specific verbs
 * and should return true when it has consumed the phrase.
 */
export function createVoiceCommander({ onState, onHeard, handlers = () => false } = {}) {
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = "en-US";
  let active = false;
  let manualStop = false;

  rec.addEventListener("result", (event) => {
    const phrase = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
    onHeard?.(phrase);
    if (handlers(phrase)) return;
    if (/\b(stop|quiet|silence|hush)\b/.test(phrase)) return stopSpeaking();
    for (const [pattern, url] of ROUTES) {
      if (/\b(go|open|take me|navigate|show)\b/.test(phrase) && pattern.test(phrase)) {
        speak("Course set.", "penguin");
        setTimeout(() => (window.location.href = url), 500);
        return;
      }
    }
  });
  rec.addEventListener("start", () => { active = true; onState?.(true); });
  rec.addEventListener("end", () => {
    active = false;
    onState?.(false);
    if (!manualStop) setTimeout(() => { try { rec.start(); } catch {} }, 400);
  });
  rec.addEventListener("error", (e) => onState?.(false, e.error));

  return {
    start() { manualStop = false; try { rec.start(); } catch {} saveSettings({ voiceCommands: true }); },
    stop() { manualStop = true; try { rec.stop(); } catch {} saveSettings({ voiceCommands: false }); },
    get active() { return active; },
  };
}
