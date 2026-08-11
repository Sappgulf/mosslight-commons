import Phaser from "phaser";

import { BUILDING_DEFINITIONS, DISTRICT_DEFINITIONS, SPECIES_DEFINITIONS } from "../data/definitions";
import { MosslightSimulation } from "../sim/simulation";
import type { BuildingType, ItemKey, ResidentGoal, ResourceKey, Species, TileKind, Vec2 } from "../sim/types";

const TILE_SIZE = 22;
const OFFSET_X = 52;
const OFFSET_Y = 60;

const TILE_COLORS: Record<TileKind, number> = {
  grass: 0x173e35,
  water: 0x124e59,
  wetland: 0x236d61,
  path: 0x5c6b4b,
  stone: 0x2b3f3d,
  fern: 0x255c43,
  mushroom: 0x5a3f38,
  crystal: 0x1b777f,
  ruin: 0x48524b,
};

const INK = 0x08151b;
const PAPER = 0xf5e6c8;
const VALID_COLOR = 0x8dbb72;
const INVALID_COLOR = 0xe87968;

const PHASE_COLORS = {
  dawn: 0xffd58b,
  day: 0x63e6d4,
  dusk: 0xf4b85b,
  night: 0xc8a9ff,
} as const;

const GOAL_COLORS: Record<ResidentGoal, number> = {
  rest: 0xf4b85b,
  forage: 0x8dbb72,
  work: 0x63e6d4,
  socialize: 0xc8a9ff,
  explore: 0xffd58b,
};

const GOAL_LABELS: Record<ResidentGoal, string> = {
  rest: "REST",
  forage: "FORAGE",
  work: "WORK",
  socialize: "SOCIAL",
  explore: "EXPLORE",
};

const RESOURCE_CODES: Record<ResourceKey, string> = {
  food: "F",
  water: "W",
  warmth: "H",
  light: "L",
};

const ITEM_CODES: Record<ItemKey, string> = {
  "seed-pod": "S",
  resin: "R",
  moonwater: "M",
  "map-fragment": "MAP",
};

const COLLECTIBLE_LABELS: Partial<Record<TileKind, string>> = {
  fern: "FERN PATCH",
  mushroom: "EMBER MUSHROOM",
  crystal: "MOON CRYSTAL",
  ruin: "ROOT RUIN",
};

const BUILDING_TEXTURE_KEYS: Partial<Record<BuildingType, string>> = {
  "root-heart": "building-root-heart",
  "burrow-home": "building-burrow-home",
  "reed-farm": "building-reed-farm",
  "lantern-grove": "building-lantern-grove",
  "commons-market": "building-commons-market",
  "root-workshop": "building-root-workshop",
};

const BUILDING_DISPLAY_SIZES: Partial<Record<BuildingType, { width: number; height: number }>> = {
  "root-heart": { width: 54, height: 56 },
  "burrow-home": { width: 40, height: 39 },
  "reed-farm": { width: 43, height: 42 },
  "lantern-grove": { width: 40, height: 42 },
  "commons-market": { width: 48, height: 44 },
  "root-workshop": { width: 45, height: 43 },
};

const RESIDENT_TEXTURE_KEYS: Record<Species, string> = {
  brambleback: "resident-brambleback",
  glowtail: "resident-glowtail",
  mireling: "resident-mireling",
};

const NODE_TEXTURE_KEYS: Partial<Record<TileKind, string>> = {
  fern: "node-fern",
  mushroom: "node-mushroom",
  crystal: "node-crystal",
  ruin: "node-ruin",
};

interface BuildPreviewState {
  valid: boolean;
  reason: string;
}

export class WorldScene extends Phaser.Scene {
  private readonly simulation: MosslightSimulation;
  private readonly onStateChange: () => void;
  private worldLayer!: Phaser.GameObjects.Container;
  private heartbeatLayer!: Phaser.GameObjects.Container;
  private heartbeatGraphic!: Phaser.GameObjects.Graphics;
  private hoverCell: Vec2 | null = null;

  constructor(simulation: MosslightSimulation, onStateChange: () => void) {
    super({ key: "world" });
    this.simulation = simulation;
    this.onStateChange = onStateChange;
  }

  preload(): void {
    for (const [key, fileName] of Object.entries(BUILDING_TEXTURE_KEYS)) {
      if (fileName) this.load.image(fileName, `/assets/runtime/buildings/${key}.png`);
    }
    for (const [species, fileName] of Object.entries(RESIDENT_TEXTURE_KEYS)) {
      this.load.image(fileName, `/assets/runtime/residents/${species}.png`);
    }
    for (const [kind, fileName] of Object.entries(NODE_TEXTURE_KEYS)) {
      if (fileName) this.load.image(fileName, `/assets/runtime/nodes/${kind}.png`);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(INK);
    this.worldLayer = this.add.container(0, 0);
    this.heartbeatLayer = this.add.container(0, 0).setDepth(3);
    this.heartbeatGraphic = this.add.graphics();
    this.heartbeatLayer.add(this.heartbeatGraphic);
    this.tweens.add({
      targets: this.heartbeatLayer,
      scaleX: { from: 0.94, to: 1.08 },
      scaleY: { from: 0.94, to: 1.08 },
      alpha: { from: 0.8, to: 0.24 },
      duration: 1100,
      ease: "Sine.easeInOut",
      repeat: -1,
      yoyo: true,
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const cell = this.pointerToCell(pointer);
      if (!cell) return;

      this.hoverCell = cell;
      const buildMode = this.simulation.state.buildMode;
      if (buildMode) {
        this.simulation.build(buildMode, cell);
      } else {
        if (!this.simulation.collectAt(cell)) this.simulation.selectAt(cell);
      }
      this.renderNow();
      this.onStateChange();
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const nextCell = this.pointerToCell(pointer);
      const changed = nextCell?.x !== this.hoverCell?.x || nextCell?.y !== this.hoverCell?.y;
      this.hoverCell = nextCell;
      if (changed) this.renderNow();
    });

    this.input.on("pointerout", () => {
      if (!this.hoverCell) return;
      this.hoverCell = null;
      this.renderNow();
    });

    this.time.addEvent({
      delay: 520,
      loop: true,
      callback: () => {
        this.simulation.advance();
        this.renderNow();
        this.onStateChange();
      },
    });

    this.renderNow();
  }

  public renderNow(): void {
    if (!this.worldLayer) return;
    this.input.setDefaultCursor(this.simulation.state.buildMode ? "crosshair" : "pointer");
    this.worldLayer.removeAll(true);

    const board = this.add.graphics();
    board.fillStyle(0x0d2727, 1);
    board.fillRoundedRect(OFFSET_X - 12, OFFSET_Y - 12, TILE_SIZE * 32 + 24, TILE_SIZE * 24 + 24, 18);
    board.lineStyle(2, 0x2d8c84, 0.55);
    board.strokeRoundedRect(OFFSET_X - 12, OFFSET_Y - 12, TILE_SIZE * 32 + 24, TILE_SIZE * 24 + 24, 18);
    this.worldLayer.add(board);

    this.drawTiles();
    this.drawNodeSprites();
    this.drawDistricts();
    this.drawHoverCell();
    this.drawRootNetwork();
    this.drawSelectedIntentPath();
    this.drawBuildings();
    this.drawResidents();
    this.drawSelectedIntentTarget();
    this.drawExpeditions();
    this.drawBuildPreview();
    this.drawFogOfWar();
    this.drawMapLabel();
    this.updateHeartbeat();
  }

  private drawTiles(): void {
    const graphics = this.add.graphics();
    const { grid } = this.simulation.state;
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        const kind = grid[y]![x]!;
        const px = OFFSET_X + x * TILE_SIZE;
        const py = OFFSET_Y + y * TILE_SIZE;
        if (!this.simulation.state.revealed[y]?.[x]) {
          graphics.fillStyle(0x0a2528, 1);
          graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          graphics.lineStyle(1, 0x2d8c84, 0.15);
          graphics.lineBetween(px + 3, py + TILE_SIZE - 4, px + TILE_SIZE - 4, py + 3);
          continue;
        }
        graphics.fillStyle(TILE_COLORS[kind], 1);
        graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        if (kind === "water" || kind === "wetland") {
          graphics.lineStyle(1, 0x63e6d4, 0.15);
          graphics.lineBetween(px + 4, py + 8, px + TILE_SIZE - 5, py + 8);
        }
        if (kind === "path") {
          graphics.lineStyle(1, 0xf5e6c8, 0.2);
          graphics.lineBetween(px + 3, py + 5, px + TILE_SIZE - 5, py + TILE_SIZE - 5);
        }
        if (kind === "stone") {
          graphics.fillStyle(0x51605a, 0.65);
          graphics.fillCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 4);
        }
        if ((kind === "fern" || kind === "mushroom" || kind === "crystal" || kind === "ruin")
          && !this.textures.exists(NODE_TEXTURE_KEYS[kind] ?? "")) {
          this.drawFeature(graphics, kind, px, py);
        }
      }
    }
    this.worldLayer.add(graphics);
  }

  private drawNodeSprites(): void {
    const { grid, revealed } = this.simulation.state;
    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        const kind = grid[y]![x]!;
        const textureKey = NODE_TEXTURE_KEYS[kind];
        if (!textureKey || !revealed[y]?.[x] || !this.textures.exists(textureKey)) continue;
        const sprite = this.add.image(OFFSET_X + x * TILE_SIZE + TILE_SIZE / 2, OFFSET_Y + y * TILE_SIZE + TILE_SIZE / 2 - 2, textureKey)
          .setDisplaySize(29, 30)
          .setDepth(2);
        this.worldLayer.add(sprite);
      }
    }
  }

  private drawDistricts(): void {
    const activeFocus = this.simulation.state.districtFocus;
    for (const district of this.simulation.state.districts) {
      const definition = DISTRICT_DEFINITIONS[district.type];
      const color = Phaser.Display.Color.HexStringToColor(definition.color).color;
      const x = OFFSET_X + district.bounds.xMin * TILE_SIZE;
      const y = OFFSET_Y + district.bounds.yMin * TILE_SIZE;
      const width = (district.bounds.xMax - district.bounds.xMin + 1) * TILE_SIZE - 1;
      const height = (district.bounds.yMax - district.bounds.yMin + 1) * TILE_SIZE - 1;
      const graphics = this.add.graphics();
      graphics.lineStyle(district.type === activeFocus ? 2 : 1, color, district.type === activeFocus ? 0.42 : 0.16);
      graphics.strokeRect(x + 1, y + 1, width - 2, height - 2);
      this.worldLayer.add(graphics);
      if (district.type === activeFocus) {
        const label = this.add.text(OFFSET_X + district.center.x * TILE_SIZE + TILE_SIZE / 2, y + 4, definition.label.toUpperCase(), {
          color: Phaser.Display.Color.IntegerToColor(color).rgba,
          fontFamily: "system-ui, sans-serif",
          fontSize: "8px",
          fontStyle: "bold",
          backgroundColor: "#08151bc2",
          padding: { x: 3, y: 2 },
        }).setOrigin(0.5, 0);
        this.worldLayer.add(label);
      }
    }
  }

  private drawFeature(graphics: Phaser.GameObjects.Graphics, kind: TileKind, px: number, py: number): void {
    const centerX = px + TILE_SIZE / 2;
    const centerY = py + TILE_SIZE / 2;
    if (kind === "fern") {
      graphics.lineStyle(2, 0x8dbb72, 0.95);
      graphics.lineBetween(centerX, py + 18, centerX - 5, py + 5);
      graphics.lineBetween(centerX, py + 18, centerX + 6, py + 4);
      graphics.lineBetween(centerX - 3, py + 13, centerX - 9, py + 9);
      graphics.lineBetween(centerX + 3, py + 12, centerX + 10, py + 8);
      graphics.fillStyle(0xc5dd8c, 0.9);
      graphics.fillCircle(centerX - 6, py + 5, 2);
      graphics.fillCircle(centerX + 7, py + 4, 2);
      return;
    }
    if (kind === "mushroom") {
      graphics.fillStyle(0xf4b85b, 0.92);
      graphics.fillRoundedRect(centerX - 2, py + 10, 4, 8, 2);
      graphics.fillStyle(0xe98b50, 1);
      graphics.fillTriangle(centerX - 8, py + 11, centerX, py + 4, centerX + 8, py + 11);
      graphics.fillStyle(0xffd58b, 0.75);
      graphics.fillCircle(centerX - 3, py + 9, 1.2);
      graphics.fillCircle(centerX + 3, py + 8, 1.2);
      return;
    }
    if (kind === "crystal") {
      graphics.fillStyle(0x63e6d4, 0.78);
      graphics.fillTriangle(centerX, py + 3, centerX - 7, py + 16, centerX + 2, py + 18);
      graphics.fillStyle(0xc8fff5, 0.65);
      graphics.fillTriangle(centerX + 4, py + 6, centerX + 1, py + 17, centerX + 9, py + 14);
      graphics.lineStyle(1, 0xb8fff4, 0.8);
      graphics.lineBetween(centerX, py + 3, centerX - 2, py + 14);
      return;
    }
    graphics.fillStyle(0x788276, 0.86);
    graphics.fillRoundedRect(px + 3, py + 9, 7, 8, 2);
    graphics.fillRoundedRect(px + 12, py + 5, 7, 12, 2);
    graphics.fillStyle(0x2c3937, 0.8);
    graphics.fillRect(px + 7, py + 12, 3, 5);
    graphics.fillRect(px + 14, py + 8, 3, 5);
  }

  private drawHoverCell(): void {
    if (!this.hoverCell) return;

    const graphics = this.add.graphics();
    const position = this.hoverCell;
    const px = OFFSET_X + position.x * TILE_SIZE;
    const py = OFFSET_Y + position.y * TILE_SIZE;
    const buildMode = this.simulation.state.buildMode;
    const preview = buildMode ? this.getBuildPreview(buildMode, position) : undefined;
    const color = preview ? (preview.valid ? VALID_COLOR : INVALID_COLOR) : PAPER;

    graphics.fillStyle(color, buildMode ? 0.035 : 0.025);
    graphics.fillRect(px, py, TILE_SIZE - 1, TILE_SIZE - 1);
    graphics.lineStyle(1, color, buildMode ? 0.68 : 0.62);
    graphics.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 2, TILE_SIZE - 2);
    graphics.lineStyle(2, color, 0.82);
    const inset = 2;
    const length = 5;
    graphics.lineBetween(px + inset, py + inset, px + inset + length, py + inset);
    graphics.lineBetween(px + inset, py + inset, px + inset, py + inset + length);
    graphics.lineBetween(px + TILE_SIZE - inset, py + inset, px + TILE_SIZE - inset - length, py + inset);
    graphics.lineBetween(px + TILE_SIZE - inset, py + inset, px + TILE_SIZE - inset, py + inset + length);
    graphics.lineBetween(px + inset, py + TILE_SIZE - inset, px + inset + length, py + TILE_SIZE - inset);
    graphics.lineBetween(px + inset, py + TILE_SIZE - inset, px + inset, py + TILE_SIZE - inset - length);
    graphics.lineBetween(px + TILE_SIZE - inset, py + TILE_SIZE - inset, px + TILE_SIZE - inset - length, py + TILE_SIZE - inset);
    graphics.lineBetween(px + TILE_SIZE - inset, py + TILE_SIZE - inset, px + TILE_SIZE - inset, py + TILE_SIZE - inset - length);
    this.worldLayer.add(graphics);
  }

  private drawRootNetwork(): void {
    const graphics = this.add.graphics();
    const root = this.simulation.state.buildings.find((building) => building.type === "root-heart");
    if (!root) return;
    const center = this.cellCenter(root.position);
    graphics.lineStyle(2, 0x63e6d4, 0.24);
    graphics.beginPath();
    graphics.moveTo(center.x, center.y);
    graphics.lineTo(OFFSET_X + 7 * TILE_SIZE, OFFSET_Y + 17 * TILE_SIZE);
    graphics.moveTo(center.x, center.y);
    graphics.lineTo(OFFSET_X + 23 * TILE_SIZE, OFFSET_Y + 9 * TILE_SIZE);
    graphics.moveTo(center.x, center.y);
    graphics.lineTo(OFFSET_X + 17 * TILE_SIZE, OFFSET_Y + 12 * TILE_SIZE);
    graphics.strokePath();
    this.worldLayer.add(graphics);
  }

  private drawBuildings(): void {
    for (const building of this.simulation.state.buildings) {
      const graphics = this.add.graphics();
      const center = this.cellCenter(building.position);
      const definition = BUILDING_DEFINITIONS[building.type];
      const color = Phaser.Display.Color.HexStringToColor(definition.color).color;
      const textureKey = BUILDING_TEXTURE_KEYS[building.type];
      const displaySize = BUILDING_DISPLAY_SIZES[building.type] ?? { width: 40, height: 40 };

      if (textureKey && this.textures.exists(textureKey)) {
        const sprite = this.add.image(center.x, center.y - 4, textureKey)
          .setDisplaySize(displaySize.width, displaySize.height)
          .setDepth(4);
        this.worldLayer.add(sprite);
      } else if (building.type === "root-heart") {
        graphics.fillStyle(0x63e6d4, 0.16);
        graphics.fillCircle(center.x, center.y, 24);
        graphics.lineStyle(2, 0x63e6d4, 0.8);
        graphics.strokeCircle(center.x, center.y, 15);
        graphics.fillStyle(0x63e6d4, 0.9);
        graphics.fillCircle(center.x, center.y, 8);
        graphics.lineStyle(2, 0xb8fff4, 0.8);
        graphics.lineBetween(center.x - 8, center.y, center.x + 8, center.y);
        graphics.lineBetween(center.x, center.y - 8, center.x, center.y + 8);
        this.worldLayer.add(graphics);
      } else if (building.type === "burrow-home") {
        graphics.fillStyle(0x6e4938, 1);
        graphics.fillRoundedRect(center.x - 10, center.y - 8, 20, 17, 6);
        graphics.fillStyle(0xc96e4a, 1);
        graphics.fillTriangle(center.x - 13, center.y - 6, center.x, center.y - 16, center.x + 13, center.y - 6);
        graphics.fillStyle(0xf4b85b, 0.9);
        graphics.fillRect(center.x - 3, center.y + 1, 6, 7);
        this.worldLayer.add(graphics);
      } else if (building.type === "reed-farm") {
        graphics.fillStyle(0x6f9f62, 1);
        graphics.fillRoundedRect(center.x - 12, center.y - 9, 24, 18, 5);
        graphics.lineStyle(2, 0xc5dd8c, 0.8);
        for (let index = -6; index <= 6; index += 6) {
          graphics.lineBetween(center.x + index, center.y + 6, center.x + index - 2, center.y - 8);
        }
        graphics.fillStyle(0xf4b85b, 0.9);
        graphics.fillCircle(center.x, center.y - 4, 3);
        this.worldLayer.add(graphics);
      } else if (building.type === "lantern-grove") {
        graphics.fillStyle(0x234d45, 1);
        graphics.fillCircle(center.x, center.y + 3, 12);
        graphics.fillStyle(0xf4b85b, 0.9);
        graphics.fillCircle(center.x, center.y - 3, 7);
        graphics.fillStyle(0xffe4a3, 1);
        graphics.fillCircle(center.x, center.y - 3, 3);
        graphics.lineStyle(2, 0x8dbb72, 0.9);
        graphics.lineBetween(center.x - 8, center.y + 7, center.x - 5, center.y - 7);
        graphics.lineBetween(center.x + 8, center.y + 7, center.x + 5, center.y - 7);
        this.worldLayer.add(graphics);
      } else if (building.type === "commons-market") {
        graphics.fillStyle(color, 0.9);
        graphics.fillRoundedRect(center.x - 13, center.y - 8, 26, 16, 5);
        graphics.fillStyle(0xf4b85b, 0.85);
        graphics.fillTriangle(center.x - 15, center.y - 8, center.x, center.y - 18, center.x + 15, center.y - 8);
        graphics.fillStyle(0x08151b, 0.8);
        graphics.fillCircle(center.x - 6, center.y + 1, 2);
        graphics.fillCircle(center.x + 6, center.y + 1, 2);
        this.worldLayer.add(graphics);
      } else if (building.type === "root-workshop") {
        graphics.fillStyle(0x4b3d62, 0.95);
        graphics.fillRoundedRect(center.x - 13, center.y - 9, 26, 18, 4);
        graphics.fillStyle(0xc8a9ff, 0.88);
        graphics.fillTriangle(center.x - 14, center.y - 9, center.x, center.y - 17, center.x + 14, center.y - 9);
        graphics.lineStyle(2, 0xf5e6c8, 0.8);
        graphics.lineBetween(center.x - 8, center.y + 5, center.x + 8, center.y - 4);
        graphics.lineBetween(center.x + 2, center.y - 8, center.x + 8, center.y - 2);
        this.worldLayer.add(graphics);
      }

      const hovered = this.hoverCell?.x === building.position.x && this.hoverCell?.y === building.position.y;
      if (building.type !== "root-heart" && hovered) {
        const label = this.add.text(center.x, center.y + 14, definition.shortLabel, {
          color: "#f5e6c8",
          fontFamily: "Georgia, serif",
          fontSize: "8px",
          stroke: "#08151b",
          strokeThickness: 3,
        }).setOrigin(0.5);
        this.worldLayer.add(label);
      }
    }
  }

  private drawResidents(): void {
    for (const resident of this.simulation.state.residents) {
      const center = this.cellCenter(resident.position);
      const species = SPECIES_DEFINITIONS[resident.species];
      const color = Phaser.Display.Color.HexStringToColor(species.color).color;
      const intentColor = GOAL_COLORS[resident.goal];
      const selected = resident.id === this.simulation.state.selectedResidentId;
      const graphics = this.add.graphics();

      graphics.fillStyle(0x08151b, 0.46);
      graphics.fillEllipse(center.x, center.y + 7, 17, 6);
      if (selected) {
        graphics.fillStyle(intentColor, 0.12);
        graphics.fillCircle(center.x, center.y, 14);
        graphics.lineStyle(1, intentColor, 0.95);
        graphics.strokeCircle(center.x, center.y, 13);
        graphics.lineStyle(2, PAPER, 0.95);
        graphics.strokeCircle(center.x, center.y, 10);
      } else {
        graphics.fillStyle(intentColor, 0.68);
        graphics.fillTriangle(center.x, center.y - 11, center.x + 3, center.y - 7, center.x - 3, center.y - 7);
      }
      this.worldLayer.add(graphics);

      const textureKey = RESIDENT_TEXTURE_KEYS[resident.species];
      if (textureKey && this.textures.exists(textureKey)) {
        const sprite = this.add.image(center.x, center.y - 5, textureKey)
          .setDisplaySize(22, 27)
          .setDepth(5);
        this.worldLayer.add(sprite);
      } else {
        graphics.fillStyle(color, 1);
        graphics.fillCircle(center.x, center.y, 6);
        graphics.fillStyle(0xf5e6c8, 0.9);
        graphics.fillCircle(center.x - 2, center.y - 1, 1.2);
        graphics.fillCircle(center.x + 2, center.y - 1, 1.2);

        if (resident.species === "glowtail") {
          graphics.lineStyle(3, 0x63e6d4, 0.85);
          graphics.lineBetween(center.x + 5, center.y + 2, center.x + 10, center.y - 4);
        }
        if (resident.species === "mireling") {
          graphics.lineStyle(2, 0xc8a9ff, 0.8);
          graphics.lineBetween(center.x - 5, center.y - 5, center.x - 8, center.y - 9);
          graphics.lineBetween(center.x + 5, center.y - 5, center.x + 8, center.y - 9);
        }
      }

      if (selected) {
        const label = this.add.text(center.x, center.y - 17, `${resident.name}  ·  ${GOAL_LABELS[resident.goal]}`, {
          color: "#f5e6c8",
          fontFamily: "system-ui, sans-serif",
          fontSize: "9px",
          fontStyle: "bold",
          backgroundColor: "#08151bcc",
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1);
        this.worldLayer.add(label);
      }
    }
  }

  private drawSelectedIntentPath(): void {
    const resident = this.simulation.getSelectedResident();
    if (!resident?.target) return;

    const start = this.cellCenter(resident.position);
    const target = this.cellCenter(resident.target);
    if (start.x === target.x && start.y === target.y) return;

    const color = GOAL_COLORS[resident.goal];
    const graphics = this.add.graphics();
    graphics.lineStyle(2, color, 0.42);
    this.drawDashedLine(graphics, start, target, 5, 4);

    const angle = Math.atan2(target.y - start.y, target.x - start.x);
    const arrowSize = 5;
    graphics.lineBetween(
      target.x,
      target.y,
      target.x - Math.cos(angle - Math.PI / 6) * arrowSize,
      target.y - Math.sin(angle - Math.PI / 6) * arrowSize,
    );
    graphics.lineBetween(
      target.x,
      target.y,
      target.x - Math.cos(angle + Math.PI / 6) * arrowSize,
      target.y - Math.sin(angle + Math.PI / 6) * arrowSize,
    );
    this.worldLayer.add(graphics);
  }

  private drawSelectedIntentTarget(): void {
    const resident = this.simulation.getSelectedResident();
    if (!resident?.target) return;

    const target = this.cellCenter(resident.target);
    const current = this.cellCenter(resident.position);
    if (target.x === current.x && target.y === current.y) return;

    const color = GOAL_COLORS[resident.goal];
    const marker = this.add.graphics();
    marker.fillStyle(color, 0.13);
    marker.fillCircle(target.x, target.y, 8);
    marker.lineStyle(2, color, 0.82);
    marker.strokeCircle(target.x, target.y, 6);
    marker.lineBetween(target.x - 3, target.y, target.x + 3, target.y);
    marker.lineBetween(target.x, target.y - 3, target.x, target.y + 3);
    this.worldLayer.add(marker);

    const targetLabel = this.targetLabel(resident.target);
    const label = this.add.text(target.x, target.y - 8, `${GOAL_LABELS[resident.goal]} → ${targetLabel}`, {
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
      fontFamily: "system-ui, sans-serif",
      fontSize: "8px",
      fontStyle: "bold",
      backgroundColor: "#08151be6",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1);
    const boardBottom = OFFSET_Y + 24 * TILE_SIZE;
    const minX = OFFSET_X + label.width / 2 + 2;
    const maxX = OFFSET_X + 32 * TILE_SIZE - label.width / 2 - 2;
    let labelY = target.y - 8;
    if (labelY - label.height < OFFSET_Y + 2) labelY = target.y + TILE_SIZE / 2 + label.height + 3;
    if (labelY > boardBottom) labelY = target.y - 8;
    label.setPosition(this.clamp(target.x, minX, maxX), labelY);
    this.worldLayer.add(label);
  }

  private drawExpeditions(): void {
    for (const expedition of this.simulation.state.expeditions) {
      if (expedition.status !== "active") continue;
      const target = this.cellCenter(expedition.target);
      const marker = this.add.graphics();
      marker.fillStyle(0xc8a9ff, 0.15);
      marker.fillCircle(target.x, target.y, 10);
      marker.lineStyle(2, 0xc8a9ff, 0.85);
      marker.strokeCircle(target.x, target.y, 7);
      marker.lineBetween(target.x - 4, target.y, target.x + 4, target.y);
      marker.lineBetween(target.x, target.y - 4, target.x, target.y + 4);
      this.worldLayer.add(marker);
      const label = this.add.text(target.x, target.y + 10, `SCOUT ${expedition.progress}/${expedition.duration}`, {
        color: "#c8a9ff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "8px",
        fontStyle: "bold",
        backgroundColor: "#08151be6",
        padding: { x: 3, y: 2 },
      }).setOrigin(0.5, 0);
      this.worldLayer.add(label);
    }
  }

  private drawFogOfWar(): void {
    const graphics = this.add.graphics();
    for (let y = 0; y < this.simulation.state.revealed.length; y += 1) {
      for (let x = 0; x < this.simulation.state.revealed[y]!.length; x += 1) {
        if (this.simulation.state.revealed[y]![x]) continue;
        const px = OFFSET_X + x * TILE_SIZE;
        const py = OFFSET_Y + y * TILE_SIZE;
        graphics.fillStyle(0x07181c, 0.9);
        graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        graphics.lineStyle(1, 0x63e6d4, 0.12);
        graphics.lineBetween(px + 3, py + 4, px + TILE_SIZE - 4, py + TILE_SIZE - 3);
      }
    }
    this.worldLayer.add(graphics);
  }

  private drawBuildPreview(): void {
    const buildMode = this.simulation.state.buildMode;
    if (!buildMode || !this.hoverCell) return;
    const graphics = this.add.graphics();
    const position = this.hoverCell;
    const px = OFFSET_X + position.x * TILE_SIZE;
    const py = OFFSET_Y + position.y * TILE_SIZE;
    const definition = BUILDING_DEFINITIONS[buildMode];
    const preview = this.getBuildPreview(buildMode, position);
    const color = preview.valid
      ? Phaser.Display.Color.HexStringToColor(definition.color).color
      : INVALID_COLOR;
    graphics.fillStyle(color, preview.valid ? 0.22 : 0.14);
    graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    graphics.lineStyle(2, color, 0.9);
    graphics.strokeRect(px + 1, py + 1, TILE_SIZE - 3, TILE_SIZE - 3);
    graphics.lineStyle(2, color, 0.9);
    if (preview.valid) {
      graphics.lineBetween(px + 5, py + 11, px + 9, py + 15);
      graphics.lineBetween(px + 9, py + 15, px + 17, py + 6);
    } else {
      graphics.lineBetween(px + 5, py + 5, px + 17, py + 17);
      graphics.lineBetween(px + 17, py + 5, px + 5, py + 17);
    }
    this.worldLayer.add(graphics);

    const status = preview.valid ? "READY" : `BLOCKED · ${preview.reason}`;
    const label = this.add.text(0, 0, `${definition.shortLabel} · ${status}\nCOST ${this.formatCost(definition)}`, {
      color: preview.valid ? "#f5e6c8" : "#ffd0c6",
      fontFamily: "system-ui, sans-serif",
      fontSize: "8px",
      fontStyle: "bold",
      backgroundColor: preview.valid ? "#12352fee" : "#451d22ee",
      padding: { x: 5, y: 3 },
      stroke: "#08151b",
      strokeThickness: 2,
    }).setOrigin(0.5, 1);
    const boardBottom = OFFSET_Y + 24 * TILE_SIZE;
    const center = this.cellCenter(position);
    const minX = OFFSET_X + label.width / 2 + 2;
    const maxX = OFFSET_X + 32 * TILE_SIZE - label.width / 2 - 2;
    let labelY = position.y < 4 ? py + TILE_SIZE + label.height + 4 : py - 4;
    if (labelY - label.height < OFFSET_Y + 2) labelY = py + TILE_SIZE + label.height + 4;
    if (labelY > boardBottom) labelY = py - 4;
    label.setPosition(this.clamp(center.x, minX, maxX), labelY);
    this.worldLayer.add(label);
  }

  private drawMapLabel(): void {
    const title = this.add.text(OFFSET_X, 23, "M O S S L I G H T   B A S I N", {
      color: "#63e6d4",
      fontFamily: "Georgia, serif",
      fontSize: "13px",
      letterSpacing: 2,
    });
    this.worldLayer.add(title);
    const buildMode = this.simulation.state.buildMode;
    const hoveredTile = this.hoverCell ? this.simulation.state.grid[this.hoverCell.y]?.[this.hoverCell.x] : undefined;
    const collectibleLabel = hoveredTile ? COLLECTIBLE_LABELS[hoveredTile] : undefined;
    const hoveredDistrict = this.hoverCell ? this.simulation.getDistrictAt(this.hoverCell) : undefined;
    const activeExpedition = this.simulation.state.expeditions.find((expedition) => expedition.status === "active");
    const hintText = buildMode
      ? `hover to preview ${BUILDING_DEFINITIONS[buildMode].shortLabel} · click to place`
      : collectibleLabel
        ? `${collectibleLabel} · click to gather · nodes reveal the Commons`
        : activeExpedition
          ? `${activeExpedition.title} · scout ${activeExpedition.progress}/${activeExpedition.duration}`
          : hoveredDistrict
            ? `${DISTRICT_DEFINITIONS[hoveredDistrict.type].label} · ${DISTRICT_DEFINITIONS[hoveredDistrict.type].bonus}`
            : "hover a feature to gather · click a resident to follow intent";
    const hint = this.add.text(OFFSET_X + 1, 41, hintText, {
      color: "#9eb9ad",
      fontFamily: "system-ui, sans-serif",
      fontSize: "10px",
    });
    this.worldLayer.add(hint);
  }

  private pointerToCell(pointer: Phaser.Input.Pointer): Vec2 | null {
    const x = Math.floor((pointer.x - OFFSET_X) / TILE_SIZE);
    const y = Math.floor((pointer.y - OFFSET_Y) / TILE_SIZE);
    if (x < 0 || y < 0 || x >= 32 || y >= 24) return null;
    return { x, y };
  }

  private cellCenter(position: Vec2): Vec2 {
    return {
      x: OFFSET_X + position.x * TILE_SIZE + TILE_SIZE / 2,
      y: OFFSET_Y + position.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  private getBuildPreview(type: Exclude<BuildingType, "root-heart">, position: Vec2): BuildPreviewState {
    const state = this.simulation.state;
    const tile = state.grid[position.y]?.[position.x];
    if (!tile) return { valid: false, reason: "OUT OF BOUNDS" };
    if (state.buildings.some((building) => building.position.x === position.x && building.position.y === position.y)) {
      return { valid: false, reason: "OCCUPIED" };
    }
    if (!state.revealed[position.y]?.[position.x]) return { valid: false, reason: "UNMAPPED" };
    if (tile === "water") return { valid: false, reason: "WATER" };
    if (tile === "stone") return { valid: false, reason: "STONE" };
    if (COLLECTIBLE_LABELS[tile]) return { valid: false, reason: "GATHER FIRST" };
    if (type === "reed-farm" && tile !== "wetland" && tile !== "grass") {
      return { valid: false, reason: "SOFT GROUND" };
    }
    if (type === "root-workshop" && tile !== "grass" && tile !== "path") {
      return { valid: false, reason: "CLEAR GROUND" };
    }

    const definition = BUILDING_DEFINITIONS[type];
    const lacking = (Object.entries(definition.cost) as Array<[ResourceKey, number | undefined]>).find(
      ([resource, amount]) => (state.resources[resource] ?? 0) < (amount ?? 0),
    );
    if (lacking) return { valid: false, reason: `NEED ${lacking[0].toUpperCase()}` };
    const lackingItem = (Object.entries(definition.itemCost ?? {}) as Array<[ItemKey, number | undefined]>).find(
      ([item, amount]) => (state.items[item] ?? 0) < (amount ?? 0),
    );
    if (lackingItem) return { valid: false, reason: `NEED ${ITEM_CODES[lackingItem[0]]}` };
    return { valid: true, reason: "READY" };
  }

  private formatCost(definition: {
    cost: Partial<Record<ResourceKey, number>>;
    itemCost?: Partial<Record<ItemKey, number>>;
  }): string {
    const entries = Object.entries(definition.cost) as Array<[ResourceKey, number | undefined]>;
    const itemEntries = Object.entries(definition.itemCost ?? {}) as Array<[ItemKey, number | undefined]>;
    const allEntries = [
      ...entries.map(([resource, amount]) => `${amount ?? 0}${RESOURCE_CODES[resource]}`),
      ...itemEntries.map(([item, amount]) => `${amount ?? 0}${ITEM_CODES[item]}`),
    ];
    return allEntries.length === 0 ? "FREE" : allEntries.join(" · ");
  }

  private targetLabel(position: Vec2): string {
    const building = this.simulation.state.buildings.find(
      (candidate) => candidate.position.x === position.x && candidate.position.y === position.y,
    );
    return building ? BUILDING_DEFINITIONS[building.type].shortLabel : `PLOT ${position.x + 1}:${position.y + 1}`;
  }

  private drawDashedLine(
    graphics: Phaser.GameObjects.Graphics,
    from: Vec2,
    to: Vec2,
    dashLength: number,
    gapLength: number,
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) return;
    const unitX = dx / distance;
    const unitY = dy / distance;
    for (let offset = 0; offset < distance; offset += dashLength + gapLength) {
      const end = Math.min(offset + dashLength, distance);
      graphics.lineBetween(
        from.x + unitX * offset,
        from.y + unitY * offset,
        from.x + unitX * end,
        from.y + unitY * end,
      );
    }
  }

  private updateHeartbeat(): void {
    const root = this.simulation.state.buildings.find((building) => building.type === "root-heart");
    if (!root) {
      this.heartbeatLayer.setVisible(false);
      return;
    }

    const center = this.cellCenter(root.position);
    const phaseColor = PHASE_COLORS[this.simulation.state.phase];
    this.heartbeatLayer.setVisible(true).setPosition(center.x, center.y);
    this.heartbeatGraphic.clear();
    this.heartbeatGraphic.fillStyle(phaseColor, 0.055);
    this.heartbeatGraphic.fillCircle(0, 0, 27);
    this.heartbeatGraphic.lineStyle(1, phaseColor, 0.32);
    this.heartbeatGraphic.strokeCircle(0, 0, 21);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export { TILE_SIZE, OFFSET_X, OFFSET_Y };
