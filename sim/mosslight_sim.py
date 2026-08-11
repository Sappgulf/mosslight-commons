#!/usr/bin/env python3
"""Small local Torx + THRML forecast service for Mosslight Commons."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from typing import Any

import jax
import jax.numpy as jnp
from thrml import Block, SamplingSchedule, SpinNode, sample_states
from thrml.models import IsingEBM, IsingSamplingProgram, hinton_init
from torx import psc


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def sample_resource_risks(resources: dict[str, Any], seed: int) -> dict[str, float]:
    """Sample correlated shortage states with a tiny THRML Ising model."""

    names = ["food", "water", "warmth", "light"]
    shortage = [1.0 - clamp(float(resources.get(name, 50)) / 100.0) for name in names]
    nodes = [SpinNode() for _ in names]
    edges = [(nodes[index], nodes[index + 1]) for index in range(len(nodes) - 1)]
    biases = jnp.asarray([(value - 0.35) * 2.5 for value in shortage])
    weights = jnp.ones((len(edges),)) * 0.35
    model = IsingEBM(nodes, edges, biases, weights, jnp.array(1.0))
    blocks = [Block(nodes)]
    program = IsingSamplingProgram(model, blocks, clamped_blocks=[])
    key = jax.random.key(seed)
    init_key, sample_key = jax.random.split(key)
    initial_state = hinton_init(init_key, model, blocks, ())
    sampled = sample_states(
        sample_key,
        program,
        SamplingSchedule(n_warmup=3, n_samples=24, steps_per_sample=2),
        initial_state,
        [],
        [Block(nodes)],
    )
    values = jnp.asarray(sampled[0])
    probabilities = jnp.mean(values, axis=0)
    return {name: round(float(probabilities[index]), 3) for index, name in enumerate(names)}


def evaluate_torx_policy(shortage: dict[str, float]) -> dict[str, float]:
    """Evaluate a small parameterized stochastic circuit with Torx."""

    curiosity = 0.4 + shortage["light"] * 0.8 - shortage["food"] * 0.35
    community = 0.3 + shortage["water"] * 0.5 + shortage["warmth"] * 0.2
    circuit = psc.DiscretePCircuit([psc.PNOT(0), psc.PCNOT([0, 1])])
    thetas = [jnp.asarray([curiosity]), jnp.asarray([community])]
    simulator = psc.StateVectorSimulator()
    compiled = simulator.build_circuit(circuit, thetas)
    state = jnp.asarray([1.0, 0.0, 0.0, 0.0])
    density = simulator.density(compiled, state)
    return {
        "exploration": round(float(density[2] + density[3]), 3),
        "social": round(float(density[0] + density[1]), 3),
    }


def make_forecast(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get("state", payload)
    resources = state.get("resources", {})
    seed = int(state.get("tick", 0)) + int(state.get("seed", 2048))
    risks = sample_resource_risks(resources, seed)
    policy = evaluate_torx_policy(risks)

    candidates = [
        {
            "title": "Empty Shelves",
            "probability": risks["food"],
            "window": "next 2 days",
            "drivers": [
                f"THRML sampled {risks['food']:.0%} food-shortage pressure",
                "resident demand is coupled to the market",
                "Reed Farms are the fastest stabilizer",
            ],
            "recommendation": "Add a Reed Farm or protect the wild plots.",
            "tone": "warning",
        },
        {
            "title": "Wetland Warning",
            "probability": risks["water"],
            "window": "next 2 days",
            "drivers": [
                f"THRML sampled {risks['water']:.0%} water-shortage pressure",
                "Mireling health is sensitive to basin quality",
                "quiet wetland ground reduces risk",
            ],
            "recommendation": "Give the Mirelings clean water and quiet ground.",
            "tone": "warning",
        },
        {
            "title": "Lantern Festival",
            "probability": clamp(1.0 - risks["light"] * 0.7 + policy["social"] * 0.25),
            "window": "next 3 days",
            "drivers": [
                f"Torx social signal is {policy['social']:.0%}",
                "light routes connect the neighborhoods",
                "the market is an active gathering point",
            ],
            "recommendation": "Keep the market open and let the neighborhoods mix.",
            "tone": "bright",
        },
        {
            "title": "Unmapped Burrow",
            "probability": clamp(0.18 + policy["exploration"] * 0.62),
            "window": "this week",
            "drivers": [
                f"Torx exploration signal is {policy['exploration']:.0%}",
                "Bramblebacks are moving beyond routine routes",
                "open ground remains nearby",
            ],
            "recommendation": "Inspect the new route before building over it.",
            "tone": "calm",
        },
    ]
    forecast = max(candidates, key=lambda candidate: candidate["probability"])
    forecast = {**forecast, "probability": round(float(clamp(forecast["probability"], 0.05, 0.94)), 3)}
    return {
        "provider": "torx-thrml",
        "forecast": forecast,
        "sampledRisks": risks,
        "torxPolicy": policy,
        "explanation": [
            "THRML sampled correlated resource pressure across the settlement.",
            "Torx evaluated a parameterized stochastic policy for exploration and social mixing.",
            "The browser will keep its local forecast if this bridge is stopped.",
        ],
    }


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "http://127.0.0.1:4173")
        self.send_header("access-control-allow-methods", "POST, GET, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._headers(204)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            body = {
                "status": "ok",
                "provider": "torx-thrml",
                "jax": version("jax"),
                "torx": version("extro-torx"),
                "thrml": version("thrml"),
            }
            self._write(body)
            return
        self._write({"error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/forecast":
            self._write({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            self._write(make_forecast(payload))
        except Exception as error:  # keep the game fallback alive on adapter errors
            self._write({"error": str(error)}, 500)

    def _write(self, body: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self._headers(status)
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[mosslight-sim] {format % args}")


def main() -> None:
    port = int(os.environ.get("MOSSLIGHT_SIM_PORT", "8001"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Mosslight Torx + THRML bridge listening on http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
