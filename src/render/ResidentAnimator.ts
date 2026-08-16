import Phaser from "phaser";

import type { LifeStage, Species } from "../sim/types";

/**
 * Sprite-sheet animation for residents.
 *
 * The board had no animation system at all: every resident was a single static
 * image, and "walking" was that one image squashed and rotated on a four-step
 * counter in the scene's `update`. It reads acceptably in motion and it is a
 * ceiling — a resident could never do anything a single texture cannot, so the
 * work loops, life stages and facing that the simulation already tracks had no
 * way to reach the screen.
 *
 * This is the real infrastructure: generated sheets, registered Phaser
 * animations, and a state machine per resident.
 *
 * ---
 *
 * PLACEHOLDER ART. Nothing here draws a new creature. Each frame is the
 * existing single sprite redrawn under a transform, so the *motion* is real and
 * frame-based while the *art* is still one pose. When hand-drawn sheets land,
 * `buildPlaceholderSheet` is replaced by a `load.spritesheet` call and
 * everything below is unchanged — same keys, same frame counts, same states.
 */

export type AnimState = "idle" | "walk" | "work";

/** Frames per state. Hand-drawn sheets should match these counts. */
export const FRAME_COUNT = 4;

/** The size each frame is drawn at inside the generated sheet. */
const FRAME_W = 64;
const FRAME_H = 78;

const FRAME_RATE: Record<AnimState, number> = { idle: 4, walk: 9, work: 7 };

interface Transform {
  /** Vertical offset in frame pixels: the lift of a stride. */
  lift: number;
  scaleX: number;
  scaleY: number;
  /** Radians. */
  rotate: number;
}

/**
 * The per-frame transforms that stand in for drawn frames.
 *
 * These are deliberately the same shapes the old inline hack produced — a
 * stride lifts and leans, an idle breathes — so this pass changes how the
 * motion is *driven* without changing how the board looks until real art
 * arrives.
 */
const PLACEHOLDER: Record<AnimState, Transform[]> = {
  idle: [
    { lift: 0, scaleX: 1, scaleY: 1, rotate: 0 },
    { lift: -1, scaleX: 0.995, scaleY: 1.015, rotate: 0 },
    { lift: 0, scaleX: 1, scaleY: 1, rotate: 0 },
    { lift: 1, scaleX: 1.005, scaleY: 0.985, rotate: 0 },
  ],
  walk: [
    { lift: -2, scaleX: 1, scaleY: 0.94, rotate: 0 },
    { lift: -4, scaleX: 0.99, scaleY: 1.02, rotate: 0.08 },
    { lift: -2, scaleX: 0.93, scaleY: 0.9, rotate: 0 },
    { lift: -4, scaleX: 0.99, scaleY: 1.02, rotate: -0.08 },
  ],
  work: [
    { lift: 0, scaleX: 1, scaleY: 1, rotate: 0.12 },
    { lift: 2, scaleX: 1.02, scaleY: 0.93, rotate: 0.2 },
    { lift: 0, scaleX: 1, scaleY: 1, rotate: 0.12 },
    { lift: -1, scaleX: 0.99, scaleY: 1.02, rotate: 0.04 },
  ],
};

const STATES: AnimState[] = ["idle", "walk", "work"];

/** How large a resident draws, by how far through life they are. */
const STAGE_SCALE: Record<LifeStage, number> = { sprout: 0.72, adult: 1, elder: 0.94 };

export const sheetKeyFor = (species: Species): string => `resident-sheet-${species}`;
export const animKeyFor = (species: Species, state: AnimState): string => `${species}-${state}`;

/**
 * Draws one species' sheet into a canvas texture: a row per state, a column per
 * frame, each cell the base sprite under that frame's transform.
 *
 * Returns false when the base texture is missing, which leaves the caller on
 * its existing vector fallback.
 */
function buildPlaceholderSheet(scene: Phaser.Scene, species: Species, baseKey: string): boolean {
  if (!scene.textures.exists(baseKey)) return false;
  const sheetKey = sheetKeyFor(species);
  if (scene.textures.exists(sheetKey)) return true;

  const source = scene.textures.get(baseKey).getSourceImage() as CanvasImageSource;
  const canvas = scene.textures.createCanvas(sheetKey, FRAME_W * FRAME_COUNT, FRAME_H * STATES.length);
  if (!canvas) return false;

  const context = canvas.context;
  context.imageSmoothingEnabled = true;

  STATES.forEach((state, row) => {
    PLACEHOLDER[state].forEach((transform, column) => {
      const cx = column * FRAME_W + FRAME_W / 2;
      const cy = row * FRAME_H + FRAME_H / 2;
      context.save();
      context.translate(cx, cy + transform.lift);
      context.rotate(transform.rotate);
      context.scale(transform.scaleX, transform.scaleY);
      // Drawn centred so the transform pivots on the creature, not the corner.
      context.drawImage(source, -FRAME_W / 2, -FRAME_H / 2, FRAME_W, FRAME_H);
      context.restore();

      canvas.add(row * FRAME_COUNT + column, 0, column * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
    });
  });

  canvas.refresh();
  return true;
}

/**
 * Builds every species' sheet and registers its animations. Safe to call more
 * than once: existing textures and animations are left alone.
 */
export function createResidentAnimations(
  scene: Phaser.Scene,
  baseKeys: Record<Species, string>,
): Set<Species> {
  const built = new Set<Species>();

  for (const [name, baseKey] of Object.entries(baseKeys) as Array<[Species, string]>) {
    if (!buildPlaceholderSheet(scene, name, baseKey)) continue;
    built.add(name);

    const sheetKey = sheetKeyFor(name);
    STATES.forEach((state, row) => {
      const key = animKeyFor(name, state);
      if (scene.anims.exists(key)) return;
      scene.anims.create({
        key,
        frames: Array.from({ length: FRAME_COUNT }, (_, column) => ({
          key: sheetKey,
          frame: row * FRAME_COUNT + column,
        })),
        frameRate: FRAME_RATE[state],
        repeat: -1,
      });
    });
  }

  return built;
}

/**
 * Puts a resident's sprite into the right state, facing the right way, at the
 * right size for their age.
 *
 * `facing` is the x-delta of their travel; zero leaves facing untouched so a
 * resident standing still does not snap back to a default.
 */
export function applyResidentAnimation(
  sprite: Phaser.GameObjects.Sprite,
  species: Species,
  state: AnimState,
  stage: LifeStage,
  facing: number,
): void {
  const key = animKeyFor(species, state);
  // `play` restarts an animation that is already running, which would freeze a
  // walk cycle on its first frame every tick.
  if (sprite.anims.currentAnim?.key !== key) sprite.play(key, true);

  const scale = STAGE_SCALE[stage] ?? 1;
  sprite.setDisplaySize(30 * scale, 37 * scale);
  if (facing !== 0) sprite.setFlipX(facing < 0);
}
