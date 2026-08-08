/* Quiz page: questions generated from the codex, plus the reflection. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { CODEX, PLANETS, MOONS, MISSIONS, PEOPLE, DEEP_SKY, THEORIES, DWARFS } from "./universe.js";
import { currentUser, recordQuiz, saveReflection, getProgress, getAllProgress, getUsers } from "./store.js";
import { speak } from "./voice.js";

initShell("quiz.html");

const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const pick = (arr, n) => shuffle(arr).slice(0, n);

const POOLS = {
  worlds: [...PLANETS, ...DWARFS, ...MOONS],
  missions: MISSIONS,
  people: PEOPLE,
  deep: [...DEEP_SKY, ...THEORIES],
  all: CODEX,
};

/* --------------------------------------------------- generation */

/** Builds one multiple-choice question from a codex entry. */
function questionFor(entry, pool) {
  const kinds = [];
  if (entry.who) kinds.push("who");
  if (entry.facts?.length) kinds.push("fact");
  if (entry.when) kinds.push("when");
  const kind = kinds[Math.floor(Math.random() * kinds.length)] || "fact";

  const distractors = pick(pool.filter((e) => e.id !== entry.id && e.cat === entry.cat), 3);
  const others = distractors.length === 3 ? distractors : pick(pool.filter((e) => e.id !== entry.id), 3);

  if (kind === "who") {
    return {
      prompt: `Which of these is described as: “${entry.who}”?`,
      correct: entry.name,
      options: shuffle([entry.name, ...others.map((o) => o.name)]),
      because: `${entry.name} — ${entry.who}`,
    };
  }
  if (kind === "when") {
    return {
      prompt: `${entry.emoji || ""} ${entry.name} — which date belongs to it?`,
      correct: entry.when,
      options: shuffle([entry.when, ...others.map((o) => o.when).filter(Boolean)]).slice(0, 4),
      because: `${entry.name}: ${entry.when}. ${entry.who || ""}`,
    };
  }
  const fact = entry.facts[Math.floor(Math.random() * entry.facts.length)];
  return {
    prompt: `Which of these is true of ${entry.emoji || ""} ${entry.name}?`,
    correct: fact,
    options: shuffle([fact, ...others.map((o) => o.facts?.[0]).filter(Boolean)]).slice(0, 4),
    because: `${entry.name}: ${fact}`,
  };
}

function buildQuiz(count, topic) {
  const pool = POOLS[topic] || CODEX;
  const usable = pool.filter((e) => e.facts?.length >= 1);
  const chosen = pick(usable, Math.min(count, usable.length));
  return chosen
    .map((e) => questionFor(e, usable))
    .filter((q) => q.options.length >= 3 && q.options.every(Boolean) && q.options.includes(q.correct));
}

/* ------------------------------------------------------ running */
const body = document.getElementById("quiz-body");
let quiz = [];
let answers = [];
let narrate = false;

document.getElementById("btn-narrate-q").addEventListener("click", (e) => {
  narrate = !narrate;
  e.target.textContent = narrate ? "🔇 Stop reading questions" : "🔊 Read questions aloud";
});

document.getElementById("btn-start").addEventListener("click", () => {
  const count = parseInt(document.getElementById("q-count").value, 10);
  const topic = document.getElementById("q-topic").value;
  quiz = buildQuiz(count, topic);
  answers = new Array(quiz.length).fill(null);
  render();
});

function render() {
  body.innerHTML = quiz
    .map(
      (q, i) => `<article class="lesson" id="q-${i}">
        <h3>Question ${i + 1} of ${quiz.length}</h3>
        <p>${escapeHtml(q.prompt)}</p>
        ${q.options.map((o) => `<button class="q-option" data-q="${i}" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("")}
        <p class="muted explain" hidden></p>
      </article>`
    )
    .join("") + `<p class="lesson-actions"><button class="btn primary" id="btn-submit">Submit answers</button>
      <span class="muted" id="answered-count">0 of ${quiz.length} answered</span></p>`;

  if (narrate && quiz.length) speak(`Question one. ${quiz[0].prompt}`, "penguin");
}

body.addEventListener("click", (e) => {
  const opt = e.target.closest(".q-option");
  if (opt) {
    const i = parseInt(opt.dataset.q, 10);
    answers[i] = opt.dataset.o;
    for (const sibling of document.querySelectorAll(`.q-option[data-q="${i}"]`)) {
      sibling.style.borderColor = "";
      sibling.style.background = "";
    }
    opt.style.borderColor = "var(--gold)";
    opt.style.background = "rgba(255,209,102,.15)";
    document.getElementById("answered-count").textContent = `${answers.filter(Boolean).length} of ${quiz.length} answered`;
    if (narrate && quiz[i + 1]) speak(`Question ${i + 2}. ${quiz[i + 1].prompt}`, "penguin");
    return;
  }

  if (e.target.id === "btn-submit") grade();
});

function grade() {
  let score = 0;
  quiz.forEach((q, i) => {
    const correct = answers[i] === q.correct;
    if (correct) score++;
    for (const btn of document.querySelectorAll(`.q-option[data-q="${i}"]`)) {
      btn.disabled = true;
      btn.style.borderColor = "";
      btn.style.background = "";
      if (btn.dataset.o === q.correct) btn.classList.add("right");
      else if (btn.dataset.o === answers[i]) btn.classList.add("wrong");
    }
    const explain = document.querySelector(`#q-${i} .explain`);
    explain.hidden = false;
    explain.innerHTML = `${correct ? '<span class="tick">✓ correct</span>' : '<span class="cross">✗ not quite</span>'} — ${escapeHtml(q.because)}`;
  });

  const pct = Math.round((score / quiz.length) * 100);
  const verdict =
    pct >= 90 ? "MR PENGUIN raises one eyebrow, which from him is a standing ovation."
      : pct >= 70 ? "Solid. MRS THORN BIRD says the sky is starting to recognise you."
      : pct >= 40 ? "A real start. Go back through a level or two and try again — the questions regenerate."
      : "The universe is large and you have just met it. Read a few levels and come back.";

  const result = document.createElement("div");
  result.className = "card mt";
  result.innerHTML = `<h2>Score: ${score} / ${quiz.length} (${pct}%)</h2><p class="poetic">${escapeHtml(verdict)}</p>`;
  body.appendChild(result);
  result.scrollIntoView({ behavior: "smooth", block: "center" });

  if (currentUser()) {
    const before = getProgress().quiz.best;
    recordQuiz(score, quiz.length, answers);
    const after = getProgress();
    if (score > before) toast(`🎯 New personal best: ${score}. Total ${after.xp} XP.`, "good");
    else toast(`Recorded. Your best remains ${after.quiz.best}.`);
  } else {
    toast("Register to record quiz scores on the leaderboard.", "bad");
  }
  if (narrate) speak(`You scored ${score} out of ${quiz.length}. ${verdict}`, "thorn");
}

/* --------------------------------------------------- reflection */
const textarea = document.getElementById("reflection");
const status = document.getElementById("reflection-status");
const user = currentUser();

if (user) {
  textarea.value = getProgress().reflection || "";
  status.textContent = textarea.value ? "Saved earlier — edit and save again any time." : "";
} else {
  status.textContent = "Log in to save your reflection permanently.";
}

document.getElementById("btn-save-reflection").addEventListener("click", () => {
  if (!currentUser()) {
    toast('🔒 Register or log in to save. <a href="register.html">Register →</a>', "bad");
    return;
  }
  const text = textarea.value.trim();
  if (text.length < 20) {
    status.textContent = "Write at least a couple of sentences — they are worth 20 XP the first time.";
    return;
  }
  const before = getProgress().reflection.trim().length;
  saveReflection(text);
  status.textContent = `Saved at ${new Date().toLocaleTimeString()}.`;
  toast(before ? "📝 Reflection updated." : "📝 Reflection saved — +20 XP.", "good");
  renderOthers();
});

/* ----------------------------------------- what other cadets said */
function renderOthers() {
  const all = getAllProgress();
  const users = getUsers();
  const entries = Object.entries(all)
    .filter(([, p]) => (p.reflection || "").trim().length > 30)
    .slice(0, 8);
  const card = document.getElementById("others-card");
  if (!entries.length) {
    card.innerHTML = `<h2>🌠 The reflection wall</h2>
      <p class="muted">Nobody in this browser has written a reflection yet. Yours would be the first.</p>`;
    return;
  }
  card.innerHTML = `<h2>🌠 The reflection wall</h2>
    <p class="muted">What other cadets registered on this device have written.</p>
    ${entries
      .map(
        ([name, p]) => `<blockquote class="whisper"><b>${users[name]?.avatar || "🚀"} ${escapeHtml(name)}</b><br>
          ${escapeHtml(p.reflection.slice(0, 400))}${p.reflection.length > 400 ? "…" : ""}</blockquote>`
      )
      .join("")}`;
}
renderOthers();
