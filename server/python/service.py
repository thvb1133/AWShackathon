#!/usr/bin/env python3
"""Beyond Orbit Python ML service.

No framework dependency is required.  The project must run on a
coursework server and on a fresh laptop, so this is deliberately a
small standard-library HTTP service plus NumPy rather than a hidden
FastAPI/pip install.

It exposes:
    GET  /health
    POST /classify  {"text": "...", "engine": "quantum|classical|both"}
    GET  /benchmark

The quantum engine is a real state-vector simulation:

  1. encode five interpretable intent features as RY angles;
  2. apply an entangling ring of CNOT gates;
  3. compare the state to labelled prototypes using |<psi|phi>|^2.

That kernel is evaluated from the actual complex vectors.  The
classical baseline sees the same five features and uses cosine
similarity to the class centroid.  The benchmark reports both rather
than claiming a quantum advantage without measuring one.

Start it:
    python3 server/python/service.py

Then start PHP with BO_PYTHON_URL=http://127.0.0.1:8000.
"""

from __future__ import annotations

import json
import math
import re
import time
from collections import defaultdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import numpy as np

HOST = "127.0.0.1"
PORT = 8000
INTENTS = ("calculate", "lookup", "live", "code", "reflect")
N_QUBITS = 5

CALC = (
    "calculate", "compute", "how much", "how many", "how far", "how fast",
    "how long", "delta", "budget", "transfer", "orbit", "velocity", "altitude",
    "period", "mass", "power", "gravity", "weigh", "resolution", "inclination",
    "distance", "energy", "temperature", "loss", "rate",
)
LOOKUP = (
    "who", "what is", "what are", "tell me about", "when did", "when was",
    "history", "discovered", "invented", "founded", "explain", "describe",
    "which company", "who built", "story", "about the",
)
LIVE = (
    "now", "right now", "today", "tonight", "current", "currently", "latest",
    "live", "at the moment", "this week", "this month", "upcoming", "coming up",
    "scheduled", "soon", "next launch", "where is", "position", "track",
    "overhead", "forecast", "real time", "status of", "crowded", "congestion",
    "space traffic", "how many satellites", "how many objects",
)
CODE = (
    "code", "python", "javascript", "script", "program", "function", "api",
    "library", "snippet", "write me a", "how do i write", "implement", "sdk",
    "json", "run it",
)
REFLECT = (
    "why", "meaning", "feel", "feeling", "beautiful", "alone", "lonely", "soul",
    "love", "afraid", "scared", "hope", "human", "philosophy", "sad", "wonder",
    "purpose", "poem", "poetic", "does it matter",
)

TRAINING: tuple[tuple[str, str], ...] = (
    ("hohmann transfer from 400 km to 35786 km", "calculate"),
    ("orbital velocity at 550 km", "calculate"),
    ("how much propellant for 1800 m/s with isp 320", "calculate"),
    ("sun synchronous inclination at 700 km", "calculate"),
    ("power budget for 250 w at 550 km", "calculate"),
    ("what would i weigh on titan", "calculate"),
    ("delta v to reach geostationary orbit", "calculate"),
    ("how far is mars from earth", "calculate"),
    ("light delay to jupiter in minutes", "calculate"),
    ("re-entry lifetime from 500 km", "calculate"),
    ("imaging resolution from 500 km with a 1.1 m aperture", "calculate"),
    ("equilibrium temperature at 5 au", "calculate"),
    ("how long does a transfer to mars take", "calculate"),
    ("who discovered uranus", "lookup"),
    ("tell me about vera rubin", "lookup"),
    ("what is dark matter", "lookup"),
    ("explain the cosmic microwave background", "lookup"),
    ("when was sputnik launched", "lookup"),
    ("who founded isro", "lookup"),
    ("what are quasars", "lookup"),
    ("describe the kuiper belt", "lookup"),
    ("history of the apollo programme", "lookup"),
    ("which company builds radar satellites", "lookup"),
    ("tell me about the james webb telescope", "lookup"),
    ("what is a neutron star", "lookup"),
    ("who was katherine johnson", "lookup"),
    ("where is the iss right now", "live"),
    ("what is the space station position today", "live"),
    ("next launches worldwide", "live"),
    ("current solar wind speed", "live"),
    ("is there a geomagnetic storm at the moment", "live"),
    ("show me starlink satellites live", "live"),
    ("asteroids passing earth this week", "live"),
    ("track hubble now", "live"),
    ("what can i see tonight", "live"),
    ("latest picture of the day", "live"),
    ("aurora forecast", "live"),
    ("which satellites are overhead", "live"),
    ("python code to track a satellite", "code"),
    ("write me a script for the nasa api", "code"),
    ("javascript function for orbital period", "code"),
    ("how do i implement sgp4", "code"),
    ("give me a snippet to compute delta v", "code"),
    ("code for reading two line elements", "code"),
    ("show me a program that plots an orbit", "code"),
    ("python library for astronomy", "code"),
    ("why are we alone in the universe", "reflect"),
    ("does any of this matter", "reflect"),
    ("what does the cosmos mean", "reflect"),
    ("i feel small looking at the stars", "reflect"),
    ("is the universe beautiful", "reflect"),
    ("why do humans want to leave earth", "reflect"),
    ("i am afraid of how big space is", "reflect"),
    ("what is the purpose of exploration", "reflect"),
    ("tell me something poetic about saturn", "reflect"),
)

HELD_OUT: tuple[tuple[str, str], ...] = (
    ("escape velocity from a 300 km orbit", "calculate"),
    ("how many watts do i need at 800 km", "calculate"),
    ("work out the transfer time to venus", "calculate"),
    ("who was jocelyn bell burnell", "lookup"),
    ("explain what a pulsar is", "lookup"),
    ("when did cassini reach saturn", "lookup"),
    ("where is hubble at the moment", "live"),
    ("what launches are coming up next", "live"),
    ("is the sun active right now", "live"),
    ("write python to read a tle file", "code"),
    ("give me javascript for the iss api", "code"),
    ("why does the universe exist", "reflect"),
    ("i feel lonely under the stars", "reflect"),
)


def _hits(text: str, words: tuple[str, ...]) -> int:
    return sum(1 for word in words if word in text)


def features(text: str) -> np.ndarray:
    """Five bounded features, one interpretable angle per intent."""
    lowered = f" {text.lower().strip()} "
    words = re.findall(r"[a-z']+", lowered)
    length = max(1, len(words))
    numeric = len(re.findall(r"\d", lowered)) / max(1, len(lowered))
    unit = bool(re.search(r"\b\d[\d,.]*\s*(km|kg|m/s|w|watt|au|deg|°|s|sec|min|hour|day|year|ghz|mhz|nt|kt)\b", lowered))
    raw = np.array(
        [
            min(1.0, (0.6 if unit else 0.0) + numeric * 3 + _hits(lowered, CALC) / 3),
            min(1.0, _hits(lowered, LOOKUP) / 2),
            min(1.0, _hits(lowered, LIVE) / 2),
            min(1.0, _hits(lowered, CODE) / 1.5),
            min(1.0, _hits(lowered, REFLECT) / 1.5),
        ],
        dtype=np.float64,
    )
    damping = min(1.0, length / 5)
    return np.clip(0.5 + (raw - 0.5) * damping, 0.0, 1.0) * math.pi


def apply_ry(state: np.ndarray, qubit: int, theta: float) -> None:
    """Applies RY(theta) in-place to an interleaved basis-state vector."""
    c = math.cos(theta / 2)
    s = math.sin(theta / 2)
    stride = 1 << qubit
    size = len(state)
    for block in range(0, size, stride << 1):
        for offset in range(stride):
            i0, i1 = block + offset, block + offset + stride
            a0, a1 = state[i0], state[i1]
            state[i0] = c * a0 - s * a1
            state[i1] = s * a0 + c * a1


def apply_cnot(state: np.ndarray, control: int, target: int) -> None:
    control_bit, target_bit = 1 << control, 1 << target
    for index in range(len(state)):
        if index & control_bit and not index & target_bit:
            other = index | target_bit
            state[index], state[other] = state[other], state[index]


def quantum_state(x: np.ndarray) -> np.ndarray:
    """A real 5-qubit feature circuit: H-ish RY encoding plus CNOT ring."""
    state = np.zeros(1 << N_QUBITS, dtype=np.complex128)
    state[0] = 1.0
    for qubit, angle in enumerate(x):
        # RY(pi/2) creates |+>-like superposition; the feature rotates it.
        apply_ry(state, qubit, math.pi / 2 + float(angle))
    for qubit in range(N_QUBITS):
        apply_cnot(state, qubit, (qubit + 1) % N_QUBITS)
    return state


def quantum_kernel(left: np.ndarray, right: np.ndarray) -> float:
    """K(x,x') = |<psi(x)|psi(x')>|^2, evaluated from actual amplitudes."""
    overlap = np.vdot(left, right)
    return float(np.abs(overlap) ** 2)


class Models:
    def __init__(self) -> None:
        grouped: dict[str, list[np.ndarray]] = defaultdict(list)
        raw: dict[str, list[np.ndarray]] = defaultdict(list)
        for text, intent in TRAINING:
            x = features(text)
            raw[intent].append(x)
            grouped[intent].append(quantum_state(x))
        self.states = {intent: np.stack(grouped[intent]) for intent in INTENTS}
        self.centroids = {intent: np.mean(np.stack(raw[intent]), axis=0) for intent in INTENTS}

    def quantum(self, text: str) -> tuple[str, dict[str, float], np.ndarray]:
        state = quantum_state(features(text))
        scores = {
            intent: float(np.mean([quantum_kernel(state, prototype) for prototype in states]))
            for intent, states in self.states.items()
        }
        total = sum(scores.values()) or 1.0
        scores = {key: value / total for key, value in scores.items()}
        return max(scores, key=scores.get), scores, state

    def classical(self, text: str) -> tuple[str, dict[str, float]]:
        x = features(text)
        scores: dict[str, float] = {}
        norm_x = float(np.linalg.norm(x)) or 1.0
        for intent, centroid in self.centroids.items():
            scores[intent] = max(0.0, float(np.dot(x, centroid) / (norm_x * (np.linalg.norm(centroid) or 1.0))))
        total = sum(scores.values()) or 1.0
        scores = {key: value / total for key, value in scores.items()}
        return max(scores, key=scores.get), scores

    def classify(self, text: str, engine: str = "quantum") -> dict[str, Any]:
        quantum_intent, quantum_scores, state = self.quantum(text)
        classical_intent, classical_scores = self.classical(text)
        agree = quantum_intent == classical_intent

        if engine == "classical":
            intent, scores = classical_intent, classical_scores
        elif engine == "both":
            scores = {name: (quantum_scores[name] + classical_scores[name]) / 2 for name in INTENTS}
            intent = max(scores, key=scores.get)
        else:
            intent, scores = quantum_intent, quantum_scores

        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        margin = ranked[0][1] - ranked[1][1]
        return {
            "intent": intent,
            "confidence": round(float(scores[intent]), 4),
            "margin": round(float(margin), 4),
            "engine": engine if engine in {"quantum", "classical", "both"} else "quantum",
            "agree": agree,
            "quantum": {name: round(score, 4) for name, score in quantum_scores.items()},
            "classical": {name: round(score, 4) for name, score in classical_scores.items()},
            "features": [round(float(value), 5) for value in features(text)],
            "statevector_norm": round(float(np.vdot(state, state).real), 12),
        }

    def benchmark(self) -> dict[str, Any]:
        quantum_right = 0
        classical_right = 0
        rows = []
        for text, expected in HELD_OUT:
            q_intent, q_scores, _ = self.quantum(text)
            c_intent, c_scores = self.classical(text)
            quantum_right += q_intent == expected
            classical_right += c_intent == expected
            rows.append(
                {
                    "text": text,
                    "expected": expected,
                    "quantum": q_intent,
                    "classical": c_intent,
                    "quantum_correct": q_intent == expected,
                    "classical_correct": c_intent == expected,
                    "quantum_confidence": round(q_scores[q_intent], 4),
                    "classical_confidence": round(c_scores[c_intent], 4),
                }
            )
        total = len(HELD_OUT)
        return {
            "ok": True,
            "held_out": total,
            "quantum_accuracy": round(quantum_right / total, 4),
            "classical_accuracy": round(classical_right / total, 4),
            "quantum_correct": quantum_right,
            "classical_correct": classical_right,
            "method": "Actual state-vector kernel prototypes versus classical cosine-centroid baseline.",
            "rows": rows,
        }


MODELS = Models()
STARTED = time.time()


class Api(BaseHTTPRequestHandler):
    server_version = "BeyondOrbitPythonML/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[python-ml] " + fmt % args, flush=True)

    def json(self, status: int, body: Any) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self.json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "Beyond Orbit Python ML",
                    "python": "3",
                    "numpy": np.__version__,
                    "qubits": N_QUBITS,
                    "statevector_size": 1 << N_QUBITS,
                    "training_examples": len(TRAINING),
                    "uptime_seconds": round(time.time() - STARTED, 2),
                },
            )
        elif self.path.rstrip("/") == "/benchmark":
            self.json(HTTPStatus.OK, MODELS.benchmark())
        else:
            self.json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "No such endpoint."})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/classify":
            self.json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "No such endpoint."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(min(length, 8192))
            body = json.loads(raw or b"{}")
            text = str(body.get("text", "")).strip()
            if not 2 <= len(text) <= 500:
                raise ValueError("text must be 2 to 500 characters")
            engine = str(body.get("engine", "quantum"))
            self.json(HTTPStatus.OK, {"ok": True, **MODELS.classify(text, engine)})
        except (ValueError, json.JSONDecodeError) as error:
            self.json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "error": str(error)})
        except Exception as error:  # No trace leaked to the client.
            self.log_message("classification failed: %s", error)
            self.json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Classification failed."})


def main() -> None:
    print(f"Beyond Orbit Python ML listening on http://{HOST}:{PORT}", flush=True)
    print(f"5-qubit state-vector kernel · {len(TRAINING)} training examples", flush=True)
    ThreadingHTTPServer((HOST, PORT), Api).serve_forever()


if __name__ == "__main__":
    main()
