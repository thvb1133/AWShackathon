/* ============================================================
   optimizer.js — the satellite mission optimiser.

   This is venture #31 built as working software rather than
   described as a slide. The problem is the real one operators have:

     A satellite has a limited imaging budget in an orbit — power,
     downlink, thermal, agility. Far more targets are requested than
     can be served. Which subset do you fly?

   Formally that is a 0/1 knapsack with priorities and a capacity
   constraint, which is NP-hard and is exactly the shape that maps
   onto a QUBO. So it can be attacked three ways, and this module
   implements all three and then *measures* them against each other:

     1. Greedy      — sort by value density. Instant, often decent.
     2. Simulated annealing — a strong classical baseline.
     3. QAOA        — a real quantum approximate optimisation
                      algorithm on the state-vector simulator in
                      quantum.js: cost-phase separator, RX mixer,
                      parameter search, then sampling.

   The honest finding, stated in the interface and not buried: at the
   sizes a browser can simulate, classical wins on both quality and
   speed. QAOA is included because the *formulation* is what
   transfers to real hardware, and because a product that claims a
   quantum advantage should be able to show the comparison that
   justifies it. Selling the optimisation is honest. Selling the word
   "quantum" is not.
   ============================================================ */

import { QuantumRegister } from "./quantum.js";

/* ==================================================================
   1. The problem
   ================================================================== */

/**
 * A task the satellite could perform.
 * `value`    — mission priority, the thing being maximised.
 * `cost`     — consumption of the scarce resource (seconds of imaging,
 *              gigabits of downlink, watt-hours; the unit is yours).
 * `window`   — the orbit pass it must happen in, used for conflicts.
 */
export function makeTask(id, { name, value, cost, window = 0, lat = 0, lon = 0 }) {
  return { id, name, value, cost, window, lat, lon };
}

/** A reproducible pseudo-random problem, so demos are comparable. */
export function generateProblem({ count = 12, capacity = null, seed = 7 } = {}) {
  let state = seed >>> 0;
  const rand = () => {
    // xorshift32: small, fast, and deterministic across browsers.
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };

  const PLACES = [
    "Birmingham", "Rotterdam", "Singapore", "Lagos", "Santos", "Mumbai", "Shanghai", "Hamburg",
    "Los Angeles", "Durban", "Valparaíso", "Gdańsk", "Alexandria", "Perth", "Vancouver", "Chennai",
  ];
  const KINDS = ["flood extent", "port activity", "wildfire scan", "crop health", "construction site", "vessel sweep"];

  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(
      makeTask(i, {
        name: `${PLACES[i % PLACES.length]} — ${KINDS[Math.floor(rand() * KINDS.length)]}`,
        value: Math.round(10 + rand() * 90),          // priority 10..100
        cost: Math.round(5 + rand() * 45),            // resource units 5..50
        window: Math.floor(rand() * 4),               // one of four passes
        lat: Math.round((rand() * 140 - 70) * 10) / 10,
        lon: Math.round((rand() * 360 - 180) * 10) / 10,
      })
    );
  }

  const totalCost = tasks.reduce((sum, t) => sum + t.cost, 0);
  return {
    tasks,
    // Roughly 40% of everything requested can actually be flown, which
    // is the regime where the choice genuinely matters.
    capacity: capacity ?? Math.round(totalCost * 0.4),
    totalCost,
    totalValue: tasks.reduce((sum, t) => sum + t.value, 0),
  };
}

/** Scores a candidate selection. Over capacity is invalid, not merely poor. */
export function evaluate(problem, selection) {
  let value = 0;
  let cost = 0;
  for (let i = 0; i < problem.tasks.length; i++) {
    if (!selection[i]) continue;
    value += problem.tasks[i].value;
    cost += problem.tasks[i].cost;
  }
  return { value, cost, feasible: cost <= problem.capacity, chosen: selection.reduce((n, b) => n + b, 0) };
}

const emptySelection = (n) => new Array(n).fill(0);

/* ==================================================================
   2. Classical solvers
   ================================================================== */

/** Sort by value per unit cost and take what fits. Instant, and rarely silly. */
export function solveGreedy(problem) {
  const started = performance.now();
  const order = problem.tasks
    .map((task, index) => ({ index, density: task.value / task.cost }))
    .sort((a, b) => b.density - a.density);

  const selection = emptySelection(problem.tasks.length);
  let used = 0;
  for (const { index } of order) {
    const cost = problem.tasks[index].cost;
    if (used + cost <= problem.capacity) {
      selection[index] = 1;
      used += cost;
    }
  }
  return { name: "Greedy", selection, ...evaluate(problem, selection), ms: performance.now() - started };
}

/**
 * The exact answer by dynamic programming.
 *
 * Only run for small integer capacities, but when available it gives
 * the true optimum — which is the only fair yardstick for judging both
 * the annealer and QAOA. Without it, "our solver did well" is unfalsifiable.
 */
export function solveExact(problem, { maxStates = 2_000_000 } = {}) {
  const n = problem.tasks.length;
  const cap = problem.capacity;
  if (n * (cap + 1) > maxStates) return null;

  const started = performance.now();
  const best = new Float64Array(cap + 1);
  const keep = Array.from({ length: n }, () => new Uint8Array(cap + 1));

  for (let i = 0; i < n; i++) {
    const { value, cost } = problem.tasks[i];
    for (let c = cap; c >= cost; c--) {
      const candidate = best[c - cost] + value;
      if (candidate > best[c]) {
        best[c] = candidate;
        keep[i][c] = 1;
      }
    }
  }

  const selection = emptySelection(n);
  let c = cap;
  for (let i = n - 1; i >= 0; i--) {
    if (keep[i][c]) {
      selection[i] = 1;
      c -= problem.tasks[i].cost;
    }
  }
  return { name: "Exact (dynamic programming)", selection, ...evaluate(problem, selection), ms: performance.now() - started };
}

/**
 * Simulated annealing: the honest classical competitor.
 *
 * This is what a real product would ship. Any quantum claim has to
 * beat *this*, not a naive baseline chosen to make quantum look good.
 */
export function solveAnnealing(problem, { iterations = 20000, startTemp = 60, endTemp = 0.5, seed = 11 } = {}) {
  const started = performance.now();
  const n = problem.tasks.length;
  let state = seed >>> 0;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };

  let current = solveGreedy(problem).selection.slice();
  let currentScore = penalised(problem, current);
  let best = current.slice();
  let bestScore = currentScore;

  for (let step = 0; step < iterations; step++) {
    const temperature = startTemp * Math.pow(endTemp / startTemp, step / iterations);
    const flip = Math.floor(rand() * n);
    current[flip] ^= 1;
    const score = penalised(problem, current);

    if (score >= currentScore || rand() < Math.exp((score - currentScore) / temperature)) {
      currentScore = score;
      if (score > bestScore) {
        bestScore = score;
        best = current.slice();
      }
    } else {
      current[flip] ^= 1; // reject
    }
  }
  const plan = repair(problem, best);
  return { name: "Simulated annealing", selection: plan, ...evaluate(problem, plan), ms: performance.now() - started, iterations };
}

/**
 * The QUBO penalty weight, and why it is this value.
 *
 * An earlier version used a multiple of the best value-per-unit-cost.
 * That is too weak: the annealer discovered it could buy a high-value
 * target by going one unit over capacity and still come out ahead, so
 * it returned "better" plans the satellite physically cannot fly.
 *
 * The correct bound is λ > max(value). Proof: take any infeasible
 * selection with overflow δ ≥ 1 and drop one chosen task i. That loses
 * at most max(value) and reduces the overflow by at least one unit, so
 * whenever λ > max(value) the repaired plan always scores higher.
 * Feasibility therefore always wins, which is what a capacity
 * constraint means.
 */
const penaltyWeight = (problem) => Math.max(...problem.tasks.map((t) => t.value)) + 1;

/** Value minus a penalty for exceeding capacity — the QUBO objective. */
function penalised(problem, selection) {
  const { value, cost } = evaluate(problem, selection);
  const overflow = Math.max(0, cost - problem.capacity);
  return value - penaltyWeight(problem) * overflow;
}

/**
 * Guarantees a returned plan can actually be flown.
 *
 * The penalty above makes infeasibility unprofitable, but a heuristic
 * can still hand back an over-capacity plan if it stops early. A plan
 * that violates the constraint is worthless to an operator, so it is
 * repaired by dropping the worst value-per-cost tasks until it fits.
 */
function repair(problem, selection) {
  const fixed = selection.slice();
  let cost = problem.tasks.reduce((sum, t, i) => sum + (fixed[i] ? t.cost : 0), 0);
  if (cost <= problem.capacity) return fixed;

  const worstFirst = problem.tasks
    .map((task, index) => ({ index, density: task.value / task.cost }))
    .filter(({ index }) => fixed[index])
    .sort((a, b) => a.density - b.density);

  for (const { index } of worstFirst) {
    if (cost <= problem.capacity) break;
    fixed[index] = 0;
    cost -= problem.tasks[index].cost;
  }
  return fixed;
}

/* ==================================================================
   3. QAOA — the quantum solver
   ================================================================== */

/**
 * Builds the cost for every basis state.
 *
 * QAOA's phase separator is diagonal in the computational basis, so
 * for n qubits the whole cost Hamiltonian is just 2^n numbers. That is
 * exactly why this is tractable to simulate and exactly why the
 * formulation transfers unchanged to hardware.
 */
export function buildCostTable(problem, { clip = true } = {}) {
  const n = problem.tasks.length;
  const size = 1 << n;
  const costs = new Float64Array(size);
  for (let z = 0; z < size; z++) {
    const selection = emptySelection(n);
    for (let i = 0; i < n; i++) selection[i] = (z >> i) & 1;
    costs[z] = penalised(problem, selection);
  }
  if (!clip) return costs;

  /* Penalty clipping, and why it is necessary.
     The penalty that guarantees feasibility is large, so the worst
     infeasible states sit thousands of points below the best feasible
     one. The QAOA phase separator normalises by the total range, which
     meant every feasible state received almost the same phase and the
     algorithm concentrated worse than random guessing.
     Clipping the floor keeps infeasibility firmly unattractive while
     restoring the dynamic range across the states that actually
     compete. Ordering among feasible solutions is untouched. */
  let bestFeasible = -Infinity;
  let worstFeasible = Infinity;
  for (let z = 0; z < size; z++) {
    let cost = 0;
    for (let i = 0; i < n; i++) if ((z >> i) & 1) cost += problem.tasks[i].cost;
    if (cost > problem.capacity) continue;
    if (costs[z] > bestFeasible) bestFeasible = costs[z];
    if (costs[z] < worstFeasible) worstFeasible = costs[z];
  }
  const spread = Math.max(1, bestFeasible - worstFeasible);
  const floor = worstFeasible - spread * 0.5;
  for (let z = 0; z < size; z++) if (costs[z] < floor) costs[z] = floor;
  return costs;
}

/**
 * One QAOA layer stack, run on the real state-vector simulator.
 *
 *   |ψ⟩ = Π_p [ mixer(β_p) · phase(γ_p) ] H^⊗n |0⟩
 *
 * The phase separator multiplies each amplitude by e^{-iγC(z)}, which
 * is the genuine article for a diagonal cost Hamiltonian. The mixer is
 * an RX rotation on every qubit, exactly as in Farhi's formulation.
 */
export function runQaoa(costs, n, gammas, betas) {
  const register = new QuantumRegister(n);
  for (let q = 0; q < n; q++) register.h(q);

  const scale = 1 / (Math.max(...costs) - Math.min(...costs) || 1);

  for (let layer = 0; layer < gammas.length; layer++) {
    // Cost phase separator: diagonal, so applied amplitude by amplitude.
    const gamma = gammas[layer] * scale;
    for (let z = 0; z < costs.length; z++) {
      const angle = -gamma * costs[z];
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const re = register.amp[z << 1];
      const im = register.amp[(z << 1) + 1];
      register.amp[z << 1] = c * re - s * im;
      register.amp[(z << 1) + 1] = c * im + s * re;
    }
    // Mixer.
    for (let q = 0; q < n; q++) register.rx(q, 2 * betas[layer]);
  }
  return register;
}

/** Expectation of the cost under the QAOA state — the objective to maximise. */
function expectation(register, costs) {
  let total = 0;
  for (let z = 0; z < costs.length; z++) {
    const re = register.amp[z << 1];
    const im = register.amp[(z << 1) + 1];
    total += (re * re + im * im) * costs[z];
  }
  return total;
}

/**
 * The full quantum attempt: search the (γ, β) angles, then sample.
 *
 * Angle optimisation is done by random restarts plus coordinate
 * refinement rather than a gradient method, because the landscape is
 * notoriously non-convex and this is both simpler and more robust at
 * these depths.
 */
export function solveQaoa(problem, { layers = 2, restarts = 14, refineSteps = 22, shots = 2048, seed = 5 } = {}) {
  const n = problem.tasks.length;
  if (n > 16) {
    return {
      name: "QAOA",
      skipped: true,
      reason: `${n} tasks needs a ${2 ** n}-amplitude state vector. A browser simulates about 16 qubits; beyond that you need real hardware or a cluster.`,
    };
  }

  const started = performance.now();
  const costs = buildCostTable(problem);

  let state = seed >>> 0;
  const rand = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };

  let bestParams = null;
  let bestExpectation = -Infinity;

  for (let restart = 0; restart < restarts; restart++) {
    let gammas = Array.from({ length: layers }, () => rand() * Math.PI * 2);
    let betas = Array.from({ length: layers }, () => rand() * Math.PI);
    let value = expectation(runQaoa(costs, n, gammas, betas), costs);

    // Coordinate refinement: nudge one angle at a time, keep improvements.
    let stepSize = 0.6;
    for (let step = 0; step < refineSteps; step++) {
      let improved = false;
      for (let layer = 0; layer < layers; layer++) {
        for (const which of ["g", "b"]) {
          for (const direction of [1, -1]) {
            const trialG = gammas.slice();
            const trialB = betas.slice();
            if (which === "g") trialG[layer] += direction * stepSize;
            else trialB[layer] += direction * stepSize;
            const trial = expectation(runQaoa(costs, n, trialG, trialB), costs);
            if (trial > value) {
              value = trial;
              gammas = trialG;
              betas = trialB;
              improved = true;
            }
          }
        }
      }
      if (!improved) stepSize *= 0.6;
      if (stepSize < 0.02) break;
    }

    if (value > bestExpectation) {
      bestExpectation = value;
      bestParams = { gammas, betas };
    }
  }

  // Sample the optimised state the way a real device is read out.
  const register = runQaoa(costs, n, bestParams.gammas, bestParams.betas);
  const probabilities = register.probabilities();

  let bestZ = 0;
  let bestCost = -Infinity;
  const counts = new Map();
  for (let shot = 0; shot < shots; shot++) {
    let r = rand();
    let outcome = probabilities.length - 1;
    for (let z = 0; z < probabilities.length; z++) {
      r -= probabilities[z];
      if (r <= 0) { outcome = z; break; }
    }
    counts.set(outcome, (counts.get(outcome) || 0) + 1);
    if (costs[outcome] > bestCost) {
      bestCost = costs[outcome];
      bestZ = outcome;
    }
  }

  const sampled = emptySelection(n);
  for (let i = 0; i < n; i++) sampled[i] = (bestZ >> i) & 1;
  const selection = repair(problem, sampled);

  // The probability the device lands on a *good* answer matters more than
  // the best of many shots, so report it rather than hiding it.
  const optimum = Math.max(...costs);
  let probabilityOfOptimum = 0;
  for (let z = 0; z < costs.length; z++) {
    if (costs[z] >= optimum - 1e-9) probabilityOfOptimum += probabilities[z];
  }

  return {
    name: "QAOA (quantum)",
    selection,
    ...evaluate(problem, selection),
    ms: performance.now() - started,
    layers,
    qubits: n,
    stateSize: 1 << n,
    shots,
    params: bestParams,
    expectation: bestExpectation,
    probabilityOfOptimum,
    uniqueOutcomes: counts.size,
    circuitDepth: layers * (n + 1) + n,
  };
}

/* ==================================================================
   4. The comparison
   ================================================================== */

/**
 * Runs every solver on the same problem and reports what happened.
 *
 * The verdict is generated from the measured numbers, not asserted.
 * If QAOA loses, it says QAOA lost.
 */
export function compare(problem, { qaoaLayers = 2 } = {}) {
  const greedy = solveGreedy(problem);
  const annealing = solveAnnealing(problem);
  const exact = solveExact(problem);
  const qaoa = solveQaoa(problem, { layers: qaoaLayers });

  const solvers = [greedy, annealing, qaoa, exact].filter(Boolean).filter((s) => !s.skipped);
  const optimum = exact ? exact.value : Math.max(...solvers.map((s) => s.value));

  for (const solver of solvers) {
    solver.gapPercent = optimum > 0 ? ((optimum - solver.value) / optimum) * 100 : 0;
    solver.optimal = Math.abs(solver.value - optimum) < 1e-9;
  }

  const fastest = solvers.reduce((a, b) => (a.ms <= b.ms ? a : b));
  const best = solvers.reduce((a, b) => (a.value >= b.value ? a : b));
  const quantumBeatClassical = !qaoa.skipped && qaoa.value > Math.max(greedy.value, annealing.value);

  return {
    problem,
    greedy,
    annealing,
    exact,
    qaoa,
    optimum,
    fastest: fastest.name,
    best: best.name,
    quantumBeatClassical,
    verdict: buildVerdict({ greedy, annealing, qaoa, exact, optimum, quantumBeatClassical }),
  };
}

function buildVerdict({ greedy, annealing, qaoa, exact, optimum, quantumBeatClassical }) {
  const lines = [];

  if (exact) {
    lines.push(`The true optimum is ${optimum} priority points, found exactly by dynamic programming in ${exact.ms.toFixed(1)} ms.`);
  }
  lines.push(
    `Greedy reached ${greedy.value} (${greedy.gapPercent.toFixed(1)}% off) in ${greedy.ms.toFixed(1)} ms; ` +
    `simulated annealing reached ${annealing.value} (${annealing.gapPercent.toFixed(1)}% off) in ${annealing.ms.toFixed(0)} ms.`
  );

  if (qaoa.skipped) {
    lines.push(qaoa.reason);
  } else {
    lines.push(
      `QAOA on ${qaoa.qubits} simulated qubits (${qaoa.stateSize} amplitudes, depth ${qaoa.circuitDepth}) reached ${qaoa.value} ` +
      `(${qaoa.gapPercent.toFixed(1)}% off) in ${qaoa.ms.toFixed(0)} ms, with a ${(qaoa.probabilityOfOptimum * 100).toFixed(1)}% ` +
      `chance of any single measurement landing on the optimum.`
    );
    lines.push(
      quantumBeatClassical
        ? "On this instance QAOA edged the classical solvers — worth recording, but a single instance is not evidence of an advantage."
        : "The classical solvers matched or beat QAOA here, and were faster. That is the expected result at this scale, and it is the honest thing to show a customer."
    );
  }

  lines.push(
    "What transfers to real hardware is the QUBO formulation, not the simulation. Sell the optimisation; treat quantum as a research line with a measured baseline beside it."
  );
  return lines;
}

/**
 * Runs the comparison over many independent instances.
 *
 * A single problem proves nothing — the earlier version of this file
 * looked like it showed a quantum win when in fact it was returning
 * plans that broke the capacity constraint. An aggregate across seeds,
 * reporting how often each solver reaches the true optimum, is the
 * smallest claim that is actually defensible to a customer.
 */
export function benchmark({ instances = 8, count = 10, qaoaLayers = 2 } = {}) {
  const rows = [];
  const wins = { greedy: 0, annealing: 0, qaoa: 0 };
  const totals = { greedy: 0, annealing: 0, qaoa: 0, exact: 0 };
  const times = { greedy: 0, annealing: 0, qaoa: 0 };
  let feasibilityFailures = 0;

  for (let i = 0; i < instances; i++) {
    const problem = generateProblem({ count, seed: 1000 + i * 37 });
    const result = compare(problem, { qaoaLayers });
    const optimum = result.optimum;

    for (const key of ["greedy", "annealing", "qaoa"]) {
      const solver = result[key];
      if (solver.skipped) continue;
      if (!solver.feasible) feasibilityFailures++;
      if (solver.optimal) wins[key]++;
      totals[key] += solver.value;
      times[key] += solver.ms;
    }
    totals.exact += optimum;

    rows.push({
      instance: i + 1,
      optimum,
      greedy: result.greedy.value,
      annealing: result.annealing.value,
      qaoa: result.qaoa.skipped ? null : result.qaoa.value,
      qaoaProbability: result.qaoa.skipped ? null : result.qaoa.probabilityOfOptimum,
    });
  }

  const rate = (key) => `${wins[key]}/${instances}`;
  const efficiency = (key) => (totals.exact ? (totals[key] / totals.exact) * 100 : 0);

  return {
    instances,
    taskCount: count,
    rows,
    wins,
    feasibilityFailures,
    summary: {
      greedy: { optimalRate: rate("greedy"), percentOfOptimum: efficiency("greedy"), msTotal: times.greedy },
      annealing: { optimalRate: rate("annealing"), percentOfOptimum: efficiency("annealing"), msTotal: times.annealing },
      qaoa: { optimalRate: rate("qaoa"), percentOfOptimum: efficiency("qaoa"), msTotal: times.qaoa },
    },
    verdict:
      `Across ${instances} independent instances of ${count} targets: simulated annealing hit the exact optimum ` +
      `${rate("annealing")} times in ${times.annealing.toFixed(0)} ms total, QAOA ${rate("qaoa")} times in ` +
      `${times.qaoa.toFixed(0)} ms. ${feasibilityFailures === 0 ? "Every plan returned was flyable within capacity." : `${feasibilityFailures} infeasible plan(s) were produced and repaired.`} ` +
      `Classical is faster by orders of magnitude at this scale; the quantum path is a research line, not a sales claim.`,
  };
}

/** A compact, speakable summary for JARVIS and the approval inbox. */
export function summarise(result) {
  const { problem, best, optimum } = result;
  const chosen = result.exact || result.annealing;
  return (
    `Mission optimiser: ${problem.tasks.length} requested targets, capacity ${problem.capacity} of ${problem.totalCost} units. ` +
    `Best plan flies ${chosen.chosen} targets for ${chosen.value} of a possible ${problem.totalValue} priority points, ` +
    `found by ${best}. Optimum ${optimum}.`
  );
}

/** The chosen flight plan, in the order an operator would read it. */
export function flightPlan(problem, selection) {
  return problem.tasks
    .map((task, index) => ({ ...task, flown: !!selection[index] }))
    .sort((a, b) => a.window - b.window || b.value - a.value);
}
