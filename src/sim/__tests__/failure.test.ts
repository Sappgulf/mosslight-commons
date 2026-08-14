import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import type { ResourceKey } from "../types";

const SEED = 2048;

function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

/** Empties every stockpile and keeps it empty, so hardship is unavoidable. */
function starve(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) {
    for (const resource of Object.keys(simulation.state.resources) as ResourceKey[]) {
      simulation.state.resources[resource] = 0;
    }
    simulation.advance();
  }
}

describe("the settlement can actually fail", () => {
  it("starts out standing", () => {
    const simulation = new MosslightSimulation(SEED);
    expect(simulation.state.status).not.toBe("collapsed");
    expect(simulation.state.residents.length).toBeGreaterThan(0);
  });

  it("degrades from thriving toward failing under sustained scarcity", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 10);
    const early = simulation.state.status;

    starve(simulation, 120);

    const rank = { thriving: 0, strained: 1, failing: 2, collapsed: 3 } as const;
    expect(rank[simulation.state.status]).toBeGreaterThan(rank[early]);
  });

  /**
   * Departure and collapse are separate clocks, and collapse is much the
   * faster one: four days of a failing settlement ends the run, while a
   * resident needs sustained personal hardship before giving up on the basin.
   * Emptying the stores therefore never produces a departure — it collapses the
   * Commons first. Residents leaving is a slow-burn outcome of an ordinary run.
   */
  it("loses residents over a long unmanaged run", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = simulation.state.residents.length;
    advance(simulation, 500);
    expect(simulation.state.departures).toBeGreaterThan(0);
    expect(simulation.state.residents.length).toBeLessThan(before);
  });

  it("collapses before anyone has time to leave when the stores are emptied", () => {
    const simulation = new MosslightSimulation(SEED);
    starve(simulation, 200);
    expect(simulation.state.status).toBe("collapsed");
    expect(simulation.state.departures).toBe(0);
  });

  it("collapses, and a collapsed world stops advancing", () => {
    const simulation = new MosslightSimulation(SEED);
    starve(simulation, 900);
    expect(simulation.state.status).toBe("collapsed");

    const frozenTick = simulation.state.tick;
    advance(simulation, 20);
    expect(simulation.state.tick).toBe(frozenTick);
  });

  it("records the collapse in the ledger", () => {
    const simulation = new MosslightSimulation(SEED);
    starve(simulation, 900);
    expect(simulation.state.history.some((message) => message.tone === "warning")).toBe(true);
  });
});

describe("tick pipeline", () => {
  /**
   * Order is load-bearing: residents read housing pressure, so metrics must be
   * recomputed before they act and again after population has changed. Pinning
   * the sequence makes a reshuffle a deliberate edit rather than a silent one.
   */
  it("runs stages in the recorded order", () => {
    expect(new MosslightSimulation(SEED).getPipelineOrder()).toMatchSnapshot();
  });

  it("refreshes metrics both before and after residents act", () => {
    const order = new MosslightSimulation(SEED).getPipelineOrder();
    expect(order.indexOf("metrics-pre")).toBeLessThan(order.indexOf("residents"));
    expect(order.indexOf("residents")).toBeLessThan(order.indexOf("metrics-post"));
  });

  it("settles production before anyone reads the stockpiles", () => {
    const order = new MosslightSimulation(SEED).getPipelineOrder();
    expect(order.indexOf("production")).toBeLessThan(order.indexOf("metrics-pre"));
    expect(order.indexOf("metrics-post")).toBeLessThan(order.indexOf("resource-warnings"));
  });
});
