import Phaser from "phaser";

import type { Season, WorldState } from "../sim/types";

type WeatherKind = "spores" | "petals" | "embers" | "ash" | "rain" | "moth-dust";

interface Spec {
  color: number;
  size: [number, number];
  alpha: number;
  driftX: [number, number];
  driftY: [number, number];
  life: [number, number];
  count: number;
}

const SEASON_WEATHER: Record<Season, WeatherKind> = {
  mosswake: "petals",
  suncrest: "spores",
  emberfall: "embers",
  longshade: "ash",
};

const SPECS: Record<WeatherKind, Spec> = {
  spores: {
    color: 0xc8fff5,
    size: [1, 2.4],
    alpha: 0.38,
    driftX: [-18, 18],
    driftY: [-48, -22],
    life: [2800, 4600],
    count: 1,
  },
  petals: {
    color: 0x8dbb72,
    size: [1.6, 3.2],
    alpha: 0.5,
    driftX: [-40, 28],
    driftY: [18, 46],
    life: [2400, 4000],
    count: 1,
  },
  embers: {
    color: 0xf4b85b,
    size: [1.2, 2.4],
    alpha: 0.55,
    driftX: [-12, 22],
    driftY: [-56, -28],
    life: [1800, 3200],
    count: 1,
  },
  ash: {
    color: 0x9eb9ad,
    size: [1, 2.6],
    alpha: 0.42,
    driftX: [-30, 10],
    driftY: [24, 70],
    life: [2200, 3800],
    count: 2,
  },
  rain: {
    color: 0x8ec8d4,
    size: [0.7, 1.2],
    alpha: 0.35,
    driftX: [-8, -2],
    driftY: [90, 140],
    life: [700, 1100],
    count: 4,
  },
  "moth-dust": {
    color: 0xc8a9ff,
    size: [1.2, 2.2],
    alpha: 0.46,
    driftX: [-24, 24],
    driftY: [-36, -10],
    life: [2600, 4200],
    count: 1,
  },
};

/**
 * Seasonal weather drawn as short-lived motes. Keeps the basin feeling alive
 * between ticks without touching simulation state.
 */
export class WeatherLayer {
  private readonly layer: Phaser.GameObjects.Container;
  private timer = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bounds: { x: number; y: number; width: number; height: number },
    depth: number,
  ) {
    this.layer = scene.add.container(0, 0).setDepth(depth);
  }

  destroy(): void {
    this.layer.destroy(true);
  }

  update(state: WorldState, delta: number): void {
    this.timer += delta;
    const crisis = Boolean(state.longShadeCrisis);
    const raining = state.season === "longshade" || (state.season === "emberfall" && state.phase === "night");
    const interval = raining ? 70 : crisis ? 110 : 220;
    if (this.timer < interval) return;
    this.timer = 0;

    this.spawn(SEASON_WEATHER[state.season]);
    if (raining) this.spawn("rain");
    if (state.residents.some((resident) => resident.species === "cloudmoth")) {
      this.spawn("moth-dust");
    }
  }

  private spawn(kind: WeatherKind): void {
    const spec = SPECS[kind];
    for (let index = 0; index < spec.count; index += 1) {
      const x = this.bounds.x + Math.random() * this.bounds.width;
      const y = this.bounds.y + Math.random() * this.bounds.height;
      const radius = spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]);
      const mote = this.scene.add.circle(x, y, radius, spec.color, spec.alpha);
      this.layer.add(mote);

      const life = spec.life[0] + Math.random() * (spec.life[1] - spec.life[0]);
      this.scene.tweens.add({
        targets: mote,
        x: x + spec.driftX[0] + Math.random() * (spec.driftX[1] - spec.driftX[0]),
        y: y + spec.driftY[0] + Math.random() * (spec.driftY[1] - spec.driftY[0]),
        alpha: 0,
        duration: life,
        ease: "Sine.easeOut",
        onComplete: () => mote.destroy(),
      });
    }
  }
}
