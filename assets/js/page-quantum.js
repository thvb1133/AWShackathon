/* Quantum page: shows the QML and QKD doing their real jobs. */

import { initShell, toast, escapeHtml } from "./ui.js";
import {
  classify, describeModel, train, clearCachedWeights, ensureTrained,
  inspect, selfCheck, INTENTS, INTENT_IDS, status,
} from "./qml.js";
import { bb84, grover, bellPair, QuantumRegister, quantumRandomBits } from "./quantum.js";

initShell("quantum.html");

const fmt = (v, d = 2) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d });

/* -------------------------------------------------- self-check */
{
  const sc = selfCheck();
  const rand = quantumRandomBits(64);
  const ones = rand.filter((b) => b === 1).length;
  const rows = [
    ["State norm preserved under gates", sc.normPreserved, "Σ|ψᵢ|² = 1 after a Hadamard and a CNOT"],
    ["Bell pair correlated", sc.bellCorrelated, "P(00) = P(11) = ½ exactly, P(01) = P(10) = 0"],
    ["Kernel self-overlap is unity", sc.kernelSelfOverlap, "|⟨φ(x)|φ(x)⟩|² = 1, as any inner product must be"],
    ["Quantum RNG is unbiased", Math.abs(ones - 32) < 14, `${ones} ones in 64 measurements of H|0⟩`],
  ];
  document.getElementById("selfcheck").innerHTML = `<table><tbody>${rows
    .map(([name, ok, detail]) => `<tr><td>${ok ? '<span class="tick">✓</span>' : '<span class="cross">✗</span>'}</td>
      <td><b>${escapeHtml(name)}</b><br><span class="muted" style="font-size:.8rem">${escapeHtml(detail)}</span></td></tr>`)
    .join("")}</tbody></table>`;
}

/* ------------------------------------------------- model facts */
function paintModelFacts() {
  const m = describeModel();
  document.getElementById("model-facts").innerHTML = [
    ["Qubits", m.qubits, `a ${m.stateVectorSize}-amplitude state vector`],
    ["Trainable angles", m.totalParameters, `${m.parametersPerModel} per model × ${m.intents} intents`],
    ["Training examples", m.trainingExamples, "hand-labelled, deliberately few"],
    ["Circuit depth", m.circuitDepth, "gates per classification"],
    ["Gradient rule", "parameter shift", "exact for Pauli rotations"],
    ["Kernel", "ZZ feature map", "2 repetitions, Havlíček et al. 2019"],
  ]
    .map(([label, value, note]) => `<div class="metric"><div class="label">${escapeHtml(label)}</div>
      <div class="value" style="font-size:1.3rem">${escapeHtml(String(value))}</div>
      <div class="muted" style="font-size:.75rem">${escapeHtml(note)}</div></div>`)
    .join("");

  document.querySelector("#accuracy-table tbody").innerHTML = INTENT_IDS.map((i) => {
    const acc = m.accuracy[i];
    return `<tr><td>${INTENTS[i].emoji} ${escapeHtml(INTENTS[i].label)}
      <br><span class="muted" style="font-size:.78rem">${escapeHtml(INTENTS[i].hint)}</span></td>
      <td><b>${acc === undefined ? "—" : `${(acc * 100).toFixed(0)}%`}</b></td></tr>`;
  }).join("");

  document.getElementById("circuit-diagram").textContent = m.diagram;
  document.getElementById("train-status").innerHTML = m.fromCache
    ? `Loaded ${m.totalParameters} cached weights — trained earlier in ${m.trainingMs} ms over ${m.epochs} epochs. Retrain to watch it happen.`
    : `Trained just now: ${m.epochs} epochs in ${m.trainingMs} ms.`;
}

/* ------------------------------------------------ loss chart */
const chart = document.getElementById("loss-chart");
const ctx = chart.getContext("2d");
const COLOURS = { calculate: "#ffd166", lookup: "#4fd7ff", live: "#5ce6a8", code: "#ff6fae", reflect: "#9b6bff" };

function drawLosses(histories) {
  const dpr = Math.min(devicePixelRatio, 2);
  chart.width = chart.clientWidth * dpr;
  chart.height = chart.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = chart.clientWidth;
  const h = chart.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const series = Object.entries(histories).filter(([, v]) => v?.length);
  if (!series.length) return;
  const maxLen = Math.max(...series.map(([, v]) => v.length));
  const maxLoss = Math.max(0.05, ...series.flatMap(([, v]) => v));

  // Axes
  ctx.strokeStyle = "rgba(155,107,255,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * (h - 24) + 8;
    ctx.beginPath();
    ctx.moveTo(34, y);
    ctx.lineTo(w - 4, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(141,137,187,0.9)";
    ctx.font = "10px system-ui";
    ctx.fillText((maxLoss * (1 - i / 4)).toFixed(2), 2, y + 3);
  }

  for (const [intent, losses] of series) {
    ctx.strokeStyle = COLOURS[intent] || "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    losses.forEach((loss, i) => {
      const x = 34 + (i / Math.max(1, maxLen - 1)) * (w - 42);
      const y = 8 + (1 - loss / maxLoss) * (h - 24);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  // Legend
  let lx = 40;
  ctx.font = "10px system-ui";
  for (const [intent] of series) {
    ctx.fillStyle = COLOURS[intent] || "#fff";
    ctx.fillRect(lx, h - 10, 8, 3);
    ctx.fillText(intent, lx + 11, h - 6);
    lx += 11 + ctx.measureText(intent).width + 12;
  }
}

ensureTrained();
paintModelFacts();
drawLosses(status.histories);
window.addEventListener("resize", () => drawLosses(status.histories));

document.getElementById("btn-train").addEventListener("click", async () => {
  const btn = document.getElementById("btn-train");
  btn.disabled = true;
  btn.textContent = "Training…";
  clearCachedWeights();
  const live = {};
  // Yield to the browser between intents so the curve draws as it goes.
  await new Promise((resolve) => {
    setTimeout(() => {
      train({
        epochs: 32,
        onProgress(intent, epoch, loss) {
          (live[intent] = live[intent] || []).push(loss);
          if (epoch % 4 === 0) drawLosses(live);
        },
      });
      resolve();
    }, 30);
  });
  drawLosses(status.histories);
  paintModelFacts();
  btn.disabled = false;
  btn.textContent = "Retrain from scratch";
  toast(`⚛️ Retrained ${status.totalParameters} angles in ${status.trainingMs} ms.`, "good");
});

document.getElementById("btn-clear-weights").addEventListener("click", () => {
  clearCachedWeights();
  toast("Cached weights cleared. The next visit trains from scratch.");
});

/* ------------------------------------------------ probe a sentence */
function drawBloch(canvas, vector, label) {
  const c = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio, 2);
  const size = canvas.clientWidth;
  canvas.width = canvas.height = size * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;

  // Sphere outline and equator.
  c.strokeStyle = "rgba(155,107,255,0.45)";
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = "rgba(155,107,255,0.22)";
  c.beginPath(); c.ellipse(cx, cy, r, r * 0.28, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
  c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.stroke();

  // Project (x, y, z): z up the screen, x to the right, y into the page.
  const px = cx + (vector.x * 0.92 + vector.y * 0.36) * r;
  const py = cy - (vector.z * 0.92 - vector.y * 0.2) * r;

  const grad = c.createLinearGradient(cx, cy, px, py);
  grad.addColorStop(0, "#4fd7ff");
  grad.addColorStop(1, "#ff6fae");
  c.strokeStyle = grad;
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(px, py); c.stroke();
  c.fillStyle = "#ff9fd6";
  c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();

  c.fillStyle = "rgba(238,240,255,0.85)";
  c.font = `${Math.max(10, size * 0.09)}px system-ui`;
  c.fillText(label, 4, size - 4);
}

function probe() {
  const text = document.getElementById("probe").value.trim() || "hello";
  const ins = inspect(text);
  const result = classify(text);

  const max = Math.max(...ins.probabilities);
  document.getElementById("amp-bars").innerHTML = ins.probabilities
    .map((p, i) => `<div title="|${i.toString(2).padStart(4, "0")}⟩ = ${(p * 100).toFixed(2)}%" style="height:${Math.max(2, (p / max) * 100)}%"></div>`)
    .join("");
  document.getElementById("amp-note").textContent =
    `Largest amplitude: |${ins.probabilities.indexOf(max).toString(2).padStart(4, "0")}⟩ at ${(max * 100).toFixed(2)}%. ` +
    `Total probability ${ins.probabilities.reduce((a, b) => a + b, 0).toFixed(12)} — it must be exactly 1, and it is.`;

  const bar = (v) => `<div class="bar" style="height:6px"><span style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></div>`;
  document.getElementById("probe-result").innerHTML = `
    <p>Intent: <b>${INTENTS[result.intent].emoji} ${escapeHtml(INTENTS[result.intent].label)}</b>
       — confidence ${(result.confidence * 100).toFixed(0)}%, margin ${result.margin.toFixed(3)}.<br>
       The two models ${result.agree ? '<span class="tick">agreed</span>' : '<span class="cross">disagreed</span>'}.</p>
    <p class="muted" style="font-size:.82rem">Encoded angles: ${result.features.map((f) => f.toFixed(3)).join(", ")} radians</p>
    <table style="font-size:.8rem"><thead><tr><th>Intent</th><th>Variational</th><th>Kernel</th></tr></thead>
      <tbody>${INTENT_IDS.map((i) => `<tr${i === result.intent ? ' class="me"' : ""}>
        <td>${INTENTS[i].emoji} ${escapeHtml(INTENTS[i].label)}</td>
        <td>${bar(result.variational[i])}</td><td>${bar(result.kernel[i])}</td></tr>`).join("")}</tbody></table>
    <p class="muted mt" style="font-size:.8rem">Nearest neighbours by quantum kernel:<br>
      ${result.neighbours.map((n) => `${escapeHtml(n.intent)} <span class="mono">K=${n.k.toFixed(4)}</span>`).join(" · ")}</p>`;

  const grid = document.getElementById("bloch-grid");
  grid.innerHTML = ins.bloch
    .map((_, q) => `<div class="bloch card" style="padding:.5rem"><canvas id="bloch-${q}"></canvas></div>`)
    .join("");
  ins.bloch.forEach((v, q) => {
    const canvas = document.getElementById(`bloch-${q}`);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    drawBloch(canvas, v, `q${q} · |r|=${Math.hypot(v.x, v.y, v.z).toFixed(2)}`);
  });
}
document.getElementById("btn-probe").addEventListener("click", probe);
document.getElementById("probe").addEventListener("keydown", (e) => { if (e.key === "Enter") probe(); });
probe();

/* --------------------------------------------------------- BB84 */
document.getElementById("btn-qkd").addEventListener("click", () => {
  const bits = parseInt(document.getElementById("qkd-bits").value, 10);
  const noise = parseFloat(document.getElementById("qkd-noise").value);
  const eve = document.getElementById("qkd-eve").checked;

  const out = document.getElementById("qkd-result");
  out.innerHTML = `<p class="muted">Preparing and measuring ${bits} qubits…</p>`;

  setTimeout(() => {
    const r = bb84({ bits, eavesdropper: eve, channelNoise: noise });
    out.innerHTML = `
      <dl class="kv">
        <dt>Qubits sent</dt><dd>${fmt(r.bits, 0)}</dd>
        <dt>Bases matched (sifted)</dt><dd>${fmt(r.sifted, 0)} — ${((r.sifted / r.bits) * 100).toFixed(1)}%, theory says 50%</dd>
        <dt>Sacrificed to check</dt><dd>${fmt(r.checked, 0)}</dd>
        <dt>Final key length</dt><dd>${fmt(r.keyLength, 0)} bits</dd>
        <dt>Measured error rate</dt><dd style="color:${r.errorRate > 0.11 ? "var(--bad)" : "var(--good)"}">${(r.errorRate * 100).toFixed(2)}%</dd>
        <dt>Verdict</dt><dd>${r.secure
          ? '<span class="tick">✓ secure — key accepted</span>'
          : '<span class="cross">✗ ABORTED — error rate above the 11% threshold</span>'}</dd>
        ${r.eavesdropper ? `<dt>Eve's knowledge</dt><dd>${(r.eveCorrect * 100).toFixed(1)}% of the key bits</dd>` : ""}
      </dl>
      <p class="muted mt" style="font-size:.84rem">${
        eve
          ? "Eve had to guess a basis for every qubit. She was wrong half the time, and each wrong guess randomised what she forwarded — which is why roughly a quarter of the sifted bits now disagree. She cannot avoid this. Measuring a quantum state changes it."
          : noise > 0
          ? "No eavesdropper, but a noisy channel produces errors too — and the protocol cannot tell the difference. That is why the conservative response to any error rate above the threshold is to abort and try again."
          : "A perfect channel with nobody listening: zero errors, and every sifted bit agrees. This is the case the key on the JARVIS page comes from."
      }</p>
      ${r.key.length ? `<h3 class="mt">First 160 key bits</h3><p class="bitstream">${r.key.slice(0, 160).join("")}</p>` : ""}`;

    document.querySelector("#qkd-trace tbody").innerHTML = r.trace
      .map((t) => `<tr><td class="mono">${t.index}</td><td class="mono">${t.aliceBit}</td>
        <td style="font-size:.8rem">${escapeHtml(t.basis)}</td><td class="mono">${t.bobBit}</td>
        <td>${t.agreed ? '<span class="tick">✓</span>' : '<span class="cross">✗</span>'}</td></tr>`)
      .join("");

    if (!r.secure) toast("🔓 Eavesdropper detected — the exchange aborted, exactly as designed.", "bad");
    else toast(`🔐 ${r.keyLength} secret bits established.`, "good");
  }, 30);
});

/* -------------------------------------------------------- Grover */
document.getElementById("btn-grover").addEventListener("click", () => {
  const n = parseInt(document.getElementById("grover-n").value, 10);
  const size = 1 << n;
  const marked = Math.floor(Math.random() * size);
  const g = grover(n, marked);
  const classical = size / 2;

  document.getElementById("grover-result").innerHTML = `
    <p>Searching ${fmt(size, 0)} unsorted items for one marked entry — item
       <span class="mono">|${marked.toString(2).padStart(n, "0")}⟩</span>, chosen at random.</p>
    <dl class="kv">
      <dt>Starting probability</dt><dd>${((1 / size) * 100).toFixed(3)}% (a blind guess)</dd>
      <dt>Grover iterations</dt><dd>${g.steps} — about (π/4)√N</dd>
      <dt>Final probability</dt><dd style="color:var(--good)">${(g.probability * 100).toFixed(2)}%</dd>
      <dt>Classical average</dt><dd>${fmt(classical, 0)} lookups to find it</dd>
      <dt>Speed-up</dt><dd>${(classical / g.steps).toFixed(1)}× fewer queries</dd>
    </dl>
    <h3 class="mt">Amplitude growing, iteration by iteration</h3>
    <div class="amp-bars" style="height:90px">${g.trace
      .map((t) => `<div title="after ${t.iteration}: ${(t.probability * 100).toFixed(1)}%" style="height:${Math.max(2, t.probability * 100)}%"></div>`)
      .join("")}</div>
    <p class="hint">Each bar is one iteration. The oracle flips the marked amplitude's phase, then the diffusion
       operator reflects every amplitude about the mean — and the marked one climbs.</p>`;
});

/* ---------------------------------------------------- Bell pairs */
document.getElementById("btn-bell").addEventListener("click", () => {
  let agree = 0;
  const outcomes = { "00": 0, "01": 0, "10": 0, "11": 0 };
  for (let i = 0; i < 500; i++) {
    const pair = bellPair();
    const a = pair.measure(0);
    const b = pair.measure(1);
    outcomes[`${a}${b}`]++;
    if (a === b) agree++;
  }
  const separable = new QuantumRegister(2).h(0).h(1);
  let sepAgree = 0;
  for (let i = 0; i < 500; i++) {
    const q = new QuantumRegister(2).h(0).h(1);
    if (q.measure(0) === q.measure(1)) sepAgree++;
  }

  document.getElementById("bell-result").innerHTML = `
    <dl class="kv">
      <dt>Entangled pair — outcomes agreed</dt><dd style="color:var(--good)">${agree} of 500 (${((agree / 500) * 100).toFixed(1)}%)</dd>
      <dt>Outcome counts</dt><dd class="mono">00: ${outcomes["00"]} · 11: ${outcomes["11"]} · 01: ${outcomes["01"]} · 10: ${outcomes["10"]}</dd>
      <dt>Two independent superpositions — agreed</dt><dd>${sepAgree} of 500 (${((sepAgree / 500) * 100).toFixed(1)}%)</dd>
    </dl>
    <p class="muted mt" style="font-size:.85rem">Both registers give each qubit a perfect 50/50 chance on its own. Only
       the entangled one correlates them, every time, with nothing passing between the two measurements. MRS THORN BIRD
       calls that love. MR PENGUIN calls it physics. They are, annoyingly, both right.</p>`;
});
