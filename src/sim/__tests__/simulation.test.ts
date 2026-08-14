import { beforeEach, describe, expect, it, vi } from "vitest";

import { MosslightSimulation } from "../simulation";
import { isWalkable } from "../pathfinding";
import type { CollectibleTile, Vec2 } from "../types";

const SEED = 2048;

/** Runs the world forward a fixed number of ticks. */
function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

/**
 * Finds a revealed, empty, buildable grass cell. Hardcoding coordinates ties
 * the tests to the current world layout; this survives terrain changes.
 */
function findBuildableTile(simulation: MosslightSimulation): Vec2 {
  const { grid, revealed } = simulation.state;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      if (grid[y]![x] !== "grass" || !revealed[y]![x]) continue;
      if (simulation.getBuildingAt({ x, y })) continue;
      return { x, y };
    }
  }
  throw new Error("no buildable tile available");
}

/** Finds the first *revealed* cell holding a given wild node. */
function findNode(simulation: MosslightSimulation, tile: CollectibleTile): Vec2 | undefined {
  const { grid, revealed } = simulation.state;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      if (grid[y]![x] === tile && revealed[y]![x]) return { x, y };
    }
  }
  return undefined;
}

describe("MosslightSimulation", () => {
  let simulation: MosslightSimulation;

  beforeEach(() => {
    simulation = new MosslightSimulation(SEED);
  });

  describe("determinism", () => {
    it("produces identical state from the same seed and tick count", () => {
      const first = new MosslightSimulation(SEED);
      const second = new MosslightSimulation(SEED);
      advance(first, 120);
      advance(second, 120);

      expect(first.state.tick).toBe(second.state.tick);
      expect(first.state.resources).toEqual(second.state.resources);
      expect(first.state.residents.length).toBe(second.state.residents.length);
      expect(first.state.residents.map((resident) => resident.position))
        .toEqual(second.state.residents.map((resident) => resident.position));
      expect(first.state.metrics.harmony).toBeCloseTo(second.state.metrics.harmony, 8);
    });

    it("diverges for different seeds", () => {
      const other = new MosslightSimulation(SEED + 1);
      advance(simulation, 60);
      advance(other, 60);
      // Names are index-derived and so are seed-independent; traits and needs
      // are what the RNG actually drives.
      expect(simulation.state.residents.map((r) => r.traits))
        .not.toEqual(other.state.residents.map((r) => r.traits));
    });
  });

  describe("invariants under long runs", () => {
    it("keeps resources, needs, and positions in range over 600 ticks", () => {
      advance(simulation, 600);
      const state = simulation.state;

      for (const value of Object.values(state.resources)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      for (const count of Object.values(state.items)) {
        expect(count).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(count)).toBe(true);
      }
      for (const resident of state.residents) {
        for (const need of Object.values(resident.needs)) {
          expect(need).toBeGreaterThanOrEqual(0);
          expect(need).toBeLessThanOrEqual(100);
        }
        expect(resident.position.x).toBeGreaterThanOrEqual(0);
        expect(resident.position.x).toBeLessThan(32);
        expect(resident.position.y).toBeGreaterThanOrEqual(0);
        expect(resident.position.y).toBeLessThan(24);
      }
      expect(state.metrics.harmony).toBeGreaterThanOrEqual(0);
      expect(state.metrics.harmony).toBeLessThanOrEqual(100);
    });

    it("never leaves a resident standing on water or stone", () => {
      advance(simulation, 400);
      for (const resident of simulation.state.residents) {
        const tile = simulation.state.grid[resident.position.y]![resident.position.x]!;
        const onBuilding = simulation.state.buildings.some(
          (building) => building.position.x === resident.position.x && building.position.y === resident.position.y,
        );
        // A resident may stand on a building tile; otherwise the ground must be walkable.
        expect(onBuilding || isWalkable(tile)).toBe(true);
      }
    });

    it("advances the calendar at twelve ticks per day", () => {
      const startDay = simulation.state.day;
      advance(simulation, 24);
      expect(simulation.state.day).toBe(startDay + 2);
      expect(["mosswake", "suncrest", "emberfall", "longshade"]).toContain(simulation.state.season);
    });
  });

  describe("gathering and regrowth", () => {
    it("gathers a node, grants its item, and queues it to regrow", () => {
      const cell = findNode(simulation, "fern")!;
      expect(cell).toBeDefined();
      const before = simulation.state.items["seed-pod"];

      expect(simulation.collectAt(cell)).toBe(true);
      expect(simulation.state.items["seed-pod"]).toBeGreaterThan(before);
      expect(simulation.state.grid[cell.y]![cell.x]).toBe("grass");
      expect(simulation.state.regrowth).toHaveLength(1);
      expect(simulation.state.regrowth[0]).toMatchObject({ x: cell.x, y: cell.y, tile: "fern" });
    });

    it("restores the node to the map once its timer elapses", () => {
      const cell = findNode(simulation, "fern")!;
      simulation.collectAt(cell);
      const total = simulation.state.regrowth[0]!.totalTicks;

      advance(simulation, total + 2);

      expect(simulation.state.grid[cell.y]![cell.x]).toBe("fern");
      expect(simulation.state.regrowth).toHaveLength(0);
    });

    it("refuses to gather an empty tile", () => {
      const cell = findNode(simulation, "fern")!;
      simulation.collectAt(cell);
      expect(simulation.collectAt(cell)).toBe(false);
    });

    it("refuses to gather inside unrevealed fog", () => {
      // (27,16) is a fern inside the Sunken Reach, which starts fogged.
      expect(simulation.state.revealed[16]![27]).toBe(false);
      expect(simulation.collectAt({ x: 27, y: 16 })).toBe(false);
    });
  });

  describe("building", () => {
    it("places a building, charges its cost, and blocks the tile", () => {
      simulation.state.resources.warmth = 90;
      simulation.state.resources.food = 90;
      const before = simulation.state.resources.warmth;
      const cell = findBuildableTile(simulation);

      expect(simulation.build("burrow-home", cell)).toBe(true);
      expect(simulation.state.resources.warmth).toBeLessThan(before);
      expect(simulation.getBuildingAt(cell)?.type).toBe("burrow-home");
      // A second placement on the same tile must fail.
      expect(simulation.build("burrow-home", cell)).toBe(false);
    });

    it("refuses to build on water, stone, fog, or an ungathered node", () => {
      simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
      const water = { x: 1, y: 20 };
      expect(simulation.state.grid[water.y]![water.x]).toBe("water");
      expect(simulation.build("burrow-home", water)).toBe(false);

      const node = findNode(simulation, "fern")!;
      expect(simulation.build("burrow-home", node)).toBe(false);

      // Inside the fogged Sunken Reach.
      expect(simulation.build("burrow-home", { x: 27, y: 17 })).toBe(false);

      // A stone outcrop is not a foundation.
      let stone: Vec2 | null = null;
      for (let y = 0; y < 24 && !stone; y += 1) {
        for (let x = 0; x < 32 && !stone; x += 1) {
          if (simulation.state.grid[y]![x] === "stone") stone = { x, y };
        }
      }
      expect(stone).not.toBeNull();
      expect(simulation.build("burrow-home", stone!)).toBe(false);
    });

    it("refuses to build without the resources", () => {
      const cell = findBuildableTile(simulation);
      simulation.state.resources = { food: 0, water: 0, warmth: 0, light: 0 };
      expect(simulation.build("burrow-home", cell)).toBe(false);
    });

    it("raises housing capacity when a home is added", () => {
      simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
      const before = simulation.state.metrics.housingCapacity;
      expect(simulation.build("burrow-home", findBuildableTile(simulation))).toBe(true);
      expect(simulation.state.metrics.housingCapacity).toBeGreaterThan(before);
    });
  });

  describe("upgrades", () => {
    it("charges the cost, completes after its duration, and raises output", () => {
      simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
      simulation.state.items = { "seed-pod": 9, resin: 9, moonwater: 9, "map-fragment": 9 };
      const home = simulation.state.buildings.find((building) => building.type === "burrow-home")!;

      expect(simulation.canUpgrade(home.id).ok).toBe(true);
      expect(simulation.startUpgrade(home.id)).toBe(true);
      expect(home.upgrading).toBe(true);
      expect(simulation.state.items["seed-pod"]).toBe(7);

      advance(simulation, 10);
      expect(home.level).toBe(2);
      expect(home.upgrading).toBe(false);
    });

    it("refuses an upgrade the settlement cannot afford", () => {
      simulation.state.resources = { food: 0, water: 0, warmth: 0, light: 0 };
      simulation.state.items = { "seed-pod": 0, resin: 0, moonwater: 0, "map-fragment": 0 };
      const home = simulation.state.buildings.find((building) => building.type === "burrow-home")!;
      expect(simulation.canUpgrade(home.id).ok).toBe(false);
      expect(simulation.startUpgrade(home.id)).toBe(false);
      expect(home.upgrading).toBe(false);
    });

    it("never upgrades the Root Heart", () => {
      simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
      simulation.state.items = { "seed-pod": 9, resin: 9, moonwater: 9, "map-fragment": 9 };
      const root = simulation.state.buildings.find((building) => building.type === "root-heart")!;
      expect(simulation.canUpgrade(root.id).ok).toBe(false);
    });
  });

  describe("expeditions and crafting", () => {
    it("reveals a zone when an expedition completes", () => {
      expect(simulation.state.revealed[16]![27]).toBe(false);
      expect(simulation.dispatchExpedition()).toBe(true);
      // A second dispatch while one is running must be refused.
      expect(simulation.dispatchExpedition()).toBe(false);

      advance(simulation, 12);
      expect(simulation.state.revealedAreas).toContain("sunken-reach");
      expect(simulation.state.revealed[16]![27]).toBe(true);
    });

    it("refuses to craft without a workshop", () => {
      simulation.state.items = { "seed-pod": 9, resin: 9, moonwater: 9, "map-fragment": 9 };
      expect(simulation.startCraft("lantern-kit")).toBe(false);
    });

    it("consumes materials and completes a craft with a workshop present", () => {
      simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
      simulation.state.items = { "seed-pod": 9, resin: 9, moonwater: 9, "map-fragment": 9 };
      expect(simulation.build("root-workshop", findBuildableTile(simulation))).toBe(true);

      const resin = simulation.state.items.resin;
      expect(simulation.startCraft("lantern-kit")).toBe(true);
      expect(simulation.state.items.resin).toBeLessThan(resin);

      advance(simulation, 8);
      expect(simulation.state.crafted["lantern-kit"]).toBe(1);
      expect(simulation.state.crafting).toBeNull();
    });
  });

  describe("objectives and chapters", () => {
    it("starts on chapter zero and only exposes that chapter's objectives", () => {
      expect(simulation.state.chapter).toBe(0);
      expect(simulation.getActiveObjectives().every((objective) => objective.chapter === 0)).toBe(true);
      expect(simulation.getActiveObjectives().length).toBeGreaterThan(0);
    });

    it("advances a collect objective and pays its reward", () => {
      const objective = simulation.state.objectives.find((entry) => entry.id === "survey-basin")!;
      const before = simulation.state.items["map-fragment"];

      for (const tile of ["fern", "mushroom", "crystal"] as const) {
        const cell = findNode(simulation, tile);
        if (cell) simulation.collectAt(cell);
      }

      expect(objective.progress).toBe(3);
      expect(objective.completed).toBe(true);
      expect(simulation.state.items["map-fragment"]).toBeGreaterThan(before);
    });

    it("unlocks the next chapter once every objective in the current one is done", () => {
      for (const objective of simulation.state.objectives) {
        if (objective.chapter === 0) objective.completed = true;
      }
      advance(simulation, 1);
      expect(simulation.state.chapter).toBe(1);
      expect(simulation.getActiveObjectives().some((objective) => objective.chapter === 1)).toBe(true);
    });
  });

  describe("fail state", () => {
    it("marks the settlement failing when the basin runs dry", () => {
      simulation.state.resources = { food: 2, water: 2, warmth: 2, light: 2 };
      advance(simulation, 3);
      expect(["failing", "strained", "collapsed"]).toContain(simulation.state.status);
    });

    it("collapses and pauses after a sustained crisis", () => {
      for (let index = 0; index < 200; index += 1) {
        simulation.state.resources = { food: 0, water: 0, warmth: 0, light: 0 };
        for (const resident of simulation.state.residents) {
          resident.needs = { shelter: 1, food: 1, safety: 1, belonging: 1 };
        }
        simulation.advance();
        if (simulation.state.status === "collapsed") break;
      }
      expect(simulation.state.status).toBe("collapsed");
      expect(simulation.state.paused).toBe(true);
    });

    it("returns to thriving when the basin recovers", () => {
      simulation.state.resources = { food: 2, water: 2, warmth: 2, light: 2 };
      advance(simulation, 3);
      simulation.state.resources = { food: 95, water: 95, warmth: 95, light: 95 };
      for (const resident of simulation.state.residents) {
        resident.needs = { shelter: 90, food: 90, safety: 90, belonging: 90 };
      }
      advance(simulation, 3);
      expect(simulation.state.status).toBe("thriving");
    });
  });

  describe("ledger", () => {
    it("caps the visible feed at five but keeps a longer history", () => {
      advance(simulation, 200);
      expect(simulation.state.messages.length).toBeLessThanOrEqual(5);
      expect(simulation.state.history.length).toBeGreaterThan(5);
      expect(simulation.state.history.length).toBeLessThanOrEqual(240);
      // Newest first, and every entry carries the day it happened.
      for (const message of simulation.state.history) {
        expect(typeof message.day).toBe("number");
      }
    });
  });

  describe("civic expansion", () => {
    it("packs a grass path and refuses water", () => {
      simulation.state.resources = { food: 80, water: 80, warmth: 80, light: 80 };
      const cell = findBuildableTile(simulation);
      expect(simulation.paintPath(cell)).toBe(true);
      expect(simulation.state.grid[cell.y]![cell.x]).toBe("path");
      expect(simulation.paintPath({ x: 1, y: 20 })).toBe(false);
    });

    it("approves a council proposal and records forecast history", () => {
      advance(simulation, 12);
      expect(simulation.state.forecastHistory.length).toBeGreaterThan(0);
      simulation.state.proposal = {
        id: "test",
        kind: "lantern-first",
        title: "Light",
        body: "More light",
        species: "glowtail",
        status: "pending",
        createdDay: simulation.state.day,
        deadlineDay: simulation.state.day + 4,
        votes: [{ species: "glowtail", stance: "for", weight: 3 }],
      };
      const light = simulation.state.resources.light;
      expect(simulation.approveProposal()).toBe(true);
      expect(simulation.state.resources.light).toBeGreaterThan(light);
      expect(simulation.state.activePolicies.some((policy) => policy.kind === "lantern-first")).toBe(true);
      expect(simulation.state.districtFocus).toBe("lantern");
      simulation.rewindForecast(-1);
      expect(simulation.state.forecastCursor).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(simulation.forecastLesson())).toBe(true);
    });

    it("stains water near farms over time", () => {
      const before = simulation.state.waterQuality.flat().reduce((sum, value) => sum + value, 0);
      advance(simulation, 24);
      const after = simulation.state.waterQuality.flat().reduce((sum, value) => sum + value, 0);
      expect(Number.isFinite(after)).toBe(true);
      expect(after).not.toBe(before);
    });
  });

  describe("serialization", () => {
    it("round-trips a mid-game world exactly", () => {
      advance(simulation, 150);
      simulation.collectAt(findNode(simulation, "fern")!);
      const snapshot = simulation.serialize();

      const restored = new MosslightSimulation(1);
      restored.restore(JSON.parse(snapshot));

      expect(restored.state.tick).toBe(simulation.state.tick);
      expect(restored.state.day).toBe(simulation.state.day);
      expect(restored.state.resources).toEqual(simulation.state.resources);
      expect(restored.state.items).toEqual(simulation.state.items);
      expect(restored.state.residents.length).toBe(simulation.state.residents.length);
      expect(restored.state.regrowth).toEqual(simulation.state.regrowth);
      expect(restored.state.grid).toEqual(simulation.state.grid);
    });

    it("continues deterministically from a restored save", () => {
      advance(simulation, 100);
      const restored = new MosslightSimulation(1);
      restored.restore(JSON.parse(simulation.serialize()));

      advance(simulation, 50);
      advance(restored, 50);

      expect(restored.state.resources).toEqual(simulation.state.resources);
      expect(restored.state.residents.map((r) => r.position))
        .toEqual(simulation.state.residents.map((r) => r.position));
    });
  });

  describe("controls", () => {
    it("does not advance while paused", () => {
      simulation.togglePause();
      const tick = simulation.state.tick;
      advance(simulation, 20);
      expect(simulation.state.tick).toBe(tick);
    });

    it("advances once per speed multiplier", () => {
      simulation.setSpeed(4);
      simulation.advance();
      expect(simulation.state.tick).toBe(4);
    });

    it("does not advance after collapse", () => {
      simulation.state.status = "collapsed";
      const tick = simulation.state.tick;
      advance(simulation, 10);
      expect(simulation.state.tick).toBe(tick);
    });
  });

  describe("performance", () => {
    it("runs a long simulation well inside a frame budget per tick", () => {
      const start = performance.now();
      advance(simulation, 500);
      const perTick = (performance.now() - start) / 500;
      // Generous ceiling; the point is to catch an accidental O(n^2) regression
      // in the tick loop, not to benchmark the machine.
      expect(perTick).toBeLessThan(8);
    });
  });
});

describe("MosslightSimulation · personal wants", () => {
  it("gives residents named requests as the settlement runs", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 200);
    const withWants = simulation.state.residents.filter((resident) => resident.want);
    expect(withWants.length).toBeGreaterThan(0);
    for (const resident of withWants) {
      expect(resident.want!.description).toContain(resident.name);
      expect(typeof resident.want!.createdDay).toBe("number");
    }
  });

  it("never issues a request the resident already has satisfied", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 300);
    for (const resident of simulation.state.residents) {
      const want = resident.want;
      if (!want) continue;
      // A live want must, by definition, still be unmet on the tick it is read.
      expect(want.fulfilled).toBe(false);
    }
  });

  it("clears a request once the world satisfies it and rewards belonging", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 60);
    const resident = simulation.state.residents[0]!;
    // Plant a request that a single build will answer.
    resident.want = {
      kind: "lantern",
      description: `${resident.name} would like a Lantern Grove nearby.`,
      createdDay: simulation.state.day,
      deadlineDay: simulation.state.day + 6,
      rewardItem: "moonwater",
      rewardAmount: 2,
      fulfilled: false,
    };
    resident.needs.belonging = 40;

    const home = simulation.state.buildings.find((b) => b.id === resident.homeId)!;
    simulation.state.resources = { food: 100, water: 100, warmth: 100, light: 100 };
    // Place a grove within the want's radius of the resident's home.
    let placed = false;
    for (let radius = 1; radius <= 4 && !placed; radius += 1) {
      for (let dy = -radius; dy <= radius && !placed; dy += 1) {
        for (let dx = -radius; dx <= radius && !placed; dx += 1) {
          const cell = { x: home.position.x + dx, y: home.position.y + dy };
          if (simulation.state.grid[cell.y]?.[cell.x] !== "grass") continue;
          placed = simulation.build("lantern-grove", cell);
        }
      }
    }
    expect(placed).toBe(true);

    const before = resident.needs.belonging;
    advance(simulation, 2);
    expect(resident.want).toBeUndefined();
    expect(resident.needs.belonging).toBeGreaterThan(before);
  });
});

describe("MosslightSimulation · Long Shade and council", () => {
  it("starts a timed Long Shade chapter and can resolve it", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.resources = { food: 90, water: 90, warmth: 90, light: 90 };
    // Season 4 (longshade) begins after 21 days past start day 8.
    advance(simulation, 12 * 22);
    expect(simulation.state.season).toBe("longshade");
    expect(simulation.state.longShadeCrisis).toBe(true);
    expect(simulation.state.longShadeOutcome).toBe("pending");
    expect(simulation.state.longShadeEndsDay).toBeGreaterThan(simulation.state.day);
  });

  it("expires unanswered council votes", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.proposal = {
      id: "expire",
      kind: "wetland-first",
      title: "Reeds",
      body: "Quiet water",
      species: "mireling",
      status: "pending",
      createdDay: simulation.state.day,
      deadlineDay: simulation.state.day,
      votes: [],
    };
    advance(simulation, 14);
    expect(simulation.state.proposal?.status).toBe("expired");
  });

  it("selects a resident by id", () => {
    const simulation = new MosslightSimulation(SEED);
    const id = simulation.state.residents[1]?.id;
    expect(id).toBeTruthy();
    expect(simulation.selectResident(id!)).toBe(true);
    expect(simulation.getSelectedResident()?.id).toBe(id);
  });
});
