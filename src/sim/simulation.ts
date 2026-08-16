import {
  BASE_HOUSING_CAPACITY,
  BUILDING_DEFINITIONS,
  HOME_HOUSING_CAPACITY,
  DISTRICT_DEFINITIONS,
  ITEM_DEFINITIONS,
  MAX_BUILDING_LEVEL,
  OUTPUT_MULTIPLIER,
  PATH_COST,
  RECIPE_DEFINITIONS,
  SPECIES_DEFINITIONS,
  REGROWTH_DEFINITIONS,
  SEASONAL_EVENT_DEFINITIONS,
  UPGRADE_COSTS,
} from "../data/definitions";
import { evaluateAdjacency, type AdjacencyResult } from "./adjacency";
import {
  createWaterQuality,
  marketShortages,
  nextProposal,
  normalizeWorld,
  policyFrom,
  pushForecastHistory,
  tallyVotes,
  tickWaterQuality,
} from "./civic";
import { beginLongShade, crisisBanner, tickLongShade } from "./crisis";
import { rememberLongShade } from "./memory";
import { DAYS_PER_SEASON, TICKS_PER_DAY } from "./constants";
import { GRID_HEIGHT, GRID_WIDTH } from "./grid";
import { applySpeciesMood } from "./mood";
import { maybeAssignWant, updateWants } from "./systems/wants";
import { tickSpecies } from "./species";
import {
  findWalkableNear,
  invalidateAllPaths,
  isInside,
  isRevealed,
  setResidentTarget,
  stepAlongPath,
  type Terrain,
} from "./systems/movement";
import {
  calculateMetrics,
  housingMessageBand,
  resourceWarningLevel,
  checkHousingPressure,
  checkResourceWarnings,
  createWarningBands,
  housingCapacityOf,
  mostPressingNeed,
} from "./systems/metrics";
import { annotateForecast, calculateLocalForecast, compareForecasts } from "./forecast";
import { isWalkable, packCell } from "./pathfinding";
import { bestCraft, inheritedSkills, MASTERY_TIERS, speciesAffinity, tierFor } from "./mastery";
import { canAfford, hasTradition, isAvailable, TRADITION_DEFINITIONS } from "./traditions";
import type { SimContext } from "./systems/context";
import {
  activeObjectives,
  advanceObjectives,
  checkThresholdObjectives,
  updateChapter,
} from "./systems/progression";
import { updateResources } from "./systems/production";
import type { TorxThrmlForecastResponse } from "./bridge";
import type {
  Building,
  BuildingType,
  BuildTool,
  CollectibleTile,
  District,
  DistrictType,
  Expedition,
  Forecast,
  ItemKey,
  LifeStage,
  MapZoneKey,
  Message,
  NeedKey,
  Objective,
  RecipeKey,
  Regrowth,
  Resident,
  ResidentGoal,
  Relationship,
  RelationshipKind,
  ResourceKey,
  Season,
  TraditionKey,
  SettlementMetrics,
  SettlementStatus,
  Species,
  TileKind,
  Vec2,
  WorldState,
} from "./types";

// Re-exported so existing importers of `simulation` keep working; the values
// themselves live in `grid.ts` so systems can read them without a cycle.
export { GRID_HEIGHT, GRID_WIDTH } from "./grid";
/** Storage every settlement has before it builds anything to hold more. */
const BASE_STORAGE = 38;

/** How much each building adds to what the Commons can hold. */
const START_DAY = 8;

/*
 * A ceiling on the basin, not on the game. It was 60, which the settlement
 * reached by day 74 and then sat at for the rest of the run with housing no
 * longer meaning anything. Housing is meant to be the constraint the player
 * manages; this is only the point past which the basin itself is full.
 */
const MAX_POPULATION = 110;
const ARRIVAL_INTERVAL = TICKS_PER_DAY * 3;
const HISTORY_LIMIT = 240;
const SEASONS: Season[] = ["mosswake", "suncrest", "emberfall", "longshade"];

/** Ticks of sustained critical need before a resident leaves the Commons. */
const DEPARTURE_THRESHOLD = 26;
/** Ticks the settlement may sit in a failing state before it collapses. */
const COLLAPSE_THRESHOLD = TICKS_PER_DAY * 4;
const ADULT_AGE = 6;
const ELDER_AGE = 42;
/**
 * What one visit to a stall, a hearth or a lit path actually costs the stores.
 * Consumption used to be a flat per-head subtraction in the production step,
 * disconnected from anything a resident did; now it is the residents doing it.
 */
const MEAL_FOOD = 0.42;
const MEAL_WATER = 0.2;
const REST_WARMTH = 0.32;
/** Light burned per resident per tick standing inside a lit area, after dusk. */
const LANTERN_UPKEEP = 0.02;
/** A need above this is comfortable, and the resident stops drawing on stores. */
const SATED = 72;
/** What the Commons spends to put a council decision into effect. */
const PROPOSAL_COST = { food: 5, warmth: 4 } as const;

/** A district focus has to be lived with for a while before it can change. */
const DISTRICT_SWITCH_DAYS = 4;
const DISTRICT_SWITCH_COST = { food: 6, warmth: 4 } as const;

/** Residents a single market can comfortably serve. */
const RESIDENTS_PER_MARKET = 34;

/** How much each existing worker discourages another from joining a bench. */
const WORKPLACE_CROWDING = 1.6;
/**
 * How strong a family or kinship tie has to be before a resident will move in
 * with that relative. Set above the starting strength so households form out of
 * bonds that actually deepened, rather than on the first morning.
 */
const KINSHIP_MOVE_THRESHOLD = 70;

/** Which craft each workplace teaches. */
const WORKPLACE_CRAFT: Partial<Record<BuildingType, keyof Resident["skills"]>> = {
  "reed-farm": "farming",
  "root-workshop": "crafting",
  "commons-market": "crafting",
  "lantern-grove": "scouting",
  "sky-walk": "scouting",
};

/** Crossings before bare ground packs into a road, and the daily cap on that. */
const DESIRE_PATH_FOOTFALL = 260;
const DESIRE_PATHS_PER_DAY = 1;

/** How far ahead a worker must be to count as a teacher, and where teaching stops. */
const MENTOR_GAP = 18;
const MENTOR_GAP_CEILING = 82;

/** Days between the residents raising shelter for themselves. */
const SELF_BUILD_INTERVAL = 4;
/** Multiple of a home's cost the stores must hold before residents spend it. */
const SELF_BUILD_SURPLUS = 2.2;

/**
 * How far a building's light reaches, in tiles.
 *
 * Safety had no recovery path at all outside expedition leaders: it drained
 * 0.2 a tick forever and nothing put it back, so every resident was on a
 * silent countdown to leaving that no play could interrupt. Standing in lit
 * ground now restores it, which is what lantern groves are for.
 */
const LIGHT_RADIUS: Partial<Record<BuildingType, number>> = {
  "lantern-grove": 6,
  "root-heart": 5,
  "commons-market": 4,
  "burrow-home": 2,
  "root-workshop": 3,
  "sky-walk": 5,
};

/** How often a resident without a want may develop one. */
const WANT_INTERVAL = TICKS_PER_DAY;
/** Days a resident will wait before giving up on an unanswered request. */
const WANT_PATIENCE = 6;

/** What answering a request pays out. */

const ZONE_BOUNDS: Record<MapZoneKey, { xMin: number; xMax: number; yMin: number; yMax: number }> = {
  "sunken-reach": { xMin: 24, xMax: 31, yMin: 13, yMax: 20 },
  "old-hollow": { xMin: 19, xMax: 25, yMin: 3, yMax: 8 },
  "canopy-rift": { xMin: 0, xMax: 6, yMin: 17, yMax: 23 },
};

const ZONE_TARGETS: Record<MapZoneKey, Vec2> = {
  "sunken-reach": { x: 27, y: 16 },
  "old-hollow": { x: 22, y: 5 },
  "canopy-rift": { x: 3, y: 20 },
};

const ZONE_LABELS: Record<MapZoneKey, string> = {
  "sunken-reach": "Sunken Reach",
  "old-hollow": "Old Hollow",
  "canopy-rift": "Canopy Rift",
};

export const ZONE_COUNT = 3;

const COLLECTIBLE_REWARDS: Record<
  CollectibleTile,
  { item: ItemKey; amount: number; resource?: ResourceKey; resourceAmount?: number }
> = {
  fern: { item: "seed-pod", amount: 2, resource: "food", resourceAmount: 4 },
  mushroom: { item: "resin", amount: 1, resource: "warmth", resourceAmount: 2 },
  crystal: { item: "moonwater", amount: 2, resource: "water", resourceAmount: 5 },
  ruin: { item: "map-fragment", amount: 1, resource: "light", resourceAmount: 4 },
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/**
 * Notable things that happen in the world, emitted with a grid position so the
 * renderer can acknowledge them where they occurred rather than only as a line
 * of text in a panel.
 */
export interface SimEvent {
  type: "gather" | "build" | "upgrade" | "craft" | "objective" | "arrival" | "departure" | "regrowth" | "want" | "collapse";
  position?: Vec2;
  label?: string;
  tone?: "good" | "warning";
}

export type SimEventListener = (event: SimEvent) => void;

/** What a stage learns about the tick it is running inside. */
export interface TickInfo {
  readonly dayRolled: boolean;
  readonly previousSeason: Season;
}

/** One named step of the per-tick pipeline. */
export interface TickStage {
  readonly name: string;
  /** Stages that only make sense once a day, like births and council business. */
  readonly dailyOnly?: boolean;
  run(info: TickInfo): void;
}

export class SeededRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  next(): number {
    this.value = (this.value * 1664525 + 1013904223) >>> 0;
    return this.value / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  getState(): number {
    return this.value;
  }

  setState(value: number): void {
    this.value = value >>> 0;
  }
}

const speciesOrder: Species[] = ["brambleback", "glowtail", "mireling"];

const names = [
  "Pip", "Mallow", "Tallow", "Nix", "Pebble", "Lumen", "Sedge", "Bramble", "Clover", "Moss",
  "Dapple", "Wick", "Thimble", "Fennel", "Puddle", "Rook", "Juniper", "Mica", "Nettle", "Biscuit",
];

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const sameCell = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

export class MosslightSimulation {
  state: WorldState;
  private rng: SeededRandom;
  private nextMessageId = 1;
  private nextResidentId = 1;
  private nextBuildingId = 1;
  /**
   * Which council proposal comes next. This used to be a module-level counter
   * shared by every simulation in the process, and `nextProposal` picks the
   * proposal kind with `id % kinds.length` — so the council's agenda depended
   * on how many other worlds had been constructed first rather than on this
   * world. Two runs from the same seed diverged into different politics, and a
   * reloaded save resumed a different agenda than the one it left. Per instance
   * and serialized, both hold.
   */
  private nextProposalId = 1;
  private localForecast: Forecast | undefined;
  private researchSignals: TorxThrmlForecastResponse | null = null;
  /**
   * Edge-trigger state for the store and housing warnings: which band each
   * reading was last announced at, so the Commons speaks when a reading crosses
   * a threshold rather than every tick it sits past one.
   */
  private warningBands = createWarningBands();

  /**
   * Metrics are expensive relative to how often they actually change, so they
   * are recomputed at most once per tick and only when something marked them
   * stale. `updateMetrics()` used to run four times a tick.
   */
  private metricsDirty = true;
  private readonly eventListeners: SimEventListener[] = [];
  private adjacencyCache = new Map<string, AdjacencyResult>();
  private adjacencyCacheTick = -1;
  /** id -> building, rebuilt whenever the building list changes. */
  private buildingIndex = new Map<string, Building>();
  /** type -> first building of that type, for the common "find the market" lookup. */
  private buildingByType = new Map<BuildingType, Building>();
  /**
   * Every building of a type, not just the first.
   *
   * Residents chose where to eat, rest and warm themselves from a map that held
   * one building per type, so a settlement with three markets sent all ninety
   * of its residents to the same one. The board looked like a crowd standing on
   * a single tile rather than a town, and a second market bought the player
   * nothing at all.
   */
  private buildingsByType = new Map<BuildingType, Building[]>();
  /** Packed cells occupied by a building, for pathfinding. */
  private occupiedCells = new Set<number>();

  /**
   * The narrow surface handed to extracted tick systems. Built once and reused,
   * so a system never gets a reference to the whole class.
   */
  private readonly context: SimContext = ((owner: MosslightSimulation): SimContext => ({
    // `state` and `rng` are getters, not captured values: `restore()` swaps the
    // whole state object, and a snapshot taken at construction would leave every
    // system writing into the discarded world.
    get state() {
      return owner.state;
    },
    get rng() {
      return owner.rng;
    },
    addMessage: (text, tone) => owner.addMessage(text, tone),
    emit: (event) => owner.emit(event),
    markMetricsDirty: () => {
      owner.metricsDirty = true;
    },
    adjacencyFor: (building) => owner.adjacencyFor(building),
    hasPolicy: (kind) => owner.hasPolicy(kind),
    averageWaterQuality: () => owner.averageWaterQuality(),
    buildingOfType: (type) => owner.buildingByType.get(type),
    buildingById: (id) => owner.buildingIndex.get(id),
  }))(this);

  constructor(seed = 20260811) {
    this.rng = new SeededRandom(seed);
    this.state = this.createInitialState(seed);
    this.reindexBuildings();
    this.localForecast = this.state.forecast;
    for (const resource of Object.keys(this.state.resources) as ResourceKey[]) {
      this.warningBands.resources[resource] = resourceWarningLevel(this.state.resources[resource]);
    }
    this.warningBands.housing = housingMessageBand(this.state.metrics.housingPressure);
  }

  /** Subscribes to world events. Returns an unsubscribe function. */
  public onEvent(listener: SimEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index >= 0) this.eventListeners.splice(index, 1);
    };
  }

  private emit(event: SimEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  public advance(): void {
    if (this.state.paused || this.state.status === "collapsed") return;
    for (let index = 0; index < this.state.speed; index += 1) {
      this.tickOnce();
    }
  }

  public togglePause(): void {
    this.state.paused = !this.state.paused;
    this.addMessage(
      this.state.paused ? "SIMULATION · The Commons is listening." : "SIMULATION · The Commons is moving again.",
      "info",
    );
  }

  public setSpeed(speed: 1 | 2 | 4): void {
    this.state.speed = speed;
  }

  public setBuildMode(type: BuildTool | null): void {
    this.state.buildMode = type;
  }

  public dismissTitle(): void {
    this.state.titleSeen = true;
  }

  /** True when every ledger card is done — the sandbox still runs after this. */
  public isLedgerComplete(): boolean {
    return this.state.objectives.length > 0 && this.state.objectives.every((objective) => objective.completed);
  }

  /**
   * Advances the first-run coach when the player actually does the hinted
   * verb, so they never sit on a card that tells them to click a map they
   * cannot reach.
   */
  public noteTutorial(kind: "select" | "gather" | "build" | "civic"): void {
    if (this.state.onboardingDismissed) return;
    const expected: Record<typeof kind, number> = { select: 0, gather: 1, build: 2, civic: 3 };
    if (this.state.onboardingStep === expected[kind]) this.advanceOnboarding();
    if (this.state.onboardingStep >= 5) this.dismissOnboarding();
  }

  public paintPath(position: Vec2): boolean {
    if (!this.isInside(position) || !this.isRevealed(position)) return false;
    const tile = this.state.grid[position.y]?.[position.x];
    if (tile !== "grass") {
      this.addMessage("PATH BLOCKED · Roads need clear grass.", "warning");
      return false;
    }
    if (this.isOccupied(position)) {
      this.addMessage("PATH BLOCKED · Something already stands here.", "warning");
      return false;
    }
    if (this.state.resources.warmth < PATH_COST.warmth || this.state.resources.food < PATH_COST.food) {
      this.addMessage("PATH BLOCKED · Need a little food and warmth to pack the earth.", "warning");
      return false;
    }
    this.state.resources.warmth -= PATH_COST.warmth;
    this.state.resources.food -= PATH_COST.food;
    this.state.grid[position.y]![position.x] = "path";
    this.invalidateAllPaths();
    this.metricsDirty = true;
    this.addMessage(`PATH · Packed earth at ${position.x + 1}:${position.y + 1}.`, "good");
    this.emit({ type: "build", position, label: "PATH", tone: "good" });
    const roads = this.state.objectives.find((objective) => objective.id === "pack-the-roads");
    if (roads && !roads.completed && this.state.chapter >= 3) {
      roads.progress = Math.min(roads.target, roads.progress + 1);
      if (roads.progress >= roads.target) {
        roads.completed = true;
        this.addMessage("OBJECTIVE · Packed the roads.", "good");
      }
    }
    return true;
  }

  public approveProposal(): boolean {
    const proposal = this.state.proposal;
    if (!proposal || proposal.status !== "pending") return false;
    /*
     * Enacting a policy costs labour. Approving used to be pure upside — a
     * resource gift plus a mood bonus — so there was never a reason to say no
     * and the council was a formality rather than a decision.
     */
    if (this.state.resources.food < PROPOSAL_COST.food || this.state.resources.warmth < PROPOSAL_COST.warmth) {
      this.addMessage("COUNCIL · There is not enough in the stores to enact this yet.", "warning");
      return false;
    }
    this.state.resources.food -= PROPOSAL_COST.food;
    this.state.resources.warmth -= PROPOSAL_COST.warmth;
    proposal.status = "approved";
    proposal.votes = tallyVotes(proposal.kind, this.state.residents);
    if (proposal.kind === "shelter-first") {
      this.state.resources.warmth = clamp(this.state.resources.warmth + 6);
    } else if (proposal.kind === "wetland-first") {
      this.state.districtFocus = "wetland";
      this.boostBasin(6);
    } else if (proposal.kind === "market-first") {
      this.state.resources.food = clamp(this.state.resources.food + 5);
      this.state.districtFocus = "market";
    } else if (proposal.kind === "lantern-first") {
      this.state.resources.light = clamp(this.state.resources.light + 8);
      this.state.districtFocus = "lantern";
    } else if (proposal.kind === "welcome-moths") {
      this.spawnCloudmoths(2);
      this.state.districtFocus = "lantern";
    }
    this.applySpeciesMood(proposal.species, 8, -3);
    this.state.activePolicies = this.state.activePolicies.filter((policy) => policy.kind !== proposal.kind);
    this.state.activePolicies.push(policyFrom(proposal.kind));
    this.addMessage(`COUNCIL · Approved: ${proposal.title}. ${policyFrom(proposal.kind).label}.`, "good");
    this.metricsDirty = true;
    this.updateMetrics();
    this.updateForecast();
    return true;
  }

  public rejectProposal(): boolean {
    const proposal = this.state.proposal;
    if (!proposal || proposal.status !== "pending") return false;
    proposal.status = "rejected";
    this.applySpeciesMood(proposal.species, -10, 2);
    this.state.metrics.harmony = clamp(this.state.metrics.harmony - 4);
    this.addMessage(`COUNCIL · Rejected: ${proposal.title}. ${this.formatSpecies(proposal.species)}s will remember.`, "warning");
    this.metricsDirty = true;
    return true;
  }

  public rewindForecast(delta: number): void {
    const history = this.state.forecastHistory;
    if (history.length === 0) return;
    this.state.forecastCursor = Math.max(0, Math.min(history.length - 1, this.state.forecastCursor + delta));
    const snapshot = history[this.state.forecastCursor];
    if (snapshot) this.state.forecast = snapshot;
  }

  public forecastLesson(): string[] {
    const past = this.state.forecastHistory[this.state.forecastCursor];
    const live = this.state.forecastHistory[this.state.forecastHistory.length - 1];
    if (!past || !live) return [];
    return compareForecasts(past, live);
  }

  public selectResident(id: string): boolean {
    if (!this.state.residents.some((resident) => resident.id === id)) return false;
    this.state.selectedResidentId = id;
    return true;
  }

  public openWants() {
    return this.state.residents.filter((resident) => resident.want && !resident.want.fulfilled);
  }

  /**
   * Commits the Commons to a district.
   *
   * This used to be a free toggle with a pure upside — there was no reason not
   * to flip it to whatever the moment favoured. Re-pointing the whole
   * settlement now takes a few days to settle and costs the labour of the
   * changeover, so a focus is a bet rather than a switch.
   */
  public setDistrictFocus(type: DistrictType): boolean {
    if (!this.state.districts.some((district) => district.type === type)) return false;
    if (type === this.state.districtFocus) return false;

    const daysSince = this.state.day - this.state.districtFocusDay;
    if (daysSince < DISTRICT_SWITCH_DAYS) {
      this.addMessage(
        `DISTRICT · The Commons is still turning toward its last focus. ${DISTRICT_SWITCH_DAYS - daysSince} more days.`,
        "warning",
      );
      return false;
    }
    if (this.state.resources.food < DISTRICT_SWITCH_COST.food || this.state.resources.warmth < DISTRICT_SWITCH_COST.warmth) {
      this.addMessage("DISTRICT · Re-pointing the neighborhoods needs food and warmth in hand.", "warning");
      return false;
    }

    this.state.resources.food -= DISTRICT_SWITCH_COST.food;
    this.state.resources.warmth -= DISTRICT_SWITCH_COST.warmth;
    this.state.districtFocus = type;
    this.state.districtFocusDay = this.state.day;
    const district = this.state.districts.find((candidate) => candidate.type === type);
    this.addMessage(`DISTRICT · ${district?.label ?? type} is now the Commons focus.`, "info");
    this.metricsDirty = true;
    this.updateMetrics();
    this.updateForecast();
    return true;
  }

  /** Days remaining before the district focus may change again. */
  public districtSwitchDaysLeft(): number {
    return Math.max(0, DISTRICT_SWITCH_DAYS - (this.state.day - this.state.districtFocusDay));
  }

  public advanceOnboarding(): void {
    this.state.onboardingStep += 1;
    if (this.state.onboardingStep >= 5) this.dismissOnboarding();
  }

  public dismissOnboarding(): void {
    this.state.onboardingDismissed = true;
    this.state.onboardingStep = 5;
  }

  // --- Building upgrades -------------------------------------------------

  public canUpgrade(buildingId: string): { ok: boolean; reason: string } {
    const building = this.buildingIndex.get(buildingId);
    if (!building) return { ok: false, reason: "NO SUCH BUILDING" };
    if (building.type === "root-heart") return { ok: false, reason: "THE ROOT CANNOT BE REBUILT" };
    if (building.upgrading) return { ok: false, reason: "ALREADY UNDER WORK" };
    if (building.level >= MAX_BUILDING_LEVEL) return { ok: false, reason: "FULLY GROWN" };

    const plan = UPGRADE_COSTS[building.level + 1]!;
    for (const [resource, amount] of Object.entries(plan.cost) as Array<[ResourceKey, number]>) {
      if (this.state.resources[resource] < amount) {
        return { ok: false, reason: `NEEDS ${amount} ${this.formatResource(resource).toUpperCase()}` };
      }
    }
    for (const [item, amount] of Object.entries(plan.itemCost) as Array<[ItemKey, number]>) {
      if (this.state.items[item] < amount) {
        return { ok: false, reason: `NEEDS ${amount} ${this.formatItem(item).toUpperCase()}` };
      }
    }
    return { ok: true, reason: "READY" };
  }

  public startUpgrade(buildingId: string): boolean {
    const check = this.canUpgrade(buildingId);
    const building = this.buildingIndex.get(buildingId);
    if (!building) return false;
    if (!check.ok) {
      this.addMessage(`UPGRADE BLOCKED · ${BUILDING_DEFINITIONS[building.type].label} · ${check.reason}.`, "warning");
      return false;
    }

    const plan = UPGRADE_COSTS[building.level + 1]!;
    for (const [resource, amount] of Object.entries(plan.cost) as Array<[ResourceKey, number]>) {
      this.state.resources[resource] -= amount;
    }
    for (const [item, amount] of Object.entries(plan.itemCost) as Array<[ItemKey, number]>) {
      this.state.items[item] -= amount;
    }
    building.upgrading = true;
    building.upgradeProgress = 0;
    this.addMessage(
      `UPGRADE · ${BUILDING_DEFINITIONS[building.type].label} is being raised to level ${building.level + 1}.`,
      "good",
    );
    return true;
  }

  private updateUpgrades(): void {
    for (const building of this.state.buildings) {
      if (!building.upgrading) continue;
      const plan = UPGRADE_COSTS[building.level + 1];
      if (!plan) {
        building.upgrading = false;
        continue;
      }
      building.upgradeProgress += 1;
      if (building.upgradeProgress < plan.duration) continue;

      building.level += 1;
      building.upgrading = false;
      building.upgradeProgress = 0;
      this.metricsDirty = true;
      advanceObjectives(this.context, "upgrade", { building: building.type });
      this.addMessage(
        `UPGRADE · ${BUILDING_DEFINITIONS[building.type].label} is now level ${building.level}. Output rises to ${Math.round(OUTPUT_MULTIPLIER[building.level]! * 100)}%.`,
        "good",
      );
      this.emit({
        type: "upgrade",
        position: building.position,
        label: `LEVEL ${building.level}`,
        tone: "good",
      });
    }
  }

  // --- Expeditions and crafting ------------------------------------------

  public dispatchExpedition(): boolean {
    if (this.state.expeditions.some((expedition) => expedition.status === "active")) {
      this.addMessage("EXPEDITION BLOCKED · A scout team is already beyond the mapped paths.", "warning");
      return false;
    }

    const leader = this.getSelectedResident() ?? this.state.residents[0];
    const zone = (Object.keys(ZONE_BOUNDS) as MapZoneKey[]).find(
      (candidate) => !this.state.revealedAreas.includes(candidate),
    );
    if (!leader || !zone) {
      this.addMessage("EXPEDITION · Every known route is already mapped.", "info");
      return false;
    }

    // A practised scout shortens the route, as does staging from the ruins.
    const skillBonus = Math.floor(leader.skills.scouting / 40);
    const duration = Math.max(3, 6 - (this.state.districtFocus === "ruin" ? 1 : 0) - skillBonus);
    const expedition: Expedition = {
      id: `expedition-${this.state.expeditions.length + 1}`,
      leaderId: leader.id,
      target: ZONE_TARGETS[zone],
      zone,
      title: `${ZONE_LABELS[zone]} Survey`,
      progress: 0,
      duration,
      status: "active",
      rewardItem: "map-fragment",
      rewardAmount: 1,
    };
    this.state.expeditions.push(expedition);
    leader.goal = "explore";
    this.setResidentTarget(leader, expedition.target);
    leader.lastDecisionExplanation = `I am leading the ${expedition.title.toLowerCase()} for the Commons.`;
    this.addMessage(`EXPEDITION · ${leader.name} left for the ${this.formatZone(zone)}.`, "good");
    return true;
  }

  public startCraft(recipe: RecipeKey): boolean {
    if (this.countBuildings("root-workshop") === 0) {
      this.addMessage("CRAFT BLOCKED · Build a Root Workshop before refining materials.", "warning");
      return false;
    }
    if (this.state.crafting) {
      this.addMessage("CRAFT BLOCKED · The workshop is already shaping a civic order.", "warning");
      return false;
    }

    const definition = RECIPE_DEFINITIONS[recipe];
    for (const [item, amount] of Object.entries(definition.cost)) {
      const key = item as ItemKey;
      if (this.state.items[key] < (amount ?? 0)) {
        this.addMessage(
          `CRAFT BLOCKED · ${definition.label} needs ${amount ?? 0} ${this.formatItem(key)}; pack holds ${this.state.items[key]}.`,
          "warning",
        );
        return false;
      }
    }

    for (const [item, amount] of Object.entries(definition.cost)) {
      const key = item as ItemKey;
      this.state.items[key] = Math.max(0, this.state.items[key] - (amount ?? 0));
    }

    // A skilled workshop crew shortens the bench time.
    const workshop = this.buildingByType.get("root-workshop");
    const crafters = this.state.residents.filter((resident) => resident.workplaceId === workshop?.id);
    const averageCrafting = crafters.length
      ? crafters.reduce((sum, resident) => sum + resident.skills.crafting, 0) / crafters.length
      : 0;
    const duration = Math.max(2, definition.duration - Math.floor(averageCrafting / 45));

    this.state.crafting = {
      id: `craft-${this.state.tick}-${recipe}`,
      recipe,
      progress: 0,
      duration,
    };
    this.addMessage(`CRAFT · ${definition.label} is on the Root Workshop bench.`, "good");
    return true;
  }

  /**
   * Adjacency for an existing building, memoised for the current tick. Every
   * resource pass asks for this, and the neighbour scan is not free.
   */
  private adjacencyFor(building: Building): AdjacencyResult {
    const cached = this.adjacencyCache.get(building.id);
    if (cached && this.adjacencyCacheTick === this.state.tick) return cached;
    if (this.adjacencyCacheTick !== this.state.tick) {
      this.adjacencyCache.clear();
      this.adjacencyCacheTick = this.state.tick;
    }
    const result = evaluateAdjacency(building.type, building.position, {
      grid: this.state.grid,
      buildings: this.state.buildings,
      ignoreId: building.id,
    });
    this.adjacencyCache.set(building.id, result);
    return result;
  }

  /** Adjacency for a placed building, for the inspector. */
  public getAdjacency(buildingId: string): AdjacencyResult | undefined {
    const building = this.buildingIndex.get(buildingId);
    return building ? this.adjacencyFor(building) : undefined;
  }

  /** Adjacency a building *would* have at a cell, for the build preview. */
  public previewAdjacency(type: BuildingType, position: Vec2): AdjacencyResult {
    return evaluateAdjacency(type, position, {
      grid: this.state.grid,
      buildings: this.state.buildings,
    });
  }

  public getDistrictAt(position: Vec2): District | undefined {
    return this.state.districts.find((district) => {
      const { xMin, xMax, yMin, yMax } = district.bounds;
      return position.x >= xMin && position.x <= xMax && position.y >= yMin && position.y <= yMax;
    });
  }

  public getRelationshipsForResident(residentId: string): Relationship[] {
    return this.state.relationships
      .filter((relationship) => relationship.aId === residentId || relationship.bId === residentId)
      .sort((first, second) => second.strength - first.strength)
      .slice(0, 4);
  }

  public getBuildingAt(position: Vec2): Building | undefined {
    return this.state.buildings.find((building) => sameCell(building.position, position));
  }

  public build(type: Exclude<BuildingType, "root-heart">, position: Vec2): boolean {
    if (!this.isInside(position)) return false;
    if (this.isOccupied(position)) {
      this.addMessage("BUILD BLOCKED · That patch of ground is already spoken for.", "warning");
      return false;
    }

    const tile = this.state.grid[position.y]?.[position.x];
    if (!tile || tile === "water" || tile === "stone") {
      this.addMessage("BUILD BLOCKED · The ground is not ready for a foundation.", "warning");
      return false;
    }
    if (!this.isRevealed(position)) {
      this.addMessage("BUILD BLOCKED · An expedition must chart this ground first.", "warning");
      return false;
    }

    if (this.isCollectibleTile(tile)) {
      this.addMessage("BUILD BLOCKED · Gather this wild node before laying a foundation.", "warning");
      return false;
    }

    if (type === "reed-farm" && tile !== "wetland" && tile !== "grass") {
      this.addMessage("BUILD BLOCKED · Reed Farms need soft ground near water.", "warning");
      return false;
    }

    if (type === "root-workshop" && tile !== "grass" && tile !== "path") {
      this.addMessage("BUILD BLOCKED · Root Workshops need a clear patch or path.", "warning");
      return false;
    }

    if (type === "sky-walk") {
      if (this.state.chapter < 2 && !this.state.cloudmothsArrived) {
        this.addMessage("BUILD BLOCKED · A Sky Walk waits for Cloudmoths or the second chapter.", "warning");
        return false;
      }
      if (tile !== "grass" && tile !== "path") {
        this.addMessage("BUILD BLOCKED · Sky Walks need a clear patch or path.", "warning");
        return false;
      }
    }

    const definition = BUILDING_DEFINITIONS[type];
    const costScale = type === "burrow-home" && this.hasPolicy("shelter-first") ? 0.7 : 1;
    for (const [resource, amount] of Object.entries(definition.cost)) {
      const due = Math.ceil((amount ?? 0) * costScale);
      if ((this.state.resources[resource as ResourceKey] ?? 0) < due) {
        const key = resource as ResourceKey;
        const available = Math.floor(this.state.resources[key]);
        this.addMessage(
          `BUILD BLOCKED · ${definition.label} needs ${due} ${this.formatResource(key)}; stores hold ${available}.`,
          "warning",
        );
        return false;
      }
    }

    for (const [item, amount] of Object.entries(definition.itemCost ?? {})) {
      const key = item as ItemKey;
      const available = this.state.items[key] ?? 0;
      if (available < (amount ?? 0)) {
        this.addMessage(
          `BUILD BLOCKED · ${definition.label} needs ${amount ?? 0} ${this.formatItem(key)}; pack holds ${available}.`,
          "warning",
        );
        return false;
      }
    }

    for (const [resource, amount] of Object.entries(definition.cost)) {
      this.state.resources[resource as ResourceKey] -= Math.ceil((amount ?? 0) * costScale);
    }
    for (const [item, amount] of Object.entries(definition.itemCost ?? {})) {
      const key = item as ItemKey;
      this.state.items[key] = Math.max(0, this.state.items[key] - (amount ?? 0));
    }

    const building: Building = {
      id: `${type}-${this.nextBuildingId++}`,
      type,
      position,
      level: 1,
      upgradeProgress: 0,
      upgrading: false,
    };
    this.state.buildings.push(building);
    this.reindexBuildings();
    this.state.buildMode = null;
    this.metricsDirty = true;
    advanceObjectives(this.context, "build", { building: type });
    this.updateMetrics();
    // A new building changes the walkable graph, so every in-flight route is stale.
    this.invalidateAllPaths();
    const capacityNote = type === "burrow-home"
      ? ` · housing ${this.state.metrics.population}/${this.state.metrics.housingCapacity}`
      : "";
    this.addMessage(`BUILD · ${definition.label} is ready${capacityNote}.`, "good");
    this.emit({ type: "build", position, label: definition.shortLabel, tone: "good" });
    if (type === "sky-walk") this.revealZone("canopy-rift");
    this.updateForecast();
    return true;
  }

  /**
   * Takes what it can of `amount` from a stockpile and reports the fraction it
   * managed to cover, 0-1.
   *
   * This is the join that was missing between the economy and the population.
   * Stores used to be a threshold — food below 25 made needs drain faster, and
   * that was the whole of it — so a granary at 100 fed nobody and a settlement
   * could collapse with every bar full. Now eating, resting and lighting the
   * paths all draw on real stock, and running dry is felt directly.
   */
  private drawFromStore(resource: ResourceKey, amount: number): number {
    if (amount <= 0) return 1;
    const available = this.state.resources[resource];
    if (available <= 0) return 0;
    const taken = Math.min(available, amount);
    this.state.resources[resource] = available - taken;
    this.metricsDirty = true;
    return taken / amount;
  }

  public collectAt(position: Vec2): boolean {
    if (!this.isInside(position)) return false;
    if (!this.isRevealed(position)) return false;
    const tile = this.state.grid[position.y]?.[position.x];
    if (!tile || !this.isCollectibleTile(tile)) return false;

    const reward = COLLECTIBLE_REWARDS[tile];
    const itemAmount = reward.amount + (tile === "fern" && this.state.districtFocus === "meadow" ? 1 : 0);
    this.state.grid[position.y]![position.x] = "grass";

    // Queue the node to regrow rather than losing it from the world forever.
    const regrowth = REGROWTH_DEFINITIONS[tile];
    const seasonFactor = this.state.season === regrowth.favouredSeason ? 0.6 : 1;
    const totalTicks = Math.round(regrowth.ticks * seasonFactor);
    this.state.regrowth.push({
      x: position.x,
      y: position.y,
      tile,
      ticksRemaining: totalTicks,
      totalTicks,
    });

    this.state.items[reward.item] += itemAmount;
    if (reward.resource && reward.resourceAmount) {
      this.state.resources[reward.resource] = clamp(
        this.state.resources[reward.resource] + reward.resourceAmount,
      );
    }
    this.metricsDirty = true;
    advanceObjectives(this.context, "collect", { tile });
    this.updateMetrics();
    this.addMessage(
      `GATHER · ${this.formatCollectibleTile(tile)} → +${itemAmount} ${ITEM_DEFINITIONS[reward.item].label}${
        reward.resource ? ` · +${reward.resourceAmount} ${this.formatResource(reward.resource)}` : ""
      }.`,
      "good",
    );
    this.emit({
      type: "gather",
      position,
      label: `+${itemAmount} ${ITEM_DEFINITIONS[reward.item].label}`,
      tone: "good",
    });
    this.updateForecast();
    return true;
  }

  public selectAt(position: Vec2): void {
    const nearest = this.state.residents
      .map((resident) => ({ resident, distance: manhattan(resident.position, position) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearest) {
      this.state.selectedResidentId = nearest.resident.id;
    }
  }

  public getSelectedResident(): Resident | undefined {
    return this.state.residents.find((resident) => resident.id === this.state.selectedResidentId);
  }

  public applyForecast(forecast: Forecast, source: WorldState["forecastSource"]): void {
    const previousTitle = this.state.forecast.title;
    this.state.forecastSource = source;
    // When the bridge drops out, fall back to the most recent locally computed
    // forecast rather than freezing on a stale remote one.
    this.state.forecast = source === "local" ? (this.localForecast ?? forecast) : forecast;
    if (source === "torx-thrml" && this.state.forecast.title !== previousTitle) {
      this.addMessage(
        `FORECAST · TORX+THRML sees ${this.state.forecast.title} at ${Math.round(this.state.forecast.probability * 100)}% for ${this.state.forecast.window}.`,
        this.state.forecast.tone === "warning" ? "warning" : "info",
      );
    }
    if (source === "local") this.researchSignals = null;
  }

  public applyResearch(result: TorxThrmlForecastResponse): void {
    this.researchSignals = result;
    this.applyForecast(result.forecast, result.provider);
  }

  public getResearch(): TorxThrmlForecastResponse | null {
    return this.researchSignals;
  }

  // --- Serialization ------------------------------------------------------

  public serialize(): string {
    return JSON.stringify({
      version: SAVE_VERSION,
      rngState: this.rng.getState(),
      nextMessageId: this.nextMessageId,
      nextResidentId: this.nextResidentId,
      nextBuildingId: this.nextBuildingId,
      nextProposalId: this.nextProposalId,
      resourceWarningLevels: this.warningBands.resources,
      housingMessageBand: this.warningBands.housing,
      state: this.state,
    });
  }

  public restore(payload: SavePayload): void {
    this.rng.setState(payload.rngState);
    this.nextMessageId = payload.nextMessageId;
    this.nextResidentId = payload.nextResidentId;
    this.nextBuildingId = payload.nextBuildingId;
    this.nextProposalId = payload.nextProposalId;
    this.warningBands = { resources: payload.resourceWarningLevels, housing: payload.housingMessageBand };
    this.state = normalizeWorld(payload.state, payload.state.grid);
    this.reindexBuildings();
    this.metricsDirty = true;
    this.updateMetrics();
    this.localForecast = this.state.forecast;
  }

  // --- World construction -------------------------------------------------

  private createInitialState(seed: number): WorldState {
    const grid = this.createGrid();
    const makeBuilding = (id: string, type: BuildingType, position: Vec2): Building => ({
      id,
      type,
      position,
      level: 1,
      upgradeProgress: 0,
      upgrading: false,
    });
    const buildings: Building[] = [
      makeBuilding("root-heart", "root-heart", { x: 16, y: 6 }),
      makeBuilding("burrow-home-0", "burrow-home", { x: 11, y: 10 }),
      makeBuilding("reed-farm-0", "reed-farm", { x: 7, y: 17 }),
      makeBuilding("lantern-grove-0", "lantern-grove", { x: 23, y: 9 }),
      makeBuilding("commons-market-0", "commons-market", { x: 17, y: 12 }),
    ];

    const residents = this.createResidents(buildings);
    const districts = this.createDistricts();
    const state: WorldState = {
      seed,
      tick: 0,
      day: START_DAY,
      season: "mosswake",
      seasonDay: 1,
      phase: "dawn",
      grid,
      resources: { food: 68, water: 58, warmth: 46, light: 76 },
      items: { "seed-pod": 0, resin: 0, moonwater: 0, "map-fragment": 0 },
      revealed: this.createRevealedGrid(),
      revealedAreas: [],
      regrowth: [],
      buildings,
      residents,
      districts,
      districtFocus: "market",
      relationships: this.createRelationships(residents),
      expeditions: [],
      seasonalEvent: this.createSeasonalEvent("mosswake"),
      crafting: null,
      crafted: { "lantern-kit": 0, "bridge-kit": 0, "comfort-kit": 0, "sky-lantern": 0 },
      objectives: createObjectives(),
      chapter: 0,
      metrics: {
        population: 0,
        housingCapacity: 0,
        housingAvailable: 0,
        housingPressure: 0,
        averageWellbeing: 0,
        harmony: 0,
        resourceSecurity: 0,
        activeBuildings: 0,
        storage: { food: BASE_STORAGE, water: BASE_STORAGE, warmth: BASE_STORAGE, light: BASE_STORAGE },
        diagnosis: {
          need: "food",
          level: 100,
          cause: "The basin is waking.",
          advice: "Gather what the wild offers and see who arrives.",
          tone: "good",
        },
      },
      forecast: {
        title: "Lantern Festival",
        probability: 0.65,
        window: "next 2 days",
        drivers: ["light stores are healthy", "the market is open", "resident mixing is rising"],
        recommendation: "Keep the market open and let the neighborhoods mix.",
        tone: "bright",
      },
      forecastSource: "local",
      messages: [],
      history: [],
      selectedResidentId: residents[0]?.id ?? "",
      buildMode: null,
      paused: false,
      speed: 1,
      status: "thriving",
      collapseTimer: 0,
      departures: 0,
      wantsMet: 0,
      wantsMissed: 0,
      // Back-dated so the opening focus can be set immediately; the cooldown is
      // meant to make changing your mind a commitment, not to lock the player
      // out of the system for the first four days of the game.
      districtFocusDay: START_DAY - DISTRICT_SWITCH_DAYS,
      selfBuildDay: START_DAY,
      traditions: [],
      footfall: new Array(GRID_WIDTH * GRID_HEIGHT).fill(0),
      generations: 0,
      peakMastery: 0,
      onboardingStep: 0,
      onboardingDismissed: false,
      waterQuality: createWaterQuality(grid),
      habitatStress: 0,
      births: 0,
      cloudmothsArrived: false,
      speciesStrain: { brambleback: 0, glowtail: 0, mireling: 0, cloudmoth: 0 },
      speciesEase: { brambleback: 0, glowtail: 0, mireling: 0, cloudmoth: 0 },
      speciesLost: [],
      peakPopulation: 0,
      longShadeCrisis: false,
      longShadeStartDay: 0,
      longShadeEndsDay: 0,
      longShadeOutcome: null,
      proposal: null,
      activePolicies: [],
      forecastHistory: [],
      forecastCursor: 0,
      marketShortages: [],
      titleSeen: false,
    };

    state.metrics = this.calculateMetrics(state);
    state.forecast = this.calculateLocalForecast(state);
    this.addMessage(
      `SETTLEMENT · Day ${String(state.day).padStart(2, "0")} · ${this.formatSeason(state.season)} ${state.seasonDay}/${DAYS_PER_SEASON} · ${state.metrics.population}/${state.metrics.housingCapacity} housed. The Mosslight is awake.`,
      "good",
      state,
    );
    return state;
  }

  private createGrid(): TileKind[][] {
    const grid: TileKind[][] = [];
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      const row: TileKind[] = [];
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const lowerWetland = y > 17 && x < 29;
        const sidePool = x < 4 && y > 5;
        row.push(lowerWetland || sidePool ? "water" : "grass");
      }
      grid.push(row);
    }

    // Stone as a handful of small outcrops rather than one isolated cell every
    // 29th tile. Scattered single cells read as rendering artifacts speckled
    // across the field; clustered rock reads as terrain.
    const outcrops: Array<[number, number]> = [
      [5, 3], [12, 7], [20, 15], [26, 11], [9, 12], [29, 3],
    ];
    for (const [ox, oy] of outcrops) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          // A ragged 3x3 blob: the centre always, the ring most of the time.
          const isCenter = dx === 0 && dy === 0;
          if (!isCenter && (ox * 7 + oy * 13 + dx * 3 + dy * 5) % 3 === 0) continue;
          const x = ox + dx;
          const y = oy + dy;
          if (grid[y]?.[x] === "grass") grid[y]![x] = "stone";
        }
      }
    }

    for (let x = 2; x < 30; x += 1) {
      if (grid[12]?.[x] !== "water") grid[12]![x] = "path";
    }
    for (let y = 7; y < 22; y += 1) {
      if (grid[y]?.[16] !== "water") grid[y]![16] = "path";
    }
    for (let y = 16; y < 20; y += 1) {
      for (let x = 4; x < 12; x += 1) {
        if (grid[y]?.[x] === "water") grid[y]![x] = "wetland";
      }
    }

    const nodes: Array<[CollectibleTile, number, number]> = [
      ["fern", 14, 5],
      ["fern", 18, 4],
      ["fern", 27, 16],
      ["mushroom", 27, 5],
      ["mushroom", 6, 15],
      ["crystal", 28, 8],
      ["crystal", 25, 15],
      ["ruin", 8, 15],
      ["ruin", 29, 18],
      ["crystal", 21, 4],
      ["ruin", 23, 6],
    ];
    for (const [kind, x, y] of nodes) {
      if (grid[y]?.[x] && grid[y]![x] !== "water") grid[y]![x] = kind;
    }
    return grid;
  }

  private createRevealedGrid(): boolean[][] {
    const revealed = Array.from({ length: GRID_HEIGHT }, () => Array.from({ length: GRID_WIDTH }, () => true));
    for (const bounds of Object.values(ZONE_BOUNDS)) {
      for (let y = bounds.yMin; y <= bounds.yMax; y += 1) {
        for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
          if (revealed[y]?.[x] !== undefined) revealed[y]![x] = false;
        }
      }
    }
    return revealed;
  }

  private createDistricts(): District[] {
    const layout: Record<DistrictType, { xMin: number; xMax: number; yMin: number; yMax: number; center: Vec2 }> = {
      meadow: { xMin: 2, xMax: 13, yMin: 2, yMax: 11, center: { x: 8, y: 7 } },
      wetland: { xMin: 3, xMax: 12, yMin: 14, yMax: 20, center: { x: 8, y: 17 } },
      lantern: { xMin: 20, xMax: 30, yMin: 2, yMax: 11, center: { x: 24, y: 7 } },
      market: { xMin: 13, xMax: 22, yMin: 9, yMax: 15, center: { x: 17, y: 12 } },
      ruin: { xMin: 23, xMax: 31, yMin: 13, yMax: 20, center: { x: 27, y: 16 } },
    };
    return (Object.keys(layout) as DistrictType[]).map((type) => {
      const { center, xMin, xMax, yMin, yMax } = layout[type];
      return {
        id: `district-${type}`,
        type,
        center,
        bounds: { xMin, xMax, yMin, yMax },
        ...DISTRICT_DEFINITIONS[type],
      };
    });
  }

  private createRelationships(residents: Resident[]): Relationship[] {
    const relationships: Relationship[] = [];
    // Every resident gets at least one bond, so the social layer is real rather
    // than decorative. Pairing with a neighbour two seats along avoids giving
    // everyone the same partner.
    for (let index = 0; index < residents.length; index += 1) {
      const first = residents[index];
      const second = residents[(index + 2) % residents.length];
      if (!first || !second || first.id === second.id) continue;
      if (relationships.some((existing) =>
        (existing.aId === first.id && existing.bId === second.id)
        || (existing.aId === second.id && existing.bId === first.id))) continue;

      const kind: RelationshipKind = first.species === second.species
        ? this.rng.next() > 0.7 ? "family" : "kinship"
        : this.rng.next() > 0.2 ? "friendship" : "rivalry";
      relationships.push({
        id: `relationship-${relationships.length + 1}`,
        aId: first.id,
        bId: second.id,
        kind,
        strength: this.rng.range(42, 78),
        sharedDays: 1,
      });
    }
    return relationships;
  }

  private createSeasonalEvent(season: Season): WorldState["seasonalEvent"] {
    const definition = SEASONAL_EVENT_DEFINITIONS[season];
    return {
      ...definition,
      season,
      daysRemaining: DAYS_PER_SEASON,
    };
  }

  private createResidents(buildings: Building[]): Resident[] {
    const residents: Resident[] = [];

    for (let index = 0; index < 36; index += 1) {
      const resident = this.createResident(index, buildings);
      if (resident) residents.push(resident);
    }
    return residents;
  }

  private createResident(index: number, buildings: Building[]): Resident | undefined {
    const homes = buildings.filter((building) => building.type === "burrow-home");
    const market = buildings.find((building) => building.type === "commons-market");
    const farm = buildings.find((building) => building.type === "reed-farm");
    const grove = buildings.find((building) => building.type === "lantern-grove");
    const home = homes[index % homes.length];
    if (!home || !market || !farm || !grove) return undefined;

    const species = speciesOrder[index % speciesOrder.length]!;
    const work = species === "brambleback" ? home : species === "mireling" ? farm : grove;
    const offset = { x: (index % 5) - 2, y: Math.floor(index / 5) % 3 - 1 };
    const age = this.rng.int(ADULT_AGE, 30);
    return {
      id: `resident-${this.nextResidentId++}`,
      name: `${names[index % names.length]!} ${Math.floor(index / names.length) + 1}`,
      species,
      position: {
        x: clampCell(home.position.x + offset.x, 1, GRID_WIDTH - 2),
        y: clampCell(home.position.y + offset.y, 1, GRID_HEIGHT - 2),
      },
      homeId: home.id,
      workplaceId: work.id,
      needs: {
        shelter: this.rng.range(58, 92),
        food: this.rng.range(55, 90),
        safety: this.rng.range(60, 94),
        belonging: this.rng.range(42, 86),
      },
      traits: {
        curiosity: this.rng.next(),
        sociability: this.rng.next(),
        routine: this.rng.next(),
        resilience: this.rng.next(),
      },
      skills: {
        farming: this.rng.range(4, 22),
        crafting: this.rng.range(4, 22),
        scouting: this.rng.range(4, 22),
      },
      goal: index % 3 === 0 ? "work" : "socialize",
      target: index % 3 === 0 ? work.position : market.position,
      path: [],
      lastDecisionExplanation: "Settling into a new neighborhood.",
      age,
      stage: stageForAge(age),
      distress: 0,
      masteryTier: 0,
      taught: 0,
      memories: [],
    };
  }

  // --- Tick ---------------------------------------------------------------

  /**
   * The tick order, as data.
   *
   * This used to be a bare run of thirty statements, which meant the ordering
   * constraints between them — and there are real ones, like residents reading
   * housing pressure so metrics must be fresh before they act — were invisible
   * unless you already knew them. Naming each stage lets those constraints be
   * written down next to the thing they constrain, and lets a test assert the
   * order instead of trusting that nobody reshuffles the list.
   */
  private get pipeline(): TickStage[] {
    return this.tickStages ??= [
      { name: "seasonal-event", run: ({ previousSeason }) => this.updateSeasonalEvent(previousSeason) },
      { name: "policies", run: ({ dayRolled }) => this.updatePolicies(dayRolled) },
      { name: "long-shade", run: ({ dayRolled, previousSeason }) => this.updateLongShade(previousSeason, dayRolled) },
      { name: "regrowth", run: () => this.updateRegrowth() },
      { name: "expeditions", run: () => this.updateExpeditions() },
      { name: "crafting", run: () => this.updateCrafting() },
      { name: "upgrades", run: () => this.updateUpgrades() },
      { name: "water-habitat", run: () => this.updateWaterAndHabitat() },
      { name: "production", run: () => updateResources(this.context) },
      // Residents read housing pressure, so metrics must be fresh before they act.
      { name: "metrics-pre", run: () => this.updateMetrics() },
      { name: "residents", run: ({ dayRolled }) => this.updateResidents(dayRolled) },
      { name: "relationships", run: () => this.updateRelationships() },
      { name: "assign-wants", run: () => this.maybeAssignWant() },
      { name: "wants", run: () => this.updateWants() },
      { name: "arrivals", run: () => this.maybeWelcomeResident() },
      { name: "self-build", dailyOnly: true, run: () => this.maybeSelfBuild() },
      { name: "workplaces", dailyOnly: true, run: () => this.rebalanceWorkplaces() },
      { name: "kinship-homes", dailyOnly: true, run: () => this.rehomeByKinship() },
      { name: "species", dailyOnly: true, run: () => this.updateSpecies() },
      { name: "mastery", run: () => this.checkMastery() },
      { name: "desire-paths", dailyOnly: true, run: () => this.wearDesirePaths() },
      { name: "births", dailyOnly: true, run: () => this.maybeBirth() },
      { name: "issue-proposal", dailyOnly: true, run: () => this.maybeIssueProposal() },
      { name: "expire-proposal", dailyOnly: true, run: () => this.expireProposal() },
      { name: "cloudmoths", dailyOnly: true, run: () => this.maybeArriveCloudmoths() },
      // Everything that could change population, needs, or buildings has now run.
      { name: "metrics-post", run: () => this.updateMetrics() },
      { name: "resource-warnings", run: () => this.checkResourceWarnings() },
      { name: "housing-pressure", run: () => this.checkHousingPressure() },
      { name: "settlement-status", run: () => this.updateSettlementStatus() },
      { name: "threshold-objectives", run: () => checkThresholdObjectives(this.context) },
      { name: "chapter", run: () => updateChapter(this.context) },
      { name: "forecast", run: () => this.updateForecast() },
    ];
  }

  /** Stage names in execution order. Exposed so a test can pin the order. */
  public getPipelineOrder(): string[] {
    return this.pipeline.map((stage) => stage.name);
  }

  private tickStages: TickStage[] | null = null;

  private tickOnce(): void {
    this.state.tick += 1;
    const previousDay = this.state.day;
    this.state.day = START_DAY + Math.floor(this.state.tick / TICKS_PER_DAY);
    const elapsedSeasonDays = this.state.day - START_DAY;
    const previousSeason = this.state.season;
    this.state.season = SEASONS[Math.floor(elapsedSeasonDays / DAYS_PER_SEASON) % SEASONS.length]!;
    this.state.seasonDay = (elapsedSeasonDays % DAYS_PER_SEASON) + 1;
    const phaseIndex = this.state.tick % TICKS_PER_DAY;
    this.state.phase = phaseIndex < 2 ? "dawn" : phaseIndex < 7 ? "day" : phaseIndex < 10 ? "dusk" : "night";
    const dayRolled = this.state.day !== previousDay;

    for (const stage of this.pipeline) {
      if (stage.dailyOnly && !dayRolled) continue;
      stage.run({ dayRolled, previousSeason });
    }

    if (this.state.tick % TICKS_PER_DAY === 0) {
      this.addMessage(
        `DAY ${String(this.state.day).padStart(2, "0")} · ${this.formatSeason(this.state.season)} ${this.state.seasonDay}/${DAYS_PER_SEASON} · ${this.state.metrics.population}/${this.state.metrics.housingCapacity} housed · harmony ${Math.round(this.state.metrics.harmony)}%.`,
        "info",
      );
    }

    if (this.state.tick % 18 === 0) {
      this.addMessage(
        `FORECAST · ${this.state.forecast.title} ${Math.round(this.state.forecast.probability * 100)}% likely for ${this.state.forecast.window}. ${this.state.forecast.recommendation}`,
        this.state.forecast.tone === "warning" ? "warning" : "info",
      );
    }
  }

  private updateSeasonalEvent(previousSeason: Season): void {
    if (previousSeason !== this.state.season) {
      this.state.seasonalEvent = this.createSeasonalEvent(this.state.season);
      this.addMessage(
        `SEASON · ${this.state.seasonalEvent.title} begins. ${this.state.seasonalEvent.description}`,
        this.state.seasonalEvent.tone === "warning" ? "warning" : "info",
      );
    }
    this.state.seasonalEvent.daysRemaining = DAYS_PER_SEASON - this.state.seasonDay + 1;
  }

  /** Wild nodes return on a timer, faster in their favoured season. */
  private updateRegrowth(): void {
    if (this.state.regrowth.length === 0) return;
    const remaining: Regrowth[] = [];
    for (const entry of this.state.regrowth) {
      const favoured = REGROWTH_DEFINITIONS[entry.tile].favouredSeason === this.state.season;
      entry.ticksRemaining -= favoured ? 2 : 1;
      if (entry.ticksRemaining > 0) {
        remaining.push(entry);
        continue;
      }
      // Only regrow onto ground that is still clear.
      const current = this.state.grid[entry.y]?.[entry.x];
      const occupied = this.isOccupied({ x: entry.x, y: entry.y });
      if (current === "grass" && !occupied) {
        this.state.grid[entry.y]![entry.x] = entry.tile;
        this.addMessage(
          `REGROWTH · A ${REGROWTH_DEFINITIONS[entry.tile].label} has returned at plot ${entry.x + 1}:${entry.y + 1}.`,
          "good",
        );
        this.emit({ type: "regrowth", position: { x: entry.x, y: entry.y }, tone: "good" });
      }
    }
    this.state.regrowth = remaining;
  }

  private updateExpeditions(): void {
    for (const expedition of this.state.expeditions) {
      if (expedition.status !== "active") continue;
      expedition.progress = Math.min(expedition.duration, expedition.progress + 1);
      const leader = this.buildingIndexResident(expedition.leaderId);
      if (leader) {
        leader.skills.scouting = clamp(leader.skills.scouting + 0.6);
        this.stepAlongPath(leader);
      }
      if (expedition.progress < expedition.duration) continue;

      expedition.status = "complete";
      this.revealZone(expedition.zone);
      this.state.items[expedition.rewardItem] += expedition.rewardAmount;
      advanceObjectives(this.context, "expedition", { zone: expedition.zone });
      this.addMessage(
        `EXPEDITION · ${expedition.title} complete · +${expedition.rewardAmount} ${this.formatItem(expedition.rewardItem)}. ${this.formatZone(expedition.zone)} is mapped.`,
        "good",
      );
    }
  }

  private updateCrafting(): void {
    const order = this.state.crafting;
    if (!order) return;
    order.progress = Math.min(order.duration, order.progress + 1);
    if (order.progress < order.duration) return;

    const definition = RECIPE_DEFINITIONS[order.recipe];
    this.state.crafting = null;
    this.state.crafted[order.recipe] += 1;
    if (definition.effect === "light") {
      this.state.resources.light = clamp(this.state.resources.light + 12);
    } else if (definition.effect === "comfort") {
      this.state.resources.warmth = clamp(this.state.resources.warmth + 4);
      for (const resident of this.state.residents) {
        resident.needs.belonging = clamp(resident.needs.belonging + 3);
        resident.needs.shelter = clamp(resident.needs.shelter + 2);
      }
    } else if (definition.effect === "sky") {
      this.state.resources.light = clamp(this.state.resources.light + 8);
      for (const resident of this.state.residents) {
        if (resident.species === "cloudmoth") {
          resident.needs.belonging = clamp(resident.needs.belonging + 8);
          resident.needs.safety = clamp(resident.needs.safety + 6);
        }
      }
      this.revealZone("canopy-rift");
    } else {
      this.revealZone("old-hollow");
    }
    // Workshop crews learn from every completed order.
    const workshop = this.buildingByType.get("root-workshop");
    for (const resident of this.state.residents) {
      if (resident.workplaceId === workshop?.id) {
        resident.skills.crafting = clamp(resident.skills.crafting + 3);
      }
    }
    this.metricsDirty = true;
    advanceObjectives(this.context, "craft", { recipe: order.recipe });
    this.addMessage(`CRAFT · ${definition.label} is complete. ${definition.description}`, "good");
    if (workshop) {
      this.emit({ type: "craft", position: workshop.position, label: definition.label, tone: "good" });
    }
  }

  /**
   * Bonds grow when residents share ground and decay when they do not.
   * Rivalries invert that, and family bonds are stickier than the rest.
   */
  private updateRelationships(): void {
    if (this.state.tick % 4 !== 0) return;
    const byId = new Map(this.state.residents.map((resident) => [resident.id, resident]));
    for (const relationship of this.state.relationships) {
      const first = byId.get(relationship.aId);
      const second = byId.get(relationship.bId);
      if (!first || !second) continue;
      const nearby = manhattan(first.position, second.position) <= 3;
      const focusBonus = this.state.districtFocus === "market" && nearby ? 1.4 : 0;
      const decay = relationship.kind === "family" ? -0.03 : -0.08;
      const delta = nearby ? 1.2 + focusBonus : decay;
      relationship.strength = clamp(
        relationship.strength + (relationship.kind === "rivalry" ? -delta : delta),
        8,
        96,
      );
      if (nearby) {
        relationship.sharedDays += 1;
        // Close company is how belonging actually recovers.
        if (relationship.kind !== "rivalry") {
          const boost = relationship.strength > 70 ? 0.5 : 0.25;
          first.needs.belonging = clamp(first.needs.belonging + boost);
          second.needs.belonging = clamp(second.needs.belonging + boost);
        } else {
          first.needs.belonging = clamp(first.needs.belonging - 0.3);
          second.needs.belonging = clamp(second.needs.belonging - 0.3);
        }
      }

      // A long, strong friendship between different species becomes family.
      if (relationship.kind === "friendship" && relationship.strength > 90 && relationship.sharedDays > 40) {
        relationship.kind = "family";
        this.addMessage(`COMMONS · ${first.name} and ${second.name} are family now.`, "good");
      }
    }
  }

  private revealZone(zone: MapZoneKey): void {
    if (this.state.revealedAreas.includes(zone)) return;
    const bounds = ZONE_BOUNDS[zone];
    for (let y = bounds.yMin; y <= bounds.yMax; y += 1) {
      for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
        if (this.state.revealed[y]?.[x] !== undefined) this.state.revealed[y]![x] = true;
      }
    }
    this.state.revealedAreas.push(zone);
    this.invalidateAllPaths();
    // Zone objectives are swept from `revealedAreas` in the progression system,
    // so opening a zone counts however it was opened and whenever it happened.
  }

  /**
   * Production scales with building level and with the skill of the residents
   * assigned to each workplace, so upgrades and experienced crews both matter.
   */
  private updateResidents(dayRolled: boolean): void {
    const overcrowding = Math.max(0, this.state.metrics.housingPressure - 0.9);
    const departed: Resident[] = [];

    for (const resident of this.state.residents) {
      if (dayRolled) {
        /*
         * A day's work is a day's practice.
         *
         * Skill used to accrue only in the tick a resident happened to arrive
         * at their workplace with `work` as their goal, which almost never
         * happened once needs started steering them — a hundred and seventy
         * days in, the whole settlement was still Untrained. Everyone assigned
         * to a bench now improves at it daily, and nobody has to be lucky.
         */
        this.practiseCraft(resident);
        resident.age += 1;
        const nextStage = stageForAge(resident.age);
        if (nextStage !== resident.stage) {
          resident.stage = nextStage;
          if (nextStage === "elder") {
            this.addMessage(`COMMONS · ${resident.name} is an elder now and works a shorter day.`, "info");
          }
        }
      }

      // Elders are more resilient to hardship but produce less; sprouts learn fast.
      const stageDrain = resident.stage === "elder" ? 0.85 : resident.stage === "sprout" ? 1.15 : 1;
      const resilience = 1 - resident.traits.resilience * 0.25;
      const drainScale = stageDrain * resilience;

      resident.needs.food = clamp(resident.needs.food - (this.state.resources.food < 25 ? 1.1 : 0.55) * drainScale);
      resident.needs.shelter = clamp(resident.needs.shelter - ((this.state.resources.warmth < 20 ? 0.9 : 0.3) + overcrowding * 0.8) * drainScale);
      resident.needs.safety = clamp(resident.needs.safety - (this.state.resources.light < 20 ? 0.7 : 0.2) * drainScale);

      // Lit ground is what makes the basin feel safe. Away from the lanterns
      // safety only falls; inside their reach it recovers, and burns light.
      const coverage = resident.needs.safety < SATED ? this.lightCoverageAt(resident.position) : 0;
      if (coverage > 0) {
        const dark = this.state.phase === "dusk" || this.state.phase === "night";
        const fuelled = dark ? this.drawFromStore("light", LANTERN_UPKEEP * coverage) : 1;
        resident.needs.safety = clamp(resident.needs.safety + 0.55 * coverage * fuelled);
      }
      resident.needs.belonging = clamp(resident.needs.belonging - ((this.state.phase === "night" ? 0.25 : 0.1) + overcrowding * 0.2) * drainScale);

      // Sustained hardship eventually drives a resident out. This is the
      // settlement's real fail pressure — the population can shrink.
      const worstNeed = Math.min(...Object.values(resident.needs));
      if (worstNeed < 12) {
        resident.distress += 1;
      } else if (resident.distress > 0) {
        resident.distress -= 1;
      }
      if (resident.distress >= DEPARTURE_THRESHOLD) {
        departed.push(resident);
        continue;
      }

      const activeExpedition = this.state.expeditions.find(
        (expedition) => expedition.status === "active" && expedition.leaderId === resident.id,
      );
      if (activeExpedition) {
        resident.goal = "explore";
        this.setResidentTarget(resident, activeExpedition.target);
        resident.lastDecisionExplanation = `Leading ${activeExpedition.title.toLowerCase()} · ${activeExpedition.progress}/${activeExpedition.duration} route steps.`;
        continue;
      }

      /*
       * Nearest, not first. These were resolved once for the whole settlement
       * from a one-per-type map, so every resident walked to the same market
       * however many the player had built.
       */
      const market = this.nearestBuilding("commons-market", resident.position);
      const farm = this.nearestBuilding("reed-farm", resident.position);
      const grove = this.nearestBuilding("lantern-grove", resident.position);

      const mostPressing = this.getMostPressingNeed(resident);
      let goal: ResidentGoal = "work";
      const workplaceBuilding = this.buildingIndex.get(resident.workplaceId);
      let target: Vec2 | undefined = workplaceBuilding
        ? this.standingSpotFor(resident, workplaceBuilding)
        : undefined;
      let explanation = "Following a familiar routine.";

      if (this.state.phase === "night" && resident.species === "mireling") {
        goal = "rest";
        target = this.buildingIndex.get(resident.homeId)?.position;
        explanation = "Night belongs to the water. I am sleeping until dawn.";
      } else if (this.state.phase === "night" && resident.species === "glowtail" && grove) {
        goal = "work";
        target = grove.position;
        explanation = "Night is when Glowtails keep the lantern routes.";
      } else if (this.state.phase === "night" && resident.species === "cloudmoth") {
        goal = "explore";
        target = grove?.position ?? this.buildingIndex.get(resident.homeId)?.position;
        explanation = "I am reading the weather of the Long Shade.";
      } else if (mostPressing === "food" && market) {
        goal = "forage";
        target = this.standingSpotFor(resident, market);
        const shortage = this.state.marketShortages.find((entry) => entry.buildingId === market.id);
        explanation = shortage && shortage.pressure > 0.4
          ? "This market street is empty. I am hoping another stall still has food."
          : "Food is becoming uncertain, so I am heading toward the market.";
      } else if (mostPressing === "safety" && grove) {
        goal = "explore";
        target = this.standingSpotFor(resident, grove);
        explanation = "The lanterns are bright enough to make a safe night route.";
      } else if (mostPressing === "shelter") {
        goal = "rest";
        const home = this.buildingIndex.get(resident.homeId);
        target = home ? this.standingSpotFor(resident, home) : undefined;
        explanation = "Warmth is low; home is the best place to recover.";
      } else if (mostPressing === "belonging") {
        // Seek out the strongest friend rather than defaulting to the market,
        // so the social graph actually steers movement.
        const friend = this.findClosestFriend(resident);
        if (friend) {
          goal = "socialize";
          target = friend.position;
          explanation = `I have been alone too long; ${friend.name} is good company.`;
        } else if (market) {
          goal = "socialize";
          target = this.standingSpotFor(resident, market);
          explanation = "I have been alone too long; the Commons Market is where neighbors meet.";
        }
      } else if (resident.species === "mireling" && farm) {
        goal = "work";
        target = this.standingSpotFor(resident, farm);
        explanation = "The reeds need tending before the water changes.";
      } else if (resident.traits.curiosity > 0.7 && this.rng.next() > resident.traits.routine) {
        goal = "explore";
        target = this.findWalkableNear({ x: this.rng.int(4, 28), y: this.rng.int(5, 20) });
        explanation = "A new path appeared on the edge of the neighborhood.";
      }

      resident.goal = goal;
      resident.lastDecisionExplanation = explanation;
      if (target) this.setResidentTarget(resident, target);
      this.stepAlongPath(resident);

      if (target && sameCell(resident.position, target)) {
        // Satiety thresholds. Without them a resident who reached the market
        // simply stood there eating on every tick for as long as they lingered,
        // which emptied a full granary in about twenty days.
        if (goal === "forage" && resident.needs.food < SATED) {
          // A meal is food out of the granary and water out of the cistern.
          const fed = this.drawFromStore("food", MEAL_FOOD);
          const watered = this.drawFromStore("water", MEAL_WATER);
          const table = hasTradition(this.state, "open-table") ? 1.3 : 1;
          resident.needs.food = clamp(resident.needs.food + 9 * table * Math.min(1, fed * 0.7 + watered * 0.3));
          if (fed < 0.5) resident.lastDecisionExplanation = "The stalls are bare. I went hungry.";
        }
        if (goal === "rest" && resident.needs.shelter < SATED) {
          // A warm burrow burns fuel.
          const warmed = this.drawFromStore("warmth", REST_WARMTH);
          const hearth = hasTradition(this.state, "hearthcraft") ? 1.35 : 1;
          resident.needs.shelter = clamp(resident.needs.shelter + (4 + 5 * warmed) * hearth);
          if (warmed < 0.5) resident.lastDecisionExplanation = "There was no fuel left for the hearth.";
        }
        if (goal === "socialize") {
          const veil = resident.species === "cloudmoth" && hasTradition(this.state, "sky-veil") ? 1.4 : 1;
          resident.needs.belonging = clamp(resident.needs.belonging + 7 * veil);
        }
        if (goal === "explore") {
          resident.needs.safety = clamp(resident.needs.safety + 3);
          resident.skills.scouting = clamp(resident.skills.scouting + 0.25);
        }
        if (goal === "work") {
          resident.needs.food = clamp(resident.needs.food + 1.5);
          resident.needs.belonging = clamp(resident.needs.belonging + 1);
          // Time on the job is how skill accrues.
          const workplace = this.buildingIndex.get(resident.workplaceId);
          let rate = resident.stage === "sprout" ? 0.4 : resident.stage === "elder" ? 0.12 : 0.22;
          // A settlement that keeps its records teaches faster.
          if (hasTradition(this.state, "long-memory")) rate *= 1.6;
          // An experienced hand at the same bench brings a beginner on quickly.
          const mentor = this.findMentorFor(resident, workplace?.id);
          if (mentor) {
            rate *= 1.75;
            if (resident.mentorId !== mentor.id) {
              resident.mentorId = mentor.id;
              mentor.taught += 1;
              this.addMessage(
                `APPRENTICE · ${mentor.name} has taken ${resident.name} on at the ${workplace?.type === "reed-farm" ? "reeds" : "workshop"}.`,
                "good",
              );
            }
          }
          if (workplace?.type === "reed-farm") resident.skills.farming = clamp(resident.skills.farming + rate);
          else if (workplace?.type === "root-workshop") resident.skills.crafting = clamp(resident.skills.crafting + rate);
          else if (workplace?.type === "sky-walk") resident.skills.scouting = clamp(resident.skills.scouting + rate);
          else resident.skills.scouting = clamp(resident.skills.scouting + rate * 0.5);
        }
      }
    }

    for (const resident of departed) {
      this.removeResident(resident);
    }
    // Average wellbeing is derived from needs, which just moved for everyone.
    this.metricsDirty = true;
  }

  private removeResident(resident: Resident): void {
    this.state.residents = this.state.residents.filter((candidate) => candidate.id !== resident.id);
    this.state.relationships = this.state.relationships.filter(
      (relationship) => relationship.aId !== resident.id && relationship.bId !== resident.id,
    );
    this.state.expeditions = this.state.expeditions.filter(
      (expedition) => !(expedition.status === "active" && expedition.leaderId === resident.id),
    );
    if (this.state.selectedResidentId === resident.id) {
      this.state.selectedResidentId = this.state.residents[0]?.id ?? "";
    }
    this.state.departures += 1;
    this.metricsDirty = true;
    this.addMessage(
      `DEPARTURE · ${resident.name} left the Commons after too long without care. ${this.state.residents.length} remain.`,
      "warning",
    );
    this.emit({ type: "departure", position: resident.position, label: resident.name, tone: "warning" });
  }

  /**
   * How well-lit a cell is, 0-1, taken from the strongest nearby light source.
   * Upgraded buildings throw their light further.
   */
  private lightCoverageAt(position: Vec2): number {
    let best = 0;
    for (const building of this.state.buildings) {
      const radius = LIGHT_RADIUS[building.type];
      if (!radius) continue;
      const vigil = hasTradition(this.state, "lantern-vigil") ? 1.5 : 1;
      const reach = radius * (1 + (building.level - 1) * 0.25) * vigil;
      const distance = manhattan(building.position, position);
      if (distance > reach) continue;
      best = Math.max(best, 1 - distance / (reach + 1));
    }
    return best;
  }

  /**
   * Ground that gets walked enough packs itself into a road.
   *
   * The settlement's shape used to come only from where the player drew paths.
   * Now the routes residents actually use wear in on their own, so a Commons
   * grows the roads its life needs and the map records how it has been lived
   * in. Deliberately slow, and capped per day, so the basin never turns to
   * pavement.
   */
  private wearDesirePaths(): void {
    let worn = 0;
    for (let index = 0; index < this.state.footfall.length && worn < DESIRE_PATHS_PER_DAY; index += 1) {
      if (this.state.footfall[index]! < DESIRE_PATH_FOOTFALL) continue;
      const x = index % GRID_WIDTH;
      const y = Math.floor(index / GRID_WIDTH);
      // Reset regardless, so a tile that cannot pave stops being reconsidered.
      this.state.footfall[index] = 0;
      if (this.state.grid[y]?.[x] !== "grass") continue;
      if (this.isOccupied({ x, y })) continue;

      this.state.grid[y]![x] = "path";
      worn += 1;
      this.addMessage(`TRACKS · A path has worn itself in at ${x + 1}:${y + 1}.`, "info");
      this.emit({ type: "build", position: { x, y }, label: "TRACK", tone: "good" });
    }
    if (worn > 0) {
      this.invalidateAllPaths();
      this.metricsDirty = true;
    }
  }

  /**
   * An experienced worker at the same building who can bring a beginner on.
   *
   * Skill used to accrue in isolation at a fixed rate, so nobody ever learned
   * from anybody. Teaching is what turns a settlement's experience into
   * something the next generation starts from rather than repeats.
   */
  /** A day of practice at whatever bench this resident is assigned to. */
  private practiseCraft(resident: Resident): void {
    if (resident.stage === "sprout" && resident.age < 2) return;
    const workplace = this.buildingIndex.get(resident.workplaceId);
    const craft = workplace ? WORKPLACE_CRAFT[workplace.type] : undefined;
    const skill = craft ?? speciesAffinity(resident.species);

    let rate = resident.stage === "sprout" ? 1.9 : resident.stage === "elder" ? 0.7 : 1.35;
    if (hasTradition(this.state, "long-memory")) rate *= 1.5;
    if (this.findMentorFor(resident, resident.workplaceId)) rate *= 1.6;
    // Learning slows near the top of a craft; the last stretch is the hardest.
    const level = resident.skills[skill];
    if (level > 70) rate *= 0.6;
    resident.skills[skill] = clamp(level + rate);
  }

  private findMentorFor(learner: Resident, workplaceId?: string): Resident | undefined {
    if (!workplaceId) return undefined;
    const craft = bestCraft(learner).skill;
    if (learner.skills[craft] >= MENTOR_GAP_CEILING) return undefined;

    let best: Resident | undefined;
    for (const candidate of this.state.residents) {
      if (candidate.id === learner.id) continue;
      if (candidate.workplaceId !== workplaceId) continue;
      if (candidate.skills[craft] - learner.skills[craft] < MENTOR_GAP) continue;
      if (!best || candidate.skills[craft] > best.skills[craft]) best = candidate;
    }
    return best;
  }

  /**
   * Announces a resident crossing into a new tier of their craft. Growth that
   * nobody reports is growth the player never sees.
   */
  private checkMastery(): void {
    for (const resident of this.state.residents) {
      const { tier, skill } = bestCraft(resident);
      if (tier.rank <= resident.masteryTier) continue;
      resident.masteryTier = tier.rank;
      this.state.peakMastery = Math.max(this.state.peakMastery, tier.rank);
      const crafts: Record<typeof skill, string> = {
        farming: "the reeds",
        crafting: "the workshop",
        scouting: "the far paths",
      };
      this.addMessage(
        `MASTERY · ${resident.name} is now a ${tier.label} of ${crafts[skill]}.`,
        "good",
      );
      this.emit({ type: "want", position: resident.position, label: tier.mark, tone: "good" });
    }
  }

  private findClosestFriend(resident: Resident): Resident | undefined {
    let best: Resident | undefined;
    let bestScore = -Infinity;
    for (const relationship of this.state.relationships) {
      if (relationship.kind === "rivalry") continue;
      if (relationship.aId !== resident.id && relationship.bId !== resident.id) continue;
      const partnerId = relationship.aId === resident.id ? relationship.bId : relationship.aId;
      const partner = this.state.residents.find((candidate) => candidate.id === partnerId);
      if (!partner) continue;
      // Prefer strong bonds that are not far away.
      const score = relationship.strength - manhattan(resident.position, partner.position) * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = partner;
      }
    }
    return best;
  }

  /**
   * The Commons raising a burrow on its own initiative when it is over
   * capacity.
   *
   * Building count sat at five for a twelve-hundred tick run: residents never
   * built anything, so a player who set the game down watched a settlement that
   * could not help itself. It is deliberately slow and it spends real stores —
   * the player still builds far better and far faster, and choosing *where* is
   * still theirs — but the basin is no longer incapable of housing itself.
   */
  private maybeSelfBuild(): void {
    if (this.state.day - this.state.selfBuildDay < SELF_BUILD_INTERVAL) return;

    /*
     * What the settlement raises follows what the report says is wrong, so the
     * city grows in the direction of its own needs — farms when the stalls run
     * thin, groves when the edges are dark, a market when neighbours never
     * meet — rather than only ever adding another burrow.
     */
    const type = this.chooseSelfBuild();
    if (!type) return;

    const definition = BUILDING_DEFINITIONS[type];
    // Only from genuine surplus, so the residents never build themselves hungry.
    for (const [resource, amount] of Object.entries(definition.cost) as Array<[ResourceKey, number]>) {
      if (this.state.resources[resource] < amount * SELF_BUILD_SURPLUS) return;
    }

    const plot = this.findPlotFor(type);
    if (!plot) return;

    this.state.selfBuildDay = this.state.day;
    if (!this.build(type, plot)) return;
    this.addMessage(`COMMONS · The residents raised a ${definition.label} of their own.`, "good");
  }

  /** The building the Commons most needs next, or undefined if it needs none. */
  private chooseSelfBuild(): Exclude<BuildingType, "root-heart"> | undefined {
    const { housingPressure, diagnosis } = this.state.metrics;
    // Build ahead of the crunch rather than only once it has arrived, so the
    // settlement visibly keeps growing instead of settling at its first cap.
    if (housingPressure > 0.88) return "burrow-home";
    if (diagnosis.tone !== "warning") return undefined;

    const byNeed: Record<NeedKey, Exclude<BuildingType, "root-heart">> = {
      shelter: "burrow-home",
      food: "reed-farm",
      safety: "lantern-grove",
      belonging: "commons-market",
    };
    const wanted = byNeed[diagnosis.need];
    /*
     * Markets scale with the settlement rather than being capped at one or two.
     * A single market served a hundred and ten residents, so everyone converged
     * on the same handful of tiles no matter how well the rest was spread.
     */
    if (wanted === "commons-market") {
      const allowed = Math.max(1, Math.ceil(this.state.residents.length / RESIDENTS_PER_MARKET));
      if (this.countBuildings("commons-market") >= allowed) return undefined;
    }
    return wanted;
  }

  /**
   * Takes up a settlement practice for good. Returns false when the Commons
   * cannot pay for it or already keeps it.
   */
  public adoptTradition(key: TraditionKey): boolean {
    if (!isAvailable(this.state, key)) return false;
    if (!canAfford(this.state, key)) {
      this.addMessage(`TRADITION · The Commons cannot yet keep the ${TRADITION_DEFINITIONS[key].label}.`, "warning");
      return false;
    }
    const definition = TRADITION_DEFINITIONS[key];
    for (const [item, amount] of Object.entries(definition.cost) as Array<[ItemKey, number]>) {
      this.state.items[item] -= amount;
    }
    this.state.traditions.push(key);
    this.metricsDirty = true;
    this.updateMetrics();
    this.addMessage(`TRADITION · The Commons takes up the ${definition.label}. ${definition.effect}`, "good");
    this.emit({ type: "objective", label: definition.label, tone: "good" });
    return true;
  }

  /** Practices the Commons keeps. */
  public getTraditions(): TraditionKey[] {
    return this.state.traditions;
  }

  /**
   * Where the Commons should put its next building.
   *
   * Everything used to be dropped on the first free tile spiralling out from
   * the Root Heart, so however much the settlement grew it stayed one dense
   * knot around its centre. Each kind of building now looks for the ground that
   * suits it — homes at the edge of the housing so the town spreads, farms by
   * the water, groves where the nights are darkest, markets where people
   * actually live — and the map ends up looking like somewhere that grew.
   */
  private findPlotFor(type: Exclude<BuildingType, "root-heart">): Vec2 | undefined {
    const homes = this.buildingsByType.get("burrow-home") ?? [];
    const anchor = this.buildingByType.get("root-heart")?.position
      ?? { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };

    let best: Vec2 | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
      for (let x = 1; x < GRID_WIDTH - 1; x += 1) {
        const cell = { x, y };
        if (!this.isRevealed(cell) || this.isOccupied(cell)) continue;
        const tile = this.state.grid[y]?.[x];
        if (tile !== "grass") continue;

        // Nothing should end up marooned on the far edge of the basin.
        const reach = manhattan(cell, anchor);
        if (reach > 16) continue;
        let score = -reach * 0.35;

        // Never wall a building in against its neighbours.
        const crowding = this.state.buildings.filter(
          (building) => manhattan(building.position, cell) <= 2,
        ).length;
        score -= crowding * 3;

        switch (type) {
          case "burrow-home": {
            // Just beyond the current edge of housing: close enough to belong,
            // far enough that the town actually spreads.
            const nearestHome = homes.length
              ? Math.min(...homes.map((home) => manhattan(home.position, cell)))
              : 4;
            score -= Math.abs(nearestHome - 4) * 1.4;
            break;
          }
          case "reed-farm": {
            score += this.isNearTile(cell, "water", 3) || this.isNearTile(cell, "wetland", 3) ? 8 : -6;
            break;
          }
          case "lantern-grove": {
            // The darkest ground people actually walk on.
            score += (1 - this.lightCoverageAt(cell)) * 9;
            score -= homes.length
              ? Math.min(...homes.map((home) => manhattan(home.position, cell))) * 0.5
              : 0;
            break;
          }
          case "commons-market":
          case "root-workshop":
          default: {
            // Central to where people live.
            if (homes.length > 0) {
              const average = homes.reduce((sum, home) => sum + manhattan(home.position, cell), 0) / homes.length;
              score -= average * 0.8;
            }
            break;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          best = cell;
        }
      }
    }
    return best;
  }

  /** Whether a tile of a given kind sits within `radius` of a cell. */
  private isNearTile(cell: Vec2, kind: TileKind, radius: number): boolean {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tile = this.state.grid[cell.y + dy]?.[cell.x + dx];
        if (tile === kind) return true;
      }
    }
    return false;
  }

  private maybeWelcomeResident(): void {
    if (this.state.tick % ARRIVAL_INTERVAL !== 0) return;
    if (this.state.residents.length >= MAX_POPULATION) return;
    if (this.state.metrics.population >= this.state.metrics.housingCapacity) return;
    if (this.state.metrics.averageWellbeing < 57 || this.state.metrics.resourceSecurity < 42) return;
    if (Math.min(...Object.values(this.state.resources)) < 30) return;

    const resident = this.createResident(this.state.residents.length, this.state.buildings);
    if (!resident) return;
    // New arrivals start young and unskilled; they grow into the settlement.
    resident.age = 1;
    resident.stage = "sprout";
    resident.skills = { farming: 5, crafting: 5, scouting: 5 };
    this.state.residents.push(resident);
    const neighbor = this.state.residents.find((candidate) => candidate.id !== resident.id);
    if (neighbor) {
      this.state.relationships.push({
        id: `relationship-${this.state.relationships.length + 1}`,
        aId: resident.id,
        bId: neighbor.id,
        kind: resident.species === neighbor.species ? "kinship" : "friendship",
        strength: 48,
        sharedDays: 0,
      });
    }
    this.metricsDirty = true;
    this.updateMetrics();
    this.addMessage(
      `ARRIVAL · ${resident.name} joined the Commons · ${this.state.metrics.population}/${this.state.metrics.housingCapacity} housed.`,
      "good",
    );
    this.emit({ type: "arrival", position: resident.position, label: resident.name, tone: "good" });
  }

  /**
   * Tracks the settlement between thriving and collapsed. Sitting in a failing
   * state long enough ends the run — the game can now be lost.
   */
  private updateSettlementStatus(): void {
    if (this.state.status === "collapsed") return;

    const { averageWellbeing, resourceSecurity, population, housingPressure } = this.state.metrics;
    const starving = Object.values(this.state.resources).filter((value) => value < 12).length;
    const previous = this.state.status;

    /*
     * Failure is measured in residents, not in numbers on a bar. An empty
     * granary used to be enough on its own to run the collapse timer, so the
     * Commons could end with forty-two content residents still living in it and
     * nobody having left. Empty stores are a warning; they become a failure by
     * way of the meals they stop serving and the needs that then fall.
     */
    /*
     * How far the settlement has fallen from its own high-water mark.
     *
     * Average wellbeing alone is a trap once residents can leave: the least
     * settled go first, so a Commons haemorrhaging people watched its average
     * climb and read as recovering. A starved basin could shed a third of its
     * population and still call itself strained. Decline is measured against
     * the peak instead, which cannot be flattered by losing the unhappy.
     */
    this.state.peakPopulation = Math.max(this.state.peakPopulation ?? 0, population);
    const peak = this.state.peakPopulation;
    const lost = peak > 0 ? 1 - population / peak : 0;

    let status: SettlementStatus;
    if (population === 0) {
      status = "collapsed";
    } else if (averageWellbeing < 30 || lost >= 0.45) {
      status = "failing";
    } else if (
      starving >= 1 ||
      averageWellbeing < 52 ||
      resourceSecurity < 35 ||
      housingPressure > 1 ||
      lost >= 0.2
    ) {
      status = "strained";
    } else {
      status = "thriving";
    }

    if (status === "failing") {
      this.state.collapseTimer += 1;
      if (this.state.collapseTimer >= COLLAPSE_THRESHOLD) status = "collapsed";
    } else {
      this.state.collapseTimer = Math.max(0, this.state.collapseTimer - 2);
    }

    this.state.status = status;

    if (status !== previous) {
      if (status === "collapsed") {
        this.state.paused = true;
        this.addMessage(
          `COLLAPSE · The Commons could not hold. ${this.state.departures} residents left and the Mosslight has gone dark on day ${this.state.day}.`,
          "warning",
        );
      } else if (status === "failing") {
        const { diagnosis } = this.state.metrics;
        this.addMessage(
          `CRISIS · The Commons is failing. ${diagnosis.cause} ${diagnosis.advice}`,
          "warning",
        );
      } else if (status === "strained" && previous === "failing") {
        this.addMessage("RECOVERY · The worst has passed, but the Commons is still strained.", "info");
      } else if (status === "thriving" && previous !== "thriving") {
        this.addMessage("RECOVERY · The Commons is thriving again.", "good");
      }
    }
  }

  // --- Personal wants -----------------------------------------------------

  /**
   * Occasionally gives a resident a specific, nameable request. This is what
   * makes a particular creature worth caring about: forty identical need bars
   * become forty neighbours, one of whom would like a lantern near her burrow.
   */
  private maybeAssignWant(): void {
    maybeAssignWant(this.context);
  }

  private updateWants(): void {
    updateWants(this.context);
  }

  // --- Metrics ------------------------------------------------------------

  private updateMetrics(): void {
    if (!this.metricsDirty) return;
    this.state.metrics = calculateMetrics(this.state);
    this.metricsDirty = false;
  }

  private calculateMetrics(state: WorldState): SettlementMetrics {
    return calculateMetrics(state);
  }

  private checkResourceWarnings(): void {
    checkResourceWarnings(this.state, this.warningBands, (text, tone) => this.addMessage(text, tone));
  }

  private checkHousingPressure(): void {
    checkHousingPressure(this.state, this.warningBands, (text, tone) => this.addMessage(text, tone));
  }

  private getMostPressingNeed(resident: Resident): keyof Resident["needs"] {
    return mostPressingNeed(resident);
  }

  // --- Movement -----------------------------------------------------------

  /** The board as the movement system sees it: terrain plus what blocks it. */
  private get terrain(): Terrain {
    return { state: this.state, blocked: this.occupiedCells };
  }

  private setResidentTarget(resident: Resident, target: Vec2): void {
    setResidentTarget(this.terrain, resident, target);
  }

  private stepAlongPath(resident: Resident): void {
    stepAlongPath(this.terrain, resident);
  }

  private findWalkableNear(position: Vec2): Vec2 {
    return findWalkableNear(this.terrain, position);
  }

  private invalidateAllPaths(): void {
    invalidateAllPaths(this.state);
  }

  private reindexBuildings(): void {
    this.adjacencyCache.clear();
    this.adjacencyCacheTick = -1;
    this.buildingIndex = new Map(this.state.buildings.map((building) => [building.id, building]));
    this.buildingByType = new Map();
    this.buildingsByType = new Map();
    this.occupiedCells = new Set();
    for (const building of this.state.buildings) {
      if (!this.buildingByType.has(building.type)) this.buildingByType.set(building.type, building);
      const group = this.buildingsByType.get(building.type);
      if (group) group.push(building);
      else this.buildingsByType.set(building.type, [building]);
      this.occupiedCells.add(packCell(building.position.x, building.position.y, GRID_WIDTH));
    }
  }

  /**
   * Where a resident should stand when they visit a building.
   *
   * Everyone used to path to the building's own tile, so a market with thirty
   * regulars rendered as thirty creatures stacked on one cell. Each resident
   * gets a settled spot on the ring around it instead — deterministic, so they
   * keep their usual place rather than jittering between ticks — and the same
   * crowd reads as a gathering around a market instead of a pile on top of one.
   */
  private standingSpotFor(resident: Resident, building: Building): Vec2 {
    // Two cells deep, so a busy market has two dozen places to stand rather
    // than eight and a crowd still reads as individuals.
    const ring: Vec2[] = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const cell = { x: building.position.x + dx, y: building.position.y + dy };
        if (!this.isInside(cell)) continue;
        if (!isWalkable(this.state.grid[cell.y]?.[cell.x])) continue;
        if (this.occupiedCells.has(packCell(cell.x, cell.y, GRID_WIDTH))) continue;
        ring.push(cell);
      }
    }
    if (ring.length === 0) return building.position;
    // A stable hash of the pairing, so the same resident keeps the same spot.
    let hash = 0;
    for (let index = 0; index < resident.id.length; index += 1) hash = (hash * 31 + resident.id.charCodeAt(index)) >>> 0;
    for (let index = 0; index < building.id.length; index += 1) hash = (hash * 31 + building.id.charCodeAt(index)) >>> 0;
    return ring[hash % ring.length]!;
  }

  /** The closest building of a type to a point, if the settlement has one. */
  private nearestBuilding(type: BuildingType, from: Vec2): Building | undefined {
    const group = this.buildingsByType.get(type);
    if (!group || group.length === 0) return undefined;
    if (group.length === 1) return group[0];

    let best = group[0]!;
    let bestDistance = manhattan(best.position, from);
    for (let index = 1; index < group.length; index += 1) {
      const candidate = group[index]!;
      const distance = manhattan(candidate.position, from);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Spreads workers over every building that teaches their craft, nearest
   * first, so new workplaces actually draw a crew and the settlement's daily
   * traffic fans out instead of converging on whichever one was built first.
   */
  private rebalanceWorkplaces(): void {
    const counts = new Map<string, number>();
    for (const resident of this.state.residents) {
      counts.set(resident.workplaceId, (counts.get(resident.workplaceId) ?? 0) + 1);
    }

    for (const resident of this.state.residents) {
      const current = this.buildingIndex.get(resident.workplaceId);
      const type = current?.type ?? "commons-market";
      const group = this.buildingsByType.get(type);
      if (!group || group.length < 2) continue;

      const home = this.buildingIndex.get(resident.homeId)?.position ?? resident.position;
      // Prefer a nearer bench, but never pile onto one that is already busier.
      let best = current!;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of group) {
        const crowding = (counts.get(candidate.id) ?? 0) * WORKPLACE_CROWDING;
        const score = manhattan(candidate.position, home) + crowding;
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (best.id === resident.workplaceId) continue;

      counts.set(resident.workplaceId, Math.max(0, (counts.get(resident.workplaceId) ?? 1) - 1));
      counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
      resident.workplaceId = best.id;
      resident.mentorId = undefined;
    }

    const walks = this.buildingsByType.get("sky-walk");
    if (walks && walks.length > 0) {
      for (const resident of this.state.residents) {
        if (resident.species !== "cloudmoth") continue;
        const home = this.buildingIndex.get(resident.homeId)?.position ?? resident.position;
        let best = walks[0]!;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const walk of walks) {
          const score = manhattan(walk.position, home) + (counts.get(walk.id) ?? 0) * 0.4;
          if (score < bestScore) {
            best = walk;
            bestScore = score;
          }
        }
        if (resident.workplaceId === best.id) continue;
        counts.set(resident.workplaceId, Math.max(0, (counts.get(resident.workplaceId) ?? 1) - 1));
        counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
        resident.workplaceId = best.id;
      }
    }
  }

  /**
   * Families drift toward one another's burrows.
   *
   * Kinship and family ties were tracked, strengthened, and promoted from
   * friendship — and then did nothing at all except colour a line in the
   * inspector. Residents were housed by `index % homes.length` at world
   * creation and never moved again, so a settlement's social graph had no
   * bearing on where anybody actually lived. Once a day a resident with a
   * strong family or kinship tie moves in with that relative, if the burrow has
   * room, which turns the relationship system into something visible on the
   * board.
   */
  private rehomeByKinship(): void {
    const homes = this.buildingsByType.get("burrow-home");
    if (!homes || homes.length < 2) return;

    const occupancy = new Map<string, number>();
    for (const resident of this.state.residents) {
      occupancy.set(resident.homeId, (occupancy.get(resident.homeId) ?? 0) + 1);
    }

    const capacityOf = (building: Building): number =>
      Math.floor(
        (building.type === "root-heart" ? BASE_HOUSING_CAPACITY : HOME_HOUSING_CAPACITY) *
          (OUTPUT_MULTIPLIER[building.level] ?? 1),
      );

    const byId = new Map(this.state.residents.map((resident) => [resident.id, resident]));

    for (const resident of this.state.residents) {
      // The strongest family or kinship tie is the one worth moving for.
      let kin: Resident | undefined;
      let strongest = KINSHIP_MOVE_THRESHOLD;
      for (const relationship of this.state.relationships) {
        if (relationship.kind !== "family" && relationship.kind !== "kinship") continue;
        if (relationship.aId !== resident.id && relationship.bId !== resident.id) continue;
        const otherId = relationship.aId === resident.id ? relationship.bId : relationship.aId;
        const other = byId.get(otherId);
        if (!other || other.homeId === resident.homeId) continue;
        if (relationship.strength > strongest) {
          strongest = relationship.strength;
          kin = other;
        }
      }
      if (!kin) continue;

      const kinHome = this.buildingIndex.get(kin.homeId);
      if (!kinHome) continue;
      if ((occupancy.get(kinHome.id) ?? 0) >= capacityOf(kinHome)) continue;

      occupancy.set(resident.homeId, Math.max(0, (occupancy.get(resident.homeId) ?? 1) - 1));
      occupancy.set(kinHome.id, (occupancy.get(kinHome.id) ?? 0) + 1);
      resident.homeId = kinHome.id;
    }
  }

  /**
   * A species leaving, or coming back.
   *
   * Departures were entirely individual: a resident whose own needs stayed
   * critical long enough walked out, and the species roster never changed as a
   * result of how the basin was run. A Commons that let its water turn kept
   * every Mireling standing in it. Now a species with its conditions unmet past
   * its patience loses someone a day, and the last one leaving is called out —
   * a run can lose a species and feel it.
   */
  private updateSpecies(): void {
    const { leaving, returning } = tickSpecies(this.state, this.averageWaterQuality());

    for (const departure of leaving) {
      const candidates = this.state.residents.filter((resident) => resident.species === departure.species);
      if (candidates.length === 0) continue;
      // The least settled of them is the one who goes first.
      const going = candidates.reduce((worst, resident) =>
        resident.needs.belonging < worst.needs.belonging ? resident : worst,
      );
      const label = SPECIES_DEFINITIONS[departure.species].label;

      this.removeResident(going);
      if (departure.last) {
        if (!this.state.speciesLost.includes(departure.species)) {
          this.state.speciesLost.push(departure.species);
        }
        if (departure.species === "cloudmoth") this.state.cloudmothsArrived = false;
        this.addMessage(
          `EXODUS · The last ${label} has left the Commons: ${departure.reason}. ${departure.advice}`,
          "warning",
        );
        this.emit({ type: "departure", position: going.position, label: `${label}s gone`, tone: "warning" });
      } else {
        this.addMessage(
          `LEAVING · A ${label} has gone because ${departure.reason}. ${departure.advice}`,
          "warning",
        );
      }
    }

    for (const species of returning) {
      // Coming back is the reward for putting the basin right.
      const arrived = this.spawnSpecies(species, 2);
      if (arrived === 0) continue;
      this.state.speciesLost = this.state.speciesLost.filter((lost) => lost !== species);
      this.state.speciesEase[species] = 0;
      if (species === "cloudmoth") this.state.cloudmothsArrived = true;
      this.addMessage(
        `RETURN · ${arrived} ${SPECIES_DEFINITIONS[species].label}s have found the Commons again.`,
        "good",
      );
    }
  }

  private buildingIndexResident(id: string): Resident | undefined {
    return this.state.residents.find((resident) => resident.id === id);
  }

  private updateWaterAndHabitat(): void {
    const result = tickWaterQuality(this.state.grid, this.state.waterQuality, this.state.buildings);
    this.state.waterQuality = result.quality;
    this.state.habitatStress = result.stress;
  }

  private averageWaterQuality(state: WorldState = this.state): number {
    let total = 0;
    let count = 0;
    if (!state?.waterQuality) return 70;
    for (const row of state.waterQuality) {
      for (const value of row) {
        total += value;
        count += 1;
      }
    }
    return count ? total / count : 70;
  }

  private maybeIssueProposal(): void {
    if (this.state.day % 7 !== 0) return;
    if (this.state.proposal?.status === "pending") return;
    this.state.proposal = nextProposal(this.state.day, this.state.chapter, this.nextProposalId++, this.state.residents);
    this.addMessage(`COUNCIL · ${this.state.proposal.title} · vote by day ${this.state.proposal.deadlineDay}.`, "info");
  }

  private expireProposal(): void {
    const proposal = this.state.proposal;
    if (!proposal || proposal.status !== "pending") return;
    if (this.state.day <= proposal.deadlineDay) return;
    proposal.status = "expired";
    this.applySpeciesMood(proposal.species, -6, 0);
    this.addMessage(`COUNCIL · ${proposal.title} expired unanswered.`, "warning");
  }

  private updatePolicies(dayRolled: boolean): void {
    if (!dayRolled) return;
    this.state.activePolicies = this.state.activePolicies
      .map((policy) => ({ ...policy, daysRemaining: policy.daysRemaining - 1 }))
      .filter((policy) => policy.daysRemaining > 0);
  }

  private hasPolicy(kind: WorldState["activePolicies"][number]["kind"]): boolean {
    return this.state.activePolicies.some((policy) => policy.kind === kind);
  }

  private applySpeciesMood(species: Species, allyDelta: number, othersDelta: number): void {
    applySpeciesMood(this.state, species, allyDelta, othersDelta);
  }

  private boostBasin(amount: number): void {
    for (let y = 0; y < this.state.waterQuality.length; y += 1) {
      for (let x = 0; x < this.state.waterQuality[y]!.length; x += 1) {
        const tile = this.state.grid[y]![x];
        if (tile === "water" || tile === "wetland") {
          this.state.waterQuality[y]![x] = clamp((this.state.waterQuality[y]![x] ?? 70) + amount);
        }
      }
    }
  }

  private formatSpecies(species: Species): string {
    if (species === "brambleback") return "Brambleback";
    if (species === "glowtail") return "Glowtail";
    if (species === "mireling") return "Mireling";
    return "Cloudmoth";
  }

  private updateLongShade(previousSeason: Season, dayRolled: boolean): void {
    if (previousSeason !== this.state.season && this.state.season === "longshade") {
      if (beginLongShade(this.state)) {
        this.addMessage(
          "LONG SHADE · The canopy thins. Light will drain for ten days. The moths are coming.",
          "warning",
        );
      }
    }
    const { mothsDue, resolved } = tickLongShade(this.state);
    if (mothsDue) this.spawnCloudmoths(3);
    if (resolved) {
      // Everyone grown enough to have understood it carries it from here.
      const recorded = rememberLongShade(this.state, resolved);
      if (recorded > 0) {
        this.addMessage(`COMMONS · ${recorded} residents will remember this season.`, "info");
      }
    }
    if (resolved === "thrived") {
      this.addMessage("LONG SHADE · The Commons held. Cloudmoths stay and the basin still glows.", "good");
    } else if (resolved === "strained") {
      this.addMessage("LONG SHADE · You survived, but light and trust are thin.", "warning");
    } else if (resolved === "failed") {
      this.addMessage("LONG SHADE · The light failed. The Commons is slipping.", "warning");
      this.state.status = this.state.status === "collapsed" ? "collapsed" : "failing";
    }
    if (dayRolled && this.state.longShadeCrisis) {
      const note = crisisBanner(this.state);
      if (note) this.addMessage(note, "warning");
    }
  }

  private maybeBirth(): void {
    if (this.state.metrics.housingAvailable < 1) return;
    if (this.state.residents.length >= MAX_POPULATION) return;
    const families = this.state.relationships.filter((relationship) => relationship.kind === "family" && relationship.strength > 70);
    if (families.length === 0 || this.rng.next() > 0.35) return;
    const family = this.rng.pick(families);
    const parent = this.state.residents.find((resident) => resident.id === family.aId);
    if (!parent) return;
    const child = this.createResident(this.state.residents.length, this.state.buildings);
    if (!child) return;
    child.age = 0;
    child.stage = "sprout";
    child.species = parent.species;
    child.homeId = parent.homeId;
    // A quarter of what the parent knows, so a long-lived Commons raises
    // better workers than a young one and the generations visibly compound.
    child.skills = inheritedSkills(parent);
    child.skills[speciesAffinity(child.species)] += 3;
    child.masteryTier = 0;
    this.state.generations = Math.max(this.state.generations, 1);
    this.state.residents.push(child);
    this.state.births += 1;
    this.state.relationships.push({
      id: `relationship-birth-${this.state.births}`,
      aId: parent.id,
      bId: child.id,
      kind: "family",
      strength: 80,
      sharedDays: 0,
    });
    this.metricsDirty = true;
    const inheritedBest = bestCraft(child);
    this.addMessage(
      inheritedBest.level >= 8
        ? `BIRTH · ${child.name} arrived in ${parent.name}'s burrow, already knowing something of the family craft.`
        : `BIRTH · ${child.name} arrived in ${parent.name}'s burrow.`,
      "good",
    );
    this.emit({ type: "arrival", position: child.position, label: child.name, tone: "good" });
  }

  private maybeArriveCloudmoths(): void {
    if (this.state.cloudmothsArrived) return;
    const shade = this.state.season === "longshade" || this.state.chapter >= 2;
    if (!shade || this.state.metrics.harmony < 55) return;
    this.spawnCloudmoths(3);
  }

  /**
   * Brings newcomers of a species into the basin. Returns how many actually
   * arrived, which can be fewer than asked for when there is nowhere to put
   * them.
   */
  private spawnSpecies(species: Species, count: number, explanation?: string): number {
    let spawned = 0;
    for (let index = 0; index < count; index += 1) {
      const resident = this.createResident(this.state.residents.length + index, this.state.buildings);
      if (!resident) continue;
      resident.species = species;
      resident.age = this.rng.int(8, 20);
      resident.stage = "adult";
      resident.lastDecisionExplanation = explanation ?? "We heard the basin was worth another try.";
      this.state.residents.push(resident);
      spawned += 1;
    }
    if (spawned > 0) this.metricsDirty = true;
    return spawned;
  }

  private spawnCloudmoths(count: number): void {
    this.state.cloudmothsArrived = true;
    this.state.longShadeCrisis = this.state.season === "longshade";
    const spawned = this.spawnSpecies("cloudmoth", count, "We followed the last healthy roots.");
    if (spawned > 0) {
      this.addMessage(`LONG SHADE · ${spawned} Cloudmoths found the Commons.`, "good");
    }
  }

  // --- Forecast -----------------------------------------------------------

  private updateForecast(): void {
    const localForecast = annotateForecast(this.calculateLocalForecast(), this.state);
    this.localForecast = localForecast;
    this.state.forecastHistory = pushForecastHistory(this.state.forecastHistory, localForecast);
    this.state.forecastCursor = this.state.forecastHistory.length - 1;

    // A live Torx+THRML result owns the visible forecast until the adapter
    // explicitly replaces it or the main loop requests a local fallback.
    if (this.state.forecastSource !== "local") return;

    const previousTitle = this.state.forecast.title;
    this.state.forecast = localForecast;
    if (this.state.tick > 0 && previousTitle !== localForecast.title) {
      this.addMessage(
        `EVENT · ${localForecast.title} is now the leading signal at ${Math.round(localForecast.probability * 100)}%. ${localForecast.recommendation}`,
        localForecast.tone === "warning" ? "warning" : "info",
      );
    }
  }

  private calculateLocalForecast(state: WorldState = this.state): Forecast {
    return calculateLocalForecast(state);
  }

  // --- Ledger and objectives ---------------------------------------------

  private addMessage(text: string, tone: Message["tone"], state = this.state): void {
    const message: Message = { id: this.nextMessageId++, text, tone, day: state.day };
    state.messages.unshift(message);
    state.messages = state.messages.slice(0, 5);
    // The full ledger is kept separately so the log panel has real scrollback.
    state.history.unshift(message);
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  }

  /** Objectives the player can currently see. Delegates to the progression system. */
  public getActiveObjectives(): Objective[] {
    return activeObjectives(this.context);
  }

  private countBuildings(type: BuildingType, state: WorldState = this.state): number {
    return state.buildings.filter((building) => building.type === type).length;
  }

  private getHousingCapacity(buildings: Building[]): number {
    return housingCapacityOf(buildings);
  }


  private formatResource(resource: ResourceKey): string {
    return resource.charAt(0).toUpperCase() + resource.slice(1);
  }

  private formatItem(item: ItemKey): string {
    return ITEM_DEFINITIONS[item].label;
  }

  private formatCollectibleTile(tile: CollectibleTile): string {
    return REGROWTH_DEFINITIONS[tile].label;
  }

  private formatZone(zone: MapZoneKey): string {
    return ZONE_LABELS[zone];
  }

  private formatSeason(season: Season): string {
    return {
      mosswake: "Mosswake",
      suncrest: "Suncrest",
      emberfall: "Emberfall",
      longshade: "Longshade",
    }[season];
  }

  private isInside(position: Vec2): boolean {
    return isInside(position);
  }

  private isOccupied(position: Vec2): boolean {
    return this.occupiedCells.has(packCell(position.x, position.y, GRID_WIDTH));
  }

  private isRevealed(position: Vec2): boolean {
    return isRevealed(this.state, position);
  }

  private isCollectibleTile(tile: TileKind): tile is CollectibleTile {
    return tile === "fern" || tile === "mushroom" || tile === "crystal" || tile === "ruin";
  }
}

function stageForAge(age: number): LifeStage {
  return age < ADULT_AGE ? "sprout" : age < ELDER_AGE ? "adult" : "elder";
}

function clampCell(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export const SAVE_VERSION = 8;

export interface SavePayload {
  version: number;
  rngState: number;
  nextMessageId: number;
  nextResidentId: number;
  nextBuildingId: number;
  nextProposalId: number;
  resourceWarningLevels: Record<ResourceKey, number>;
  housingMessageBand: number;
  state: WorldState;
}

/**
 * Objectives are grouped into chapters. Chapter 0 is the tutorial arc that
 * shipped before; later chapters give the mid and late game somewhere to go.
 */
function createObjectives(): Objective[] {
  return [
    {
      id: "survey-basin",
      title: "Survey the Basin",
      description: "Gather three wild nodes from the Commons.",
      kind: "collect",
      target: 3,
      progress: 0,
      completed: false,
      rewardItem: "map-fragment",
      rewardAmount: 2,
      chapter: 0,
    },
    {
      id: "seed-the-commons",
      title: "Seed the Commons",
      description: "Gather two Fern Patches for future growth.",
      kind: "collect",
      tile: "fern",
      target: 2,
      progress: 0,
      completed: false,
      rewardItem: "seed-pod",
      rewardAmount: 3,
      chapter: 0,
    },
    {
      id: "raise-workshop",
      title: "Raise a Root Workshop",
      description: "Build a workshop with resin and a recovered map.",
      kind: "build",
      building: "root-workshop",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 3,
      chapter: 0,
    },
    {
      id: "scout-sunken-reach",
      title: "Scout the Sunken Reach",
      description: "Dispatch a resident to reveal the first hidden route.",
      kind: "expedition",
      zone: "sunken-reach",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 2,
      chapter: 0,
    },
    {
      id: "craft-root-bridge",
      title: "Craft a Root Bridge",
      description: "Use a Map Fragment and Seed Pod at the workshop.",
      kind: "craft",
      recipe: "bridge-kit",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "map-fragment",
      rewardAmount: 1,
      chapter: 0,
    },
    // Chapter 1 — consolidate and grow.
    {
      id: "raise-a-home",
      title: "Deepen the Burrows",
      description: "Upgrade any building to level 2.",
      kind: "upgrade",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "seed-pod",
      rewardAmount: 4,
      chapter: 1,
    },
    {
      id: "forty-strong",
      title: "Forty Strong",
      description: "Grow the Commons to forty residents.",
      kind: "population",
      target: 40,
      progress: 0,
      completed: false,
      rewardItem: "resin",
      rewardAmount: 3,
      chapter: 1,
    },
    {
      id: "light-the-paths",
      title: "Light the Paths",
      description: "Craft two Glow Kits for the night routes.",
      kind: "craft",
      recipe: "lantern-kit",
      target: 2,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 3,
      chapter: 1,
    },
    // Chapter 2 — the settled Commons.
    {
      id: "open-old-hollow",
      title: "Open the Old Hollow",
      description: "Chart the second hidden zone beyond the basin.",
      kind: "expedition",
      zone: "old-hollow",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "map-fragment",
      rewardAmount: 3,
      chapter: 2,
    },
    {
      id: "a-harmonious-commons",
      title: "A Harmonious Commons",
      description: "Hold settlement harmony at 80% or above.",
      kind: "harmony",
      target: 80,
      progress: 0,
      completed: false,
      rewardItem: "resin",
      rewardAmount: 4,
      chapter: 2,
    },
    {
      id: "fully-grown",
      title: "Fully Grown",
      description: "Complete three more building upgrades.",
      kind: "upgrade",
      target: 3,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 5,
      chapter: 2,
    },
    {
      id: "welcome-the-shade",
      title: "Welcome the Long Shade",
      description: "Hold the Commons through a Longshade season with Cloudmoths present.",
      kind: "harmony",
      target: 70,
      progress: 0,
      completed: false,
      rewardItem: "resin",
      rewardAmount: 5,
      chapter: 3,
    },
    {
      id: "pack-the-roads",
      title: "Pack the Roads",
      description: "Lay six new packed-earth paths so motes stop cutting through the reeds.",
      kind: "build",
      target: 6,
      progress: 0,
      completed: false,
      rewardItem: "seed-pod",
      rewardAmount: 4,
      chapter: 3,
    },
    {
      id: "raise-the-sky-veil",
      title: "Raise the Sky Veil",
      description: "Take up the Sky Veil so Cloudmoths can rest in the canopy light.",
      kind: "tradition",
      tradition: "sky-veil",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 4,
      chapter: 4,
    },
    {
      id: "a-host-of-moths",
      title: "A Host of Moths",
      description: "Keep three Cloudmoths in the Commons through the Long Shade.",
      kind: "population",
      species: "cloudmoth",
      target: 3,
      progress: 0,
      completed: false,
      rewardItem: "resin",
      rewardAmount: 4,
      chapter: 4,
    },
    {
      id: "hang-a-sky-walk",
      title: "Hang a Sky Walk",
      description: "Raise a hanging walkway so Cloudmoths have a place above the basin.",
      kind: "build",
      building: "sky-walk",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 3,
      chapter: 4,
    },
    {
      id: "chart-canopy-rift",
      title: "Chart the Canopy Rift",
      description: "Open the last hidden bank of the basin, by walkway or by scout.",
      kind: "expedition",
      zone: "canopy-rift",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "map-fragment",
      rewardAmount: 2,
      chapter: 5,
    },
    {
      id: "hang-sky-lanterns",
      title: "Hang Sky Lanterns",
      description: "Craft a Sky Lantern so moths can find the Commons after dark.",
      kind: "craft",
      recipe: "sky-lantern",
      target: 1,
      progress: 0,
      completed: false,
      rewardItem: "moonwater",
      rewardAmount: 3,
      chapter: 5,
    },
  ];
}
