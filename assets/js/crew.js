/* ============================================================
   crew.js — agents working as a team rather than in parallel.

   The mesh in agents.js answers a question by running several
   specialists at once and showing you all their reports. That is
   useful, but it is not teamwork: nobody reads anybody else's work.

   A crew is different. It plans a sequence of steps, runs them in
   order, and hands each step's findings to the next one. Agents
   address each other by name, and the whole exchange is recorded so
   you can read exactly who told whom what — no black box.

   Every crew ends with a deliverable and a confidence, and anything
   that needs your sign-off goes to the approval inbox rather than
   being acted on quietly.
   ============================================================ */

import { dispatch, route, AGENTS } from "./agents.js";
import { classify, INTENTS } from "./qml.js";
import { relevant, remember } from "./memory.js";

/* ==================================================================
   Crew definitions
   ================================================================== */

/**
 * Each step names the kind of specialist it wants and what it is for.
 * `query` builds that step's request from the original brief and from
 * everything earlier steps have already found.
 */
export const CREWS = {
  "mission-brief": {
    id: "mission-brief",
    name: "Mission Design Crew",
    emoji: "🚀",
    blurb: "Turns a one-line mission idea into an orbit, a launch site, a power budget and a disposal plan.",
    triggers: ["design", "mission", "build a satellite", "constellation", "plan a mission", "spacecraft"],
    steps: [
      { role: "Orbit analyst", ask: (brief) => `orbital velocity and period for ${brief}`, kind: "calculate" },
      { role: "Sun-sync designer", ask: (brief) => `sun synchronous orbit for ${brief}`, kind: "calculate" },
      { role: "Power engineer", ask: (brief) => `power budget for ${brief}`, kind: "calculate" },
      { role: "Launch procurement", ask: (brief) => `best launch site for ${brief}`, kind: "calculate" },
      { role: "Safety officer", ask: (brief) => `re-entry and disposal for ${brief}`, kind: "calculate" },
      { role: "Systems architect", ask: (brief) => `outline architecture for ${brief}`, kind: "calculate" },
    ],
  },
  "market-scan": {
    id: "market-scan",
    name: "Market Intelligence Crew",
    emoji: "🏢",
    blurb: "Who else works in this space, in which countries, and what they actually build.",
    triggers: ["competitor", "market", "who else", "industry", "suppliers", "partners", "vendors"],
    steps: [
      { role: "Sector analyst", ask: (brief) => `sector analysis ${brief}`, kind: "lookup" },
      { role: "Country desk", ask: (brief) => `companies ${brief}`, kind: "lookup" },
      { role: "Capability scout", ask: (brief) => `who builds ${brief}`, kind: "lookup" },
    ],
  },
  "sky-report": {
    id: "sky-report",
    name: "Operations Watch Crew",
    emoji: "📡",
    blurb: "The live state of orbit: the station, space weather, what is launching, what is passing close.",
    triggers: ["status", "briefing", "report", "what is happening", "overnight", "morning", "watch"],
    steps: [
      { role: "Tracking officer", ask: () => "where is the ISS right now", kind: "live" },
      { role: "Space weather officer", ask: () => "solar wind and Kp index now", kind: "live" },
      { role: "Launch desk", ask: () => "next launches worldwide", kind: "live" },
      { role: "Planetary defence", ask: () => "asteroids passing Earth this week", kind: "live" },
    ],
  },
  "research-dive": {
    id: "research-dive",
    name: "Research Crew",
    emoji: "📚",
    blurb: "Digs a topic out of the codex from several angles: the object, the people, the history, the technology.",
    triggers: ["research", "deep dive", "explain everything", "tell me all", "study", "learn about"],
    steps: [
      { role: "Subject specialist", ask: (brief) => brief, kind: "lookup" },
      { role: "Historian", ask: (brief) => `timeline of ${brief}`, kind: "lookup" },
      { role: "Technologist", ask: (brief) => `technology behind ${brief}`, kind: "lookup" },
      { role: "Interpreter", ask: (brief) => `why does ${brief} matter`, kind: "reflect" },
    ],
  },
  "build-it": {
    id: "build-it",
    name: "Engineering Crew",
    emoji: "💻",
    blurb: "Works out the numbers, then writes runnable code that uses them.",
    triggers: ["write code", "build me", "script", "automate this", "implement", "program"],
    steps: [
      { role: "Requirements analyst", ask: (brief) => brief, kind: "calculate" },
      { role: "Software author", ask: (brief) => `python code for ${brief}`, kind: "code" },
      { role: "Data officer", ask: (brief) => `live data source for ${brief}`, kind: "live" },
    ],
  },
};

export const CREW_IDS = Object.keys(CREWS);

/** Picks the crew whose triggers best fit a brief; null if none really do. */
export function suggestCrew(brief) {
  const text = String(brief).toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const crew of Object.values(CREWS)) {
    let score = 0;
    for (const trigger of crew.triggers) if (text.includes(trigger)) score += trigger.includes(" ") ? 3 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = crew;
    }
  }
  return bestScore > 0 ? best : null;
}

/* ==================================================================
   Running a crew
   ================================================================== */

/**
 * Runs a crew end to end.
 *
 * `onMessage` receives every agent-to-agent exchange as it happens, so
 * the interface can show the team talking rather than a spinner.
 * Steps run in sequence because each one is allowed to see what came
 * before — that is the whole point of a crew.
 */
export async function runCrew(crewId, brief, { onMessage, onStep, signal } = {}) {
  const crew = CREWS[crewId];
  if (!crew) throw new Error(`No crew called ${crewId}`);

  const started = performance.now();
  const transcript = [];
  const findings = [];
  const say = (from, to, text, extra = {}) => {
    const message = { from, to, text, at: Date.now(), ...extra };
    transcript.push(message);
    onMessage?.(message);
    return message;
  };

  const context = relevant(brief, { limit: 5 });
  say(
    "Crew lead",
    "the team",
    context.length
      ? `Brief: “${brief}”. From memory I already know: ${context.map((c) => c.text).join("; ")}. Nobody ask the boss to repeat any of that.`
      : `Brief: “${brief}”. No prior context in memory, so we start from scratch.`,
    { kind: "plan", memory: context.map((c) => c.id) }
  );

  const intent = classify(brief);
  say("Crew lead", "the team", `Quantum classifier reads this as ${INTENTS[intent.intent]?.label} at ${(intent.confidence * 100).toFixed(0)}% confidence. ${crew.steps.length} steps.`, { kind: "plan" });

  for (let i = 0; i < crew.steps.length; i++) {
    if (signal?.aborted) break;
    const step = crew.steps[i];
    const request = step.ask(brief, findings);

    say("Crew lead", step.role, `Step ${i + 1}: ${request}`, { kind: "assign" });
    onStep?.(i, step, crew.steps.length);

    const result = await dispatch(request, { limit: 1, intent: { ...intent, intent: step.kind, ranked: rank(step.kind) } });
    const report = result.reports[0];

    if (!report || report.failed) {
      say(step.role, "Crew lead", `Nothing usable. ${report?.lines?.[0] || "No specialist matched that."}`, { kind: "empty" });
      continue;
    }

    const headline = report.lines.slice(0, 3).join(" ");
    say(step.role, "Crew lead", `${report.title}. ${headline}`, {
      kind: "report",
      agent: report.agent?.name,
      source: report.source,
      code: report.code || null,
    });

    findings.push({
      role: step.role,
      agent: report.agent?.name,
      title: report.title,
      lines: report.lines,
      source: report.source,
      code: report.code ? { code: report.code, language: report.language } : null,
    });

    // Agents that have something to say to each other, say it.
    const previous = findings[findings.length - 2];
    if (previous && report.lines.length) {
      const note = crossCheck(previous, findings[findings.length - 1]);
      if (note) say(step.role, previous.role, note, { kind: "crosstalk" });
    }
  }

  const deliverable = compose(crew, brief, findings);
  say("Crew lead", "you", deliverable.summary, { kind: "deliverable" });

  return {
    crew: { id: crew.id, name: crew.name, emoji: crew.emoji },
    brief,
    intent,
    transcript,
    findings,
    deliverable,
    memoryUsed: context,
    ms: Math.round(performance.now() - started),
  };
}

/** A synthetic ranking so a step can force the kind of agent it needs. */
function rank(kind) {
  return Object.keys(INTENTS).map((i) => ({ intent: i, score: i === kind ? 0.9 : 0.025 }));
}

/**
 * One agent commenting on another's work.
 *
 * Deliberately narrow: it only speaks when it has a specific,
 * checkable observation. An agent that comments on everything is noise.
 */
function crossCheck(previous, current) {
  const number = (lines, re) => {
    for (const line of lines) {
      const m = line.match(re);
      if (m) return parseFloat(m[1].replace(/,/g, ""));
    }
    return null;
  };

  const prevAlt = number(previous.lines, /([\d,.]+)\s*km\b/);
  const currAlt = number(current.lines, /([\d,.]+)\s*km\b/);
  if (prevAlt && currAlt && Math.abs(prevAlt - currAlt) / Math.max(prevAlt, currAlt) > 0.5) {
    return `Noted — you are working at ${currAlt.toLocaleString()} km and I assumed ${prevAlt.toLocaleString()} km. Somebody should confirm which altitude is the brief.`;
  }

  const prevDv = number(previous.lines, /([\d.]+)\s*km\/s/);
  const currDv = number(current.lines, /([\d.]+)\s*km\/s/);
  if (prevDv && currDv && Math.abs(prevDv - currDv) > 0.001) {
    return `For the record, my figure of ${currDv} km/s is consistent with your ${prevDv} km/s.`;
  }

  if (current.source && previous.source && current.source !== previous.source) {
    return `Flagging a provenance mismatch: my data is ${current.source} and yours is ${previous.source}.`;
  }
  return null;
}

/** Turns the findings into something a person can read in ten seconds. */
function compose(crew, brief, findings) {
  if (!findings.length) {
    return {
      summary: `${crew.name} found nothing usable for “${brief}”. Try naming a quantity, a world, a company or a country.`,
      bullets: [],
      confidence: 0,
      code: null,
    };
  }

  const bullets = findings.map((f) => ({
    role: f.role,
    agent: f.agent,
    headline: f.lines[0] || f.title,
    detail: f.lines.slice(1, 3),
    source: f.source,
  }));

  const live = findings.filter((f) => f.source === "live").length;
  const confidence = Math.min(0.98, 0.45 + findings.length * 0.09 + live * 0.05);
  const code = findings.find((f) => f.code)?.code || null;

  return {
    summary:
      `${crew.emoji} ${crew.name} finished “${brief}”. ${findings.length} specialists reported. ` +
      `Headline: ${findings[0].lines[0] || findings[0].title}`,
    bullets,
    confidence,
    code,
    spoken:
      `${crew.name} is done. ${findings.length} specialists reported on ${brief}. ` +
      findings.slice(0, 3).map((f) => `${f.role} says ${f.lines[0]}`).join(" "),
  };
}

/* ==================================================================
   Who is on the team
   ================================================================== */

/** The named roster the Company page shows — real agents, real counts. */
export function roster() {
  const byKind = {};
  for (const agent of AGENTS) {
    const kind = agent.kind || "other";
    (byKind[kind] = byKind[kind] || []).push(agent);
  }
  return Object.entries(byKind)
    .map(([kind, list]) => ({
      kind,
      label: INTENTS[kind]?.label || kind,
      emoji: INTENTS[kind]?.emoji || "•",
      count: list.length,
      examples: list.slice(0, 4).map((a) => a.name),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Records what a crew concluded, so the next crew starts from it. */
export function rememberOutcome(result) {
  if (!result?.deliverable?.bullets?.length) return null;
  return remember({
    text: `${result.crew.name} on “${result.brief}”: ${result.deliverable.bullets[0].headline}`,
    kind: "project",
    confidence: result.deliverable.confidence,
    source: `${result.crew.name}, ${new Date().toLocaleDateString()}`,
  });
}
