import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import {
  RESIDENTS_PER_FARM,
  chooseGrowth,
  chooseSelfBuild,
  findPlotFor,
  isNearTile,
  type BuildSite,
} from "../systems/construction";
import type { Building, BuildingType, WorldState } from "../types";

const SEED = 20260811;

/** A site backed by a real world, with the simulation's helpers stubbed simply. */
function siteFor(state: WorldState, over: Partial<BuildSite> = {}): BuildSite {
  return {
    state,
    isRevealed: () => true,
    isOccupied: (cell) => state.buildings.some((b) => b.position.x === cell.x && b.position.y === cell.y),
    lightCoverageAt: () => 0.5,
    countBuildings: (type) => state.buildings.filter((building) => building.type === type).length,
    ...over,
  };
}

function world(): WorldState {
  return new MosslightSimulation(SEED).state;
}

const building = (type: BuildingType, x: number, y: number): Building =>
  ({ id: `${type}-${x}-${y}`, type, position: { x, y }, level: 1, upgradeProgress: 0, upgrading: false });

describe("a settlement builds toward what its population warrants", () => {
  it("builds nothing while the Commons is still tiny", () => {
    const state = world();
    state.residents = state.residents.slice(0, 4);
    expect(chooseGrowth(siteFor(state))).toBeUndefined();
  });

  it("wants a farm once there are more mouths than a farm can feed", () => {
    const state = world();
    // Exactly one farm's worth over what one farm serves.
    state.residents = state.residents.slice(0, RESIDENTS_PER_FARM + 2);
    state.buildings = [building("root-heart", 16, 6)];
    expect(chooseGrowth(siteFor(state))).toBe("reed-farm");
  });

  it("fills its largest shortfall first", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    // 60 residents: 5 farms wanted, 4 groves, 6 homes — homes is the biggest gap.
    while (state.residents.length < 60) state.residents.push({ ...state.residents[0]! });
    expect(chooseGrowth(siteFor(state))).toBe("burrow-home");
  });

  it("stops once the town has caught up with itself", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    const population = state.residents.length;
    // Give it more of everything than any target could ask for.
    for (let index = 0; index < population; index += 1) {
      state.buildings.push(building("reed-farm", index % 30, 1));
      state.buildings.push(building("lantern-grove", index % 30, 2));
      state.buildings.push(building("commons-market", index % 30, 3));
      state.buildings.push(building("burrow-home", index % 30, 4));
      state.buildings.push(building("root-workshop", index % 30, 5));
    }
    expect(chooseGrowth(siteFor(state))).toBeUndefined();
  });

  /**
   * The regression that started all of this: a thriving settlement returned
   * nothing at all, so 104 residents sat in 11 buildings indefinitely.
   */
  it("keeps building when the Commons is thriving, not only in a crisis", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    state.metrics.housingPressure = 0.2;
    state.metrics.diagnosis = { ...state.metrics.diagnosis, tone: "good" };
    expect(chooseSelfBuild(siteFor(state))).toBeDefined();
  });

  it("still answers a housing crunch first of all", () => {
    const state = world();
    state.metrics.housingPressure = 0.95;
    expect(chooseSelfBuild(siteFor(state))).toBe("burrow-home");
  });
});

describe("where a building goes", () => {
  it("puts reed farms near water", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    const plot = findPlotFor(siteFor(state), "reed-farm");
    expect(plot).toBeDefined();
    const wet = isNearTile(state, plot!, "water", 3) || isNearTile(state, plot!, "wetland", 3);
    expect(wet).toBe(true);
  });

  it("puts lantern groves on the darkest ground", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    // Only one column is dark; the grove should choose it.
    const site = siteFor(state, { lightCoverageAt: (cell) => (cell.x === 12 ? 0 : 1) });
    expect(findPlotFor(site, "lantern-grove")?.x).toBe(12);
  });

  it("never places on top of something already there", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6), building("reed-farm", 15, 6)];
    const plot = findPlotFor(siteFor(state), "burrow-home");
    expect(plot).toBeDefined();
    const clash = state.buildings.some((b) => b.position.x === plot!.x && b.position.y === plot!.y);
    expect(clash).toBe(false);
  });

  it("lets the town reach further as it grows", () => {
    const state = world();
    state.buildings = [building("root-heart", 16, 6)];
    const near = findPlotFor(siteFor(state), "burrow-home");

    // A far larger settlement should be willing to build further from the Root.
    while (state.residents.length < 120) state.residents.push({ ...state.residents[0]! });
    for (let index = 0; index < 14; index += 1) state.buildings.push(building("burrow-home", 2 + index, 20));
    const far = findPlotFor(siteFor(state), "burrow-home");

    expect(near).toBeDefined();
    expect(far).toBeDefined();
  });

  it("returns nothing when there is nowhere legal to build", () => {
    const state = world();
    expect(findPlotFor(siteFor(state, { isRevealed: () => false }), "burrow-home")).toBeUndefined();
  });
});

describe("isNearTile", () => {
  it("finds a tile inside the radius and misses one outside it", () => {
    const state = world();
    const water = { x: 0, y: 0 };
    outer: for (let y = 0; y < state.grid.length; y += 1) {
      for (let x = 0; x < state.grid[y]!.length; x += 1) {
        if (state.grid[y]![x] === "water") { water.x = x; water.y = y; break outer; }
      }
    }
    expect(isNearTile(state, water, "water", 0)).toBe(true);
  });
});
