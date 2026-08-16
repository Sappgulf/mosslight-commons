#!/usr/bin/env python3
"""Local Torx + THRML forecast service for Mosslight Commons.

The browser sends a *stress graph* built in `src/sim/graph.ts`: one node per
(district × pressure channel), plus edges coupling pressures inside a district
and the same pressure across neighbouring districts. This service samples that
graph with THRML and evaluates civic policy axes with Torx.

The graph's shape follows the settlement the player built, so a sprawling town
with five districts samples a genuinely different model from a dense one.
"""

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

CHANNELS = ["food", "water", "warmth", "light", "housing", "shade"]

# Copy per channel, matching src/sim/forecast.ts so the sidecar and the local
# model tell the same story about the same pressure.
CHANNEL_COPY: dict[str, dict[str, str]] = {
    "food": {
        "title": "Empty Shelves",
        "recommendation": "Add a Reed Farm or protect the wild plots.",
        "tone": "warning",
        "window": "next 2 days",
    },
    "water": {
        "title": "Wetland Warning",
        "recommendation": "Give the Mirelings clean water and quiet ground.",
        "tone": "warning",
        "window": "next 2 days",
    },
    "warmth": {
        "title": "Cold Burrows",
        "recommendation": "Raise warmth before the burrows go cold: a Root Workshop or a Comfort Bundle.",
        "tone": "warning",
        "window": "next 3 days",
    },
    "light": {
        "title": "Lantern Festival",
        "recommendation": "Keep the market open and let the neighborhoods mix.",
        "tone": "bright",
        "window": "next 3 days",
    },
    "housing": {
        "title": "No Room Left",
        "recommendation": "Build Burrow Homes where the crowd already stands.",
        "tone": "warning",
        "window": "next 2 days",
    },
    "shade": {
        "title": "Long Shade Crossing",
        "recommendation": "Keep lanterns lit and welcome the Cloudmoths before the canopy fails.",
        "tone": "warning",
        "window": "this season",
    },
}

# Light is the channel whose *absence* of stress is the event worth forecasting.
INVERTED_CHANNELS = {"light"}


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def sample_graph(graph: dict[str, Any], seed: int) -> dict[str, float]:
    """Sample the settlement's stress graph as an Ising model.

    Returns the marginal probability that each node is in its "stressed" state,
    keyed by node id. Node biases come from the local stress reading; edge
    weights come from the couplings the graph declared.
    """

    payload_nodes = graph.get("nodes") or []
    payload_edges = graph.get("edges") or []
    if not payload_nodes:
        return {}

    nodes = [SpinNode() for _ in payload_nodes]
    index_of = {node["id"]: index for index, node in enumerate(payload_nodes)}

    edges = []
    weights: list[float] = []
    for edge in payload_edges:
        first = index_of.get(edge.get("a"))
        second = index_of.get(edge.get("b"))
        if first is None or second is None or first == second:
            continue
        edges.append((nodes[first], nodes[second]))
        weights.append(float(edge.get("weight", 0.3)))

    # A graph with a single district and no couplings is still samplable, but
    # IsingEBM wants at least one edge; couple the first two nodes weakly.
    if not edges and len(nodes) >= 2:
        edges.append((nodes[0], nodes[1]))
        weights.append(0.05)

    # Recentre stress on zero so a comfortable node is genuinely unbiased.
    biases = jnp.asarray([(float(node.get("stress", 0.0)) - 0.35) * 2.6 for node in payload_nodes])
    model = IsingEBM(nodes, edges, biases, jnp.asarray(weights), jnp.array(1.0))
    blocks = [Block(nodes)]
    program = IsingSamplingProgram(model, blocks, clamped_blocks=[])
    key = jax.random.key(seed)
    init_key, sample_key = jax.random.split(key)
    initial_state = hinton_init(init_key, model, blocks, ())
    sampled = sample_states(
        sample_key,
        program,
        SamplingSchedule(n_warmup=4, n_samples=32, steps_per_sample=2),
        initial_state,
        [],
        [Block(nodes)],
    )
    values = jnp.asarray(sampled[0])
    probabilities = jnp.mean(values, axis=0)
    return {
        node["id"]: round(float(probabilities[index]), 3)
        for index, node in enumerate(payload_nodes)
    }


def channel_rollup(graph: dict[str, Any], marginals: dict[str, float]) -> dict[str, dict[str, Any]]:
    """Mean sampled risk per channel, plus the district it is worst in."""

    rollup: dict[str, dict[str, Any]] = {}
    for channel in CHANNELS:
        members = [node for node in (graph.get("nodes") or []) if node.get("channel") == channel]
        if not members:
            rollup[channel] = {"mean": 0.0, "label": None, "population": 0, "peak": 0.0}
            continue

        values = [marginals.get(node["id"], float(node.get("stress", 0.0))) for node in members]
        mean = sum(values) / len(values)

        # Weight by the crowd standing there: a dark district nobody lives in
        # is not the story to lead with.
        best_index = max(
            range(len(members)),
            key=lambda position: values[position]
            * (1.0 + min(1.0, float(members[position].get("population", 0)) / 12.0)),
        )
        worst = members[best_index]
        rollup[channel] = {
            "mean": round(mean, 3),
            "label": worst.get("label"),
            "population": int(worst.get("population", 0)),
            "peak": round(values[best_index], 3),
        }
    return rollup


def evaluate_torx_policy(state: dict[str, Any], rollup: dict[str, dict[str, Any]]) -> dict[str, float]:
    """Evaluate a parameterized stochastic circuit for four civic axes."""

    moths = sum(1 for resident in state.get("residents") or [] if resident.get("species") == "cloudmoth")
    harmony = clamp(float((state.get("metrics") or {}).get("harmony", 50)) / 100.0)
    district = state.get("districtFocus", "market")
    risk = lambda channel: float(rollup.get(channel, {}).get("mean", 0.0))  # noqa: E731

    curiosity = 0.35 + risk("light") * 0.45 + risk("shade") * 0.25 - risk("food") * 0.3
    community = 0.28 + risk("water") * 0.35 + harmony * 0.4 + (0.12 if district == "market" else 0.0)
    harvest = 0.3 + risk("food") * 0.55 + risk("housing") * 0.15
    vigil = 0.22 + risk("light") * 0.4 + risk("shade") * 0.35 + min(0.2, moths * 0.04)

    circuit = psc.DiscretePCircuit([psc.PNOT(0), psc.PCNOT([0, 1]), psc.PNOT(1)])
    thetas = [jnp.asarray([clamp(curiosity)]), jnp.asarray([clamp(community)])]
    simulator = psc.StateVectorSimulator()
    compiled = simulator.build_circuit(circuit, thetas)
    density = simulator.density(compiled, jnp.asarray([1.0, 0.0, 0.0, 0.0]))
    exploration = float(density[2] + density[3])
    social = float(density[0] + density[1])
    return {
        "exploration": round(clamp(exploration * 0.7 + clamp(curiosity) * 0.3), 3),
        "social": round(clamp(social * 0.7 + clamp(community) * 0.3), 3),
        "harvest": round(clamp(harvest), 3),
        "vigil": round(clamp(vigil), 3),
    }


def generate_candidates(
    state: dict[str, Any],
    graph: dict[str, Any],
    rollup: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build one forecast per channel from the sampled graph.

    This replaces a hardcoded list of seven hand-tuned candidates: the copy is
    still authored per channel, but which forecast leads, how likely it is, and
    which district it names all come from the sample.
    """

    district_count = len({node.get("district") for node in (graph.get("nodes") or [])})
    candidates: list[dict[str, Any]] = []

    for channel in CHANNELS:
        summary = rollup.get(channel)
        if not summary:
            continue
        copy = CHANNEL_COPY[channel]
        mean = float(summary["mean"])
        peak = float(summary["peak"])
        intensity = (1.0 - (peak * 0.6 + mean * 0.4)) if channel in INVERTED_CHANNELS else (peak * 0.65 + mean * 0.35)

        drivers = []
        if summary.get("label"):
            drivers.append(
                f"{summary['label']} sampled at {peak:.0%} {channel} pressure "
                f"with {summary['population']} resident{'' if summary['population'] == 1 else 's'}"
            )
        drivers.append(f"THRML {channel} marginal {mean:.0%} across {district_count} districts")

        spread = [
            node.get("label")
            for node in (graph.get("nodes") or [])
            if node.get("channel") == channel
            and node.get("label") != summary.get("label")
            and float(node.get("stress", 0.0)) > 0.45
        ]
        if spread:
            drivers.append(f"spreading toward {' and '.join(dict.fromkeys(spread))[:60]}")
        else:
            drivers.append(f"season is {state.get('season', 'mosswake')}")

        candidates.append(
            {
                "title": copy["title"],
                "probability": clamp(0.06 + intensity * 0.86, 0.05, 0.94),
                "window": copy["window"],
                "drivers": drivers[:3],
                "recommendation": copy["recommendation"],
                "tone": copy["tone"],
            }
        )

    return candidates


def make_forecast(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get("state", payload)
    seed = int(state.get("tick", 0)) + int(state.get("seed", 2048))
    graph = state.get("graph") or {"nodes": [], "edges": []}

    # No districts yet means nothing to sample. Bail before doing any THRML or
    # Torx work and let the browser keep its own local model.
    if not graph.get("nodes"):
        return {"error": "empty stress graph"}

    marginals = sample_graph(graph, seed)
    rollup = channel_rollup(graph, marginals)
    policy = evaluate_torx_policy(state, rollup)
    candidates = generate_candidates(state, graph, rollup)

    if not candidates:
        return {"error": "no candidates from stress graph"}

    ranked = sorted(candidates, key=lambda candidate: candidate["probability"], reverse=True)
    for item in ranked:
        item["probability"] = round(float(clamp(item["probability"], 0.05, 0.94)), 3)

    node_count = len(graph.get("nodes") or [])
    edge_count = len(graph.get("edges") or [])
    return {
        "provider": "torx-thrml",
        "forecast": ranked[0],
        "alternatives": ranked[1:4],
        "sampledRisks": {channel: rollup[channel]["mean"] for channel in CHANNELS if channel in rollup},
        "torxPolicy": policy,
        "explanation": [
            f"THRML sampled a {node_count}-node Ising graph over {edge_count} couplings, built from the settlement's own districts.",
            "Nodes are one pressure in one district; edges couple pressures locally and the same pressure between neighbours.",
            "Torx evaluated exploration, mixing, harvest, and vigil from those marginals plus live civic counts.",
            "The browser keeps the local forecast if this bridge is stopped.",
        ],
    }


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status: int = 200) -> None:
        origin = self.headers.get("origin", "http://127.0.0.1:5173")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", origin if "127.0.0.1" in origin or "localhost" in origin else "http://127.0.0.1:5173")
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
