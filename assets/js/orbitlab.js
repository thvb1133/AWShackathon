/* ============================================================
   orbitlab.js — the Earth Orbit Laboratory.

   A 3D globe carrying real satellites, propagated from live
   two-line element sets with the NORAD SGP4 model. Nothing here is
   decorative: if the ISS marker is over the Indian Ocean, the ISS is
   over the Indian Ocean. Click any object to get its altitude,
   velocity, orbital regime, period and ground track.
   ============================================================ */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseSatellite, propagateSatellite, groundTrack, orbitRegime, EARTH_RADIUS_KM } from "./orbit.js";

const R = 1; // one scene unit = one Earth radius
const km = (v) => v / EARTH_RADIUS_KM;

const REGIME_COLOUR = {
  leo: 0x5ce6a8,
  meo: 0xffd166,
  geo: 0xff6fae,
  heo: 0x9b6bff,
  decaying: 0xff7a7a,
};

function latLonAlt(lat, lon, altKm, out = new THREE.Vector3()) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r = R + km(altKm);
  return out.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function globeTexture() {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext("2d");
  const ocean = g.createLinearGradient(0, 0, 0, c.height);
  ocean.addColorStop(0, "#0a2b4d");
  ocean.addColorStop(0.5, "#0d3f6e");
  ocean.addColorStop(1, "#0a2b4d");
  g.fillStyle = ocean;
  g.fillRect(0, 0, c.width, c.height);

  /* Simplified coastlines. Detailed enough that you can tell at a glance
     which ocean a satellite is over, small enough to live in a source file
     rather than a multi-megabyte satellite image. */
  const land = [
    // North and Central America
    [[-168, 65], [-166, 68], [-156, 71], [-140, 70], [-128, 70], [-115, 69], [-100, 69], [-95, 72], [-85, 70],
     [-82, 73], [-75, 73], [-68, 63], [-64, 60], [-78, 62], [-80, 52], [-64, 50], [-56, 52], [-53, 47], [-66, 44],
     [-70, 42], [-74, 40], [-76, 35], [-81, 31], [-80, 25], [-83, 29], [-85, 30], [-89, 29], [-94, 29], [-97, 26],
     [-97, 22], [-95, 18], [-92, 15], [-88, 16], [-84, 10], [-78, 9], [-83, 8], [-87, 13], [-95, 16], [-105, 20],
     [-110, 24], [-114, 28], [-117, 32], [-122, 37], [-124, 42], [-124, 48], [-131, 53], [-137, 58], [-146, 60],
     [-152, 58], [-158, 56], [-165, 60], [-168, 65]],
    // South America
    [[-81, 8], [-77, 8], [-72, 12], [-64, 11], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-38, -5], [-35, -8],
     [-39, -13], [-39, -18], [-42, -23], [-48, -25], [-53, -34], [-57, -38], [-62, -40], [-65, -45], [-68, -50],
     [-66, -55], [-72, -54], [-75, -49], [-74, -44], [-73, -37], [-71, -30], [-70, -23], [-70, -18], [-76, -14],
     [-79, -8], [-81, -5], [-80, 0], [-78, 1], [-81, 8]],
    // Africa
    [[-17, 15], [-16, 20], [-13, 24], [-10, 28], [-6, 32], [-2, 35], [3, 37], [10, 37], [11, 34], [17, 31],
     [25, 32], [32, 31], [34, 28], [37, 22], [39, 15], [43, 12], [48, 12], [51, 11], [49, 5], [43, 0], [41, -5],
     [40, -11], [35, -20], [32, -26], [28, -33], [20, -35], [18, -32], [14, -23], [12, -17], [9, -1], [10, 3],
     [6, 4], [0, 5], [-8, 4], [-13, 8], [-16, 12], [-17, 15]],
    // Eurasia
    [[-9, 43], [-9, 39], [-6, 36], [0, 39], [3, 42], [8, 44], [12, 45], [14, 41], [18, 40], [24, 38], [27, 41],
     [30, 41], [36, 36], [36, 31], [34, 28], [48, 30], [57, 25], [62, 25], [67, 24], [72, 20], [73, 16], [77, 8],
     [80, 10], [81, 16], [87, 21], [92, 21], [95, 16], [98, 13], [100, 7], [104, 2], [105, 10], [109, 11],
     [108, 17], [110, 21], [117, 23], [122, 30], [121, 37], [124, 40], [126, 38], [129, 35], [131, 43], [135, 45],
     [142, 45], [143, 53], [140, 55], [135, 55], [142, 60], [150, 59], [156, 62], [163, 60], [170, 60], [180, 66],
     [180, 70], [160, 70], [140, 73], [130, 73], [112, 76], [100, 77], [95, 78], [80, 73], [70, 73], [60, 70],
     [55, 68], [45, 68], [40, 66], [33, 70], [28, 70], [20, 70], [12, 65], [5, 60], [8, 58], [10, 55], [7, 53],
     [4, 52], [0, 49], [-2, 48], [-5, 48], [-2, 44], [-9, 43]],
    // Australia
    [[113, -22], [114, -26], [115, -32], [118, -34], [124, -33], [129, -32], [134, -32], [138, -35], [141, -38],
     [146, -39], [150, -37], [153, -31], [153, -27], [151, -24], [147, -19], [143, -14], [141, -12], [136, -12],
     [132, -11], [130, -13], [127, -14], [122, -17], [118, -20], [113, -22]],
    // Antarctica
    [[-180, -70], [-150, -76], [-120, -74], [-90, -73], [-60, -64], [-45, -70], [-20, -71], [0, -70], [30, -68],
     [60, -67], [90, -66], [120, -66], [150, -70], [180, -72], [180, -90], [-180, -90], [-180, -70]],
    // Greenland
    [[-45, 60], [-52, 64], [-53, 68], [-58, 72], [-62, 76], [-58, 80], [-45, 83], [-30, 83], [-20, 80], [-22, 74],
     [-30, 68], [-38, 64], [-45, 60]],
    // Japan
    [[130, 31], [132, 34], [136, 35], [139, 35], [141, 39], [141, 42], [145, 43], [143, 45], [140, 42], [137, 37],
     [133, 34], [130, 31]],
    // Great Britain
    [[-5, 50], [-3, 51], [1, 51], [0, 53], [-1, 54], [-3, 55], [-2, 57], [-4, 58], [-6, 58], [-5, 56], [-3, 54],
     [-5, 53], [-5, 51], [-5, 50]],
    // Ireland
    [[-10, 52], [-6, 52], [-6, 55], [-8, 55], [-10, 54], [-10, 52]],
    // Madagascar
    [[43, -12], [50, -15], [50, -20], [47, -25], [45, -25], [43, -21], [43, -16], [43, -12]],
    // New Zealand
    [[172, -34], [174, -37], [178, -38], [177, -40], [174, -41], [172, -43], [170, -46], [167, -46], [170, -43],
     [171, -40], [172, -34]],
    // Sumatra
    [[95, 6], [98, 4], [102, 0], [106, -6], [104, -6], [100, -2], [96, 3], [95, 6]],
    // Borneo
    [[109, 2], [115, 5], [118, 4], [119, -1], [116, -4], [110, -3], [109, 2]],
    // New Guinea
    [[131, -1], [140, -3], [147, -6], [150, -10], [143, -9], [137, -8], [132, -5], [131, -1]],
  ];
  const toXY = (lon, lat) => [((lon + 180) / 360) * c.width, ((90 - lat) / 180) * c.height];
  for (const poly of land) {
    g.beginPath();
    poly.forEach(([lon, lat], i) => {
      const [x, y] = toXY(lon, lat);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    g.fillStyle = "#1f6b3a";
    g.fill();
    g.strokeStyle = "rgba(140,220,170,0.5)";
    g.lineWidth = 2;
    g.stroke();
  }

  g.strokeStyle = "rgba(180,200,255,0.16)";
  g.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = toXY(lon, 0);
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = toXY(0, lat);
    g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke();
  }
  g.strokeStyle = "rgba(255,209,102,0.4)";
  const [, eq] = toXY(0, 0);
  g.beginPath(); g.moveTo(0, eq); g.lineTo(c.width, eq); g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createOrbitLab(canvas, { onSelect, onTick, labelHost } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x02020c, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 400);
  camera.position.set(0, 1.4, 3.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.25;
  controls.maxDistance = 40;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.position.set(6, 1.5, 3);
  scene.add(sun);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    new THREE.MeshStandardMaterial({ map: globeTexture(), roughness: 0.95, metalness: 0.0 })
  );
  scene.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.14, side: THREE.BackSide })
  );
  scene.add(atmosphere);

  // Reference shells so orbital regimes are legible at a glance.
  const shells = [
    { alt: 2000, colour: 0x5ce6a8, label: "LEO ceiling" },
    { alt: 20200, colour: 0xffd166, label: "MEO / GPS" },
    { alt: 35786, colour: 0xff6fae, label: "GEO belt" },
  ].map((s) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R + km(s.alt), R + km(s.alt) + 0.004, 180),
      new THREE.MeshBasicMaterial({ color: s.colour, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
    );
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);
    return ring;
  });

  const stars = (() => {
    const geo = new THREE.BufferGeometry();
    const n = 4000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 120 + Math.random() * 120;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 0.35 }));
    scene.add(p);
    return p;
  })();

  /* ------------------------------------------------- satellites */
  let sats = [];
  let cloud = null;
  let cloudGeo = null;
  let selected = null;
  const trackLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 })
  );
  scene.add(trackLine);
  const groundLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x5ce6a8, transparent: true, opacity: 0.75 })
  );
  scene.add(groundLine);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  marker.visible = false;
  scene.add(marker);

  /**
   * Loads a list of {name, line1, line2}. Elements SGP4 rejects are
   * reported rather than silently dropped — a decayed object in a
   * CelesTrak group is information, not an error.
   */
  function load(tles) {
    if (cloud) { scene.remove(cloud); cloudGeo.dispose(); cloud.material.dispose(); }
    sats = [];
    const rejected = [];
    for (const t of tles) {
      try {
        sats.push({ name: t.name, noradId: t.noradId, rec: parseSatellite(t.line1, t.line2), line1: t.line1, line2: t.line2 });
      } catch (err) {
        rejected.push({ name: t.name, reason: err.message });
      }
    }
    cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sats.length * 3), 3));
    cloudGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(sats.length * 3), 3));
    cloud = new THREE.Points(
      cloudGeo,
      new THREE.PointsMaterial({ size: 0.03, vertexColors: true, sizeAttenuation: true })
    );
    scene.add(cloud);
    selected = null;
    marker.visible = false;
    trackLine.geometry.setFromPoints([]);
    groundLine.geometry.setFromPoints([]);
    return { loaded: sats.length, rejected };
  }

  let simDate = new Date();
  let timeScale = 1;
  let lastPropagate = 0;
  const scratch = new THREE.Vector3();
  const colour = new THREE.Color();

  function propagateAll(date) {
    if (!cloud) return;
    const pos = cloudGeo.attributes.position.array;
    const col = cloudGeo.attributes.color.array;
    for (let i = 0; i < sats.length; i++) {
      const s = sats[i];
      const p = propagateSatellite(s.rec, date);
      if (!p) {
        pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 0;
        continue;
      }
      s.state = p;
      latLonAlt(p.lat, p.lon, p.altKm, scratch);
      pos[i * 3] = scratch.x;
      pos[i * 3 + 1] = scratch.y;
      pos[i * 3 + 2] = scratch.z;
      colour.setHex(REGIME_COLOUR[orbitRegime(p.altKm).id] || 0xffffff);
      col[i * 3] = colour.r; col[i * 3 + 1] = colour.g; col[i * 3 + 2] = colour.b;
    }
    cloudGeo.attributes.position.needsUpdate = true;
    cloudGeo.attributes.color.needsUpdate = true;
    cloudGeo.computeBoundingSphere();
  }

  function drawTracks(sat, date) {
    const track = groundTrack(sat.rec, { from: date, minutes: Math.min(240, sat.state ? 120 : 95), step: 25 });
    trackLine.geometry.setFromPoints(track.map((p) => latLonAlt(p.lat, p.lon, p.altKm)));
    groundLine.geometry.setFromPoints(track.map((p) => latLonAlt(p.lat, p.lon, 30)));
  }

  function selectIndex(i) {
    const s = sats[i];
    if (!s) return;
    selected = s;
    drawTracks(s, simDate);
    const period = (2 * Math.PI) / s.rec.no / 60; // rec.no is radians/minute
    onSelect?.({
      name: s.name,
      noradId: s.noradId,
      ...s.state,
      regime: orbitRegime(s.state?.altKm ?? 0),
      periodMinutes: (2 * Math.PI) / s.rec.no,
      periodHours: period,
      inclinationDeg: (s.rec.inclo * 180) / Math.PI,
      eccentricity: s.rec.ecco,
      line1: s.line1,
      line2: s.line2,
    });
  }

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.045;
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", (e) => {
    if (!cloud) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(cloud, false)[0];
    if (hit) selectIndex(hit.index);
  });

  let alive = true;
  let handle = 0;
  const clock = new THREE.Clock();

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || 460;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    if (!alive) return;
    handle = requestAnimationFrame(frame);
    const dt = clock.getDelta();
    simDate = new Date(simDate.getTime() + dt * 1000 * timeScale);

    resize();
    // Light the Earth from the real solar direction for this instant.
    const dayAngle = ((simDate.getUTCHours() + simDate.getUTCMinutes() / 60) / 24) * Math.PI * 2;
    sun.position.set(Math.cos(dayAngle) * 8, Math.sin(((simDate.getUTCMonth() + 1) / 12) * Math.PI * 2) * 3, Math.sin(dayAngle) * 8);

    const now = performance.now();
    if (now - lastPropagate > 220) {
      propagateAll(simDate);
      if (selected) {
        const p = propagateSatellite(selected.rec, simDate);
        if (p) {
          selected.state = p;
          latLonAlt(p.lat, p.lon, p.altKm, marker.position);
          marker.visible = true;
        }
      }
      lastPropagate = now;
    }

    controls.update();
    renderer.render(scene, camera);
    onTick?.({ date: new Date(simDate), count: sats.length, timeScale, selected: selected?.name || null, state: selected?.state || null });
  }
  frame();

  return {
    load,
    get date() { return new Date(simDate); },
    setDate(d) { simDate = new Date(d); propagateAll(simDate); if (selected) drawTracks(selected, simDate); },
    setTimeScale(v) { timeScale = v; },
    get timeScale() { return timeScale; },
    now() { simDate = new Date(); propagateAll(simDate); },
    selectByName(query) {
      const q = query.toLowerCase();
      const i = sats.findIndex((s) => s.name.toLowerCase().includes(q));
      if (i >= 0) selectIndex(i);
      return i >= 0 ? sats[i].name : null;
    },
    list: () => sats.map((s) => ({ name: s.name, noradId: s.noradId, altKm: s.state?.altKm })),
    toggleShells(v) { const on = v ?? !shells[0].visible; shells.forEach((s) => (s.visible = on)); return on; },
    focusSelected() {
      if (!selected?.state) return;
      const v = latLonAlt(selected.state.lat, selected.state.lon, selected.state.altKm);
      // Aim at the midpoint between the Earth's centre and the satellite, and
      // stand off to one side, so both stay in frame. A geostationary object
      // is 6.6 Earth radii out, so its view is honestly a distant one.
      const mid = v.clone().multiplyScalar(0.5);
      const side = new THREE.Vector3(0, 1, 0).cross(v).normalize();
      if (!Number.isFinite(side.x) || side.lengthSq() < 1e-6) side.set(1, 0, 0);
      const dist = Math.max(2.6, v.length() * 1.1);
      controls.target.copy(mid);
      camera.position.copy(mid.clone().addScaledVector(side, dist).addScaledVector(new THREE.Vector3(0, 1, 0), dist * 0.3));
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(handle);
      controls.dispose();
      renderer.dispose();
    },
  };
}
