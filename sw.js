/* ============================================================
   sw.js — offline support.

   The application shell is cached on install so the classroom, the
   codex, the 3D scenes and the agent mesh all work with no network
   at all. Live API calls are deliberately never cached here: live.js
   already runs its own cache with a per-feed time-to-live, and it
   labels every answer with where it came from.
   ============================================================ */

const VERSION = "beyond-orbit-v5";

const SHELL = [
  "./",
  "index.html",
  "classroom.html",
  "cosmos.html",
  "orbitlab.html",
  "codex.html",
  "mission-control.html",
  "agents.html",
  "jarvis.html",
  "company.html",
  "ventures.html",
  "quantum.html",
  "quiz.html",
  "rankings.html",
  "about.html",
  "login.html",
  "register.html",
  "mrs-thorn-bird-1.html",
  "mrs-thorn-bird-2.html",
  "mr-penguin-1.html",
  "mr-penguin-2.html",
  "manifest.webmanifest",
  "assets/css/style.css",
  "assets/js/agents.js",
  "assets/js/api.js",
  "assets/js/ambient.js",
  "assets/js/automate.js",
  "assets/js/companies.js",
  "assets/js/converse.js",
  "assets/js/crew.js",
  "assets/js/facilities.js",
  "assets/js/lessons.js",
  "assets/js/integrations.js",
  "assets/js/live.js",
  "assets/js/llm.js",
  "assets/js/memory.js",
  "assets/js/mentor.js",
  "assets/js/orb.js",
  "assets/js/optimizer.js",
  "assets/js/orbit.js",
  "assets/js/orbitlab.js",
  "assets/js/page-about.js",
  "assets/js/page-agents.js",
  "assets/js/page-auth.js",
  "assets/js/page-classroom.js",
  "assets/js/page-company.js",
  "assets/js/page-codex.js",
  "assets/js/page-cosmos.js",
  "assets/js/page-home.js",
  "assets/js/page-jarvis.js",
  "assets/js/page-lesson.js",
  "assets/js/page-mission.js",
  "assets/js/page-orbitlab.js",
  "assets/js/page-quantum.js",
  "assets/js/page-quiz.js",
  "assets/js/page-ventures.js",
  "assets/js/page-rankings.js",
  "assets/js/solar3d.js",
  "assets/js/qml.js",
  "assets/js/quantum.js",
  "assets/js/store.js",
  "assets/js/tle-fallback.js",
  "assets/js/ui.js",
  "assets/js/universe.js",
  "assets/js/ventures.js",
  "assets/js/voice.js",
  "assets/vendor/three.module.js",
  "assets/vendor/satellite.es.js",
  "assets/vendor/jsm/controls/OrbitControls.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // One failed file must not abort the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // live feeds go straight to the network

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match("index.html"));
      // Serve the cache instantly, then refresh it in the background.
      return cached || network;
    })
  );
});
