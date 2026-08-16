import { GRID_HEIGHT, GRID_WIDTH } from "../grid";
import { findPath, isWalkable, packCell, type PathContext } from "../pathfinding";
import type { Resident, Vec2, WorldState } from "../types";

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
}

export function isInside(position: Vec2): boolean {
  return position.x >= 0 && position.x < GRID_WIDTH && position.y >= 0 && position.y < GRID_HEIGHT;
}

export function isRevealed(state: WorldState, position: Vec2): boolean {
  return state.revealed[position.y]?.[position.x] ?? false;
}

export function pathContext(terrain: Terrain): PathContext {
  return {
    grid: terrain.state.grid,
    revealed: terrain.state.revealed,
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
 * Advances a resident one step, or two when they are travelling on a packed
 * road.
 *
 * Roads already carried a lower cost inside the pathfinder, so residents
 * preferred them — but preferring a route the player cannot see the benefit
 * of is not a mechanic. Walking a road is now visibly faster, which is what
 * makes spending food and warmth on one worth doing.
 */
export function stepAlongPath(terrain: Terrain, resident: Resident): void {
  takeStep(terrain, resident);
  const tile = terrain.state.grid[resident.position.y]?.[resident.position.x];
  if (tile === "path") takeStep(terrain, resident);
}

/** The nearest revealed, walkable cell to a position — or the position itself. */
export function findWalkableNear(terrain: Terrain, position: Vec2): Vec2 {
  const { state } = terrain;
  if (isWalkable(state.grid[position.y]?.[position.x]) && isRevealed(state, position)) return position;
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const candidate = { x: position.x + dx, y: position.y + dy };
        if (!isInside(candidate)) continue;
        if (!isRevealed(state, candidate)) continue;
        if (isWalkable(state.grid[candidate.y]?.[candidate.x])) return candidate;
      }
    }
  }
  return position;
}

export function invalidateAllPaths(state: WorldState): void {
  for (const resident of state.residents) resident.path = [];
}
