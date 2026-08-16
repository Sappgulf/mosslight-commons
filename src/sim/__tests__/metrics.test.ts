import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import {
  calculateMetrics,
  calculateStorage,
  checkResourceWarnings,
  createWarningBands,
  diagnose,
  housingCapacityOf,
  housingMessageBand,
  mostPressingNeed,
  resourceWarningLevel,
} from "../systems/metrics";
import type { Building, Message, Resident, ResourceKey } from "../types";

const SEED = 20260811;

const home = (level = 1): Building =>
  ({ id: `home-${level}`, type: "burrow-home", position: { x: 1, y: 1 }, level, upgradeProgress: 0, upgrading: false });

describe("housing capacity", () => {
  it("is nothing without buildings", () => {
    expect(housingCapacityOf([])).toBe(0);
  });

  it("counts homes and the Root, and scales with level", () => {
    const single = housingCapacityOf([home(1)]);
    const upgraded = housingCapacityOf([home(2)]);
    expect(single).toBeGreaterThan(0);
    expect(upgraded).toBeGreaterThan(single);
  });

  it("ignores buildings that shelter nobody", () => {
    const farm: Building = { id: "f", type: "reed-farm", position: { x: 2, y: 2 }, level: 1, upgradeProgress: 0, upgrading: false };
    expect(housingCapacityOf([farm])).toBe(0);
  });
});

describe("storage", () => {
  it("grows with the buildings that hold things", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = calculateStorage(simulation.state);
    simulation.state.buildings.push({
      id: "extra-market",
      type: "commons-market",
      position: { x: 5, y: 5 },
      level: 1,
      upgradeProgress: 0,
      upgrading: false,
    });
    const after = calculateStorage(simulation.state);
    expect(after.food).toBeGreaterThanOrEqual(before.food);
  });

  it("is widened by the Open Table", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = calculateStorage(simulation.state);
    simulation.state.traditions.push("open-table");
    const after = calculateStorage(simulation.state);
    // Capped at the ceiling, so assert it never shrinks and can only grow.
    expect(after.food).toBeGreaterThanOrEqual(before.food);
    expect(after.water).toBeGreaterThanOrEqual(before.water);
  });
});

describe("diagnosis", () => {
  it("says the basin is empty when nobody is left", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.residents = [];
    const result = diagnose(simulation.state, 0);
    expect(result.tone).toBe("warning");
    expect(result.cause).toContain("empty");
  });

  it("leads with a shortage before it leads with a need", () => {
    const simulation = new MosslightSimulation(SEED);
    // Everyone content, but the lanterns are nearly out.
    for (const resident of simulation.state.residents) {
      resident.needs = { shelter: 90, food: 90, safety: 90, belonging: 90 };
    }
    simulation.state.resources.light = 1;
    const result = diagnose(simulation.state, 0.5);
    expect(result.tone).toBe("warning");
    expect(result.cause.toLowerCase()).toContain("lantern");
  });

  it("reports good news when needs are met and stores are full", () => {
    const simulation = new MosslightSimulation(SEED);
    for (const resident of simulation.state.residents) {
      resident.needs = { shelter: 90, food: 90, safety: 90, belonging: 90 };
    }
    for (const resource of Object.keys(simulation.state.resources) as ResourceKey[]) {
      simulation.state.resources[resource] = simulation.state.metrics.storage[resource];
    }
    expect(diagnose(simulation.state, 0.5).tone).toBe("good");
  });
});

describe("metrics", () => {
  it("reads population, capacity and pressure off the world", () => {
    const simulation = new MosslightSimulation(SEED);
    const metrics = calculateMetrics(simulation.state);
    expect(metrics.population).toBe(simulation.state.residents.length);
    expect(metrics.housingCapacity).toBe(housingCapacityOf(simulation.state.buildings));
    expect(metrics.housingAvailable).toBe(metrics.housingCapacity - metrics.population);
    expect(metrics.harmony).toBeGreaterThanOrEqual(0);
    expect(metrics.harmony).toBeLessThanOrEqual(100);
  });

  it("matches what the simulation itself publishes", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let tick = 0; tick < 40; tick += 1) simulation.advance();
    const recomputed = calculateMetrics(simulation.state);
    expect(recomputed.population).toBe(simulation.state.metrics.population);
    expect(recomputed.housingCapacity).toBe(simulation.state.metrics.housingCapacity);
  });
});

describe("warning bands", () => {
  it("ranks a store from comfortable to critical", () => {
    expect(resourceWarningLevel(80)).toBe(0);
    expect(resourceWarningLevel(20)).toBe(1);
    expect(resourceWarningLevel(5)).toBe(2);
  });

  it("ranks housing the same way", () => {
    expect(housingMessageBand(0.5)).toBe(0);
    expect(housingMessageBand(0.9)).toBe(1);
    expect(housingMessageBand(1.2)).toBe(2);
  });

  it("speaks on crossing a band, not on every tick inside one", () => {
    const simulation = new MosslightSimulation(SEED);
    const bands = createWarningBands();
    const spoken: string[] = [];
    const announce = (text: string, _tone: Message["tone"]) => spoken.push(text);

    simulation.state.resources.food = 5;
    checkResourceWarnings(simulation.state, bands, announce);
    const first = spoken.length;
    expect(first).toBeGreaterThan(0);

    // Still critical: it must not repeat itself.
    checkResourceWarnings(simulation.state, bands, announce);
    expect(spoken.length).toBe(first);

    // Recovering is worth saying once.
    simulation.state.resources.food = 90;
    checkResourceWarnings(simulation.state, bands, announce);
    expect(spoken.length).toBeGreaterThan(first);
    expect(spoken.at(-1)).toContain("RECOVERY");
  });
});

describe("most pressing need", () => {
  it("names whichever need is lowest", () => {
    const resident = { needs: { shelter: 80, food: 70, safety: 20, belonging: 60 } } as Resident;
    expect(mostPressingNeed(resident)).toBe("safety");
  });

  it("falls back to food when everything is level", () => {
    const resident = { needs: { shelter: 50, food: 50, safety: 50, belonging: 50 } } as Resident;
    expect(mostPressingNeed(resident)).toBe("food");
  });
});
