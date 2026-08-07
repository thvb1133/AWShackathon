/* ============================================================
   quantum.js — a real quantum computing simulator.

   Be clear about what this is. There is no quantum processor in a
   web browser, so this is a *state-vector simulator*: it holds the
   full complex amplitude vector of an n-qubit register and applies
   unitary gates to it exactly. The algorithms below — the quantum
   feature maps, the kernel estimation, the parameter-shift
   gradients, the BB84 key exchange — are the genuine algorithms.
   Run them on real hardware and the mathematics is identical; you
   would simply get shot noise and decoherence for free.

   Nothing here is decoration. The variational classifier trained in
   qml.js routes requests in the agent mesh, and the BB84 key
   produced here encrypts the LLM credentials at rest.

   Amplitudes are stored interleaved [re0, im0, re1, im1, …] in a
   single Float64Array, which keeps gate application cache-friendly.
   ============================================================ */

export const SQRT1_2 = Math.SQRT1_2;

/* ==================================================================
   1. The register
   ================================================================== */

export class QuantumRegister {
  /** @param {number} qubits number of qubits; the state has 2^n amplitudes */
  constructor(qubits) {
    if (qubits < 1 || qubits > 20) throw new Error("Use between 1 and 20 qubits");
    this.n = qubits;
    this.size = 1 << qubits;
    this.amp = new Float64Array(this.size * 2);
    this.reset();
  }

  /** Collapses back to |00…0⟩. */
  reset() {
    this.amp.fill(0);
    this.amp[0] = 1;
    return this;
  }

  clone() {
    const copy = new QuantumRegister(this.n);
    copy.amp.set(this.amp);
    return copy;
  }

  /**
   * Applies an arbitrary single-qubit unitary to one qubit.
   * The matrix is [[a, b], [c, d]] with each entry a [re, im] pair.
   */
  apply1(target, [[ar, ai], [br, bi], [cr, ci], [dr, di]]) {
    const stride = 1 << target;
    const amp = this.amp;
    for (let block = 0; block < this.size; block += stride << 1) {
      for (let offset = 0; offset < stride; offset++) {
        const i0 = (block + offset) << 1;
        const i1 = (block + offset + stride) << 1;
        const x0r = amp[i0], x0i = amp[i0 + 1];
        const x1r = amp[i1], x1i = amp[i1 + 1];
        amp[i0] = ar * x0r - ai * x0i + br * x1r - bi * x1i;
        amp[i0 + 1] = ar * x0i + ai * x0r + br * x1i + bi * x1r;
        amp[i1] = cr * x0r - ci * x0i + dr * x1r - di * x1i;
        amp[i1 + 1] = cr * x0i + ci * x0r + dr * x1i + di * x1r;
      }
    }
    return this;
  }

  /* ---------------------------------------------------- gate set */

  /** Hadamard: the gate that creates superposition. */
  h(t) {
    return this.apply1(t, [[SQRT1_2, 0], [SQRT1_2, 0], [SQRT1_2, 0], [-SQRT1_2, 0]]);
  }

  x(t) { return this.apply1(t, [[0, 0], [1, 0], [1, 0], [0, 0]]); }
  y(t) { return this.apply1(t, [[0, 0], [0, -1], [0, 1], [0, 0]]); }
  z(t) { return this.apply1(t, [[1, 0], [0, 0], [0, 0], [-1, 0]]); }
  s(t) { return this.apply1(t, [[1, 0], [0, 0], [0, 0], [0, 1]]); }
  t(target) { return this.apply1(target, [[1, 0], [0, 0], [0, 0], [SQRT1_2, SQRT1_2]]); }

  /** Rotation about X by θ radians. */
  rx(target, theta) {
    const c = Math.cos(theta / 2);
    const s = -Math.sin(theta / 2);
    return this.apply1(target, [[c, 0], [0, s], [0, s], [c, 0]]);
  }

  /** Rotation about Y — the workhorse of variational circuits. */
  ry(target, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    return this.apply1(target, [[c, 0], [-s, 0], [s, 0], [c, 0]]);
  }

  /** Rotation about Z: a relative phase between |0⟩ and |1⟩. */
  rz(target, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    return this.apply1(target, [[c, -s], [0, 0], [0, 0], [c, s]]);
  }

  /** Global-phase-free phase gate, as used in the ZZ feature map. */
  p(target, lambda) {
    return this.apply1(target, [[1, 0], [0, 0], [0, 0], [Math.cos(lambda), Math.sin(lambda)]]);
  }

  /** Controlled-NOT: the gate that creates entanglement. */
  cnot(control, target) {
    const amp = this.amp;
    const cBit = 1 << control;
    const tBit = 1 << target;
    for (let i = 0; i < this.size; i++) {
      // Visit each pair once, only when the control is set.
      if ((i & cBit) === 0 || (i & tBit) !== 0) continue;
      const j = i | tBit;
      const a = i << 1;
      const b = j << 1;
      const tr = amp[a], ti = amp[a + 1];
      amp[a] = amp[b];
      amp[a + 1] = amp[b + 1];
      amp[b] = tr;
      amp[b + 1] = ti;
    }
    return this;
  }

  /** Controlled-Z. Symmetric in its two arguments. */
  cz(control, target) {
    const amp = this.amp;
    const mask = (1 << control) | (1 << target);
    for (let i = 0; i < this.size; i++) {
      if ((i & mask) !== mask) continue;
      amp[i << 1] = -amp[i << 1];
      amp[(i << 1) + 1] = -amp[(i << 1) + 1];
    }
    return this;
  }

  /** Controlled phase rotation, the entangler of the ZZ feature map. */
  crz(control, target, theta) {
    const amp = this.amp;
    const cBit = 1 << control;
    const tBit = 1 << target;
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    for (let i = 0; i < this.size; i++) {
      if ((i & cBit) === 0) continue;
      const set = (i & tBit) !== 0;
      const cr = c;
      const ci = set ? s : -s;
      const re = amp[i << 1];
      const im = amp[(i << 1) + 1];
      amp[i << 1] = cr * re - ci * im;
      amp[(i << 1) + 1] = cr * im + ci * re;
    }
    return this;
  }

  swap(a, b) {
    return this.cnot(a, b).cnot(b, a).cnot(a, b);
  }

  /* --------------------------------------------- reading it out */

  /** Probability of each basis state. */
  probabilities() {
    const out = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) {
      const re = this.amp[i << 1];
      const im = this.amp[(i << 1) + 1];
      out[i] = re * re + im * im;
    }
    return out;
  }

  /** Probability that a single qubit reads 1. */
  probabilityOne(qubit) {
    const bit = 1 << qubit;
    let p = 0;
    for (let i = 0; i < this.size; i++) {
      if ((i & bit) === 0) continue;
      const re = this.amp[i << 1];
      const im = this.amp[(i << 1) + 1];
      p += re * re + im * im;
    }
    return p;
  }

  /**
   * Expectation value of the Pauli-Z observable on one qubit:
   * ⟨Z⟩ = P(0) − P(1), which lands in [−1, +1].
   * This is what a variational classifier reads as its output.
   */
  expectationZ(qubit) {
    return 1 - 2 * this.probabilityOne(qubit);
  }

  /** Probability of the all-zeros outcome — used for kernel estimation. */
  probabilityAllZero() {
    const re = this.amp[0];
    const im = this.amp[1];
    return re * re + im * im;
  }

  /**
   * A projective measurement of every qubit, collapsing the state.
   * Returns the observed bit string, least-significant qubit first.
   */
  measureAll(random = Math.random) {
    const probs = this.probabilities();
    let r = random();
    let outcome = probs.length - 1;
    for (let i = 0; i < probs.length; i++) {
      r -= probs[i];
      if (r <= 0) { outcome = i; break; }
    }
    this.amp.fill(0);
    this.amp[outcome << 1] = 1;
    return Array.from({ length: this.n }, (_, q) => (outcome >> q) & 1);
  }

  /** Measures one qubit, collapses the register, returns 0 or 1. */
  measure(qubit, random = Math.random) {
    const p1 = this.probabilityOne(qubit);
    const bit = 1 << qubit;
    const result = random() < p1 ? 1 : 0;
    const keep = result === 1 ? p1 : 1 - p1;
    const norm = keep > 1e-12 ? 1 / Math.sqrt(keep) : 0;
    for (let i = 0; i < this.size; i++) {
      const matches = ((i & bit) !== 0 ? 1 : 0) === result;
      if (matches) {
        this.amp[i << 1] *= norm;
        this.amp[(i << 1) + 1] *= norm;
      } else {
        this.amp[i << 1] = 0;
        this.amp[(i << 1) + 1] = 0;
      }
    }
    return result;
  }

  /** Repeated sampling, the way a real device reports counts. */
  sample(shots = 1024, random = Math.random) {
    const probs = this.probabilities();
    const counts = new Map();
    for (let s = 0; s < shots; s++) {
      let r = random();
      let outcome = probs.length - 1;
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) { outcome = i; break; }
      }
      const key = outcome.toString(2).padStart(this.n, "0");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  /** Bloch-sphere coordinates of one qubit, for the visualiser. */
  blochVector(qubit) {
    // ⟨X⟩ and ⟨Y⟩ need the off-diagonal terms of the reduced density matrix.
    const bit = 1 << qubit;
    let xr = 0, yi = 0;
    for (let i = 0; i < this.size; i++) {
      if ((i & bit) !== 0) continue;
      const j = i | bit;
      const a0r = this.amp[i << 1], a0i = this.amp[(i << 1) + 1];
      const a1r = this.amp[j << 1], a1i = this.amp[(j << 1) + 1];
      // ρ01 = Σ a0 · conj(a1)
      xr += a0r * a1r + a0i * a1i;
      yi += a0i * a1r - a0r * a1i;
    }
    // ⟨X⟩ = 2·Re(ρ01) but ⟨Y⟩ = −2·Im(ρ01): the minus comes from
    // Tr(ρY) = i(ρ01 − ρ10). Without it, S|+⟩ points at −Y.
    return { x: 2 * xr, y: -2 * yi, z: this.expectationZ(qubit) };
  }

  /** Total probability — should always be 1. A cheap correctness check. */
  norm() {
    let sum = 0;
    for (let i = 0; i < this.amp.length; i++) sum += this.amp[i] * this.amp[i];
    return sum;
  }
}

/* ==================================================================
   2. Circuits — a recorded gate list, so it can be drawn and inverted
   ================================================================== */

export class QuantumCircuit {
  constructor(qubits) {
    this.n = qubits;
    this.ops = [];
  }

  add(gate, qubits, param) {
    this.ops.push({ gate, qubits: Array.isArray(qubits) ? qubits : [qubits], param });
    return this;
  }

  h(q) { return this.add("h", q); }
  x(q) { return this.add("x", q); }
  z(q) { return this.add("z", q); }
  rx(q, t) { return this.add("rx", q, t); }
  ry(q, t) { return this.add("ry", q, t); }
  rz(q, t) { return this.add("rz", q, t); }
  p(q, t) { return this.add("p", q, t); }
  cnot(c, t) { return this.add("cnot", [c, t]); }
  cz(c, t) { return this.add("cz", [c, t]); }
  crz(c, t, theta) { return this.add("crz", [c, t], theta); }

  /** Runs the circuit onto a register (a fresh |0…0⟩ unless given one). */
  run(register = new QuantumRegister(this.n)) {
    for (const op of this.ops) {
      const [a, b] = op.qubits;
      switch (op.gate) {
        case "h": register.h(a); break;
        case "x": register.x(a); break;
        case "y": register.y(a); break;
        case "z": register.z(a); break;
        case "s": register.s(a); break;
        case "t": register.t(a); break;
        case "rx": register.rx(a, op.param); break;
        case "ry": register.ry(a, op.param); break;
        case "rz": register.rz(a, op.param); break;
        case "p": register.p(a, op.param); break;
        case "cnot": register.cnot(a, b); break;
        case "cz": register.cz(a, b); break;
        case "crz": register.crz(a, b, op.param); break;
        default: throw new Error(`Unknown gate ${op.gate}`);
      }
    }
    return register;
  }

  /**
   * The adjoint circuit U†: reverse the order and negate every rotation.
   * Needed for the kernel trick — U(x)†U(x') on |0⟩ gives the overlap.
   */
  inverse() {
    const inv = new QuantumCircuit(this.n);
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i];
      const signFlipped = ["rx", "ry", "rz", "p", "crz"].includes(op.gate);
      inv.ops.push({ ...op, param: signFlipped ? -op.param : op.param });
    }
    return inv;
  }

  /** Concatenates another circuit onto this one. */
  compose(other) {
    for (const op of other.ops) this.ops.push({ ...op });
    return this;
  }

  get depth() { return this.ops.length; }

  /** A compact text drawing, one line per qubit. */
  diagram() {
    const lines = Array.from({ length: this.n }, () => []);
    for (const op of this.ops) {
      const [a, b] = op.qubits;
      const label = op.param === undefined
        ? op.gate.toUpperCase()
        : `${op.gate.toUpperCase()}(${op.param.toFixed(2)})`;
      for (let q = 0; q < this.n; q++) {
        if (q === a) lines[q].push(b !== undefined ? "●" : label);
        else if (q === b) lines[q].push(op.gate === "cnot" ? "⊕" : label);
        else lines[q].push("─".repeat(Math.min(3, label.length)));
      }
    }
    return lines.map((cells, q) => `q${q}: ─${cells.join("─")}─`).join("\n");
  }
}

/* ==================================================================
   3. Feature maps — how classical data enters a quantum state
   ================================================================== */

/**
 * The ZZ feature map of Havlíček et al. (Nature, 2019). Angle-encodes
 * each feature, then entangles every pair with a rotation proportional
 * to the product of the two features. That product term is what makes
 * the resulting kernel hard to compute classically.
 */
export function zzFeatureMap(x, { reps = 2 } = {}) {
  const n = x.length;
  const circuit = new QuantumCircuit(n);
  for (let r = 0; r < reps; r++) {
    for (let q = 0; q < n; q++) {
      circuit.h(q);
      circuit.rz(q, 2 * x[q]);
    }
    for (let a = 0; a < n - 1; a++) {
      for (let b = a + 1; b < n; b++) {
        const phi = 2 * (Math.PI - x[a]) * (Math.PI - x[b]);
        circuit.cnot(a, b);
        circuit.rz(b, phi);
        circuit.cnot(a, b);
      }
    }
  }
  return circuit;
}

/** The simpler angle-encoding map: one RY per feature. Cheap and shallow. */
export function angleFeatureMap(x) {
  const circuit = new QuantumCircuit(x.length);
  for (let q = 0; q < x.length; q++) {
    circuit.h(q);
    circuit.ry(q, x[q]);
  }
  return circuit;
}

/* ==================================================================
   4. Quantum kernel estimation
   ================================================================== */

/**
 * The quantum kernel K(x, x') = |⟨φ(x)|φ(x')⟩|².
 *
 * Computed the way a real device would: prepare |φ(x')⟩, apply the
 * adjoint of the map for x, and read the probability of measuring
 * all zeros. On hardware you would estimate that probability from
 * shot counts; here it is exact.
 */
export function quantumKernel(a, b, { reps = 2, featureMap = zzFeatureMap } = {}) {
  const forward = featureMap(b, { reps });
  const backward = featureMap(a, { reps }).inverse();
  const register = forward.run();
  backward.run(register);
  return register.probabilityAllZero();
}

/** The full Gram matrix for a data set. Symmetric, ones on the diagonal. */
export function kernelMatrix(data, options) {
  const n = data.length;
  const K = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    K[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const k = quantumKernel(data[i], data[j], options);
      K[i][j] = k;
      K[j][i] = k;
    }
  }
  return K;
}

/* ==================================================================
   5. The variational quantum classifier
   ================================================================== */

/**
 * A hardware-efficient ansatz: layers of RY and RZ rotations on every
 * qubit, separated by a ring of CNOTs. This is the standard shape used
 * on today's superconducting devices because it needs only
 * nearest-neighbour coupling.
 */
export function variationalAnsatz(n, layers, params) {
  const circuit = new QuantumCircuit(n);
  let p = 0;
  for (let l = 0; l < layers; l++) {
    for (let q = 0; q < n; q++) {
      circuit.ry(q, params[p++]);
      circuit.rz(q, params[p++]);
    }
    for (let q = 0; q < n; q++) circuit.cnot(q, (q + 1) % n);
  }
  return circuit;
}

export const ansatzParameterCount = (n, layers) => n * layers * 2;

/**
 * A binary classifier: encode x, apply the trainable ansatz, read ⟨Z⟩
 * on qubit 0. Trained by the parameter-shift rule, which is how
 * gradients are actually obtained on quantum hardware — you cannot
 * backpropagate through a physical device, but you *can* evaluate the
 * same circuit at θ ± π/2 and take the difference.
 */
export class VariationalClassifier {
  constructor({ qubits, layers = 2, featureMap = angleFeatureMap, seed = 7 }) {
    this.n = qubits;
    this.layers = layers;
    this.featureMap = featureMap;
    this.params = new Float64Array(ansatzParameterCount(qubits, layers));
    // A small deterministic spread: identical starting points would keep
    // every qubit symmetric and the gradient would vanish.
    let state = seed;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = 0; i < this.params.length; i++) this.params[i] = (rand() - 0.5) * Math.PI;
    this.bias = 0;
    this.history = [];
  }

  /** Raw circuit output in [−1, +1]. */
  forward(x, params = this.params) {
    const register = this.featureMap(x).run();
    variationalAnsatz(this.n, this.layers, params).run(register);
    return register.expectationZ(0);
  }

  /** Squashed to a probability in [0, 1]. */
  predict(x) {
    return (this.forward(x) + 1) / 2;
  }

  /**
   * ∂⟨Z⟩/∂θᵏ = ½[f(θᵏ + π/2) − f(θᵏ − π/2)].
   * Exact for the Pauli-rotation generators used above — not an
   * approximation, and the reason variational circuits are trainable.
   */
  parameterShiftGradient(x, index) {
    const shifted = Float64Array.from(this.params);
    shifted[index] += Math.PI / 2;
    const plus = this.forward(x, shifted);
    shifted[index] -= Math.PI;
    const minus = this.forward(x, shifted);
    return 0.5 * (plus - minus);
  }

  /**
   * Gradient descent on the mean squared error against labels in {0, 1}.
   * `onEpoch` receives the loss so a page can draw the training curve.
   */
  fit(samples, labels, { epochs = 30, learningRate = 0.35, onEpoch } = {}) {
    for (let epoch = 0; epoch < epochs; epoch++) {
      const grad = new Float64Array(this.params.length);
      let biasGrad = 0;
      let loss = 0;

      for (let i = 0; i < samples.length; i++) {
        const raw = this.forward(samples[i]);
        const output = (raw + 1) / 2 + this.bias;
        const error = output - labels[i];
        loss += error * error;
        // d(output)/d(raw) = 1/2, folded into the chain rule below.
        for (let k = 0; k < this.params.length; k++) {
          grad[k] += error * this.parameterShiftGradient(samples[i], k);
        }
        biasGrad += error;
      }

      const scale = (2 * learningRate) / samples.length;
      for (let k = 0; k < this.params.length; k++) this.params[k] -= scale * grad[k];
      this.bias -= scale * biasGrad * 0.5;

      const meanLoss = loss / samples.length;
      this.history.push(meanLoss);
      onEpoch?.(epoch, meanLoss, this);
      if (meanLoss < 1e-4) break;
    }
    return this;
  }

  accuracy(samples, labels) {
    let right = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = this.predict(samples[i]) + this.bias;
      if ((p >= 0.5 ? 1 : 0) === labels[i]) right++;
    }
    return right / samples.length;
  }

  /** Weights are cached so the training only happens on a first visit. */
  serialise() {
    return { n: this.n, layers: this.layers, params: Array.from(this.params), bias: this.bias, history: this.history };
  }

  load(blob) {
    if (blob?.n !== this.n || blob?.layers !== this.layers) return false;
    this.params = Float64Array.from(blob.params);
    this.bias = blob.bias || 0;
    this.history = blob.history || [];
    return true;
  }
}

/* ==================================================================
   6. BB84 quantum key distribution
   ================================================================== */

/**
 * Bennett & Brassard, 1984 — the first quantum cryptographic protocol,
 * and the one the Micius satellite flew in 2016.
 *
 * Alice sends each bit encoded in a randomly chosen basis. Bob measures
 * in his own randomly chosen basis. Where the bases happen to agree,
 * their bits agree; those positions become the key. Where they differ,
 * the outcome is random and is thrown away.
 *
 * The security is physical, not mathematical. If Eve intercepts and
 * measures, she must guess a basis too, and every wrong guess randomises
 * the qubit she forwards. That shows up as a ~25% error rate in the
 * sifted key, so eavesdropping cannot be hidden — it announces itself.
 *
 * Every qubit below is actually simulated: prepared, rotated, measured.
 */
export function bb84({ bits = 256, eavesdropper = false, channelNoise = 0, random = Math.random } = {}) {
  const aliceBits = [];
  const aliceBases = [];
  const bobBases = [];
  const bobBits = [];
  const eveBases = [];
  const eveBits = [];

  for (let i = 0; i < bits; i++) {
    const bit = random() < 0.5 ? 0 : 1;
    const aliceBasis = random() < 0.5 ? 0 : 1; // 0 = rectilinear (Z), 1 = diagonal (X)
    const bobBasis = random() < 0.5 ? 0 : 1;

    // Alice prepares the qubit.
    const q = new QuantumRegister(1);
    if (bit === 1) q.x(0);
    if (aliceBasis === 1) q.h(0);

    // Eve intercepts, measures in her own basis, and re-prepares.
    if (eavesdropper) {
      const eveBasis = random() < 0.5 ? 0 : 1;
      if (eveBasis === 1) q.h(0);
      const eveBit = q.measure(0, random);
      if (eveBasis === 1) q.h(0);
      eveBases.push(eveBasis);
      eveBits.push(eveBit);
    }

    /* A depolarising channel: with probability p, one of the three Pauli
       errors strikes. A plain bit flip would be invisible in the diagonal
       basis (X|±⟩ = ±|±⟩), which would understate the damage; depolarising
       noise corrupts both bases equally, as a real fibre or free-space
       link does. */
    if (channelNoise > 0 && random() < channelNoise) {
      const pauli = Math.floor(random() * 3);
      if (pauli === 0) q.x(0);
      else if (pauli === 1) q.y(0);
      else q.z(0);
    }

    // Bob measures.
    if (bobBasis === 1) q.h(0);
    const bobBit = q.measure(0, random);

    aliceBits.push(bit);
    aliceBases.push(aliceBasis);
    bobBases.push(bobBasis);
    bobBits.push(bobBit);
  }

  // Sifting: keep only the positions where the bases matched.
  const kept = [];
  for (let i = 0; i < bits; i++) if (aliceBases[i] === bobBases[i]) kept.push(i);

  // Parameter estimation: sacrifice a quarter of the sifted bits to
  // measure the error rate, exactly as the real protocol does.
  const sampleSize = Math.max(1, Math.floor(kept.length / 4));
  const checkIndices = kept.slice(0, sampleSize);
  const keyIndices = kept.slice(sampleSize);

  let mismatches = 0;
  for (const i of checkIndices) if (aliceBits[i] !== bobBits[i]) mismatches++;
  const errorRate = checkIndices.length ? mismatches / checkIndices.length : 0;

  const key = keyIndices.map((i) => aliceBits[i]);
  // The textbook abort threshold is 11%; below that, privacy
  // amplification can still distil a secret key.
  const secure = errorRate < 0.11;

  return {
    bits,
    sifted: kept.length,
    checked: checkIndices.length,
    keyLength: key.length,
    key,
    errorRate,
    secure,
    eavesdropper,
    channelNoise,
    /** Eve's information, for the demonstration only. */
    eveCorrect: eavesdropper
      ? keyIndices.filter((i) => eveBits[i] === aliceBits[i]).length / Math.max(1, keyIndices.length)
      : null,
    trace: kept.slice(0, 12).map((i) => ({
      index: i,
      aliceBit: aliceBits[i],
      basis: aliceBases[i] ? "diagonal ✕" : "rectilinear ＋",
      bobBit: bobBits[i],
      agreed: aliceBits[i] === bobBits[i],
    })),
  };
}

/** Packs a BB84 bit array into a hex string usable as a cipher key. */
export function keyToHex(bits) {
  let hex = "";
  for (let i = 0; i + 3 < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

/* ==================================================================
   7. Quantum randomness
   ================================================================== */

/**
 * A Hadamard on |0⟩ gives exactly 50/50, and measuring it is the
 * canonical quantum random number generator. Simulated here, so the
 * underlying entropy is still the browser's — but the circuit and the
 * measurement are the real thing.
 */
export function quantumRandomBits(count = 32) {
  const register = new QuantumRegister(1);
  const out = [];
  for (let i = 0; i < count; i++) {
    register.reset().h(0);
    out.push(register.measure(0));
  }
  return out;
}

/* ==================================================================
   8. A demonstration set, used by the quantum page
   ================================================================== */

/** Prepares a Bell pair and returns its state — the canonical entanglement demo. */
export function bellPair() {
  const q = new QuantumRegister(2);
  q.h(0).cnot(0, 1);
  return q;
}

/**
 * Grover's search over a 2^n space. Included because it is the clearest
 * demonstration that these are real amplitudes: the marked item's
 * amplitude genuinely grows with each iteration.
 */
export function grover(n, marked, iterations = null) {
  const register = new QuantumRegister(n);
  const size = 1 << n;
  const steps = iterations ?? Math.max(1, Math.floor((Math.PI / 4) * Math.sqrt(size)));
  const trace = [];

  for (let q = 0; q < n; q++) register.h(q);

  for (let it = 0; it < steps; it++) {
    // Oracle: flip the phase of the marked state.
    register.amp[marked << 1] *= -1;
    register.amp[(marked << 1) + 1] *= -1;

    // Diffusion: reflect about the mean amplitude.
    let meanRe = 0, meanIm = 0;
    for (let i = 0; i < size; i++) {
      meanRe += register.amp[i << 1];
      meanIm += register.amp[(i << 1) + 1];
    }
    meanRe /= size;
    meanIm /= size;
    for (let i = 0; i < size; i++) {
      register.amp[i << 1] = 2 * meanRe - register.amp[i << 1];
      register.amp[(i << 1) + 1] = 2 * meanIm - register.amp[(i << 1) + 1];
    }

    trace.push({ iteration: it + 1, probability: register.probabilities()[marked] });
  }

  return { register, trace, steps, probability: register.probabilities()[marked] };
}
