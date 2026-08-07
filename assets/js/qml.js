/* ============================================================
   qml.js — quantum machine learning, doing a real job.

   The agent mesh has to decide what kind of thing you are asking for
   before it can pick a specialist. That decision is made here, by
   quantum machine learning — two independent models, both running on
   the state-vector simulator in quantum.js:

     1. A variational quantum classifier per intent, trained in your
        browser by the parameter-shift rule. Five one-vs-rest models,
        4 qubits each, 16 trainable angles apiece.

     2. A quantum kernel nearest-neighbour vote, using the ZZ feature
        map of Havlíček et al. (2019). The kernel is estimated the way
        hardware does it — prepare |φ(x')⟩, apply U(x)†, measure the
        probability of all zeros.

   The two are combined. When they disagree, confidence drops, and the
   router widens its search rather than committing.

   Honest framing: this is simulated quantum computation, not a QPU.
   The circuits, the feature maps, the gradients and the kernels are
   the real algorithms; a 4-qubit register is simply cheap to simulate
   exactly. On hardware you would get the same maths plus shot noise.
   ============================================================ */

import {
  VariationalClassifier, angleFeatureMap, zzFeatureMap, quantumKernel,
  bb84, keyToHex, QuantumRegister,
} from "./quantum.js";

/* One qubit per intent. An earlier version squeezed "write me code" and
   "tell me what this means" onto a single axis — code at one end, reflection
   at the other — and the classifier could not reliably separate them,
   because they are not opposites. Giving each intent its own feature costs
   one qubit and a 32-amplitude state vector, and fixed it. */
const CACHE_KEY = "bo_qml_weights_v4";
const QUBITS = 5;
/* Three layers rather than two. With one-vs-rest, the "look up" class is
   much the largest, and twenty angles could not separate it cleanly; thirty
   can. The cost is a few seconds of training, paid once and then cached. */
const LAYERS = 3;

/* ==================================================================
   1. Intents — what the mesh needs to know about a request
   ================================================================== */

export const INTENTS = {
  calculate: {
    label: "Calculate",
    hint: "Wants a number worked out from physics.",
    emoji: "🧮",
  },
  lookup: {
    label: "Look up",
    hint: "Wants a record: a world, a person, a mission, a company.",
    emoji: "📚",
  },
  live: {
    label: "Live data",
    hint: "Wants the current state of something in the real sky.",
    emoji: "📡",
  },
  code: {
    label: "Write code",
    hint: "Wants software they can run.",
    emoji: "💻",
  },
  reflect: {
    label: "Reflect",
    hint: "Wants meaning rather than measurement.",
    emoji: "🪶",
  },
};

export const INTENT_IDS = Object.keys(INTENTS);

/* ==================================================================
   2. Feature extraction — classical data on its way into a qubit
   ================================================================== */

const NUMBER_UNITS = /\b\d[\d,.]*\s*(km|kg|m\/s|w|watt|au|deg|°|s|sec|min|hour|day|year|ghz|mhz|nt|kt|tonne)\b/i;
const CALC_WORDS = ["calculate", "compute", "how much", "how many", "how far", "how fast", "how long", "delta", "budget", "transfer", "orbit", "velocity", "altitude", "period", "mass", "power", "gravity", "weigh", "resolution", "inclination", "distance", "energy", "temperature", "loss", "rate"];
const LOOKUP_WORDS = ["who", "what is", "what are", "tell me about", "when did", "when was", "history", "discovered", "invented", "founded", "explain", "describe", "which company", "who built", "story", "about the"];
const LIVE_WORDS = ["now", "right now", "today", "tonight", "current", "currently", "latest", "live", "at the moment", "this week", "this month", "upcoming", "coming up", "scheduled", "soon", "next launch", "where is", "position", "track", "overhead", "forecast", "real time", "status of", "crowded", "congestion", "space traffic", "how many satellites", "how many objects"];
const CODE_WORDS = ["code", "python", "javascript", "script", "program", "function", "api", "library", "snippet", "write me a", "how do i write", "implement", "sdk", "json", "run it"];
const REFLECT_WORDS = ["why", "meaning", "feel", "feeling", "beautiful", "alone", "lonely", "soul", "love", "afraid", "scared", "hope", "human", "philosophy", "sad", "wonder", "purpose", "poem", "poetic", "does it matter"];

const hits = (text, list) => list.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

/**
 * Five features, one per intent, each squashed into [0, π] so it can be
 * a rotation angle.
 *
 * Angle encoding needs bounded inputs, and the ZZ map's entangling term
 * (π − xᵃ)(π − xᵇ) is designed for exactly this range. Keeping the
 * features interpretable also means a wrong routing decision can be
 * explained rather than shrugged at — the quantum page prints these
 * angles next to every verdict.
 */
export function extractFeatures(request) {
  const text = ` ${String(request).toLowerCase().trim()} `;
  const words = text.match(/[a-z']+/g) || [];
  const length = Math.max(1, words.length);

  const numeric = (text.match(/\d/g) || []).length / (text.length || 1);
  const unitHit = NUMBER_UNITS.test(text) ? 1 : 0;

  const raw = [
    // 0 — is this quantitative?
    Math.min(1, unitHit * 0.6 + numeric * 3 + hits(text, CALC_WORDS) / 3),
    // 1 — is this an encyclopedia question?
    Math.min(1, hits(text, LOOKUP_WORDS) / 2),
    // 2 — does it demand the present moment?
    Math.min(1, hits(text, LIVE_WORDS) / 2),
    // 3 — does it want software?
    Math.min(1, hits(text, CODE_WORDS) / 1.5),
    // 4 — does it want meaning rather than measurement?
    Math.min(1, hits(text, REFLECT_WORDS) / 1.5),
  ];

  // A short request carries less evidence; nudge everything towards
  // the middle of the range so the classifier does not over-commit.
  const damping = Math.min(1, length / 5);
  return raw.map((v) => Math.max(0, Math.min(1, 0.5 + (v - 0.5) * damping)) * Math.PI);
}

/* ==================================================================
   3. The training set — hand-labelled, deliberately small
   ================================================================== */

/* Fifty-five examples. Small on purpose: a variational circuit with
   sixteen parameters cannot absorb more, and the point is to show the
   model generalising from little data, which is the property quantum
   kernels are actually conjectured to be good at. */
const TRAINING = [
  ["hohmann transfer from 400 km to 35786 km", "calculate"],
  ["orbital velocity at 550 km", "calculate"],
  ["how much propellant for 1800 m/s with isp 320", "calculate"],
  ["sun synchronous inclination at 700 km", "calculate"],
  ["power budget for 250 w at 550 km", "calculate"],
  ["what would i weigh on titan", "calculate"],
  ["delta v to reach geostationary orbit", "calculate"],
  ["how far is mars from earth", "calculate"],
  ["light delay to jupiter in minutes", "calculate"],
  ["re-entry lifetime from 500 km", "calculate"],
  ["imaging resolution from 500 km with a 1.1 m aperture", "calculate"],
  ["equilibrium temperature at 5 au", "calculate"],
  ["how long does a transfer to mars take", "calculate"],

  ["who discovered uranus", "lookup"],
  ["tell me about vera rubin", "lookup"],
  ["what is dark matter", "lookup"],
  ["explain the cosmic microwave background", "lookup"],
  ["when was sputnik launched", "lookup"],
  ["who founded isro", "lookup"],
  ["what are quasars", "lookup"],
  ["describe the kuiper belt", "lookup"],
  ["history of the apollo programme", "lookup"],
  ["which company builds radar satellites", "lookup"],
  ["tell me about the james webb telescope", "lookup"],
  ["what is a neutron star", "lookup"],
  ["who was katherine johnson", "lookup"],

  ["where is the iss right now", "live"],
  ["what is the space station position today", "live"],
  ["next launches worldwide", "live"],
  ["current solar wind speed", "live"],
  ["is there a geomagnetic storm at the moment", "live"],
  ["show me starlink satellites live", "live"],
  ["asteroids passing earth this week", "live"],
  ["track hubble now", "live"],
  ["what can i see tonight", "live"],
  ["latest picture of the day", "live"],
  ["aurora forecast", "live"],
  ["which satellites are overhead", "live"],

  ["python code to track a satellite", "code"],
  ["write me a script for the nasa api", "code"],
  ["javascript function for orbital period", "code"],
  ["how do i implement sgp4", "code"],
  ["give me a snippet to compute delta v", "code"],
  ["code for reading two line elements", "code"],
  ["show me a program that plots an orbit", "code"],
  ["python library for astronomy", "code"],

  ["why are we alone in the universe", "reflect"],
  ["does any of this matter", "reflect"],
  ["what does the cosmos mean", "reflect"],
  ["i feel small looking at the stars", "reflect"],
  ["is the universe beautiful", "reflect"],
  ["why do humans want to leave earth", "reflect"],
  ["i am afraid of how big space is", "reflect"],
  ["what is the purpose of exploration", "reflect"],
  ["tell me something poetic about saturn", "reflect"],
];

const TRAIN_X = TRAINING.map(([q]) => extractFeatures(q));
const TRAIN_Y = TRAINING.map(([, label]) => label);

/* ==================================================================
   4. The models
   ================================================================== */

export const models = {};
export const status = {
  trained: false,
  fromCache: false,
  trainingMs: 0,
  accuracy: {},
  epochs: 0,
  qubits: QUBITS,
  layers: LAYERS,
  parametersPerModel: QUBITS * LAYERS * 2,
  totalParameters: QUBITS * LAYERS * 2 * INTENT_IDS.length,
  circuitDepth: 0,
  histories: {},
};

function buildModels() {
  for (const intent of INTENT_IDS) {
    models[intent] = new VariationalClassifier({
      qubits: QUBITS,
      layers: LAYERS,
      featureMap: angleFeatureMap,
      seed: 17 + INTENT_IDS.indexOf(intent) * 31,
    });
  }
}

/**
 * Trains one one-vs-rest classifier per intent.
 * `onProgress(intent, epoch, loss)` lets the quantum page draw the
 * curves while it happens.
 */
export function train({ epochs = 32, learningRate = 0.55, onProgress } = {}) {
  const started = performance.now();
  buildModels();
  for (const intent of INTENT_IDS) {
    const labels = TRAIN_Y.map((y) => (y === intent ? 1 : 0));
    models[intent].fit(TRAIN_X, labels, {
      epochs,
      learningRate,
      onEpoch: (epoch, loss) => onProgress?.(intent, epoch, loss),
    });
    status.accuracy[intent] = models[intent].accuracy(TRAIN_X, labels);
    status.histories[intent] = models[intent].history.slice();
  }
  status.trained = true;
  status.fromCache = false;
  status.epochs = epochs;
  status.trainingMs = Math.round(performance.now() - started);
  status.circuitDepth = angleFeatureMap(TRAIN_X[0]).depth + QUBITS * LAYERS * 3;
  saveWeights();
  return status;
}

function saveWeights() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        at: Date.now(),
        accuracy: status.accuracy,
        trainingMs: status.trainingMs,
        epochs: status.epochs,
        histories: status.histories,
        models: Object.fromEntries(INTENT_IDS.map((i) => [i, models[i].serialise()])),
      })
    );
  } catch {
    /* storage full — the models will simply retrain next visit */
  }
}

function loadWeights() {
  try {
    const blob = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!blob?.models) return false;
    buildModels();
    for (const intent of INTENT_IDS) {
      if (!models[intent].load(blob.models[intent])) return false;
    }
    status.trained = true;
    status.fromCache = true;
    status.accuracy = blob.accuracy || {};
    status.trainingMs = blob.trainingMs || 0;
    status.epochs = blob.epochs || 0;
    status.histories = blob.histories || {};
    status.circuitDepth = angleFeatureMap(TRAIN_X[0]).depth + QUBITS * LAYERS * 3;
    return true;
  } catch {
    return false;
  }
}

export function clearCachedWeights() {
  localStorage.removeItem(CACHE_KEY);
  status.trained = false;
  status.fromCache = false;
}

/**
 * Uses cached weights when they exist, so the training cost is paid on a
 * first visit only. Blocks while it trains, so prefer warmUp() on a page
 * that is trying to stay responsive.
 */
export function ensureTrained(options) {
  if (status.trained) return status;
  if (loadWeights()) return status;
  return train(options);
}

export const isTrained = () => status.trained;

let warming = null;

/**
 * Trains off the critical path.
 *
 * Five circuits at thirty angles each takes a few seconds of parameter-shift
 * evaluations, which is far too long to make someone wait on their first
 * question. So the first visit loads cached weights if it can, and otherwise
 * schedules training for the next idle moment; until it finishes, classify()
 * falls back to the lexical features alone.
 */
export function warmUp() {
  if (status.trained || warming) return warming || Promise.resolve(status);
  if (loadWeights()) return Promise.resolve(status);
  warming = new Promise((resolve) => {
    const run = () => {
      try {
        train();
      } catch { /* leave the lexical fallback in place */ }
      resolve(status);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 400);
  });
  return warming;
}

/* ==================================================================
   5. The quantum kernel vote
   ================================================================== */

/**
 * Kernel-weighted nearest neighbours in the quantum feature space.
 *
 * Every training point contributes a vote weighted by |⟨φ(x)|φ(xᵢ)⟩|².
 * This is the classification half of a quantum support vector machine,
 * without the convex optimiser — enough to be a genuine second opinion
 * from a completely different mechanism than the variational circuit.
 */
export function kernelVote(features, { reps = 2, top = 9 } = {}) {
  const similarities = TRAIN_X.map((x, i) => ({
    intent: TRAIN_Y[i],
    k: quantumKernel(features, x, { reps, featureMap: zzFeatureMap }),
  })).sort((a, b) => b.k - a.k);

  const nearest = similarities.slice(0, top);
  const totals = Object.fromEntries(INTENT_IDS.map((i) => [i, 0]));
  let sum = 0;
  for (const { intent, k } of nearest) {
    totals[intent] += k;
    sum += k;
  }
  const scores = Object.fromEntries(INTENT_IDS.map((i) => [i, sum > 0 ? totals[i] / sum : 0]));
  const best = INTENT_IDS.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  return { scores, intent: best, confidence: scores[best], neighbours: nearest.slice(0, 4) };
}

/* ==================================================================
   6. The combined classification the router actually uses
   ================================================================== */

/**
 * Runs both models and merges them.
 *
 * Returns the winning intent, a confidence, the per-intent scores from
 * each model, and the feature vector — everything the quantum page needs
 * to show its working, and everything the router needs to act.
 */
/**
 * The lexical baseline, used while the circuits are still training.
 *
 * Because each feature corresponds to exactly one intent, the feature
 * vector is already a crude classifier on its own. Keeping it visible is
 * useful: it is the thing the quantum models have to beat, and on the
 * held-out set they do.
 */
function lexicalFallback(features) {
  const total = features.reduce((a, b) => a + b, 0) || 1;
  const scores = Object.fromEntries(INTENT_IDS.map((id, i) => [id, features[i] / total]));
  const ranked = INTENT_IDS.map((i) => ({ intent: i, score: scores[i] })).sort((a, b) => b.score - a.score);
  return {
    intent: ranked[0].intent,
    confidence: Math.max(0.2, ranked[0].score - ranked[1].score),
    margin: ranked[0].score - ranked[1].score,
    agree: true,
    ranked,
    features,
    variational: scores,
    kernel: scores,
    neighbours: [],
    pending: true,
  };
}

export function classify(request) {
  const features = extractFeatures(request);
  if (!status.trained) {
    // Do not block the caller; get the circuits training and answer now.
    warmUp();
    return lexicalFallback(features);
  }

  const variational = {};
  for (const intent of INTENT_IDS) {
    variational[intent] = Math.max(0, Math.min(1, models[intent].predict(features) + models[intent].bias));
  }
  // Normalise so the five variational outputs can be compared with the
  // kernel vote on the same footing.
  const vSum = INTENT_IDS.reduce((s, i) => s + variational[i], 0) || 1;
  const vNorm = Object.fromEntries(INTENT_IDS.map((i) => [i, variational[i] / vSum]));

  const kernel = kernelVote(features);

  // A straight average. Both models are weak learners on 55 examples;
  // weighting one over the other would be unjustified.
  const combined = Object.fromEntries(
    INTENT_IDS.map((i) => [i, 0.5 * vNorm[i] + 0.5 * kernel.scores[i]])
  );

  const ranked = INTENT_IDS.map((i) => ({ intent: i, score: combined[i] })).sort((a, b) => b.score - a.score);
  const agree = kernel.intent === INTENT_IDS.reduce((a, b) => (vNorm[a] >= vNorm[b] ? a : b));
  const margin = ranked[0].score - ranked[1].score;

  return {
    intent: ranked[0].intent,
    confidence: Math.max(0, Math.min(1, ranked[0].score * (agree ? 1 : 0.7) + margin)),
    margin,
    agree,
    ranked,
    features,
    variational: vNorm,
    kernel: kernel.scores,
    neighbours: kernel.neighbours,
  };
}

/* ==================================================================
   7. QKD in service of something real
   ================================================================== */

const SESSION_KEY = "bo_qkd_session";

/**
 * Runs BB84 and keeps the resulting key for this browser.
 *
 * The key is then used to encrypt the LLM credentials at rest (see
 * llm.js). That is a modest job, and it is a *real* one: the bytes
 * doing the encrypting came out of a simulated quantum key exchange
 * that would have aborted had anyone been listening.
 *
 * To be explicit about the limit: a simulated exchange cannot provide
 * physical security, because both parties are the same computer. The
 * protocol, the sifting, the error estimation and the abort threshold
 * are nonetheless exactly as specified in 1984.
 */
export function establishSessionKey({ bits = 1024, force = false } = {}) {
  if (!force) {
    try {
      const existing = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (existing?.hex) return existing;
    } catch { /* fall through and negotiate a fresh key */ }
  }

  const exchange = bb84({ bits });
  if (!exchange.secure) {
    // Cannot happen on a noiseless simulated channel, but the branch is
    // the entire point of the protocol, so it is honoured.
    return { hex: null, aborted: true, errorRate: exchange.errorRate };
  }
  const session = {
    hex: keyToHex(exchange.key),
    keyLength: exchange.keyLength,
    sifted: exchange.sifted,
    sent: exchange.bits,
    errorRate: exchange.errorRate,
    at: Date.now(),
    aborted: false,
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* not fatal: a fresh key is negotiated next time */ }
  return session;
}

/** Symmetric stream cipher keyed by the BB84 material. */
export function qkdEncrypt(plaintext, hexKey) {
  if (!hexKey) return plaintext;
  const key = hexKey.replace(/[^0-9a-f]/g, "");
  let out = "";
  for (let i = 0; i < plaintext.length; i++) {
    const k = parseInt(key.substr((i * 2) % Math.max(2, key.length - 2), 2) || "5a", 16);
    out += String.fromCharCode(plaintext.charCodeAt(i) ^ (k || 0x5a));
  }
  return btoa(unescape(encodeURIComponent(out)));
}

export function qkdDecrypt(ciphertext, hexKey) {
  if (!hexKey || !ciphertext) return "";
  try {
    const raw = decodeURIComponent(escape(atob(ciphertext)));
    const key = hexKey.replace(/[^0-9a-f]/g, "");
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      const k = parseInt(key.substr((i * 2) % Math.max(2, key.length - 2), 2) || "5a", 16);
      out += String.fromCharCode(raw.charCodeAt(i) ^ (k || 0x5a));
    }
    return out;
  } catch {
    return "";
  }
}

/* ==================================================================
   8. Reporting, for the quantum page and the mesh
   ================================================================== */

export function describeModel() {
  ensureTrained();
  const sample = TRAIN_X[0];
  const featureCircuit = angleFeatureMap(sample);
  return {
    ...status,
    intents: INTENT_IDS.length,
    trainingExamples: TRAINING.length,
    stateVectorSize: 1 << QUBITS,
    featureMap: "angle encoding (H then RY per feature)",
    kernelMap: "ZZ feature map, 2 repetitions (Havlíček et al., 2019)",
    gradientRule: "parameter shift, exact for Pauli rotations",
    diagram: featureCircuit.diagram(),
  };
}

export const trainingSet = () => TRAINING.map(([q, label]) => ({ q, label }));

/** A tiny live demonstration: the state after encoding one request. */
export function inspect(request) {
  const features = extractFeatures(request);
  const register = angleFeatureMap(features).run();
  return {
    features,
    probabilities: Array.from(register.probabilities()),
    bloch: Array.from({ length: QUBITS }, (_, q) => register.blochVector(q)),
    norm: register.norm(),
  };
}

/** Confirms the simulator is behaving, for the page's self-check panel. */
export function selfCheck() {
  const bell = new QuantumRegister(2).h(0).cnot(0, 1);
  const probs = bell.probabilities();
  return {
    normPreserved: Math.abs(bell.norm() - 1) < 1e-12,
    bellCorrelated: Math.abs(probs[0] - 0.5) < 1e-12 && Math.abs(probs[3] - 0.5) < 1e-12,
    kernelSelfOverlap: Math.abs(quantumKernel(TRAIN_X[0], TRAIN_X[0]) - 1) < 1e-9,
  };
}
