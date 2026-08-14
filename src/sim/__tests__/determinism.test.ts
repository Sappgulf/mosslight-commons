import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import type { WorldState } from "../types";

const SEED = 2048;

function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

/**
 * A stable, order-independent digest of everything the player can observe.
 *
 * Floats are rounded, because the point is to catch a balance or ordering
 * change, not to assert that arithmetic is bit-identical across engines.
 */
function digest(state: WorldState): string {
  return JSON.stringify({
    tick: state.tick,
    day: state.day,
    season: state.season,
    phase: state.phase,
    status: state.status,
    chapter: state.chapter,
    resources: Object.fromEntries(
      Object.entries(state.resources).map(([key, value]) => [key, Math.round(value * 100)]),
    ),
    items: state.items,
    population: state.residents.length,
    births: state.births,
    departures: state.departures,
    buildings: state.buildings
      .map((building) => `${building.type}@${building.position.x},${building.position.y}:${building.level}`)
      .sort(),
    residents: state.residents
      .map((resident) => `${resident.name}:${resident.species}:${resident.stage}:${Math.round(resident.age)}`)
      .sort(),
    relationships: state.relationships.length,
    objectives: state.objectives.map((objective) => `${objective.id}:${objective.progress}/${objective.target}`),
    harmony: Math.round(state.metrics.harmony),
    wellbeing: Math.round(state.metrics.averageWellbeing),
  });
}

describe("determinism", () => {
  it("produces an identical world from the same seed", () => {
    const a = new MosslightSimulation(SEED);
    const b = new MosslightSimulation(SEED);
    advance(a, 500);
    advance(b, 500);
    expect(digest(a.state)).toBe(digest(b.state));
  });

  it("diverges on a different seed", () => {
    const a = new MosslightSimulation(SEED);
    const b = new MosslightSimulation(SEED + 1);
    advance(a, 300);
    advance(b, 300);
    expect(digest(a.state)).not.toBe(digest(b.state));
  });

  /**
   * The golden test. This does not assert that any particular number is
   * *correct* — it asserts that a change to simulation rules, tick ordering, or
   * RNG draw order is deliberate. When this fails, either the change was
   * intended (re-record it) or something reordered the world by accident.
   */
  it("matches the recorded 500-tick snapshot", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 500);
    expect(digest(simulation.state)).toMatchSnapshot();
  });

  it("splitting the run in two reaches the same world as one continuous run", () => {
    const continuous = new MosslightSimulation(SEED);
    advance(continuous, 400);

    const split = new MosslightSimulation(SEED);
    advance(split, 150);
    advance(split, 250);

    expect(digest(split.state)).toBe(digest(continuous.state));
  });

  it("pausing does not advance the world", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 100);
    const before = digest(simulation.state);

    simulation.togglePause();
    advance(simulation, 50);

    // Pausing writes a ledger line, so compare the world digest, not the ledger.
    expect(digest(simulation.state)).toBe(before);
  });

  it("advances speed times per call", () => {
    const single = new MosslightSimulation(SEED);
    advance(single, 40);

    const quad = new MosslightSimulation(SEED);
    quad.setSpeed(4);
    advance(quad, 10);

    expect(quad.state.tick).toBe(single.state.tick);
  });
});
