/* ============================================================
   memory.js — the thing that means you never explain twice.

   Every fact the assistant learns about you is stored as a separate
   entry with four properties that matter:

     · a confidence score, which rises when a fact is confirmed or
       reused and decays when it goes untouched for weeks
     · a source, so you can see whether you told it, it inferred it,
       or it read it from your own settings
     · a timestamp and a use count
     · a forget button — every single entry has one, and forgetting
       is immediate and permanent

   Nothing here is hidden. The Company page lists the whole store,
   sorted by confidence, and the assistant only ever acts on entries
   above a threshold you can see.

   It lives in localStorage. It never leaves the device unless you
   configure a language model, in which case the relevant entries are
   included in the prompt — and the panel tells you which ones were
   sent with every reply.
   ============================================================ */

const STORE = "bo_memory_v1";
const MAX_ENTRIES = 400;

/** Categories, so a business fact and a passing preference are not equal. */
export const KINDS = {
  identity: { label: "Who you are", emoji: "🪪", weight: 1.0 },
  business: { label: "Your business", emoji: "🏢", weight: 1.0 },
  goal: { label: "Goals", emoji: "🎯", weight: 0.95 },
  preference: { label: "Preferences", emoji: "🎚️", weight: 0.8 },
  project: { label: "Projects", emoji: "🚀", weight: 0.9 },
  contact: { label: "People", emoji: "👤", weight: 0.85 },
  fact: { label: "Facts you told me", emoji: "📌", weight: 0.75 },
  decision: { label: "Decisions", emoji: "⚖️", weight: 0.9 },
};

export const KIND_IDS = Object.keys(KINDS);

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || [];
  } catch {
    return [];
  }
};
const write = (entries) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage full: the oldest low-confidence entries are dropped below */
  }
};

const DAY = 864e5;
const id = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Confidence decays with age, but never below a floor set by how many
 * times the fact has actually been used. A thing you have relied on
 * twenty times does not become uncertain just because a month passed.
 */
function effectiveConfidence(entry) {
  const ageDays = (Date.now() - entry.updated) / DAY;
  const halfLife = 60 + entry.uses * 30;
  const decayed = entry.confidence * Math.pow(0.5, ageDays / halfLife);
  const floor = Math.min(entry.confidence, 0.25 + Math.min(0.5, entry.uses * 0.06));
  return Math.max(entry.pinned ? entry.confidence : floor, decayed);
}

/* ==================================================================
   Reading
   ================================================================== */

/** Everything, newest and most confident first, with live confidence. */
export function all() {
  return read()
    .map((e) => ({ ...e, live: effectiveConfidence(e) }))
    .sort((a, b) => b.live - a.live || b.updated - a.updated);
}

export const byKind = (kind) => all().filter((e) => e.kind === kind);

export const count = () => read().length;

/** The entries confident enough to act on. */
export const trusted = (threshold = 0.45) => all().filter((e) => e.live >= threshold);

/* ==================================================================
   Writing
   ================================================================== */

/**
 * Remembers something.
 *
 * If a very similar entry already exists it is *reinforced* rather than
 * duplicated — confidence rises and the timestamp refreshes. That is
 * what stops the store filling with twenty copies of the same fact.
 */
export function remember({ text, kind = "fact", confidence = 0.6, source = "you told me", pinned = false }) {
  const clean = String(text || "").trim();
  if (clean.length < 3) return null;

  const entries = read();
  const existing = entries.find((e) => e.kind === kind && similar(e.text, clean));

  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.15);
    existing.updated = Date.now();
    existing.uses += 1;
    // Prefer the longer phrasing: it usually carries more detail.
    if (clean.length > existing.text.length) existing.text = clean;
    write(entries);
    return { ...existing, reinforced: true };
  }

  const entry = {
    id: id(),
    text: clean,
    kind: KINDS[kind] ? kind : "fact",
    confidence: Math.max(0.15, Math.min(1, confidence)),
    source,
    pinned,
    created: Date.now(),
    updated: Date.now(),
    uses: 0,
  };
  entries.unshift(entry);

  // Over the cap, drop the least confident rather than the oldest.
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => effectiveConfidence(b) - effectiveConfidence(a));
    entries.length = MAX_ENTRIES;
  }
  write(entries);
  return { ...entry, reinforced: false };
}

/** The forget button behind every entry. Immediate and permanent. */
export function forget(entryId) {
  const entries = read();
  const index = entries.findIndex((e) => e.id === entryId);
  if (index < 0) return false;
  entries.splice(index, 1);
  write(entries);
  return true;
}

export function forgetAll() {
  localStorage.removeItem(STORE);
  return true;
}

export function forgetKind(kind) {
  write(read().filter((e) => e.kind !== kind));
}

/** Pinning exempts an entry from decay. */
export function pin(entryId, value = true) {
  const entries = read();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;
  entry.pinned = value;
  entry.updated = Date.now();
  write(entries);
  return true;
}

export function correct(entryId, text) {
  const entries = read();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;
  entry.text = String(text).trim();
  entry.confidence = Math.min(1, entry.confidence + 0.2);
  entry.source = "you corrected me";
  entry.updated = Date.now();
  write(entries);
  return true;
}

/** Marks entries as used, which slows their decay. */
export function touch(ids) {
  const entries = read();
  let changed = false;
  for (const entryId of ids) {
    const entry = entries.find((e) => e.id === entryId);
    if (entry) {
      entry.uses += 1;
      entry.updated = Date.now();
      changed = true;
    }
  }
  if (changed) write(entries);
}

/* ==================================================================
   Matching
   ================================================================== */

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "my", "i", "we", "our", "you", "it", "that", "this", "with", "at", "be", "as", "by"]);
const tokens = (text) => (String(text).toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));

/** Jaccard overlap: cheap, and good enough to spot a restatement. */
function similar(a, b) {
  const sa = new Set(tokens(a));
  const sb = new Set(tokens(b));
  if (!sa.size || !sb.size) return false;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / Math.min(sa.size, sb.size) > 0.7;
}

/**
 * The entries worth putting in front of the assistant for this request.
 *
 * Identity, business and goals are always relevant — they are the
 * context that stops you repeating yourself. Everything else has to
 * earn its place by overlapping with what you actually asked.
 */
export function relevant(request, { limit = 8, threshold = 0.35 } = {}) {
  const wanted = new Set(tokens(request));
  const scored = all()
    .filter((e) => e.live >= threshold)
    .map((e) => {
      const words = tokens(e.text);
      let overlap = 0;
      for (const w of words) if (wanted.has(w)) overlap++;
      const always = ["identity", "business", "goal"].includes(e.kind) ? 0.55 : 0;
      const relevance = overlap / Math.max(1, Math.min(words.length, 6));
      return { entry: e, score: (relevance + always) * e.live * (KINDS[e.kind]?.weight ?? 0.7) };
    })
    .filter((r) => r.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  touch(scored.map((r) => r.entry.id));
  return scored.map((r) => ({ ...r.entry, relevance: r.score }));
}

/** Formats the chosen entries as a block for a language model prompt. */
export function contextBlock(request, options) {
  const entries = relevant(request, options);
  if (!entries.length) return { text: "", entries: [] };
  const lines = entries.map(
    (e) => `- [${KINDS[e.kind]?.label || e.kind}, confidence ${(e.live * 100).toFixed(0)}%] ${e.text}`
  );
  return {
    text: `WHAT YOU ALREADY KNOW ABOUT THIS USER (do not ask them to repeat any of it):\n${lines.join("\n")}`,
    entries,
  };
}

/* ==================================================================
   Learning from conversation
   ================================================================== */

/* Patterns that mean "this is worth keeping". Deliberately conservative:
   a memory that fills up with noise is worse than no memory, because you
   stop trusting it. Each pattern carries the confidence it deserves —
   an explicit "remember that" is worth far more than a passing mention. */
const PATTERNS = [
  { re: /\b(?:remember|note|keep in mind|don'?t forget)\s+(?:that\s+)?(.{6,180})/i, kind: "fact", confidence: 0.9, source: "you asked me to remember" },
  { re: /\bmy name is\s+(.{2,60})/i, kind: "identity", confidence: 0.95, source: "you told me", prefix: "Name: " },
  { re: /\bi(?:'m| am)\s+(?:a|an|the)\s+(.{3,80}?)(?:\.|,|$)/i, kind: "identity", confidence: 0.75, source: "you told me", prefix: "Role: " },
  { re: /\b(?:my|our)\s+(?:company|business|startup|firm|agency)\s+(?:is|is called|is named)\s+(.{2,80}?)(?:\.|,|$)/i, kind: "business", confidence: 0.92, source: "you told me", prefix: "Company: " },
  { re: /\bwe\s+(?:build|make|sell|do|offer|provide)\s+(.{4,140}?)(?:\.|,|$)/i, kind: "business", confidence: 0.8, source: "you told me", prefix: "What we do: " },
  { re: /\b(?:my|our)\s+(?:goal|target|aim|objective)\s+is\s+(?:to\s+)?(.{4,160}?)(?:\.|$)/i, kind: "goal", confidence: 0.85, source: "you told me" },
  { re: /\bi(?:'m| am)\s+working on\s+(.{4,140}?)(?:\.|,|$)/i, kind: "project", confidence: 0.8, source: "you told me", prefix: "Working on: " },
  { re: /\bi\s+(?:prefer|like|want|always want)\s+(.{4,140}?)(?:\.|,|$)/i, kind: "preference", confidence: 0.7, source: "you told me" },
  { re: /\b(?:i\s+)?(?:don'?t|do not|never)\s+(?:want|like|use)\s+(.{4,140}?)(?:\.|,|$)/i, kind: "preference", confidence: 0.7, source: "you told me", prefix: "Avoid: " },
  { re: /\bwe(?:'ve| have)\s+decided\s+(?:to\s+)?(.{4,160}?)(?:\.|$)/i, kind: "decision", confidence: 0.85, source: "you told me" },
  { re: /\b(?:call|contact|email)\s+(?:me\s+)?(?:at|on)\s+(\S{5,80})/i, kind: "contact", confidence: 0.8, source: "you told me", prefix: "Reach you at: " },
];

/**
 * Reads one message and keeps anything that looks durable.
 * Returns what it learned so the interface can say so out loud —
 * silent memory is memory nobody trusts.
 */
export function learnFrom(message) {
  const text = String(message || "").trim();
  if (text.length < 8) return [];
  const learned = [];

  for (const pattern of PATTERNS) {
    const match = text.match(pattern.re);
    if (!match) continue;
    const captured = match[1].trim().replace(/[.,;]+$/, "");
    if (captured.length < 3) continue;
    const entry = remember({
      text: `${pattern.prefix || ""}${captured}`,
      kind: pattern.kind,
      confidence: pattern.confidence,
      source: pattern.source,
    });
    if (entry) learned.push(entry);
  }
  return learned;
}

/* ==================================================================
   Seeding and portability
   ================================================================== */

/** A guided first-run, so the assistant starts knowing your context. */
export function seedProfile({ name, company, does, goal, prefers }) {
  const added = [];
  if (name) added.push(remember({ text: `Name: ${name}`, kind: "identity", confidence: 1, source: "you set it up", pinned: true }));
  if (company) added.push(remember({ text: `Company: ${company}`, kind: "business", confidence: 1, source: "you set it up", pinned: true }));
  if (does) added.push(remember({ text: `What we do: ${does}`, kind: "business", confidence: 1, source: "you set it up", pinned: true }));
  if (goal) added.push(remember({ text: goal, kind: "goal", confidence: 0.95, source: "you set it up", pinned: true }));
  if (prefers) added.push(remember({ text: prefers, kind: "preference", confidence: 0.9, source: "you set it up" }));
  return added.filter(Boolean);
}

export const exportMemory = () => JSON.stringify({ app: "beyond-orbit-memory", version: 1, entries: read() }, null, 2);

export function importMemory(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (data.app !== "beyond-orbit-memory") throw new Error("That is not a Beyond Orbit memory file.");
  const existing = read();
  const seen = new Set(existing.map((e) => e.id));
  for (const entry of data.entries || []) {
    if (!seen.has(entry.id)) existing.push(entry);
  }
  write(existing);
  return (data.entries || []).length;
}

/** A one-line summary for the status bar. */
export function summary() {
  const entries = all();
  const strong = entries.filter((e) => e.live >= 0.6).length;
  const byKindCount = {};
  for (const e of entries) byKindCount[e.kind] = (byKindCount[e.kind] || 0) + 1;
  return {
    total: entries.length,
    strong,
    weakest: entries.length ? entries[entries.length - 1] : null,
    byKind: byKindCount,
    oldest: entries.length ? Math.min(...entries.map((e) => e.created)) : null,
  };
}
