import { describe, expect, it } from "vitest";

import { findPath, isWalkable, type PathContext } from "../pathfinding";
import type { TileKind } from "../types";

/** Builds a context from an ASCII map. `.`=grass `#`=stone `~`=water `=`=path `?`=unrevealed */
function makeContext(rows: string[], blocked: Array<[number, number]> = []): PathContext {
  const width = rows[0]!.length;
  const grid: TileKind[][] = [];
  const revealed: boolean[][] = [];
  for (const row of rows) {
    const gridRow: TileKind[] = [];
    const revealedRow: boolean[] = [];
    for (const char of row) {
      revealedRow.push(char !== "?");
      gridRow.push(char === "#" ? "stone" : char === "~" ? "water" : char === "=" ? "path" : "grass");
    }
    grid.push(gridRow);
    revealed.push(revealedRow);
  }
  return {
    grid,
    revealed,
    blocked: new Set(blocked.map(([x, y]) => y * width + x)),
  };
}

describe("isWalkable", () => {
  it("treats water and stone as walls and everything else as passable", () => {
    expect(isWalkable("water")).toBe(false);
    expect(isWalkable("stone")).toBe(false);
    expect(isWalkable("grass")).toBe(true);
    expect(isWalkable("path")).toBe(true);
    expect(isWalkable("wetland")).toBe(true);
    expect(isWalkable(undefined)).toBe(false);
  });
});

describe("findPath", () => {
  it("finds a straight route across open ground", () => {
    const context = makeContext([
      ".....",
      ".....",
      ".....",
    ]);
    const path = findPath(context, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual({ x: 4, y: 1 });
    // Manhattan distance is 4, so an optimal path is exactly 4 steps.
    expect(path!).toHaveLength(4);
  });

  it("returns an empty path when already at the destination", () => {
    const context = makeContext(["...", "...", "..."]);
    expect(findPath(context, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("routes around water instead of through it", () => {
    const context = makeContext([
      ".....",
      "..~..",
      ".....",
    ]);
    const path = findPath(context, { x: 2, y: 0 }, { x: 2, y: 2 })!;
    expect(path).not.toBeNull();
    // Every step must be on walkable ground — this is the bug the old
    // greedy movement had, walking creatures straight through the basin.
    for (const step of path) {
      expect(context.grid[step.y]![step.x]).not.toBe("water");
    }
    expect(path.at(-1)).toEqual({ x: 2, y: 2 });
  });

  it("never steps onto an unrevealed tile", () => {
    const context = makeContext([
      ".??..",
      ".??..",
      ".....",
    ]);
    const path = findPath(context, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    for (const step of path) {
      expect(context.revealed[step.y]![step.x]).toBe(true);
    }
  });

  it("prefers cheaper path tiles over open grass", () => {
    // A straight road along the top row versus grass everywhere else.
    const context = makeContext([
      "=====",
      ".....",
      ".....",
    ]);
    const path = findPath(context, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    // The road is both shortest and cheapest, so it should be followed exactly.
    expect(path.every((step) => step.y === 0)).toBe(true);
  });

  it("treats buildings as obstacles but allows arriving at one", () => {
    const context = makeContext([
      ".....",
      ".....",
      ".....",
    ], [[2, 1]]);
    // Routing *to* the building tile must succeed.
    const toBuilding = findPath(context, { x: 0, y: 1 }, { x: 2, y: 1 })!;
    expect(toBuilding.at(-1)).toEqual({ x: 2, y: 1 });

    // Routing *past* it must not pass through it.
    const past = findPath(context, { x: 0, y: 1 }, { x: 4, y: 1 })!;
    expect(past.some((step) => step.x === 2 && step.y === 1)).toBe(false);
    expect(past.at(-1)).toEqual({ x: 4, y: 1 });
  });

  it("falls back to the closest reachable cell when fully walled off", () => {
    const context = makeContext([
      "..#..",
      "..#..",
      "..#..",
    ]);
    const path = findPath(context, { x: 0, y: 1 }, { x: 4, y: 1 });
    // No route exists, but the resident should still make progress toward it
    // rather than freezing in place.
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path!.every((step) => step.x < 2)).toBe(true);
  });

  it("returns null for out-of-bounds endpoints", () => {
    const context = makeContext(["...", "...", "..."]);
    expect(findPath(context, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
    expect(findPath(context, { x: -1, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});
