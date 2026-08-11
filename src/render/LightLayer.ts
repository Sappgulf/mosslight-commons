import Phaser from "phaser";

import type { WorldState } from "../sim/types";

const GRADIENT_KEY = "light-gradient";
const GRADIENT_SIZE = 128;

export interface LightSource {
  x: number;
  y: number;
  /** Radius in world pixels. */
  radius: number;
  /** 0..1 — how brightly this source burns. */
  strength: number;
  color: number;
}

/** Darkness colour and opacity per phase. Day is fully clear. */
const PHASE_DARKNESS: Record<WorldState["phase"], { color: number; alpha: number }> = {
  dawn: { color: 0x2b3a63, alpha: 0.2 },
  day: { color: 0x000000, alpha: 0 },
  dusk: { color: 0x3a2748, alpha: 0.36 },
  night: { color: 0x061031, alpha: 0.66 },
};

/**
 * Day/night lighting: a darkness wash with additive glow pools over it.
 *
 * The obvious implementation is a RenderTexture filled with darkness that light
 * sources ERASE holes in. Phaser 4's RenderTexture does not draw reliably in
 * this build — the terrain pass hit the same wall — so this instead lays a
 * translucent dark rectangle over the board and adds blended light sprites on
 * top. Additive light lifts the darkened ground back toward its lit colour,
 * which reads the same way and uses nothing but ordinary sprites.
 */
export class LightLayer {
  private readonly darkness: Phaser.GameObjects.Rectangle;
  private readonly glowLayer: Phaser.GameObjects.Container;
  /** Reused glow sprites; light sources come and go every frame. */
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private currentAlpha = 0;
  private readonly hasGradient: boolean;

  constructor(
    private readonly scene: Phaser.Scene,
    bounds: { x: number; y: number; width: number; height: number },
  ) {
    this.hasGradient = LightLayer.ensureGradient(scene);

    this.darkness = scene.add
      .rectangle(bounds.x, bounds.y, bounds.width, bounds.height, 0x000000, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    this.glowLayer = scene.add.container(0, 0);
  }

  setDepth(depth: number): this {
    this.darkness.setDepth(depth);
    // Glows sit just above the darkness they are cutting through.
    this.glowLayer.setDepth(depth + 1);
    return this;
  }

  destroy(): void {
    this.darkness.destroy();
    this.glowLayer.destroy(true);
  }

  /**
   * Builds the soft radial falloff once as a canvas texture. Phaser has no
   * gradient primitive, and one stamped image beats drawing concentric circles
   * per light per frame.
   */
  private static ensureGradient(scene: Phaser.Scene): boolean {
    if (scene.textures.exists(GRADIENT_KEY)) return true;

    const canvasTexture = scene.textures.createCanvas(GRADIENT_KEY, GRADIENT_SIZE, GRADIENT_SIZE);
    const context = canvasTexture?.getContext();
    if (!canvasTexture || !context) return false;

    const half = GRADIENT_SIZE / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    // A soft shoulder; a linear ramp reads as a hard disc at the edge.
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
    gradient.addColorStop(0.72, "rgba(255,255,255,0.2)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
    canvasTexture.refresh();
    return true;
  }

  update(phase: WorldState["phase"], sources: LightSource[]): void {
    const target = PHASE_DARKNESS[phase];

    // Ease so dusk falls rather than cutting.
    this.currentAlpha += (target.alpha - this.currentAlpha) * 0.06;

    if (this.currentAlpha < 0.01) {
      this.darkness.setVisible(false);
      this.hideFrom(0);
      return;
    }

    this.darkness.setVisible(true);
    this.darkness.setFillStyle(target.color, this.currentAlpha);

    if (!this.hasGradient) {
      this.hideFrom(0);
      return;
    }

    // Glow intensity tracks how dark it is, so lanterns are invisible at noon
    // and blazing at midnight.
    const nightFactor = Phaser.Math.Clamp(this.currentAlpha / 0.66, 0, 1);

    sources.forEach((source, index) => {
      const sprite = this.spriteAt(index);
      sprite
        .setVisible(true)
        .setPosition(source.x, source.y)
        .setDisplaySize(source.radius * 2, source.radius * 2)
        .setTint(source.color)
        .setAlpha(source.strength * nightFactor);
    });
    this.hideFrom(sources.length);
  }

  private spriteAt(index: number): Phaser.GameObjects.Image {
    let sprite = this.pool[index];
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, GRADIENT_KEY).setBlendMode(Phaser.BlendModes.ADD);
      this.glowLayer.add(sprite);
      this.pool[index] = sprite;
    }
    return sprite;
  }

  private hideFrom(index: number): void {
    for (let cursor = index; cursor < this.pool.length; cursor += 1) {
      this.pool[cursor]!.setVisible(false);
    }
  }
}
