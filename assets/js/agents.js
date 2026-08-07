/* ============================================================
   agents.js — THE BEYOND ORBIT MESH

   A mesh of specialist agents that runs entirely inside the
   browser. There is no hidden server and no language model behind
   this: every agent is a small deterministic expert that either
   (a) computes a real answer from orbital mechanics, (b) retrieves
   a real record from the codex, or (c) calls a real public feed.

   That honesty matters. When the mesh tells you the ISS is over
   the Coral Sea at 417 km, SGP4 was run against a live element set
   to say it — nothing was invented.

   Structure:
     · SKILLS      — hand-written engineering agents that calculate
     · KNOWLEDGE   — one agent per codex entry (worlds, missions, people…)
     · INDUSTRY    — one agent per real space company on Earth
     · CONSTELLATION — one agent per live CelesTrak satellite group
     · FEED        — one agent per public data source
     · TUTOR       — one agent per classroom level
     · REGION      — one agent per space-faring country

   A task is routed by scoring every agent against the request,
   then running the best few in parallel and merging their reports.
   ============================================================ */

import { CODEX, byId, searchCodex, CATEGORIES } from "./universe.js";
import { COMPANIES, SECTORS, COUNTRIES, companiesBySector, companiesByCountry } from "./companies.js";
import { COURSES } from "./lessons.js";
import {
  circularOrbit, hohmann, deltaV, propellantFor, orbitRegime, periodFromAu,
  auFromPeriod, bodyGravity, heliocentric, fromEarth, parseSatellite,
  propagateSatellite, groundTrack, nextPasses, AU_KM, EARTH_RADIUS_KM, MU_EARTH, G0,
} from "./orbit.js";
import { PLANETS } from "./universe.js";
import { SPACEPORTS, OBSERVATORIES, GROUND_NETWORKS, rotationBoost } from "./facilities.js";
import * as live from "./live.js";

/* ------------------------------------------------------------------
   Small helpers shared by the agents
   ------------------------------------------------------------------ */

const num = (text, patterns) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
  }
  return null;
};
const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });

const words = (text) => text.toLowerCase().match(/[a-z0-9*+.-]+/g) || [];

/** Every agent returns a report in this shape. */
const report = (title, lines, extra = {}) => ({ title, lines, ...extra });

/* ==================================================================
   1. SKILL AGENTS — these do arithmetic, not lookup
   ================================================================== */

const SKILLS = [
  {
    id: "skill-orbit-velocity",
    name: "Orbital Velocity Engineer",
    domain: "astrodynamics",
    blurb: "Speed, period and escape velocity for any circular Earth orbit.",
    keys: ["orbit", "velocity", "speed", "altitude", "period", "circular", "leo", "geo", "meo", "km", "escape"],
    run(q) {
      const alt = num(q, [/([\d,.]+)\s*km/i, /altitude\D+([\d,.]+)/i]) ?? 400;
      const o = circularOrbit(alt);
      const regime = orbitRegime(alt);
      return report(`Circular orbit at ${fmt(alt, 0)} km`, [
        `Classification: ${regime.label}`,
        `Orbital speed: ${fmt(o.speedKms, 3)} km/s (${fmt(o.speedKmh, 0)} km/h)`,
        `Orbital period: ${fmt(o.periodMinutes, 1)} minutes — ${fmt(o.periodMinutes / 60, 2)} hours`,
        `Revolutions per day: ${fmt(1440 / o.periodMinutes, 2)}`,
        `Escape velocity from this radius: ${fmt(o.escapeKms, 3)} km/s`,
        `Orbital radius from Earth's centre: ${fmt(o.radiusKm, 0)} km`,
      ]);
    },
  },
  {
    id: "skill-hohmann",
    name: "Transfer Trajectory Planner",
    domain: "astrodynamics",
    blurb: "Two-burn Hohmann transfers between Earth orbits, with fuel cost.",
    keys: ["transfer", "hohmann", "raise", "geo", "gto", "burn", "manoeuvre", "maneuver", "change orbit", "delta"],
    run(q) {
      const all = [...q.matchAll(/([\d,.]+)\s*km/gi)].map((m) => parseFloat(m[1].replace(/,/g, "")));
      const from = all[0] ?? 400;
      const to = all[1] ?? 35786;
      const h = hohmann(from, to);
      return report(`Hohmann transfer ${fmt(from, 0)} km → ${fmt(to, 0)} km`, [
        `First burn (perigee): ${fmt(h.burn1Kms, 3)} km/s`,
        `Second burn (apogee circularisation): ${fmt(h.burn2Kms, 3)} km/s`,
        `Total Δv required: ${fmt(h.totalKms, 3)} km/s`,
        `Coast time between burns: ${fmt(h.transferHours, 2)} hours`,
        `For a 1,000 kg satellite on a 320 s Isp thruster that is ${fmt(propellantFor({ isp: 320, dryMassKg: 1000, deltaVms: h.totalKms * 1000 }), 0)} kg of propellant.`,
      ]);
    },
  },
  {
    id: "skill-rocket-equation",
    name: "Tsiolkovsky Analyst",
    domain: "propulsion",
    blurb: "Δv, mass ratio and propellant mass from the 1903 rocket equation.",
    keys: ["rocket equation", "tsiolkovsky", "isp", "propellant", "fuel", "mass ratio", "specific impulse", "dry mass", "delta-v", "delta v"],
    run(q) {
      const isp = num(q, [/isp\D+([\d,.]+)/i, /([\d,.]+)\s*s(?:ec)?\s*isp/i]) ?? 311;
      const dry = num(q, [/dry\D+([\d,.]+)/i, /([\d,.]+)\s*kg/i]) ?? 1000;
      const dv = num(q, [/([\d,.]+)\s*m\/s/i, /delta.?v\D+([\d,.]+)/i]) ?? 1500;
      const prop = propellantFor({ isp, dryMassKg: dry, deltaVms: dv });
      const achieved = deltaV({ isp, massInitial: dry + prop, massFinal: dry });
      return report(`Rocket equation — Isp ${fmt(isp, 0)} s, dry mass ${fmt(dry, 0)} kg`, [
        `Target Δv: ${fmt(dv, 0)} m/s`,
        `Propellant needed: ${fmt(prop, 1)} kg`,
        `Wet mass at ignition: ${fmt(dry + prop, 1)} kg`,
        `Mass ratio: ${fmt((dry + prop) / dry, 3)}`,
        `Verification — Δv achieved: ${fmt(achieved, 1)} m/s`,
        `Effective exhaust velocity: ${fmt(isp * G0, 0)} m/s`,
      ]);
    },
  },
  {
    id: "skill-launch-window",
    name: "Interplanetary Window Analyst",
    domain: "mission design",
    blurb: "Synodic periods and transfer times between any two planets.",
    keys: ["launch window", "synodic", "mars", "transfer", "interplanetary", "travel time", "how long", "journey", "trip"],
    run(q) {
      const named = PLANETS.filter((p) => q.toLowerCase().includes(p.id));
      const a = named[0] || PLANETS.find((p) => p.id === "earth");
      const b = named[1] || (a.id === "mars" ? PLANETS.find((p) => p.id === "earth") : PLANETS.find((p) => p.id === "mars"));
      const pa = a.orbit.period;
      const pb = b.orbit.period;
      const synodic = Math.abs(1 / (1 / pa - 1 / pb));
      const aTransfer = (a.orbit.a + b.orbit.a) / 2;
      const transferYears = Math.sqrt(aTransfer ** 3) / 2;
      return report(`${a.name} → ${b.name} transfer opportunities`, [
        `${a.name} year: ${fmt(pa, 3)} Earth years. ${b.name} year: ${fmt(pb, 3)} Earth years.`,
        `Synodic period — how often the geometry repeats: ${fmt(synodic, 3)} years (${fmt(synodic * 365.25, 0)} days).`,
        `Minimum-energy Hohmann transfer time: ${fmt(transferYears * 365.25, 0)} days (${fmt(transferYears, 3)} years).`,
        `Transfer semi-major axis: ${fmt(aTransfer, 4)} AU.`,
        `A launch window opens roughly every ${fmt(synodic * 12, 1)} months. Miss it and you wait that long again.`,
      ]);
    },
  },
  {
    id: "skill-link-budget",
    name: "Deep Space Link Engineer",
    domain: "communications",
    blurb: "Signal travel time and free-space path loss for any distance.",
    keys: ["signal", "light", "delay", "latency", "communication", "link", "antenna", "radio", "path loss", "ping"],
    run(q) {
      const km = num(q, [/([\d,.]+)\s*km/i]) ?? (num(q, [/([\d,.]+)\s*au/i]) ?? 1) * AU_KM;
      const ghz = num(q, [/([\d,.]+)\s*ghz/i]) ?? 8.4;
      const seconds = km / 299792.458;
      const fspl = 20 * Math.log10(km * 1000) + 20 * Math.log10(ghz * 1e9) - 147.55;
      return report(`Link across ${fmt(km, 0)} km at ${fmt(ghz, 2)} GHz`, [
        `One-way light time: ${seconds < 90 ? `${fmt(seconds, 2)} seconds` : `${fmt(seconds / 60, 2)} minutes`}`,
        `Round-trip command latency: ${seconds < 90 ? `${fmt(seconds * 2, 2)} s` : `${fmt((seconds * 2) / 60, 2)} min`}`,
        `Free-space path loss: ${fmt(fspl, 1)} dB`,
        `Distance in astronomical units: ${fmt(km / AU_KM, 4)} AU`,
        seconds > 600
          ? "At this range no joystick works. The spacecraft must decide for itself — that is why autonomy exists."
          : "Close enough that ground control can still argue with the spacecraft in near real time.",
      ]);
    },
  },
  {
    id: "skill-satellite-tracker",
    name: "Live Satellite Tracker",
    domain: "tracking",
    blurb: "Where any tracked satellite is right now, from live NORAD elements.",
    keys: ["where is", "track", "satellite", "iss", "right now", "position", "overhead", "hubble", "station", "locate", "live"],
    async run(q) {
      const lower = q.toLowerCase();
      const group = /hubble|hst|telescope|science/.test(lower)
        ? "science"
        : /weather|noaa|goes|storm/.test(lower)
        ? "weather"
        : /gps|navigation|galileo/.test(lower)
        ? "gps-ops"
        : /starlink/.test(lower)
        ? "starlink"
        : "stations";
      const res = await live.tleGroup(group, 120);
      if (!res.ok) return report("Live tracker", ["No element sets are reachable and no snapshot is cached."]);

      const cleaned = lower.replace(/where\s+is|right now|the|show|me|track|locate|find/g, " ").trim();
      const target =
        res.data.find((t) => cleaned && t.name.toLowerCase().includes(cleaned.split(/\s+/).filter((w) => w.length > 2)[0] || "@@")) ||
        res.data.find((t) => /ISS|ZARYA/i.test(t.name)) ||
        res.data[0];

      const rec = parseSatellite(target.line1, target.line2);
      const p = propagateSatellite(rec, new Date());
      if (!p) return report(target.name, ["SGP4 could not converge — this object may have decayed."]);
      const regime = orbitRegime(p.altKm);
      const track = groundTrack(rec, { minutes: 90, step: 300 });
      return report(`${target.name} — position right now`, [
        `Sub-satellite point: ${fmt(p.lat, 3)}° ${p.lat >= 0 ? "N" : "S"}, ${fmt(Math.abs(p.lon), 3)}° ${p.lon >= 0 ? "E" : "W"}`,
        `Altitude: ${fmt(p.altKm, 1)} km — ${regime.label}`,
        `Ground speed: ${fmt(p.speedKms, 3)} km/s (${fmt(p.speedKmh, 0)} km/h)`,
        `Orbital period: ${fmt((2 * Math.PI) / rec.no, 1)} minutes; inclination ${fmt((rec.inclo * 180) / Math.PI, 3)}°`,
        `NORAD catalogue number ${target.noradId}. Elements: ${res.source}.`,
        `Next 90 minutes of ground track computed: ${track.length} points, reaching ${fmt(Math.max(...track.map((t) => t.lat)), 1)}°N at the northern extreme.`,
      ], { source: res.source });
    },
  },
  {
    id: "skill-pass-predictor",
    name: "Visible Pass Predictor",
    domain: "tracking",
    blurb: "When a satellite will rise above the horizon for your coordinates.",
    keys: ["pass", "visible", "see", "when will", "over my", "horizon", "sighting", "look up", "tonight"],
    async run(q, ctx) {
      const lat = num(q, [/lat\D+(-?[\d.]+)/i]) ?? ctx?.observer?.lat ?? 51.5;
      const lon = num(q, [/lon\D+(-?[\d.]+)/i]) ?? ctx?.observer?.lon ?? -0.13;
      const res = await live.tleGroup("stations", 20);
      if (!res.ok) return report("Pass predictor", ["No element sets available."]);
      const target = res.data.find((t) => /ISS|ZARYA/i.test(t.name)) || res.data[0];
      const rec = parseSatellite(target.line1, target.line2);
      const passes = nextPasses(rec, { lat, lon }, { hours: 24, minElevation: 10 });
      const lines = [
        `Observer: ${fmt(lat, 3)}°, ${fmt(lon, 3)}°. Target: ${target.name}.`,
        `${passes.length} pass(es) above 10° elevation in the next 24 hours.`,
      ];
      for (const p of passes.slice(0, 5)) {
        lines.push(
          `${p.start.toUTCString().slice(5, 22)} UTC — peak ${fmt(p.peak, 0)}° elevation, lasting about ${p.durationMin ?? "?"} minutes.`
        );
      }
      if (!passes.length) lines.push("Nothing clears the horizon from there today. Try a different latitude or wait a day.");
      return report(`Passes over ${fmt(lat, 2)}°, ${fmt(lon, 2)}°`, lines, { source: res.source });
    },
  },
  {
    id: "skill-planet-position",
    name: "Ephemeris Computer",
    domain: "astrodynamics",
    blurb: "Where any planet is today, and how far away it is from Earth.",
    keys: ["where is", "planet", "distance", "position", "mars", "jupiter", "venus", "saturn", "today", "ephemeris", "far"],
    run(q) {
      const lower = q.toLowerCase();
      const planet = PLANETS.find((p) => lower.includes(p.id)) || PLANETS.find((p) => p.id === "mars");
      const earth = PLANETS.find((p) => p.id === "earth");
      const now = new Date();
      const h = heliocentric(planet.orbit, now);
      const view = fromEarth(planet.orbit, earth.orbit, now);
      const g = bodyGravity({ radiusKm: planet.radiusKm, massEarths: (planet.radiusKm / EARTH_RADIUS_KM) ** 3 * 0.9 });
      return report(`${planet.emoji} ${planet.name} — computed for ${now.toUTCString().slice(5, 16)}`, [
        `Distance from the Sun: ${fmt(h.r, 4)} AU (${fmt(h.r * AU_KM, 0)} km)`,
        `Distance from Earth: ${fmt(view.au, 4)} AU (${fmt(view.km, 0)} km)`,
        `Light travel time from Earth: ${fmt(view.lightMinutes, 2)} minutes`,
        `Heliocentric ecliptic coordinates: x ${fmt(h.x, 4)}, y ${fmt(h.y, 4)}, z ${fmt(h.z, 4)} AU`,
        `Orbital period ${fmt(planet.orbit.period, 3)} years; day length ${fmt(Math.abs(planet.rotation), 3)} Earth days${planet.rotation < 0 ? " (retrograde)" : ""}`,
        `Solved from J2000 elements with Newton–Raphson on Kepler's equation — the same code that drives the 3D scene.`,
      ]);
    },
  },
  {
    id: "skill-debris-risk",
    name: "Orbital Congestion Analyst",
    domain: "space safety",
    blurb: "How crowded a shell of orbit is, from live catalogue counts.",
    keys: ["debris", "congestion", "collision", "crowded", "kessler", "traffic", "conjunction", "how many satellites"],
    async run() {
      const res = await live.tleGroup("active", 400);
      if (!res.ok) return report("Congestion analyst", ["The active catalogue is unreachable."]);
      const now = new Date();
      const buckets = { leo: 0, meo: 0, geo: 0, heo: 0, decaying: 0 };
      let sampled = 0;
      for (const t of res.data) {
        try {
          const p = propagateSatellite(parseSatellite(t.line1, t.line2), now);
          if (!p) continue;
          buckets[orbitRegime(p.altKm).id]++;
          sampled++;
        } catch { /* rejected elements are simply not counted */ }
      }
      return report(`Orbital shell census — ${sampled} objects propagated live`, [
        `Low Earth Orbit: ${buckets.leo} objects in this sample.`,
        `Medium Earth Orbit: ${buckets.meo}.`,
        `Geostationary belt: ${buckets.geo}.`,
        `High or highly elliptical: ${buckets.heo}.`,
        `Decaying / sub-orbital: ${buckets.decaying}.`,
        `Sample drawn from CelesTrak's active list (${res.source}). The full catalogue tracks well over 30,000 objects larger than 10 cm.`,
        `Kessler syndrome is the scenario where collisions in the crowded 700–900 km shell generate debris faster than it decays.`,
      ], { source: res.source });
    },
  },
  {
    id: "skill-code-writer",
    name: "Flight Software Author",
    domain: "engineering",
    blurb: "Writes runnable Python or JavaScript for the task you describe.",
    keys: ["code", "python", "javascript", "script", "program", "write me", "function", "api", "sgp4", "how do i compute", "snippet"],
    run(q) {
      const lower = q.toLowerCase();
      const python = !lower.includes("javascript") && !lower.includes("js ");
      let snippet;
      let what;
      if (/tle|sgp4|satellite|track|iss|orbit position/.test(lower)) {
        what = "propagate a live satellite from CelesTrak elements";
        snippet = python
          ? `# pip install sgp4 requests
import requests
from datetime import datetime, timezone
from sgp4.api import Satrec, jday

GROUP = "stations"
raw = requests.get(
    f"https://celestrak.org/NORAD/elements/gp.php?GROUP={GROUP}&FORMAT=tle",
    timeout=20,
).text.splitlines()

name, l1, l2 = raw[0].strip(), raw[1], raw[2]
sat = Satrec.twoline2rv(l1, l2)

now = datetime.now(timezone.utc)
jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second)
err, position_km, velocity_kms = sat.sgp4(jd, fr)

if err:
    raise RuntimeError(f"SGP4 error code {err}")

speed = sum(v * v for v in velocity_kms) ** 0.5
print(f"{name}: TEME position {position_km} km, speed {speed:.3f} km/s")`
          : `// npm i satellite.js
import * as satellite from "satellite.js";

const text = await (await fetch(
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"
)).text();
const [name, line1, line2] = text.split(/\\r?\\n/);

const rec = satellite.twoline2satrec(line1, line2);
const now = new Date();
const { position } = satellite.propagate(rec, now);
const geo = satellite.eciToGeodetic(position, satellite.gstime(now));

console.log(name.trim(), {
  lat: satellite.degreesLat(geo.latitude),
  lon: satellite.degreesLong(geo.longitude),
  altKm: geo.height,
});`;
      } else if (/nasa|apod|neo|asteroid|api/.test(lower)) {
        what = "pull real data from NASA's free open API";
        snippet = python
          ? `# NASA's DEMO_KEY works with no signup (30 requests/hour).
# A free personal key from https://api.nasa.gov lifts it to 1,000/hour.
import requests

KEY = "DEMO_KEY"

apod = requests.get(
    "https://api.nasa.gov/planetary/apod",
    params={"api_key": KEY}, timeout=15,
).json()
print(apod["title"], "-", apod["url"])

neo = requests.get(
    "https://api.nasa.gov/neo/rest/v1/feed",
    params={"api_key": KEY}, timeout=15,
).json()

for day, rocks in neo["near_earth_objects"].items():
    for r in rocks:
        approach = r["close_approach_data"][0]
        print(day, r["name"],
              round(float(approach["miss_distance"]["lunar"]), 1), "lunar distances")`
          : `const KEY = "DEMO_KEY";
const apod = await (await fetch(
  \`https://api.nasa.gov/planetary/apod?api_key=\${KEY}\`
)).json();
console.log(apod.title, apod.url);`;
      } else if (/delta|fuel|propellant|rocket equation/.test(lower)) {
        what = "size a propellant load with the rocket equation";
        snippet = python
          ? `G0 = 9.80665  # m/s^2

def propellant_for(dry_mass_kg: float, delta_v_ms: float, isp_s: float) -> float:
    """Tsiolkovsky, 1903. Returns the propellant mass in kilograms."""
    from math import exp
    return dry_mass_kg * (exp(delta_v_ms / (isp_s * G0)) - 1)

for isp in (250, 320, 450):
    kg = propellant_for(dry_mass_kg=1200, delta_v_ms=1800, isp_s=isp)
    print(f"Isp {isp:>3} s -> {kg:8.1f} kg of propellant")`
          : `const G0 = 9.80665;
const propellantFor = (dryKg, dvMs, isp) => dryKg * (Math.exp(dvMs / (isp * G0)) - 1);
console.log(propellantFor(1200, 1800, 320).toFixed(1), "kg");`;
      } else {
        what = "compute circular orbit speed and period at any altitude";
        snippet = python
          ? `from math import pi, sqrt

MU_EARTH = 398600.4418   # km^3/s^2
R_EARTH  = 6371.0088     # km

def circular_orbit(alt_km: float) -> dict:
    r = R_EARTH + alt_km
    v = sqrt(MU_EARTH / r)
    return {
        "speed_kms": v,
        "period_min": 2 * pi * sqrt(r ** 3 / MU_EARTH) / 60,
        "escape_kms": sqrt(2 * MU_EARTH / r),
    }

for alt in (400, 550, 20200, 35786):
    o = circular_orbit(alt)
    print(f"{alt:>6} km  {o['speed_kms']:.3f} km/s  {o['period_min']:.1f} min")`
          : `const MU = 398600.4418, RE = 6371.0088;
const circular = (alt) => {
  const r = RE + alt;
  return { v: Math.sqrt(MU / r), T: 2 * Math.PI * Math.sqrt(r ** 3 / MU) / 60 };
};
console.log(circular(400));`;
      }
      return report(`${python ? "Python" : "JavaScript"} — ${what}`, [
        "This runs as written. No credentials beyond NASA's public DEMO_KEY are required.",
      ], { code: snippet, language: python ? "python" : "javascript" });
    },
  },
  {
    id: "skill-mission-architect",
    name: "Mission Architect",
    domain: "mission design",
    blurb: "Turns a mission goal into an outline architecture with real numbers.",
    keys: ["design", "mission", "build", "plan", "architecture", "constellation", "cubesat", "how would i", "propose", "spacecraft"],
    run(q) {
      const lower = q.toLowerCase();
      const massKg = num(q, [/([\d,.]+)\s*kg/i]) ?? 150;
      const altKm = num(q, [/([\d,.]+)\s*km/i]) ?? 550;
      const o = circularOrbit(altKm);
      const sunSync = altKm < 1200;
      const providers = COMPANIES.filter((c) => c.sector === "launch").slice(0, 5).map((c) => c.name);
      const lifetimeYears = altKm < 400 ? 1 : altKm < 600 ? 5 : altKm < 800 ? 25 : 100;
      return report(`Outline architecture — ${fmt(massKg, 0)} kg spacecraft at ${fmt(altKm, 0)} km`, [
        `Orbit: ${orbitRegime(altKm).label}${sunSync ? ", sun-synchronous is achievable at 97–99° inclination" : ""}.`,
        `Period ${fmt(o.periodMinutes, 1)} min → ${fmt(1440 / o.periodMinutes, 1)} revolutions per day, so ${fmt(1440 / o.periodMinutes, 0)} ground-station contact opportunities daily.`,
        `Injection Δv from a 200 km parking orbit: ${fmt(hohmann(200, altKm).totalKms * 1000, 0)} m/s.`,
        `Station-keeping budget: allow 15–40 m/s per year against drag at this altitude.`,
        `Natural orbital lifetime without propulsion: roughly ${lifetimeYears} year(s). Post-mission disposal rules require re-entry within 25 years (5 in newer FCC rules).`,
        `Power: at ${fmt(massKg, 0)} kg, budget ${fmt(massKg * 1.2, 0)}–${fmt(massKg * 2.5, 0)} W of array output with 30% eclipse margin.`,
        `Candidate launch providers today: ${providers.join(", ")}.`,
        lower.includes("constellation")
          ? `For global revisit, a Walker constellation of 3 planes × 8 satellites at this altitude gives a mean revisit around ${fmt((o.periodMinutes / 24) * 1.6, 0)} minutes.`
          : `A single spacecraft here revisits the same ground point roughly every ${fmt(o.periodMinutes * 15, 0)} minutes at best.`,
      ]);
    },
  },
  {
    id: "skill-scale",
    name: "Cosmic Scale Translator",
    domain: "education",
    blurb: "Converts astronomical distances into something a human can feel.",
    keys: ["how far", "light year", "distance", "scale", "big", "compare", "size", "au", "parsec"],
    run(q) {
      const ly = num(q, [/([\d,.]+)\s*light.?year/i]);
      const au = num(q, [/([\d,.]+)\s*au/i]);
      const km = ly ? ly * 9.4607e12 : au ? au * AU_KM : num(q, [/([\d,.]+)\s*km/i]) ?? AU_KM;
      const voyagerKmPerYear = 3.58 * AU_KM;
      return report(`Scale of ${fmt(km, 0)} km`, [
        `In astronomical units: ${fmt(km / AU_KM, 4)} AU.`,
        `In light travel time: ${km / 299792.458 < 3600 ? `${fmt(km / 299792.458 / 60, 2)} minutes` : `${fmt(km / 299792.458 / 86400, 3)} days`}.`,
        `In light years: ${fmt(km / 9.4607e12, 6)}.`,
        `Voyager 1, at 17 km/s, would need ${fmt(km / voyagerKmPerYear, 1)} years to cross it.`,
        `A commercial airliner at 900 km/h would need ${fmt(km / 900 / 24 / 365.25, 1)} years without stopping.`,
        `Laid end to end that is ${fmt(km / 40075, 0)} trips around Earth's equator.`,
      ]);
    },
  },
  {
    id: "skill-gravity",
    name: "Surface Conditions Analyst",
    domain: "planetary science",
    blurb: "Gravity, weight and escape velocity on any world in the codex.",
    keys: ["gravity", "weigh", "weight", "jump", "surface", "escape velocity", "heavy", "stand on"],
    run(q) {
      const lower = q.toLowerCase();
      const relative = {
        mercury: 0.378, venus: 0.905, earth: 1, mars: 0.379, jupiter: 2.528,
        saturn: 1.065, uranus: 0.886, neptune: 1.14, moon: 0.166, pluto: 0.063,
        ceres: 0.029, europa: 0.134, titan: 0.138, io: 0.183, ganymede: 0.146,
      };
      const key = Object.keys(relative).find((k) => lower.includes(k)) || "mars";
      const g = relative[key];
      const mass = num(q, [/([\d,.]+)\s*kg/i]) ?? 70;
      const body = byId(key);
      return report(`Standing on ${body?.name || key}`, [
        `Surface gravity: ${fmt(g * 9.80665, 3)} m/s² — ${fmt(g * 100, 1)}% of Earth's.`,
        `A ${fmt(mass, 0)} kg person would weigh the equivalent of ${fmt(mass * g, 1)} kg there.`,
        `A jump that clears 0.5 m on Earth clears ${fmt(0.5 / g, 2)} m there.`,
        `A dropped object falls the first metre in ${fmt(Math.sqrt(2 / (g * 9.80665)), 2)} seconds.`,
        body?.facts?.[0] || "",
      ].filter(Boolean));
    },
  },
  {
    id: "skill-timeline",
    name: "Space History Archivist",
    domain: "history",
    blurb: "Assembles a chronological timeline from every dated codex record.",
    keys: ["timeline", "history", "when did", "first", "chronology", "past", "milestone", "year"],
    run(q) {
      const lower = q.toLowerCase();
      const dated = CODEX.filter((e) => e.when && /\d{3,4}/.test(e.when))
        .map((e) => ({ e, year: parseInt(e.when.match(/(\d{3,4})/)[1], 10) }))
        .filter((r) => (lower.match(/\b(1[5-9]\d\d|20\d\d)\b/) ? String(r.year).startsWith(lower.match(/\b(1[5-9]\d\d|20\d\d)\b/)[1].slice(0, 2)) : true))
        .sort((a, b) => a.year - b.year);
      const picks = dated.filter((_, i) => i % Math.max(1, Math.floor(dated.length / 14)) === 0).slice(0, 14);
      return report(`Timeline drawn from ${dated.length} dated records`, picks.map((r) => `${r.year} — ${r.e.emoji} ${r.e.name}: ${r.e.when}`));
    },
  },
  {
    id: "skill-career",
    name: "Space Careers Advisor",
    domain: "education",
    blurb: "Which real organisations hire for which skill, and what to learn.",
    keys: ["job", "career", "work", "hire", "study", "learn", "become", "engineer", "internship", "university"],
    run(q) {
      const lower = q.toLowerCase();
      const sector = SECTORS.find((s) => lower.includes(s)) || (/rocket|launch/.test(lower) ? "launch" : /image|imaging|earth/.test(lower) ? "earth observation" : "satellites");
      const firms = companiesBySector(sector);
      const countries = [...new Set(firms.map((f) => f.country))];
      return report(`Working in "${sector}"`, [
        `${firms.length} organisations in the codex work in this sector, across ${countries.length} countries.`,
        `Examples: ${firms.slice(0, 8).map((f) => `${f.name} (${f.country})`).join(", ")}.`,
        `Core skills: orbital mechanics, systems engineering, embedded C/C++ or Rust, Python for analysis, thermal and structural modelling, and radiation-tolerant design.`,
        `Free ways in: CelesTrak and NASA open data (used by this very page), university CubeSat programmes, ESA and NASA open-source flight software, and amateur radio satellite operations.`,
        `MR PENGUIN's advice: build one small thing that actually flies data end to end. That single project outweighs a stack of certificates.`,
      ]);
    },
  },
  {
    id: "skill-launch-site",
    name: "Launch Site Selector",
    domain: "mission design",
    blurb: "Picks the best real spaceport on Earth for a target orbit.",
    keys: ["launch site", "spaceport", "where to launch", "pad", "cosmodrome", "launch from", "inclination", "equator"],
    run(q) {
      const inc = num(q, [/([\d.]+)\s*(?:°|deg)/i, /inclination\D+([\d.]+)/i]);
      const wantsGeo = /geo|geostationary|equator/i.test(q);
      const wantsPolar = /polar|sun.?sync|sso/i.test(q);
      const target = wantsGeo ? 0 : wantsPolar ? 97 : inc ?? 51.6;
      const ranked = SPACEPORTS
        .map((s) => ({ s, penalty: Math.max(0, s.minInclination - target), boost: s.rotationBoostMs }))
        .sort((a, b) => a.penalty - b.penalty || b.boost - a.boost)
        .slice(0, 5);
      return report(`Launch sites for a ${fmt(target, 1)}° orbit`, [
        wantsPolar
          ? "Polar and sun-synchronous orbits can be reached from almost any latitude, so the ranking below favours clear range safety corridors and rotation boost."
          : `A pad cannot reach an inclination lower than its own latitude without an expensive dogleg, so anything above ${fmt(target, 1)}° N/S is penalised.`,
        ...ranked.map(
          ({ s, penalty }) =>
            `${s.name} (${s.country}) — latitude ${fmt(s.lat, 2)}°, free boost ${fmt(s.rotationBoostMs, 0)} m/s${penalty > 0 ? `, ${fmt(penalty, 1)}° of plane change needed` : ", no plane change needed"}. ${s.flies}`
        ),
        `Earth's rotation gives an equatorial pad ${fmt(rotationBoost(0), 0)} m/s for free — roughly 5% of the ~9,400 m/s a launcher must supply.`,
      ]);
    },
  },
  {
    id: "skill-sun-synchronous",
    name: "Sun-Synchronous Designer",
    domain: "astrodynamics",
    blurb: "The exact inclination that makes an orbit precess with the seasons.",
    keys: ["sun synchronous", "sso", "precession", "j2", "inclination", "local time", "imaging orbit", "polar orbit"],
    run(q) {
      const alt = num(q, [/([\d,.]+)\s*km/i]) ?? 700;
      const a = EARTH_RADIUS_KM + alt;
      const J2 = 1.08263e-3;
      const Re = EARTH_RADIUS_KM;
      const n = Math.sqrt(MU_EARTH / a ** 3); // rad/s
      const targetPrecession = (2 * Math.PI) / (365.2422 * 86400); // rad/s
      const cosI = (-2 * targetPrecession * a ** 2) / (3 * J2 * Re ** 2 * n);
      const inc = (Math.acos(Math.max(-1, Math.min(1, cosI))) * 180) / Math.PI;
      const o = circularOrbit(alt);
      return report(`Sun-synchronous orbit at ${fmt(alt, 0)} km`, [
        `Required inclination: ${fmt(inc, 3)}° — retrograde, which is why imaging rockets fly slightly west of south.`,
        `Earth's equatorial bulge (the J2 term) drags the orbit plane round by exactly 0.9856° per day, matching the Sun.`,
        `Orbital period ${fmt(o.periodMinutes, 2)} min, ${fmt(1440 / o.periodMinutes, 2)} revolutions per day.`,
        `Every pass crosses a given latitude at the same local solar time, so shadows match between images taken months apart.`,
        `That consistency is why Landsat, Sentinel and almost every commercial imaging constellation live in this orbit.`,
      ]);
    },
  },
  {
    id: "skill-power-budget",
    name: "Spacecraft Power Engineer",
    domain: "engineering",
    blurb: "Solar array sizing, eclipse fraction and battery depth of discharge.",
    keys: ["power", "solar", "battery", "watts", "array", "eclipse", "energy", "electrical"],
    run(q) {
      const alt = num(q, [/([\d,.]+)\s*km/i]) ?? 550;
      const load = num(q, [/([\d,.]+)\s*w\b/i, /([\d,.]+)\s*watt/i]) ?? 200;
      const o = circularOrbit(alt);
      const r = EARTH_RADIUS_KM + alt;
      const eclipseFraction = Math.asin(EARTH_RADIUS_KM / r) / Math.PI;
      const eclipseMin = o.periodMinutes * eclipseFraction;
      const sunMin = o.periodMinutes - eclipseMin;
      const arrayW = (load * o.periodMinutes) / (sunMin * 0.85);
      const batteryWh = (load * eclipseMin) / 60 / 0.8;
      return report(`Power budget — ${fmt(load, 0)} W load at ${fmt(alt, 0)} km`, [
        `Orbit period ${fmt(o.periodMinutes, 1)} min: ${fmt(sunMin, 1)} min in sunlight, ${fmt(eclipseMin, 1)} min in eclipse (worst case).`,
        `Array output required: ${fmt(arrayW, 0)} W end-of-life, allowing 15% for charging losses.`,
        `That is roughly ${fmt(arrayW / 300, 2)} m² of triple-junction cells at ~300 W/m².`,
        `Battery capacity: ${fmt(batteryWh, 1)} Wh at 80% usable depth of discharge — about ${fmt(batteryWh / 3.6 / 3.7, 0)} lithium-ion cells.`,
        `Cycles over five years: ${fmt((1440 / o.periodMinutes) * 365 * 5, 0)} charge/discharge cycles. That number, not capacity, is what kills the battery.`,
      ]);
    },
  },
  {
    id: "skill-reentry",
    name: "Re-entry & Disposal Analyst",
    domain: "space safety",
    blurb: "Decay lifetime, disposal rules and re-entry heating.",
    keys: ["reentry", "re-entry", "decay", "deorbit", "disposal", "burn up", "lifetime", "graveyard", "atmosphere"],
    run(q) {
      const alt = num(q, [/([\d,.]+)\s*km/i]) ?? 500;
      const lifetime = alt < 200 ? "days" : alt < 400 ? "months to about a year" : alt < 600 ? "a few years to a decade" : alt < 800 ? "decades" : alt < 1000 ? "over a century" : "effectively permanent on human timescales";
      const o = circularOrbit(alt);
      const dv = hohmann(alt, 100).totalKms * 1000;
      return report(`Disposal from ${fmt(alt, 0)} km`, [
        `Natural orbital lifetime from atmospheric drag: ${lifetime}.`,
        `Controlled de-orbit Δv (lowering perigee to 100 km): about ${fmt(dv, 0)} m/s.`,
        `Entry interface speed from this orbit: roughly ${fmt(o.speedKms, 2)} km/s — the heat shield must dissipate ${fmt((0.5 * o.speedKms ** 2 * 1000) / 1000, 0)} kJ per kilogram of spacecraft.`,
        `Regulation: the long-standing rule is re-entry within 25 years of mission end; the US FCC tightened it to 5 years for new LEO satellites.`,
        alt > 30000
          ? "Above the geostationary belt the accepted practice is the opposite: boost roughly 300 km higher into a graveyard orbit rather than come down."
          : "Below GEO the expectation is to come down, not to park.",
        `Most of a small satellite ablates away; dense parts such as reaction wheels and tanks are what survive to the ground.`,
      ]);
    },
  },
  {
    id: "skill-thermal",
    name: "Thermal Control Engineer",
    domain: "engineering",
    blurb: "Equilibrium temperature of a body at any distance from the Sun.",
    keys: ["temperature", "thermal", "hot", "cold", "heat", "radiator", "insulation", "kelvin", "celsius"],
    run(q) {
      const au = num(q, [/([\d.]+)\s*au/i]) ?? (() => {
        const p = PLANETS.find((pl) => q.toLowerCase().includes(pl.id));
        return p ? p.orbit.a : 1;
      })();
      const solarConstant = 1361 / (au * au);
      const albedo = num(q, [/albedo\D+([\d.]+)/i]) ?? 0.3;
      const tK = (((solarConstant * (1 - albedo)) / (4 * 5.670374419e-8)) ** 0.25);
      return report(`Thermal environment at ${fmt(au, 3)} AU`, [
        `Solar flux: ${fmt(solarConstant, 1)} W/m² (Earth receives 1,361 W/m²).`,
        `Equilibrium temperature for a grey body with albedo ${fmt(albedo, 2)}: ${fmt(tK, 1)} K = ${fmt(tK - 273.15, 1)} °C.`,
        `A one-square-metre radiator at 300 K rejects ${fmt(5.670374419e-8 * 300 ** 4, 0)} W to deep space.`,
        `In vacuum there is no convection: every watt leaves by radiation or it stays and cooks the electronics.`,
        au < 0.5
          ? "This close to the Sun a shield is mandatory. Parker Solar Probe's carbon shield front face reaches about 1,400 °C while the instruments stay at room temperature."
          : au > 5
          ? "Out here sunlight is too weak for solar panels to be practical, which is why the outer-planet missions carry radioisotope generators."
          : "Multi-layer insulation plus louvres and heat pipes is the standard solution at this distance.",
      ]);
    },
  },
  {
    id: "skill-imagery",
    name: "Remote Sensing Analyst",
    domain: "earth observation",
    blurb: "Ground resolution, swath and revisit from orbit and optics.",
    keys: ["resolution", "imaging", "camera", "swath", "revisit", "pixel", "observation", "sar", "spectral", "monitor"],
    run(q) {
      const alt = num(q, [/([\d,.]+)\s*km/i]) ?? 500;
      const aperture = num(q, [/([\d.]+)\s*m\b.*(?:aperture|mirror|lens)/i, /aperture\D+([\d.]+)/i]) ?? 0.35;
      const wavelength = 550e-9;
      const diffractionRad = (1.22 * wavelength) / aperture;
      const gsd = diffractionRad * alt * 1000;
      const o = circularOrbit(alt);
      return report(`Imaging from ${fmt(alt, 0)} km with a ${fmt(aperture, 2)} m aperture`, [
        `Diffraction limit: ${fmt(gsd, 2)} m ground sample distance at 550 nm — the best physics allows, before atmosphere and jitter.`,
        `Doubling the mirror halves the pixel. That single relation is why sharp imaging satellites are expensive.`,
        `Ground track speed: ${fmt(o.speedKms * (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + alt)), 2)} km/s, so a 4,000-pixel line array needs an integration time under ${fmt((gsd / (o.speedKms * 1000)) * 1e6, 0)} µs per line.`,
        `Revisit: ${fmt(1440 / o.periodMinutes, 1)} orbits per day; a single satellite sees a given point every few days, a constellation of 20 sees it several times daily.`,
        `Radar (SAR) sidesteps cloud and darkness entirely — that is why ICEYE, Capella and Umbra exist.`,
      ]);
    },
  },
  {
    id: "skill-habitability",
    name: "Habitability Assessor",
    domain: "astrobiology",
    blurb: "Whether a world could hold liquid water, and what would kill you first.",
    keys: ["life", "habitable", "alien", "water", "colonise", "colonize", "live on", "survive", "atmosphere", "biosignature"],
    run(q) {
      const lower = q.toLowerCase();
      const profiles = {
        mars: ["Surface pressure 0.6% of Earth's — your blood would boil at body temperature without a suit.", "Water exists as polar ice and subsurface brine; ancient rivers are visible from orbit.", "No magnetic field, so surface radiation is roughly 50 times Earth's. Shelter must be buried.", "Perchlorates in the soil are toxic and must be washed out before anything grows.", "Verdict: the most reachable target, and still brutally hostile."],
        venus: ["465 °C surface and 92 bar of pressure — Venera landers lasted about two hours.", "Sulphuric acid clouds; the surface is hidden under permanent overcast.", "At 50 km altitude the pressure and temperature are close to Earth's, which is why floating habitats keep being proposed.", "Verdict: uninhabitable at the surface, oddly plausible in the clouds."],
        europa: ["A salty liquid ocean under 15–25 km of ice, holding twice all of Earth's water.", "Tidal flexing from Jupiter supplies the heat that keeps it liquid.", "Jupiter's radiation belts would deliver a lethal dose at the surface in about a day.", "Verdict: one of the best places in the Solar System to look for life, and among the worst to stand on."],
        titan: ["A thick nitrogen atmosphere at 1.5 bar — no pressure suit needed, just warmth and oxygen.", "Rivers, lakes and rain, all of liquid methane, at −179 °C.", "Low gravity and dense air mean a human with strapped-on wings really could fly.", "Verdict: the most Earth-like landscape known, made entirely of the wrong chemicals."],
        enceladus: ["Geysers of salty water erupt from the south pole; Cassini flew through them and found organics and hydrogen.", "Hydrogen in the plume implies hydrothermal vents on the ocean floor — an energy source life could use.", "Verdict: a sample of an alien ocean, thrown into space for free."],
        moon: ["No atmosphere, 14-day nights, and abrasive dust that damages seals and lungs.", "Water ice sits in permanently shadowed south polar craters — the reason Artemis is going there.", "Verdict: not habitable, but close enough to practise on."],
      };
      const key = Object.keys(profiles).find((k) => lower.includes(k)) || "mars";
      const body = byId(key);
      return report(`Habitability — ${body?.name || key}`, profiles[key]);
    },
  },
  {
    id: "skill-quantum",
    name: "Quantum Communications Engineer",
    domain: "quantum",
    blurb: "Key rates, loss budgets and why orbit beats fibre for QKD.",
    keys: ["quantum", "qkd", "entangle", "micius", "photon", "encryption", "key distribution", "secure", "cryptography"],
    run(q) {
      const km = num(q, [/([\d,.]+)\s*km/i]) ?? 1200;
      const fibreLossDb = km * 0.2;
      const fibreTransmission = 10 ** (-fibreLossDb / 10);
      const spaceLossDb = 20 * Math.log10(km) + 12;
      return report(`Quantum key distribution over ${fmt(km, 0)} km`, [
        `Through optical fibre: ${fmt(fibreLossDb, 1)} dB of loss, a transmission of ${fibreTransmission.toExponential(2)}. One photon in ${fmt(1 / fibreTransmission, 0)} arrives.`,
        `Through space with a satellite link: roughly ${fmt(spaceLossDb, 1)} dB, because most of the path is vacuum and only the last ~20 km is atmosphere.`,
        `That gap is the entire argument for quantum satellites. Fibre loss is exponential with distance; free-space loss is only quadratic.`,
        `Micius (China, 2016) distributed entangled photon pairs over 1,200 km and secured a Beijing-to-Vienna video call.`,
        `Security does not come from a hard maths problem. Measuring a photon disturbs it, so an eavesdropper announces themselves in the error rate.`,
        `The remaining obstacles: daylight background noise, pointing accuracy of microradians, and quantum repeaters that nobody has built at scale yet.`,
      ]);
    },
  },
  {
    id: "skill-observing",
    name: "Night Sky Guide",
    domain: "education",
    blurb: "What is worth looking at tonight, and with what.",
    keys: ["tonight", "see", "naked eye", "binoculars", "stargazing", "observe", "sky", "constellation", "telescope buy"],
    run() {
      const earth = PLANETS.find((p) => p.id === "earth");
      const now = new Date();
      const visible = PLANETS.filter((p) => p.id !== "earth")
        .map((p) => ({ p, v: fromEarth(p.orbit, earth.orbit, now) }))
        .sort((a, b) => a.v.au - b.v.au);
      return report(`Tonight's sky — computed for ${now.toDateString()}`, [
        ...visible.slice(0, 4).map(({ p, v }) => `${p.emoji} ${p.name}: ${fmt(v.au, 3)} AU away, light delay ${fmt(v.lightMinutes, 1)} minutes.`),
        `Naked eye: Mercury, Venus, Mars, Jupiter and Saturn are all visible without equipment when they are above the horizon after dark. Andromeda, 2.5 million light-years away, is the furthest thing your unaided eye can reach.`,
        `Binoculars (10×50 is the classic choice) show the Galilean moons Galileo found in 1610, the Orion Nebula, and craters along the lunar terminator.`,
        `A small telescope adds Saturn's rings, Jupiter's cloud bands, and the phases of Venus — the observation that broke the Earth-centred universe.`,
        `The single biggest upgrade is not equipment. It is driving away from streetlights.`,
      ]);
    },
  },
  {
    id: "skill-philosophy",
    name: "MRS THORN BIRD — Reflection",
    domain: "philosophy",
    blurb: "The emotional reading of whatever the mesh just calculated.",
    keys: ["why", "meaning", "feel", "beautiful", "alone", "soul", "love", "afraid", "hope", "human", "philosophy", "sad"],
    run(q) {
      const lower = q.toLowerCase();
      const pool = /alone|lonely|empty/.test(lower)
        ? [
            "The Fermi paradox has two answers and Carl Sagan said both are terrifying. But loneliness at this scale is not absence — it is responsibility.",
            "You are the way the universe checks whether anyone is home. Every telescope is that question, made out of glass.",
          ]
        : /afraid|scared|fear|death|end/.test(lower)
        ? [
            "Every atom of calcium in your bones was made inside a star that had to die first. You are already what comes after an ending.",
            "The thorn bird sings once, on the sharpest thorn, at the end. The song is not despite the thorn. It is because of it.",
          ]
        : /love|beautiful|wonder/.test(lower)
        ? [
            "Entangled particles change together across any distance and no signal passes between them. I call that love. MR PENGUIN calls it physics. We are both right.",
            "Saturn is wearing every broken thing that ever fell towards it, and we call it jewellery. Do that with your own history.",
          ]
        : [
            "Every orbit we travel is a circle within our own soul.",
            "Ninety-five percent of the universe is invisible. So is most of a person.",
            "The universe at the largest scale is shaped like a network of neurons. Perhaps that is why thinking about it feels like coming home.",
          ];
      return report("MRS THORN BIRD answers", [pool[Math.floor(Math.random() * pool.length)], "MR PENGUIN adds the numbers. I only ever add the reason for wanting them."]);
    },
  },
];

/* ==================================================================
   2. GENERATED AGENTS — one per real record in the catalogues
   ================================================================== */

const knowledgeAgents = CODEX.map((entry) => ({
  id: `know-${entry.id}`,
  name: `${entry.name} Specialist`,
  domain: CATEGORIES[entry.cat]?.label || entry.cat,
  blurb: entry.line,
  keys: [entry.name.toLowerCase(), entry.id, entry.cat, ...(entry.who || "").toLowerCase().split(/[\s,;()]+/).filter((w) => w.length > 4)],
  entryId: entry.id,
  run() {
    return report(`${entry.emoji || "•"} ${entry.name}`, [
      entry.who ? `Discovery / origin: ${entry.who}` : null,
      entry.when ? `Date: ${entry.when}` : null,
      ...(entry.facts || []),
      entry.line ? `— ${entry.line}` : null,
    ].filter(Boolean), { codexId: entry.id });
  },
}));

const industryAgents = COMPANIES.map((c) => ({
  id: `firm-${c.id}`,
  name: `${c.name} Desk`,
  domain: `industry · ${c.sector}`,
  blurb: c.focus,
  keys: [c.name.toLowerCase(), c.id, c.sector, c.country.toLowerCase(), ...words(c.focus).filter((w) => w.length > 4)],
  run() {
    const peers = companiesBySector(c.sector).filter((p) => p.id !== c.id).slice(0, 4);
    return report(`🏭 ${c.name}`, [
      `${c.country} · founded ${c.founded} · sector: ${c.sector}`,
      c.focus,
      peers.length ? `Direct peers in the same sector: ${peers.map((p) => p.name).join(", ")}.` : "No direct peer in this sector in the codex.",
      `${companiesByCountry(c.country).length} organisation(s) from ${c.country} are catalogued in this mesh.`,
    ]);
  },
}));

const constellationAgents = live.TLE_GROUPS.map((g) => ({
  id: `const-${g.id}`,
  name: `${g.label} Constellation Operator`,
  domain: "live tracking",
  blurb: `Live NORAD elements for the ${g.label.toLowerCase()} group, propagated with SGP4.`,
  keys: [g.id, ...words(g.label), "constellation", "satellites", "live", "tle"],
  async run() {
    const res = await live.tleGroup(g.id, 200);
    if (!res.ok) return report(g.label, ["This group is unreachable and nothing is cached yet."]);
    const now = new Date();
    const alts = [];
    for (const t of res.data.slice(0, 60)) {
      try {
        const p = propagateSatellite(parseSatellite(t.line1, t.line2), now);
        if (p) alts.push(p.altKm);
      } catch { /* skip rejected elements */ }
    }
    const mean = alts.reduce((a, b) => a + b, 0) / (alts.length || 1);
    return report(`${g.emoji} ${g.label} — live`, [
      `${res.data.length} element set(s) loaded (${res.source}).`,
      alts.length ? `Mean altitude of the ${alts.length} objects sampled: ${fmt(mean, 1)} km — ${orbitRegime(mean).label}.` : "No object in this group could be propagated.",
      alts.length ? `Range: ${fmt(Math.min(...alts), 1)} km to ${fmt(Math.max(...alts), 1)} km.` : "",
      `First few: ${res.data.slice(0, 6).map((t) => t.name).join(", ")}.`,
      `Open the Orbit Lab and choose "${g.label}" to fly these in 3D.`,
    ].filter(Boolean), { source: res.source, tleGroup: g.id });
  },
}));

const feedAgents = live.SOURCES.map((s) => ({
  id: `feed-${s.id}`,
  name: `${s.name} Feed`,
  domain: "live data",
  blurb: `Public feed from ${s.host}${s.key ? " (NASA API key)" : " (no key required)"}.`,
  keys: [s.id, ...words(s.name), s.host, "live", "data", "now", "today"],
  async run() {
    const res = await s.run();
    if (!res.ok) return report(s.name, [`Unavailable: ${res.error || "no response"}.`]);
    const d = res.data;
    const lines = [`Source: ${s.host} · delivered ${res.source}.`];
    if (Array.isArray(d)) {
      lines.push(`${d.length} record(s).`);
      for (const row of d.slice(0, 6)) {
        lines.push(
          typeof row === "string"
            ? row
            : Object.entries(row).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === "number" ? fmt(v) : String(v).slice(0, 60)}`).join(" · ")
        );
      }
    } else if (d && typeof d === "object") {
      for (const [k, v] of Object.entries(d).slice(0, 8)) {
        if (typeof v === "object") continue;
        lines.push(`${k}: ${String(v).slice(0, 160)}`);
      }
    }
    return report(s.name, lines, { source: res.source, raw: d });
  },
}));

const tutorAgents = Object.values(COURSES).flatMap((course) =>
  course.levels.map((level) => ({
    id: `tutor-${course.id}-${level.n}`,
    name: `${course.name} · Level ${level.n} Tutor`,
    domain: `classroom · ${course.subject}`,
    blurb: level.title,
    keys: [...words(level.title), ...words(level.intro), course.id, `level ${level.n}`, "lesson", "teach", "explain"],
    run() {
      return report(`${level.icon} ${course.name} — Level ${level.n}: ${level.title}`, [
        level.intro,
        ...level.sections.flatMap((s) => [s.h, ...s.points.map((p) => `• ${p.replace(/<[^>]+>/g, "")}`)]),
        `“${level.whisper}”`,
      ], { courseId: course.id, levelN: level.n });
    },
  }))
);

const regionAgents = COUNTRIES.map((country) => ({
  id: `region-${country.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `${country} Space Sector Desk`,
  domain: "national programmes",
  blurb: `Everything catalogued that is built, launched or operated from ${country}.`,
  keys: [country.toLowerCase(), "country", "national", "who in", "from"],
  run() {
    const firms = companiesByCountry(country);
    const sectors = [...new Set(firms.map((f) => f.sector))];
    return report(`${country} — space sector`, [
      `${firms.length} organisation(s) catalogued, working across ${sectors.length} sector(s): ${sectors.join(", ")}.`,
      ...firms.slice(0, 10).map((f) => `${f.name} (${f.founded}) — ${f.focus}`),
      firms.length > 10 ? `…and ${firms.length - 10} more.` : "",
    ].filter(Boolean));
  },
}));

const sectorAgents = SECTORS.map((sector) => ({
  id: `sector-${sector.replace(/[^a-z0-9]+/g, "-")}`,
  name: `${sector.replace(/\b\w/g, (c) => c.toUpperCase())} Sector Analyst`,
  domain: "industry analysis",
  blurb: `Comparative view of every organisation working in ${sector}.`,
  keys: [sector, ...words(sector), "sector", "market", "who does", "compare", "industry"],
  run() {
    const firms = companiesBySector(sector);
    const byCountry = {};
    for (const f of firms) byCountry[f.country] = (byCountry[f.country] || 0) + 1;
    const oldest = firms.reduce((a, b) => (a.founded < b.founded ? a : b));
    const newest = firms.reduce((a, b) => (a.founded > b.founded ? a : b));
    return report(`Sector analysis — ${sector}`, [
      `${firms.length} organisation(s) worldwide in this codex.`,
      `Geographic spread: ${Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n})`).join(", ")}.`,
      `Longest established: ${oldest.name}, ${oldest.founded}. Newest entrant: ${newest.name}, ${newest.founded}.`,
      ...firms.slice(0, 6).map((f) => `• ${f.name} — ${f.focus}`),
    ]);
  },
}));

const spaceportAgents = SPACEPORTS.map((s) => ({
  id: `pad-${s.id}`,
  name: `${s.name} Range Control`,
  domain: "launch sites",
  blurb: `${s.operator} · ${s.flies}`,
  keys: [...words(s.name), s.country.toLowerCase(), "launch site", "spaceport", "pad", "launch from", ...words(s.operator)],
  run() {
    const boost = rotationBoost(s.lat);
    const penalty = rotationBoost(0) - boost;
    return report(`🚀 ${s.name}`, [
      `${s.country} · operated by ${s.operator}`,
      `Coordinates: ${fmt(Math.abs(s.lat), 3)}° ${s.lat >= 0 ? "N" : "S"}, ${fmt(Math.abs(s.lon), 3)}° ${s.lon >= 0 ? "E" : "W"}`,
      `Flies from here: ${s.flies}`,
      `Free eastward velocity from Earth's rotation: ${fmt(boost, 1)} m/s (${fmt(penalty, 1)} m/s less than an equatorial pad).`,
      `Lowest orbital inclination reachable without a dogleg manoeuvre: ${fmt(s.minInclination, 2)}°.`,
      s.minInclination < 10
        ? "Close enough to the equator to serve geostationary missions efficiently — this is prime real estate."
        : s.minInclination > 55
        ? "A high-latitude site: excellent for polar and sun-synchronous orbits, poor for geostationary."
        : "A mid-latitude site, well suited to inclined low Earth orbits.",
    ]);
  },
}));

const observatoryAgents = OBSERVATORIES.map((o) => ({
  id: `obs-${o.id}`,
  name: `${o.name} Science Desk`,
  domain: "observatories",
  blurb: o.spec,
  keys: [...words(o.name), o.country.toLowerCase(), "observatory", "telescope", ...words(o.studies)],
  run() {
    return report(`🔭 ${o.name}`, [
      `${o.country} · ${fmt(Math.abs(o.lat), 2)}° ${o.lat >= 0 ? "N" : "S"}, ${fmt(Math.abs(o.lon), 2)}° ${o.lon >= 0 ? "E" : "W"}`,
      `Instrument: ${o.spec}`,
      `Science: ${o.studies}`,
      o.lat < -20
        ? "A southern site: it can see the galactic centre, the Magellanic Clouds and Alpha Centauri, which no northern telescope ever will."
        : "A northern site, covering the half of the sky the southern observatories cannot reach.",
    ]);
  },
}));

const groundAgents = GROUND_NETWORKS.map((g) => ({
  id: `gs-${g.id}`,
  name: `${g.name}`,
  domain: "ground segment",
  blurb: g.purpose,
  keys: [...words(g.name), ...words(g.operator), "ground station", "downlink", "antenna", "network", "telemetry", "dsn"],
  run() {
    return report(`📡 ${g.name}`, [
      `Operator: ${g.operator}`,
      `Sites: ${g.sites}`,
      `Bands: ${g.bands}`,
      g.purpose,
    ]);
  },
}));

/* ==================================================================
   3. THE MESH
   ================================================================== */

export const AGENTS = [
  ...SKILLS,
  ...knowledgeAgents,
  ...industryAgents,
  ...constellationAgents,
  ...feedAgents,
  ...tutorAgents,
  ...regionAgents,
  ...sectorAgents,
  ...spaceportAgents,
  ...observatoryAgents,
  ...groundAgents,
].map((a) => ({ ...a, keys: [...new Set(a.keys.filter(Boolean))] }));

export const AGENT_COUNT = AGENTS.length;

export const AGENT_DOMAINS = [...new Set(AGENTS.map((a) => a.domain))].sort();

export const agentById = (id) => AGENTS.find((a) => a.id === id) || null;

/** Stop-words that would otherwise match hundreds of agents at once. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
  "what", "how", "why", "who", "when", "where", "me", "my", "i", "you", "it", "that",
  "this", "with", "about", "can", "do", "does", "please", "tell", "show", "give",
  "from", "at", "be", "as", "by", "get", "make", "want", "need", "have", "has",
]);

/**
 * Scores every agent against a request and returns the strongest.
 * Exact key phrases beat single word hits, which beat blurb matches.
 */
export function route(request, { limit = 4 } = {}) {
  const lower = request.toLowerCase();
  const terms = words(lower).filter((w) => w.length > 2 && !STOP.has(w));
  if (!terms.length) return [];

  const scored = AGENTS.map((agent) => {
    let score = 0;
    for (const key of agent.keys) {
      if (key.includes(" ")) {
        if (lower.includes(key)) score += 14;
      } else if (terms.includes(key)) score += 6;
      else if (terms.some((t) => t.length > 4 && key.startsWith(t))) score += 2;
    }
    const nameWords = words(agent.name.toLowerCase());
    for (const t of terms) if (nameWords.includes(t)) score += 5;
    if (agent.blurb) {
      const b = agent.blurb.toLowerCase();
      for (const t of terms) if (b.includes(t)) score += 1;
    }
    return { agent, score };
  })
    .filter((r) => r.score > 3)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((r) => ({ ...r.agent, score: r.score }));
}

/**
 * Runs a request across the mesh. Agents run in parallel; a failure in
 * one never takes down the answer, it is reported as a failure.
 */
export async function dispatch(request, { limit = 3, context = {} } = {}) {
  const started = performance.now();
  const chosen = route(request, { limit });

  if (!chosen.length) {
    const guesses = searchCodex(request).slice(0, 5);
    return {
      request,
      agents: [],
      reports: [
        report("No specialist matched that request", [
          "The mesh routes on subject keywords. Try naming a world, a mission, a company, a country, or an engineering quantity.",
          guesses.length ? `Closest codex entries: ${guesses.map((g) => g.name).join(", ")}.` : "Nothing in the codex looked close either.",
          "Examples that always work: “where is the ISS right now”, “Hohmann transfer 400 km to 35786 km”, “who launches from India”, “python code to track a satellite”, “how far is Mars today”.",
        ]),
      ],
      ms: Math.round(performance.now() - started),
    };
  }

  const reports = await Promise.all(
    chosen.map(async (agent) => {
      try {
        const r = await agent.run(request, context);
        return { ...r, agent: { id: agent.id, name: agent.name, domain: agent.domain, score: agent.score } };
      } catch (error) {
        return {
          ...report(agent.name, [`This agent failed: ${error.message}`]),
          agent: { id: agent.id, name: agent.name, domain: agent.domain, score: agent.score },
          failed: true,
        };
      }
    })
  );

  return { request, agents: chosen, reports, ms: Math.round(performance.now() - started) };
}

/** A short spoken summary of a dispatch, for the voice channel. */
export function speakable(result) {
  if (!result.reports.length) return "No specialist matched that request.";
  const first = result.reports[0];
  const body = first.lines.slice(0, 3).join(" ");
  return `${first.agent?.name || "The mesh"} reports. ${first.title}. ${body}`;
}

/** Counts used by the Agents page header. */
export const MESH_STATS = {
  total: AGENT_COUNT,
  skills: SKILLS.length,
  knowledge: knowledgeAgents.length,
  industry: industryAgents.length,
  constellations: constellationAgents.length,
  feeds: feedAgents.length,
  tutors: tutorAgents.length,
  regions: regionAgents.length,
  sectors: sectorAgents.length,
  spaceports: spaceportAgents.length,
  observatories: observatoryAgents.length,
  ground: groundAgents.length,
  domains: AGENT_DOMAINS.length,
};
