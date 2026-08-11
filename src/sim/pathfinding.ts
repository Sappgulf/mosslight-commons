import type { TileKind, Vec2 } from "./types";

/**
 * Movement cost per tile kind. `null` means impassable.
 *
 * Paths are cheaper than open ground so the road network the renderer draws
 * actually shapes resident routes; wetland is passable but slow, and open
 * water and stone are walls.
 */
const TILE_COST: Record<TileKind, number | null> = {
  path: 0.6,
  grass: 1,
  fern: 1.2,
  mushroom: 1.2,
  crystal: 1.2,
  ruin: 1.4,
  wetland: 2.2,
  stone: null,
  water: null,
};

export const isWalkable = (tile: TileKind | undefined): boolean =>
  tile !== undefined && TILE_COST[tile] !== null;

export const tileCost = (tile: TileKind): number => TILE_COST[tile] ?? Number.POSITIVE_INFINITY;

export interface PathContext {
  grid: TileKind[][];
  revealed: boolean[][];
  /** Cells occupied by buildings. Buildings are enterable destinations but not through-routes. */
  blocked: Set<number>;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Binary min-heap keyed on f-score. A sorted-array frontier was measurably the
 * hot spot once residents crossed the map, so the heap stays.
 */
class MinHeap {
  private readonly nodes: number[] = [];
  private readonly scores: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, score: number): void {
    this.nodes.push(node);
    this.scores.push(score);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.scores[parent]! <= this.scores[index]!) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number | undefined {
    if (this.nodes.length === 0) return undefined;
    const top = this.nodes[0]!;
    const lastNode = this.nodes.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.scores[0] = lastScore;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.nodes.length && this.scores[left]! < this.scores[smallest]!) smallest = left;
        if (right < this.nodes.length && this.scores[right]! < this.scores[smallest]!) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b]!, this.nodes[a]!];
    [this.scores[a], this.scores[b]] = [this.scores[b]!, this.scores[a]!];
  }
}

export const packCell = (x: number, y: number, width: number): number => y * width + x;

/**
 * A* over the tile grid. Returns the full path including `to` but excluding
 * `from`, or `null` when no route exists. Unrevealed tiles are impassable so
 * residents cannot walk through fog.
 *
 * `to` is allowed to be blocked or unwalkable — the goal is often a building
 * tile or a wild node, and residents should be able to arrive at its edge.
 * When the goal itself cannot be entered, the closest reachable neighbour is
 * returned instead.
 */
export function findPath(context: PathContext, from: Vec2, to: Vec2): Vec2[] | null {
  const { grid, revealed, blocked } = context;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (width === 0 || height === 0) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  if (!inBounds(from.x, from.y) || !inBounds(to.x, to.y)) return null;

  const goal = packCell(to.x, to.y, width);
  const start = packCell(from.x, from.y, width);

  const gScore = new Float64Array(width * height).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const heuristic = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);

  gScore[start] = 0;
  const open = new MinHeap();
  open.push(start, heuristic(from.x, from.y));

  // Iteration ceiling: a 32x24 board never needs more than a few thousand
  // expansions, and this keeps a pathological call from stalling a tick.
  let expansions = 0;
  const maxExpansions = width * height * 4;

  while (open.size > 0 && expansions < maxExpansions) {
    const current = open.pop()!;
    if (closed[current]) continue;
    closed[current] = 1;
    expansions += 1;

    if (current === goal) return reconstruct(cameFrom, current, width, start);

    const cx = current % width;
    const cy = (current - cx) / width;

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      const neighbor = packCell(nx, ny, width);
      if (closed[neighbor]) continue;
      if (!revealed[ny]?.[nx]) continue;

      const isGoal = neighbor === goal;
      const tile = grid[ny]![nx]!;
      // The destination may be a building or a wild node; everything en route
      // must be genuinely walkable and unoccupied.
      if (!isGoal && (!isWalkable(tile) || blocked.has(neighbor))) continue;
      if (isGoal && !isWalkable(tile) && !blocked.has(neighbor)) continue;

      const step = isGoal ? 1 : tileCost(tile);
      const tentative = gScore[current]! + step;
      if (tentative >= gScore[neighbor]!) continue;

      gScore[neighbor] = tentative;
      cameFrom[neighbor] = current;
      open.push(neighbor, tentative + heuristic(nx, ny));
    }
  }

  // No route to the exact goal. Fall back to the reachable cell that got
  // closest, so a resident still makes visible progress instead of freezing.
  let bestCell = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let cell = 0; cell < closed.length; cell += 1) {
    if (!closed[cell] || cell === start) continue;
    const x = cell % width;
    const y = (cell - x) / width;
    const distance = Math.abs(x - to.x) + Math.abs(y - to.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCell = cell;
    }
  }
  if (bestCell === -1) return null;
  return reconstruct(cameFrom, bestCell, width, start);
}

function reconstruct(cameFrom: Int32Array, goal: number, width: number, start: number): Vec2[] {
  const path: Vec2[] = [];
  let cursor = goal;
  while (cursor !== -1 && cursor !== start) {
    const x = cursor % width;
    path.push({ x, y: (cursor - x) / width });
    cursor = cameFrom[cursor]!;
  }
  return path.reverse();
}
