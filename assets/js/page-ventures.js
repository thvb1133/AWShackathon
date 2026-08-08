/* Ventures console: the fifty ideas, the working optimiser, and the
   overnight pipeline that turns a chosen idea into approvable work. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { VENTURES, CATEGORIES, MODELS, DIFFICULTY, ranked, byId, buildPlan, stats } from "./ventures.js";
import { generateProblem, compare, benchmark, summarise, flightPlan } from "./optimizer.js";
import { runCrew, CREWS } from "./crew.js";
import { addJob, jobs, SUGGESTED } from "./automate.js";
import { remember } from "./memory.js";
import { speak } from "./voice.js";
import * as api from "./api.js";

initShell("ventures.html");

let selected = null;

/* ==================================================================
   Header counts
   ================================================================== */
{
  const s = stats();
  document.getElementById("venture-stats").innerHTML = [
    ["💼 Ideas catalogued", s.total, "each with buyer, price, data and blockers"],
    ["🆓 Free data", s.freeData, "buildable at zero data cost"],
    ["⚡ Startable now", s.startable, "difficulty 1–2, solo buildable"],
    ["⚛️ Honest quantum fit", s.quantumHonest, `of ${s.total} — the rest say “no” on purpose`],
    ["🛠️ Already implemented", 1, "idea #31 runs on this page"],
  ]
    .map(([label, value, note]) => `<div class="metric"><div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
      <div class="muted" style="font-size:.75rem">${escapeHtml(note)}</div></div>`)
    .join("");
}

/* ==================================================================
   The optimiser
   ================================================================== */
const optResult = document.getElementById("opt-result");
const optPlan = document.getElementById("opt-plan");

function solverRow(solver, optimum) {
  if (!solver || solver.skipped) return "";
  const pct = optimum ? (solver.value / optimum) * 100 : 0;
  return `<tr${solver.optimal ? ' class="me"' : ""}>
    <td><b>${escapeHtml(solver.name)}</b></td>
    <td>${solver.value}</td>
    <td>${pct.toFixed(1)}%</td>
    <td>${solver.chosen}</td>
    <td>${solver.cost}</td>
    <td>${solver.ms < 1 ? solver.ms.toFixed(2) : solver.ms.toFixed(0)} ms</td>
    <td>${solver.feasible ? '<span class="tick">✓ flyable</span>' : '<span class="cross">✗ over capacity</span>'}</td>
  </tr>`;
}

document.getElementById("btn-optimize").addEventListener("click", () => {
  const count = parseInt(document.getElementById("opt-count").value, 10);
  const layers = parseInt(document.getElementById("opt-layers").value, 10);
  const seed = parseInt(document.getElementById("opt-seed").value, 10) || 7;

  optResult.innerHTML = `<p class="muted">Running four solvers on the same problem…</p>`;
  optPlan.innerHTML = "";

  setTimeout(() => {
    const problem = generateProblem({ count, seed });
    const result = compare(problem, { qaoaLayers: layers });

    optResult.innerHTML = `
      <dl class="kv">
        <dt>Targets requested</dt><dd>${problem.tasks.length}</dd>
        <dt>Resource capacity</dt><dd>${problem.capacity} of ${problem.totalCost} units requested — ${((problem.capacity / problem.totalCost) * 100).toFixed(0)}% can be flown</dd>
        <dt>Priority available</dt><dd>${problem.totalValue} points</dd>
        <dt>True optimum</dt><dd>${result.optimum} points</dd>
        <dt>Search space</dt><dd>2<sup>${problem.tasks.length}</sup> = ${(2 ** problem.tasks.length).toLocaleString()} possible plans</dd>
      </dl>
      <div class="scroll-x mt"><table>
        <thead><tr><th>Solver</th><th>Value</th><th>% of optimum</th><th>Targets flown</th><th>Capacity used</th><th>Time</th><th>Valid</th></tr></thead>
        <tbody>
          ${solverRow(result.exact, result.optimum)}
          ${solverRow(result.annealing, result.optimum)}
          ${solverRow(result.qaoa, result.optimum)}
          ${solverRow(result.greedy, result.optimum)}
        </tbody></table></div>
      ${result.qaoa.skipped ? `<p class="hint mt">${escapeHtml(result.qaoa.reason)}</p>` : `
        <p class="hint mt">QAOA detail: ${result.qaoa.qubits} qubits, ${result.qaoa.stateSize} amplitudes, ${result.qaoa.layers} layer(s),
        circuit depth ${result.qaoa.circuitDepth}, ${result.qaoa.shots} shots.
        A single measurement lands on the optimum ${(result.qaoa.probabilityOfOptimum * 100).toFixed(3)}% of the time, against
        ${((1 / result.qaoa.stateSize) * 100).toFixed(4)}% for random guessing.</p>`}
      <div class="card mt"><h3>Verdict</h3>
        <ul>${result.verdict.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></div>`;

    const plan = flightPlan(problem, (result.exact || result.annealing).selection);
    optPlan.innerHTML = `<h3>The flight plan it produced</h3>
      <div class="scroll-x"><table>
        <thead><tr><th>Pass</th><th>Target</th><th>Priority</th><th>Cost</th><th>Decision</th></tr></thead>
        <tbody>${plan.map((t) => `<tr${t.flown ? ' class="me"' : ""}>
          <td>${t.window + 1}</td><td>${escapeHtml(t.name)}</td><td>${t.value}</td><td>${t.cost}</td>
          <td>${t.flown ? '<span class="tick">✓ fly</span>' : '<span class="muted">defer</span>'}</td></tr>`).join("")}</tbody>
      </table></div>`;

    speak(summarise(result), "penguin");
    toast(`🛰️ Optimiser finished. Best: ${escapeHtml(result.best)}.`, "good");

    /* Record the comparison when a server is connected. Claims about
       quantum performance should be backed by accumulated runs, not by
       whichever demo happened to look good. Failure is silent: the
       optimiser is useful with no database behind it. */
    api
      .health()
      .then((backend) => {
        if (!backend.available) return;
        return api.serverOptimizer.record({
          tasks: problem.tasks.length,
          capacity: problem.capacity,
          optimum: result.optimum,
          greedy_value: result.greedy.value,
          anneal_value: result.annealing.value,
          qaoa_value: result.qaoa.skipped ? undefined : result.qaoa.value,
          anneal_ms: result.annealing.ms,
          qaoa_ms: result.qaoa.skipped ? undefined : result.qaoa.ms,
          feasible: [result.greedy, result.annealing, result.exact].every((s) => !s || s.feasible),
        });
      })
      .catch(() => {});
  }, 30);
});

document.getElementById("btn-benchmark").addEventListener("click", () => {
  optResult.innerHTML = `<p class="muted">Running eight independent instances through every solver…</p>`;
  optPlan.innerHTML = "";
  setTimeout(() => {
    const b = benchmark({ instances: 8, count: 10 });
    optResult.innerHTML = `
      <h3>Eight instances, every solver, same problems</h3>
      <div class="scroll-x"><table>
        <thead><tr><th>Solver</th><th>Hit the exact optimum</th><th>Mean % of optimum</th><th>Total time</th></tr></thead>
        <tbody>
          ${["annealing", "qaoa", "greedy"].map((key) => {
            const s = b.summary[key];
            const name = key === "qaoa" ? "QAOA (quantum)" : key === "annealing" ? "Simulated annealing" : "Greedy";
            return `<tr><td><b>${name}</b></td><td>${escapeHtml(s.optimalRate)}</td>
              <td>${s.percentOfOptimum.toFixed(2)}%</td><td>${s.msTotal.toFixed(0)} ms</td></tr>`;
          }).join("")}
        </tbody></table></div>
      <p class="mt">${escapeHtml(b.verdict)}</p>
      <p class="hint">${b.feasibilityFailures === 0
        ? "Every plan returned respected the capacity constraint. An earlier version of this solver did not, and produced plans that scored higher by being physically impossible — which is exactly the kind of bug a benchmark exists to catch."
        : `${b.feasibilityFailures} infeasible plan(s) were caught and repaired.`}</p>`;
    toast("📊 Benchmark complete.", "good");
  }, 30);
});

/* ==================================================================
   The catalogue
   ================================================================== */
const categorySelect = document.getElementById("v-category");
categorySelect.innerHTML =
  `<option value="all">Everything (${VENTURES.length})</option>` +
  Object.entries(CATEGORIES)
    .map(([id, c]) => `<option value="${id}">${c.emoji} ${escapeHtml(c.label)} (${VENTURES.filter((v) => v.category === id).length})</option>`)
    .join("");

const listEl = document.getElementById("venture-list");

function renderCatalogue() {
  const query = document.getElementById("v-search").value.trim().toLowerCase();
  const category = categorySelect.value;
  const maxDifficulty = parseInt(document.getElementById("v-difficulty").value, 10);
  const freeOnly = document.getElementById("v-free").checked;
  const preferQuantum = document.getElementById("v-quantum").checked;

  const list = ranked({ preferQuantum }).filter((v) => {
    if (category !== "all" && v.category !== category) return false;
    if (v.difficulty > maxDifficulty) return false;
    if (freeOnly && !v.freeData) return false;
    if (query) {
      const haystack = `${v.name} ${v.buyer} ${v.data} ${v.stack} ${v.edge} ${v.quantum}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  document.getElementById("v-count").textContent =
    `${list.length} of ${VENTURES.length} match. Highest score first — that means cheapest to test, not most valuable.`;

  listEl.innerHTML = list.length
    ? list
        .map(
          (v) => `<button class="codex-card" data-venture="${escapeHtml(v.id)}">
        <div class="meta">#${v.rank} · ${CATEGORIES[v.category].emoji} ${escapeHtml(CATEGORIES[v.category].label)}
          · ${MODELS[v.model].emoji} ${escapeHtml(MODELS[v.model].label)}</div>
        <h3>${escapeHtml(v.name)}</h3>
        <p class="meta">${escapeHtml(v.price)} · ${escapeHtml(v.buyer)}</p>
        <p>${escapeHtml(v.edge)}</p>
        <div class="pill-row" style="margin-top:.5rem">
          <span class="chip ${v.freeData ? "penguin" : ""}">${v.freeData ? "🆓 free data" : "💷 paid data"}</span>
          <span class="chip">difficulty ${v.difficulty}/5</span>
          ${v.alreadyBuilt ? '<span class="chip gold">partly built here</span>' : ""}
          <span class="chip">score ${v.value}</span>
        </div>
      </button>`
        )
        .join("")
    : `<p class="muted">Nothing matches. Loosen the difficulty limit, or untick “free data only” to see the ideas that need a data budget.</p>`;
}

for (const id of ["v-search", "v-category", "v-difficulty", "v-free", "v-quantum"]) {
  document.getElementById(id).addEventListener("input", renderCatalogue);
}
renderCatalogue();

/* ==================================================================
   The plan
   ================================================================== */
listEl.addEventListener("click", (e) => {
  const card = e.target.closest("[data-venture]");
  if (card) showPlan(card.dataset.venture);
});

function showPlan(id) {
  const venture = byId(id);
  const scored = ranked().find((v) => v.id === id);
  const plan = buildPlan(venture);
  selected = venture;

  document.getElementById("plan-empty").hidden = true;
  document.getElementById("plan-actions").hidden = false;
  document.getElementById("plan-output").innerHTML = "";

  document.getElementById("plan-body").innerHTML = `
    <h3>${escapeHtml(venture.name)} <span class="chip">#${venture.rank}</span></h3>
    <dl class="kv">
      <dt>Who pays</dt><dd>${escapeHtml(venture.buyer)}</dd>
      <dt>Pricing model</dt><dd>${MODELS[venture.model].emoji} ${escapeHtml(MODELS[venture.model].label)} — ${escapeHtml(venture.price)}</dd>
      <dt>Why that model</dt><dd class="muted" style="font-weight:400">${escapeHtml(MODELS[venture.model].note)}</dd>
      <dt>Data it needs</dt><dd>${escapeHtml(venture.data)}</dd>
      <dt>Stack</dt><dd>${escapeHtml(venture.stack)}</dd>
      <dt>Difficulty</dt><dd>${venture.difficulty}/5 — ${escapeHtml(DIFFICULTY[venture.difficulty])}</dd>
    </dl>
    <p><b>Your edge:</b> ${escapeHtml(venture.edge)}</p>
    <div class="whisper"><b>What actually blocks it:</b> ${escapeHtml(venture.blockers)}</div>
    <p><b>Quantum, honestly:</b> ${escapeHtml(venture.quantum)}</p>
    <p class="muted" style="font-size:.84rem">Scored ${scored.value} because: ${scored.why.map(escapeHtml).join(" ")}</p>
    <h3 class="mt">The first week</h3>
    <ol>${plan.steps.map((s) => `<li><b>${escapeHtml(s.title)}</b><br><span class="muted">${escapeHtml(s.detail)}</span></li>`).join("")}</ol>`;

  document.getElementById("plan").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("btn-run-crew").addEventListener("click", async () => {
  if (!selected) return;
  const out = document.getElementById("plan-output");
  out.innerHTML = `<p class="muted">The proposal crew is working…</p>`;
  const messages = [];
  const result = await runCrew("venture-proposal", selected.name, {
    onMessage: (m) => {
      messages.push(m);
      out.innerHTML = messages
        .map((msg) => `<div class="crew-message ${msg.kind || ""}">
          <span class="who">${escapeHtml(msg.from)} → ${escapeHtml(msg.to)}</span>${escapeHtml(msg.text)}
          ${msg.code ? `<pre class="code"><code>${escapeHtml(msg.code)}</code></pre>` : ""}</div>`)
        .join("");
      out.scrollTop = out.scrollHeight;
    },
  });
  toast(`💼 Proposal drafted in ${result.ms} ms. It is in the approval inbox.`, "good");
  speak(result.deliverable.spoken || result.deliverable.summary, "penguin");
});

document.getElementById("btn-schedule").addEventListener("click", () => {
  if (!selected) return;
  const existing = jobs().find((j) => j.brief === selected.name);
  if (existing) {
    toast("⏰ Already scheduled — see Operations.", "bad");
    return;
  }
  addJob({
    name: `Overnight: ${selected.name}`,
    crew: "venture-proposal",
    brief: selected.name,
    interval: "daily",
    speakResult: true,
  });
  remember({
    text: `Working on the venture: ${selected.name} (${selected.price}, sold to ${selected.buyer})`,
    kind: "project",
    confidence: 0.9,
    source: "you scheduled it",
  });
  renderOvernight();
  toast("⏰ Scheduled nightly. Drafts will be waiting in the approval inbox.", "good");
});

document.getElementById("btn-remember").addEventListener("click", () => {
  if (!selected) return;
  remember({
    text: `My venture: ${selected.name}. Buyer: ${selected.buyer}. Model: ${MODELS[selected.model].label} at ${selected.price}.`,
    kind: "business",
    confidence: 0.95,
    source: "you chose it on the ventures page",
    pinned: true,
  });
  // Persist it server-side too, so the choice follows you to another device.
  api
    .health()
    .then((backend) => {
      if (!backend.available || !api.signedIn()) return;
      return api.serverVentures.choose({
        venture_id: selected.id,
        name: selected.name,
        buyer: selected.buyer,
        price_model: selected.model,
        stage: "chosen",
      });
    })
    .catch(() => {});
  toast("🧠 Pinned to memory. I will not ask you to explain it again.", "good");
  speak(`Noted. ${selected.name} is your venture. I will not ask again.`, "penguin");
});

/* ==================================================================
   Overnight
   ================================================================== */
function renderOvernight() {
  const list = jobs();
  document.getElementById("overnight-jobs").innerHTML = list.length
    ? list
        .map(
          (j) => `<div class="card"><h3 style="font-size:1rem">${escapeHtml(j.name)}</h3>
        <p class="muted" style="font-size:.82rem">${escapeHtml(CREWS[j.crew]?.name || j.crew)} · ${escapeHtml(j.interval)}
        · ran ${j.runs}×</p>
        <p class="muted" style="font-size:.8rem">“${escapeHtml(j.brief)}”</p></div>`
        )
        .join("")
    : `<div class="card"><h3 style="font-size:1rem">Nothing scheduled yet</h3>
        <p class="muted" style="font-size:.84rem">Choose an idea above and press “Work on it overnight”. Each night the
        crew researches it, drafts a proposal, and leaves it in the approval inbox for one click from you.</p></div>`;
}
renderOvernight();
