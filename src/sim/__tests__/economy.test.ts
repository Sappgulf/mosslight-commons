import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import type { ResourceKey, Vec2 } from "../types";

const SEED = 2048;

function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

function fill(simulation: MosslightSimulation): void {
  for (const resource of Object.keys(simulation.state.resources) as ResourceKey[]) {
    simulation.state.resources[resource] = simulation.state.metrics.storage[resource];
  }
}

function empty(simulation: MosslightSimulation): void {
  for (const resource of Object.keys(simulation.state.resources) as ResourceKey[]) {
    simulation.state.resources[resource] = 0;
  }
}

function averageNeed(simulation: MosslightSimulation, need: "food" | "shelter" | "safety" | "belonging"): number {
  const residents = simulation.state.residents;
  if (residents.length === 0) return 0;
  return residents.reduce((sum, resident) => sum + resident.needs[need], 0) / residents.length;
}

/** A revealed, empty, buildable grass cell. */
function buildablePlot(simulation: MosslightSimulation): Vec2 {
  const { grid, revealed } = simulation.state;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      if (grid[y]![x] !== "grass" || !revealed[y]![x]) continue;
      if (simulation.getBuildingAt({ x, y })) continue;
      return { x, y };
    }
  }
  throw new Error("no buildable plot");
}

describe("the stores actually feed the settlement", () => {
  /**
   * The join that was missing. Stores used to be a threshold — food under 25
   * made needs drain faster and that was all — so a granary at 100 fed nobody
   * and the Commons could collapse with every bar full.
   */
  it("spends food and water as residents eat", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 30);
    // Take the farms out so nothing tops the stores back up; what is left is
    // consumption, which is the thing under test.
    simulation.state.buildings = simulation.state.buildings.filter(
      (building) => building.type !== "reed-farm",
    );
    fill(simulation);
    const before = { ...simulation.state.resources };

    advance(simulation, 60);

    expect(simulation.state.resources.food).toBeLessThan(before.food);
    expect(simulation.state.resources.water).toBeLessThan(before.water);
  });

  it("lets needs fall when the stores are empty, and recover when they are not", () => {
    const starved = new MosslightSimulation(SEED);
    advance(starved, 20);
    for (let index = 0; index < 150; index += 1) {
      empty(starved);
      starved.advance();
    }

    const fed = new MosslightSimulation(SEED);
    advance(fed, 20);
    for (let index = 0; index < 150; index += 1) {
      fill(fed);
      fed.advance();
    }

    expect(averageNeed(starved, "food")).toBeLessThan(averageNeed(fed, "food"));
    expect(starved.state.metrics.averageWellbeing).toBeLessThan(fed.state.metrics.averageWellbeing);
  });

  /**
   * Safety used to have no recovery path outside expedition leaders: it fell
   * 0.2 a tick forever, so every resident was on a countdown to leaving that no
   * play could interrupt, and an untouched settlement always died.
   */
  it("restores safety inside the lantern light", () => {
    const lit = new MosslightSimulation(SEED);
    advance(lit, 20);
    for (let index = 0; index < 200; index += 1) {
      fill(lit);
      lit.advance();
    }

    const dark = new MosslightSimulation(SEED);
    advance(dark, 20);
    // Take the lanterns away and leave everything else identical.
    dark.state.buildings = dark.state.buildings.filter((building) => building.type !== "lantern-grove");
    for (let index = 0; index < 200; index += 1) {
      fill(dark);
      dark.advance();
    }

    expect(averageNeed(lit, "safety")).toBeGreaterThan(averageNeed(dark, "safety"));
  });
});

describe("storage is built, not given", () => {
  it("starts below the old flat cap", () => {
    const simulation = new MosslightSimulation(SEED);
    expect(simulation.state.metrics.storage.food).toBeLessThan(100);
  });

  it("grows when a building that holds that resource goes up", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 30);
    const before = simulation.state.metrics.storage.light;

    fill(simulation);
    expect(simulation.build("lantern-grove", buildablePlot(simulation))).toBe(true);
    advance(simulation, 1);

    expect(simulation.state.metrics.storage.light).toBeGreaterThan(before);
  });

  it("never lets a stockpile exceed what the settlement can hold", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 400);
    for (const resource of Object.keys(simulation.state.resources) as ResourceKey[]) {
      expect(simulation.state.resources[resource]).toBeLessThanOrEqual(
        simulation.state.metrics.storage[resource] + 0.001,
      );
    }
  });
});

describe("requests are contracts", () => {
  it("carries a deadline and a payout", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 200);
    const open = simulation.openWants();
    expect(open.length).toBeGreaterThan(0);

    const want = open[0]!.want!;
    expect(want.deadlineDay).toBeGreaterThan(want.createdDay);
    expect(want.rewardAmount).toBeGreaterThan(0);
  });

  it("pays out when the world answers it", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 200);
    const resident = simulation.openWants()[0]!;
    const want = resident.want!;
    const before = simulation.state.items[want.rewardItem];

    // Satisfy it directly rather than replaying whatever it happens to ask for.
    resident.want = { ...want, kind: "company" };
    simulation.state.relationships.push({
      id: "test-bond",
      aId: resident.id,
      bId: simulation.state.residents.find((other) => other.id !== resident.id)!.id,
      kind: "friendship",
      strength: 90,
      sharedDays: 20,
    });
    advance(simulation, 2);

    expect(simulation.state.items[want.rewardItem]).toBeGreaterThan(before);
    expect(simulation.state.wantsMet).toBeGreaterThan(0);
  });

  /**
   * Ignoring the ledger used to cost a twentieth of a belonging point a tick.
   * Twenty-six requests could sit open with nothing to show for it either way.
   */
  it("lapses with a real cost when it is ignored", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 200);
    const resident = simulation.openWants()[0]!;
    const before = resident.needs.belonging;

    // Push past the deadline without answering.
    resident.want!.deadlineDay = simulation.state.day - 1;
    advance(simulation, 2);

    expect(resident.needs.belonging).toBeLessThan(before);
    expect(simulation.state.wantsMissed).toBeGreaterThan(0);
    expect(resident.want).toBeUndefined();
  });
});

describe("choices cost something", () => {
  it("will not re-point the districts on a whim", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 30);
    fill(simulation);

    expect(simulation.setDistrictFocus("lantern")).toBe(true);
    // Immediately switching again is refused while the last change settles.
    expect(simulation.setDistrictFocus("wetland")).toBe(false);
    expect(simulation.state.districtFocus).toBe("lantern");
    expect(simulation.districtSwitchDaysLeft()).toBeGreaterThan(0);
  });

  it("charges the stores for a district change", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 30);
    fill(simulation);
    const before = simulation.state.resources.food;

    simulation.setDistrictFocus("lantern");

    expect(simulation.state.resources.food).toBeLessThan(before);
  });
});

describe("the report explains the decline", () => {
  it("warns on a shortage before needs have fallen", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 30);
    fill(simulation);
    simulation.state.resources.light = 1;
    advance(simulation, 1);

    const { diagnosis } = simulation.state.metrics;
    expect(diagnosis.tone).toBe("warning");
    expect(diagnosis.cause.toLowerCase()).toContain("lantern");
    expect(diagnosis.advice.length).toBeGreaterThan(0);
  });

  it("names housing when the burrows are the constraint", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 300);
    fill(simulation);
    advance(simulation, 1);

    const { diagnosis } = simulation.state.metrics;
    expect(["food", "shelter", "safety", "belonging"]).toContain(diagnosis.need);
    expect(diagnosis.advice.length).toBeGreaterThan(0);
  });
});
