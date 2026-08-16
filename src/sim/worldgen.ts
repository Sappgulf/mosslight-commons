import { DISTRICT_DEFINITIONS, SEASONAL_EVENT_DEFINITIONS } from "../data/definitions";
import { GRID_HEIGHT, GRID_WIDTH } from "./grid";
import type { SeededRandom } from "./simulation";
import type {
  Building,
  CollectibleTile,
  District,
  DistrictType,
  LifeStage,
  MapZoneKey,
  Relationship,
  RelationshipKind,
  Resident,
  Season,
  Species,
  TileKind,
  Vec2,
  WorldState,
} from "./types";

/**
 * Making a basin, and the people who live in it.
 *
 * Worldgen is the most self-contained thing the simulation did and the least
 * connected to anything else: it runs once, reads no world state, and answers
 * only to the seeded RNG. It sat in the middle of the god class regardless.
 */

/**
 * Life-stage thresholds. Transcribing these by hand is how the extraction
 * briefly shipped `ELDER_AGE = 46` against the simulation's 42, quietly
 * reclassifying a slice of the population and changing what the basin produced.
 */
export const ADULT_AGE = 6;
export const ELDER_AGE = 42;
const DAYS_PER_SEASON = 7;

/** The three founding species. Cloudmoths arrive later, by their own path. */
const speciesOrder: Species[] = ["brambleback", "glowtail", "mireling"];

const names = [
  "Pip", "Mallow", "Tallow", "Nix", "Pebble", "Lumen", "Sedge", "Bramble", "Clover", "Moss",
  "Dapple", "Wick", "Thimble", "Fennel", "Puddle", "Rook", "Juniper", "Mica", "Nettle", "Biscuit",
];

/** Ground nobody has charted at the start of a run. */
export const ZONE_BOUNDS: Record<MapZoneKey, { xMin: number; xMax: number; yMin: number; yMax: number }> = {
  "sunken-reach": { xMin: 24, xMax: 31, yMin: 13, yMax: 20 },
  "old-hollow": { xMin: 19, xMax: 25, yMin: 3, yMax: 8 },
  "canopy-rift": { xMin: 0, xMax: 6, yMin: 17, yMax: 23 },
};

/**
 * A monotonic id source. Passed in rather than owned here so the simulation
 * keeps a single counter across worldgen, births and later arrivals — names are
 * keyed to it, and a counter that restarts produces two residents answering to
 * the same name.
 */
export interface IdSource {
  next: number;
}

export function stageForAge(age: number): LifeStage {
  return age < ADULT_AGE ? "sprout" : age < ELDER_AGE ? "adult" : "elder";
}

export function clampCell(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function createGrid(): TileKind[][] {
  const grid: TileKind[][] = [];
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    const row: TileKind[] = [];
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const lowerWetland = y > 17 && x < 29;
      const sidePool = x < 4 && y > 5;
      row.push(lowerWetland || sidePool ? "water" : "grass");
    }
    grid.push(row);
  }

  // Stone as a handful of small outcrops rather than one isolated cell every
  // 29th tile. Scattered single cells read as rendering artifacts speckled
  // across the field; clustered rock reads as terrain.
  const outcrops: Array<[number, number]> = [
    [5, 3], [12, 7], [20, 15], [26, 11], [9, 12], [29, 3],
  ];
  for (const [ox, oy] of outcrops) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        // A ragged 3x3 blob: the centre always, the ring most of the time.
        const isCenter = dx === 0 && dy === 0;
        if (!isCenter && (ox * 7 + oy * 13 + dx * 3 + dy * 5) % 3 === 0) continue;
        const x = ox + dx;
        const y = oy + dy;
        if (grid[y]?.[x] === "grass") grid[y]![x] = "stone";
      }
    }
  }

  for (let x = 2; x < 30; x += 1) {
    if (grid[12]?.[x] !== "water") grid[12]![x] = "path";
  }
  for (let y = 7; y < 22; y += 1) {
    if (grid[y]?.[16] !== "water") grid[y]![16] = "path";
  }
  for (let y = 16; y < 20; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      if (grid[y]?.[x] === "water") grid[y]![x] = "wetland";
    }
  }

  const nodes: Array<[CollectibleTile, number, number]> = [
    ["fern", 14, 5],
    ["fern", 18, 4],
    ["fern", 27, 16],
    ["mushroom", 27, 5],
    ["mushroom", 6, 15],
    ["crystal", 28, 8],
    ["crystal", 25, 15],
    ["ruin", 8, 15],
    ["ruin", 29, 18],
    ["crystal", 21, 4],
    ["ruin", 23, 6],
  ];
  for (const [kind, x, y] of nodes) {
    if (grid[y]?.[x] && grid[y]![x] !== "water") grid[y]![x] = kind;
  }
  return grid;
}

export function createRevealedGrid(): boolean[][] {
  const revealed = Array.from({ length: GRID_HEIGHT }, () => Array.from({ length: GRID_WIDTH }, () => true));
  for (const bounds of Object.values(ZONE_BOUNDS)) {
    for (let y = bounds.yMin; y <= bounds.yMax; y += 1) {
      for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
        if (revealed[y]?.[x] !== undefined) revealed[y]![x] = false;
      }
    }
  }
  return revealed;
}

export function createDistricts(): District[] {
  const layout: Record<DistrictType, { xMin: number; xMax: number; yMin: number; yMax: number; center: Vec2 }> = {
    meadow: { xMin: 2, xMax: 13, yMin: 2, yMax: 11, center: { x: 8, y: 7 } },
    wetland: { xMin: 3, xMax: 12, yMin: 14, yMax: 20, center: { x: 8, y: 17 } },
    lantern: { xMin: 20, xMax: 30, yMin: 2, yMax: 11, center: { x: 24, y: 7 } },
    market: { xMin: 13, xMax: 22, yMin: 9, yMax: 15, center: { x: 17, y: 12 } },
    ruin: { xMin: 23, xMax: 31, yMin: 13, yMax: 20, center: { x: 27, y: 16 } },
  };
  return (Object.keys(layout) as DistrictType[]).map((type) => {
    const { center, xMin, xMax, yMin, yMax } = layout[type];
    return {
      id: `district-${type}`,
      type,
      center,
      bounds: { xMin, xMax, yMin, yMax },
      ...DISTRICT_DEFINITIONS[type],
    };
  });
}

export function createRelationships(rng: SeededRandom, residents: Resident[]): Relationship[] {
  const relationships: Relationship[] = [];
  // Every resident gets at least one bond, so the social layer is real rather
  // than decorative. Pairing with a neighbour two seats along avoids giving
  // everyone the same partner.
  for (let index = 0; index < residents.length; index += 1) {
    const first = residents[index];
    const second = residents[(index + 2) % residents.length];
    if (!first || !second || first.id === second.id) continue;
    if (relationships.some((existing) =>
      (existing.aId === first.id && existing.bId === second.id)
      || (existing.aId === second.id && existing.bId === first.id))) continue;

    const kind: RelationshipKind = first.species === second.species
      ? rng.next() > 0.7 ? "family" : "kinship"
      : rng.next() > 0.2 ? "friendship" : "rivalry";
    relationships.push({
      id: `relationship-${relationships.length + 1}`,
      aId: first.id,
      bId: second.id,
      kind,
      strength: rng.range(42, 78),
      sharedDays: 1,
    });
  }
  return relationships;
}

export function createSeasonalEvent(season: Season): WorldState["seasonalEvent"] {
  const definition = SEASONAL_EVENT_DEFINITIONS[season];
  return { ...definition, season, daysRemaining: DAYS_PER_SEASON };
}

export function createResidents(rng: SeededRandom, ids: IdSource, buildings: Building[]): Resident[] {
  const residents: Resident[] = [];
  for (let index = 0; index < 36; index += 1) {
    const resident = createResident(rng, ids, index, buildings);
    if (resident) residents.push(resident);
  }
  return residents;
}

export function createResident(
  rng: SeededRandom,
  ids: IdSource,
  index: number,
  buildings: Building[],
): Resident | undefined {
  const homes = buildings.filter((building) => building.type === "burrow-home");
  const market = buildings.find((building) => building.type === "commons-market");
  const farm = buildings.find((building) => building.type === "reed-farm");
  const grove = buildings.find((building) => building.type === "lantern-grove");
  const home = homes[index % homes.length];
  if (!home || !market || !farm || !grove) return undefined;

  const species = speciesOrder[index % speciesOrder.length]!;
  const work = species === "brambleback" ? home : species === "mireling" ? farm : grove;
  const offset = { x: (index % 5) - 2, y: Math.floor(index / 5) % 3 - 1 };
  const age = rng.int(ADULT_AGE, 30);
  /*
   * The name is keyed to the resident's own id, not to their position in the
   * array. It used to be `names[index % names.length]` with the index taken
   * from the current population size — so every departure freed an index for
   * the next arrival to reuse, and a settlement that had lost anybody ended up
   * with two residents answering to "Sedge 3". Ids only ever go up.
   */
  const id = ids.next;
  ids.next += 1;

  return {
    id: `resident-${id}`,
    name: `${names[id % names.length]!} ${Math.floor(id / names.length) + 1}`,
    species,
    position: {
      x: clampCell(home.position.x + offset.x, 1, GRID_WIDTH - 2),
      y: clampCell(home.position.y + offset.y, 1, GRID_HEIGHT - 2),
    },
    homeId: home.id,
    workplaceId: work.id,
    needs: {
      shelter: rng.range(58, 92),
      food: rng.range(55, 90),
      safety: rng.range(60, 94),
      belonging: rng.range(42, 86),
    },
    traits: {
      curiosity: rng.next(),
      sociability: rng.next(),
      routine: rng.next(),
      resilience: rng.next(),
    },
    skills: {
      farming: rng.range(4, 22),
      crafting: rng.range(4, 22),
      scouting: rng.range(4, 22),
    },
    goal: index % 3 === 0 ? "work" : "socialize",
    target: index % 3 === 0 ? work.position : market.position,
    path: [],
    lastDecisionExplanation: "Settling into a new neighborhood.",
    age,
    stage: stageForAge(age),
    distress: 0,
    masteryTier: 0,
    taught: 0,
    memories: [],
    moveCredit: 0,
    dwell: 0,
  };
}
