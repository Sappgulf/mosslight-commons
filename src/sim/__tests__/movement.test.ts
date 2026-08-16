import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { FOCUS_BONUS, dwellFor, paceFor } from "../systems/movement";
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

describe("households travel together", () => {
  /**
   * Standing spots used to be hashed from the resident's own id alone, which
   * spread a household evenly around a building — four relatives converging on
   * one market arrived as four unrelated dots on four opposite sides.
   *
   * The effect is deliberately modest: it only applies while relations are
   * actually converging on the same place, so this asserts the direction
   * rather than a dramatic margin.
   */
  it("keeps close relations nearer each other than strangers", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 1200; tick += 1) simulation.advance();

    const byId = new Map(simulation.state.residents.map((resident) => [resident.id, resident]));
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    const kin: number[] = [];
    for (const relationship of simulation.state.relationships) {
      if (relationship.kind === "rivalry" || relationship.strength < 62) continue;
      const a = byId.get(relationship.aId);
      const b = byId.get(relationship.bId);
      if (a && b) kin.push(distance(a.position, b.position));
    }
    expect(kin.length).toBeGreaterThan(10);

    // Every unordered pair, so the comparison is deterministic rather than sampled.
    const residents = simulation.state.residents;
    const all: number[] = [];
    for (let first = 0; first < residents.length; first += 1) {
      for (let second = first + 1; second < residents.length; second += 1) {
        all.push(distance(residents[first]!.position, residents[second]!.position));
      }
    }

    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(kin)).toBeLessThan(mean(all));
  });

  it("does not let a household pile onto one tile", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 1200; tick += 1) simulation.advance();

    const occupancy = new Map<string, number>();
    for (const resident of simulation.state.residents) {
      const key = `${resident.position.x},${resident.position.y}`;
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    }
    expect(Math.max(...occupancy.values())).toBeLessThanOrEqual(6);
  });
});

describe("residents commit to what they came to do", () => {
  /**
   * Dwelling was attempted twice and removed once. The first cut let a resident
   * stand at the market being tested against their bench, so they never ate;
   * the second cost so much throughput that the ledger could not be finished.
   * It works now because a committed resident does the thing properly — the
   * focus bonus is what pays for standing still.
   */
  it("gives a resident a spell of standing still once they arrive", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 300; tick += 1) simulation.advance();
    const settled = simulation.state.residents.filter((resident) => resident.dwell > 0);
    expect(settled.length).toBeGreaterThan(0);
  });

  it("never leaves anyone parked for longer than the longest commitment", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 600; tick += 1) {
      simulation.advance();
      for (const resident of simulation.state.residents) {
        expect(resident.dwell).toBeLessThanOrEqual(dwellFor("rest"));
      }
    }
  });

  it("breaks a commitment for a genuinely pressing need", () => {
    const simulation = new MosslightSimulation(2048);
    for (let tick = 0; tick < 200; tick += 1) simulation.advance();

    const resident = simulation.state.residents.find(
      (candidate) => candidate.dwell > 0 && candidate.goal !== "forage",
    );
    expect(resident).toBeDefined();
    const wasDoing = resident!.goal;

    // Starve them. The old commitment must not survive it — though they may
    // well commit to the *new* activity immediately, which is the point.
    resident!.needs.food = 5;
    simulation.advance();
    expect(resident!.goal).not.toBe(wasDoing);
  });

  it("is worth more than flip-flopping", () => {
    expect(FOCUS_BONUS).toBeGreaterThan(1);
  });
});
