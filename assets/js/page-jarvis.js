/* JARVIS page: the orb, the conversation loop and the brain settings. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { createOrb } from "./orb.js";
import { createConversation } from "./converse.js";
import { PROVIDERS, PROVIDER_IDS, getConfig, saveConfig, forgetKey, testConnection, describeSetup, llmEnabled, clearConversation } from "./llm.js";
import { INTENTS, describeModel } from "./qml.js";
import { stopSpeaking, canListen, canSpeak } from "./voice.js";
import { getSettings, saveSettings } from "./store.js";

initShell("jarvis.html");

/* ----------------------------------------------------------- the orb */
const canvas = document.getElementById("orb-canvas");
let orb = null;
try {
  orb = createOrb(canvas);
} catch (error) {
  canvas.replaceWith(
    Object.assign(document.createElement("p"), {
      className: "muted center",
      textContent: `The orb needs WebGL, which this browser has not provided (${error.message}). The conversation still works.`,
    })
  );
}

/* ------------------------------------------------------- the loop */
const stateLine = document.getElementById("orb-state-line");
const interim = document.getElementById("live-interim");
const transcript = document.getElementById("transcript");
const explain = document.getElementById("explain");
const talkBtn = document.getElementById("btn-talk");

const STATE_COPY = {
  idle: "Standing by. Press <b>Start talking</b>, or type below.",
  listening: "🎙️ <b>Listening.</b> Speak naturally — I answer when you pause.",
  thinking: "⚛️ <b>Thinking.</b> Quantum classifier, then the agent mesh, then the words.",
  speaking: "🔊 <b>Speaking.</b> Talk over me and I will stop.",
};

function bubble(html, kind) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  el.innerHTML = html;
  transcript.appendChild(el);
  transcript.scrollTop = transcript.scrollHeight;
  return el;
}

const litStage = (id) => {
  for (const el of document.querySelectorAll("#pipeline-strip .chip")) el.classList.remove("chip-live");
  if (id) document.getElementById(id)?.classList.add("chip-live");
};

const conversation = createConversation({
  orb,
  requireWake: getSettings().requireWake,

  onState(state) {
    stateLine.innerHTML = STATE_COPY[state] || "";
    talkBtn.textContent = conversation.running ? "⏹ Stop talking" : "🎙️ Start talking";
    talkBtn.classList.toggle("mic-live", state === "listening");
    if (state === "listening") litStage("stage-voice");
    if (state === "speaking") litStage("stage-voice");
    if (state === "idle") litStage(null);
  },

  onTranscript(text, isFinal) {
    if (isFinal) {
      interim.innerHTML = "&nbsp;";
      bubble(escapeHtml(text), "user");
    } else {
      interim.textContent = `… ${text}`;
    }
  },

  onStage(stage, message) {
    if (stage === "routing") litStage("stage-quantum");
    else if (stage === "mesh") litStage("stage-mesh");
    else if (stage === "thinking") litStage("stage-llm");
    interim.textContent = message;
  },

  onReply(reply) {
    interim.innerHTML = "&nbsp;";
    bubble(
      `${escapeHtml(reply.text)}
       <div class="muted" style="font-size:.7rem;margin-top:.4rem">
         ${escapeHtml(reply.provider || "mesh")}${reply.model ? ` · ${escapeHtml(reply.model)}` : ""} ·
         ${reply.ms} ms${reply.grounded ? " · grounded in the mesh" : ""}
       </div>
       ${reply.code ? `<pre class="code"><code>${escapeHtml(reply.code.code)}</code></pre>` : ""}`,
      "penguin"
    );
    showExplanation(reply);
  },

  onError(message) {
    toast(escapeHtml(message), "bad");
    interim.innerHTML = "&nbsp;";
  },
});

function showExplanation(reply) {
  const intent = reply.intent;
  if (!intent) {
    explain.innerHTML = `<p class="muted">Nothing to show yet.</p>`;
    return;
  }
  const bar = (v) => `<div class="bar" style="height:6px"><span style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></div>`;
  explain.innerHTML = `
    <p><b>1. Quantum routing</b></p>
    <p class="muted" style="font-size:.84rem">
      Intent <b>${INTENTS[intent.intent]?.emoji || ""} ${escapeHtml(INTENTS[intent.intent]?.label || intent.intent)}</b>,
      confidence ${(intent.confidence * 100).toFixed(0)}%, margin ${intent.margin.toFixed(3)}.
      The variational circuit and the quantum kernel ${intent.agree ? "<span class='tick'>agreed</span>" : "<span class='cross'>disagreed, so the search was widened</span>"}.
    </p>
    <table style="font-size:.78rem">
      <thead><tr><th>Intent</th><th>Variational</th><th>Kernel</th></tr></thead>
      <tbody>${Object.keys(INTENTS).map((i) => `<tr${i === intent.intent ? ' class="me"' : ""}>
        <td>${INTENTS[i].emoji} ${escapeHtml(INTENTS[i].label)}</td>
        <td style="min-width:70px">${bar(intent.variational[i])}</td>
        <td style="min-width:70px">${bar(intent.kernel[i])}</td></tr>`).join("")}</tbody>
    </table>
    <p class="muted" style="font-size:.76rem">Encoded angles: ${intent.features.map((f) => f.toFixed(2)).join(", ")} radians on ${describeModel().qubits} qubits.</p>

    <p class="mt"><b>2. Agent mesh</b></p>
    <ul style="font-size:.82rem">${(reply.reports || []).map((r) => `<li><b>${escapeHtml(r.agent?.name || "mesh")}</b>
      <span class="muted">${escapeHtml(r.agent?.domain || "")}${r.source ? ` · data ${escapeHtml(r.source)}` : ""}</span></li>`).join("") || "<li class='muted'>No specialist matched.</li>"}</ul>

    <p class="mt"><b>3. Words</b></p>
    <p class="muted" style="font-size:.82rem">${escapeHtml(reply.provider || "mesh")}${reply.error ? ` — ${escapeHtml(reply.error)}` : ""}.
      ${reply.grounded ? "The facts above were handed to it as context it must not contradict." : "Answered without mesh grounding."}</p>`;
}

/* ------------------------------------------------------- controls */
talkBtn.addEventListener("click", async () => {
  if (conversation.running) {
    conversation.stop();
    return;
  }
  const res = await conversation.start();
  if (res.ok) toast("🎙️ Listening. Speak whenever you like.", "good");
});

document.getElementById("btn-mute").addEventListener("click", () => {
  stopSpeaking();
  toast("🔇 Narration stopped.");
});

document.getElementById("type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("type-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await conversation.say(text);
});

document.getElementById("btn-settings-llm").addEventListener("click", () => {
  document.getElementById("brain-card").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("support-note").innerHTML = [
  canListen() ? "<span class='tick'>✓</span> This browser can listen." : "<span class='cross'>✗</span> No Speech Recognition here — Chrome or Edge can listen. Typing works everywhere.",
  canSpeak() ? "<span class='tick'>✓</span> It can speak." : "<span class='cross'>✗</span> No speech synthesis available.",
  navigator.mediaDevices ? "<span class='tick'>✓</span> Microphone metering available, so the orb reacts to your voice." : "",
].filter(Boolean).join("<br>");

/* --------------------------------------------------- brain settings */
const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");
const keyInput = document.getElementById("api-key");
const keyField = document.getElementById("key-field");
const statusLine = document.getElementById("llm-status");
const noteEl = document.getElementById("provider-note");
const signupLink = document.getElementById("provider-signup");
const groundBox = document.getElementById("ground");
const wakeBox = document.getElementById("wake");
const tempRange = document.getElementById("temperature");
const tempVal = document.getElementById("temp-val");

providerSelect.innerHTML = PROVIDER_IDS.map(
  (id) => `<option value="${id}">${escapeHtml(PROVIDERS[id].name)} — ${escapeHtml(PROVIDERS[id].free)}</option>`
).join("");

function paintProvider() {
  const id = providerSelect.value;
  const provider = PROVIDERS[id];
  modelSelect.innerHTML = provider.models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
  keyField.hidden = !provider.needsKey;
  noteEl.textContent = provider.note;
  signupLink.hidden = !provider.signup;
  if (provider.signup) signupLink.href = provider.signup;
}

function paintStatus() {
  const setup = describeSetup();
  statusLine.innerHTML = setup.enabled
    ? `<span class="tick">✓</span> ${escapeHtml(setup.provider)} is active with <b>${escapeHtml(setup.model)}</b>. Key: ${escapeHtml(setup.keyMask)}.
       ${setup.keyEncrypted ? "Encrypted at rest with the BB84 key." : ""}`
    : setup.needsKey && !setup.hasKey
    ? `No key stored, so replies come from the local mesh. Paste a free key above to add the language model.`
    : `Running on the <b>local mesh only</b> — deterministic, offline, and every number traceable.`;
  document.getElementById("stage-llm").classList.toggle("chip-off", !setup.enabled);
}

function loadConfig() {
  const config = getConfig();
  providerSelect.value = config.provider;
  paintProvider();
  modelSelect.value = config.model;
  keyInput.value = config.apiKey || "";
  groundBox.checked = config.groundInMesh;
  tempRange.value = config.temperature;
  tempVal.textContent = config.temperature;
  wakeBox.checked = !!getSettings().requireWake;
  paintStatus();
}

providerSelect.addEventListener("change", () => {
  paintProvider();
  saveConfig({ provider: providerSelect.value, model: modelSelect.value });
  paintStatus();
});
modelSelect.addEventListener("change", () => {
  saveConfig({ model: modelSelect.value });
  paintStatus();
});
tempRange.addEventListener("input", () => {
  tempVal.textContent = tempRange.value;
  saveConfig({ temperature: parseFloat(tempRange.value) });
});
groundBox.addEventListener("change", () => saveConfig({ groundInMesh: groundBox.checked }));
wakeBox.addEventListener("change", () => {
  saveSettings({ requireWake: wakeBox.checked });
  conversation.setRequireWake(wakeBox.checked);
  toast(wakeBox.checked ? "Wake word required: say “Jarvis” first." : "Wake word off: I answer everything I hear.");
});

document.getElementById("btn-save-llm").addEventListener("click", () => {
  saveConfig({
    provider: providerSelect.value,
    model: modelSelect.value,
    apiKey: keyInput.value.trim(),
    temperature: parseFloat(tempRange.value),
    groundInMesh: groundBox.checked,
  });
  paintStatus();
  toast(llmEnabled() ? "🧠 Language model connected." : "Saved. Running on the local mesh.", "good");
});

document.getElementById("btn-test-llm").addEventListener("click", async () => {
  saveConfig({ provider: providerSelect.value, model: modelSelect.value, apiKey: keyInput.value.trim() });
  if (!llmEnabled()) {
    statusLine.innerHTML = `Nothing to test — <b>${escapeHtml(PROVIDERS[providerSelect.value].name)}</b> needs a key first.`;
    return;
  }
  statusLine.textContent = "Testing…";
  try {
    const res = await testConnection();
    statusLine.innerHTML = `<span class="tick">✓</span> Replied in ${res.ms} ms: “${escapeHtml(res.reply)}”`;
    toast("🧠 Connection good.", "good");
  } catch (error) {
    statusLine.innerHTML = `<span class="cross">✗</span> ${escapeHtml(error.message)}`;
    toast("That provider refused the request.", "bad");
  }
});

document.getElementById("btn-forget-key").addEventListener("click", () => {
  forgetKey();
  keyInput.value = "";
  clearConversation();
  paintStatus();
  toast("Key erased from this browser.");
});

loadConfig();

/* ------------------------------------------------------- samples */
const SAMPLES = [
  "where is the space station right now",
  "how far is Mars today",
  "how much fuel to reach geostationary orbit",
  "who was Vera Rubin",
  "what launches are coming up",
  "python code to track a satellite",
  "what would I weigh on Titan",
  "is Europa habitable",
  "best launch site for a geostationary mission",
  "why does any of this matter",
];
document.getElementById("samples").innerHTML = SAMPLES.map(
  (s) => `<button class="chip" data-say="${escapeHtml(s)}">“${escapeHtml(s)}”</button>`
).join("");
document.getElementById("samples").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-say]");
  if (btn) conversation.say(btn.dataset.say);
});

showExplanation({});
window.addEventListener("beforeunload", () => {
  conversation.stop();
  orb?.dispose();
});
