import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { bestCraft, inheritedSkills, tierFor } from "../mastery";
import type { Resident } from "../types";

const SEED = 2048;

function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

function averageTier(simulation: MosslightSimulation): number {
  const residents = simulation.state.residents;
  if (residents.length === 0) return 0;
  return residents.reduce((sum, resident) => sum + bestCraft(resident).tier.rank, 0) / residents.length;
}

function pathCount(simulation: MosslightSimulation): number {
  return simulation.state.grid.flat().filter((tile) => tile === "path").length;
}

describe("people get better at what they do", () => {
  /**
   * Skill used to accrue only in the tick a resident happened to arrive at
   * their workplace with `work` as their goal — which almost never happened
   * once needs started steering them. A hundred and seventy days in, an entire
   * settlement was still Untrained, and nothing the player watched ever changed.
   */
  it("raises the settlement's craft over a long run", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 40);
    const early = averageTier(simulation);

    advance(simulation, 1200);

    expect(early).toBeLessThan(1);
    expect(averageTier(simulation)).toBeGreaterThan(2);
  });

  it("produces genuine masters given enough time", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 1600);

    const masters = simulation.state.residents.filter((resident) => bestCraft(resident).tier.rank >= 4);
    expect(masters.length).toBeGreaterThan(0);
    expect(simulation.state.peakMastery).toBeGreaterThanOrEqual(4);
  });

  it("announces a promotion once, not on every tick above the line", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 900);

    const promotions = simulation.state.history.filter((message) => message.text.startsWith("MASTERY ·"));
    const perResident = new Map<string, number>();
    for (const message of promotions) {
      // Names are "Pip 1", "Pip 2" — take both tokens, or three residents
      // sharing a first name look like one being promoted over and over.
      const name = message.text.split("·")[1]?.trim().split(" ").slice(0, 2).join(" ") ?? "";
      perResident.set(name, (perResident.get(name) ?? 0) + 1);
    }
    // Four tiers above untrained, so nobody can be promoted more than four times.
    for (const count of perResident.values()) expect(count).toBeLessThanOrEqual(4);
  });

  it("names the tier a skill level falls in", () => {
    expect(tierFor(0).label).toBe("Untrained");
    expect(tierFor(50).label).toBe("Keeper");
    expect(tierFor(95).label).toBe("Master");
    expect(tierFor(95).output).toBeGreaterThan(tierFor(0).output);
  });
});

describe("each generation starts further along", () => {
  it("passes a share of a parent's craft to their child", () => {
    const parent = { skills: { farming: 80, crafting: 40, scouting: 8 } } as Resident;
    const child = inheritedSkills(parent);

    expect(child.farming).toBeGreaterThan(child.crafting);
    expect(child.crafting).toBeGreaterThan(child.scouting);
    // Never a straight copy: a child still has to learn the work.
    expect(child.farming).toBeLessThan(parent.skills.farming / 2);
  });

  it("raises children who begin ahead of the first settlers", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 1400);

    const born = simulation.state.residents.filter((resident) => resident.age < 4);
    expect(simulation.state.births).toBeGreaterThan(0);
    if (born.length > 0) {
      const bestStart = Math.max(...born.map((resident) => bestCraft(resident).level));
      expect(bestStart).toBeGreaterThan(2);
    }
  });
});

describe("the city grows", () => {
  it("raises new buildings over a long run", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = simulation.state.buildings.length;
    advance(simulation, 1600);

    expect(simulation.state.buildings.length).toBeGreaterThan(before);
    expect(simulation.state.metrics.housingCapacity).toBeGreaterThan(42);
  });

  it("keeps growing its population rather than settling at one cap", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 800);
    const mid = simulation.state.residents.length;
    advance(simulation, 800);

    expect(mid).toBeGreaterThan(36);
    expect(simulation.state.residents.length).toBeGreaterThan(mid);
  });

  /**
   * The settlement's shape used to come only from where the player drew. Now
   * the routes residents actually walk wear in by themselves.
   */
  it("wears its own roads into well-walked ground", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = pathCount(simulation);
    advance(simulation, 1200);

    expect(pathCount(simulation)).toBeGreaterThan(before);
  });

  it("never paves the whole basin", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 2000);
    // 32x24 board; roads should stay a network, not a surface.
    expect(pathCount(simulation)).toBeLessThan(150);
  });
});

describe("the settlement reads as a town, not a pile", () => {
  function crowding(simulation: MosslightSimulation): { tiles: number; worst: number } {
    const cells = new Map<string, number>();
    for (const resident of simulation.state.residents) {
      const key = `${resident.position.x},${resident.position.y}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    return { tiles: cells.size, worst: Math.max(0, ...cells.values()) };
  }

  /**
   * Residents resolved their market, farm and grove from a map that held one
   * building per type, then walked to that building's own tile. A settlement of
   * ninety put twenty of them on a single cell and ignored every market after
   * the first.
   */
  it("keeps residents from stacking on a single tile", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 1600);

    const { tiles, worst } = crowding(simulation);
    expect(simulation.state.residents.length).toBeGreaterThan(60);
    expect(worst).toBeLessThan(12);
    expect(tiles).toBeGreaterThan(30);
  });

  it("spreads its workers over every bench of the same craft", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 1600);

    const counts = new Map<string, number>();
    for (const resident of simulation.state.residents) {
      counts.set(resident.workplaceId, (counts.get(resident.workplaceId) ?? 0) + 1);
    }
    // More than one workplace should actually have a crew.
    const staffed = [...counts.values()].filter((count) => count > 0).length;
    expect(staffed).toBeGreaterThan(2);
  });

  it("grows outward rather than knotting around the Root Heart", () => {
    const simulation = new MosslightSimulation(SEED);
    const span = () => {
      const xs = simulation.state.buildings.map((building) => building.position.x);
      const ys = simulation.state.buildings.map((building) => building.position.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    const before = span();
    advance(simulation, 1600);

    expect(simulation.state.buildings.length).toBeGreaterThan(8);
    expect(span()).toBeGreaterThanOrEqual(before);
  });

  it("puts reed farms on ground near water", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 1600);

    const farms = simulation.state.buildings.filter((building) => building.type === "reed-farm");
    for (const farm of farms) {
      let nearWater = false;
      for (let dy = -3; dy <= 3 && !nearWater; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const tile = simulation.state.grid[farm.position.y + dy]?.[farm.position.x + dx];
          if (tile === "water" || tile === "wetland") { nearWater = true; break; }
        }
      }
      expect(nearWater).toBe(true);
    }
  });
});

describe("traditions", () => {
  it("cannot be taken up without the goods", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 20);
    simulation.state.items["seed-pod"] = 0;

    expect(simulation.adoptTradition("seed-vault")).toBe(false);
    expect(simulation.getTraditions()).toEqual([]);
  });

  it("is kept for good once taken up, and spends the goods", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 20);
    simulation.state.items["seed-pod"] = 40;

    expect(simulation.adoptTradition("seed-vault")).toBe(true);
    expect(simulation.state.items["seed-pod"]).toBeLessThan(40);
    expect(simulation.getTraditions()).toContain("seed-vault");
    // Taking it up twice is not a way to spend goods.
    expect(simulation.adoptTradition("seed-vault")).toBe(false);
  });

  it("changes what the settlement can do", () => {
    const plain = new MosslightSimulation(SEED);
    advance(plain, 20);

    const stocked = new MosslightSimulation(SEED);
    advance(stocked, 20);
    stocked.state.items["seed-pod"] = 40;
    stocked.state.items.moonwater = 20;
    // Open Table is a chapter-one practice.
    stocked.state.chapter = 1;
    expect(stocked.adoptTradition("open-table")).toBe(true);

    advance(plain, 5);
    advance(stocked, 5);

    expect(stocked.state.metrics.storage.food).toBeGreaterThan(plain.state.metrics.storage.food);
  });

  it("only offers practices the chapter has reached", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.items.moonwater = 40;
    simulation.state.items.resin = 40;

    // Lantern Vigil belongs to chapter two.
    expect(simulation.state.chapter).toBeLessThan(2);
    expect(simulation.adoptTradition("lantern-vigil")).toBe(false);
  });
});
