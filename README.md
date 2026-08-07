# 🌌 Beyond Orbit: A Tale of Two Souls

A living cosmic classroom you can talk to. Two mentors — **MRS THORN BIRD**, the poetic cosmos, and **MR PENGUIN**, the
cold engineering — teach the universe to their student, **USERKIMCHI**. Around that story sits a real space application:
a 3D Solar System driven by orbital mechanics, live satellite tracking, public NASA and NOAA data, an encyclopedia of
everything humankind has found beyond Earth, a mesh of 527 specialist agents, quantum machine learning that routes every
request, and a pink-and-purple orb that listens to your voice and answers out loud.

Static site. No build step, no framework, no server, no database, and no API key required to use any of it.

---

# ▶️ How to run it

The app uses ES modules, an import map and a service worker, so it must be served over HTTP. Opening `index.html`
straight off disk (`file://`) will not work — the browser blocks module loading from that scheme.

Pick whichever of these you already have:

### Python (already installed on macOS and Linux)

```bash
cd beyond-orbit
python3 -m http.server 8080
```

Then open **<http://localhost:8080>**

### Node

```bash
cd beyond-orbit
npx serve -l 8080
```

### PHP

```bash
php -S localhost:8080
```

### VS Code

Install the **Live Server** extension, right-click `index.html`, choose *Open with Live Server*.

### XAMPP / WAMP / MAMP

Copy the folder into `htdocs`, then open `http://localhost/beyond-orbit/`.

**Which browser?** Everything works in any modern browser. Voice *input* — the orb listening to you — needs the Web
Speech Recognition API, which today means **Chrome or Edge**. Voice *output* works everywhere. The 3D pages need WebGL,
and where it is missing they say so clearly instead of showing a blank canvas.

---

# 🚀 How to deploy it

There is nothing to compile, so deployment is just uploading the folder. Every path in the app is relative, which means
it works from a subdirectory as happily as from a domain root.

### Option 1 — GitHub Pages (free, and already wired up)

A workflow at `.github/workflows/deploy-pages.yml` is included. To turn it on:

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **GitHub Actions**.
4. Push to `main` (or run the workflow by hand from the **Actions** tab).

Your site appears at:

```
https://<your-username>.github.io/<your-repository>/
```

For this repository that is **`https://thvb1133.github.io/AWShackathon/`**.

### Option 2 — Netlify (free, no account needed to try)

Open <https://app.netlify.com/drop> and drag the project folder onto the page. You get a live URL in a few seconds.

### Option 3 — Vercel or Cloudflare Pages (free)

```bash
npx vercel --prod          # or: npx wrangler pages deploy .
```

When either asks for a build command, leave it empty and set the output directory to `.` — there is no build.

### Option 4 — Any web host at all

Upload the whole folder by FTP, or drop it in your university web space. It is plain HTML, CSS and JavaScript.

**One caveat that applies everywhere:** the microphone and the service worker need a **secure context**, meaning HTTPS
or `localhost`. All four options above give you HTTPS automatically. Plain `http://` on a public IP will load the pages
but will refuse the microphone.

---

# 🧠 Adding a language model (optional, and free)

The app answers perfectly well without one. With a model attached, the answers become conversational prose instead of
plain agent reports — but the numbers are identical either way, because of how the pipeline is ordered:

```
your words
   ↓
⚛️  quantum classifier   decides what kind of thing you are asking for
   ↓
🤖  agent mesh           computes the orbit, propagates the satellite, calls the API  → THESE ARE THE FACTS
   ↓
🗣️  language model       phrases those facts in the mentors' voices  → NEVER SUPPLIES A NUMBER
   ↓
🔊  speech synthesis
```

The model receives the mesh's results as context it is instructed not to contradict. That ordering is the whole reason
the app does not hallucinate: ask where the ISS is and the coordinates come from SGP4, and the model only gets to write
the sentence around them.

Go to the **JARVIS** page → *The brain*, pick a provider, paste a key, press **Save**, then **Test connection**.

| Provider | Free tier | Where to get a key |
| --- | --- | --- |
| **Local mesh only** | always, and offline | no key — this is the default |
| **Google Gemini** | free, no card | <https://aistudio.google.com/apikey> |
| **Groq** | free, no card | <https://console.groq.com/keys> — much the fastest for spoken conversation |
| **OpenRouter** | any model ending `:free` | <https://openrouter.ai/keys> |
| **Ollama** | free and entirely local | <https://ollama.com> — see the note below |

For Ollama, nothing leaves your computer:

```bash
ollama pull llama3.2
OLLAMA_ORIGINS=* ollama serve      # the origins flag lets a browser page reach it
```

Your key is stored **only in your browser**, encrypted at rest with the BB84 key described below. It is never sent
anywhere except to the provider you chose. There is no key committed to this repository and the app never needs one.

---

# 🔮 Talking to it

Open **JARVIS**, press **Start talking**, and speak. That is the whole interaction.

- The orb's surface is displaced by your **actual microphone amplitude**, read from a Web Audio `AnalyserNode`. When it
  moves, that is your voice moving it.
- It **answers out loud** and then listens again, so it is a conversation rather than a search box.
- **Interrupt it.** Talk over the reply and sustained loudness cuts it short and hands you the turn.
- Recognition is **suspended while it speaks**, because otherwise the recogniser hears the synthesiser and the assistant
  starts answering itself.
- Prefer a wake word? Tick *Require the wake word “Jarvis”* and it ignores everything else.
- The floating 🛰️ button gives you the same brain on every other page.

Four orb states, each with its own colour and rhythm: **idle** breathing violet, **listening** hot pink and reactive,
**thinking** gold and turbulent, **speaking** pink-and-violet pulses.

---

# ⚛️ The quantum part, honestly

Open the **Quantum Core** page and every claim below is inspectable, live.

**What it is.** A state-vector simulator in `assets/js/quantum.js`, holding the full complex amplitude vector of an
n-qubit register and applying exact unitary gates to it. On top of that:

- **A variational quantum classifier** decides what kind of thing you are asking for — calculate, look up, live data,
  code, or reflect. Five one-vs-rest circuits, 5 qubits, 150 trainable angles, trained **in your browser** by the
  **parameter-shift rule** (`∂⟨Z⟩/∂θ = ½[f(θ+π/2) − f(θ−π/2)]`), which is how gradients are actually obtained on
  hardware, because you cannot backpropagate through a physical device.
- **A quantum kernel** gives a second, independent opinion: `K(x,x′) = |⟨φ(x)|φ(x′)⟩|²` using the ZZ feature map of
  Havlíček et al. (*Nature*, 2019), estimated the way a device does it — prepare `|φ(x′)⟩`, apply `U(x)†`, and measure
  the probability of all zeros. When the two models disagree, confidence drops and the agent search widens.
- **BB84 quantum key distribution** with basis sifting, parameter estimation and the 11% abort threshold. Switch Eve on
  and watch the error rate jump to ~25%, because measuring a quantum state changes it and she cannot avoid that.
- **Grover's search** and **Bell pairs**, because they are the clearest proof that these are real amplitudes: Grover
  genuinely climbs to 99.9% on 32 items in 4 iterations, and entangled measurements agree 500 times out of 500 while
  two independent superpositions agree about half the time.

**This is not decoration.** The classification genuinely routes the mesh — it is what separates *"what would I weigh on
Titan"* (send it to the gravity calculator) from *"tell me about Titan"* (send it to the encyclopedia). And the BB84 key
genuinely encrypts your API key at rest.

**What it is not.** A quantum processor. Nothing in a browser can be. A 5-qubit register is simply cheap to simulate
exactly; on real hardware the mathematics would be identical and you would get shot noise and decoherence for free.
A *simulated* key exchange also cannot provide physical secrecy, because Alice and Bob are the same computer — so the
key is used for obfuscation at rest, and the app says so on screen rather than pretending otherwise.

The reason to build it this way is that a claim you can inspect is worth more than one you cannot.

---

# 🛰️ The rest of it

| Page | What it does |
| --- | --- |
| `index.html` | The story, a live data strip, the way in |
| `jarvis.html` | **The orb.** Talk to the whole application; configure its brain |
| `quantum.html` | **The quantum core.** Self-check, live training, BB84, Grover, Bell pairs |
| `classroom.html` | Pick a mentor; see how far you have travelled |
| `mrs-thorn-bird-1/2.html` | Eight lessons on the universe, narrated on demand |
| `mr-penguin-1/2.html` | Eleven lessons on space technology |
| `cosmos.html` | The live 3D Solar System, with a clock from 1600 to 2200 |
| `orbitlab.html` | Real satellites on a 3D Earth, plus a pass predictor |
| `codex.html` | 385 entries — every catalogue in the app, in one search box |
| `mission-control.html` | Live public feeds, each labelled with its provenance |
| `agents.html` | The 527-agent mesh and its task console |
| `quiz.html` | A quiz generated fresh from the codex, and your reflection |
| `rankings.html` | The leaderboard, badges and data import/export |
| `about.html` | The legend, the engineering, and the bugs that were fixed |
| `login.html`, `register.html` | Local accounts, validated properly |

### The Solar System is solved, not animated

Planets, dwarf planets and Halley's Comet carry their J2000 orbital elements. For any instant on the clock, `orbit.js`
computes the mean anomaly, solves Kepler's equation `M = E − e·sin E` with Newton–Raphson, and rotates the result into
the ecliptic. Drag the year to 1610 and Jupiter is where Galileo saw it; drag it to 2061 and Halley is coming back.

### The satellites are the actual satellites

`orbitlab.js` fetches live two-line element sets from CelesTrak and propagates them with the NORAD **SGP4** model
(vendored `satellite.js`). Altitude, velocity, inclination, period, ground track and visible passes are all computed.
When CelesTrak cannot be reached, a bundled snapshot flies instead and the status line says so.

### The agents cannot invent a number

527 specialists: 25 engineering calculators, 137 codex specialists, 166 industry desks, 28 live constellation operators,
10 public feeds, 19 classroom tutors, 39 national programmes, 21 sector analysts, 34 launch ranges, 30 observatories and
18 ground networks. Every report names the agent that produced it and, where data was fetched, whether it arrived live,
from cache, or from the bundled snapshot.

### There are no image files

Every planet surface, ring, glow, star field, globe texture and orb shader is generated procedurally at runtime.

---

# 📡 Data sources

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
[api.nasa.gov](https://api.nasa.gov) raises that to 1,000 per hour and can be pasted into Mission Control.

**About JPL.** Its Solar System Dynamics API is excellent and needs no key, but it does not send an
`Access-Control-Allow-Origin` header, so a browser fetches the data and is then forbidden to read it. No client-side
code can work around that. Rather than fail noisily, those two panels explain the situation and offer an optional relay
prefix. Everything else is read directly.

Every feed follows the same three rules: never block the interface (each request has a timeout), never lose a good
answer (successes are cached with a per-feed lifetime), and never show a dead page (fall back to cache, then to a
bundled snapshot, and always say which of the three you are looking at).

---

# 💾 Storage and privacy

Users, progress, badges, quiz results, reflections, settings, trained quantum weights and the LLM configuration are held
as JSON in `localStorage`, namespaced under `bo_`. Passwords are hashed before they are written and API keys are
encrypted with the BB84 key — both of which are **obfuscation, not security**, and it is honest to say so: a site with
no server has nobody to authenticate against. Progress exports as readable JSON and imports merge rather than
overwrite, keeping the higher score where records collide.

Nothing is transmitted anywhere except to the public data sources above, and to an LLM provider if you configure one.

---

# ♿ Accessibility

Three themes including high contrast; an extra-readable font and spacing mode; text scaling from 85% to 150%; narration
of every lesson in a distinct voice per mentor; full keyboard operation with visible focus rings;
`prefers-reduced-motion` honoured throughout; and offline operation after the first visit via a service worker.

---

# 🗂️ Layout

```
index.html  jarvis.html  quantum.html  classroom.html  cosmos.html  orbitlab.html
codex.html  mission-control.html  agents.html  quiz.html  rankings.html  about.html
login.html  register.html  mrs-thorn-bird-{1,2}.html  mr-penguin-{1,2}.html
sw.js  manifest.webmanifest  .github/workflows/deploy-pages.yml

assets/css/style.css          the whole design system
assets/js/
  quantum.js                  state-vector simulator: gates, kernels, BB84, Grover
  qml.js                      the classifiers that route the mesh, and the QKD session key
  llm.js                      five free providers, mesh-grounded prompting
  orb.js                      the talking orb and the microphone level meter
  converse.js                 the listen-answer-speak loop
  agents.js                   527 agents and the quantum-assisted router
  universe.js                 the codex: worlds, missions, people, theories
  companies.js                the working space industry of Earth
  facilities.js               spaceports, observatories, ground networks
  lessons.js                  the nineteen-level syllabus
  orbit.js                    Kepler, SGP4 and mission arithmetic
  solar3d.js                  the 3D Solar System
  orbitlab.js                 the 3D Earth and its satellites
  live.js                     every public feed, cached and labelled
  mentor.js                   the floating JARVIS console
  store.js                    localStorage: users, progress, badges
  ui.js, voice.js             shared chrome, speech in and out
  page-*.js                   one controller per page
assets/vendor/                three.js and satellite.js, vendored
```

---

*Beejalben Amitkumar Patel · M01035595 · Web Application & Database*

> “Every orbit we travel is a circle within our own soul.”
