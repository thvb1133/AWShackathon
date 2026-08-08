/* Classroom hub: pick a mentor, see how far you have travelled. */

import { initShell, escapeHtml } from "./ui.js";
import { COURSES, levelId, TOTAL_LEVELS } from "./lessons.js";
import { getProgress, currentUser, rankTitle } from "./store.js";

initShell("classroom.html");

const progress = getProgress();
const user = currentUser();
const done = (courseId, n) => !!progress.levels[levelId(courseId, n)];

const cleared = Object.keys(progress.levels).length;
document.getElementById("progress-summary").innerHTML = user
  ? `<h2>Cadet ${escapeHtml(user.username)}</h2>
     <div class="bar" style="margin:.6rem 0"><span style="width:${(cleared / TOTAL_LEVELS) * 100}%"></span></div>
     <p><b>${cleared} of ${TOTAL_LEVELS}</b> levels cleared · ${progress.xp} XP · rank <b>${escapeHtml(rankTitle(progress.xp))}</b>
        · ${progress.badges.length} badge(s) · ${progress.planets.length} world(s) visited in 3D.</p>`
  : `<h2>Exploring as a guest</h2>
     <p>Every lesson is readable without an account. Registering is what lets the app record your XP, badges,
        streak and leaderboard place — all stored locally in this browser.</p>
     <p class="lesson-actions"><a class="btn primary" href="register.html">Register</a><a class="btn" href="login.html">Login</a></p>`;

document.getElementById("course-cards").innerHTML = Object.values(COURSES)
  .map((course) => {
    const total = course.levels.length;
    const complete = course.levels.filter((l) => done(course.id, l.n)).length;
    return `<article class="card ${course.accent}">
      <h2>${course.emoji} ${escapeHtml(course.name)}</h2>
      <p class="muted">${escapeHtml(course.subject)}</p>
      <p>${escapeHtml(course.blurb)}</p>
      <div class="bar" style="margin:.6rem 0"><span style="width:${(complete / total) * 100}%"></span></div>
      <p class="muted">${complete} of ${total} levels cleared</p>
      <ol style="font-size:.86rem;padding-left:1.2rem">
        ${course.levels
          .map((l) => {
            const page = course.pages.find((p) => l.n >= p.range[0] && l.n <= p.range[1]);
            return `<li><a href="${page.file}#level-${l.n}" style="color:inherit">${l.icon} ${escapeHtml(l.title)}</a>
              ${done(course.id, l.n) ? '<span class="tick">✓</span>' : ""}</li>`;
          })
          .join("")}
      </ol>
      <p class="lesson-actions">
        ${course.pages
          .map((p, i) => `<a class="btn small ${i === 0 ? (course.id === "thorn" ? "primary" : "ice") : "ghost"}" href="${p.file}">${escapeHtml(p.title)}</a>`)
          .join("")}
      </p>
    </article>`;
  })
  .join("");
