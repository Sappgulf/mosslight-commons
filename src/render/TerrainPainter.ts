import Phaser from "phaser";

import type { TileKind } from "../sim/types";
import {
  cellHash,
  decalsFor,
  Edge,
  edgeMask,
  FAMILY_PALETTE,
  FOAM_COLOR,
  SHORE_COLOR,
  TILE_FAMILY,
  variantFor,
  type TerrainFamily,
} from "./terrain";

/**
 * Edge tests for the terrain masks, at module scope: neither captures anything
 * from the method that uses it, so rebuilding them on every repaint was pure
 * allocation.
 */
const differs = (neighbor: TerrainFamily, self: TerrainFamily): boolean => neighbor !== self;
const touchesWater = (neighbor: TerrainFamily, self: TerrainFamily): boolean =>
  neighbor === "water" && self !== "water";

export interface TerrainPainterConfig {
  tileSize: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Draws the whole terrain surface: autotiled family transitions, shorelines,
 * per-cell colour variation, and scattered decals.
 *
 * This is a persistent Graphics object rather than an immediate-mode redraw.
 * Terrain only changes on gather, regrowth, and zone reveal, so the expensive
 * pass runs a handful of times per session and costs nothing in between.
 */
export class TerrainPainter {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly config: TerrainPainterConfig;

  constructor(scene: Phaser.Scene, config: TerrainPainterConfig) {
    this.config = config;
    this.graphics = scene.add.graphics();
  }

  setDepth(depth: number): this {
    this.graphics.setDepth(depth);
    return this;
  }

  destroy(): void {
    this.graphics.destroy();
  }

  repaint(grid: TileKind[][], revealed: boolean[][]): void {
    const { tileSize } = this.config;
    const graphics = this.graphics;
    graphics.clear();

    this.paintBase(graphics, grid, revealed, tileSize);
    this.paintTransitions(graphics, grid, revealed, tileSize);
    this.paintShorelines(graphics, grid, revealed, tileSize);
    this.paintDecals(graphics, grid, revealed, tileSize);
  }

  /** Flat fill per cell, using a stable per-cell colour variant. */
  private paintBase(
    graphics: Phaser.GameObjects.Graphics,
    grid: TileKind[][],
    revealed: boolean[][],
    tileSize: number,
  ): void {
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        const px = this.config.offsetX + x * tileSize;
        const py = this.config.offsetY + y * tileSize;
        if (!revealed[y]?.[x]) {
          // Unmapped ground is mist, not a hole. A flat near-black rectangle
          // reads as missing geometry; this reads as somewhere you cannot see
          // yet. Cells on the frontier are lighter, so the mist has an edge.
          const frontier =
            revealed[y - 1]?.[x] || revealed[y + 1]?.[x] || revealed[y]?.[x - 1] || revealed[y]?.[x + 1];
          const drift = cellHash(x, y, 617);
          graphics.fillStyle(0x0d2830, 1);
          graphics.fillRect(px, py, tileSize, tileSize);
          graphics.fillStyle(0x16404a, frontier ? 0.28 + drift * 0.2 : 0.08 + drift * 0.14);
          graphics.fillRect(px, py, tileSize, tileSize);
          // A few soft motes so the mist is not dead flat.
          if (drift > 0.62) {
            graphics.fillStyle(0x3e7d84, 0.16);
            graphics.fillCircle(
              px + tileSize * (0.25 + cellHash(x, y, 631) * 0.5),
              py + tileSize * (0.25 + cellHash(x, y, 641) * 0.5),
              tileSize * 0.22,
            );
          }
          continue;
        }
        const family = TILE_FAMILY[grid[y]![x]!];
        graphics.fillStyle(variantFor(family, x, y), 1);
        graphics.fillRect(px, py, tileSize, tileSize);
      }
    }
  }

  /**
   * Soft transition strips wherever two families meet. This is what removes the
   * hard square-grid read — a boundary now has a blended lip rather than a
   * pixel-crisp step.
   */
  private paintTransitions(
    graphics: Phaser.GameObjects.Graphics,
    grid: TileKind[][],
    revealed: boolean[][],
    tileSize: number,
  ): void {
    const lip = Math.max(3, Math.round(tileSize * 0.22));

    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        if (!revealed[y]?.[x]) continue;
        const self = TILE_FAMILY[grid[y]![x]!];
        const mask = edgeMask(grid, x, y, differs);
        if (mask === 0) continue;

        const px = this.config.offsetX + x * tileSize;
        const py = this.config.offsetY + y * tileSize;
        const color = FAMILY_PALETTE[self].edge;

        // Ragged lip: the strip is split into segments of jittered depth so the
        // boundary reads as organic instead of ruled.
        const segments = 4;
        const segment = tileSize / segments;
        for (let index = 0; index < segments; index += 1) {
          const jitter = 0.45 + cellHash(x * segments + index, y, 307) * 0.75;
          const depth = lip * jitter;
          const offset = index * segment;
          graphics.fillStyle(color, 0.3);
          if (mask & Edge.North) graphics.fillRect(px + offset, py, segment, depth);
          if (mask & Edge.South) graphics.fillRect(px + offset, py + tileSize - depth, segment, depth);
          if (mask & Edge.West) graphics.fillRect(px, py + offset, depth, segment);
          if (mask & Edge.East) graphics.fillRect(px + tileSize - depth, py + offset, depth, segment);
        }
      }
    }
  }

  /**
   * Land that touches open water gets a sand bank and a foam line. Shorelines
   * do more for readability than any other single terrain treatment.
   */
  private paintShorelines(
    graphics: Phaser.GameObjects.Graphics,
    grid: TileKind[][],
    revealed: boolean[][],
    tileSize: number,
  ): void {
    const bank = Math.max(3, Math.round(tileSize * 0.28));

    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        if (!revealed[y]?.[x]) continue;
        const mask = edgeMask(grid, x, y, touchesWater);
        if (mask === 0) continue;

        const px = this.config.offsetX + x * tileSize;
        const py = this.config.offsetY + y * tileSize;
        const segments = 5;
        const segment = tileSize / segments;

        for (let index = 0; index < segments; index += 1) {
          const jitter = 0.5 + cellHash(x * segments + index, y, 419) * 0.8;
          const depth = bank * jitter;
          const offset = index * segment;

          graphics.fillStyle(SHORE_COLOR, 0.34);
          if (mask & Edge.North) graphics.fillRect(px + offset, py, segment, depth);
          if (mask & Edge.South) graphics.fillRect(px + offset, py + tileSize - depth, segment, depth);
          if (mask & Edge.West) graphics.fillRect(px, py + offset, depth, segment);
          if (mask & Edge.East) graphics.fillRect(px + tileSize - depth, py + offset, depth, segment);

          // Foam sits just inside the water side of the boundary.
          graphics.fillStyle(FOAM_COLOR, 0.22);
          const foam = Math.max(1, tileSize * 0.06);
          if (mask & Edge.North) graphics.fillRect(px + offset, py - foam, segment, foam);
          if (mask & Edge.South) graphics.fillRect(px + offset, py + tileSize, segment, foam);
          if (mask & Edge.West) graphics.fillRect(px - foam, py + offset, foam, segment);
          if (mask & Edge.East) graphics.fillRect(px + tileSize, py + offset, foam, segment);
        }
      }
    }
  }

  private paintDecals(
    graphics: Phaser.GameObjects.Graphics,
    grid: TileKind[][],
    revealed: boolean[][],
    tileSize: number,
  ): void {
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        if (!revealed[y]?.[x]) continue;
        const family = TILE_FAMILY[grid[y]![x]!];
        const px = this.config.offsetX + x * tileSize;
        const py = this.config.offsetY + y * tileSize;

        for (const decal of decalsFor(family, x, y, tileSize)) {
          const dx = px + decal.x;
          const dy = py + decal.y;
          const scale = decal.size * (tileSize / 32);
          graphics.fillStyle(decal.color, 0.55);

          switch (decal.kind) {
            case "pebble":
              graphics.fillEllipse(dx, dy, 3.4 * scale, 2.6 * scale);
              break;
            case "tuft":
              graphics.lineStyle(1.2 * scale, decal.color, 0.6);
              graphics.lineBetween(dx, dy + 2.6 * scale, dx - 1.8 * scale, dy - 2.6 * scale);
              graphics.lineBetween(dx, dy + 2.6 * scale, dx + 0.4 * scale, dy - 3.2 * scale);
              graphics.lineBetween(dx, dy + 2.6 * scale, dx + 2.2 * scale, dy - 2 * scale);
              break;
            case "reed":
              graphics.lineStyle(1 * scale, decal.color, 0.5);
              graphics.lineBetween(dx, dy + 3.4 * scale, dx + Math.cos(decal.rotation) * 2 * scale, dy - 4 * scale);
              break;
            case "root":
              graphics.lineStyle(1.4 * scale, decal.color, 0.4);
              graphics.lineBetween(
                dx - 3.4 * scale * Math.cos(decal.rotation),
                dy - 3.4 * scale * Math.sin(decal.rotation),
                dx + 3.4 * scale * Math.cos(decal.rotation),
                dy + 3.4 * scale * Math.sin(decal.rotation),
              );
              break;
            case "leaf":
              graphics.fillEllipse(dx, dy, 4.2 * scale, 2 * scale);
              break;
            case "crack":
              graphics.lineStyle(0.9 * scale, decal.color, 0.45);
              graphics.lineBetween(dx, dy, dx + Math.cos(decal.rotation) * 5 * scale, dy + Math.sin(decal.rotation) * 5 * scale);
              break;
          }
        }
      }
    }
  }
}
