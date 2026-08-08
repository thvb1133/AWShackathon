/* About page: the legend, plus an honest account of how the app is built. */

import { initShell, escapeHtml } from "./ui.js";
import { AGENT_COUNT, MESH_STATS } from "./agents.js";
import { CODEX_COUNT } from "./universe.js";
import { COMPANIES } from "./companies.js";
import { SPACEPORTS, OBSERVATORIES, GROUND_NETWORKS } from "./facilities.js";
import { TOTAL_LEVELS } from "./lessons.js";
import { SOURCES } from "./live.js";

initShell("about.html");

const TECH = [
  ["🌍 A real Solar System", `Planets, dwarf planets and Halley's Comet are placed by solving Kepler's equation with Newton–Raphson against J2000 orbital elements. Set the clock to any date between 1600 and 2200 and every world moves to where it truly is.`],
  ["🛰️ Real satellites", `Live two-line element sets from CelesTrak, propagated with the NORAD SGP4 model. Altitude, velocity, inclination, period and ground track are computed, not looked up.`],
  ["🤖 The agent mesh", `${AGENT_COUNT} specialist agents across ${MESH_STATS.domains} domains. ${MESH_STATS.skills} of them are calculators that solve equations; the rest retrieve records or call named public feeds. None of them can invent a number.`],
  ["🗣️ Voice", `Web Speech Synthesis gives each mentor a distinct voice; Web Speech Recognition provides the wake word. Say “Jarvis” and the console opens itself.`],
  ["📚 The codex", `${CODEX_COUNT} worlds, missions, people, theories and technologies, plus ${COMPANIES.length} organisations, ${SPACEPORTS.length} spaceports, ${OBSERVATORIES.length} observatories and ${GROUND_NETWORKS.length} ground networks — each with who found or built it, and when.`],
  ["🎨 Zero image files", `Every planet surface, ring system, glow and globe texture is drawn procedurally onto a canvas at page load. The entire application ships without downloading a single photograph.`],
  ["💾 Storage", `Users, progress, badges, quiz results and settings live as JSON in localStorage. Exports are plain readable JSON; imports merge instead of overwriting, keeping the higher score on conflicts.`],
  ["🪐 The classroom", `${TOTAL_LEVELS} levels across two mentors, each one narrated on demand and cross-linked into the codex and the 3D scenes.`],
];

document.getElementById("tech-grid").innerHTML = TECH.map(
  ([title, body]) => `<article class="card"><h3>${title}</h3><p class="muted">${escapeHtml(body)}</p></article>`
).join("");

const SOURCE_NOTES = {
  apod: "One curated astronomy image or video every day, with an expert explanation.",
  neo: "Every asteroid passing near Earth in the coming days, with size, speed and miss distance.",
  donki: "Space-weather notifications: flares, coronal mass ejections, radiation storms.",
  epic: "Full-disc photographs of the whole Earth from the DSCOVR spacecraft at L1.",
  cad: "Close-approach records for small bodies, straight from JPL's dynamics group.",
  fireball: "Atmospheric impacts bright enough to be detected by government sensors.",
  tle: "Orbital elements for tens of thousands of tracked objects, refreshed continuously.",
  iss: "The station's ground position, altitude and velocity, updated every few seconds.",
  launch: "Every scheduled launch on Earth, from every provider, with pad and status.",
  swpc: "Solar wind speed, magnetic field and the planetary K-index from NOAA.",
};

document.querySelector("#source-table tbody").innerHTML = SOURCES.map(
  (s) => `<tr><td>${escapeHtml(s.name)}</td><td class="mono">${escapeHtml(s.host)}</td>
    <td>${escapeHtml(SOURCE_NOTES[s.id] || "")}</td></tr>`
).join("");

const BUGS = [
  ["Background image did not fit every screen", "The image stretched differently on each device", "Replaced entirely with layered CSS radial gradients and a canvas starfield — nothing to stretch"],
  ["Login did not redirect after success", "The redirect path was wrong in the JavaScript", "Fixed the target and verified the flow from every page that links to it"],
  ["Score increased again on re-clicking “Completed level”", "Nothing prevented the button being pressed twice", "completeLevel() checks whether the level id already exists before awarding anything, and the button disables itself"],
  ["Returning users lost their data", "The JSON blob was being overwritten instead of merged", "All writes go through updateProgress(), which mutates a copy of the existing record and merges it back"],
  ["Rankings appeared in random order", "The array was rendered unsorted", "Sorted by XP descending, with levels cleared as the tie-breaker"],
  ["Form validation accepted empty or weak input", "Only the browser's built-in HTML5 validation was present", "Added explicit length, format and duplicate-name checks with inline error messages"],
  ["Dark blue text was unreadable on a dark background", "Insufficient contrast", "Rebuilt the palette around light ink on deep violet, and added a high-contrast theme plus a readable-font mode"],
  ["Navigation overlapped the content on phones", "The flex layout had no breakpoint", "Added a hamburger toggle and a media query below 900 px"],
  ["Quiz answers were not saved", "The textarea was never associated with a user", "Reflections are stored per cadet inside the progress record"],
  ["The game was too large for one page", "Nineteen levels in a single document was unusable", "Split into four lesson pages generated from one syllabus file, so the content lives in one place"],
  ["Speech cut off after about 250 characters", "Several browsers truncate a long utterance", "Long text is split into sentence-sized chunks and queued"],
  ["A slow API left the page hanging", "fetch has no timeout by default", "Every request uses an AbortController, then falls back to cache and finally to a bundled snapshot"],
  ["The 3D page crashed where WebGL was unavailable", "The renderer threw during construction", "The failure is caught and replaced with an explanation; the rest of the app is unaffected"],
];

document.querySelector("#bug-table tbody").innerHTML = BUGS.map(
  ([problem, cause, fix]) => `<tr><td>${escapeHtml(problem)}</td><td class="muted">${escapeHtml(cause)}</td><td>${escapeHtml(fix)}</td></tr>`
).join("");
