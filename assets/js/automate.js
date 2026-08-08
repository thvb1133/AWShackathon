/* ============================================================
   automate.js — work that happens without you.

   Schedules run crews on a timer, drop their output into an approval
   inbox, and tell you about it. You come back to finished work with a
   decision to make, rather than a task to start.

   Nothing is ever sent anywhere without your approval. An automation
   produces a *draft*; approving it is what fires the outbound webhook.
   That is the CEO pattern the whole thing is built around: the team
   works, you sign off.

   The honest limit, stated once here and again in the interface: this
   is a browser tab. Timers run while a Beyond Orbit tab is open —
   including in the background, though browsers throttle background
   timers to about once a minute, which is fine for anything scheduled
   in minutes or hours. Close every tab and the schedule pauses; the
   next time you open one, anything overdue runs immediately and is
   waiting for you. Genuinely unattended overnight running needs a
   machine that stays awake, and the panel says so rather than
   pretending otherwise.
   ============================================================ */

import { runCrew, CREWS, rememberOutcome } from "./crew.js";
import { remember } from "./memory.js";
import { speak } from "./voice.js";
import { fire } from "./integrations.js";

const JOBS = "bo_jobs_v1";
const INBOX = "bo_inbox_v1";
const LAST_TICK = "bo_last_tick";

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full */ }
};

const MINUTE = 60000;
const id = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const INTERVALS = [
  { id: "15m", label: "Every 15 minutes", ms: 15 * MINUTE },
  { id: "1h", label: "Hourly", ms: 60 * MINUTE },
  { id: "4h", label: "Every 4 hours", ms: 240 * MINUTE },
  { id: "daily", label: "Once a day", ms: 24 * 60 * MINUTE },
  { id: "manual", label: "Only when I ask", ms: Infinity },
];

/* ==================================================================
   Jobs
   ================================================================== */

export const jobs = () => read(JOBS, []);

export function addJob({ name, crew, brief, interval = "1h", autoApprove = false, webhook = "", speakResult = true }) {
  const list = jobs();
  const job = {
    id: id("j"),
    name: name || `${CREWS[crew]?.name || crew}: ${brief}`.slice(0, 70),
    crew,
    brief,
    interval,
    autoApprove,
    webhook,
    speakResult,
    enabled: true,
    created: Date.now(),
    lastRun: null,
    lastResult: null,
    runs: 0,
    failures: 0,
  };
  list.push(job);
  write(JOBS, list);
  return job;
}

export function updateJob(jobId, patch) {
  const list = jobs();
  const job = list.find((j) => j.id === jobId);
  if (!job) return null;
  Object.assign(job, patch);
  write(JOBS, list);
  return job;
}

export function removeJob(jobId) {
  write(JOBS, jobs().filter((j) => j.id !== jobId));
}

const intervalMs = (job) => INTERVALS.find((i) => i.id === job.interval)?.ms ?? Infinity;

export function dueJobs(now = Date.now()) {
  return jobs().filter((job) => {
    if (!job.enabled) return false;
    const every = intervalMs(job);
    if (!Number.isFinite(every)) return false;
    return !job.lastRun || now - job.lastRun >= every;
  });
}

export function nextDue(job) {
  const every = intervalMs(job);
  if (!Number.isFinite(every)) return null;
  return (job.lastRun || Date.now()) + every;
}

/* ==================================================================
   The inbox
   ================================================================== */

export const inbox = () => read(INBOX, []);
export const pending = () => inbox().filter((item) => item.status === "pending");
export const unreadCount = () => pending().length;

function fileInInbox(item) {
  const list = inbox();
  list.unshift(item);
  write(INBOX, list.slice(0, 200));
  return item;
}

export function approve(itemId) {
  const list = inbox();
  const item = list.find((i) => i.id === itemId);
  if (!item) return null;
  item.status = "approved";
  item.decidedAt = Date.now();
  write(INBOX, list);
  // Approval is the trigger. Nothing left the device before this moment.
  if (item.webhook) {
    fire(item.webhook, { title: item.title, summary: item.summary, bullets: item.bullets, brief: item.brief })
      .then((res) => markDelivery(itemId, res))
      .catch((err) => markDelivery(itemId, { ok: false, error: err.message }));
  }
  return item;
}

export function reject(itemId, note = "") {
  const list = inbox();
  const item = list.find((i) => i.id === itemId);
  if (!item) return null;
  item.status = "rejected";
  item.note = note;
  item.decidedAt = Date.now();
  write(INBOX, list);
  // A rejection is a preference worth keeping.
  if (note) remember({ text: `Rejected "${item.title}": ${note}`, kind: "preference", confidence: 0.7, source: "you rejected a draft" });
  return item;
}

function markDelivery(itemId, result) {
  const list = inbox();
  const item = list.find((i) => i.id === itemId);
  if (!item) return;
  item.delivery = result;
  write(INBOX, list);
}

export function markRead(itemId) {
  const list = inbox();
  const item = list.find((i) => i.id === itemId);
  if (item) {
    item.read = true;
    write(INBOX, list);
  }
}

export function clearInbox() {
  write(INBOX, inbox().filter((i) => i.status === "pending"));
}

/* ==================================================================
   Running
   ================================================================== */

const listeners = new Set();
export const onActivity = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = (event) => {
  for (const fn of listeners) {
    try { fn(event); } catch { /* a bad listener must not stop the run */ }
  }
};

let running = false;

/** Runs one job now, whether or not it is due. */
export async function runJob(jobId, { announce = true } = {}) {
  const job = jobs().find((j) => j.id === jobId);
  if (!job) return null;

  emit({ type: "start", job });
  let result;
  try {
    result = await runCrew(job.crew, job.brief);
  } catch (error) {
    updateJob(job.id, { lastRun: Date.now(), failures: job.failures + 1, lastResult: `failed: ${error.message}` });
    emit({ type: "error", job, error: error.message });
    return null;
  }

  updateJob(job.id, {
    lastRun: Date.now(),
    runs: job.runs + 1,
    lastResult: result.deliverable.summary.slice(0, 160),
  });
  rememberOutcome(result);

  const item = fileInInbox({
    id: id("i"),
    jobId: job.id,
    jobName: job.name,
    crew: result.crew,
    brief: job.brief,
    title: `${result.crew.emoji} ${job.name}`,
    summary: result.deliverable.summary,
    spoken: result.deliverable.spoken,
    bullets: result.deliverable.bullets,
    confidence: result.deliverable.confidence,
    code: result.deliverable.code,
    transcript: result.transcript,
    webhook: job.webhook,
    status: job.autoApprove ? "approved" : "pending",
    read: false,
    at: Date.now(),
  });

  if (job.autoApprove && job.webhook) {
    fire(job.webhook, { title: item.title, summary: item.summary, bullets: item.bullets, brief: item.brief })
      .then((res) => markDelivery(item.id, res))
      .catch((err) => markDelivery(item.id, { ok: false, error: err.message }));
  }

  emit({ type: "done", job, item, result });
  if (announce) announceItem(item, job);
  return item;
}

/** Tells you it happened: a desktop notification, and optionally out loud. */
export function announceItem(item, job) {
  const line = `${job?.name || item.title} finished. ${item.summary}`;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const note = new Notification("Beyond Orbit — work ready for you", {
        body: `${item.title}\n${item.summary.slice(0, 140)}`,
        tag: item.id,
        silent: false,
      });
      note.onclick = () => {
        window.focus();
        location.href = "company.html#inbox";
      };
    } catch { /* notifications can be refused mid-flight */ }
  }
  if (job?.speakResult !== false) speak(item.spoken || line, "penguin");
}

export async function askForAlerts() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/* ==================================================================
   The scheduler
   ================================================================== */

let timer = 0;

/**
 * Starts the loop.
 *
 * On start it catches up: anything that fell due while every tab was
 * closed runs straight away, so coming back after a night away gives
 * you the work rather than an apology.
 */
export function startScheduler({ tickMs = 30000 } = {}) {
  if (timer) return;
  catchUp();
  timer = setInterval(tick, tickMs);
  write(LAST_TICK, Date.now());
  return () => stopScheduler();
}

export function stopScheduler() {
  clearInterval(timer);
  timer = 0;
}

export const schedulerRunning = () => !!timer;

async function tick() {
  if (running) return;
  const due = dueJobs();
  if (!due.length) {
    write(LAST_TICK, Date.now());
    return;
  }
  running = true;
  for (const job of due) {
    await runJob(job.id);
  }
  running = false;
  write(LAST_TICK, Date.now());
}

/** How long the tab was closed, and what that means for the schedule. */
export function downtime() {
  const last = read(LAST_TICK, null);
  if (!last) return null;
  const ms = Date.now() - last;
  return ms > 5 * MINUTE ? { ms, since: last } : null;
}

async function catchUp() {
  const gap = downtime();
  const due = dueJobs();
  if (!due.length) return;
  emit({ type: "catchup", count: due.length, gap });
  running = true;
  for (const job of due) await runJob(job.id, { announce: true });
  running = false;
}

/* ==================================================================
   A sensible starting set
   ================================================================== */

/** Three schedules that are immediately useful, offered on first run. */
export const SUGGESTED = [
  {
    name: "Morning operations briefing",
    crew: "sky-report",
    brief: "overnight status of orbit",
    interval: "daily",
    why: "The station, space weather, what is launching and what is passing close — waiting before you are up.",
  },
  {
    name: "Space weather watch",
    crew: "sky-report",
    brief: "solar wind and geomagnetic conditions",
    interval: "4h",
    why: "Alerts you when the Sun turns nasty, which matters if you operate anything in orbit.",
  },
  {
    name: "Competitor sweep",
    crew: "market-scan",
    brief: "launch sector",
    interval: "daily",
    why: "Who is building what, refreshed daily so you are not surprised.",
  },
];

export function installSuggested(index) {
  const template = SUGGESTED[index];
  if (!template) return null;
  return addJob({
    name: template.name,
    crew: template.crew,
    brief: template.brief,
    interval: template.interval,
    speakResult: true,
  });
}

/** The one-line status the corner badge shows. */
export function status() {
  const list = jobs();
  const next = list
    .filter((j) => j.enabled && Number.isFinite(intervalMs(j)))
    .map((j) => ({ job: j, at: nextDue(j) }))
    .sort((a, b) => a.at - b.at)[0];
  return {
    jobs: list.length,
    enabled: list.filter((j) => j.enabled).length,
    pending: pending().length,
    running: schedulerRunning(),
    nextJob: next?.job.name || null,
    nextAt: next?.at || null,
    totalRuns: list.reduce((sum, j) => sum + j.runs, 0),
  };
}
