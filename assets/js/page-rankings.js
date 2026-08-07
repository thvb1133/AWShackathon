/* Rankings page: leaderboard, badge wall and data import/export. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { leaderboard, currentUsername, getProgress, rankTitle, BADGES, exportData, importData } from "./store.js";
import { TOTAL_LEVELS } from "./lessons.js";

initShell("rankings.html");

const me = currentUsername();

function render() {
  const rows = leaderboard();
  const tbody = document.querySelector("#board tbody");
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (r, i) => `<tr class="${r.username === me ? "me" : ""}">
        <td>${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
        <td><span class="avatar" style="display:inline-grid;vertical-align:middle">${r.avatar}</span> ${escapeHtml(r.username)}${r.username === me ? " <span class=\"chip gold\">you</span>" : ""}</td>
        <td><b>${r.xp}</b></td>
        <td>${escapeHtml(r.rank)}</td>
        <td>${r.levels}/${TOTAL_LEVELS}</td>
        <td>${r.planets}</td>
        <td>${r.badges}</td>
        <td>${r.quiz}</td>
        <td>${r.streak > 0 ? `🔥 ${r.streak}` : "—"}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="9" class="muted">Nobody has registered in this browser yet.</td></tr>`;

  const card = document.getElementById("you-card");
  if (me) {
    const p = getProgress();
    const place = rows.findIndex((r) => r.username === me) + 1;
    const ahead = place > 1 ? rows[place - 2] : null;
    card.innerHTML = `<h2>Your standing</h2>
      <p>You are <b>#${place}</b> of ${rows.length} with <b>${p.xp} XP</b>, rank <b>${escapeHtml(rankTitle(p.xp))}</b>.
         ${ahead ? `${escapeHtml(ahead.username)} is ${ahead.xp - p.xp} XP ahead.` : "Nobody is above you."}</p>
      <div class="bar" style="margin:.5rem 0"><span style="width:${Math.min(100, (p.xp / 500) * 100)}%"></span></div>
      <p class="muted">Next ranks: Cadet 70 XP · Orbit Pilot 150 · Star Navigator 260 · Cosmic Master 400.</p>`;
  } else {
    card.innerHTML = `<h2>You are not logged in</h2>
      <p>The demo cadets below ship with the app so the board is never an empty void.</p>
      <p class="lesson-actions"><a class="btn primary" href="register.html">Register</a><a class="btn" href="login.html">Login</a></p>`;
  }

  const p = me ? getProgress() : { badges: [] };
  document.getElementById("badge-wall").innerHTML = BADGES.map(
    (b) => `<div class="badge ${p.badges.includes(b.id) ? "earned" : ""}">
      <span class="ico">${b.icon}</span>${escapeHtml(b.name)}</div>`
  ).join("");
}
render();

/* --------------------------------------------------- import/export */
const status = document.getElementById("io-status");

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([exportData()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `beyond-orbit-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("💾 Exported. That file is your whole progress, in readable JSON.", "good");
});

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = importData(await file.text());
    status.textContent = `Imported ${n} cadet record(s). Higher XP always wins on conflicts.`;
    toast("📂 Capsule restored.", "good");
    render();
  } catch (err) {
    status.textContent = err.message;
    toast("That file could not be read.", "bad");
  }
});

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("Erase every cadet, score and setting stored in this browser? This cannot be undone.")) return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bo_")) localStorage.removeItem(key);
  }
  toast("🗑️ Local data cleared. Reloading.", "good");
  setTimeout(() => location.reload(), 900);
});
