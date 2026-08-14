import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import type { RecipeKey, Vec2 } from "../types";

const SEED = 2048;
const COLLECTIBLE = new Set(["fern", "mushroom", "crystal", "ruin"]);
const RECIPES: RecipeKey[] = ["bridge-kit", "lantern-kit", "comfort-kit", "sky-lantern"];

function revealedNodes(simulation: MosslightSimulation): Vec2[] {
  const found: Vec2[] = [];
  const { grid, revealed } = simulation.state;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      if (COLLECTIBLE.has(grid[y]![x]!) && revealed[y]![x]) found.push({ x, y });
    }
  }
  return found;
}

function buildablePlot(simulation: MosslightSimulation): Vec2 | undefined {
  const { grid, revealed } = simulation.state;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      if (grid[y]![x] !== "grass" || !revealed[y]![x]) continue;
      if (simulation.getBuildingAt({ x, y })) continue;
      return { x, y };
    }
  }
  return undefined;
}

/**
 * Plays the game the way a thorough player would: gather everything on offer,
 * raise the workshop, keep a scout out, craft what the stores allow, upgrade
 * what can be upgraded, and pack roads once the ledger asks for them.
 */
function playThrough(simulation: MosslightSimulation, ticks: number): void {
  let workshop = false;
  for (let index = 0; index < ticks; index += 1) {
    for (const node of revealedNodes(simulation)) simulation.collectAt(node);

    if (!workshop) {
      const plot = buildablePlot(simulation);
      if (plot && simulation.build("root-workshop", plot)) workshop = true;
    }
    simulation.dispatchExpedition();
    // Once the Sky Veil is on the ledger, hold materials for it instead of
    // burning every last resin and map on comfort kits.
    if (simulation.state.chapter < 3 || simulation.state.traditions.includes("sky-veil")) {
      for (const recipe of RECIPES) simulation.startCraft(recipe);
    }
    for (const building of simulation.state.buildings) {
      if (simulation.canUpgrade(building.id).ok) {
        simulation.startUpgrade(building.id);
        break;
      }
    }
    if (simulation.state.chapter >= 3) {
      const plot = buildablePlot(simulation);
      if (plot) simulation.paintPath(plot);
    }
    if (simulation.state.chapter >= 4) {
      const plot = buildablePlot(simulation);
      if (plot) simulation.build("sky-walk", plot);
    }
    for (const key of ["seed-vault", "open-table", "hearthcraft", "lantern-vigil", "long-memory", "sky-veil"] as const) {
      simulation.adoptTradition(key);
    }
    simulation.advance();
  }
}

describe("the game can be finished", () => {
  /**
   * The headline guarantee, and one nothing checked before: a played game
   * reaches the end of its own ledger. It could not — two separate objectives
   * were unreachable in a way that only showed up by playing the whole thing.
   */
  it("completes every objective and reaches the last chapter", () => {
    const simulation = new MosslightSimulation(SEED);
    playThrough(simulation, 1200);

    const open = simulation.state.objectives.filter((objective) => !objective.completed);
    expect(open.map((objective) => objective.id)).toEqual([]);
    expect(simulation.state.chapter).toBe(4);
    expect(simulation.isLedgerComplete()).toBe(true);
  });

  it("opens each chapter in turn rather than skipping any", () => {
    const simulation = new MosslightSimulation(SEED);
    const seen = new Set<number>([simulation.state.chapter]);
    for (let index = 0; index < 1200; index += 1) {
      playThrough(simulation, 1);
      seen.add(simulation.state.chapter);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("nothing the player is asked to do locks them out", () => {
  /**
   * A Root Workshop used to consume every resin in stock, a resin a tick,
   * pinning it at zero eight ticks after it went up. Glow Kits and Comfort
   * Bundles both need resin in hand, so raising the workshop — a chapter-zero
   * objective — permanently blocked the chapter-one objective asking for two
   * Glow Kits.
   */
  it("leaves resin to craft with after a workshop is raised", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let index = 0; index < 60; index += 1) simulation.advance();

    simulation.state.resources = { food: 90, water: 90, warmth: 90, light: 90 };
    simulation.state.items["map-fragment"] = 5;
    simulation.state.items.resin = 10;
    simulation.state.items.moonwater = 5;
    expect(simulation.build("root-workshop", buildablePlot(simulation)!)).toBe(true);

    for (let index = 0; index < 40; index += 1) simulation.advance();

    expect(simulation.state.items.resin).toBeGreaterThan(0);
    expect(simulation.startCraft("lantern-kit")).toBe(true);
  });

  /**
   * Expeditions only ever target an unrevealed zone, and crafting a Root Bridge
   * reveals the Old Hollow outright — so the bridge the chapter-one ledger asks
   * for left "Open the Old Hollow" permanently stuck at 0/1.
   */
  it("credits a zone objective however the zone was opened", () => {
    const simulation = new MosslightSimulation(SEED);
    playThrough(simulation, 500);

    const hollow = simulation.state.objectives.find((objective) => objective.id === "open-old-hollow")!;
    expect(simulation.state.revealedAreas).toContain("old-hollow");
    expect(hollow.completed).toBe(true);
  });

  it("keeps a zone objective credited once its chapter opens later", () => {
    const simulation = new MosslightSimulation(SEED);
    // Reveal the zone long before the chapter that asks for it exists.
    playThrough(simulation, 200);
    expect(simulation.state.revealedAreas.length).toBeGreaterThan(0);

    playThrough(simulation, 400);
    const zoneObjectives = simulation.state.objectives.filter((objective) => objective.kind === "expedition");
    for (const objective of zoneObjectives) {
      if (simulation.state.revealedAreas.includes(objective.zone!)) {
        expect(objective.completed).toBe(true);
      }
    }
  });
});
