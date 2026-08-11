import Phaser from "phaser";

export type BurstStyle = "gather" | "build" | "upgrade" | "warn";

const BURST_COLORS: Record<BurstStyle, number[]> = {
  gather: [0x8dbb72, 0xc5dd8c, 0xf4b85b],
  build: [0x63e6d4, 0xf5e6c8, 0x8dbb72],
  upgrade: [0xf4b85b, 0xffd58b, 0x63e6d4],
  warn: [0xe87968, 0xffb4a5],
};

/**
 * Transient feedback: floating gain numbers and particle bursts.
 *
 * Before this, gathering a node changed an integer in a panel 700px away from
 * the click. Acknowledging input at the point of input is most of what makes a
 * game feel responsive rather than merely correct.
 */
export class Effects {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    this.layer = scene.add.container(0, 0).setDepth(depth);
  }

  destroy(): void {
    this.layer.destroy(true);
  }

  /** A number that rises and fades from a world position. */
  floatText(x: number, y: number, text: string, color = "#f5e6c8"): void {
    const label = this.scene.add.text(x, y, text, {
      color,
      fontFamily: "Georgia, serif",
      fontSize: "14px",
      fontStyle: "bold",
      stroke: "#08151b",
      strokeThickness: 4,
    }).setOrigin(0.5, 1);
    this.layer.add(label);

    this.scene.tweens.add({
      targets: label,
      y: y - 34,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.85, to: 1.12 },
      duration: 1100,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  /** A short outward spray of motes. */
  burst(x: number, y: number, style: BurstStyle, count = 10): void {
    const colors = BURST_COLORS[style];
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
      const distance = 16 + Math.random() * 22;
      const mote = this.scene.add.circle(
        x,
        y,
        1.4 + Math.random() * 2.2,
        colors[index % colors.length]!,
        0.95,
      );
      this.layer.add(mote);

      this.scene.tweens.add({
        targets: mote,
        x: x + Math.cos(angle) * distance,
        // Bias upward so the spray reads as lift rather than a flat ring.
        y: y + Math.sin(angle) * distance - 10,
        alpha: 0,
        scale: 0.3,
        duration: 520 + Math.random() * 320,
        ease: "Cubic.easeOut",
        onComplete: () => mote.destroy(),
      });
    }
  }

  /** An expanding ring, used for placement and completion beats. */
  ring(x: number, y: number, color: number, radius = 34): void {
    const ring = this.scene.add.circle(x, y, 6);
    ring.setStrokeStyle(2, color, 0.9);
    this.layer.add(ring);

    this.scene.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 620,
      ease: "Cubic.easeOut",
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy(),
    });
  }

  /** Dust kicked up where a building lands. */
  dust(x: number, y: number): void {
    for (let index = 0; index < 8; index += 1) {
      const puff = this.scene.add.ellipse(
        x + (Math.random() - 0.5) * 26,
        y + 6 + Math.random() * 4,
        6 + Math.random() * 8,
        3 + Math.random() * 4,
        0x9eb9ad,
        0.5,
      );
      this.layer.add(puff);
      this.scene.tweens.add({
        targets: puff,
        x: puff.x + (puff.x - x) * 0.8,
        y: puff.y - 6,
        alpha: 0,
        scaleX: 1.9,
        duration: 560,
        ease: "Sine.easeOut",
        onComplete: () => puff.destroy(),
      });
    }
  }

  /** Slow drifting spores, used as ambient life across the board. */
  spawnAmbientMote(bounds: { x: number; y: number; width: number; height: number }): void {
    const mote = this.scene.add.circle(
      bounds.x + Math.random() * bounds.width,
      bounds.y + Math.random() * bounds.height,
      0.8 + Math.random() * 1.4,
      0xc8fff5,
      0.42,
    );
    this.layer.add(mote);
    this.scene.tweens.add({
      targets: mote,
      y: mote.y - 40 - Math.random() * 50,
      x: mote.x + (Math.random() - 0.5) * 40,
      alpha: { from: 0, to: 0.42 },
      duration: 3200 + Math.random() * 2600,
      ease: "Sine.easeInOut",
      yoyo: false,
      onComplete: () => mote.destroy(),
    });
  }
}
