import { GRID_HEIGHT, GRID_WIDTH } from "../grid";
import { findPath, isWalkable, packCell, type PathContext } from "../pathfinding";
import type { LifeStage, Resident, ResidentGoal, Species, Vec2, WorldState } from "../types";

const sameCell = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

/**
 * Getting residents from where they are to where they want to be.
 *
 * These were methods on `MosslightSimulation` reaching into `this.state` and
 * `this.occupiedCells`. The only thing they genuinely need is the world and the
 * set of cells nobody can walk into, so they take that explicitly now and can
 * be exercised against a hand-built board.
 */
export interface Terrain {
  readonly state: WorldState;
  /** Cells a resident cannot step into: buildings, gathering nodes. */
  readonly blocked: Set<number>;
  /**
   * Whether routing may cross ground nobody has mapped.
   *
   * False for everyone running errands, and true for a scout — walking into
   * the uncharted part of the basin is the entire job. This lives on the
   * terrain rather than on the call that sets a target because `takeStep`
   * repaths mid-route, and a permissive route that gets restrictively
   * recalculated one tile later is no permission at all.
   */
  readonly ignoreRevealed?: boolean;
}

export function isInside(position: Vec2): boolean {
  return position.x >= 0 && position.x < GRID_WIDTH && position.y >= 0 && position.y < GRID_HEIGHT;
}

export function isRevealed(state: WorldState, position: Vec2): boolean {
  return state.revealed[position.y]?.[position.x] ?? false;
}

/**
 * A revealed-mask that says yes to everything, built once per grid size.
 *
 * Routing normally refuses unmapped ground, which is right for a resident
 * running errands and exactly wrong for a scout: the whole point of a survey is
 * to walk into the part of the basin nobody has charted. Without this an
 * expedition could never reach its target and only ever finished on its
 * fallback timer.
 */
let permissive: boolean[][] | null = null;

function allRevealed(state: WorldState): boolean[][] {
  const height = state.grid.length;
  const width = state.grid[0]?.length ?? 0;
  if (!permissive || permissive.length !== height || (permissive[0]?.length ?? 0) !== width) {
    permissive = Array.from({ length: height }, () => new Array<boolean>(width).fill(true));
  }
  return permissive;
}

export function pathContext(terrain: Terrain): PathContext {
  return {
    grid: terrain.state.grid,
    revealed: terrain.ignoreRevealed ? allRevealed(terrain.state) : terrain.state.revealed,
    blocked: terrain.blocked,
  };
}

/** Sets a target and recomputes the route only when the destination changed. */
export function setResidentTarget(terrain: Terrain, resident: Resident, target: Vec2): void {
  if (resident.target && sameCell(resident.target, target) && resident.path.length > 0) return;
  resident.target = { x: target.x, y: target.y };
  if (sameCell(resident.position, target)) {
    resident.path = [];
    return;
  }
  resident.path = findPath(pathContext(terrain), resident.position, target) ?? [];
}

function takeStep(terrain: Terrain, resident: Resident): void {
  if (!resident.target) return;
  const { state } = terrain;
  if (resident.path.length === 0) {
    if (sameCell(resident.position, resident.target)) return;
    resident.path = findPath(pathContext(terrain), resident.position, resident.target) ?? [];
    if (resident.path.length === 0) return;
  }

  const next = resident.path[0]!;
  const tile = state.grid[next.y]?.[next.x];
  const isDestination = sameCell(next, resident.target);
  // The world can change under a resident mid-route (a new building, a
  // regrown node); repath rather than walking into it.
  if (!isDestination && (!isWalkable(tile) || terrain.blocked.has(packCell(next.x, next.y, GRID_WIDTH)))) {
    resident.path = findPath(pathContext(terrain), resident.position, resident.target) ?? [];
    return;
  }

  resident.path.shift();
  resident.position = { x: next.x, y: next.y };

  // Remember where the settlement actually walks.
  const index = next.y * GRID_WIDTH + next.x;
  if (state.footfall[index] !== undefined) state.footfall[index] += 1;
}

/**
 * How fast each kind of creature walks, relative to a plain adult.
 *
 * These are the species' own descriptions made literal: Glowtails are traders
 * and explorers, Mirelings are patient growers, Cloudmoths drift.
 */
const SPECIES_PACE: Record<Species, number> = {
  brambleback: 0.95,
  glowtail: 1.15,
  mireling: 0.82,
  cloudmoth: 1.2,
};

/** Young legs are quick and old legs are not. */
const STAGE_PACE: Record<LifeStage, number> = { sprout: 1.18, adult: 1, elder: 0.72 };

/** Somebody heading out to explore moves differently from somebody going to bed. */
const GOAL_PACE: Record<ResidentGoal, number> = {
  explore: 1.12,
  forage: 1,
  work: 0.95,
  socialize: 0.9,
  rest: 0.85,
};

/**
 * Tiles per tick for one resident.
 *
 * Everyone used to move exactly one tile per tick — a sprout, an elder and a
 * scout all crossed the basin at the same speed, and a hundred residents slid
 * about in lockstep, which is most of why the board looked mechanical however
 * much detail sat behind it.
 */
export function paceFor(resident: Resident): number {
  return (
    SPECIES_PACE[resident.species] *
    STAGE_PACE[resident.stage] *
    (GOAL_PACE[resident.goal] ?? 1)
  );
}

/**
 * How long a resident stays put once they arrive, by what they came to do.
 *
 * Kept short. An earlier attempt used six to eleven ticks and cost so much
 * throughput that the ledger could no longer be finished; the fix is not a
 * longer commitment but a commitment that pays for itself.
 */
const DWELL: Record<ResidentGoal, number> = {
  rest: 3,
  work: 3,
  forage: 2,
  socialize: 2,
  explore: 1,
};

export function dwellFor(goal: ResidentGoal): number {
  return DWELL[goal] ?? 2;
}

/**
 * How much more an activity counts for while a resident is committed to it.
 *
 * Without this, dwelling is pure loss: a resident who used to switch to
 * whatever need was most pressing every tick now sticks with one thing, meets
 * their needs worse, and the settlement grows more slowly. Focus is what makes
 * standing still worth doing.
 */
export const FOCUS_BONUS = 1.6;

/**
 * Advances a resident one step, or two when they are travelling on a packed
 * road.
 *
 * Roads already carried a lower cost inside the pathfinder, so residents
 * preferred them — but preferring a route the player cannot see the benefit
 * of is not a mechanic. Walking a road is now visibly faster, which is what
 * makes spending food and warmth on one worth doing.
 */
export function stepAlongPath(terrain: Terrain, resident: Resident): void {
  /*
   * Pace is banked rather than rounded. A resident who moves at 0.82 tiles a
   * tick takes a step on most ticks and pauses on the others, which reads as a
   * slower walk instead of a stutter, and the remainder never gets lost.
   */
  resident.moveCredit = (resident.moveCredit ?? 0) + paceFor(resident);
  let steps = 0;
  while (resident.moveCredit >= 1 && steps < 3) {
    resident.moveCredit -= 1;
    takeStep(terrain, resident);
    steps += 1;
    // A packed road is still worth walking: it buys an extra tile outright.
    const tile = terrain.state.grid[resident.position.y]?.[resident.position.x];
    if (tile === "path" && steps < 3) {
      takeStep(terrain, resident);
      steps += 1;
    }
  }
}

/** The nearest revealed, walkable cell to a position — or the position itself. */
export function findWalkableNear(terrain: Terrain, position: Vec2): Vec2 {
  const { state } = terrain;
  if (isWalkable(state.grid[position.y]?.[position.x]) && (terrain.ignoreRevealed || isRevealed(state, position))) return position;
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const candidate = { x: position.x + dx, y: position.y + dy };
        if (!isInside(candidate)) continue;
        if (!terrain.ignoreRevealed && !isRevealed(state, candidate)) continue;
        if (isWalkable(state.grid[candidate.y]?.[candidate.x])) return candidate;
      }
    }
  }
  return position;
}

/**
 * The closest cell to `marker` that `from` can actually walk to.
 *
 * "Nearest walkable" is not enough on its own: the Canopy Rift's marker sits in
 * open water, and the nearest dry cell to it turned out to be a wetland shelf
 * with no route in. Searching outward for a cell that both is walkable *and*
 * has a path guarantees the scout can arrive, so the fallback timer stays what
 * it should be — an emergency, not the normal way a survey ends.
 */
export function reachableNear(terrain: Terrain, from: Vec2, marker: Vec2, maxRadius = 8): Vec2 {
  const context = pathContext(terrain);
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    let best: Vec2 | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // Only the ring at this radius; the inner cells were already tried.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = { x: marker.x + dx, y: marker.y + dy };
        if (!isInside(candidate)) continue;
        if (!isWalkable(terrain.state.grid[candidate.y]?.[candidate.x])) continue;
        const walk = Math.abs(candidate.x - from.x) + Math.abs(candidate.y - from.y);
        if (walk >= bestDistance) continue;
        if (!findPath(context, from, candidate)) continue;
        best = candidate;
        bestDistance = walk;
      }
    }
    if (best) return best;
  }
  return marker;
}

export function invalidateAllPaths(state: WorldState): void {
  for (const resident of state.residents) resident.path = [];
}
