/* ============================================================
   solar3d.js — the living Solar System.

   Nothing here is an animation loop with hard-coded angles. Every
   planet is placed by solving Kepler's equation for the exact instant
   shown on the clock, from real J2000 orbital elements. Drag the time
   slider back to 1610 and Jupiter really is where Galileo saw it;
   push it forward to 2183 and the planets are where they will be.

   Rendered with three.js. All surfaces are generated procedurally at
   runtime, so the whole scene ships without a single image file.
   ============================================================ */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SUN, PLANETS, DWARFS, MOONS } from "./universe.js";
import { heliocentric, orbitPath, AU_KM, DEG } from "./orbit.js";

/* Halley's comet: real elements, so the most famous visitor in history
   sweeps through the scene on its true 76-year ellipse. */
const COMETS = [
  {
    id: "halley", name: "Halley's Comet", emoji: "☄️", color: "#c8f5ff", radiusKm: 5.5,
    orbit: { a: 17.834, e: 0.96714, i: 162.26, L: 236.2, lp: 169.75, node: 58.42, period: 75.32 },
  },
];

/* Deep-space probes. Their distance grows at a known, published rate,
   and they fly along a fixed ecliptic bearing, so a linear extrapolation
   puts them within a fraction of a percent of the real ephemeris. */
const PROBES = [
  { id: "voyager1", name: "Voyager 1", emoji: "📡", auAt2024: 163.0, auPerYear: 3.58, lon: 254.5, lat: 35.0, color: "#ffd166" },
  { id: "voyager2", name: "Voyager 2", emoji: "📡", auAt2024: 136.0, auPerYear: 3.23, lon: 290.0, lat: -33.0, color: "#ffb0d4" },
  { id: "pioneer10", name: "Pioneer 10 (silent)", emoji: "🔇", auAt2024: 135.0, auPerYear: 2.54, lon: 78.0, lat: 3.0, color: "#8d89bb" },
  { id: "newhorizons", name: "New Horizons", emoji: "🧊", auAt2024: 58.0, auPerYear: 2.94, lon: 293.0, lat: -2.2, color: "#b3efff" },
];

/* Moons that are large enough to be worth drawing, with real periods. */
const MOON_ORBITS = {
  moon: { parent: "earth", distKm: 384400, days: 27.32 },
  phobos: { parent: "mars", distKm: 9376, days: 0.319 },
  deimos: { parent: "mars", distKm: 23463, days: 1.263 },
  io: { parent: "jupiter", distKm: 421700, days: 1.769 },
  europa: { parent: "jupiter", distKm: 671034, days: 3.551 },
  ganymede: { parent: "jupiter", distKm: 1070412, days: 7.155 },
  callisto: { parent: "jupiter", distKm: 1882709, days: 16.689 },
  titan: { parent: "saturn", distKm: 1221870, days: 15.945 },
  enceladus: { parent: "saturn", distKm: 238040, days: 1.37 },
  triton: { parent: "neptune", distKm: 354759, days: -5.877 },
  charon: { parent: "pluto", distKm: 19591, days: 6.387 },
};

const DAY = 864e5;

/* ------------------------------------------------ procedural art */

function noiseTexture(baseColor, { bands = 0, spots = 260, contrast = 0.34, ice = false } = {}) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  const base = new THREE.Color(baseColor);

  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, c.width, c.height);

  if (bands) {
    for (let i = 0; i < bands; i++) {
      const y = (i / bands) * c.height;
      const h = c.height / bands;
      const shade = base.clone().offsetHSL(0, 0, (Math.sin(i * 2.4) * contrast) / 2);
      g.fillStyle = `#${shade.getHexString()}`;
      g.fillRect(0, y, c.width, h * (0.6 + Math.random() * 0.7));
    }
  }

  for (let i = 0; i < spots; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const r = Math.random() * (bands ? 26 : 15) + 3;
    const shade = base.clone().offsetHSL(
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * contrast
    );
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `#${shade.getHexString()}`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  if (ice) {
    for (const y of [0, c.height - 26]) {
      const grad = g.createLinearGradient(0, y, 0, y + 26);
      grad.addColorStop(y === 0 ? 0 : 1, "rgba(255,255,255,0.85)");
      grad.addColorStop(y === 0 ? 1 : 0, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, y, c.width, 26);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function earthTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#12386e";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * c.width;
    const y = 30 + Math.random() * (c.height - 60);
    const r = 8 + Math.random() * 34;
    g.fillStyle = Math.random() < 0.55 ? "#2f7a3e" : "#4c8f4a";
    g.beginPath();
    g.ellipse(x, y, r, r * (0.4 + Math.random() * 0.6), Math.random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.25})`;
    g.beginPath();
    g.ellipse(Math.random() * c.width, Math.random() * c.height, 14 + Math.random() * 40, 6 + Math.random() * 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.fillRect(0, 0, c.width, 14);
  g.fillRect(0, c.height - 16, c.width, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowSprite(color, size = 512, power = 2.6) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const col = new THREE.Color(color);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    grad.addColorStop(t, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},${Math.pow(1 - t, power)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}

function ringTexture(inner, outer, color) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 32;
  const g = c.getContext("2d");
  const base = new THREE.Color(color);
  for (let x = 0; x < c.width; x++) {
    const t = x / c.width;
    const gap = Math.abs(Math.sin(t * 22)) * Math.abs(Math.sin(t * 7.3));
    const alpha = 0.15 + gap * 0.75 * (1 - Math.pow(Math.abs(t - 0.5) * 2, 3));
    const shade = base.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
    g.fillStyle = `rgba(${shade.r * 255 | 0},${shade.g * 255 | 0},${shade.b * 255 | 0},${alpha.toFixed(3)})`;
    g.fillRect(x, 0, 1, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================================================================
   The scene
   ================================================================ */

export function createSolarSystem(canvas, options = {}) {
  const { onSelect, onTick, labelHost } = options;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x01000a, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 60000);
  camera.position.set(0, 72, 132);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.2;
  controls.maxDistance = 12000;

  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const sunLight = new THREE.PointLight(0xfff2cc, 3.4, 0, 0.9);
  scene.add(sunLight);

  /* ------------------------------------------------- background */
  const starGeo = new THREE.BufferGeometry();
  const starCount = 14000;
  const sp = new Float32Array(starCount * 3);
  const sc = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 9000 + Math.random() * 12000;
    const th = Math.random() * Math.PI * 2;
    // Squash towards the galactic plane so the Milky Way band is visible.
    const ph = Math.acos(2 * Math.random() - 1);
    const band = Math.random() < 0.45 ? 0.28 : 1;
    sp[i * 3] = r * Math.sin(ph) * Math.cos(th);
    sp[i * 3 + 1] = r * Math.cos(ph) * band;
    sp[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.2, 0.35, 0.6 + Math.random() * 0.4);
    sc[i * 3] = c.r; sc[i * 3 + 1] = c.g; sc[i * 3 + 2] = c.b;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9 })));

  /* --------------------------------------------------- scaling */
  let scaleMode = options.scaleMode || "compressed";
  const DIST = 26;
  const distanceScale = (au) => (scaleMode === "true" ? au * DIST : Math.pow(au, 0.52) * DIST);
  const bodyRadius = (km) => Math.max(0.28, Math.pow(km, 0.5) * (scaleMode === "true" ? 0.0035 : 0.028));
  const SUN_RADIUS = () => (scaleMode === "true" ? 2.4 : 7);

  const place = (vec, helio) => {
    const r = Math.hypot(helio.x, helio.y, helio.z) || 1e-9;
    const s = distanceScale(r) / r;
    // three.js is Y-up; the ecliptic is the X/Z plane, so Z and Y swap.
    vec.set(helio.x * s, helio.z * s, -helio.y * s);
  };

  /* ------------------------------------------------------- Sun */
  const sunGroup = new THREE.Group();
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32),
    new THREE.MeshBasicMaterial({ map: noiseTexture("#ffb43c", { spots: 420, contrast: 0.5 }), color: 0xffffff })
  );
  sunMesh.userData.codexId = "sun";
  const sunGlow = new THREE.Sprite(glowSprite("#ffb84d", 512, 2.2));
  const sunCorona = new THREE.Sprite(glowSprite("#ff7a3c", 512, 4.2));
  sunGroup.add(sunMesh, sunGlow, sunCorona);
  scene.add(sunGroup);

  /* --------------------------------------------------- bodies */
  const bodies = [];
  const pickable = [];
  const orbitLines = [];

  function addOrbitLine(orbit, color, opacity = 0.28) {
    const geo = new THREE.BufferGeometry();
    const pts = orbitPath(orbit, 360).map((p) => {
      const v = new THREE.Vector3();
      place(v, p);
      return v;
    });
    geo.setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.userData.orbit = orbit;
    scene.add(line);
    orbitLines.push(line);
    return line;
  }

  function makeBody(def, { texture, radius, emissive = 0 }) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 28),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0.02, emissive, emissiveIntensity: 0.35 })
    );
    mesh.scale.setScalar(radius);
    mesh.userData.codexId = def.id;
    mesh.userData.name = def.name;
    scene.add(mesh);
    pickable.push(mesh);
    return mesh;
  }

  for (const p of PLANETS) {
    const texture = p.id === "earth" ? earthTexture() : noiseTexture(p.color, {
      bands: ["jupiter", "saturn", "uranus", "neptune"].includes(p.id) ? 16 : 0,
      ice: p.id === "mars",
      spots: 240,
    });
    const mesh = makeBody(p, { texture, radius: bodyRadius(p.radiusKm) });
    const line = addOrbitLine(p.orbit, new THREE.Color(p.color).getHex(), 0.32);

    if (p.ring) {
      const inner = 1.5, outer = p.id === "saturn" ? 2.6 : 2.0;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 96),
        new THREE.MeshBasicMaterial({
          map: ringTexture(inner, outer, p.id === "saturn" ? "#e8dcb5" : "#9fd8e6"),
          side: THREE.DoubleSide, transparent: true, depthWrite: false,
        })
      );
      // Lay the ring in the planet's equatorial plane.
      ring.rotation.x = Math.PI / 2;
      mesh.add(ring);
    }

    const halo = new THREE.Sprite(glowSprite(p.color, 256, 3.4));
    halo.scale.setScalar(4);
    mesh.add(halo);

    bodies.push({ def: p, mesh, line, kind: "planet", radius: bodyRadius(p.radiusKm) });
  }

  for (const d of DWARFS) {
    const mesh = makeBody(d, { texture: noiseTexture(d.color, { spots: 160 }), radius: Math.max(0.4, bodyRadius(d.radiusKm) * 0.85) });
    const line = addOrbitLine(d.orbit, new THREE.Color(d.color).getHex(), 0.16);
    bodies.push({ def: d, mesh, line, kind: "dwarf", radius: bodyRadius(d.radiusKm) });
  }

  for (const c of COMETS) {
    const mesh = makeBody(c, { texture: noiseTexture(c.color, { spots: 90 }), radius: 0.5 });
    const tail = new THREE.Sprite(glowSprite("#bff0ff", 256, 2.2));
    tail.scale.setScalar(9);
    mesh.add(tail);
    const line = addOrbitLine(c.orbit, 0x9fe8ff, 0.2);
    bodies.push({ def: c, mesh, line, kind: "comet", radius: 0.5 });
  }

  /* ------------------------------------------------------ moons */
  const moons = [];
  for (const m of MOONS) {
    const o = MOON_ORBITS[m.id];
    if (!o) continue;
    const parent = bodies.find((b) => b.def.id === o.parent);
    if (!parent) continue;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshStandardMaterial({ map: noiseTexture(m.id === "io" ? "#e8d24a" : "#cfd3e0", { spots: 120 }), roughness: 1 })
    );
    mesh.scale.setScalar(Math.max(0.16, bodyRadius(m.radiusKm) * 0.55));
    mesh.userData.codexId = m.id;
    mesh.userData.name = m.name;
    scene.add(mesh);
    pickable.push(mesh);
    moons.push({ def: m, mesh, parent, orbit: o });
  }

  /* --------------------------------------------- belts of rubble */
  function beltPoints({ count, minAu, maxAu, spread, color, size }) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const au = minAu + Math.random() * (maxAu - minAu);
      const th = Math.random() * Math.PI * 2;
      const r = distanceScale(au);
      pos[i * 3] = Math.cos(th) * r;
      pos[i * 3 + 1] = (Math.random() - 0.5) * spread;
      pos[i * 3 + 2] = Math.sin(th) * r;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.62 }));
    scene.add(pts);
    return pts;
  }
  let belts = [
    beltPoints({ count: 3200, minAu: 2.1, maxAu: 3.3, spread: 2.2, color: 0xb9a98c, size: 0.5 }),
    beltPoints({ count: 4200, minAu: 30, maxAu: 50, spread: 6, color: 0x8fd0ff, size: 0.7 }),
  ];

  /* ----------------------------------------------- deep probes */
  const probeMarks = PROBES.map((p) => {
    const s = new THREE.Sprite(glowSprite(p.color, 128, 2.0));
    s.scale.setScalar(3);
    scene.add(s);
    return { def: p, sprite: s };
  });

  /* ------------------------------------------------------ labels */
  const labels = new Map();
  let labelsOn = options.labels !== false;
  function ensureLabels() {
    if (!labelHost) return;
    const make = (id, text, colour) => {
      const el = document.createElement("button");
      el.className = "sky-label";
      el.type = "button";
      el.textContent = text;
      el.style.color = colour;
      el.addEventListener("click", () => select(id, { focus: true }));
      labelHost.appendChild(el);
      labels.set(id, el);
    };
    make("sun", `${SUN.emoji} The Sun`, "#ffd166");
    for (const b of bodies) make(b.def.id, `${b.def.emoji || "•"} ${b.def.name}`, b.def.color || "#dcd8ff");
    for (const m of moons) make(m.def.id, `${m.def.emoji || "•"} ${m.def.name}`, "#c7d2ff");
    for (const p of probeMarks) make(p.def.id, `${p.def.emoji} ${p.def.name}`, p.def.color);
  }
  ensureLabels();

  /* -------------------------------------------------- the clock */
  let simDate = options.date ? new Date(options.date) : new Date();
  let daysPerSecond = options.speed ?? 1;
  let paused = false;
  let showOrbits = true;
  let selectedId = null;
  let following = null;
  const clock = new THREE.Clock();

  function positionsFor(date) {
    const map = new Map();
    for (const b of bodies) {
      const h = heliocentric(b.def.orbit, date);
      const v = new THREE.Vector3();
      place(v, h);
      map.set(b.def.id, { vec: v, helio: h });
    }
    return map;
  }

  function updateScene(date) {
    sunMesh.scale.setScalar(SUN_RADIUS());
    sunGlow.scale.setScalar(SUN_RADIUS() * 4.2);
    sunCorona.scale.setScalar(SUN_RADIUS() * 9);
    sunMesh.rotation.y += 0.0006;

    const positions = positionsFor(date);
    for (const b of bodies) {
      const p = positions.get(b.def.id);
      b.mesh.position.copy(p.vec);
      b.helio = p.helio;
      const rot = b.def.rotation || 1;
      b.mesh.rotation.y = ((date.getTime() / DAY) / rot) * Math.PI * 2;
      if (b.def.id === "uranus") b.mesh.rotation.z = 98 * DEG;
      if (b.def.id === "venus") b.mesh.rotation.z = 177 * DEG;
      if (b.def.id === "earth") b.mesh.rotation.z = 23.44 * DEG;
      if (b.def.id === "mars") b.mesh.rotation.z = 25.19 * DEG;
      if (b.def.id === "saturn") b.mesh.rotation.z = 26.73 * DEG;
    }

    for (const m of moons) {
      const angle = ((date.getTime() / DAY) / m.orbit.days) * Math.PI * 2;
      // Moon distances are compressed hard or they would be inside the planet.
      const d = Math.max(m.parent.radius * 1.9, Math.pow(m.orbit.distKm / 1000, 0.45) * (scaleMode === "true" ? 0.09 : 0.55));
      m.mesh.position.set(
        m.parent.mesh.position.x + Math.cos(angle) * d,
        m.parent.mesh.position.y + Math.sin(angle) * d * 0.16,
        m.parent.mesh.position.z + Math.sin(angle) * d
      );
    }

    const yearsFrom2024 = (date.getTime() - Date.UTC(2024, 0, 1)) / (365.25 * DAY);
    for (const p of probeMarks) {
      const au = Math.max(0.1, p.def.auAt2024 + p.def.auPerYear * yearsFrom2024);
      const r = distanceScale(au);
      const lon = p.def.lon * DEG;
      const lat = p.def.lat * DEG;
      p.sprite.position.set(
        r * Math.cos(lat) * Math.cos(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.sin(lon)
      );
      p.au = au;
    }
  }

  /* ----------------------------------------------- interaction */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function bodyById(id) {
    if (id === "sun") return { def: SUN, mesh: sunMesh, radius: SUN_RADIUS() };
    return bodies.find((b) => b.def.id === id) || moons.find((m) => m.def.id === id) || null;
  }

  function select(id, { focus = false } = {}) {
    selectedId = id;
    if (focus) following = id;
    for (const [key, el] of labels) el.classList.toggle("active", key === id);
    onSelect?.(id, snapshot());
  }

  renderer.domElement.addEventListener("pointerdown", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([sunMesh, ...pickable], false);
    if (hits.length) select(hits[0].object.userData.codexId, { focus: e.detail >= 2 });
  });

  /* ------------------------------------------------- the loop */
  let alive = true;
  let frameHandle = 0;

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || 480;
    if (canvas.width === Math.floor(w * Math.min(devicePixelRatio, 2)) && camera.aspect === w / h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const tmp = new THREE.Vector3();
  function projectLabels() {
    if (!labelHost) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const put = (id, world, radius) => {
      const el = labels.get(id);
      if (!el) return;
      if (!labelsOn) { el.style.display = "none"; return; }
      tmp.copy(world).project(camera);
      const dist = camera.position.distanceTo(world);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.08 && Math.abs(tmp.y) < 1.08 && dist < (radius ? radius * 900 : 4000);
      el.style.display = visible ? "block" : "none";
      if (!visible) return;
      el.style.left = `${((tmp.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((-tmp.y + 1) / 2) * rect.height}px`;
    };
    put("sun", sunMesh.position, SUN_RADIUS());
    for (const b of bodies) put(b.def.id, b.mesh.position, b.radius);
    for (const m of moons) put(m.def.id, m.mesh.position, 0.4);
    for (const p of probeMarks) put(p.def.id, p.sprite.position, 2);
  }

  function frame() {
    if (!alive) return;
    frameHandle = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!paused) simDate = new Date(simDate.getTime() + dt * daysPerSecond * DAY);

    resize();
    updateScene(simDate);

    if (following) {
      const target = bodyById(following);
      if (target) {
        const p = target.mesh.position;
        controls.target.lerp(p, 0.12);
        const want = Math.max(target.radius * 6, 3);
        if (camera.position.distanceTo(p) > want * 14) {
          camera.position.lerp(p.clone().add(new THREE.Vector3(want, want * 0.6, want)), 0.06);
        }
      }
    }

    controls.update();
    renderer.render(scene, camera);
    projectLabels();
    onTick?.(snapshot());
  }

  function snapshot() {
    const sel = selectedId ? bodyById(selectedId) : null;
    const earth = bodies.find((b) => b.def.id === "earth");
    let distanceFromEarthAu = null;
    if (sel?.helio && earth?.helio) {
      distanceFromEarthAu = Math.hypot(
        sel.helio.x - earth.helio.x,
        sel.helio.y - earth.helio.y,
        sel.helio.z - earth.helio.z
      );
    }
    return {
      date: new Date(simDate),
      speed: daysPerSecond,
      paused,
      selectedId,
      scaleMode,
      following,
      sunDistanceAu: sel?.helio ? sel.helio.r : null,
      distanceFromEarthAu,
      lightMinutes: distanceFromEarthAu ? (distanceFromEarthAu * AU_KM) / 17987547.48 : null,
      probes: probeMarks.map((p) => ({ id: p.def.id, name: p.def.name, au: p.au })),
    };
  }

  frame();

  /* --------------------------------------------------- the API */
  return {
    get date() { return new Date(simDate); },
    setDate(d) { simDate = new Date(d); updateScene(simDate); },
    setSpeed(v) { daysPerSecond = v; },
    get speed() { return daysPerSecond; },
    pause(v) { paused = v ?? !paused; return paused; },
    get paused() { return paused; },
    select,
    focus(id) { select(id, { focus: true }); },
    stopFollowing() { following = null; },
    toggleOrbits(v) {
      showOrbits = v ?? !showOrbits;
      for (const l of orbitLines) l.visible = showOrbits;
      return showOrbits;
    },
    toggleLabels(v) { labelsOn = v ?? !labelsOn; return labelsOn; },
    toggleBelts(v) {
      const on = v ?? !belts[0].visible;
      for (const b of belts) b.visible = on;
      return on;
    },
    setScaleMode(mode) {
      scaleMode = mode;
      for (const line of orbitLines) {
        const pts = orbitPath(line.userData.orbit, 360).map((p) => {
          const v = new THREE.Vector3();
          place(v, p);
          return v;
        });
        line.geometry.setFromPoints(pts);
      }
      for (const b of bodies) b.mesh.scale.setScalar(bodyRadius(b.def.radiusKm) * (b.kind === "comet" ? 1 : 1));
      for (const belt of belts) { scene.remove(belt); belt.geometry.dispose(); }
      belts = [
        beltPoints({ count: 3200, minAu: 2.1, maxAu: 3.3, spread: 2.2, color: 0xb9a98c, size: 0.5 }),
        beltPoints({ count: 4200, minAu: 30, maxAu: 50, spread: 6, color: 0x8fd0ff, size: 0.7 }),
      ];
      updateScene(simDate);
      return scaleMode;
    },
    resetView() {
      following = null;
      controls.target.set(0, 0, 0);
      camera.position.set(0, 72, 132);
    },
    snapshot,
    listBodies: () => [{ id: "sun", name: SUN.name }, ...bodies.map((b) => ({ id: b.def.id, name: b.def.name })), ...moons.map((m) => ({ id: m.def.id, name: m.def.name }))],
    dispose() {
      alive = false;
      cancelAnimationFrame(frameHandle);
      controls.dispose();
      renderer.dispose();
      for (const el of labels.values()) el.remove();
    },
  };
}
