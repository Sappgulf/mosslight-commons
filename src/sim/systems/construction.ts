import { GRID_HEIGHT, GRID_WIDTH } from "../grid";
import type { Building, BuildingType, NeedKey, TileKind, Vec2, WorldState } from "../types";

/**
 * What the settlement builds next, and where it puts it.
 *
 * These were methods on `MosslightSimulation`, and they are where the last
 * round of bugs actually lived: a growth rule that only fired in a crisis, and
 * a placement radius wrongly blamed for a footprint that never moved. Pulled
 * out here they can be measured directly against a hand-built world instead of
 * inferred from a played game.
 */

/** How many residents one building of each kind is expected to serve. */
export const RESIDENTS_PER_FARM = 14;
export const RESIDENTS_PER_GROVE = 16;
export const RESIDENTS_PER_HOME = 10;
export const RESIDENTS_PER_WORKSHOP = 45;
export const RESIDENTS_PER_MARKET = 34;

/** Below this the settlement is too young to build on ambition alone. */
const GROWTH_MIN_POPULATION = 12;

/** How far from the Root a young settlement will build. */
const BASE_SETTLEMENT_REACH = 9;

/** The furthest a mature settlement will push, short of the basin's rim. */
const MAX_SETTLEMENT_REACH = 26;

/** The surface placement needs: the world, plus what the simulation knows about it. */
export interface BuildSite {
  readonly state: WorldState;
  isRevealed(cell: Vec2): boolean;
  isOccupied(cell: Vec2): boolean;
  /** 0-1 lantern coverage, used to find the darkest inhabited ground. */
  lightCoverageAt(cell: Vec2): number;
  countBuildings(type: BuildingType): number;
}

const manhattan = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Whether a tile of a given kind sits within `radius` of a cell. */
export function isNearTile(state: WorldState, cell: Vec2, kind: TileKind, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const tile = state.grid[cell.y + dy]?.[cell.x + dx];
      if (tile === kind) return true;
    }
  }
  return false;
}

/**
 * What a settlement of this size should have and does not yet, in the order it
 * should want it. Undefined once the town has caught up with its population.
 *
 * This is the difference between a Commons that grows and one that does not:
 * before it existed the settlement built only when housing was tight or the
 * report was a warning, so a thriving basin of 104 residents sat at 11
 * buildings indefinitely.
 */
export function chooseGrowth(site: BuildSite): Exclude<BuildingType, "root-heart"> | undefined {
  const population = site.state.residents.length;
  if (population < GROWTH_MIN_POPULATION) return undefined;

  const targets: Array<[Exclude<BuildingType, "root-heart">, number]> = [
    ["reed-farm", Math.ceil(population / RESIDENTS_PER_FARM)],
    ["lantern-grove", Math.ceil(population / RESIDENTS_PER_GROVE)],
    ["commons-market", Math.ceil(population / RESIDENTS_PER_MARKET)],
    ["burrow-home", Math.ceil(population / RESIDENTS_PER_HOME)],
    ["root-workshop", Math.ceil(population / RESIDENTS_PER_WORKSHOP)],
  ];

  // The largest shortfall first, so the town fills its worst gap next.
  let wanted: Exclude<BuildingType, "root-heart"> | undefined;
  let worst = 0;
  for (const [type, target] of targets) {
    const shortfall = target - site.countBuildings(type);
    if (shortfall > worst) {
      worst = shortfall;
      wanted = type;
    }
  }
  return wanted;
}

/** The building the Commons most needs next, or undefined if it needs none. */
export function chooseSelfBuild(site: BuildSite): Exclude<BuildingType, "root-heart"> | undefined {
  const { housingPressure, diagnosis } = site.state.metrics;
  // Build ahead of the crunch rather than only once it has arrived.
  if (housingPressure > 0.88) return "burrow-home";

  const ambition = chooseGrowth(site);
  if (ambition) return ambition;

  if (diagnosis.tone !== "warning") return undefined;

  const byNeed: Record<NeedKey, Exclude<BuildingType, "root-heart">> = {
    shelter: "burrow-home",
    food: "reed-farm",
    safety: "lantern-grove",
    belonging: "commons-market",
  };
  const wanted = byNeed[diagnosis.need];
  /*
   * Markets scale with the settlement rather than being capped at one or two.
   * A single market served a hundred and ten residents, so everyone converged
   * on the same handful of tiles no matter how well the rest was spread.
   */
  if (wanted === "commons-market") {
    const allowed = Math.max(1, Math.ceil(site.state.residents.length / RESIDENTS_PER_MARKET));
    if (site.countBuildings("commons-market") >= allowed) return undefined;
  }
  return wanted;
}

/**
 * Where to put the next building of a type.
 *
 * Scoring, not the reach limit, is what decides the town's shape — a fact
 * established the hard way, by raising the limit and watching the footprint
 * come back byte-identical.
 */
export function findPlotFor(site: BuildSite, type: Exclude<BuildingType, "root-heart">): Vec2 | undefined {
  const { state } = site;
  const homes = state.buildings.filter((building) => building.type === "burrow-home");
  const anchor = state.buildings.find((building) => building.type === "root-heart")?.position
    ?? { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };

  let best: Vec2 | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
    for (let x = 1; x < GRID_WIDTH - 1; x += 1) {
      const cell = { x, y };
      if (!site.isRevealed(cell) || site.isOccupied(cell)) continue;
      if (state.grid[y]?.[x] !== "grass") continue;

      /*
       * The settlement's reach grows with the settlement. A flat sixteen tiles
       * meant a Commons of thirty and one of a hundred and thirty occupied the
       * same blob however large the town got.
       */
      const reach = manhattan(cell, anchor);
      const reachLimit = Math.min(
        MAX_SETTLEMENT_REACH,
        BASE_SETTLEMENT_REACH + Math.floor(state.residents.length / 9) + state.buildings.length,
      );
      if (reach > reachLimit) continue;
      // Big towns stop hugging the Root; small ones still gather round it.
      const centrePull = 0.35 * Math.max(0.25, 1 - state.buildings.length / 18);
      let score = -reach * centrePull;

      // Never wall a building in against its neighbours.
      const crowding = state.buildings.filter((building) => manhattan(building.position, cell) <= 2).length;
      score -= crowding * 3;

      score += placementBonus(site, type, cell, homes);

      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
  }
  return best;
}

/** What each kind of building wants from the ground it sits on. */
function placementBonus(
  site: BuildSite,
  type: Exclude<BuildingType, "root-heart">,
  cell: Vec2,
  homes: Building[],
): number {
  const { state } = site;
  switch (type) {
    case "burrow-home": {
      // Just beyond the current edge of housing: close enough to belong, far
      // enough that the town actually spreads.
      const nearestHome = homes.length
        ? Math.min(...homes.map((home) => manhattan(home.position, cell)))
        : 4;
      // A denser town wants its next burrow further out, not wedged in.
      const spacing = homes.length >= 6 ? 5 : 4;
      return -Math.abs(nearestHome - spacing) * 1.4;
    }
    case "reed-farm":
      return isNearTile(state, cell, "water", 3) || isNearTile(state, cell, "wetland", 3) ? 8 : -6;
    case "lantern-grove": {
      // The darkest ground people actually walk on.
      let score = (1 - site.lightCoverageAt(cell)) * 9;
      if (homes.length) score -= Math.min(...homes.map((home) => manhattan(home.position, cell))) * 0.5;
      return score;
    }
    default: {
      // Central to where people live.
      if (homes.length === 0) return 0;
      const average = homes.reduce((sum, home) => sum + manhattan(home.position, cell), 0) / homes.length;
      return -average * 0.8;
    }
  }
}
