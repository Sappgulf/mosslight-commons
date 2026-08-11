import { describe, expect, it } from "vitest";

import { evaluateAdjacency, type AdjacencyContext } from "../adjacency";
import type { Building, BuildingType, TileKind, Vec2 } from "../types";

function makeGrid(rows: string[]): TileKind[][] {
  return rows.map((row) =>
    [...row].map((char): TileKind => {
      switch (char) {
        case "~": return "water";
        case "%": return "wetland";
        case "=": return "path";
        case "#": return "stone";
        case "r": return "ruin";
        default: return "grass";
      }
    }),
  );
}

function building(type: BuildingType, x: number, y: number, id = `${type}-${x}-${y}`): Building {
  return { id, type, position: { x, y }, level: 1, upgradeProgress: 0, upgrading: false };
}

function context(rows: string[], buildings: Building[] = []): AdjacencyContext {
  return { grid: makeGrid(rows), buildings };
}

const at = (x: number, y: number): Vec2 => ({ x, y });

describe("evaluateAdjacency", () => {
  describe("reed farm", () => {
    const rows = [
      ".....",
      "..~..",
      ".....",
    ];

    it("gains output for each adjacent water tile", () => {
      const result = evaluateAdjacency("reed-farm", at(2, 2), context(rows));
      expect(result.multiplier).toBeGreaterThan(1);
      expect(result.notes.some((note) => note.good && /water/i.test(note.text))).toBe(true);
    });

    it("is penalised with no water alongside", () => {
      const result = evaluateAdjacency("reed-farm", at(0, 0), context([".....", ".....", "....."]));
      expect(result.multiplier).toBeLessThan(1);
      expect(result.notes.some((note) => !note.good)).toBe(true);
    });

    it("is penalised by another farm competing nearby", () => {
      const lone = evaluateAdjacency("reed-farm", at(2, 2), context(rows));
      const crowded = evaluateAdjacency("reed-farm", at(2, 2), context(rows, [building("reed-farm", 3, 2)]));
      expect(crowded.multiplier).toBeLessThan(lone.multiplier);
    });
  });

  describe("lantern grove", () => {
    const rows = ["..........", "..........", ".........."];

    it("gains output for burrows in reach", () => {
      const result = evaluateAdjacency("lantern-grove", at(4, 1), context(rows, [
        building("burrow-home", 2, 1),
        building("burrow-home", 6, 1),
      ]));
      expect(result.multiplier).toBeGreaterThan(1);
    });

    it("is penalised for overlapping another grove", () => {
      const result = evaluateAdjacency("lantern-grove", at(4, 1), context(rows, [
        building("lantern-grove", 5, 1),
      ]));
      expect(result.multiplier).toBeLessThan(1);
      expect(result.notes.some((note) => !note.good && /overlap/i.test(note.text))).toBe(true);
    });

    it("warns when nothing is in reach to light", () => {
      const result = evaluateAdjacency("lantern-grove", at(4, 1), context(rows));
      expect(result.notes.some((note) => !note.good)).toBe(true);
    });
  });

  describe("burrow home", () => {
    const rows = ["..........", "..........", ".........."];

    it("gains comfort near a grove and a market", () => {
      const result = evaluateAdjacency("burrow-home", at(4, 1), context(rows, [
        building("lantern-grove", 6, 1),
        building("commons-market", 2, 1),
      ]));
      expect(result.multiplier).toBeGreaterThan(1.2);
    });

    it("is penalised beside a workshop", () => {
      const result = evaluateAdjacency("burrow-home", at(4, 1), context(rows, [
        building("root-workshop", 5, 1),
      ]));
      expect(result.multiplier).toBeLessThan(1);
      expect(result.notes.some((note) => !note.good && /awake/i.test(note.text))).toBe(true);
    });
  });

  describe("commons market", () => {
    it("scales with the variety of neighbours, not their count", () => {
      const rows = ["..........", "..........", ".........."];
      const oneKind = evaluateAdjacency("commons-market", at(4, 1), context(rows, [
        building("burrow-home", 3, 1, "a"),
        building("burrow-home", 5, 1, "b"),
        building("burrow-home", 6, 1, "c"),
      ]));
      const threeKinds = evaluateAdjacency("commons-market", at(4, 1), context(rows, [
        building("burrow-home", 3, 1, "a"),
        building("reed-farm", 5, 1, "b"),
        building("lantern-grove", 6, 1, "c"),
      ]));
      expect(threeKinds.multiplier).toBeGreaterThan(oneKind.multiplier);
    });

    it("is penalised in isolation", () => {
      const result = evaluateAdjacency("commons-market", at(4, 1), context(["..........", "..........", ".........."]));
      expect(result.multiplier).toBeLessThan(1);
    });
  });

  describe("root workshop", () => {
    it("gains output beside a road and beside ruins", () => {
      // The road must run *beside* the workshop; a tile under it is its own cell.
      const withRoad = evaluateAdjacency("root-workshop", at(2, 1), context([".....", "...=.", "....."]));
      const plain = evaluateAdjacency("root-workshop", at(2, 1), context([".....", ".....", "....."]));
      expect(withRoad.multiplier).toBeGreaterThan(plain.multiplier);

      const withRuins = evaluateAdjacency("root-workshop", at(2, 1), context([".....", "...r.", "....."]));
      expect(withRuins.multiplier).toBeGreaterThan(plain.multiplier);
    });
  });

  it("never drops output below a floor", () => {
    // Stack every penalty available to a burrow home.
    const result = evaluateAdjacency("burrow-home", at(4, 1), context(["..........", "..........", ".........."], [
      building("root-workshop", 5, 1, "w1"),
      building("root-workshop", 3, 1, "w2"),
    ]));
    expect(result.multiplier).toBeGreaterThanOrEqual(0.4);
  });

  it("excludes the building being evaluated from its own neighbours", () => {
    const self = building("reed-farm", 2, 2, "self");
    const result = evaluateAdjacency("reed-farm", at(2, 2), {
      grid: makeGrid([".....", "..~..", "....."]),
      buildings: [self],
      ignoreId: "self",
    });
    // Without the exclusion this would read as a farm crowding itself.
    expect(result.notes.some((note) => /competing/.test(note.text))).toBe(false);
  });
});
