/* ============================================================
   orbit.js — the mathematics that makes everything move.

   Two independent engines live here:

   1. Keplerian propagation for the Solar System. Given the J2000
      orbital elements in universe.js, it places any planet or dwarf
      planet at any instant between the far past and the far future.
      These are the same three laws Kepler published in 1609–1619.

   2. SGP4 propagation for Earth satellites, using the vendored
      satellite.js implementation of the NORAD model, driven by real
      two-line element sets from CelesTrak.
   ============================================================ */

import * as sat from "../vendor/satellite.es.js";

export const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const EARTH_RADIUS_KM = 6371.0088;
export const MU_EARTH = 398600.4418; // km³/s²
export const G0 = 9.80665; // m/s²
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Julian centuries — the clock every ephemeris is written against. */
export const centuriesSinceJ2000 = (date) => (date.getTime() - J2000) / (36525 * 864e5);
export const yearsSinceJ2000 = (date) => (date.getTime() - J2000) / (365.25 * 864e5);

/**
 * Solves Kepler's equation M = E − e·sin E for the eccentric anomaly.
 * Newton–Raphson converges in a handful of steps for e < 0.9; the
 * highly eccentric comets in the codex are the reason for the cap.
 */
export function solveKepler(meanAnomalyRad, e) {
  let E = e < 0.8 ? meanAnomalyRad : Math.PI;
  for (let i = 0; i < 40; i++) {
    const dE = (E - e * Math.sin(E) - meanAnomalyRad) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Heliocentric ecliptic position of a body, in astronomical units.
 * `orbit` is the element block stored on each planet in universe.js.
 */
export function heliocentric(orbit, date) {
  const t = yearsSinceJ2000(date);
  const { a, e, i, L, lp, node, period } = orbit;

  // Mean longitude advances by one full turn per orbital period.
  const meanLongitude = L + (360 * t) / period;
  const meanAnomaly = ((((meanLongitude - lp) % 360) + 540) % 360) - 180;

  const E = solveKepler(meanAnomaly * DEG, e);
  const xOrb = a * (Math.cos(E) - e);
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const argPeri = (lp - node) * DEG;
  const nodeRad = node * DEG;
  const incRad = i * DEG;

  const cosW = Math.cos(argPeri), sinW = Math.sin(argPeri);
  const cosO = Math.cos(nodeRad), sinO = Math.sin(nodeRad);
  const cosI = Math.cos(incRad), sinI = Math.sin(incRad);

  const x = (cosW * cosO - sinW * sinO * cosI) * xOrb + (-sinW * cosO - cosW * sinO * cosI) * yOrb;
  const y = (cosW * sinO + sinW * cosO * cosI) * xOrb + (-sinW * sinO + cosW * cosO * cosI) * yOrb;
  const z = sinW * sinI * xOrb + cosW * sinI * yOrb;

  return { x, y, z, r: Math.hypot(x, y, z), trueAnomalyDeg: Math.atan2(yOrb, xOrb) / DEG };
}

/** One full ellipse as a list of points, for drawing the orbit line. */
export function orbitPath(orbit, segments = 256) {
  const pts = [];
  const { a, e, i, lp, node } = orbit;
  const argPeri = (lp - node) * DEG;
  const nodeRad = node * DEG;
  const incRad = i * DEG;
  const cosW = Math.cos(argPeri), sinW = Math.sin(argPeri);
  const cosO = Math.cos(nodeRad), sinO = Math.sin(nodeRad);
  const cosI = Math.cos(incRad), sinI = Math.sin(incRad);

  for (let s = 0; s <= segments; s++) {
    const E = (s / segments) * Math.PI * 2;
    const xOrb = a * (Math.cos(E) - e);
    const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(E);
    pts.push({
      x: (cosW * cosO - sinW * sinO * cosI) * xOrb + (-sinW * cosO - cosW * sinO * cosI) * yOrb,
      y: (cosW * sinO + sinW * cosO * cosI) * xOrb + (-sinW * sinO + cosW * cosO * cosI) * yOrb,
      z: sinW * sinI * xOrb + cosW * sinI * yOrb,
    });
  }
  return pts;
}

/** Where a body sits as seen from Earth: distance, and light travel time. */
export function fromEarth(bodyOrbit, earthOrbit, date) {
  const b = heliocentric(bodyOrbit, date);
  const e = heliocentric(earthOrbit, date);
  const dx = b.x - e.x, dy = b.y - e.y, dz = b.z - e.z;
  const au = Math.hypot(dx, dy, dz);
  return { au, km: au * AU_KM, lightMinutes: (au * AU_KM) / 17987547.48 };
}

/* ============================================================
   Earth satellites — SGP4
   ============================================================ */

/** Parses a TLE into a propagatable record. Throws on malformed input. */
export function parseSatellite(line1, line2) {
  const rec = sat.twoline2satrec(line1.trim(), line2.trim());
  if (rec.error) throw new Error(`SGP4 rejected these elements (code ${rec.error})`);
  return rec;
}

/**
 * Sub-satellite point and altitude at a given instant.
 * Returns null when SGP4 cannot converge — decayed objects do this.
 */
export function propagateSatellite(rec, date = new Date()) {
  const pv = sat.propagate(rec, date);
  if (!pv?.position) return null;
  const gmst = sat.gstime(date);
  const geo = sat.eciToGeodetic(pv.position, gmst);
  const speed = pv.velocity
    ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z)
    : NaN;
  return {
    lat: sat.degreesLat(geo.latitude),
    lon: sat.degreesLong(geo.longitude),
    altKm: geo.height,
    speedKms: speed,
    speedKmh: speed * 3600,
    eci: pv.position,
    ecf: sat.eciToEcf(pv.position, gmst),
  };
}

/** The path a satellite draws on the ground over the coming minutes. */
export function groundTrack(rec, { from = new Date(), minutes = 95, step = 30 } = {}) {
  const points = [];
  for (let s = 0; s <= minutes * 60; s += step) {
    const p = propagateSatellite(rec, new Date(from.getTime() + s * 1000));
    if (p) points.push({ lat: p.lat, lon: p.lon, altKm: p.altKm, t: from.getTime() + s * 1000 });
  }
  return points;
}

/**
 * When will this satellite be above the horizon for an observer?
 * Scans forward in coarse steps and reports each pass with its peak.
 */
export function nextPasses(rec, observer, { hours = 24, minElevation = 10, step = 30 } = {}) {
  const obs = {
    latitude: observer.lat * DEG,
    longitude: observer.lon * DEG,
    height: (observer.altKm ?? 0.05),
  };
  const passes = [];
  let current = null;
  const start = Date.now();
  for (let s = 0; s <= hours * 3600; s += step) {
    const when = new Date(start + s * 1000);
    const pv = sat.propagate(rec, when);
    if (!pv?.position) continue;
    const ecf = sat.eciToEcf(pv.position, sat.gstime(when));
    const look = sat.ecfToLookAngles(obs, ecf);
    const el = look.elevation / DEG;
    if (el >= minElevation) {
      if (!current) current = { start: when, peak: el, peakAt: when, azimuth: look.azimuth / DEG };
      else if (el > current.peak) {
        current.peak = el;
        current.peakAt = when;
      }
    } else if (current) {
      current.end = when;
      current.durationMin = Math.round((current.end - current.start) / 60000);
      passes.push(current);
      current = null;
    }
  }
  return passes;
}

/** Classifies an orbit the way a mission planner would say it out loud. */
export function orbitRegime(altKm) {
  if (altKm < 160) return { id: "decaying", label: "Decaying / sub-orbital" };
  if (altKm < 2000) return { id: "leo", label: "Low Earth Orbit (LEO)" };
  if (altKm < 35000) return { id: "meo", label: "Medium Earth Orbit (MEO)" };
  if (altKm < 36500) return { id: "geo", label: "Geostationary belt (GEO)" };
  return { id: "heo", label: "High / highly elliptical orbit" };
}

/* ============================================================
   Mission arithmetic — the numbers MR PENGUIN cares about
   ============================================================ */

/** Tsiolkovsky, 1903. The equation that decides whether you fly. */
export const deltaV = ({ isp, massInitial, massFinal }) =>
  isp * G0 * Math.log(massInitial / massFinal);

/** Propellant mass required to achieve a given change in velocity. */
export const propellantFor = ({ isp, dryMassKg, deltaVms }) =>
  dryMassKg * (Math.exp(deltaVms / (isp * G0)) - 1);

/** Circular orbital speed and period at a given altitude above Earth. */
export function circularOrbit(altKm) {
  const r = EARTH_RADIUS_KM + altKm;
  const v = Math.sqrt(MU_EARTH / r);
  return {
    radiusKm: r,
    speedKms: v,
    speedKmh: v * 3600,
    periodMinutes: (2 * Math.PI * Math.sqrt(r ** 3 / MU_EARTH)) / 60,
    escapeKms: Math.sqrt((2 * MU_EARTH) / r),
  };
}

/** A two-burn Hohmann transfer between circular orbits around Earth. */
export function hohmann(fromAltKm, toAltKm) {
  const r1 = EARTH_RADIUS_KM + fromAltKm;
  const r2 = EARTH_RADIUS_KM + toAltKm;
  const aTransfer = (r1 + r2) / 2;
  const v1 = Math.sqrt(MU_EARTH / r1);
  const v2 = Math.sqrt(MU_EARTH / r2);
  const vp = Math.sqrt(MU_EARTH * (2 / r1 - 1 / aTransfer));
  const va = Math.sqrt(MU_EARTH * (2 / r2 - 1 / aTransfer));
  return {
    burn1Kms: Math.abs(vp - v1),
    burn2Kms: Math.abs(v2 - va),
    totalKms: Math.abs(vp - v1) + Math.abs(v2 - va),
    transferHours: (Math.PI * Math.sqrt(aTransfer ** 3 / MU_EARTH)) / 3600,
  };
}

/** Kepler's third law for anything orbiting the Sun. */
export const periodFromAu = (au) => Math.sqrt(au ** 3);
export const auFromPeriod = (years) => Math.cbrt(years ** 2);

/** Surface gravity and escape velocity from radius and mass ratios. */
export function bodyGravity({ radiusKm, massEarths }) {
  const gEarth = 9.80665;
  const rRatio = radiusKm / EARTH_RADIUS_KM;
  return {
    surfaceG: (massEarths / (rRatio * rRatio)) * gEarth,
    escapeKms: 11.186 * Math.sqrt(massEarths / rRatio),
  };
}
