#!/usr/bin/env python3
"""Local Torx + THRML forecast service for Mosslight Commons."""

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


def mean_need(residents: list[dict[str, Any]], key: str) -> float:
    if not residents:
        return 50.0
    values = [float((resident.get("needs") or {}).get(key, 50)) for resident in residents]
    return sum(values) / len(values)


def sample_resource_risks(state: dict[str, Any], seed: int) -> dict[str, float]:
    """Sample correlated shortage and civic-stress states with a THRML Ising model."""

    resources = state.get("resources") or {}
    metrics = state.get("metrics") or {}
    residents = state.get("residents") or []
    season = state.get("season", "mosswake")

    food_need = 1.0 - clamp(mean_need(residents, "food") / 100.0)
    shelter_need = 1.0 - clamp(mean_need(residents, "shelter") / 100.0)
    housing = clamp(float(metrics.get("housingPressure", 0)))
    shade = 0.55 if season == "longshade" else 0.12 if season == "emberfall" else 0.05

    names = ["food", "water", "warmth", "light", "housing", "shade"]
    shortage = [
        1.0 - clamp(float(resources.get("food", 50)) / 100.0) * 0.65 + food_need * 0.35,
        1.0 - clamp(float(resources.get("water", 50)) / 100.0),
        1.0 - clamp(float(resources.get("warmth", 50)) / 100.0) * 0.7 + shelter_need * 0.3,
        1.0 - clamp(float(resources.get("light", 50)) / 100.0),
        housing,
        shade,
    ]
    shortage = [clamp(value) for value in shortage]

    nodes = [SpinNode() for _ in names]
    edges = [(nodes[index], nodes[index + 1]) for index in range(len(nodes) - 1)]
    # Couple food↔housing and light↔shade so the graph is not a single chain.
    edges.extend([(nodes[0], nodes[4]), (nodes[3], nodes[5])])
    biases = jnp.asarray([(value - 0.35) * 2.6 for value in shortage])
    weights = jnp.ones((len(edges),)) * 0.32
    model = IsingEBM(nodes, edges, biases, weights, jnp.array(1.0))
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
    return {name: round(float(probabilities[index]), 3) for index, name in enumerate(names)}


def evaluate_torx_policy(state: dict[str, Any], risks: dict[str, float]) -> dict[str, float]:
    """Evaluate a parameterized stochastic circuit for four civic axes."""

    moths = sum(1 for resident in state.get("residents") or [] if resident.get("species") == "cloudmoth")
    harmony = clamp(float((state.get("metrics") or {}).get("harmony", 50)) / 100.0)
    district = state.get("districtFocus", "market")

    curiosity = 0.35 + risks["light"] * 0.45 + risks["shade"] * 0.25 - risks["food"] * 0.3
    community = 0.28 + risks["water"] * 0.35 + harmony * 0.4 + (0.12 if district == "market" else 0.0)
    harvest = 0.3 + risks["food"] * 0.55 + risks["housing"] * 0.15
    vigil = 0.22 + risks["light"] * 0.4 + risks["shade"] * 0.35 + min(0.2, moths * 0.04)

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


def make_forecast(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get("state", payload)
    seed = int(state.get("tick", 0)) + int(state.get("seed", 2048))
    risks = sample_resource_risks(state, seed)
    policy = evaluate_torx_policy(state, risks)
    season = state.get("season", "mosswake")
    chapter = int(state.get("chapter", 0))
    metrics = state.get("metrics") or {}
    buildings = state.get("buildings") or []
    farm_count = sum(1 for building in buildings if building.get("type") == "reed-farm")
    grove_count = sum(1 for building in buildings if building.get("type") == "lantern-grove")
    walk_count = sum(1 for building in buildings if building.get("type") == "sky-walk")
    moths = sum(1 for resident in state.get("residents") or [] if resident.get("species") == "cloudmoth")
    status = state.get("status", "thriving")

    candidates = [
        {
            "title": "Empty Shelves",
            "probability": clamp(0.08 + risks["food"] * 0.7 + risks["housing"] * 0.12),
            "window": "next 2 days",
            "drivers": [
                f"THRML food-shortage mass {risks['food']:.0%}",
                f"{farm_count} Reed Farms feeding {int(metrics.get('population', 0))} residents",
                "Torx harvest signal is asking for more stalls",
            ],
            "recommendation": "Raise a Reed Farm or answer a food petition before the stalls empty.",
            "tone": "warning",
        },
        {
            "title": "Wetland Warning",
            "probability": clamp(0.08 + risks["water"] * 0.68),
            "window": "next 2 days",
            "drivers": [
                f"THRML water-shortage mass {risks['water']:.0%}",
                "Mireling health is coupled to basin quality",
                f"season is {season}",
            ],
            "recommendation": "Give the Mirelings quiet water and keep farms off the last reed bank.",
            "tone": "warning",
        },
        {
            "title": "Lantern Festival",
            "probability": clamp(0.1 + (1.0 - risks["light"]) * 0.35 + policy["social"] * 0.4),
            "window": "next 3 days",
            "drivers": [
                f"Torx social signal {policy['social']:.0%}",
                f"{grove_count} lantern groves, harmony {int(metrics.get('harmony', 0))}%",
                "the market is an active gathering point",
            ],
            "recommendation": "Keep the market open and let the neighborhoods mix.",
            "tone": "bright",
        },
        {
            "title": "Unmapped Burrow",
            "probability": clamp(0.12 + policy["exploration"] * 0.62),
            "window": "this week",
            "drivers": [
                f"Torx exploration signal {policy['exploration']:.0%}",
                "Bramblebacks are leaving their usual routes",
                f"chapter {chapter} still has ground to chart",
            ],
            "recommendation": "Inspect the new route before building over it.",
            "tone": "calm",
        },
        {
            "title": "Long Shade Crossing",
            "probability": clamp(0.1 + risks["shade"] * 0.55 + policy["vigil"] * 0.28 + (0.12 if moths == 0 else 0.0)),
            "window": "this season",
            "drivers": [
                f"THRML shade mass {risks['shade']:.0%}",
                f"Torx vigil {policy['vigil']:.0%} · {moths} Cloudmoths present",
                f"{walk_count} Sky Walks hung above the basin",
            ],
            "recommendation": "Hang a Sky Walk, craft a Sky Lantern, and keep the groves lit.",
            "tone": "warning",
        },
        {
            "title": "Canopy Hosting",
            "probability": clamp(0.08 + moths * 0.08 + walk_count * 0.12 + policy["vigil"] * 0.25),
            "window": "next 4 days",
            "drivers": [
                f"{moths} Cloudmoths reading the weather",
                f"Torx vigil {policy['vigil']:.0%}",
                "a hanging walkway is how they stay",
            ],
            "recommendation": "Adopt the Sky Veil and give the moths a Sky Walk.",
            "tone": "calm",
        },
    ]
    if status in {"strained", "failing"}:
        candidates.append(
            {
                "title": "Commons Strain",
                "probability": clamp(0.4 + (0.2 if status == "failing" else 0.0) + risks["housing"] * 0.2),
                "window": "now",
                "drivers": [
                    f"settlement status is {status}",
                    f"THRML housing pressure {risks['housing']:.0%}",
                    "departures will start if stores and burrows stay thin",
                ],
                "recommendation": "Answer the Commons Report: the need it names is the one that is failing.",
                "tone": "warning",
            }
        )

    ranked = sorted(candidates, key=lambda candidate: candidate["probability"], reverse=True)
    for item in ranked:
        item["probability"] = round(float(clamp(item["probability"], 0.05, 0.94)), 3)
    forecast = ranked[0]
    return {
        "provider": "torx-thrml",
        "forecast": forecast,
        "alternatives": ranked[1:3],
        "sampledRisks": risks,
        "torxPolicy": policy,
        "explanation": [
            "THRML sampled a six-node Ising graph: stores, housing, and shade.",
            "Torx evaluated exploration, mixing, harvest, and vigil from that graph plus live civic counts.",
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
