import {
  BUILDING_DEFINITIONS,
  DISTRICT_DEFINITIONS,
  ITEM_DEFINITIONS,
  MAX_BUILDING_LEVEL,
  OUTPUT_MULTIPLIER,
  PATH_COST,
  RECIPE_DEFINITIONS,
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
import { annotateForecast, calculateLocalForecast, compareForecasts } from "./forecast";
import { findPath, isWalkable, packCell, type PathContext } from "./pathfinding";
import { describeWant, isWantSatisfied, unmetWantKinds } from "./wants";
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
  Objective,
  RecipeKey,
  Regrowth,
  Resident,
  ResidentGoal,
  Relationship,
  RelationshipKind,
  ResourceKey,
  Season,
  SettlementMetrics,
  SettlementStatus,
  Species,
  TileKind,
  Vec2,
  WantKind,
  WorldState,
} from "./types";

export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 24;
const MAX_RESOURCE = 100;
const START_DAY = 8;
const TICKS_PER_DAY = 12;
const DAYS_PER_SEASON = 7;
const BASE_HOUSING_CAPACITY = 24;
const HOME_HOUSING_CAPACITY = 18;
const MAX_POPULATION = 60;
const ARRIVAL_INTERVAL = TICKS_PER_DAY * 3;
const HISTORY_LIMIT = 240;
const SEASONS: Season[] = ["mosswake", "suncrest", "emberfall", "longshade"];

/** Ticks of sustained critical need before a resident leaves the Commons. */
const DEPARTURE_THRESHOLD = 26;
/** Ticks the settlement may sit in a failing state before it collapses. */
const COLLAPSE_THRESHOLD = TICKS_PER_DAY * 4;
const ADULT_AGE = 6;
const ELDER_AGE = 42;
/** How often a resident without a want may develop one. */
const WANT_INTERVAL = TICKS_PER_DAY;
/** Days a resident will wait before an unmet want starts to weigh on them. */
const WANT_PATIENCE = 6;

const ZONE_BOUNDS: Record<MapZoneKey, { xMin: number; xMax: number; yMin: number; yMax: number }> = {
  "sunken-reach": { xMin: 24, xMax: 31, yMin: 13, yMax: 20 },
  "old-hollow": { xMin: 19, xMax: 25, yMin: 3, yMax: 8 },
};

const ZONE_TARGETS: Record<MapZoneKey, Vec2> = {
  "sunken-reach": { x: 27, y: 16 },
  "old-hollow": { x: 22, y: 5 },
};

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
let nextProposalId = 1;

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
  private localForecast: Forecast | undefined;
  private resourceWarningLevels: Record<ResourceKey, number> = {
    food: 0,
    water: 0,
    warmth: 0,
    light: 0,
  };
  private housingMessageBand = 0;

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
  /** Packed cells occupied by a building, for pathfinding. */
  private occupiedCells = new Set<number>();

  constructor(seed = 20260811) {
    this.rng = new SeededRandom(seed);
    this.state = this.createInitialState(seed);
    this.reindexBuildings();
    this.localForecast = this.state.forecast;
    for (const resource of Object.keys(this.state.resources) as ResourceKey[]) {
      this.resourceWarningLevels[resource] = this.getResourceWarningLevel(this.state.resources[resource]);
    }
    this.housingMessageBand = this.getHousingMessageBand(this.state.metrics.housingPressure);
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

  public setDistrictFocus(type: DistrictType): void {
    if (!this.state.districts.some((district) => district.type === type)) return;
    this.state.districtFocus = type;
    const district = this.state.districts.find((candidate) => candidate.type === type);
    this.addMessage(`DISTRICT · ${district?.label ?? type} is now the Commons focus.`, "info");
    this.metricsDirty = true;
    this.updateMetrics();
    this.updateForecast();
  }

  public advanceOnboarding(): void {
    this.state.onboardingStep += 1;
  }

  public dismissOnboarding(): void {
    this.state.onboardingDismissed = true;
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
      this.advanceObjectives("upgrade", undefined, building.type);
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
      title: zone === "sunken-reach" ? "Sunken Reach Survey" : "Old Hollow Survey",
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
    this.advanceObjectives("build", undefined, type);
    this.updateMetrics();
    // A new building changes the walkable graph, so every in-flight route is stale.
    this.invalidateAllPaths();
    const capacityNote = type === "burrow-home"
      ? ` · housing ${this.state.metrics.population}/${this.state.metrics.housingCapacity}`
      : "";
    this.addMessage(`BUILD · ${definition.label} is ready${capacityNote}.`, "good");
    this.emit({ type: "build", position, label: definition.shortLabel, tone: "good" });
    this.updateForecast();
    return true;
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
    this.advanceObjectives("collect", tile);
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
  }

  // --- Serialization ------------------------------------------------------

  public serialize(): string {
    return JSON.stringify({
      version: SAVE_VERSION,
      rngState: this.rng.getState(),
      nextMessageId: this.nextMessageId,
      nextResidentId: this.nextResidentId,
      nextBuildingId: this.nextBuildingId,
      resourceWarningLevels: this.resourceWarningLevels,
      housingMessageBand: this.housingMessageBand,
      state: this.state,
    });
  }

  public restore(payload: SavePayload): void {
    this.rng.setState(payload.rngState);
    this.nextMessageId = payload.nextMessageId;
    this.nextResidentId = payload.nextResidentId;
    this.nextBuildingId = payload.nextBuildingId;
    this.resourceWarningLevels = payload.resourceWarningLevels;
    this.housingMessageBand = payload.housingMessageBand;
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
      crafted: { "lantern-kit": 0, "bridge-kit": 0, "comfort-kit": 0 },
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
      onboardingStep: 0,
      onboardingDismissed: false,
      waterQuality: createWaterQuality(grid),
      habitatStress: 0,
      births: 0,
      cloudmothsArrived: false,
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
    };
  }

  // --- Tick ---------------------------------------------------------------

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

    this.updateSeasonalEvent(previousSeason);
    this.updatePolicies(dayRolled);
    this.updateLongShade(previousSeason, dayRolled);
    this.updateRegrowth();
    this.updateExpeditions();
    this.updateCrafting();
    this.updateUpgrades();
    this.updateWaterAndHabitat();
    this.updateResources();
    // Residents read metrics (housing pressure), so refresh once before they act.
    this.updateMetrics();
    this.updateResidents(dayRolled);
    this.updateRelationships();
    this.maybeAssignWant();
    this.updateWants();
    this.maybeWelcomeResident();
    if (dayRolled) {
      this.maybeBirth();
      this.maybeIssueProposal();
      this.expireProposal();
      this.maybeArriveCloudmoths();
    }
    // Everything that could change population, needs, or buildings has now run.
    this.updateMetrics();
    this.checkResourceWarnings();
    this.checkHousingPressure();
    this.updateSettlementStatus();
    this.checkThresholdObjectives();
    this.updateChapter();
    this.updateForecast();

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
      this.advanceObjectives("expedition", undefined, undefined, expedition.zone);
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
    this.advanceObjectives("craft", undefined, undefined, undefined, order.recipe);
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
  }

  /**
   * Production scales with building level and with the skill of the residents
   * assigned to each workplace, so upgrades and experienced crews both matter.
   */
  private updateResources(): void {
    const farmOutput = this.weightedOutput("reed-farm", "farming");
    const homeOutput = this.weightedOutput("burrow-home");
    const groveOutput = this.weightedOutput("lantern-grove");
    const marketOutput = this.weightedOutput("commons-market");
    const workshops = this.weightedOutput("root-workshop", "crafting");
    const population = this.state.residents.length;
    const craftedResin = Math.min(Math.ceil(workshops), this.state.items.resin);
    const farmFactor = this.state.districtFocus === "wetland" ? 1.2 : 1;
    const groveFactor = this.state.districtFocus === "lantern" ? 1.2 : 1;
    const marketFactor = this.state.seasonalEvent.effect === "festival" ? 0.16 : 0.06;
    const seasonalWarmth = this.state.seasonalEvent.effect === "bloom" ? 0.25 : 0;
    const seasonalDrain = this.state.seasonalEvent.effect === "watch" ? 0.18 : 0;
    const lanternPolicy = this.hasPolicy("lantern-first") ? 1.18 : 1;
    const farmPolicy = this.hasPolicy("wetland-first") ? 1.12 : 1;
    const marketPolicy = this.hasPolicy("market-first") ? 1.16 : 1;

    // Rivalries in the settlement drag on every workplace.
    const rivalryDrag = clamp(
      1 - this.state.relationships.filter((relationship) => relationship.kind === "rivalry" && relationship.strength > 60).length * 0.015,
      0.75,
      1,
    );

    const basinQuality = this.averageWaterQuality();
    const habitatPenalty = 1 - Math.min(0.28, this.state.habitatStress * 0.012);
    this.state.resources.food = clamp(
      this.state.resources.food + farmOutput * 1.0 * farmFactor * farmPolicy * rivalryDrag * habitatPenalty - population * 0.022,
    );
    this.state.resources.water = clamp(
      this.state.resources.water
        + farmOutput * 0.58 * farmFactor * rivalryDrag * (0.65 + basinQuality / 280)
        - population * 0.014
        - this.state.habitatStress * 0.02,
    );
    this.state.marketShortages = marketShortages(this.state.buildings, this.state.resources.food);
    this.state.resources.warmth = clamp(
      this.state.resources.warmth + homeOutput * 0.55 - population * 0.012 + craftedResin * 0.18 + seasonalWarmth - seasonalDrain,
    );
    this.state.resources.light = clamp(
      this.state.resources.light + groveOutput * 0.72 * groveFactor * lanternPolicy - population * 0.009 + marketOutput * marketFactor * marketPolicy + craftedResin * 0.12 - seasonalDrain,
    );
    this.state.items.resin = Math.max(0, this.state.items.resin - craftedResin);
    // Resource security feeds metrics, and resources move every single tick.
    this.metricsDirty = true;
  }

  /**
   * Effective count of a building type: each building contributes its level
   * multiplier, scaled by the average relevant skill of its workers.
   */
  private weightedOutput(type: BuildingType, skill?: keyof Resident["skills"]): number {
    let total = 0;
    for (const building of this.state.buildings) {
      if (building.type !== type) continue;
      // Where a building sits now matters as much as what level it is.
      let contribution = (OUTPUT_MULTIPLIER[building.level] ?? 1) * this.adjacencyFor(building).multiplier;
      if (skill) {
        const workers = this.state.residents.filter((resident) => resident.workplaceId === building.id);
        if (workers.length > 0) {
          const average = workers.reduce((sum, resident) => sum + resident.skills[skill], 0) / workers.length;
          // Skill swings output between 85% and 130%.
          contribution *= 0.85 + (average / 100) * 0.45;
        }
      }
      total += contribution;
    }
    return total;
  }

  private updateResidents(dayRolled: boolean): void {
    const market = this.buildingByType.get("commons-market");
    const farm = this.buildingByType.get("reed-farm");
    const grove = this.buildingByType.get("lantern-grove");
    const overcrowding = Math.max(0, this.state.metrics.housingPressure - 0.9);
    const departed: Resident[] = [];

    for (const resident of this.state.residents) {
      if (dayRolled) {
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

      const mostPressing = this.getMostPressingNeed(resident);
      let goal: ResidentGoal = "work";
      let target: Vec2 | undefined = this.buildingIndex.get(resident.workplaceId)?.position;
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
        target = market.position;
        const shortage = this.state.marketShortages.find((entry) => entry.buildingId === market.id);
        explanation = shortage && shortage.pressure > 0.4
          ? "This market street is empty. I am hoping another stall still has food."
          : "Food is becoming uncertain, so I am heading toward the market.";
      } else if (mostPressing === "safety" && grove) {
        goal = "explore";
        target = grove.position;
        explanation = "The lanterns are bright enough to make a safe night route.";
      } else if (mostPressing === "shelter") {
        goal = "rest";
        target = this.buildingIndex.get(resident.homeId)?.position;
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
          target = market.position;
          explanation = "I have been alone too long; the Commons Market is where neighbors meet.";
        }
      } else if (resident.species === "mireling" && farm) {
        goal = "work";
        target = farm.position;
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
        if (goal === "forage") resident.needs.food = clamp(resident.needs.food + 5);
        if (goal === "rest") resident.needs.shelter = clamp(resident.needs.shelter + 6);
        if (goal === "socialize") resident.needs.belonging = clamp(resident.needs.belonging + 7);
        if (goal === "explore") {
          resident.needs.safety = clamp(resident.needs.safety + 3);
          resident.skills.scouting = clamp(resident.skills.scouting + 0.25);
        }
        if (goal === "work") {
          resident.needs.food = clamp(resident.needs.food + 1.5);
          resident.needs.belonging = clamp(resident.needs.belonging + 1);
          // Time on the job is how skill accrues.
          const workplace = this.buildingIndex.get(resident.workplaceId);
          const rate = resident.stage === "sprout" ? 0.4 : resident.stage === "elder" ? 0.12 : 0.22;
          if (workplace?.type === "reed-farm") resident.skills.farming = clamp(resident.skills.farming + rate);
          else if (workplace?.type === "root-workshop") resident.skills.crafting = clamp(resident.skills.crafting + rate);
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

    const { averageWellbeing, resourceSecurity, population } = this.state.metrics;
    const starving = Object.values(this.state.resources).filter((value) => value < 12).length;
    const previous = this.state.status;

    let status: SettlementStatus;
    if (population === 0) {
      status = "collapsed";
    } else if (starving >= 2 || averageWellbeing < 28) {
      status = "failing";
    } else if (starving >= 1 || averageWellbeing < 48 || resourceSecurity < 35) {
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
        this.addMessage(
          "CRISIS · The Commons is failing. Restore food, water, warmth, and light within four days or it will empty.",
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
    if (this.state.tick % WANT_INTERVAL !== 0) return;
    const candidates = this.state.residents.filter((resident) => !resident.want && resident.stage !== "sprout");
    if (candidates.length === 0) return;

    const resident = this.rng.pick(candidates);
    const kind = this.pickWantFor(resident);
    if (!kind) return;

    const home = this.buildingIndex.get(resident.homeId);
    const where = home ? `plot ${home.position.x + 1}:${home.position.y + 1}` : "the Commons";
    const description = describeWant(resident, kind, where);

    resident.want = {
      kind,
      description,
      createdDay: this.state.day,
      fulfilled: false,
    };
    this.addMessage(`REQUEST · ${description}`, "info");
  }

  /** Only offer a want the resident does not already have satisfied. */
  private pickWantFor(resident: Resident): WantKind | null {
    const home = this.buildingIndex.get(resident.homeId);
    const options = unmetWantKinds(resident, this.state.buildings, this.state.relationships, home);
    return options.length === 0 ? null : this.rng.pick(options);
  }

  private residentWantSatisfied(resident: Resident, kind: WantKind): boolean {
    return isWantSatisfied(
      resident,
      kind,
      this.state.buildings,
      this.state.relationships,
      this.buildingIndex.get(resident.homeId),
    );
  }

  /**
   * Resolves outstanding wants. Meeting one is a small, visible reward; letting
   * one sit unanswered slowly costs belonging, which is the pressure that makes
   * the request worth reading in the first place.
   */
  private updateWants(): void {
    for (const resident of this.state.residents) {
      const want = resident.want;
      if (!want || want.fulfilled) continue;

      if (this.residentWantSatisfied(resident, want.kind)) {
        want.fulfilled = true;
        resident.needs.belonging = clamp(resident.needs.belonging + 18);
        this.metricsDirty = true;
        this.addMessage(`REQUEST MET · ${resident.name} got their wish. The Commons feels a little kinder.`, "good");
        this.emit({ type: "want", position: resident.position, label: "♥", tone: "good" });
        // Clear it so the resident can want something else later.
        resident.want = undefined;
        continue;
      }

      if (this.state.day - want.createdDay > WANT_PATIENCE) {
        resident.needs.belonging = clamp(resident.needs.belonging - 0.06);
      }
    }
  }

  // --- Metrics ------------------------------------------------------------

  private updateMetrics(): void {
    if (!this.metricsDirty) return;
    this.state.metrics = this.calculateMetrics(this.state);
    this.metricsDirty = false;
  }

  private calculateMetrics(state: WorldState): SettlementMetrics {
    const population = state.residents.length;
    const housingCapacity = this.getHousingCapacity(state.buildings);
    const housingPressure = population / Math.max(1, housingCapacity);
    let needsTotal = 0;
    const speciesCounts: Record<Species, number> = { brambleback: 0, glowtail: 0, mireling: 0, cloudmoth: 0 };
    for (const resident of state.residents) {
      needsTotal += (resident.needs.shelter + resident.needs.food + resident.needs.safety + resident.needs.belonging) / 4;
      speciesCounts[resident.species] += 1;
    }
    const averageWellbeing = needsTotal / Math.max(1, population);
    const resourceSecurity = (state.resources.food + state.resources.water + state.resources.warmth + state.resources.light) / 4;
    const largestSpeciesShare = Math.max(speciesCounts.brambleback, speciesCounts.glowtail, speciesCounts.mireling, speciesCounts.cloudmoth, 0) / Math.max(1, population);
    const speciesMix = clamp(1 - largestSpeciesShare, 0, 1);
    const housingHealth = clamp(1 - Math.max(0, housingPressure - 0.75) / 0.5, 0, 1);
    const marketBonus = this.countBuildings("commons-market", state) > 0 ? 5 : 0;
    const districtBonus = state.districtFocus === "market" ? 3 : 0;
    const relationshipBalance = state.relationships.reduce((sum, relationship) => {
      const weight = relationship.kind === "rivalry" ? -1 : relationship.kind === "family" ? 1.3 : 1;
      return sum + weight * relationship.strength;
    }, 0) / Math.max(1, state.relationships.length);
    const relationshipBonus = clamp(relationshipBalance / 25, -4, 4);
    const harmony = clamp(
      averageWellbeing * 0.55
      + resourceSecurity * 0.15
      + speciesMix * 100 * 0.15
      + housingHealth * 100 * 0.1
      + marketBonus
      + districtBonus
      + relationshipBonus,
    );

    return {
      population,
      housingCapacity,
      housingAvailable: housingCapacity - population,
      housingPressure,
      averageWellbeing,
      harmony,
      resourceSecurity,
      activeBuildings: state.buildings.length,
    };
  }

  private checkResourceWarnings(): void {
    const actions: Record<ResourceKey, string> = {
      food: "Add a Reed Farm before the market runs dry.",
      water: "Add a Reed Farm to filter and replenish the basin.",
      warmth: "Build a Burrow Home or reduce the strain on existing shelter.",
      light: "Build a Lantern Grove before night routes become unsafe.",
    };

    for (const resource of Object.keys(this.state.resources) as ResourceKey[]) {
      const value = this.state.resources[resource];
      const previousLevel = this.resourceWarningLevels[resource];
      const nextLevel = this.getResourceWarningLevel(value);
      if (nextLevel > previousLevel) {
        this.addMessage(
          `ALERT · ${this.formatResource(resource)} stores are ${nextLevel === 2 ? "critical" : "low"} at ${Math.round(value)}. ${actions[resource]}`,
          "warning",
        );
      } else if (previousLevel > 0 && nextLevel === 0) {
        this.addMessage(`RECOVERY · ${this.formatResource(resource)} stores are stable at ${Math.round(value)}.`, "good");
      }
      this.resourceWarningLevels[resource] = nextLevel;
    }
  }

  private checkHousingPressure(): void {
    const nextBand = this.getHousingMessageBand(this.state.metrics.housingPressure);
    if (nextBand === this.housingMessageBand) return;

    const { population, housingCapacity } = this.state.metrics;
    if (nextBand === 2) {
      this.addMessage(
        `ALERT · Housing is over capacity at ${population}/${housingCapacity}. Build a Burrow Home before welcoming anyone else.`,
        "warning",
      );
    } else if (nextBand === 1) {
      this.addMessage(
        `SETTLEMENT · Housing is tight at ${population}/${housingCapacity}. A Burrow Home will make room for the next arrival.`,
        "info",
      );
    } else {
      this.addMessage(`RECOVERY · Housing has breathing room again at ${population}/${housingCapacity}.`, "good");
    }
    this.housingMessageBand = nextBand;
  }

  private getResourceWarningLevel(value: number): number {
    return value < 10 ? 2 : value < 25 ? 1 : 0;
  }

  private getHousingMessageBand(pressure: number): number {
    return pressure >= 1 ? 2 : pressure >= 0.88 ? 1 : 0;
  }

  private getMostPressingNeed(resident: Resident): keyof Resident["needs"] {
    const { shelter, food, safety, belonging } = resident.needs;
    let key: keyof Resident["needs"] = "food";
    let lowest = food;
    if (shelter < lowest) { lowest = shelter; key = "shelter"; }
    if (safety < lowest) { lowest = safety; key = "safety"; }
    if (belonging < lowest) { key = "belonging"; }
    return key;
  }

  // --- Movement -----------------------------------------------------------

  private pathContext(): PathContext {
    return {
      grid: this.state.grid,
      revealed: this.state.revealed,
      blocked: this.occupiedCells,
    };
  }

  /** Sets a target and recomputes the route only when the destination changed. */
  private setResidentTarget(resident: Resident, target: Vec2): void {
    if (resident.target && sameCell(resident.target, target) && resident.path.length > 0) return;
    resident.target = { x: target.x, y: target.y };
    if (sameCell(resident.position, target)) {
      resident.path = [];
      return;
    }
    resident.path = findPath(this.pathContext(), resident.position, target) ?? [];
  }

  /** Advances one tile along the resident's route, repathing if it has gone stale. */
  private stepAlongPath(resident: Resident): void {
    if (!resident.target) return;
    if (resident.path.length === 0) {
      if (sameCell(resident.position, resident.target)) return;
      resident.path = findPath(this.pathContext(), resident.position, resident.target) ?? [];
      if (resident.path.length === 0) return;
    }

    const next = resident.path[0]!;
    const tile = this.state.grid[next.y]?.[next.x];
    const isDestination = sameCell(next, resident.target);
    // The world can change under a resident mid-route (a new building, a
    // regrown node); repath rather than walking into it.
    if (!isDestination && (!isWalkable(tile) || this.occupiedCells.has(packCell(next.x, next.y, GRID_WIDTH)))) {
      resident.path = findPath(this.pathContext(), resident.position, resident.target) ?? [];
      return;
    }

    resident.path.shift();
    resident.position = { x: next.x, y: next.y };
  }

  private findWalkableNear(position: Vec2): Vec2 {
    if (isWalkable(this.state.grid[position.y]?.[position.x]) && this.isRevealed(position)) return position;
    for (let radius = 1; radius <= 4; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const candidate = { x: position.x + dx, y: position.y + dy };
          if (!this.isInside(candidate)) continue;
          if (!this.isRevealed(candidate)) continue;
          if (isWalkable(this.state.grid[candidate.y]?.[candidate.x])) return candidate;
        }
      }
    }
    return position;
  }

  private invalidateAllPaths(): void {
    for (const resident of this.state.residents) {
      resident.path = [];
    }
  }

  private reindexBuildings(): void {
    this.adjacencyCache.clear();
    this.adjacencyCacheTick = -1;
    this.buildingIndex = new Map(this.state.buildings.map((building) => [building.id, building]));
    this.buildingByType = new Map();
    this.occupiedCells = new Set();
    for (const building of this.state.buildings) {
      if (!this.buildingByType.has(building.type)) this.buildingByType.set(building.type, building);
      this.occupiedCells.add(packCell(building.position.x, building.position.y, GRID_WIDTH));
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
    this.state.proposal = nextProposal(this.state.day, this.state.chapter, nextProposalId++, this.state.residents);
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
    for (const resident of this.state.residents) {
      const delta = resident.species === species ? allyDelta : othersDelta;
      resident.needs.belonging = clamp(resident.needs.belonging + delta);
    }
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
    child.skills = { farming: 2, crafting: 2, scouting: 2 };
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
    this.addMessage(`BIRTH · ${child.name} arrived in ${parent.name}'s burrow.`, "good");
    this.emit({ type: "arrival", position: child.position, label: child.name, tone: "good" });
  }

  private maybeArriveCloudmoths(): void {
    if (this.state.cloudmothsArrived) return;
    const shade = this.state.season === "longshade" || this.state.chapter >= 2;
    if (!shade || this.state.metrics.harmony < 55) return;
    this.spawnCloudmoths(3);
  }

  private spawnCloudmoths(count: number): void {
    this.state.cloudmothsArrived = true;
    this.state.longShadeCrisis = this.state.season === "longshade";
    let spawned = 0;
    for (let index = 0; index < count; index += 1) {
      const resident = this.createResident(this.state.residents.length + index, this.state.buildings);
      if (!resident) continue;
      resident.species = "cloudmoth";
      resident.age = this.rng.int(8, 20);
      resident.stage = "adult";
      resident.lastDecisionExplanation = "We followed the last healthy roots.";
      this.state.residents.push(resident);
      spawned += 1;
    }
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
    return calculateLocalForecast(
      state,
      (type, world) => this.countBuildings(type, world),
      (world) => this.averageWaterQuality(world),
    );
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

  /** Objectives unlock one chapter at a time as the previous chapter completes. */
  private updateChapter(): void {
    const current = this.state.chapter;
    const chapterObjectives = this.state.objectives.filter((objective) => objective.chapter === current);
    if (chapterObjectives.length === 0) return;
    if (!chapterObjectives.every((objective) => objective.completed)) return;

    const nextChapter = current + 1;
    const hasNext = this.state.objectives.some((objective) => objective.chapter === nextChapter);
    if (!hasNext) return;

    this.state.chapter = nextChapter;
    this.addMessage(`CHAPTER · New work is open in the Commons ledger.`, "good");
  }

  public getActiveObjectives(): Objective[] {
    return this.state.objectives.filter((objective) => objective.chapter <= this.state.chapter);
  }

  private advanceObjectives(
    kind: Objective["kind"],
    tile?: CollectibleTile,
    building?: BuildingType,
    zone?: MapZoneKey,
    recipe?: RecipeKey,
  ): void {
    for (const objective of this.state.objectives) {
      if (objective.completed || objective.kind !== kind) continue;
      if (objective.chapter > this.state.chapter) continue;
      if (kind === "collect" && objective.tile && objective.tile !== tile) continue;
      if (kind === "build" && objective.building !== building) continue;
      if (kind === "upgrade" && objective.building && objective.building !== building) continue;
      if (kind === "expedition" && objective.zone !== zone) continue;
      if (kind === "craft" && objective.recipe !== recipe) continue;

      objective.progress = Math.min(objective.target, objective.progress + 1);
      if (objective.progress < objective.target) continue;

      this.completeObjective(objective);
    }
  }

  private completeObjective(objective: Objective): void {
    objective.completed = true;
    const rewardText = objective.rewardItem && objective.rewardAmount
      ? ` · reward +${objective.rewardAmount} ${ITEM_DEFINITIONS[objective.rewardItem].label}`
      : "";
    if (objective.rewardItem && objective.rewardAmount) {
      this.state.items[objective.rewardItem] += objective.rewardAmount;
    }
    this.addMessage(`OBJECTIVE · ${objective.title} complete${rewardText}.`, "good");
    this.emit({ type: "objective", label: objective.title, tone: "good" });
  }

  /** Threshold objectives are checked against live metrics rather than events. */
  private checkThresholdObjectives(): void {
    for (const objective of this.state.objectives) {
      if (objective.completed || objective.chapter > this.state.chapter) continue;
      if (objective.kind === "population") {
        objective.progress = Math.min(objective.target, this.state.metrics.population);
      } else if (objective.kind === "harmony") {
        objective.progress = Math.min(objective.target, Math.round(this.state.metrics.harmony));
      } else {
        continue;
      }
      if (objective.progress >= objective.target) this.completeObjective(objective);
    }
  }

  private countBuildings(type: BuildingType, state: WorldState = this.state): number {
    return state.buildings.filter((building) => building.type === type).length;
  }

  private getHousingCapacity(buildings: Building[]): number {
    let capacity = 0;
    for (const building of buildings) {
      // Upgraded homes house more; the Root scales too.
      const multiplier = OUTPUT_MULTIPLIER[building.level] ?? 1;
      if (building.type === "root-heart") capacity += BASE_HOUSING_CAPACITY * multiplier;
      else if (building.type === "burrow-home") capacity += HOME_HOUSING_CAPACITY * multiplier;
    }
    return Math.floor(capacity);
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
    return zone === "sunken-reach" ? "Sunken Reach" : "Old Hollow";
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
    return position.x >= 0 && position.x < GRID_WIDTH && position.y >= 0 && position.y < GRID_HEIGHT;
  }

  private isOccupied(position: Vec2): boolean {
    return this.occupiedCells.has(packCell(position.x, position.y, GRID_WIDTH));
  }

  private isRevealed(position: Vec2): boolean {
    return this.state.revealed[position.y]?.[position.x] ?? false;
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

export const SAVE_VERSION = 4;

export interface SavePayload {
  version: number;
  rngState: number;
  nextMessageId: number;
  nextResidentId: number;
  nextBuildingId: number;
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
  ];
}
