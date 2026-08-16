import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { paceFor } from "../systems/movement";
import type { Resident } from "../types";

const walker = (over: Partial<Resident> = {}): Resident =>
  ({
    species: "brambleback",
    stage: "adult",
    goal: "work",
    ...over,
  }) as Resident;

describe("residents do not all walk at the same speed", () => {
  it("moves the young quicker than the old", () => {
    const sprout = paceFor(walker({ stage: "sprout" }));
    const adult = paceFor(walker({ stage: "adult" }));
    const elder = paceFor(walker({ stage: "elder" }));
    expect(sprout).toBeGreaterThan(adult);
    expect(adult).toBeGreaterThan(elder);
  });

  it("gives each species its own gait", () => {
    const paces = (["brambleback", "glowtail", "mireling", "cloudmoth"] as const).map((species) =>
      paceFor(walker({ species })),
    );
    expect(new Set(paces).size).toBe(paces.length);
    // The patient grower is the slowest; the explorer and the drifter are quick.
    expect(paceFor(walker({ species: "mireling" }))).toBeLessThan(paceFor(walker({ species: "glowtail" })));
  });

  it("moves differently depending on what they are doing", () => {
    expect(paceFor(walker({ goal: "explore" }))).toBeGreaterThan(paceFor(walker({ goal: "rest" })));
  });

  it("never stalls a resident completely", () => {
    const slowest = paceFor(walker({ species: "mireling", stage: "elder", goal: "rest" }));
    expect(slowest).toBeGreaterThan(0.3);
  });

  it("spreads a real settlement across many speeds", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 600; tick += 1) simulation.advance();

    const paces = simulation.state.residents.map((resident) => paceFor(resident));
    const fastest = Math.max(...paces);
    const slowest = Math.min(...paces);
    // Before this everyone moved exactly one tile a tick, so the ratio was 1.
    expect(fastest / slowest).toBeGreaterThan(1.8);
    expect(new Set(paces.map((pace) => pace.toFixed(2))).size).toBeGreaterThan(5);
  });

  it("banks the remainder so a slow walker still gets there", () => {
    const simulation = new MosslightSimulation(2048);
    const resident = simulation.state.residents[0]!;
    resident.moveCredit = 0;
    // Half-steps must accumulate rather than being discarded each tick.
    for (let tick = 0; tick < 40; tick += 1) simulation.advance();
    expect(resident.moveCredit).toBeGreaterThanOrEqual(0);
    expect(resident.moveCredit).toBeLessThan(1);
  });
});
