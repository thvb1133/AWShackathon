/* ============================================================
   llm.js — a language model on top of the mesh.

   Beyond Orbit answers in two stages, and the order matters:

     1. The agent mesh runs first. It computes orbits, propagates real
        satellites and calls real public feeds. Those results are facts.
     2. The language model runs second, and is handed those facts as
        its context. Its job is to explain and connect them in the
        voices of MRS THORN BIRD and MR PENGUIN — not to supply
        numbers of its own.

   That ordering is what stops the app hallucinating. Ask where the ISS
   is and the coordinates come from SGP4; the model only gets to phrase
   the sentence around them. If the model is switched off, you still
   get the facts, just more bluntly.

   No key is shipped with this app, and none is needed to use it. Every
   provider below has a free tier; paste a key on the JARVIS page and it
   is stored in your browser, encrypted at rest with the BB84 key from
   qml.js. Or point it at Ollama and run a model on your own machine
   with no key and no network at all.
   ============================================================ */

import { dispatch } from "./agents.js";
import { classify, INTENTS, establishSessionKey, qkdEncrypt, qkdDecrypt } from "./qml.js";
import { contextBlock, learnFrom } from "./memory.js";

const CONFIG_KEY = "bo_llm_config";
const QKD_KEY_STORE = "bo_qkd_material";

/* ==================================================================
   1. Providers, all with a free tier
   ================================================================== */

export const PROVIDERS = {
  mesh: {
    id: "mesh",
    name: "Local mesh only",
    needsKey: false,
    free: "Always free, always offline",
    note: "No language model. You get the agent reports directly — every number computed or fetched, nothing phrased around it.",
    models: ["deterministic"],
    signup: null,
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    needsKey: true,
    free: "Free tier, no card required",
    note: "Get a key at aistudio.google.com/apikey. The flash models are fast and the free allowance is generous.",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"],
    signup: "https://aistudio.google.com/apikey",
    style: "gemini",
  },
  groq: {
    id: "groq",
    name: "Groq",
    needsKey: true,
    free: "Free tier, no card required",
    note: "Get a key at console.groq.com/keys. Runs open models on custom silicon — by far the fastest option for a spoken conversation.",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
    signup: "https://console.groq.com/keys",
    style: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    needsKey: true,
    free: "Free models available",
    note: "Get a key at openrouter.ai/keys. Any model whose name ends in :free costs nothing.",
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemma-2-9b-it:free",
      "mistralai/mistral-7b-instruct:free",
    ],
    signup: "https://openrouter.ai/keys",
    style: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
  },
  ollama: {
    id: "ollama",
    name: "Ollama (on your own machine)",
    needsKey: false,
    free: "Free and entirely local",
    note: "Install from ollama.com, then run: ollama pull llama3.2 — and start it with OLLAMA_ORIGINS=* so a browser page may reach it. Nothing leaves your computer.",
    models: ["llama3.2", "llama3.1", "mistral", "phi3", "qwen2.5"],
    signup: "https://ollama.com",
    style: "openai",
    endpoint: "http://localhost:11434/v1/chat/completions",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/* ==================================================================
   2. Configuration, with the key encrypted at rest
   ================================================================== */

/**
 * The BB84 material has to outlive the tab or a saved key could never be
 * read back, so it is kept in localStorage alongside the ciphertext.
 *
 * To be straight about what that buys: an attacker with access to this
 * browser profile has both halves, so this is obfuscation, not secrecy —
 * the same honest caveat as the password hashing in store.js. It keeps a
 * key out of plain sight in a shared browser and out of casual screen
 * shares. Real secrecy needs a server, which this app deliberately
 * does not have.
 */
function keyMaterial() {
  let hex = localStorage.getItem(QKD_KEY_STORE);
  if (!hex) {
    const session = establishSessionKey({ bits: 1024 });
    if (session.aborted) return null;
    hex = session.hex;
    localStorage.setItem(QKD_KEY_STORE, hex);
  }
  return hex;
}

const DEFAULT_CONFIG = {
  provider: "mesh",
  model: "deterministic",
  temperature: 0.7,
  maxTokens: 700,
  groundInMesh: true,
  fanout: 3,
  speakReplies: true,
};

export function getConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    const config = { ...DEFAULT_CONFIG, ...raw };
    config.apiKey = raw.apiKeyCipher ? qkdDecrypt(raw.apiKeyCipher, keyMaterial()) : "";
    delete config.apiKeyCipher;
    return config;
  } catch {
    return { ...DEFAULT_CONFIG, apiKey: "" };
  }
}

export function saveConfig(patch) {
  const current = getConfig();
  const next = { ...current, ...patch };
  const apiKey = next.apiKey || "";
  delete next.apiKey;
  const stored = { ...next };
  if (apiKey) stored.apiKeyCipher = qkdEncrypt(apiKey, keyMaterial());
  localStorage.setItem(CONFIG_KEY, JSON.stringify(stored));
  return getConfig();
}

export function forgetKey() {
  const current = getConfig();
  delete current.apiKey;
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, apiKeyCipher: undefined }));
  return getConfig();
}

export const llmEnabled = () => {
  const c = getConfig();
  const p = PROVIDERS[c.provider];
  return !!p && p.id !== "mesh" && (!p.needsKey || !!c.apiKey);
};

/** What the key looks like on screen, without showing it. */
export const maskedKey = () => {
  const k = getConfig().apiKey;
  return k ? `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} characters)` : "none stored";
};

/* ==================================================================
   3. The prompt
   ================================================================== */

const SYSTEM_PROMPT = `You are JARVIS, the voice of "Beyond Orbit: A Tale of Two Souls" — an educational space application.

You speak for two mentors and may switch between them:
- MRS THORN BIRD: the poetic, emotional cosmos. Planets, sacrifice, wonder, the vastness that makes a person quiet.
- MR PENGUIN: cold, precise engineering. Rockets, satellites, orbital mechanics, quantum links. He insists history is told honestly, including its ugly parts.

Absolute rules:
1. VERIFIED FACTS below were computed or fetched moments ago by this application — from orbital mechanics, the NORAD SGP4 model, or named public feeds (NASA, NOAA, CelesTrak, JPL). Treat them as ground truth. Quote their numbers exactly; never round them into vagueness and never replace them with numbers of your own.
2. If the facts do not cover what was asked, say so plainly. Do not invent a measurement, a date, a coordinate or a mission name.
3. You are being read aloud by a speech synthesiser. Write plain flowing sentences. No markdown, no bullet lists, no asterisks, no headings, no emoji.
4. Be brief: three to six sentences unless asked for more. This is a conversation, not an essay.
5. When something is genuinely beautiful, you may say so. That is what MRS THORN BIRD is for.`;

/** Formats the mesh reports as the context block the model must obey. */
function factsBlock(result) {
  if (!result?.reports?.length) return "VERIFIED FACTS: none — the mesh found no specialist for this request.";
  const parts = ["VERIFIED FACTS (computed or fetched by this application just now):"];
  for (const r of result.reports) {
    parts.push(`\n[${r.agent?.name || "mesh"} — ${r.agent?.domain || ""}${r.source ? `, data ${r.source}` : ""}]`);
    parts.push(`${r.title}`);
    for (const line of r.lines) parts.push(`- ${line}`);
    if (r.code) parts.push(`(A code sample was also produced and is shown separately; do not repeat it.)`);
  }
  return parts.join("\n");
}

/* ==================================================================
   4. Transports
   ================================================================== */

async function callGemini({ apiKey, model, messages, temperature, maxTokens, signal }) {
  const system = messages.find((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
        contents: turns.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || "unknown reason"})`);
  return text;
}

/** OpenAI-compatible chat completions, with server-sent-event streaming. */
async function callOpenAiCompatible({ endpoint, apiKey, model, messages, temperature, maxTokens, onToken, signal }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (endpoint.includes("openrouter")) {
    headers["HTTP-Referer"] = location.origin;
    headers["X-Title"] = "Beyond Orbit";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: !!onToken }),
  });
  if (!res.ok) throw new Error(`${new URL(endpoint).host} returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  if (!onToken) {
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("The provider returned an empty completion");
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const piece = chunk.choices?.[0]?.delta?.content || "";
        if (piece) {
          full += piece;
          onToken(piece, full);
        }
      } catch { /* keep-alive comments and partial frames are skipped */ }
    }
  }
  if (!full) throw new Error("The stream closed without producing any text");
  return full;
}

/** One raw completion. Throws with a readable message on failure. */
export async function complete(messages, { onToken, signal } = {}) {
  const config = getConfig();
  const provider = PROVIDERS[config.provider];
  if (!provider || provider.id === "mesh") throw new Error("No language model is configured");
  if (provider.needsKey && !config.apiKey) throw new Error(`${provider.name} needs a free API key`);

  const args = {
    apiKey: config.apiKey,
    model: config.model || provider.models[0],
    messages,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    onToken,
    signal,
  };
  return provider.style === "gemini"
    ? callGemini(args)
    : callOpenAiCompatible({ ...args, endpoint: provider.endpoint });
}

/** A short round trip, for the "test connection" button. */
export async function testConnection() {
  const started = performance.now();
  const text = await complete([
    { role: "system", content: "Reply with exactly six words." },
    { role: "user", content: "Confirm you can hear me, briefly." },
  ]);
  return { ok: true, ms: Math.round(performance.now() - started), reply: text.trim().slice(0, 160) };
}

/* ==================================================================
   5. The full pipeline: quantum routing → mesh → language model
   ================================================================== */

const history = [];
export const conversation = () => history.slice();
export const clearConversation = () => { history.length = 0; };

/**
 * Answers a request end to end.
 *
 * Returns { text, reports, intent, provider, grounded, ms, code }.
 * `text` is always populated: with the model's prose when one is
 * configured, and with a plainly worded summary of the agent reports
 * when it is not. Nothing in the pipeline can fail in a way that leaves
 * the user without an answer.
 */
export async function ask(request, { onToken, onStage, signal } = {}) {
  const started = performance.now();
  const config = getConfig();

  // Stage 0 — what do we already know about this person? Retrieved first,
  // because the point of memory is that they never explain twice.
  const memory = contextBlock(request);
  if (memory.entries.length) {
    onStage?.("memory", `Recalling ${memory.entries.length} thing(s) I already know about you…`);
  }

  // Stage 1 — quantum machine learning decides what kind of ask this is.
  onStage?.("routing", "Classifying the request on the quantum circuit…");
  const intent = classify(request);

  // Stage 2 — the mesh gathers facts. Low confidence widens the search.
  onStage?.("mesh", `Intent: ${INTENTS[intent.intent]?.label}. Consulting specialists…`);
  const fanout = intent.confidence > 0.6 ? config.fanout : Math.min(6, config.fanout + 2);
  // The verdict is passed through so the classifier runs once, not twice.
  const result = await dispatch(request, { limit: fanout, intent });

  const code = result.reports.find((r) => r.code) || null;

  // Stage 3 — the language model phrases it, if one is available.
  if (llmEnabled()) {
    onStage?.("thinking", `${PROVIDERS[config.provider].name} is composing the reply…`);
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];
    for (const turn of history.slice(-6)) messages.push(turn);
    messages.push({
      role: "user",
      content: config.groundInMesh
        ? [memory.text, factsBlock(result), `The cadet asks: ${request}`].filter(Boolean).join("\n\n")
        : [memory.text, request].filter(Boolean).join("\n\n"),
    });

    try {
      const text = await complete(messages, { onToken, signal });
      history.push({ role: "user", content: request }, { role: "assistant", content: text });
      if (history.length > 16) history.splice(0, history.length - 16);
      return {
        text: text.trim(),
        reports: result.reports,
        intent,
        memory: memory.entries,
        learned: learnFrom(request),
        provider: PROVIDERS[config.provider].name,
        model: config.model,
        grounded: config.groundInMesh,
        code: code ? { code: code.code, language: code.language } : null,
        ms: Math.round(performance.now() - started),
      };
    } catch (error) {
      // The mesh has already done the real work, so a provider failure
      // degrades to a plain answer rather than to nothing.
      onStage?.("fallback", `${error.message} — answering from the mesh instead.`);
      return {
        text: summarise(result, request, memory.entries),
        reports: result.reports,
        intent,
        memory: memory.entries,
        learned: learnFrom(request),
        provider: `${PROVIDERS[config.provider].name} unavailable — local mesh`,
        error: error.message,
        grounded: true,
        code: code ? { code: code.code, language: code.language } : null,
        ms: Math.round(performance.now() - started),
      };
    }
  }

  onStage?.("summarising", "Answering from the mesh…");
  const text = summarise(result, request, memory.entries);
  history.push({ role: "user", content: request }, { role: "assistant", content: text });
  return {
    text,
    reports: result.reports,
    intent,
    memory: memory.entries,
    learned: learnFrom(request),
    provider: "Local mesh",
    grounded: true,
    code: code ? { code: code.code, language: code.language } : null,
    ms: Math.round(performance.now() - started),
  };
}

/**
 * Turns agent reports into something a speech synthesiser can read.
 * This is the no-language-model path, and it has to be good, because it
 * is the default and it is what runs offline.
 */
function summarise(result, request, memories = []) {
  if (!result.reports.length) {
    const known = memories.length
      ? ` For what it is worth, I do already know ${memories.slice(0, 2).map((m) => m.text).join(" and ")}.`
      : "";
    return `I have no specialist for that. Try naming a world, a mission, a company, a country, or an engineering quantity — for instance, where is the ISS right now, or how far is Mars today.${known}`;
  }
  const first = result.reports[0];
  const lines = first.lines.filter((l) => l && l.length > 3).slice(0, 4);
  const opener = `${first.agent?.name || "The mesh"} reports on ${first.title.replace(/^[^\w]+/, "")}.`;
  const body = lines
    .map((l) => (/[.!?]$/.test(l.trim()) ? l.trim() : `${l.trim()}.`))
    .join(" ");
  const extra = result.reports.length > 1
    ? ` ${result.reports.length - 1} other specialist${result.reports.length > 2 ? "s" : ""} also answered.`
    : "";
  return `${opener} ${body}${extra}`;
}

/* ==================================================================
   6. What the settings panel needs to know
   ================================================================== */

export function describeSetup() {
  const config = getConfig();
  const provider = PROVIDERS[config.provider];
  return {
    provider: provider.name,
    providerId: provider.id,
    model: config.model,
    enabled: llmEnabled(),
    needsKey: provider.needsKey,
    hasKey: !!config.apiKey,
    keyMask: maskedKey(),
    grounded: config.groundInMesh,
    free: provider.free,
    note: provider.note,
    signup: provider.signup,
    keyEncrypted: !!localStorage.getItem(QKD_KEY_STORE),
  };
}
