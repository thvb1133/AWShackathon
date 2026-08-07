/* ============================================================
   orb.js — the pink and purple sphere you talk to.

   A three.js orb that is not a spinning GIF: the surface is displaced
   in the vertex shader by a layered wobble, and the amplitude of that
   wobble is driven by the actual microphone level from a Web Audio
   AnalyserNode. When you speak, it really is your voice moving it.

   Four states, each with its own colour, rhythm and behaviour:
     idle       — slow breathing, deep violet
     listening  — hot pink, reacting to your voice in real time
     thinking   — gold, fast turbulent swirl, while the mesh and the
                  quantum classifier work
     speaking   — pink and violet pulses timed to the syllable rate

   All geometry is procedural. Nothing is downloaded.
   ============================================================ */

import * as THREE from "three";

const STATES = {
  idle: { a: new THREE.Color("#7d5cff"), b: new THREE.Color("#ff6fae"), wobble: 0.11, speed: 0.35, glow: 1.0, spin: 0.05 },
  listening: { a: new THREE.Color("#ff4fa3"), b: new THREE.Color("#c46bff"), wobble: 0.20, speed: 0.9, glow: 1.6, spin: 0.16 },
  thinking: { a: new THREE.Color("#ffb84d"), b: new THREE.Color("#ff5fae"), wobble: 0.30, speed: 2.4, glow: 1.9, spin: 0.55 },
  speaking: { a: new THREE.Color("#ff7ac0"), b: new THREE.Color("#8f6bff"), wobble: 0.24, speed: 1.5, glow: 2.1, spin: 0.22 },
};

/* ---------------------------------------------------------- shaders */

/* A layered sine wobble rather than full simplex noise: three octaves
   is plenty for an organic surface, and it costs a fraction as much on
   the low-powered machines this has to run on. */
const NOISE_GLSL = `
  float wob(vec3 p, float t) {
    return sin(p.x * 2.7 + t) * sin(p.y * 3.1 - t * 1.27) * sin(p.z * 2.3 + t * 0.83);
  }
  float fbm(vec3 p, float t) {
    float v = wob(p, t) * 0.55;
    v += wob(p * 2.1 + 3.7, t * 1.4) * 0.30;
    v += wob(p * 4.3 - 1.9, t * 1.9) * 0.15;
    return v;
  }
`;

const VERTEX = `
  uniform float uTime;
  uniform float uWobble;
  uniform float uSpeed;
  uniform float uLevel;
  uniform float uPulse;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  ${NOISE_GLSL}
  void main() {
    float t = uTime * uSpeed;
    float n = fbm(normalize(position) * 1.6, t);
    // The microphone level and the speech pulse both push the surface out.
    float amount = uWobble * (0.55 + uLevel * 2.4 + uPulse * 0.9);
    vec3 displaced = position + normal * n * amount;
    vDisp = n;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uGlow;
  uniform float uLevel;
  varying float vDisp;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    // Mix the two brand colours by how far the surface has been pushed.
    float mixer = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
    vec3 base = mix(uColorA, uColorB, mixer);

    // A Fresnel rim: bright where the surface turns away from the eye.
    float fres = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), 2.4);

    vec3 colour = base * (0.42 + 0.58 * mixer) + vec3(1.0, 0.85, 1.0) * fres * uGlow * 0.65;
    colour += base * uLevel * 0.9;
    gl_FragColor = vec4(colour, 1.0);
  }
`;

const SHELL_VERTEX = `
  uniform float uTime;
  uniform float uWobble;
  uniform float uSpeed;
  uniform float uLevel;
  varying float vRim;
  varying vec3 vN;
  varying vec3 vV;
  ${NOISE_GLSL}
  void main() {
    float t = uTime * uSpeed * 0.7;
    float n = fbm(normalize(position) * 1.1, t);
    vec3 displaced = position * (1.0 + n * uWobble * (0.4 + uLevel * 1.8));
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vV = normalize(cameraPosition - world.xyz);
    vRim = n;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SHELL_FRAGMENT = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vRim;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float fres = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 3.0);
    vec3 colour = mix(uColorA, uColorB, clamp(vRim * 0.5 + 0.5, 0.0, 1.0));
    gl_FragColor = vec4(colour, fres * uOpacity);
  }
`;

/* ------------------------------------------------------ the sprite glow */

function glowTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(255,140,205,0.55)");
  grad.addColorStop(0.55, "rgba(155,107,255,0.22)");
  grad.addColorStop(1, "rgba(80,40,160,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sparkTexture(size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,170,220,0.7)");
  grad.addColorStop(1, "rgba(255,170,220,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ================================================================
   The orb
   ================================================================ */

export function createOrb(canvas, { detail = 5, particles = 900 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 4.6);

  const group = new THREE.Group();
  scene.add(group);

  const uniforms = {
    uTime: { value: 0 },
    uWobble: { value: STATES.idle.wobble },
    uSpeed: { value: STATES.idle.speed },
    uLevel: { value: 0 },
    uPulse: { value: 0 },
    uGlow: { value: STATES.idle.glow },
    uColorA: { value: STATES.idle.a.clone() },
    uColorB: { value: STATES.idle.b.clone() },
  };

  /* The core: a high-detail icosahedron so the displacement is smooth. */
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, detail),
    new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms })
  );
  group.add(core);

  /* An outer shell, additively blended, giving the orb a halo of itself. */
  const shellUniforms = {
    uTime: uniforms.uTime,
    uWobble: uniforms.uWobble,
    uSpeed: uniforms.uSpeed,
    uLevel: uniforms.uLevel,
    uOpacity: { value: 0.5 },
    uColorA: uniforms.uColorA,
    uColorB: uniforms.uColorB,
  };
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.22, 3),
    new THREE.ShaderMaterial({
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      uniforms: shellUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  group.add(shell);

  /* A wireframe cage, so the shape reads clearly even when still. */
  const cage = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.36, 1)),
    new THREE.LineBasicMaterial({ color: 0xff9fd6, transparent: true, opacity: 0.18 })
  );
  group.add(cage);

  /* The soft bloom behind everything. */
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
  );
  glow.scale.setScalar(5.4);
  scene.add(glow);

  /* Orbiting sparks: they speed up when the orb is thinking. */
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(particles * 3);
  const sparkSeed = new Float32Array(particles * 3);
  for (let i = 0; i < particles; i++) {
    const r = 1.5 + Math.random() * 1.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    sparkSeed[i * 3] = r;
    sparkSeed[i * 3 + 1] = theta;
    sparkSeed[i * 3 + 2] = phi;
  }
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({
      map: sparkTexture(),
      size: 0.07,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffc0e8,
    })
  );
  scene.add(sparks);

  /* ------------------------------------------------ state machine */
  let state = "idle";
  let target = STATES.idle;
  let level = 0;
  let smoothLevel = 0;
  let pulsePhase = 0;
  let alive = true;
  let handle = 0;
  const clock = new THREE.Clock();

  function resize() {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 320;
    if (canvas.width === Math.floor(w * Math.min(devicePixelRatio, 2)) && camera.aspect === w / h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame() {
    if (!alive) return;
    handle = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    resize();

    // Ease every visual property towards the target state.
    const ease = 1 - Math.pow(0.001, dt);
    uniforms.uWobble.value += (target.wobble - uniforms.uWobble.value) * ease;
    uniforms.uSpeed.value += (target.speed - uniforms.uSpeed.value) * ease;
    uniforms.uGlow.value += (target.glow - uniforms.uGlow.value) * ease;
    uniforms.uColorA.value.lerp(target.a, ease);
    uniforms.uColorB.value.lerp(target.b, ease);

    // Microphone level: fast attack, slow release, so it feels alive.
    smoothLevel += (level - smoothLevel) * (level > smoothLevel ? 0.45 : 0.08);
    uniforms.uLevel.value = smoothLevel;

    // While speaking there is no amplitude to read from the synthesiser,
    // so a syllable-rate pulse stands in for it.
    if (state === "speaking") {
      pulsePhase += dt * 7.5;
      uniforms.uPulse.value = 0.5 + 0.5 * Math.sin(pulsePhase) * Math.abs(Math.sin(pulsePhase * 0.31));
    } else if (state === "idle") {
      uniforms.uPulse.value = 0.22 + 0.22 * Math.sin(t * 1.1); // breathing
    } else {
      uniforms.uPulse.value *= 0.9;
    }

    uniforms.uTime.value = t;
    shellUniforms.uOpacity.value = 0.35 + smoothLevel * 0.5 + (state === "thinking" ? 0.25 : 0);

    group.rotation.y += dt * target.spin;
    group.rotation.x = Math.sin(t * 0.25) * 0.12;
    cage.rotation.y -= dt * target.spin * 1.8;
    cage.rotation.z += dt * target.spin * 0.6;

    const breathe = 1 + smoothLevel * 0.16 + uniforms.uPulse.value * 0.04;
    group.scale.setScalar(breathe);
    glow.scale.setScalar(5.0 + smoothLevel * 2.6 + (state === "thinking" ? 0.8 : 0));
    glow.material.opacity = 0.55 + smoothLevel * 0.4;

    // Sparks orbit; they whirl when thinking and drift when idle.
    const swirl = state === "thinking" ? 1.9 : state === "listening" ? 0.8 : 0.32;
    const pos = sparkGeo.attributes.position.array;
    for (let i = 0; i < particles; i++) {
      const r = sparkSeed[i * 3] * (1 + smoothLevel * 0.28);
      const theta = sparkSeed[i * 3 + 1] + t * swirl * (0.4 + (i % 7) / 10);
      const phi = sparkSeed[i * 3 + 2] + Math.sin(t * 0.5 + i) * 0.05;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparks.material.color.copy(uniforms.uColorB.value);
    sparks.material.opacity = 0.5 + smoothLevel * 0.5;

    renderer.render(scene, camera);
  }
  frame();

  return {
    get state() { return state; },
    setState(next) {
      if (!STATES[next] || next === state) return state;
      state = next;
      target = STATES[next];
      if (next === "speaking") pulsePhase = 0;
      return state;
    },
    /** Microphone amplitude, 0 to about 1. */
    setLevel(v) { level = Math.max(0, Math.min(1.4, v)); },
    /** A one-off kick, for example when a reply arrives. */
    ping() { level = Math.min(1.4, level + 0.6); },
    dispose() {
      alive = false;
      cancelAnimationFrame(handle);
      core.geometry.dispose();
      shell.geometry.dispose();
      cage.geometry.dispose();
      sparkGeo.dispose();
      renderer.dispose();
    },
  };
}

/* ================================================================
   Microphone level metering
   ================================================================ */

/**
 * Opens the microphone purely to measure loudness, and hands the level
 * to a callback about sixty times a second.
 *
 * This is separate from speech recognition on purpose. Recognition gives
 * words but no amplitude; this gives amplitude but no words. Running both
 * on the same stream is what lets the orb react to your voice while it is
 * still deciding what you said.
 */
export async function createLevelMeter(onLevel) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser exposes no microphone API");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let alive = true;
  let handle = 0;
  let peak = 0.02;

  const tick = () => {
    if (!alive) return;
    handle = requestAnimationFrame(tick);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    // Track a slowly decaying peak so quiet microphones still show motion.
    peak = Math.max(rms, peak * 0.995, 0.015);
    onLevel(Math.min(1.2, rms / peak), rms);
  };
  tick();

  return {
    stop() {
      alive = false;
      cancelAnimationFrame(handle);
      for (const track of stream.getTracks()) track.stop();
      context.close().catch(() => {});
    },
    get context() { return context; },
  };
}
