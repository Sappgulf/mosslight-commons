import Phaser from "phaser";


import { BUILDING_DEFINITIONS, DISTRICT_DEFINITIONS, SPECIES_DEFINITIONS } from "../data/definitions";
import { MosslightSimulation, type SimEvent } from "../sim/simulation";
import { WANT_GLYPH } from "../sim/wants";
import { masteryMark } from "../sim/mastery";
import type { BuildingType, BuildTool, ItemKey, ResidentGoal, ResourceKey, Species, TileKind, Vec2 } from "../sim/types";
import { Effects } from "./Effects";
import {
  applyResidentAnimation,
  createResidentAnimations,
  sheetKeyFor,
  type AnimState,
} from "./ResidentAnimator";
import { LightLayer, type LightSource } from "./LightLayer";
import { TerrainPainter } from "./TerrainPainter";
import { WeatherLayer } from "./WeatherLayer";
import { hasTradition } from "../sim/traditions";
import { dismissBoot, setBootProgress } from "../ui/boot";

/**
 * Tiles were 22px, which put a detailed 40px painterly building sprite across
 * two and a half flat cells. At 32px the ground can carry texture of its own
 * and the art sits at a believable scale.
 */
const TILE_SIZE = 32;
const OFFSET_X = 44;
const OFFSET_Y = 52;
const GRID_W = 32;
const GRID_H = 24;
const BOARD_W = GRID_W * TILE_SIZE;
const BOARD_H = GRID_H * TILE_SIZE;
/**
 * The starting surface size only. The game runs in Phaser's RESIZE mode, so the
 * canvas takes whatever the map cell actually gives it and the camera adapts.
 * These used to be the fixed drawing size with Scale.FIT, which letterboxed the
 * board: on a 1280x720 laptop the map cell was 640x320 and the 900x640 canvas
 * shrank to 450x300 inside it, wasting a third of the width and leaving
 * residents about ten pixels tall.
 */
const VIEW_W = 900;
const VIEW_H = 640;

/** World padding kept visible around the board when fitting the camera. */
const FIT_MARGIN = 48;

/**
 * The smallest on-screen tile the game is willing to open at.
 *
 * Fitting all 32x24 tiles into the map cell of a 1280x720 laptop puts a tile at
 * about 14 screen pixels — residents become specks and nothing is clickable
 * without zooming first. The opening view is framed for readability instead,
 * centred on the Root Heart, and the player can zoom out to the whole basin.
 */
const READABLE_TILE_PX = 26;

/**
 * The opening view never shows less of the basin than this, however small the
 * surface. Framing purely by tile size looked right on a desktop but on a phone
 * put the camera so close that not one gatherable node was on screen — the
 * player opened the game with nothing to do and no idea where to look.
 */
const MIN_VISIBLE_TILES_X = 18;
const MIN_VISIBLE_TILES_Y = 13;

/** Continuous zoom range; the camera now pans freely rather than snapping to a fixed centre. */
/*
 * Zoom limits are multiples of "fit the whole board", not absolute scales. They
 * were absolute (0.5-1.8), which meant that on a small window — where fitting
 * the board needs a zoom below 0.5 — the player could not zoom out far enough
 * to see their own settlement.
 */
const MIN_ZOOM_RATIO = 1;
const MAX_ZOOM_RATIO = 3.2;
const ZOOM_STEP = 0.12;

const INK = 0x08151b;
const PAPER = 0xf5e6c8;
const VALID_COLOR = 0x8dbb72;
const INVALID_COLOR = 0xe87968;

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
  "sky-walk": "building-sky-walk",
};

/** Display sizes rescaled for the 32px grid. */
const BUILDING_DISPLAY_SIZES: Partial<Record<BuildingType, { width: number; height: number }>> = {
  "root-heart": { width: 74, height: 77 },
  "burrow-home": { width: 55, height: 54 },
  "reed-farm": { width: 59, height: 58 },
  "lantern-grove": { width: 55, height: 58 },
  "commons-market": { width: 66, height: 60 },
  "root-workshop": { width: 62, height: 59 },
  "sky-walk": { width: 70, height: 72 },
};

/** Buildings that emit light, and how far it reaches. */
const BUILDING_LIGHT: Partial<Record<BuildingType, { radius: number; strength: number; color: number }>> = {
  "lantern-grove": { radius: 132, strength: 1, color: 0xf4b85b },
  "root-heart": { radius: 116, strength: 0.92, color: 0x63e6d4 },
  "commons-market": { radius: 82, strength: 0.72, color: 0xf4b85b },
  "burrow-home": { radius: 58, strength: 0.58, color: 0xffb46b },
  "root-workshop": { radius: 66, strength: 0.6, color: 0xc8a9ff },
  "reed-farm": { radius: 44, strength: 0.4, color: 0x8dbb72 },
  "sky-walk": { radius: 96, strength: 0.82, color: 0xc8a9ff },
};

const RESIDENT_TEXTURE_KEYS: Record<Species, string> = {
  brambleback: "resident-brambleback",
  glowtail: "resident-glowtail",
  mireling: "resident-mireling",
  cloudmoth: "resident-cloudmoth",
};

const NODE_TEXTURE_KEYS: Partial<Record<TileKind, string>> = {
  fern: "node-fern",
  mushroom: "node-mushroom",
  crystal: "node-crystal",
  ruin: "node-ruin",
};

/** Cell equality that tolerates either side being absent. */
const sameCell = (a: Vec2 | null, b: Vec2 | null): boolean =>
  a !== null && b !== null && a.x === b.x && a.y === b.y;

interface BuildPreviewState {
  valid: boolean;
  reason: string;
}

interface ResidentView {
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse;
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite | null;
  label: Phaser.GameObjects.Text;
  wantMark: Phaser.GameObjects.Text;
  masteryText: Phaser.GameObjects.Text;
  lastMastery: string | null;
  lastGoal: ResidentGoal | null;
  lastSelected: boolean | null;
  lastWant: string | null;
  walking: boolean;
  /** Per-resident phase offset so the idle bob is not in lockstep. */
  bobPhase: number;
  /** Which way they were last travelling, so facing survives a pause. */
  facing: number;
  /** Board x last tick, used to derive facing from actual movement. */
  lastX: number;
}

interface BuildingView {
  container: Phaser.GameObjects.Container;
  art: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse;
  baseSize: { width: number; height: number } | null;
  levelPips: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  lastLevel: number;
  lastUpgrading: boolean;
}

interface NodeView {
  sprite: Phaser.GameObjects.Image;
  bobPhase: number;
}

/**
 * Depth bands. Everything inside the entity band is y-sorted at runtime so a
 * resident walking below a building draws in front of it.
 */
const DEPTH = {
  terrain: 1,
  districts: 2,
  rootNetwork: 3,
  water: 2.5,
  hover: 4,
  intent: 5,
  entities: 10,
  effects: 900,
  light: 950,
  labels: 1000,
} as const;

export class WorldScene extends Phaser.Scene {
  private readonly simulation: MosslightSimulation;
  private readonly onStateChange: () => void;
  private readonly onBuildingSelected: (buildingId: string) => void;

  private terrain!: TerrainPainter;
  private waterOverlay!: Phaser.GameObjects.Graphics;
  private waterShimmer!: Phaser.GameObjects.Graphics;
  private light!: LightLayer;
  private weather!: WeatherLayer;
  private effects!: Effects;
  private districtLayer!: Phaser.GameObjects.Container;
  private rootNetwork!: Phaser.GameObjects.Graphics;
  private entityLayer!: Phaser.GameObjects.Container;
  private nodeLayer!: Phaser.GameObjects.Container;
  private intentLayer!: Phaser.GameObjects.Graphics;
  private intentLabel!: Phaser.GameObjects.Text;
  private expeditionLayer!: Phaser.GameObjects.Container;
  private hoverLayer!: Phaser.GameObjects.Graphics;
  private previewLabel!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private readonly residentViews = new Map<string, ResidentView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly nodeViews = new Map<number, NodeView>();

  private hoverCell: Vec2 | null = null;
  private ready = false;
  private unsubscribe: (() => void) | null = null;

  // Camera drag state.
  private dragging = false;
  private dragMoved = false;
  private dragOrigin = { x: 0, y: 0 };
  private cameraOrigin = { x: 0, y: 0 };

  /**
   * Touch placement is two-stage. A mouse player sees a live preview under the
   * cursor before committing, but a touch player has no hover at all — the
   * first they learned of an illegal or wasteful plot was after the build had
   * already happened. On touch the first tap arms a cell and shows the same
   * preview, and only a second tap on that cell commits.
   */
  private armedCell: Vec2 | null = null;
  /** Finger separation at the last pinch sample, or null when not pinching. */
  private pinchDistance: number | null = null;

  /** Fit zoom at the last resize, used to preserve the player's zoom ratio. */
  private lastFitZoom = 0;
  /**
   * Whether the player has taken control of the camera. Until they do, a resize
   * re-frames the opening view rather than preserving whatever ratio the last
   * surface happened to have — the game boots at its configured size and is
   * resized to the real cell immediately afterwards, so preserving the ratio
   * carried a desktop framing onto a phone and left the camera far too close.
   */
  private cameraTouched = false;

  private terrainSignature = "";
  private districtSignature = "";
  private lastHintText = "";
  private ambientTimer = 0;
  /** Resident the camera should keep framed; cleared when the player pans. */
  private followId: string | null = null;
  private reduceMotion = false;
  /** Species that have a generated sheet; the rest stay on the vector fallback. */
  private animatedSpecies = new Set<Species>();

  constructor(
    simulation: MosslightSimulation,
    onStateChange: () => void,
    onBuildingSelected: (buildingId: string) => void,
  ) {
    super({ key: "world" });
    this.simulation = simulation;
    this.onStateChange = onStateChange;
    this.onBuildingSelected = onBuildingSelected;
  }

  preload(): void {
    // Report real load progress to the boot splash rather than leaving the
    // player watching an unexplained dark rectangle.
    this.load.on("progress", (value: number) => setBootProgress(value * 0.9, "Gathering the lanterns…"));
    this.load.on("loaderror", (file: { key?: string }) => {
      // Missing art falls back to vector marks; a failed file must never stall boot.
      console.warn(`Texture missing: ${file.key ?? "unknown"}`);
    });

    for (const [key, fileName] of Object.entries(BUILDING_TEXTURE_KEYS)) {
      if (fileName) this.load.image(fileName, `assets/runtime/buildings/${key}.webp`);
    }
    for (const [species, fileName] of Object.entries(RESIDENT_TEXTURE_KEYS)) {
      this.load.image(fileName, `assets/runtime/residents/${species}.webp`);
    }
    this.load.image("building-lantern-grove-night", "assets/runtime/buildings/lantern-grove-night.webp");
    this.load.image("tile-path", "assets/runtime/tiles/path.webp");
    for (const [kind, fileName] of Object.entries(NODE_TEXTURE_KEYS)) {
      if (fileName) this.load.image(fileName, `assets/runtime/nodes/${kind}.webp`);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(INK);
    this.lastFitZoom = this.fitZoom();
    this.cameras.main.setZoom(this.readableZoom());
    this.clampCameraBounds();
    const home = this.cellCenter(this.homeFocus());
    this.cameras.main.centerOn(home.x, home.y);
    this.scale.on("resize", this.handleResize, this);

    const frame = this.add.graphics().setDepth(0);
    frame.fillStyle(0x0b2124, 1);
    frame.fillRoundedRect(OFFSET_X - 14, OFFSET_Y - 14, BOARD_W + 28, BOARD_H + 28, 20);
    frame.lineStyle(2, 0x2d8c84, 0.5);
    frame.strokeRoundedRect(OFFSET_X - 14, OFFSET_Y - 14, BOARD_W + 28, BOARD_H + 28, 20);

    this.terrain = new TerrainPainter(this, {
      tileSize: TILE_SIZE,
      offsetX: OFFSET_X,
      offsetY: OFFSET_Y,
      width: GRID_W,
      height: GRID_H,
    }).setDepth(DEPTH.terrain);

    this.waterOverlay = this.add.graphics().setDepth(DEPTH.water);
    this.waterShimmer = this.add.graphics().setDepth(DEPTH.water + 0.2);
    this.districtLayer = this.add.container(0, 0).setDepth(DEPTH.districts);
    this.rootNetwork = this.add.graphics().setDepth(DEPTH.rootNetwork);
    this.hoverLayer = this.add.graphics().setDepth(DEPTH.hover);
    this.intentLayer = this.add.graphics().setDepth(DEPTH.intent);
    this.nodeLayer = this.add.container(0, 0).setDepth(DEPTH.entities);
    this.entityLayer = this.add.container(0, 0).setDepth(DEPTH.entities);
    this.expeditionLayer = this.add.container(0, 0).setDepth(DEPTH.entities + 5);

    this.effects = new Effects(this, DEPTH.effects);
    this.weather = new WeatherLayer(
      this,
      { x: OFFSET_X, y: OFFSET_Y, width: BOARD_W, height: BOARD_H },
      DEPTH.effects - 2,
    );
    this.light = new LightLayer(this, {
      x: OFFSET_X,
      y: OFFSET_Y,
      width: BOARD_W,
      height: BOARD_H,
    }).setDepth(DEPTH.light);

    this.intentLabel = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "10px",
      fontStyle: "bold",
      backgroundColor: "#08151be6",
      padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.labels).setVisible(false);

    this.previewLabel = this.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "10px",
      fontStyle: "bold",
      padding: { x: 6, y: 4 },
      stroke: "#08151b",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(DEPTH.labels).setVisible(false);

    this.titleText = this.add.text(OFFSET_X, OFFSET_Y - 44, "M O S S L I G H T   B A S I N", {
      color: "#63e6d4",
      fontFamily: "Georgia, serif",
      fontSize: "15px",
    }).setDepth(DEPTH.labels).setScrollFactor(0);
    this.hintText = this.add.text(OFFSET_X + 1, OFFSET_Y - 24, "", {
      color: "#9eb9ad",
      fontFamily: "system-ui, sans-serif",
      fontSize: "11px",
    }).setDepth(DEPTH.labels).setScrollFactor(0);

    // Sheets are generated from the loaded base textures, so this must run
    // after preload and before the first resident is drawn.
    this.animatedSpecies = createResidentAnimations(this, RESIDENT_TEXTURE_KEYS);

    this.reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.bindInput();
    this.unsubscribe = this.simulation.onEvent((event) => this.handleSimEvent(event));

    this.ready = true;
    this.renderNow();
    // The world is on screen; the splash has nothing left to cover.
    dismissBoot();
  }

  shutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.scale.off("resize", this.handleResize, this);
  }

  // --- Input --------------------------------------------------------------

  private bindInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.uiBlocksWorld()) return;
      this.dragging = true;
      this.dragMoved = false;
      this.dragOrigin = { x: pointer.x, y: pointer.y };
      this.cameraOrigin = { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY };
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging && pointer.isDown) {
        const dx = pointer.x - this.dragOrigin.x;
        const dy = pointer.y - this.dragOrigin.y;
        // Only treat it as a pan once the pointer clears a small dead zone, so
        // a click with a shaky hand still registers as a click.
        if (Math.hypot(dx, dy) > 5) {
          this.dragMoved = true;
          this.cameraTouched = true;
          this.followId = null;
          const zoom = this.cameras.main.zoom;
          this.cameras.main.setScroll(
            this.cameraOrigin.x - dx / zoom,
            this.cameraOrigin.y - dy / zoom,
          );
        }
      }

      const nextCell = this.pointerToCell(pointer);
      const changed = nextCell?.x !== this.hoverCell?.x || nextCell?.y !== this.hoverCell?.y;
      if (!changed) return;
      this.hoverCell = nextCell;
      this.drawHoverLayer();
      this.drawHeader();
      this.updateBuildingLabels();
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const wasDrag = this.dragMoved;
      this.dragging = false;
      this.dragMoved = false;
      if (this.uiBlocksWorld() || wasDrag) return;

      const cell = this.pointerToCell(pointer);
      if (!cell) return;
      this.hoverCell = cell;

      const buildMode = this.simulation.state.buildMode;

      // Touch has no hover, so arm the cell and show the preview first.
      if (buildMode && pointer.wasTouch && !sameCell(this.armedCell, cell)) {
        this.armedCell = cell;
        this.drawHoverLayer();
        this.drawHeader();
        this.onStateChange();
        return;
      }
      this.armedCell = null;

      if (buildMode === "path") {
        if (this.simulation.paintPath(cell)) this.simulation.noteTutorial("build");
      } else if (buildMode) {
        if (this.simulation.build(buildMode, cell)) this.simulation.noteTutorial("build");
      } else if (this.simulation.collectAt(cell)) {
        this.simulation.noteTutorial("gather");
      } else {
        const building = this.simulation.getBuildingAt(cell);
        if (building) this.onBuildingSelected(building.id);
        else {
          this.simulation.selectAt(cell);
          this.simulation.noteTutorial("select");
        }
      }
      this.renderNow();
      this.onStateChange();
    });

    this.input.on("pointerout", () => {
      this.dragging = false;
      // An armed touch placement must survive the finger leaving the surface,
      // or the preview would vanish before it could be confirmed.
      if (this.armedCell) return;
      if (!this.hoverCell) return;
      this.hoverCell = null;
      this.drawHoverLayer();
      this.drawHeader();
      this.updateBuildingLabels();
    });

    // Pinch to zoom. Touch previously had no way to zoom at all: the wheel
    // handler needs a wheel and the keyboard shortcuts need a keyboard, which
    // left the HUD buttons as the only route on a phone.
    this.input.addPointer(1);
    this.input.on("pointermove", () => {
      const [first, second] = [this.input.pointer1, this.input.pointer2];
      if (!first.isDown || !second.isDown) {
        this.pinchDistance = null;
        return;
      }
      // Two fingers down is a pinch, never a camera drag.
      this.dragging = false;
      this.dragMoved = true;

      this.cameraTouched = true;
      const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
      if (this.pinchDistance === null) {
        this.pinchDistance = distance;
        return;
      }
      const camera = this.cameras.main;
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const before = camera.getWorldPoint(midX, midY);
      camera.setZoom(this.clampZoom(camera.zoom * (distance / this.pinchDistance)));
      const after = camera.getWorldPoint(midX, midY);
      camera.setScroll(camera.scrollX + (before.x - after.x), camera.scrollY + (before.y - after.y));
      this.pinchDistance = distance;
    });

    this.input.on("pointerup", () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.pinchDistance = null;
    });

    // Wheel zooms toward the cursor rather than the board centre.
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
        this.zoomToward(pointer, dy > 0 ? -ZOOM_STEP : ZOOM_STEP);
      },
    );
  }

  private zoomToward(pointer: Phaser.Input.Pointer, delta: number): void {
    this.cameraTouched = true;
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(pointer.x, pointer.y);
    camera.setZoom(this.clampZoom(camera.zoom + delta * this.fitZoom()));
    const after = camera.getWorldPoint(pointer.x, pointer.y);
    // Re-anchor so the world point under the cursor stays under the cursor.
    camera.setScroll(
      camera.scrollX + (before.x - after.x),
      camera.scrollY + (before.y - after.y),
    );
  }

  /** The camera's current pixel size, which changes whenever the window does. */
  private viewSize(): { width: number; height: number } {
    const size = this.scale?.gameSize;
    return {
      width: Math.max(1, size?.width ?? VIEW_W),
      height: Math.max(1, size?.height ?? VIEW_H),
    };
  }

  /** Constrains a zoom to the range around "whole board visible". */
  private clampZoom(value: number): number {
    const fit = this.fitZoom();
    return Phaser.Math.Clamp(value, fit * MIN_ZOOM_RATIO, fit * MAX_ZOOM_RATIO);
  }

  /** Zoom at which the whole board is visible in the current surface. */
  private fitZoom(): number {
    const { width, height } = this.viewSize();
    return Math.min(width / (BOARD_W + FIT_MARGIN), height / (BOARD_H + FIT_MARGIN));
  }

  /**
   * The zoom the game opens at: close enough to read a creature, but never
   * closer than fitting the board, so a large window still shows everything.
   */
  private readableZoom(): number {
    const { width, height } = this.viewSize();
    const fieldOfView = Math.min(
      width / (MIN_VISIBLE_TILES_X * TILE_SIZE),
      height / (MIN_VISIBLE_TILES_Y * TILE_SIZE),
    );
    const readable = Math.min(READABLE_TILE_PX / TILE_SIZE, fieldOfView);
    // Never closer than readable, never further out than fitting the board.
    return this.clampZoom(Math.max(this.fitZoom(), readable));
  }

  /** Where the settlement is, so the opening view looks at something. */
  private homeFocus(): Vec2 {
    const heart = this.simulation.state.buildings.find((building) => building.type === "root-heart");
    return heart?.position ?? { x: GRID_W / 2, y: GRID_H / 2 };
  }

  /**
   * Re-fits the camera when the surface changes size. The zoom the player chose
   * is kept as a ratio of "fit", so a resized window shows the same amount of
   * world rather than snapping back to a default.
   */
  private handleResize(): void {
    if (!this.ready) return;
    const { width, height } = this.viewSize();
    const camera = this.cameras.main;
    const previousFit = this.lastFitZoom || this.fitZoom();
    const ratio = camera.zoom / previousFit;

    camera.setSize(width, height);
    this.lastFitZoom = this.fitZoom();

    if (this.cameraTouched) {
      camera.setZoom(this.clampZoom(this.lastFitZoom * ratio));
      this.clampCameraBounds();
      return;
    }

    camera.setZoom(this.readableZoom());
    this.clampCameraBounds();
    const home = this.cellCenter(this.homeFocus());
    camera.centerOn(home.x, home.y);
  }

  /**
   * Keeps the board reachable at any zoom. The bounds used to be a fixed box
   * slightly larger than the board, which at low zoom left the board pinned in
   * a corner of a much larger viewport.
   */
  private clampCameraBounds(): void {
    const camera = this.cameras.main;
    const viewW = camera.width / camera.zoom;
    const viewH = camera.height / camera.zoom;
    const slackX = Math.max(0, (viewW - BOARD_W) / 2) + FIT_MARGIN;
    const slackY = Math.max(0, (viewH - BOARD_H) / 2) + FIT_MARGIN;
    camera.setBounds(
      OFFSET_X - slackX,
      OFFSET_Y - slackY,
      BOARD_W + slackX * 2,
      BOARD_H + slackY * 2,
    );
  }

  private uiBlocksWorld(): boolean {
    return !this.simulation.state.titleSeen || this.simulation.state.status === "collapsed";
  }

  public focusResident(id: string): void {
    const resident = this.simulation.state.residents.find((candidate) => candidate.id === id);
    if (!resident) return;
    this.followId = id;
    const center = this.cellCenter(resident.position);
    this.cameras.main.pan(center.x, center.y, 280, "Sine.easeInOut");
    this.renderNow();
  }

  private drawWaterOverlay(): void {
    this.waterOverlay.clear();
    const quality = this.simulation.state.waterQuality;
    if (!quality) return;
    const night = this.simulation.state.phase === "night" || this.simulation.state.phase === "dusk";
    for (let y = 0; y < GRID_H; y += 1) {
      for (let x = 0; x < GRID_W; x += 1) {
        const tile = this.simulation.state.grid[y]?.[x];
        const value = quality[y]?.[x] ?? 70;
        if (tile !== "water" && tile !== "wetland") continue;
        if (value > 72 && !night) continue;
        const stain = Math.max(0, (72 - value) / 72);
        const alpha = (night ? 0.08 : 0) + stain * 0.28;
        if (alpha < 0.04) continue;
        this.waterOverlay.fillStyle(value < 40 ? 0x6b3a2a : 0x1b4a58, alpha);
        this.waterOverlay.fillRect(OFFSET_X + x * TILE_SIZE, OFFSET_Y + y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    if (this.simulation.state.longShadeCrisis) {
      this.waterOverlay.fillStyle(0x061031, 0.1);
      this.waterOverlay.fillRect(OFFSET_X, OFFSET_Y, BOARD_W, BOARD_H);
    }
  }

  // --- Sim events ---------------------------------------------------------

  private handleSimEvent(event: SimEvent): void {
    if (!this.ready) return;
    const position = event.position ? this.cellCenter(event.position) : null;

    switch (event.type) {
      case "gather":
        if (!position) return;
        this.effects.burst(position.x, position.y, "gather", 12);
        if (event.label) this.effects.floatText(position.x, position.y - 8, event.label, "#c5dd8c");
        if (!this.reduceMotion) this.cameras.main.shake(70, 0.0016);
        break;
      case "build":
        if (!position) return;
        this.effects.dust(position.x, position.y);
        this.effects.ring(position.x, position.y, 0x63e6d4, 46);
        if (!this.reduceMotion) this.cameras.main.shake(140, 0.0034);
        break;
      case "upgrade":
        if (!position) return;
        this.effects.burst(position.x, position.y, "upgrade", 16);
        this.effects.ring(position.x, position.y, 0xf4b85b, 54);
        if (event.label) this.effects.floatText(position.x, position.y - 14, event.label, "#f4b85b");
        if (!this.reduceMotion) this.cameras.main.flash(180, 244, 184, 91, false);
        break;
      case "objective":
        if (!this.reduceMotion) this.cameras.main.flash(220, 99, 230, 212, false);
        break;
      case "craft":
        if (!position) return;
        this.effects.burst(position.x, position.y, "upgrade", 10);
        break;
      case "regrowth":
        if (!position) return;
        this.effects.burst(position.x, position.y, "gather", 8);
        break;
      case "arrival":
        if (!position) return;
        this.effects.ring(position.x, position.y, 0x8dbb72, 30);
        break;
      case "want":
        if (!position) return;
        this.effects.burst(position.x, position.y, "upgrade", 10);
        this.effects.floatText(position.x, position.y - 12, "♥", "#ffb9c8");
        break;
      case "departure":
        if (!position) return;
        this.effects.burst(position.x, position.y, "warn", 8);
        break;
      default:
        break;
    }
  }

  // --- Frame --------------------------------------------------------------

  public renderNow(): void {
    if (!this.ready) return;
    // Leaving build mode (Escape, or toggling the button off) must also drop an
    // armed touch placement, or a stale preview would sit on the board.
    if (!this.simulation.state.buildMode) this.armedCell = null;
    this.input.setDefaultCursor(this.simulation.state.buildMode ? "crosshair" : "grab");
    this.repaintTerrainIfChanged();
    this.drawWaterOverlay();
    this.drawDistrictsIfChanged();
    this.drawRootNetwork();
    this.syncBuildings();
    this.syncResidents();
    this.syncNodes();
    this.syncExpeditions();
    this.drawIntent();
    this.drawHoverLayer();
    this.drawHeader();
  }

  /**
   * Per-frame work: idle animation, light, and ambient motes. Deliberately
   * separate from `renderNow`, which is driven by simulation ticks.
   */
  update(_time: number, delta: number): void {
    if (!this.ready) return;

    const t = this.time.now / 1000;

    /*
     * Residents are driven by real animations now. The body container still
     * carries the gentle vertical bob — it moves the creature without lifting
     * its shadow — but the creature's own motion is frame-based rather than a
     * squash applied to one static image.
     */
    for (const view of this.residentViews.values()) {
      view.body.y = view.walking ? -6.2 : Math.sin(t * 2.4 + view.bobPhase) * 1.6 - 5;
    }
    for (const view of this.nodeViews.values()) {
      view.sprite.rotation = Math.sin(t * 1.1 + view.bobPhase) * 0.045;
      view.sprite.y = view.sprite.getData("baseY") + Math.sin(t * 1.8 + view.bobPhase) * 1.8;
    }

    this.drawWaterShimmer(t);
    if (!this.reduceMotion) this.weather.update(this.simulation.state, delta);
    this.light.update(this.simulation.state.phase, this.collectLightSources());
    this.followSelected(delta);

    // A slow drift of spores, denser at night.
    this.ambientTimer += delta;
    const interval = this.simulation.state.phase === "night" ? 260 : 620;
    if (this.ambientTimer > interval) {
      this.ambientTimer = 0;
      this.effects.spawnAmbientMote({ x: OFFSET_X, y: OFFSET_Y, width: BOARD_W, height: BOARD_H });
    }
  }

  private collectLightSources(): LightSource[] {
    const sources: LightSource[] = [];
    const flicker = 0.94 + Math.sin(this.time.now / 260) * 0.06;

    for (const building of this.simulation.state.buildings) {
      const config = BUILDING_LIGHT[building.type];
      if (!config) continue;
      const center = this.cellCenter(building.position);
      sources.push({
        x: center.x,
        y: center.y,
        // Upgraded buildings light a wider area, so levels read on the map.
        radius: config.radius * (1 + (building.level - 1) * 0.18) * (hasTradition(this.simulation.state, "sky-veil") ? 1.18 : 1),
        strength: config.strength * flicker,
        color: config.color,
      });
    }

    // Glowtails and Cloudmoths carry their own light.
    for (const resident of this.simulation.state.residents) {
      const center = this.cellCenter(resident.position);
      if (resident.species === "glowtail") {
        sources.push({ x: center.x, y: center.y, radius: 34, strength: 0.42, color: 0x63e6d4 });
      } else if (resident.species === "cloudmoth") {
        sources.push({ x: center.x, y: center.y, radius: 42, strength: 0.5, color: 0xc8a9ff });
      }
    }
    return sources;
  }

  private followSelected(delta: number): void {
    if (!this.followId || this.reduceMotion) return;
    const resident = this.simulation.state.residents.find((candidate) => candidate.id === this.followId);
    if (!resident) {
      this.followId = null;
      return;
    }
    const target = this.cellCenter(resident.position);
    const camera = this.cameras.main;
    const mid = camera.midPoint;
    const blend = Math.min(1, delta / 220);
    camera.centerOn(
      mid.x + (target.x - mid.x) * blend,
      mid.y + (target.y - mid.y) * blend,
    );
  }

  private drawWaterShimmer(time: number): void {
    this.waterShimmer.clear();
    const phase = this.simulation.state.phase;
    if (phase === "night") return;
    const grid = this.simulation.state.grid;
    const alpha = phase === "day" ? 0.16 : 0.1;
    this.waterShimmer.lineStyle(1.2, 0xc8fff5, alpha);
    for (let y = 0; y < GRID_H; y += 2) {
      for (let x = 0; x < GRID_W; x += 2) {
        const tile = grid[y]?.[x];
        if (tile !== "water" && tile !== "wetland") continue;
        const originX = OFFSET_X + x * TILE_SIZE;
        const originY = OFFSET_Y + y * TILE_SIZE + ((Math.sin(time * 1.4 + x * 0.7 + y) + 1) * 6);
        this.waterShimmer.beginPath();
        this.waterShimmer.moveTo(originX + 4, originY);
        this.waterShimmer.lineTo(originX + TILE_SIZE * 1.4, originY + 1.5);
        this.waterShimmer.strokePath();
      }
    }
  }

  // --- Camera controls ----------------------------------------------------

  public zoomIn(): number {
    if (!this.hasCamera()) return 100;
    this.cameraTouched = true;
    this.cameras.main.setZoom(this.clampZoom(this.cameras.main.zoom + ZOOM_STEP * this.fitZoom()));
    return this.getZoomPercent();
  }

  public zoomOut(): number {
    if (!this.hasCamera()) return 100;
    this.cameraTouched = true;
    this.cameras.main.setZoom(this.clampZoom(this.cameras.main.zoom - ZOOM_STEP * this.fitZoom()));
    return this.getZoomPercent();
  }

  public resetZoom(): number {
    if (!this.hasCamera()) return 100;
    this.cameraTouched = false;
    this.lastFitZoom = this.fitZoom();
    this.cameras.main.setZoom(this.readableZoom());
    this.clampCameraBounds();
    const home = this.cellCenter(this.homeFocus());
    this.cameras.main.centerOn(home.x, home.y);
    return this.getZoomPercent();
  }

  /**
   * Phaser sets up a scene's camera manager during scene boot, which happens
   * after `new Phaser.Game(...)` returns. `main.ts` renders the HUD once during
   * start-up, and the HUD reads the zoom level — so on a cold load this ran
   * before there was any camera and threw on `cameras.main`. Because that
   * happened at module scope it aborted the rest of `main.ts`, taking the
   * simulation clock, the key bindings, and the debug hooks down with it.
   */
  private hasCamera(): boolean {
    return this.cameras?.main !== undefined;
  }

  public getZoomPercent(): number {
    if (!this.hasCamera()) return 100;
    return Math.round((this.cameras.main.zoom / this.fitZoom()) * 100);
  }

  /**
   * Maps a grid cell to a point on the page, or null when it is off-screen.
   *
   * Exposed for the end-to-end suite: without it a test could drive the HUD but
   * never the board, which meant the actual game loop — walk up to a wild node,
   * gather it, spend what it gave you — had no coverage at all.
   */
  public screenPointForCell(cell: Vec2): { x: number; y: number } | null {
    if (!this.hasCamera()) return null;
    const camera = this.cameras.main;
    const world = this.cellCenter(cell);

    /*
     * Invert the camera using its own `getWorldPoint` rather than rebuilding
     * the transform by hand. A zoomed Phaser camera scales about its midpoint,
     * not its origin, so the obvious `(world - scroll) * zoom` is wrong and
     * lands several tiles away. Sampling two corners gives the exact affine map
     * whatever convention Phaser uses internally.
     */
    const topLeft = camera.getWorldPoint(0, 0);
    const bottomRight = camera.getWorldPoint(camera.width, camera.height);
    const spanX = bottomRight.x - topLeft.x;
    const spanY = bottomRight.y - topLeft.y;
    if (spanX === 0 || spanY === 0) return null;

    const x = ((world.x - topLeft.x) / spanX) * camera.width;
    const y = ((world.y - topLeft.y) / spanY) * camera.height;
    if (x < 0 || y < 0 || x > camera.width || y > camera.height) return null;

    const canvas = this.game.canvas.getBoundingClientRect();
    // The backing store and the CSS box can differ; scale between them.
    return {
      x: canvas.left + (x / camera.width) * canvas.width,
      y: canvas.top + (y / camera.height) * canvas.height,
    };
  }

  /** Camera diagnostics for the QA hooks. */
  public cameraReport(): Record<string, number | boolean> {
    const size = this.scale?.gameSize;
    const camera = this.cameras?.main;
    return {
      ready: this.ready,
      touched: this.cameraTouched,
      gameW: size?.width ?? -1,
      gameH: size?.height ?? -1,
      camW: camera?.width ?? -1,
      camH: camera?.height ?? -1,
      zoom: camera?.zoom ?? -1,
      fit: this.fitZoom(),
      readable: this.readableZoom(),
    };
  }

  /** Smoothly centres the camera on a grid cell — used to follow a resident. */
  public focusOn(position: Vec2): void {
    if (!this.hasCamera()) return;
    const center = this.cellCenter(position);
    this.cameras.main.pan(center.x, center.y, 420, "Sine.easeInOut");
  }

  // --- Terrain ------------------------------------------------------------

  private terrainKey(): string {
    const { grid, revealedAreas, regrowth } = this.simulation.state;
    let nodeHash = 0;
    for (let y = 0; y < grid.length; y += 1) {
      const row = grid[y]!;
      for (let x = 0; x < row.length; x += 1) {
        const kind = row[x]!;
        if (NODE_TEXTURE_KEYS[kind]) nodeHash = (nodeHash * 31 + (y * GRID_W + x)) | 0;
      }
    }
    return `${nodeHash}:${revealedAreas.join(",")}:${regrowth.length}`;
  }

  private repaintTerrainIfChanged(): void {
    const key = this.terrainKey();
    if (key === this.terrainSignature) return;
    this.terrainSignature = key;
    this.terrain.repaint(this.simulation.state.grid, this.simulation.state.revealed);
  }

  private syncNodes(): void {
    const { grid, revealed } = this.simulation.state;
    const seen = new Set<number>();

    for (let y = 0; y < grid.length; y += 1) {
      for (let x = 0; x < grid[y]!.length; x += 1) {
        const kind = grid[y]![x]!;
        const textureKey = NODE_TEXTURE_KEYS[kind];
        if (!textureKey || !revealed[y]?.[x] || !this.textures.exists(textureKey)) continue;

        const cell = y * GRID_W + x;
        seen.add(cell);
        if (this.nodeViews.has(cell)) continue;

        const center = this.cellCenter({ x, y });
        const sprite = this.add.image(center.x, center.y - 3, textureKey).setDisplaySize(40, 41);
        sprite.setData("baseY", center.y - 3);
        this.nodeLayer.add(sprite);
        // Newly grown nodes pop in rather than appearing between frames.
        sprite.setScale(sprite.scaleX * 0.3, sprite.scaleY * 0.3);
        this.tweens.add({
          targets: sprite,
          scaleX: sprite.scaleX / 0.3,
          scaleY: sprite.scaleY / 0.3,
          duration: 420,
          ease: "Back.easeOut",
        });
        this.nodeViews.set(cell, { sprite, bobPhase: Math.random() * Math.PI * 2 });
      }
    }

    for (const [cell, view] of this.nodeViews) {
      if (seen.has(cell)) continue;
      view.sprite.destroy();
      this.nodeViews.delete(cell);
    }
  }

  /** Districts as soft tinted regions rather than debug rectangles. */
  private drawDistrictsIfChanged(): void {
    const key = this.simulation.state.districtFocus;
    if (key === this.districtSignature) return;
    this.districtSignature = key;

    this.districtLayer.removeAll(true);
    const activeFocus = this.simulation.state.districtFocus;
    const graphics = this.add.graphics();

    for (const district of this.simulation.state.districts) {
      const definition = DISTRICT_DEFINITIONS[district.type];
      const color = Phaser.Display.Color.HexStringToColor(definition.color).color;
      const x = OFFSET_X + district.bounds.xMin * TILE_SIZE;
      const y = OFFSET_Y + district.bounds.yMin * TILE_SIZE;
      const width = (district.bounds.xMax - district.bounds.xMin + 1) * TILE_SIZE;
      const height = (district.bounds.yMax - district.bounds.yMin + 1) * TILE_SIZE;
      const active = district.type === activeFocus;

      // Only the focused district tints the ground. Five overlapping washes —
      // several of them light golds and greens — lifted the whole board off its
      // palette and flattened the contrast the art depends on.
      if (active) {
        graphics.fillStyle(color, 0.05);
        graphics.fillRoundedRect(x + 6, y + 6, width - 12, height - 12, 26);
      }
      graphics.lineStyle(active ? 2 : 1, color, active ? 0.3 : 0.07);
      graphics.strokeRoundedRect(x + 6, y + 6, width - 12, height - 12, 26);

      if (active) {
        this.districtLayer.add(
          this.add.text(
            OFFSET_X + district.center.x * TILE_SIZE + TILE_SIZE / 2,
            y + 12,
            definition.label.toUpperCase(),
            {
              color: Phaser.Display.Color.IntegerToColor(color).rgba,
              fontFamily: "Georgia, serif",
              fontSize: "11px",
              backgroundColor: "#08151bb0",
              padding: { x: 6, y: 3 },
            },
          ).setOrigin(0.5, 0),
        );
      }
    }
    this.districtLayer.add(graphics);
  }

  private drawRootNetwork(): void {
    const root = this.simulation.state.buildings.find((building) => building.type === "root-heart");
    if (!root) {
      this.rootNetwork.clear();
      return;
    }
    const key = `${root.position.x}:${root.position.y}:${this.simulation.state.buildings.length}`;
    if (this.rootNetwork.getData("key") === key) return;
    this.rootNetwork.setData("key", key);

    this.rootNetwork.clear();
    const center = this.cellCenter(root.position);
    // Draw a living tendril to each civic building rather than three fixed lines.
    for (const building of this.simulation.state.buildings) {
      if (building.type === "root-heart") continue;
      const target = this.cellCenter(building.position);
      this.rootNetwork.lineStyle(3, 0x63e6d4, 0.13);
      this.rootNetwork.beginPath();
      this.rootNetwork.moveTo(center.x, center.y);
      // A gentle arc keeps the network from looking like a wire diagram.
      const midX = (center.x + target.x) / 2 + (target.y - center.y) * 0.12;
      const midY = (center.y + target.y) / 2 - (target.x - center.x) * 0.12;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const inv = 1 - t;
        this.rootNetwork.lineTo(
          inv * inv * center.x + 2 * inv * t * midX + t * t * target.x,
          inv * inv * center.y + 2 * inv * t * midY + t * t * target.y,
        );
      }
      this.rootNetwork.strokePath();
    }
  }

  // --- Buildings ----------------------------------------------------------

  private syncBuildings(): void {
    const seen = new Set<string>();

    for (const building of this.simulation.state.buildings) {
      seen.add(building.id);
      let view = this.buildingViews.get(building.id);

      if (!view) {
        const container = this.add.container(0, 0);
        const definition = BUILDING_DEFINITIONS[building.type];
        const textureKey = BUILDING_TEXTURE_KEYS[building.type];
        const displaySize = BUILDING_DISPLAY_SIZES[building.type] ?? { width: 55, height: 55 };

        // A grounded contact shadow is what stops sprites from floating.
        const shadow = this.add.ellipse(0, displaySize.height * 0.32, displaySize.width * 0.78, displaySize.height * 0.22, 0x040d10, 0.42);

        let art: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
        let baseSize: { width: number; height: number } | null = null;
        if (textureKey && this.textures.exists(textureKey)) {
          art = this.add.image(0, -6, textureKey).setDisplaySize(displaySize.width, displaySize.height);
          baseSize = displaySize;
        } else {
          const graphics = this.add.graphics();
          this.drawBuildingVector(graphics, building.type, definition.color);
          art = graphics;
        }

        const levelPips = this.add.graphics();
        const label = this.add.text(0, 20, definition.shortLabel, {
          color: "#f5e6c8",
          fontFamily: "Georgia, serif",
          fontSize: "10px",
          stroke: "#08151b",
          strokeThickness: 3,
        }).setOrigin(0.5).setVisible(false);

        container.add([shadow, art, levelPips, label]);
        this.entityLayer.add(container);
        view = { container, art, shadow, baseSize, levelPips, label, lastLevel: -1, lastUpgrading: false };
        this.buildingViews.set(building.id, view);

        // Placement pop.
        container.setScale(0.6);
        this.tweens.add({ targets: container, scale: 1, duration: 380, ease: "Back.easeOut" });
      }

      const center = this.cellCenter(building.position);
      view.container.setPosition(center.x, center.y);
      // Y-sort within the entity band so residents can pass in front.
      view.container.setDepth(center.y);

      if (building.type === "lantern-grove" && view.art instanceof Phaser.GameObjects.Image) {
        const night = this.simulation.state.phase === "night" || this.simulation.state.phase === "dusk";
        const nightKey = "building-lantern-grove-night";
        const dayKey = BUILDING_TEXTURE_KEYS["lantern-grove"]!;
        const next = night && this.textures.exists(nightKey) ? nightKey : dayKey;
        if (view.art.texture.key !== next && this.textures.exists(next)) {
          view.art.setTexture(next);
          if (view.baseSize) view.art.setDisplaySize(view.baseSize.width, view.baseSize.height);
        }
      }

      if (view.lastLevel !== building.level || view.lastUpgrading !== building.upgrading) {
        view.lastLevel = building.level;
        view.lastUpgrading = building.upgrading;
        view.levelPips.clear();
        if (building.type !== "root-heart") {
          for (let index = 0; index < building.level; index += 1) {
            view.levelPips.fillStyle(0xf4b85b, 0.95);
            view.levelPips.fillCircle(-7 + index * 7, 14, 2.2);
          }
        }
        if (building.upgrading) {
          view.levelPips.lineStyle(2, 0x63e6d4, 0.7);
          view.levelPips.strokeCircle(0, -4, 24);
        }
        const scale = 1 + (building.level - 1) * 0.12;
        if (view.baseSize && view.art instanceof Phaser.GameObjects.Image) {
          view.art.setDisplaySize(view.baseSize.width * scale, view.baseSize.height * scale);
        } else {
          view.art.setScale(scale);
        }
        view.shadow.setScale(scale);
      }
    }

    for (const [id, view] of this.buildingViews) {
      if (seen.has(id)) continue;
      view.container.destroy(true);
      this.buildingViews.delete(id);
    }
  }

  private updateBuildingLabels(): void {
    for (const building of this.simulation.state.buildings) {
      const view = this.buildingViews.get(building.id);
      if (!view) continue;
      const hovered = this.hoverCell?.x === building.position.x && this.hoverCell?.y === building.position.y;
      view.label.setVisible(hovered && building.type !== "root-heart");
      if (hovered) view.label.setText(`${BUILDING_DEFINITIONS[building.type].shortLabel} · L${building.level}`);
    }
  }

  private drawBuildingVector(graphics: Phaser.GameObjects.Graphics, type: BuildingType, colorHex: string): void {
    const color = Phaser.Display.Color.HexStringToColor(colorHex).color;
    if (type === "root-heart") {
      graphics.fillStyle(0x63e6d4, 0.16);
      graphics.fillCircle(0, 0, 24);
      graphics.lineStyle(2, 0x63e6d4, 0.8);
      graphics.strokeCircle(0, 0, 15);
      graphics.fillStyle(0x63e6d4, 0.9);
      graphics.fillCircle(0, 0, 8);
      return;
    }
    if (type === "burrow-home") {
      graphics.fillStyle(0x6e4938, 1);
      graphics.fillRoundedRect(-10, -8, 20, 17, 6);
      graphics.fillStyle(0xc96e4a, 1);
      graphics.fillTriangle(-13, -6, 0, -16, 13, -6);
      graphics.fillStyle(0xf4b85b, 0.9);
      graphics.fillRect(-3, 1, 6, 7);
      return;
    }
    if (type === "reed-farm") {
      graphics.fillStyle(0x6f9f62, 1);
      graphics.fillRoundedRect(-12, -9, 24, 18, 5);
      graphics.fillStyle(0xf4b85b, 0.9);
      graphics.fillCircle(0, -4, 3);
      return;
    }
    if (type === "lantern-grove") {
      graphics.fillStyle(0x234d45, 1);
      graphics.fillCircle(0, 3, 12);
      graphics.fillStyle(0xf4b85b, 0.9);
      graphics.fillCircle(0, -3, 7);
      return;
    }
    if (type === "commons-market") {
      graphics.fillStyle(color, 0.9);
      graphics.fillRoundedRect(-13, -8, 26, 16, 5);
      graphics.fillStyle(0xf4b85b, 0.85);
      graphics.fillTriangle(-15, -8, 0, -18, 15, -8);
      return;
    }
    if (type === "sky-walk") {
      graphics.fillStyle(0x2d8c84, 0.95);
      graphics.fillRoundedRect(-16, -4, 8, 22, 3);
      graphics.fillRoundedRect(8, -4, 8, 22, 3);
      graphics.fillStyle(0xc8a9ff, 0.9);
      graphics.fillTriangle(-18, -4, 0, -20, 18, -4);
      graphics.fillStyle(0xf4b85b, 0.85);
      graphics.fillCircle(-6, 2, 2);
      graphics.fillCircle(6, 2, 2);
      return;
    }
    graphics.fillStyle(0x4b3d62, 0.95);
    graphics.fillRoundedRect(-13, -9, 26, 18, 4);
    graphics.fillStyle(0xc8a9ff, 0.88);
    graphics.fillTriangle(-14, -9, 0, -17, 14, -9);
  }

  // --- Residents ----------------------------------------------------------

  private syncResidents(): void {
    const seen = new Set<string>();
    const selectedId = this.simulation.state.selectedResidentId;

    for (const resident of this.simulation.state.residents) {
      seen.add(resident.id);
      let view = this.residentViews.get(resident.id);

      if (!view) {
        const container = this.add.container(0, 0);
        const shadow = this.add.ellipse(0, 10, 22, 8, 0x040d10, 0.45);
        // The body is a nested container so the idle bob can move the creature
        // without lifting its shadow off the ground with it.
        const body = this.add.container(0, -5);
        const marker = this.add.graphics();

        // An animated sheet when one was generated for this species, and the
        // hand-drawn vector otherwise, exactly as before.
        let sprite: Phaser.GameObjects.Sprite | null = null;
        if (this.animatedSpecies.has(resident.species)) {
          sprite = this.add.sprite(0, 0, sheetKeyFor(resident.species), 0).setDisplaySize(30, 37);
          body.add(sprite);
        } else {
          this.drawResidentVector(marker, resident.species);
        }

        const label = this.add.text(0, -26, "", {
          color: "#f5e6c8",
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          fontStyle: "bold",
          backgroundColor: "#08151bcc",
          padding: { x: 5, y: 3 },
        }).setOrigin(0.5, 1).setVisible(false);
        // A small mark for what this resident has become good at, kept on the
        // opposite side to the want glyph so the two never collide.
        const masteryText = this.add.text(-11, -22, "", {
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          fontStyle: "bold",
          color: "#f4b85b",
          stroke: "#08151b",
          strokeThickness: 3,
        }).setOrigin(0.5, 0.5);

        const wantMark = this.add.text(10, -22, "", {
          color: "#ffd58b",
          fontFamily: "Georgia, serif",
          fontSize: "13px",
          stroke: "#08151b",
          strokeThickness: 3,
        }).setOrigin(0.5, 1).setVisible(false);

        container.add([shadow, marker, body, label, wantMark, masteryText]);
        this.entityLayer.add(container);
        view = {
          container,
          marker,
          shadow,
          body,
          sprite,
          label,
          wantMark,
          masteryText,
          lastMastery: null,
          lastGoal: null,
          lastSelected: null,
          lastWant: null,
          walking: false,
          bobPhase: Math.random() * Math.PI * 2,
          facing: 1,
          lastX: resident.position.x,
        };
        this.residentViews.set(resident.id, view);
      }

      const center = this.cellCenter(resident.position);
      const distance = Phaser.Math.Distance.Between(view.container.x, view.container.y, center.x, center.y);
      if (distance > 0.5 && distance < TILE_SIZE * 2.5) {
        this.tweens.add({
          targets: view.container,
          x: center.x,
          y: center.y,
          duration: 430,
          ease: "Sine.easeInOut",
        });
      } else {
        view.container.setPosition(center.x, center.y);
      }
      view.container.setDepth(center.y + 1);

      view.walking = resident.path.length > 0 || resident.goal === "explore";

      /*
       * The animation state comes from what the resident is actually doing.
       * A resident standing at their bench with `work` as their goal now works
       * visibly, which is the whole point of having a sheet: the simulation has
       * always known this and had no way to show it.
       */
      if (view.sprite) {
        const state: AnimState = view.walking ? "walk" : resident.goal === "work" ? "work" : "idle";
        // Facing is derived from real movement, and held through a stop so a
        // resident who pauses does not snap back to a default direction.
        const delta = resident.position.x - view.lastX;
        if (delta !== 0) view.facing = delta > 0 ? 1 : -1;
        view.lastX = resident.position.x;
        applyResidentAnimation(view.sprite, resident.species, state, resident.stage, view.facing);
      }
      const wantKey = resident.want && !resident.want.fulfilled ? `${resident.want.kind}:${resident.want.createdDay}` : "";
      if (view.lastWant !== wantKey) {
        view.lastWant = wantKey;
        if (resident.want && !resident.want.fulfilled) {
          const impatient = this.simulation.state.day - resident.want.createdDay > 6;
          view.wantMark.setText(WANT_GLYPH[resident.want.kind]);
          view.wantMark.setColor(impatient ? "#e87968" : "#ffd58b");
          view.wantMark.setVisible(true);
        } else {
          view.wantMark.setVisible(false);
        }
      }

      // Mastery mark, refreshed only when the tier actually changes.
      const mark = masteryMark(resident);
      if (view.lastMastery !== mark) {
        view.lastMastery = mark;
        view.masteryText.setText(mark);
        view.masteryText.setVisible(mark !== "");
      }

      // Face the direction of travel.
      if (view.sprite && resident.path.length > 0) {
        const next = resident.path[0]!;
        if (next.x !== resident.position.x) {
          view.sprite.setFlipX(next.x < resident.position.x);
        }
      }

      const selected = resident.id === selectedId;
      if (view.lastGoal !== resident.goal || view.lastSelected !== selected) {
        view.lastGoal = resident.goal;
        view.lastSelected = selected;
        const intentColor = GOAL_COLORS[resident.goal];
        view.marker.clear();
        if (selected) {
          view.marker.fillStyle(intentColor, 0.14);
          view.marker.fillCircle(0, 0, 20);
          view.marker.lineStyle(2, intentColor, 0.95);
          view.marker.strokeCircle(0, 0, 18);
          view.marker.lineStyle(2, PAPER, 0.8);
          view.marker.strokeCircle(0, 0, 14);
        } else {
          view.marker.fillStyle(intentColor, 0.7);
          view.marker.fillTriangle(0, -16, 4, -11, -4, -11);
        }
        if (!view.sprite) this.drawResidentVector(view.marker, resident.species);
        view.label.setVisible(selected);
        if (selected) view.label.setText(`${resident.name}  ·  ${GOAL_LABELS[resident.goal]}`);
      }

      // Distress dims the creature, readable at a glance across the board.
      view.container.setAlpha(resident.distress > 8 ? 0.5 : 1);
    }

    for (const [id, view] of this.residentViews) {
      if (seen.has(id)) continue;
      view.container.destroy(true);
      this.residentViews.delete(id);
    }
  }

  private drawResidentVector(graphics: Phaser.GameObjects.Graphics, species: Species): void {
    const color = Phaser.Display.Color.HexStringToColor(SPECIES_DEFINITIONS[species].color).color;
    graphics.fillStyle(color, 1);
    graphics.fillCircle(0, 0, 8);
    graphics.fillStyle(0xf5e6c8, 0.9);
    graphics.fillCircle(-3, -1, 1.6);
    graphics.fillCircle(3, -1, 1.6);
  }

  // --- Intent, expeditions, hover ----------------------------------------

  private drawIntent(): void {
    this.intentLayer.clear();
    this.intentLabel.setVisible(false);

    const resident = this.simulation.getSelectedResident();
    if (!resident?.target) return;

    const start = this.cellCenter(resident.position);
    const target = this.cellCenter(resident.target);
    if (start.x === target.x && start.y === target.y) return;

    const color = GOAL_COLORS[resident.goal];
    this.intentLayer.lineStyle(2, color, 0.4);
    let cursor = start;
    for (const step of resident.path) {
      const next = this.cellCenter(step);
      this.drawDashedLine(this.intentLayer, cursor, next, 6, 5);
      cursor = next;
    }
    if (resident.path.length === 0) this.drawDashedLine(this.intentLayer, start, target, 6, 5);

    this.intentLayer.fillStyle(color, 0.13);
    this.intentLayer.fillCircle(target.x, target.y, 11);
    this.intentLayer.lineStyle(2, color, 0.8);
    this.intentLayer.strokeCircle(target.x, target.y, 8);

    this.intentLabel
      .setText(`${GOAL_LABELS[resident.goal]} → ${this.targetLabel(resident.target)}`)
      .setColor(Phaser.Display.Color.IntegerToColor(color).rgba)
      .setPosition(target.x, target.y - 12)
      .setVisible(true);
  }

  private syncExpeditions(): void {
    this.expeditionLayer.removeAll(true);
    for (const expedition of this.simulation.state.expeditions) {
      if (expedition.status !== "active") continue;
      const target = this.cellCenter(expedition.target);
      const marker = this.add.graphics();
      marker.fillStyle(0xc8a9ff, 0.15);
      marker.fillCircle(target.x, target.y, 14);
      marker.lineStyle(2, 0xc8a9ff, 0.85);
      marker.strokeCircle(target.x, target.y, 10);
      this.expeditionLayer.add(marker);
      this.expeditionLayer.add(
        this.add.text(target.x, target.y + 14, `SCOUT ${expedition.progress}/${expedition.duration}`, {
          color: "#c8a9ff",
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          fontStyle: "bold",
          backgroundColor: "#08151be6",
          padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 0),
      );
    }
  }

  private drawHoverLayer(): void {
    const graphics = this.hoverLayer;
    graphics.clear();
    this.previewLabel.setVisible(false);
    const position = this.armedCell ?? this.hoverCell;
    if (!position) return;

    const px = OFFSET_X + position.x * TILE_SIZE;
    const py = OFFSET_Y + position.y * TILE_SIZE;
    const buildMode = this.simulation.state.buildMode;
    const preview = buildMode ? this.getBuildPreview(buildMode, position) : undefined;
    const color = preview ? (preview.valid ? VALID_COLOR : INVALID_COLOR) : PAPER;

    graphics.fillStyle(color, buildMode ? 0.06 : 0.04);
    graphics.fillRoundedRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 6);
    graphics.lineStyle(1.5, color, 0.6);
    graphics.strokeRoundedRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 6);

    if (!buildMode || !preview) return;

    const definition = buildMode === "path"
      ? { shortLabel: "PATH", color: "#8DBB72", cost: { warmth: 2, food: 1 } }
      : BUILDING_DEFINITIONS[buildMode];
    const previewColor = preview.valid
      ? Phaser.Display.Color.HexStringToColor(definition.color).color
      : INVALID_COLOR;
    graphics.fillStyle(previewColor, preview.valid ? 0.24 : 0.16);
    graphics.fillRoundedRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 6);
    graphics.lineStyle(2, previewColor, 0.9);
    graphics.strokeRoundedRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2, 6);
    if (preview.valid) {
      graphics.lineStyle(2.5, previewColor, 1);
      graphics.lineBetween(px + 9, py + 16, px + 14, py + 22);
      graphics.lineBetween(px + 14, py + 22, px + 24, py + 10);
    } else {
      graphics.lineStyle(2.5, previewColor, 1);
      graphics.lineBetween(px + 9, py + 9, px + 23, py + 23);
      graphics.lineBetween(px + 23, py + 9, px + 9, py + 23);
    }

    const status = preview.valid
      ? (this.armedCell ? "TAP AGAIN TO PLACE" : "READY")
      : `BLOCKED · ${preview.reason}`;
    const lines = [`${definition.shortLabel} · ${status}`, `COST ${this.formatCost(definition)}`];

    // Show what this specific plot is worth. Placement only becomes a decision
    // if the player can see the difference between two legal tiles.
    if (preview.valid && buildMode !== "path") {
      const adjacency = this.simulation.previewAdjacency(buildMode, position);
      const percent = Math.round((adjacency.multiplier - 1) * 100);
      if (percent !== 0) {
        lines.push(`OUTPUT ${percent > 0 ? "+" : ""}${percent}%`);
      }
      for (const note of adjacency.notes) lines.push(`${note.good ? "+" : "−"} ${note.text.replace(/ · [+−-]\d+%$/, "")}`);
    }

    this.previewLabel
      .setText(lines.join("\n"))
      .setColor(preview.valid ? "#f5e6c8" : "#ffd0c6")
      .setBackgroundColor(preview.valid ? "#12352fee" : "#451d22ee")
      .setPosition(px + TILE_SIZE / 2, py - 6)
      .setVisible(true);
  }

  private drawHeader(): void {
    const buildMode = this.simulation.state.buildMode;
    const hoveredTile = this.hoverCell ? this.simulation.state.grid[this.hoverCell.y]?.[this.hoverCell.x] : undefined;
    const collectibleLabel = hoveredTile ? COLLECTIBLE_LABELS[hoveredTile] : undefined;
    const hoveredBuilding = this.hoverCell ? this.simulation.getBuildingAt(this.hoverCell) : undefined;
    const hoveredDistrict = this.hoverCell ? this.simulation.getDistrictAt(this.hoverCell) : undefined;
    const activeExpedition = this.simulation.state.expeditions.find((expedition) => expedition.status === "active");
    const weatherHint =
      this.simulation.state.season === "longshade"
        ? "Long Shade ash is falling · keep the lanterns"
        : this.simulation.state.season === "emberfall"
          ? "emberfall motes lift from the canopy"
          : this.simulation.state.season === "mosswake"
            ? "mosswake petals drift across the reeds"
            : "suncrest spores hang in the warm air";

    const hint = buildMode === "path"
      ? "hover to preview PATH · click to pack earth"
      : buildMode
      ? `hover to preview ${BUILDING_DEFINITIONS[buildMode].shortLabel} · click to place`
      : collectibleLabel
        ? `${collectibleLabel} · click to gather · nodes regrow with the seasons`
        : hoveredBuilding
          ? `${BUILDING_DEFINITIONS[hoveredBuilding.type].label} · level ${hoveredBuilding.level} · click to inspect`
          : activeExpedition
            ? `${activeExpedition.title} · scout ${activeExpedition.progress}/${activeExpedition.duration}`
            : hoveredDistrict
              ? `${DISTRICT_DEFINITIONS[hoveredDistrict.type].label} · ${DISTRICT_DEFINITIONS[hoveredDistrict.type].bonus}`
              : `${weatherHint} · drag to pan · scroll to zoom`;

    if (hint !== this.lastHintText) {
      this.lastHintText = hint;
      this.hintText.setText(hint);
    }
  }

  private pointerToCell(pointer: Phaser.Input.Pointer): Vec2 | null {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor((worldPoint.x - OFFSET_X) / TILE_SIZE);
    const y = Math.floor((worldPoint.y - OFFSET_Y) / TILE_SIZE);
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
    return { x, y };
  }

  private cellCenter(position: Vec2): Vec2 {
    return {
      x: OFFSET_X + position.x * TILE_SIZE + TILE_SIZE / 2,
      y: OFFSET_Y + position.y * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  private getBuildPreview(type: BuildTool, position: Vec2): BuildPreviewState {
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
    if (type === "sky-walk") {
      if (state.chapter < 2 && !state.cloudmothsArrived) return { valid: false, reason: "NOT YET" };
      if (tile !== "grass" && tile !== "path") return { valid: false, reason: "CLEAR GROUND" };
    }
    if (type === "path") {
      if (tile !== "grass") return { valid: false, reason: "NEED GRASS" };
      if (state.resources.warmth < 2 || state.resources.food < 1) return { valid: false, reason: "NEED STORES" };
      return { valid: true, reason: "READY" };
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
    const building = this.simulation.getBuildingAt(position);
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
}

export { TILE_SIZE, OFFSET_X, OFFSET_Y, VIEW_W, VIEW_H };
