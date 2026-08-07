/* Company operations console: memory, crews, automations, inbox, integrations. */

import { initShell, toast, escapeHtml } from "./ui.js";
import * as memory from "./memory.js";
import { CREWS, CREW_IDS, runCrew, suggestCrew, roster, rememberOutcome } from "./crew.js";
import * as auto from "./automate.js";
import * as hooks from "./integrations.js";
import { AGENT_COUNT } from "./agents.js";
import { speak } from "./voice.js";

initShell("company.html");

const fmtWhen = (ts) => {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return `in ${Math.round(-diff / 60000)} min`;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} h ago`;
  return new Date(ts).toLocaleDateString();
};

/* ==================================================================
   Status strip
   ================================================================== */
function paintStatus() {
  const s = auto.status();
  const m = memory.summary();
  const team = roster();
  document.getElementById("status-strip").innerHTML = [
    ["🧠 Memory", `${m.total}`, `${m.strong} confident · ${Object.keys(m.byKind).length} categories`],
    ["👥 Team", `${AGENT_COUNT}`, `${team.length} disciplines, ${CREW_IDS.length} crews`],
    ["⏰ Automations", `${s.enabled}/${s.jobs}`, s.nextJob ? `next: ${s.nextJob} ${fmtWhen(s.nextAt)}` : "none scheduled"],
    ["📥 Waiting on you", `${s.pending}`, `${s.totalRuns} run(s) completed`],
    ["🔌 Connections", `${hooks.connections().length}`, `${hooks.deliveryLog().length} delivery attempt(s)`],
  ]
    .map(([label, value, note]) => `<div class="metric"><div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      <div class="muted" style="font-size:.75rem">${escapeHtml(note)}</div></div>`)
    .join("");
}

/* ==================================================================
   Memory
   ================================================================== */
document.getElementById("mem-kind").innerHTML = memory.KIND_IDS.map(
  (k) => `<option value="${k}">${memory.KINDS[k].emoji} ${escapeHtml(memory.KINDS[k].label)}</option>`
).join("");

function paintMemory() {
  const entries = memory.all();
  const summary = memory.summary();
  document.getElementById("mem-summary").textContent = entries.length
    ? `${summary.total} entries, ${summary.strong} of them above 60% confidence. Confidence decays with age unless pinned or used.`
    : "Nothing remembered yet. Tell me about your business above, or just talk to JARVIS — it learns as you go.";

  document.getElementById("memory-list").innerHTML =
    entries
      .map(
        (e) => `<div class="memory-entry" data-id="${e.id}">
          <div>
            <div>${e.pinned ? "📌 " : ""}${escapeHtml(e.text)}</div>
            <div class="meta">
              ${memory.KINDS[e.kind]?.emoji || ""} ${escapeHtml(memory.KINDS[e.kind]?.label || e.kind)} ·
              ${escapeHtml(e.source)} · used ${e.uses}× · ${fmtWhen(e.updated)}
            </div>
            <div class="conf" style="width:${Math.round(e.live * 120)}px" title="confidence ${(e.live * 100).toFixed(0)}%"></div>
            <span class="meta"> ${(e.live * 100).toFixed(0)}% confident</span>
          </div>
          <div style="display:flex;gap:.25rem;flex-direction:column">
            <button class="btn ghost small" data-pin="${e.id}" title="Pin so it never decays">${e.pinned ? "Unpin" : "📌"}</button>
            <button class="btn ghost small" data-forget="${e.id}" title="Forget this permanently">🗑️ Forget</button>
          </div>
        </div>`
      )
      .join("") || `<p class="muted">Empty.</p>`;
  paintStatus();
}

document.getElementById("memory-list").addEventListener("click", (e) => {
  const forgetBtn = e.target.closest("[data-forget]");
  if (forgetBtn) {
    memory.forget(forgetBtn.dataset.forget);
    toast("🗑️ Forgotten. Permanently.");
    paintMemory();
    return;
  }
  const pinBtn = e.target.closest("[data-pin]");
  if (pinBtn) {
    const entry = memory.all().find((x) => x.id === pinBtn.dataset.pin);
    memory.pin(pinBtn.dataset.pin, !entry?.pinned);
    paintMemory();
  }
});

document.getElementById("btn-mem-add").addEventListener("click", () => {
  const input = document.getElementById("mem-add");
  const text = input.value.trim();
  if (!text) return;
  memory.remember({ text, kind: document.getElementById("mem-kind").value, confidence: 0.9, source: "you added it by hand" });
  input.value = "";
  toast("🧠 Remembered.", "good");
  paintMemory();
});

document.getElementById("btn-save-profile").addEventListener("click", () => {
  const added = memory.seedProfile({
    name: document.getElementById("p-name").value.trim(),
    company: document.getElementById("p-company").value.trim(),
    does: document.getElementById("p-does").value.trim(),
    goal: document.getElementById("p-goal").value.trim(),
    prefers: document.getElementById("p-prefers").value.trim(),
  });
  if (!added.length) return toast("Fill in at least one field.", "bad");
  toast(`🧠 ${added.length} thing(s) pinned to memory. I will not ask again.`, "good");
  speak("Got it. I will not ask you to explain that again.", "penguin");
  paintMemory();
});

document.getElementById("btn-mem-forget-all").addEventListener("click", () => {
  if (!confirm("Forget everything JARVIS knows about you? This cannot be undone.")) return;
  memory.forgetAll();
  toast("🗑️ Memory wiped.");
  paintMemory();
});

document.getElementById("btn-mem-export").addEventListener("click", () => {
  const blob = new Blob([memory.exportMemory()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `beyond-orbit-memory-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ==================================================================
   Crews
   ================================================================== */
const crewOptions = CREW_IDS.map(
  (id) => `<option value="${id}">${CREWS[id].emoji} ${escapeHtml(CREWS[id].name)}</option>`
).join("");
document.getElementById("crew-pick").innerHTML = crewOptions;
document.getElementById("job-crew").innerHTML = crewOptions;
document.getElementById("job-interval").innerHTML = auto.INTERVALS.map(
  (i) => `<option value="${i.id}"${i.id === "daily" ? " selected" : ""}>${escapeHtml(i.label)}</option>`
).join("");

document.getElementById("crew-examples").innerHTML = [
  "design a 150 kg imaging satellite at 550 km",
  "overnight status of orbit",
  "who else builds radar satellites",
  "research Europa",
  "write code to track the ISS",
]
  .map((s) => `<button class="chip" data-brief="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
  .join("");
document.getElementById("crew-examples").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-brief]");
  if (!btn) return;
  document.getElementById("crew-brief").value = btn.dataset.brief;
  const suggestion = suggestCrew(btn.dataset.brief);
  if (suggestion) document.getElementById("crew-pick").value = suggestion.id;
});

document.getElementById("crew-brief").addEventListener("input", (e) => {
  const suggestion = suggestCrew(e.target.value);
  if (suggestion) document.getElementById("crew-pick").value = suggestion.id;
});

const transcriptEl = document.getElementById("crew-transcript");
let crewRunning = false;

document.getElementById("btn-run-crew").addEventListener("click", async () => {
  if (crewRunning) return;
  const brief = document.getElementById("crew-brief").value.trim();
  if (!brief) return toast("Say what you want done.", "bad");
  const crewId = document.getElementById("crew-pick").value;

  crewRunning = true;
  transcriptEl.innerHTML = "";
  const progress = document.getElementById("crew-progress");

  const result = await runCrew(crewId, brief, {
    onStep: (i, step, total) => {
      progress.innerHTML = `<div class="bar"><span style="width:${((i + 1) / total) * 100}%"></span></div>
        <p class="muted" style="font-size:.82rem">Step ${i + 1} of ${total} — ${escapeHtml(step.role)}</p>`;
    },
    onMessage: (m) => {
      const el = document.createElement("div");
      el.className = `crew-message ${m.kind || ""}`;
      el.innerHTML = `<span class="who">${escapeHtml(m.from)} → ${escapeHtml(m.to)}</span>${escapeHtml(m.text)}
        ${m.code ? `<pre class="code"><code>${escapeHtml(m.code)}</code></pre>` : ""}`;
      transcriptEl.appendChild(el);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    },
  });

  progress.innerHTML = `<p class="muted">Finished in ${result.ms} ms · confidence ${(result.deliverable.confidence * 100).toFixed(0)}%</p>`;
  rememberOutcome(result);
  crewRunning = false;
  paintMemory();
  speak(result.deliverable.spoken || result.deliverable.summary, "penguin");
});

/* ==================================================================
   Automations
   ================================================================== */
function paintScheduler() {
  const gap = auto.downtime();
  document.getElementById("scheduler-note").innerHTML =
    `Schedules run while any Beyond Orbit tab is open — including in the background, though browsers slow background ` +
    `timers to about once a minute. Close every tab and the schedule pauses; open one and anything overdue runs ` +
    `immediately, so you come back to finished work. ` +
    `<b>Truly unattended overnight running needs a machine that stays awake</b> — leave this tab open on a desktop, or ` +
    `run the same brief from a server. ` +
    (gap ? `<br><span class="muted">Tabs were closed for about ${Math.round(gap.ms / 60000)} minutes; overdue jobs have been caught up.</span>` : "");
}

function paintSuggested() {
  const existing = new Set(auto.jobs().map((j) => j.name));
  const remaining = auto.SUGGESTED.map((s, i) => ({ ...s, i })).filter((s) => !existing.has(s.name));
  document.getElementById("suggested-jobs").innerHTML = remaining.length
    ? `<p class="muted" style="font-size:.85rem">Ready-made schedules:</p>` +
      remaining
        .map(
          (s) => `<div class="inbox-item"><b>${escapeHtml(s.name)}</b> <span class="chip">${escapeHtml(s.interval)}</span>
            <p class="muted" style="font-size:.84rem;margin:.3rem 0">${escapeHtml(s.why)}</p>
            <button class="btn small" data-suggest="${s.i}">Add it</button></div>`
        )
        .join("")
    : "";
}
document.getElementById("suggested-jobs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-suggest]");
  if (!btn) return;
  const job = auto.installSuggested(parseInt(btn.dataset.suggest, 10));
  toast(`⏰ “${escapeHtml(job.name)}” scheduled.`, "good");
  paintJobs();
});

function paintJobs() {
  const list = auto.jobs();
  document.getElementById("job-list").innerHTML = list.length
    ? list
        .map(
          (j) => `<div class="inbox-item">
            <b>${escapeHtml(j.name)}</b>
            <span class="chip">${escapeHtml(auto.INTERVALS.find((i) => i.id === j.interval)?.label || j.interval)}</span>
            ${j.enabled ? "" : '<span class="chip">paused</span>'}
            ${j.webhook ? '<span class="chip">🔌 sends on approval</span>' : ""}
            <p class="muted" style="font-size:.82rem;margin:.35rem 0">
              ${escapeHtml(CREWS[j.crew]?.name || j.crew)} · “${escapeHtml(j.brief)}” ·
              ran ${j.runs}× · last ${fmtWhen(j.lastRun)} · next ${fmtWhen(auto.nextDue(j))}
            </p>
            ${j.lastResult ? `<p class="muted" style="font-size:.8rem">Last: ${escapeHtml(j.lastResult)}</p>` : ""}
            <div class="lesson-actions">
              <button class="btn small" data-run="${j.id}">Run now</button>
              <button class="btn ghost small" data-toggle="${j.id}">${j.enabled ? "Pause" : "Resume"}</button>
              <button class="btn ghost small" data-del="${j.id}">Delete</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="muted">No automations yet.</p>`;
  paintSuggested();
  paintStatus();
}

document.getElementById("job-list").addEventListener("click", async (e) => {
  const run = e.target.closest("[data-run]");
  if (run) {
    run.disabled = true;
    run.textContent = "Running…";
    await auto.runJob(run.dataset.run);
    paintJobs();
    paintInbox();
    return;
  }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const job = auto.jobs().find((j) => j.id === toggle.dataset.toggle);
    auto.updateJob(job.id, { enabled: !job.enabled });
    paintJobs();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    auto.removeJob(del.dataset.del);
    paintJobs();
  }
});

document.getElementById("btn-add-job").addEventListener("click", () => {
  const brief = document.getElementById("job-brief").value.trim();
  if (!brief) return toast("Give the job a brief.", "bad");
  auto.addJob({
    crew: document.getElementById("job-crew").value,
    brief,
    interval: document.getElementById("job-interval").value,
    webhook: document.getElementById("job-hook").value.trim(),
  });
  document.getElementById("job-brief").value = "";
  toast("⏰ Scheduled.", "good");
  paintJobs();
});

document.getElementById("btn-alerts").addEventListener("click", async () => {
  const result = await auto.askForAlerts();
  toast(
    result === "granted" ? "🔔 Alerts on — I will pop a message when work is ready." :
    result === "denied" ? "Alerts refused. I will still speak the result out loud." :
    "This browser has no notifications; I will speak results instead.",
    result === "granted" ? "good" : "bad"
  );
});

/* ==================================================================
   Inbox
   ================================================================== */
function paintInbox() {
  const items = auto.inbox();
  const waiting = auto.pending().length;
  document.getElementById("inbox-count").textContent = `${waiting} waiting`;
  document.getElementById("inbox-list").innerHTML = items.length
    ? items
        .slice(0, 25)
        .map(
          (item) => `<div class="inbox-item ${item.status}">
            <b>${escapeHtml(item.title)}</b>
            <span class="chip">${escapeHtml(item.status)}</span>
            <span class="chip">${(item.confidence * 100).toFixed(0)}% confident</span>
            <span class="muted" style="font-size:.78rem"> ${fmtWhen(item.at)}</span>
            <p style="font-size:.88rem;margin:.4rem 0">${escapeHtml(item.summary)}</p>
            <ul style="font-size:.82rem">${(item.bullets || []).slice(0, 5)
              .map((b) => `<li><b>${escapeHtml(b.role)}:</b> ${escapeHtml(b.headline)}</li>`).join("")}</ul>
            ${item.code ? `<pre class="code"><code>${escapeHtml(item.code)}</code></pre>` : ""}
            ${item.delivery ? `<p class="hint">Delivery: ${item.delivery.ok ? (item.delivery.verified ? `confirmed, HTTP ${item.delivery.status}` : "sent, unconfirmed by the receiver") : `failed — ${escapeHtml(item.delivery.error || "")}`}</p>` : ""}
            ${item.status === "pending" ? `<div class="lesson-actions">
              <button class="btn primary small" data-approve="${item.id}">✅ Approve${item.webhook ? " &amp; send" : ""}</button>
              <button class="btn ghost small" data-reject="${item.id}">✕ Reject</button>
              <button class="btn ghost small" data-speak="${item.id}">🔊 Read it to me</button>
            </div>` : ""}
          </div>`
        )
        .join("")
    : `<p class="muted">Nothing here. Schedule an automation above and finished work will land here.</p>`;
  paintStatus();
}

document.getElementById("inbox-list").addEventListener("click", (e) => {
  const approve = e.target.closest("[data-approve]");
  if (approve) {
    const item = auto.approve(approve.dataset.approve);
    toast(item.webhook ? "✅ Approved and sent." : "✅ Approved.", "good");
    paintInbox();
    return;
  }
  const reject = e.target.closest("[data-reject]");
  if (reject) {
    const note = prompt("Why? (optional — I will remember it as a preference)") || "";
    auto.reject(reject.dataset.reject, note);
    toast("Rejected. Nothing was sent.");
    paintInbox();
    paintMemory();
    return;
  }
  const read = e.target.closest("[data-speak]");
  if (read) {
    const item = auto.inbox().find((i) => i.id === read.dataset.speak);
    speak(item.spoken || item.summary, "penguin");
  }
});

document.getElementById("btn-clear-inbox").addEventListener("click", () => {
  auto.clearInbox();
  paintInbox();
});

document.getElementById("btn-read-inbox").addEventListener("click", async () => {
  const out = document.getElementById("email-report");
  out.innerHTML = `<p class="muted">Checking…</p>`;
  const result = await hooks.readInbox();
  if (!result.configured) {
    out.innerHTML = `<p class="muted">No inbox bridge set up yet — see <a href="#integrations">Integrations</a> below.
      A static page cannot read Gmail directly, and it would be dishonest to pretend otherwise; the bridge is the way
      to do it without handing anybody your password.</p>`;
    return;
  }
  if (!result.ok) {
    out.innerHTML = `<p class="cross">Could not read the bridge: ${escapeHtml(result.reason)}</p>`;
    return;
  }
  out.innerHTML = `<div class="inbox-item"><b>📧 ${result.unread} unread of ${result.total}</b>
    <ul style="font-size:.85rem">${result.messages.slice(0, 8).map((m) => `<li>${m.unread ? "🔵" : "⚪"}
      <b>${escapeHtml(m.from)}</b> — ${escapeHtml(m.subject)}
      ${m.summary ? `<br><span class="muted">${escapeHtml(m.summary)}</span>` : ""}</li>`).join("")}</ul></div>`;
  speak(result.spoken, "penguin");
});

/* ==================================================================
   Integrations
   ================================================================== */
document.getElementById("reach-note").textContent = hooks.reachSummary().honest;

document.getElementById("destination-cards").innerHTML = hooks.DESTINATION_IDS.map((id) => {
  const d = hooks.DESTINATIONS[id];
  return `<div class="card"><h3>${d.emoji} ${escapeHtml(d.name)}</h3>
    <p class="muted" style="font-size:.82rem">${escapeHtml(d.reach)}</p>
    <p style="font-size:.82rem">${escapeHtml(d.hint)}</p>
    ${d.url ? `<p><a class="btn ghost small" href="${d.url}" target="_blank" rel="noopener">How →</a></p>` : ""}</div>`;
}).join("");

function paintConnections() {
  const list = hooks.connections();
  document.getElementById("connection-list").innerHTML = list.length
    ? list
        .map(
          (c) => `<div class="inbox-item"><b>${hooks.DESTINATIONS[c.type]?.emoji || "🔌"} ${escapeHtml(c.name)}</b>
            <span class="chip">${escapeHtml(hooks.DESTINATIONS[c.type]?.name || c.type)}</span>
            <p class="muted mono" style="font-size:.74rem;word-break:break-all">${escapeHtml(c.url)}</p>
            <p class="muted" style="font-size:.8rem">${c.deliveries} delivery attempt(s) · ${escapeHtml(c.lastStatus || "never used")}</p>
            <div class="lesson-actions">
              <button class="btn small" data-test="${c.id}">Send a test</button>
              <button class="btn ghost small" data-rmconn="${c.id}">Remove</button>
            </div></div>`
        )
        .join("")
    : `<p class="muted">No connections yet.</p>`;
  paintStatus();
}

document.getElementById("btn-add-conn").addEventListener("click", () => {
  try {
    const c = hooks.addConnection({
      url: document.getElementById("conn-url").value,
      name: document.getElementById("conn-name").value.trim(),
    });
    document.getElementById("conn-url").value = "";
    document.getElementById("conn-name").value = "";
    toast(`🔌 ${escapeHtml(c.name)} connected as ${escapeHtml(hooks.DESTINATIONS[c.type].name)}.`, "good");
    paintConnections();
  } catch (error) {
    toast(escapeHtml(error.message), "bad");
  }
});

document.getElementById("btn-test-conn").addEventListener("click", async () => {
  const url = document.getElementById("conn-url").value.trim();
  if (!url) return toast("Paste a webhook URL first.", "bad");
  const status = document.getElementById("conn-status");
  status.textContent = "Sending…";
  const result = await hooks.test(url);
  status.innerHTML = result.ok
    ? `<span class="tick">✓</span> ${result.verified ? `Delivered, HTTP ${result.status}, ${result.ms} ms.` : `Sent in ${result.ms} ms. ${escapeHtml(result.note)}`}`
    : `<span class="cross">✗</span> ${escapeHtml(result.error)}`;
});

document.getElementById("connection-list").addEventListener("click", async (e) => {
  const test = e.target.closest("[data-test]");
  if (test) {
    const c = hooks.connections().find((x) => x.id === test.dataset.test);
    test.disabled = true;
    const result = await hooks.test(c.url, c.type);
    toast(result.ok ? "🔌 Test sent." : `Failed: ${escapeHtml(result.error)}`, result.ok ? "good" : "bad");
    paintConnections();
    return;
  }
  const remove = e.target.closest("[data-rmconn]");
  if (remove) {
    hooks.removeConnection(remove.dataset.rmconn);
    paintConnections();
  }
});

document.getElementById("bridge-help").innerHTML = `
  <p class="muted">${escapeHtml(hooks.INBOX_BRIDGE.why)} A static page cannot read Gmail — the API needs an OAuth client
     you register, and IMAP is not reachable from a browser at all. Anyone claiming otherwise is running a server that
     holds your password. The bridge avoids that entirely:</p>
  <ol style="font-size:.86rem">${hooks.INBOX_BRIDGE.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
  <p class="muted" style="font-size:.84rem">The JSON it should publish:</p>
  <pre class="code"><code>${escapeHtml(hooks.INBOX_BRIDGE.shape)}</code></pre>`;

document.getElementById("bridge-url").value = hooks.getBridge();
document.getElementById("btn-save-bridge").addEventListener("click", () => {
  hooks.setBridge(document.getElementById("bridge-url").value);
  toast("📧 Inbox bridge saved.", "good");
});

/* ==================================================================
   Honest limits
   ================================================================== */
document.getElementById("limits").innerHTML = [
  ["✅", "<b>Always listening, no clicking.</b> Once you grant the microphone, the orb in the corner arms itself on every visit. Talk, or clap twice, and it answers out loud."],
  ["✅", "<b>Memory that persists.</b> Every fact scored by confidence, visible, with a forget button. It goes into every answer, so you never explain twice."],
  ["✅", "<b>Teams that talk to each other.</b> Crews plan, delegate and hand findings on, and you can read the whole exchange."],
  ["✅", "<b>Work while you are away.</b> Schedules run and results wait in the inbox for approval. Approving is what sends anything."],
  ["✅", "<b>Reach into your stack.</b> One outbound webhook that speaks Zapier, Make, n8n, Slack, Discord and Teams — and those platforms reach thousands of apps."],
  ["⚠️", "<b>Overnight running needs a machine that stays awake.</b> This is a browser tab. Leave it open and it works; close everything and the schedule pauses until you return, when overdue jobs run at once."],
  ["⚠️", "<b>Email needs a bridge.</b> No static page can read Gmail. The bridge keeps your credentials with a platform you already trust and gives this app only the summary."],
  ["⚠️", "<b>“Million-token conversations” is not something a browser can hold.</b> What is here instead is targeted recall: the entries relevant to what you just asked, chosen by overlap and confidence, which is both cheaper and easier to audit than a giant context window."],
  ["⚠️", "<b>Nothing is sent without you.</b> That is a deliberate limit, not a missing feature."],
]
  .map(([icon, text]) => `<li>${icon} ${text}</li>`)
  .join("");

/* ==================================================================
   Live updates
   ================================================================== */
auto.onActivity((event) => {
  if (event.type === "done" || event.type === "error" || event.type === "catchup") {
    paintJobs();
    paintInbox();
  }
});

paintMemory();
paintScheduler();
paintJobs();
paintInbox();
paintConnections();
paintStatus();

if (location.hash === "#inbox") document.getElementById("inbox").scrollIntoView({ behavior: "smooth" });
