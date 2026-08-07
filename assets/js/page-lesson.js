/* Lesson pages: renders one page of a course from lessons.js.
   The page tells us which course and which slice via data attributes. */

import { initShell, toast, mountVoiceBar, escapeHtml } from "./ui.js";
import { COURSES, levelId, levelPlainText } from "./lessons.js";
import { completeLevel, getProgress, currentUser, rankTitle } from "./store.js";
import { speak, stopSpeaking } from "./voice.js";
import { searchCodex } from "./universe.js";

const courseId = document.body.dataset.course;
const pageIndex = parseInt(document.body.dataset.page, 10);
const course = COURSES[courseId];
const page = course.pages[pageIndex];

initShell(page.file);

document.title = `${course.name} — ${page.title} · Beyond Orbit`;

const levels = course.levels.filter((l) => l.n >= page.range[0] && l.n <= page.range[1]);
const host = document.getElementById("lesson-host");

document.getElementById("course-header").innerHTML = `
  <h1>${course.emoji} ${escapeHtml(course.name)}</h1>
  <h2 style="margin-top:-.3rem">${escapeHtml(page.title)}</h2>
  <p class="muted">${escapeHtml(course.blurb)}</p>
  <p>Read a level, then press <b>“I completed this level”</b>. Scoring happens once per level — pressing it twice does
     nothing, which was a real bug in an earlier version of this app and is now guarded.</p>`;

/* --------------------------------------------------- rendering */
function relatedFor(level) {
  const hits = searchCodex(level.title).slice(0, 4);
  if (!hits.length) return "";
  return `<p class="pill-row" style="margin-top:.7rem">
    <span class="muted" style="font-size:.8rem">Go deeper:</span>
    ${hits.map((h) => `<a class="chip" href="codex.html?id=${encodeURIComponent(h.id)}">${h.emoji || "•"} ${escapeHtml(h.name)}</a>`).join("")}
  </p>`;
}

host.innerHTML = levels
  .map((level) => {
    const id = levelId(course.id, level.n);
    const cleared = !!getProgress().levels[id];
    return `<article class="lesson ${course.accent} ${cleared ? "complete" : ""}" id="level-${level.n}" data-level="${level.n}">
      <h3>${level.icon} Level ${level.n} — ${escapeHtml(level.title)} ${cleared ? '<span class="chip gold">cleared ✓</span>' : ""}</h3>
      <p>${escapeHtml(level.intro)}</p>
      ${level.sections
        .map((s) => `<h4>${escapeHtml(s.h)}</h4><ul>${s.points.map((p) => `<li>${p}</li>`).join("")}</ul>`)
        .join("")}
      <p class="whisper">${escapeHtml(level.whisper)}</p>
      ${relatedFor(level)}
      <div class="lesson-actions">
        <button class="btn ${cleared ? "done" : "primary"} complete-btn" data-level="${level.n}" ${cleared ? "disabled" : ""}>
          ${cleared ? "✓ Level cleared" : "I completed this level"}</button>
        <button class="btn small ghost read-btn" data-level="${level.n}">🔊 Read this level aloud</button>
        <a class="btn small ghost" href="agents.html?q=${encodeURIComponent(level.title)}">🤖 Ask the mesh about this</a>
      </div>
    </article>`;
  })
  .join("");

/* ------------------------------------------------- interactions */
host.addEventListener("click", (e) => {
  const complete = e.target.closest(".complete-btn");
  if (complete) {
    if (!currentUser()) {
      toast('🔒 Register or log in to record XP. <a href="register.html">Register →</a>', "bad");
      return;
    }
    const n = parseInt(complete.dataset.level, 10);
    const res = completeLevel(levelId(course.id, n), 10);
    if (!res.awarded) {
      toast(res.reason === "already" ? "You have already cleared that level." : "Log in first.", "bad");
      return;
    }
    complete.textContent = "✓ Level cleared";
    complete.classList.remove("primary");
    complete.classList.add("done");
    complete.disabled = true;
    complete.closest(".lesson").classList.add("complete");
    toast(`✨ +${res.gained} XP — total ${res.xp} XP, rank ${rankTitle(res.xp)}.`, "good");
    for (const badge of res.newBadges || []) toast(`${badge.icon} Badge earned: <b>${escapeHtml(badge.name)}</b>`, "good");
    updateHeader();
    return;
  }

  const read = e.target.closest(".read-btn");
  if (read) {
    const n = parseInt(read.dataset.level, 10);
    const level = course.levels.find((l) => l.n === n);
    speak(levelPlainText(level), course.voice);
    toast("🔊 Narrating. Say “stop”, or use Settings, to silence it.");
  }
});

function updateHeader() {
  const p = getProgress();
  const cleared = course.levels.filter((l) => p.levels[levelId(course.id, l.n)]).length;
  document.getElementById("course-progress").innerHTML = `
    <div class="bar" style="margin:.5rem 0"><span style="width:${(cleared / course.levels.length) * 100}%"></span></div>
    <p class="muted">${cleared} of ${course.levels.length} levels in this course · ${p.xp} XP overall · rank ${escapeHtml(rankTitle(p.xp))}</p>`;
}
updateHeader();

/* -------------------------------------------------- page footer */
const prev = course.pages[pageIndex - 1];
const next = course.pages[pageIndex + 1];
document.getElementById("page-nav").innerHTML = `
  ${prev ? `<a class="btn ghost" href="${prev.file}">← ${escapeHtml(prev.title)}</a>` : `<a class="btn ghost" href="classroom.html">← Back to the classroom</a>`}
  ${next ? `<a class="btn primary" href="${next.file}">${escapeHtml(next.title)} →</a>` : `<a class="btn primary" href="quiz.html">Take the quiz →</a>`}
  <a class="btn ice" href="cosmos.html">🌍 See it in 3D</a>`;

/* -------------------------------------------------------- voice */
mountVoiceBar(document.getElementById("voice-host"), {
  hint: 'Try: “read level three”, “complete level two”, “stop”, “go to quiz”.',
  handlers(phrase) {
    const numberWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11 };
    const match = phrase.match(/\b(\d+)\b/) || phrase.match(new RegExp(`\\b(${Object.keys(numberWords).join("|")})\\b`));
    const n = match ? numberWords[match[1]] || parseInt(match[1], 10) : null;

    if (/\b(read|narrate|speak)\b/.test(phrase)) {
      const level = n ? course.levels.find((l) => l.n === n) : levels[0];
      if (level) {
        document.getElementById(`level-${level.n}`)?.scrollIntoView({ behavior: "smooth" });
        speak(levelPlainText(level), course.voice);
        return true;
      }
    }
    if (/\b(complete|finish|clear|done)\b/.test(phrase) && n) {
      document.querySelector(`.complete-btn[data-level="${n}"]`)?.click();
      return true;
    }
    if (/\b(stop|quiet|silence)\b/.test(phrase)) {
      stopSpeaking();
      return true;
    }
    return false;
  },
});
