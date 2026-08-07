/* Agents page: the task console and a browser for every agent in the mesh. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { AGENTS, AGENT_COUNT, AGENT_DOMAINS, MESH_STATS, route, dispatch, speakable, agentById } from "./agents.js";
import { speak, canListen, createVoiceCommander } from "./voice.js";
import { getSettings } from "./store.js";

initShell("agents.html");

document.getElementById("mesh-intro").textContent =
  `${AGENT_COUNT} specialist agents across ${MESH_STATS.domains} domains, all executing in this browser tab. ` +
  `Ask in plain language; the router decides who is qualified to answer.`;

document.getElementById("mesh-stats").innerHTML = [
  [MESH_STATS.skills, "engineering calculators"],
  [MESH_STATS.knowledge, "codex specialists"],
  [MESH_STATS.industry, "industry desks"],
  [MESH_STATS.constellations, "live constellations"],
  [MESH_STATS.feeds, "public feeds"],
  [MESH_STATS.tutors, "classroom tutors"],
  [MESH_STATS.regions, "national programmes"],
  [MESH_STATS.sectors, "sector analysts"],
  [MESH_STATS.spaceports, "launch ranges"],
  [MESH_STATS.observatories, "observatories"],
  [MESH_STATS.ground, "ground networks"],
].map(([n, l]) => `<span class="chip">${n} ${escapeHtml(l)}</span>`).join("");

/* ------------------------------------------------------- console */
const form = document.getElementById("task-form");
const taskInput = document.getElementById("task");
const out = document.getElementById("console-out");
const routing = document.getElementById("routing");

const EXAMPLES = [
  "where is the ISS right now",
  "how far is Mars today",
  "Hohmann transfer from 400 km to 35786 km",
  "sun synchronous orbit at 700 km",
  "power budget for 250 W at 550 km",
  "best launch site for a geostationary mission",
  "python code to track a satellite",
  "who builds radar satellites in Finland",
  "quantum key distribution over 1200 km",
  "how crowded is low Earth orbit",
  "is Europa habitable",
  "what would I weigh on Titan",
  "next launches worldwide",
  "tell me about Vera Rubin",
  "re-entry from 500 km",
];
document.getElementById("examples").innerHTML = EXAMPLES.map(
  (e) => `<button class="chip" data-q="${escapeHtml(e)}">${escapeHtml(e)}</button>`
).join("");
document.getElementById("examples").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-q]");
  if (!btn) return;
  taskInput.value = btn.dataset.q;
  run(btn.dataset.q);
});

/* Live preview of who would answer, as you type. */
taskInput.addEventListener("input", () => {
  const q = taskInput.value.trim();
  if (q.length < 3) {
    routing.innerHTML = "";
    return;
  }
  const picks = route(q, { limit: 6 });
  routing.innerHTML = picks.length
    ? `<p class="muted" style="font-size:.8rem">Would route to: ${picks
        .map((p) => `<span class="chip">${escapeHtml(p.name)} · ${p.score}</span>`)
        .join(" ")}</p>`
    : `<p class="muted" style="font-size:.8rem">No agent matches yet — keep typing.</p>`;
});

let running = false;
async function run(question) {
  if (running) return;
  const q = (question || taskInput.value).trim();
  if (!q) return;
  running = true;
  out.innerHTML = `<p class="muted">Dispatching across the mesh…</p>`;
  const limit = parseInt(document.getElementById("fanout").value, 10);
  const result = await dispatch(q, { limit });

  out.innerHTML =
    `<p class="muted">Request: <b>${escapeHtml(q)}</b> — ${result.agents.length} agent(s) answered in ${result.ms} ms.</p>` +
    result.reports
      .map(
        (r) => `<article class="card mt ${r.failed ? "" : ""}">
          <p class="muted" style="font-size:.74rem;text-transform:uppercase;letter-spacing:.06em">
            ${escapeHtml(r.agent?.name || "mesh")} · ${escapeHtml(r.agent?.domain || "")}
            ${r.agent?.score ? ` · match ${r.agent.score}` : ""}${r.source ? ` · data ${escapeHtml(r.source)}` : ""}</p>
          <h3>${escapeHtml(r.title)}</h3>
          <ul>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
          ${r.code ? `<pre class="code"><code>${escapeHtml(r.code)}</code></pre>
            <p class="lesson-actions"><button class="btn small ghost" data-copy="${encodeURIComponent(r.code)}">📋 Copy code</button></p>` : ""}
          ${r.codexId ? `<p><a class="btn small ghost" href="codex.html?id=${encodeURIComponent(r.codexId)}">Full codex entry →</a></p>` : ""}
          ${r.tleGroup ? `<p><a class="btn small ghost" href="orbitlab.html">Fly this group in the Orbit Lab →</a></p>` : ""}
        </article>`
      )
      .join("");

  if (getSettings().narration) speak(speakable(result), "penguin");
  running = false;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});

out.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copy)).then(
    () => toast("📋 Code copied to the clipboard.", "good"),
    () => toast("The clipboard is blocked in this browser.", "bad")
  );
});

/* ---------------------------------------------------------- mic */
const micBtn = document.getElementById("btn-mic");
let commander = null;
let listening = false;
micBtn.addEventListener("click", () => {
  if (!canListen()) return toast("Voice input needs Chrome or Edge. Typing works everywhere.", "bad");
  if (listening) {
    commander.stop();
    listening = false;
    micBtn.textContent = "🎙️ Speak";
    micBtn.classList.remove("mic-live");
    return;
  }
  commander =
    commander ||
    createVoiceCommander({
      handlers(phrase) {
        taskInput.value = phrase;
        run(phrase);
        return true;
      },
      onState: (on) => {
        listening = on;
        micBtn.textContent = on ? "🔴 Listening" : "🎙️ Speak";
        micBtn.classList.toggle("mic-live", on);
      },
    });
  commander.start();
});

/* ------------------------------------------------ agent browser */
const domainSelect = document.getElementById("agent-domain");
domainSelect.innerHTML =
  `<option value="all">All domains (${AGENT_COUNT} agents)</option>` +
  AGENT_DOMAINS.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)} (${AGENTS.filter((a) => a.domain === d).length})</option>`).join("");

const listEl = document.getElementById("agent-list");
const countEl = document.getElementById("agent-count");
const moreBtn = document.getElementById("agent-more");
const filterInput = document.getElementById("agent-q");
let showing = 30;

function filtered() {
  const q = filterInput.value.trim().toLowerCase();
  const dom = domainSelect.value;
  return AGENTS.filter(
    (a) =>
      (dom === "all" || a.domain === dom) &&
      (!q || a.name.toLowerCase().includes(q) || a.blurb?.toLowerCase().includes(q) || a.keys.some((k) => k.includes(q)))
  );
}

function renderAgents() {
  const list = filtered();
  countEl.textContent = `${list.length} agent(s) match.${list.length > showing ? ` Showing ${showing}.` : ""}`;
  listEl.innerHTML = list
    .slice(0, showing)
    .map(
      (a) => `<button class="agent-card" data-agent="${escapeHtml(a.id)}">
        <span class="dom">${escapeHtml(a.domain)}</span>
        <strong>${escapeHtml(a.name)}</strong>
        <span class="muted">${escapeHtml((a.blurb || "").slice(0, 110))}</span>
      </button>`
    )
    .join("");
  moreBtn.hidden = list.length <= showing;
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-agent]");
  if (!btn) return;
  const agent = agentById(btn.dataset.agent);
  if (!agent) return;
  out.innerHTML = `<p class="muted">Running <b>${escapeHtml(agent.name)}</b> directly…</p>`;
  try {
    const r = await agent.run(agent.keys[0] || agent.name, {});
    out.innerHTML = `<article class="card">
      <p class="muted" style="font-size:.74rem;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(agent.name)} · ${escapeHtml(agent.domain)}</p>
      <h3>${escapeHtml(r.title)}</h3>
      <ul>${r.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
      ${r.code ? `<pre class="code"><code>${escapeHtml(r.code)}</code></pre>` : ""}
      ${r.codexId ? `<p><a class="btn small ghost" href="codex.html?id=${encodeURIComponent(r.codexId)}">Full codex entry →</a></p>` : ""}
    </article>`;
  } catch (err) {
    out.innerHTML = `<p class="cross">${escapeHtml(agent.name)} failed: ${escapeHtml(err.message)}</p>`;
  }
  out.scrollIntoView({ behavior: "smooth", block: "center" });
});

filterInput.addEventListener("input", () => { showing = 30; renderAgents(); });
domainSelect.addEventListener("change", () => { showing = 30; renderAgents(); });
moreBtn.addEventListener("click", () => { showing += 60; renderAgents(); });
renderAgents();

const preset = new URLSearchParams(location.search).get("q");
if (preset) {
  taskInput.value = preset;
  run(preset);
}
