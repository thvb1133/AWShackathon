# 🌌 Beyond Orbit: A Tale of Two Souls

A living cosmic classroom. Two fictional mentors — **MRS THORN BIRD**, the poetic cosmos, and **MR PENGUIN**, the cold
engineering — teach the universe to their student, **USERKIMCHI**. Around that story sits a real space application: a 3D
Solar System driven by orbital mechanics, live satellite tracking, public NASA and NOAA data, an encyclopedia of
everything humankind has found beyond Earth, and a mesh of over five hundred specialist agents you can talk to by voice.

It is a static site. No build step, no framework, no server, no database, no API key required.

---

## Running it

Because the app uses ES modules, service workers and an import map, it must be served over HTTP rather than opened as a
`file://` path:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static host works — GitHub Pages, Netlify, an Apache directory, a university web server.

**Browsers.** Everything works in any modern browser. Voice *input* (the “Jarvis” wake word) needs the Web Speech
Recognition API, which today means Chrome or Edge; voice *output* works everywhere. The 3D pages need WebGL and, where
it is missing, say so clearly instead of showing a blank canvas.

---

## What is in it

| Page | What it does |
| --- | --- |
| `index.html` | The story, a live data strip, and the way in |
| `classroom.html` | Pick a mentor; see how far you have travelled |
| `mrs-thorn-bird-1/2.html` | Eight lessons on the universe, narrated on demand |
| `mr-penguin-1/2.html` | Eleven lessons on space technology |
| `cosmos.html` | The live 3D Solar System, with a clock from 1600 to 2200 |
| `orbitlab.html` | Real satellites on a 3D Earth, plus a pass predictor |
| `codex.html` | Every catalogue in the app, in one search box |
| `mission-control.html` | Live public feeds, each labelled with its provenance |
| `agents.html` | The agent mesh and its task console |
| `quiz.html` | A quiz generated fresh from the codex, and your reflection |
| `rankings.html` | The leaderboard, badges and data import/export |
| `about.html` | The legend, the engineering, and the bugs that were fixed |
| `login.html`, `register.html` | Local accounts, validated properly |

---

## The parts that are real

**The Solar System is solved, not animated.** Planets, dwarf planets and Halley's Comet carry their J2000 orbital
elements. For any instant on the clock, `orbit.js` computes the mean anomaly, solves Kepler's equation
`M = E − e·sin E` with Newton–Raphson, and rotates the result into the ecliptic. Drag the year to 1610 and Jupiter is
where Galileo saw it; drag it to 2061 and Halley is coming back.

**The satellites are the actual satellites.** `orbitlab.js` fetches live two-line element sets from CelesTrak and
propagates them with the NORAD SGP4 model (vendored `satellite.js`). Altitude, velocity, inclination, period, ground
track and visible passes are all computed. When CelesTrak cannot be reached, a bundled snapshot flies instead and the
status line says so.

**The agents cannot invent a number.** `agents.js` builds its mesh from the catalogues: an engineering calculator for
each solvable problem, a specialist for each codex record, a desk for each real space company, an operator for each live
CelesTrak group, a tutor for each classroom level, plus every spaceport, observatory and ground network. A request is
scored against all of them, and the strongest few run in parallel. Each report names the agent that produced it and,
where data was fetched, whether it arrived live, from cache, or from the bundled snapshot.

**There are no image files.** Every planet surface, ring, glow, star field and globe texture is drawn procedurally onto
a canvas at page load.

---

## Data sources

All free, all public, none requiring a signup.

| Source | Host | Used for |
| --- | --- | --- |
| NASA APOD | `api.nasa.gov` | Picture of the day |
| NASA NeoWs | `api.nasa.gov` | Asteroids passing Earth |
| NASA DONKI | `api.nasa.gov` | Space-weather notifications |
| NASA EPIC | `api.nasa.gov` | Whole-Earth photographs from DSCOVR |
| CelesTrak | `celestrak.org` | Live orbital elements |
| Where the ISS at | `api.wheretheiss.at` | Live station ground track |
| The Space Devs | `ll.thespacedevs.com` | Worldwide launch schedule |
| NOAA SWPC | `services.swpc.noaa.gov` | Solar wind and the Kp index |
| JPL SSD | `ssd-api.jpl.nasa.gov` | Close approaches and fireballs — **needs a relay, see below** |

NASA's shared `DEMO_KEY` is used by default (30 requests per hour). A free personal key from
[api.nasa.gov](https://api.nasa.gov) raises that to 1,000 per hour and can be pasted into Mission Control; it is stored
only in your browser.

**About JPL.** The Solar System Dynamics API is excellent and needs no key, but it does not send an
`Access-Control-Allow-Origin` header, so a browser fetches the data and is then forbidden to read it. No client-side
code can work around that. Rather than fail noisily, those two panels explain the situation and offer an optional relay
prefix. Everything else is read directly.

Every feed follows the same three rules: never block the interface (each request has a timeout), never lose a good
answer (successes are cached with a per-feed lifetime), and never show a dead page (fall back to cache, then to a
bundled snapshot, and always say which of the three you are looking at).

---

## Storage

Users, progress, badges, quiz results, reflections and settings are held as JSON in `localStorage`, namespaced under
`bo_`. Passwords are hashed before they are written — that is obfuscation, not security, and it is honest to say so: a
site with no server has nobody to authenticate against. Progress can be exported as readable JSON and imported again;
imports merge rather than overwrite, keeping the higher score where records collide.

---

## Accessibility

Three themes including high contrast; an extra-readable font and spacing mode; text scaling from 85% to 150%; narration
of every lesson in a distinct voice per mentor; full keyboard operation with visible focus rings; `prefers-reduced-motion`
honoured throughout; and offline operation after the first visit via a service worker.

---

## Layout

```
index.html · classroom.html · cosmos.html · orbitlab.html · codex.html
mission-control.html · agents.html · quiz.html · rankings.html · about.html
login.html · register.html · mrs-thorn-bird-{1,2}.html · mr-penguin-{1,2}.html
sw.js · manifest.webmanifest

assets/css/style.css          the whole design system
assets/js/
  universe.js                 the codex: worlds, missions, people, theories
  companies.js                the working space industry of Earth
  facilities.js               spaceports, observatories, ground networks
  lessons.js                  the nineteen-level syllabus
  orbit.js                    Kepler, SGP4 and mission arithmetic
  solar3d.js                  the 3D Solar System
  orbitlab.js                 the 3D Earth and its satellites
  live.js                     every public feed, cached and labelled
  agents.js                   the agent mesh and its router
  mentor.js                   JARVIS, the voice console
  store.js                    localStorage: users, progress, badges
  ui.js, voice.js             shared chrome, speech in and out
  page-*.js                   one controller per page
assets/vendor/                three.js and satellite.js, vendored
```

---

> “Every orbit we travel is a circle within our own soul.”
