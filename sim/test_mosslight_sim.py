"""Tests for the Torx + THRML sidecar.

There were none, which is how a three-gate circuit came to be handed two
parameters: `build_circuit` raised on every single request, the browser quietly
fell back to its local model exactly as designed, and nothing anywhere said the
research path had never once run.

Run with the project venv:

    .venv/bin/python -m pytest sim/test_mosslight_sim.py -q
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

import mosslight_sim as sim

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "payload.json")


@pytest.fixture(scope="module")
def payload() -> dict[str, Any]:
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def state(payload: dict[str, Any]) -> dict[str, Any]:
    return payload["state"]


def test_forecast_runs_end_to_end(payload: dict[str, Any]) -> None:
    result = sim.make_forecast(payload)
    assert result.get("provider") == "torx-thrml"
    assert result["forecast"]["title"]
    assert 0.05 <= result["forecast"]["probability"] <= 0.94
    assert result["forecast"]["drivers"]


def test_policy_has_all_four_axes(payload: dict[str, Any]) -> None:
    policy = sim.make_forecast(payload)["torxPolicy"]
    assert set(policy) == {"exploration", "social", "harvest", "vigil"}
    for value in policy.values():
        assert 0.0 <= value <= 1.0


def test_alternatives_rank_below_the_headline(payload: dict[str, Any]) -> None:
    result = sim.make_forecast(payload)
    lead = result["forecast"]["probability"]
    for alternative in result["alternatives"]:
        assert alternative["probability"] <= lead


def test_empty_graph_is_refused_rather_than_guessed() -> None:
    assert "error" in sim.make_forecast({"state": {"graph": {"nodes": [], "edges": []}}})


class TestLearnedCouplings:
    def test_fits_every_edge_from_a_long_history(self, state: dict[str, Any]) -> None:
        fitted, days = sim.learn_couplings(state["graph"], state["stressHistory"])
        assert days == len(state["stressHistory"])
        assert len(fitted) == len(state["graph"]["edges"])

    def test_moves_the_weights_off_the_declared_table(self, state: dict[str, Any]) -> None:
        fitted, _ = sim.learn_couplings(state["graph"], state["stressHistory"])
        changed = [
            edge
            for edge in state["graph"]["edges"]
            if abs(fitted[(edge["a"], edge["b"])] - float(edge["weight"])) > 0.01
        ]
        assert changed, "learning that never changes a weight is not learning"

    def test_falls_back_when_the_history_is_too_short(self, state: dict[str, Any]) -> None:
        fitted, days = sim.learn_couplings(state["graph"], state["stressHistory"][:3])
        assert fitted == {}
        assert days == 3

    def test_survives_a_channel_that_never_moved(self, state: dict[str, Any]) -> None:
        # A basin never short of water has told us nothing about water; that is
        # a zero correlation, not a divide-by-zero.
        flat = [{"food": 0.5, "water": 0.5} for _ in range(20)]
        fitted, _ = sim.learn_couplings(state["graph"], flat)
        assert all(value == value for value in fitted.values())  # no NaN

    def test_keeps_every_weight_inside_sampling_bounds(self, state: dict[str, Any]) -> None:
        fitted, _ = sim.learn_couplings(state["graph"], state["stressHistory"])
        assert all(0.02 <= value <= 0.9 for value in fitted.values())


class TestTrainedCircuit:
    def _fit(self, curiosity: float, community: float):
        from torx import psc

        import jax.numpy as jnp

        circuit = psc.DiscretePCircuit([psc.PNOT(0), psc.PCNOT([0, 1]), psc.PNOT(1)])
        simulator = psc.StateVectorSimulator()
        initial = jnp.asarray([curiosity, 0.5, community])
        return simulator, circuit, initial

    def test_training_moves_the_parameters(self) -> None:
        simulator, circuit, initial = self._fit(0.2, 0.8)
        trained, steps = sim.train_thetas(simulator, circuit, initial, 0.9, 0.1)
        assert steps == sim.TRAIN_STEPS
        assert any(abs(float(a) - float(b)) > 1e-4 for a, b in zip(trained, initial))

    def test_training_reduces_the_loss(self) -> None:
        simulator, circuit, initial = self._fit(0.2, 0.8)
        target_curiosity, target_community = 0.9, 0.1

        def loss(thetas) -> float:
            density = sim.circuit_density(simulator, circuit, thetas)
            exploration = float(density[2] + density[3])
            social = float(density[0] + density[1])
            return (exploration - target_curiosity) ** 2 + (social - target_community) ** 2

        trained, _ = sim.train_thetas(simulator, circuit, initial, target_curiosity, target_community)
        assert loss(trained) <= loss(initial)

    def test_parameters_stay_in_range(self) -> None:
        simulator, circuit, initial = self._fit(0.05, 0.95)
        trained, _ = sim.train_thetas(simulator, circuit, initial, 1.0, 0.0)
        assert all(0.0 <= float(value) <= 1.0 for value in trained)
