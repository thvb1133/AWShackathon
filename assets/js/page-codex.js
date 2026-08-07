/* Codex page: one searchable index over every catalogue in the app. */

import { initShell, escapeHtml, toast } from "./ui.js";
import { CODEX, CATEGORIES, ERAS } from "./universe.js";
import { COMPANIES } from "./companies.js";
import { SPACEPORTS, OBSERVATORIES, GROUND_NETWORKS } from "./facilities.js";
import { speak } from "./voice.js";

initShell("codex.html");

/* Facilities are turned into codex-shaped records so one search box
   covers worlds, industry and infrastructure alike. */
const facilityEntries = [
  ...SPACEPORTS.map((s) => ({
    id: `pad-${s.id}`, name: s.name, emoji: "🚀", cat: "spaceport", era: "present",
    who: `${s.country} · operated by ${s.operator}`,
    when: `${Math.abs(s.lat).toFixed(2)}° ${s.lat >= 0 ? "N" : "S"}`,
    facts: [
      s.flies,
      `Free eastward velocity from Earth's rotation: ${s.rotationBoostMs.toFixed(0)} m/s.`,
      `Lowest inclination reachable without a dogleg: ${s.minInclination.toFixed(2)}°.`,
    ],
    line: s.minInclination < 10 ? "Close enough to the equator to be prime real estate for geostationary missions." : "A mid or high latitude range, best suited to inclined and polar orbits.",
  })),
  ...OBSERVATORIES.map((o) => ({
    id: `obs-${o.id}`, name: o.name, emoji: "🔭", cat: "observatory", era: "present",
    who: o.country, when: `${Math.abs(o.lat).toFixed(2)}° ${o.lat >= 0 ? "N" : "S"}`,
    facts: [o.spec, o.studies],
    line: "A real instrument, pointed at the sky tonight.",
  })),
  ...GROUND_NETWORKS.map((g) => ({
    id: `gs-${g.id}`, name: g.name, emoji: "📡", cat: "ground", era: "present",
    who: g.operator, when: g.bands,
    facts: [g.sites, g.purpose],
    line: "Without a ground segment, a spacecraft is just an expensive rock.",
  })),
];

const ALL = [...CODEX, ...COMPANIES, ...facilityEntries].map((e) => ({
  ...e,
  search: [e.name, e.cat, e.era, e.who, e.when, ...(e.facts || []), e.line].join(" ").toLowerCase(),
}));

const LABELS = {
  ...CATEGORIES,
  company: { label: "Companies", emoji: "🏭" },
  spaceport: { label: "Spaceports", emoji: "🚀" },
  observatory: { label: "Observatories", emoji: "🔭" },
  ground: { label: "Ground Networks", emoji: "📡" },
};

const catSelect = document.getElementById("cat");
const eraSelect = document.getElementById("era");
const queryInput = document.getElementById("q");
const results = document.getElementById("results");
const countLine = document.getElementById("result-count");
const moreBtn = document.getElementById("btn-more");

const cats = [...new Set(ALL.map((e) => e.cat))].sort((a, b) =>
  (LABELS[a]?.label || a).localeCompare(LABELS[b]?.label || b)
);

catSelect.innerHTML =
  `<option value="all">Everything (${ALL.length})</option>` +
  cats.map((c) => {
    const n = ALL.filter((e) => e.cat === c).length;
    return `<option value="${c}">${LABELS[c]?.emoji || "•"} ${escapeHtml(LABELS[c]?.label || c)} (${n})</option>`;
  }).join("");

document.getElementById("codex-intro").textContent =
  `${ALL.length} entries: ${CODEX.length} worlds, missions, people and ideas; ${COMPANIES.length} organisations working in space today; ` +
  `${SPACEPORTS.length} launch ranges, ${OBSERVATORIES.length} observatories and ${GROUND_NETWORKS.length} ground networks. ` +
  `Each record says who found or built it, and when.`;

document.getElementById("quick-cats").innerHTML = ["planet", "moon", "mission", "person", "phenomenon", "theory", "company", "spaceport", "observatory", "tech"]
  .filter((c) => cats.includes(c))
  .map((c) => `<button class="chip" data-cat="${c}">${LABELS[c]?.emoji || ""} ${escapeHtml(LABELS[c]?.label || c)}</button>`)
  .join("");
document.getElementById("quick-cats").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat]");
  if (!btn) return;
  catSelect.value = btn.dataset.cat;
  render();
});

/* -------------------------------------------------------- search */
const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "is", "to"]);

function score(entry, terms) {
  if (!terms.length) return 1;
  let s = 0;
  const name = entry.name.toLowerCase();
  for (const t of terms) {
    if (name === t) s += 40;
    else if (name.includes(t)) s += 14;
    if (entry.id.includes(t)) s += 6;
    if (entry.cat.includes(t)) s += 4;
    if (entry.search.includes(t)) s += 1;
  }
  return s;
}

let shown = 24;

function matches() {
  const terms = (queryInput.value.toLowerCase().match(/[a-z0-9*'-]+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));
  const cat = catSelect.value;
  const era = eraSelect.value;
  return ALL.filter((e) => (cat === "all" || e.cat === cat) && (era === "all" || e.era === era))
    .map((e) => ({ e, s: score(e, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .map((r) => r.e);
}

function render() {
  const list = matches();
  countLine.textContent = `${list.length} entr${list.length === 1 ? "y" : "ies"} match. ${list.length > shown ? `Showing the first ${shown}.` : ""}`;
  results.innerHTML = list
    .slice(0, shown)
    .map(
      (e) => `<button class="codex-card" data-id="${escapeHtml(e.id)}">
        <div class="meta">${LABELS[e.cat]?.emoji || "•"} ${escapeHtml(LABELS[e.cat]?.label || e.cat)} · ${ERAS[e.era]?.emoji || ""} ${escapeHtml(e.era)}</div>
        <h3>${e.emoji || ""} ${escapeHtml(e.name)}</h3>
        <p class="meta">${escapeHtml(e.when || "")}</p>
        <p>${escapeHtml((e.facts?.[0] || e.line || "").slice(0, 150))}</p>
      </button>`
    )
    .join("");
  moreBtn.hidden = list.length <= shown;
  if (!list.length) {
    results.innerHTML = `<p class="muted">Nothing matched. The codex covers worlds, missions, people, theories,
      technology, companies, spaceports, observatories and ground networks — try a broader word.</p>`;
  }
}

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
queryInput.addEventListener("input", debounce(() => { shown = 24; render(); }, 160));
catSelect.addEventListener("change", () => { shown = 24; render(); });
eraSelect.addEventListener("change", () => { shown = 24; render(); });
moreBtn.addEventListener("click", () => { shown += 36; render(); });

document.getElementById("btn-random").addEventListener("click", () => {
  const pick = ALL[Math.floor(Math.random() * ALL.length)];
  openEntry(pick.id);
});

/* --------------------------------------------------- entry view */
const dialog = document.getElementById("entry-dialog");

function openEntry(id) {
  const e = ALL.find((x) => x.id === id);
  if (!e) return;
  const inCosmos = CODEX.some((c) => c.id === id && ["planet", "dwarf", "moon", "star", "comet"].includes(c.cat));
  dialog.innerHTML = `
    <p class="meta muted">${LABELS[e.cat]?.emoji || "•"} ${escapeHtml(LABELS[e.cat]?.label || e.cat)} · ${ERAS[e.era]?.label || e.era}</p>
    <h2>${e.emoji || ""} ${escapeHtml(e.name)}</h2>
    ${e.who ? `<p class="muted"><b>Who &amp; how:</b> ${escapeHtml(e.who)}</p>` : ""}
    ${e.when ? `<p class="muted"><b>When:</b> ${escapeHtml(e.when)}</p>` : ""}
    <ul>${(e.facts || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
    ${e.line ? `<p class="poetic">“${escapeHtml(e.line)}”</p>` : ""}
    <div class="lesson-actions">
      <button class="btn small" id="dlg-speak">🔊 Read it aloud</button>
      ${inCosmos ? `<a class="btn small ice" href="cosmos.html?id=${encodeURIComponent(e.id)}">🌍 See it in 3D</a>` : ""}
      <button class="btn small ghost" id="dlg-close" style="margin-left:auto">Close</button>
    </div>`;
  dialog.showModal();
  dialog.querySelector("#dlg-close").addEventListener("click", () => dialog.close());
  dialog.querySelector("#dlg-speak").addEventListener("click", () => {
    const who = ["mission", "tech", "vehicle", "telescope", "station", "company", "spaceport", "ground"].includes(e.cat) ? "penguin" : "thorn";
    speak(`${e.name}. ${(e.facts || []).join(" ")} ${e.line || ""}`, who);
  });
  history.replaceState(null, "", `?id=${encodeURIComponent(e.id)}`);
}

results.addEventListener("click", (ev) => {
  const card = ev.target.closest("[data-id]");
  if (card) openEntry(card.dataset.id);
});
dialog.addEventListener("close", () => history.replaceState(null, "", location.pathname));

render();

const deepLink = new URLSearchParams(location.search).get("id");
if (deepLink) {
  if (ALL.some((e) => e.id === deepLink)) openEntry(deepLink);
  else toast("That codex entry does not exist.", "bad");
}
