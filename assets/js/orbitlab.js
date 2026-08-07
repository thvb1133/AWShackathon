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

  /* A deliberately coarse continental outline: enough to orient
     yourself over the map without shipping a 4 MB satellite image. */
  const land = [
    [[-168, 66], [-150, 70], [-95, 72], [-60, 82], [-20, 82], [-12, 60], [-55, 50], [-80, 25], [-105, 20], [-125, 40], [-168, 66]],
    [[-82, 10], [-60, 5], [-35, -6], [-40, -23], [-55, -35], [-72, -52], [-76, -18], [-80, 0], [-82, 10]],
    [[-18, 35], [12, 37], [32, 32], [43, 12], [51, 12], [40, -5], [40, -25], [20, -35], [12, -18], [8, 4], [-17, 15], [-18, 35]],
    [[-10, 36], [0, 44], [15, 46], [30, 45], [40, 48], [60, 55], [90, 55], [130, 50], [140, 45], [122, 30], [100, 20], [92, 22], [78, 8], [72, 22], [60, 25], [45, 30], [28, 36], [10, 38], [-10, 36]],
    [[113, -22], [130, -12], [142, -11], [153, -25], [145, -38], [130, -32], [115, -34], [113, -22]],
    [[-180, -68], [-120, -74], [-60, -70], [0, -70], [60, -68], [120, -66], [180, -70], [180, -90], [-180, -90], [-180, -68]],
    [[-45, 60], [-20, 62], [-18, 78], [-45, 82], [-60, 76], [-45, 60]],
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
      controls.target.copy(v.clone().multiplyScalar(0.35));
      camera.position.copy(v.clone().multiplyScalar(2.1));
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(handle);
      controls.dispose();
      renderer.dispose();
    },
  };
}
