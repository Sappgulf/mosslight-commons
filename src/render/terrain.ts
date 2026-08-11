import type { TileKind } from "../sim/types";

/**
 * Terrain families. Autotiling blends between families, not between individual
 * tile kinds — a fern and a grass tile are both "ground" and should read as one
 * continuous surface, while ground meeting water needs a shoreline.
 */
export type TerrainFamily = "water" | "wetland" | "ground" | "path" | "stone";

export const TILE_FAMILY: Record<TileKind, TerrainFamily> = {
  water: "water",
  wetland: "wetland",
  grass: "ground",
  fern: "ground",
  mushroom: "ground",
  crystal: "ground",
  ruin: "ground",
  path: "path",
  stone: "stone",
};

/**
 * Base palette per family, plus the jitter range applied per tile. The jitter is
 * what stops ~600 cells of a single flat hex from reading as a spreadsheet.
 */
export const FAMILY_PALETTE: Record<
  TerrainFamily,
  { base: number; variants: number[]; edge: number }
> = {
  // Variants are deliberately within a few points of luminance of each other.
  // A wider spread reads as a checkerboard at tile scale, which is worse than
  // the flat colour it was meant to replace.
  water: {
    base: 0x0b3543,
    variants: [0x0b3543, 0x0b3644, 0x0a3441, 0x0c3745],
    edge: 0x1d6570,
  },
  wetland: {
    base: 0x164c44,
    variants: [0x164c44, 0x164d45, 0x154b43, 0x174e46],
    edge: 0x2b7566,
  },
  ground: {
    base: 0x143a2f,
    variants: [0x143a2f, 0x143b30, 0x13392e, 0x153c31, 0x143a2f],
    edge: 0x235943,
  },
  path: {
    base: 0x46523a,
    variants: [0x46523a, 0x47533b, 0x455139, 0x48543c],
    edge: 0x64714f,
  },
  stone: {
    base: 0x24352f,
    variants: [0x24352f, 0x253630, 0x23342e, 0x263731],
    edge: 0x3e534c,
  },
};

/** Sand/foam colour drawn on the land side of a water boundary. */
export const SHORE_COLOR = 0x6d7c5a;
export const FOAM_COLOR = 0x9fd8cf;

/**
 * Deterministic per-cell hash. Terrain variation must be stable across
 * redraws — a tile that changes colour every frame is worse than a flat one.
 */
export function cellHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Picks a stable colour variant for a cell. */
export function variantFor(family: TerrainFamily, x: number, y: number): number {
  const variants = FAMILY_PALETTE[family].variants;
  return variants[Math.floor(cellHash(x, y, 7) * variants.length)]!;
}

export const enum Edge {
  North = 1,
  East = 2,
  South = 4,
  West = 8,
}

/**
 * Which sides of this cell face a different terrain family. The result is a
 * 4-bit mask used to pick edge treatment and corner rounding.
 */
export function edgeMask(
  grid: TileKind[][],
  x: number,
  y: number,
  predicate: (neighbor: TerrainFamily, self: TerrainFamily) => boolean,
): number {
  const self = TILE_FAMILY[grid[y]![x]!];
  let mask = 0;
  const at = (nx: number, ny: number): TerrainFamily | null => {
    const row = grid[ny];
    if (!row || !row[nx]) return null;
    return TILE_FAMILY[row[nx]!];
  };
  const north = at(x, y - 1);
  const east = at(x + 1, y);
  const south = at(x, y + 1);
  const west = at(x - 1, y);
  if (north && predicate(north, self)) mask |= Edge.North;
  if (east && predicate(east, self)) mask |= Edge.East;
  if (south && predicate(south, self)) mask |= Edge.South;
  if (west && predicate(west, self)) mask |= Edge.West;
  return mask;
}

export interface Decal {
  kind: "pebble" | "tuft" | "root" | "leaf" | "reed" | "crack";
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: number;
}

/** Decal kinds that suit each family, and how densely they scatter. */
const DECAL_TABLE: Record<TerrainFamily, { kinds: Decal["kind"][]; density: number; colors: number[] }> = {
  ground: { kinds: ["tuft", "pebble", "leaf", "root"], density: 0.34, colors: [0x2c6b4c, 0x35774f, 0x4a5f43, 0x6b7a4e] },
  wetland: { kinds: ["reed", "tuft"], density: 0.4, colors: [0x4b9a7e, 0x3f8a72, 0x63b394] },
  path: { kinds: ["pebble", "crack"], density: 0.3, colors: [0x6f7c58, 0x808d66, 0x4f5a3e] },
  stone: { kinds: ["pebble", "crack"], density: 0.45, colors: [0x4a5f5b, 0x566c68, 0x3a4d4a] },
  water: { kinds: [], density: 0, colors: [] },
};

/**
 * Scatters stable decals across a cell. Two decals per cell at most — this is
 * texture, not clutter, and it has to stay cheap to redraw.
 */
export function decalsFor(family: TerrainFamily, x: number, y: number, tileSize: number): Decal[] {
  const table = DECAL_TABLE[family];
  if (table.kinds.length === 0) return [];

  const decals: Decal[] = [];
  for (let slot = 0; slot < 2; slot += 1) {
    const roll = cellHash(x, y, 31 + slot * 17);
    if (roll > table.density) continue;
    const kind = table.kinds[Math.floor(cellHash(x, y, 53 + slot) * table.kinds.length)]!;
    decals.push({
      kind,
      // Inset so decals do not straddle the cell boundary and create seams.
      x: (0.2 + cellHash(x, y, 71 + slot) * 0.6) * tileSize,
      y: (0.2 + cellHash(x, y, 97 + slot) * 0.6) * tileSize,
      size: 0.7 + cellHash(x, y, 113 + slot) * 0.6,
      rotation: cellHash(x, y, 131 + slot) * Math.PI * 2,
      color: table.colors[Math.floor(cellHash(x, y, 149 + slot) * table.colors.length)]!,
    });
  }
  return decals;
}
