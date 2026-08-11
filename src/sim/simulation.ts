import {
  BUILDING_DEFINITIONS,
  DISTRICT_DEFINITIONS,
  EVENT_COPY,
  ITEM_DEFINITIONS,
  RECIPE_DEFINITIONS,
  SEASONAL_EVENT_DEFINITIONS,
} from "../data/definitions";
import type {
  Building,
  BuildingType,
  District,
  DistrictType,
  Expedition,
  Forecast,
  ItemKey,
  MapZoneKey,
  Message,
  Objective,
  RecipeKey,
  Resident,
  ResidentGoal,
  Relationship,
  RelationshipKind,
  ResourceKey,
  Season,
  SettlementMetrics,
  Species,
  TileKind,
  Vec2,
  WorldState,
} from "./types";

const GRID_WIDTH = 32;
const GRID_HEIGHT = 24;
const MAX_RESOURCE = 100;
const START_DAY = 8;
const TICKS_PER_DAY = 12;
const DAYS_PER_SEASON = 7;
const BASE_HOUSING_CAPACITY = 24;
const HOME_HOUSING_CAPACITY = 18;
const MAX_POPULATION = 50;
const ARRIVAL_INTERVAL = TICKS_PER_DAY * 3;
const SEASONS: Season[] = ["mosswake", "suncrest", "emberfall", "longshade"];
type CollectibleTile = "fern" | "mushroom" | "crystal" | "ruin";

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

class SeededRandom {
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
}

const speciesOrder: Species[] = ["brambleback", "glowtail", "mireling"];

const names = [
  "Pip", "Mallow", "Tallow", "Nix", "Pebble", "Lumen", "Sedge", "Bramble", "Clover", "Moss",
  "Dapple", "Wick", "Thimble", "Fennel", "Puddle", "Rook", "Juniper", "Mica", "Nettle", "Biscuit",
];

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const sameCell = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

export class MosslightSimulation {
  readonly state: WorldState;
  private readonly rng: SeededRandom;
  private nextMessageId = 1;
  private nextResidentId = 1;
  private nextBuildingId = 1;
  private localForecast: Forecast | undefined;
  private readonly resourceWarningLevels: Record<ResourceKey, number> = {
    food: 0,
    water: 0,
    warmth: 0,
    light: 0,
  };
  private housingMessageBand = 0;

  constructor(seed = 20260811) {
    this.rng = new SeededRandom(seed);
    this.state = this.createInitialState(seed);
    this.localForecast = this.state.forecast;
    for (const resource of Object.keys(this.state.resources) as ResourceKey[]) {
      this.resourceWarningLevels[resource] = this.getResourceWarningLevel(this.state.resources[resource]);
    }
    this.housingMessageBand = this.getHousingMessageBand(this.state.metrics.housingPressure);
  }

  public advance(): void {
    if (this.state.paused) return;
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

  public setBuildMode(type: Exclude<BuildingType, "root-heart"> | null): void {
    this.state.buildMode = type;
  }

  public setDistrictFocus(type: DistrictType): void {
    if (!this.state.districts.some((district) => district.type === type)) return;
    this.state.districtFocus = type;
    const district = this.state.districts.find((candidate) => candidate.type === type);
    this.addMessage(`DISTRICT · ${district?.label ?? type} is now the Commons focus.`, "info");
    this.updateMetrics();
    this.updateForecast();
  }

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

    const duration = Math.max(4, 6 - (this.state.districtFocus === "ruin" ? 1 : 0));
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
    leader.target = expedition.target;
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
    this.state.crafting = {
      id: `craft-${this.state.tick}-${recipe}`,
      recipe,
      progress: 0,
      duration: definition.duration,
    };
    this.addMessage(`CRAFT · ${definition.label} is on the Root Workshop bench.`, "good");
    return true;
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
    for (const [resource, amount] of Object.entries(definition.cost)) {
      if ((this.state.resources[resource as keyof typeof this.state.resources] ?? 0) < (amount ?? 0)) {
        const key = resource as ResourceKey;
        const available = Math.floor(this.state.resources[key]);
        this.addMessage(
          `BUILD BLOCKED · ${definition.label} needs ${amount ?? 0} ${this.formatResource(key)}; stores hold ${available}.`,
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
      const key = resource as keyof typeof this.state.resources;
      this.state.resources[key] -= amount ?? 0;
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
    };
    this.state.buildings.push(building);
    this.state.buildMode = null;
    this.advanceObjectives("build", undefined, type);
    this.updateMetrics();
    const capacityNote = type === "burrow-home"
      ? ` · housing ${this.state.metrics.population}/${this.state.metrics.housingCapacity}`
      : "";
    this.addMessage(`BUILD · ${definition.label} is ready${capacityNote}.`, "good");
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
    this.state.items[reward.item] += itemAmount;
    if (reward.resource && reward.resourceAmount) {
      this.state.resources[reward.resource] = clamp(
        this.state.resources[reward.resource] + reward.resourceAmount,
      );
    }
    this.advanceObjectives("collect", tile);
    this.updateMetrics();
    this.addMessage(
      `GATHER · ${this.formatCollectibleTile(tile)} → +${itemAmount} ${ITEM_DEFINITIONS[reward.item].label}${
        reward.resource ? ` · +${reward.resourceAmount} ${this.formatResource(reward.resource)}` : ""
      }.`,
      "good",
    );
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
    const isLocalFallback = source === "local"
      && this.state.forecastSource === "torx-thrml"
      && forecast === this.state.forecast;
    this.state.forecast = isLocalFallback && this.localForecast ? this.localForecast : forecast;
    this.state.forecastSource = source;
    if (source === "torx-thrml" && this.state.forecast.title !== previousTitle) {
      this.addMessage(
        `FORECAST · TORX+THRML sees ${this.state.forecast.title} at ${Math.round(this.state.forecast.probability * 100)}% for ${this.state.forecast.window}.`,
        this.state.forecast.tone === "warning" ? "warning" : "info",
      );
    }
  }

  private createInitialState(seed: number): WorldState {
    const grid = this.createGrid();
    const buildings: Building[] = [
      { id: "root-heart", type: "root-heart", position: { x: 16, y: 6 }, level: 1 },
      { id: "burrow-home-0", type: "burrow-home", position: { x: 11, y: 10 }, level: 1 },
      { id: "reed-farm-0", type: "reed-farm", position: { x: 7, y: 17 }, level: 1 },
      { id: "lantern-grove-0", type: "lantern-grove", position: { x: 23, y: 9 }, level: 1 },
      { id: "commons-market-0", type: "commons-market", position: { x: 17, y: 12 }, level: 1 },
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
      buildings,
      residents,
      districts,
      districtFocus: "market",
      relationships: this.createRelationships(residents),
      expeditions: [],
      seasonalEvent: this.createSeasonalEvent("mosswake"),
      crafting: null,
      crafted: { "lantern-kit": 0, "bridge-kit": 0, "comfort-kit": 0 },
      objectives: [
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
        },
      ],
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
      selectedResidentId: residents[0]?.id ?? "",
      buildMode: null,
      paused: false,
      speed: 1,
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
        const stone = (x * 17 + y * 13) % 29 === 0;
        row.push(lowerWetland || sidePool ? "water" : stone ? "stone" : "grass");
      }
      grid.push(row);
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
    for (let index = 0; index < residents.length - 1; index += 3) {
      const first = residents[index];
      const second = residents[index + 1];
      if (!first || !second) continue;
      const kind: RelationshipKind = first.species === second.species
        ? "kinship"
        : this.rng.next() > 0.18 ? "friendship" : "rivalry";
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
    const work = species === "brambleback" ? home : species === "glowtail" ? grove : farm;
    const offset = { x: (index % 5) - 2, y: Math.floor(index / 5) % 3 - 1 };
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
      goal: index % 3 === 0 ? "work" : "socialize",
      target: index % 3 === 0 ? work.position : market.position,
      lastDecisionExplanation: "Settling into a new neighborhood.",
    };
  }

  private tickOnce(): void {
    this.state.tick += 1;
    this.state.day = START_DAY + Math.floor(this.state.tick / TICKS_PER_DAY);
    const elapsedSeasonDays = this.state.day - START_DAY;
    const previousSeason = this.state.season;
    this.state.season = SEASONS[Math.floor(elapsedSeasonDays / DAYS_PER_SEASON) % SEASONS.length]!;
    this.state.seasonDay = (elapsedSeasonDays % DAYS_PER_SEASON) + 1;
    const phaseIndex = this.state.tick % TICKS_PER_DAY;
    this.state.phase = phaseIndex < 2 ? "dawn" : phaseIndex < 7 ? "day" : phaseIndex < 10 ? "dusk" : "night";

    this.updateSeasonalEvent(previousSeason);
    this.updateExpeditions();
    this.updateCrafting();
    this.updateResources();
    this.updateMetrics();
    this.updateResidents();
    this.updateMetrics();
    this.updateRelationships();
    this.maybeWelcomeResident();
    this.updateMetrics();
    this.checkResourceWarnings();
    this.checkHousingPressure();
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

  private updateExpeditions(): void {
    for (const expedition of this.state.expeditions) {
      if (expedition.status !== "active") continue;
      expedition.progress = Math.min(expedition.duration, expedition.progress + 1);
      const leader = this.state.residents.find((resident) => resident.id === expedition.leaderId);
      if (leader) this.moveOneStep(leader, expedition.target);
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
    this.advanceObjectives("craft", undefined, undefined, undefined, order.recipe);
    this.addMessage(`CRAFT · ${definition.label} is complete. ${definition.description}`, "good");
  }

  private updateRelationships(): void {
    if (this.state.tick % 4 !== 0) return;
    for (const relationship of this.state.relationships) {
      const first = this.state.residents.find((resident) => resident.id === relationship.aId);
      const second = this.state.residents.find((resident) => resident.id === relationship.bId);
      if (!first || !second) continue;
      const nearby = manhattan(first.position, second.position) <= 3;
      const focusBonus = this.state.districtFocus === "market" && nearby ? 1.4 : 0;
      const delta = nearby ? 1.2 + focusBonus : -0.08;
      relationship.strength = clamp(
        relationship.strength + (relationship.kind === "rivalry" ? -delta : delta),
        8,
        96,
      );
      if (nearby) relationship.sharedDays += 1;
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
  }

  private updateResources(): void {
    const farms = this.countBuildings("reed-farm");
    const homes = this.countBuildings("burrow-home");
    const groves = this.countBuildings("lantern-grove");
    const markets = this.countBuildings("commons-market");
    const workshops = this.countBuildings("root-workshop");
    const population = this.state.residents.length;
    const craftedResin = Math.min(workshops, this.state.items.resin);
    const farmFactor = this.state.districtFocus === "wetland" ? 1.2 : 1;
    const groveFactor = this.state.districtFocus === "lantern" ? 1.2 : 1;
    const marketFactor = this.state.seasonalEvent.effect === "festival" ? 0.16 : 0.06;
    const seasonalWarmth = this.state.seasonalEvent.effect === "bloom" ? 0.25 : 0;
    const seasonalDrain = this.state.seasonalEvent.effect === "watch" ? 0.18 : 0;

    this.state.resources.food = clamp(this.state.resources.food + farms * 1.0 * farmFactor - population * 0.022);
    this.state.resources.water = clamp(this.state.resources.water + farms * 0.58 * farmFactor - population * 0.014);
    this.state.resources.warmth = clamp(this.state.resources.warmth + homes * 0.55 - population * 0.012 + craftedResin * 0.18 + seasonalWarmth - seasonalDrain);
    this.state.resources.light = clamp(this.state.resources.light + groves * 0.72 * groveFactor - population * 0.009 + markets * marketFactor + craftedResin * 0.12 - seasonalDrain);
    this.state.items.resin = Math.max(0, this.state.items.resin - craftedResin);
  }

  private updateResidents(): void {
    const market = this.findBuilding("commons-market");
    const farm = this.findBuilding("reed-farm");
    const grove = this.findBuilding("lantern-grove");
    const overcrowding = Math.max(0, this.state.metrics.housingPressure - 0.9);

    for (const resident of this.state.residents) {
      resident.needs.food = clamp(resident.needs.food - (this.state.resources.food < 25 ? 1.1 : 0.55));
      resident.needs.shelter = clamp(resident.needs.shelter - (this.state.resources.warmth < 20 ? 0.9 : 0.3) - overcrowding * 0.8);
      resident.needs.safety = clamp(resident.needs.safety - (this.state.resources.light < 20 ? 0.7 : 0.2));
      resident.needs.belonging = clamp(resident.needs.belonging - (this.state.phase === "night" ? 0.25 : 0.1) - overcrowding * 0.2);

      const activeExpedition = this.state.expeditions.find(
        (expedition) => expedition.status === "active" && expedition.leaderId === resident.id,
      );
      if (activeExpedition) {
        resident.goal = "explore";
        resident.target = activeExpedition.target;
        resident.lastDecisionExplanation = `Leading ${activeExpedition.title.toLowerCase()} · ${activeExpedition.progress}/${activeExpedition.duration} route steps.`;
        continue;
      }

      const mostPressing = this.getMostPressingNeed(resident);
      let goal: ResidentGoal = "work";
      let target: Vec2 | undefined = this.findBuilding(resident.workplaceId)?.position;
      let explanation = "Following a familiar routine.";

      if (mostPressing === "food" && market) {
        goal = "forage";
        target = market.position;
        explanation = "Food is becoming uncertain, so I am heading toward the market.";
      } else if (mostPressing === "safety" && grove) {
        goal = "explore";
        target = grove.position;
        explanation = "The lanterns are bright enough to make a safe night route.";
      } else if (mostPressing === "shelter") {
        goal = "rest";
        target = this.findBuilding(resident.homeId)?.position;
        explanation = "Warmth is low; home is the best place to recover.";
      } else if (mostPressing === "belonging" && market) {
        goal = "socialize";
        target = market.position;
        explanation = "I have been alone too long; the Commons Market is where neighbors meet.";
      } else if (resident.species === "mireling" && farm) {
        goal = "work";
        target = farm.position;
        explanation = "The reeds need tending before the water changes.";
      } else if (resident.traits.curiosity > 0.7 && this.rng.next() > resident.traits.routine) {
        goal = "explore";
        target = { x: this.rng.int(4, 28), y: this.rng.int(5, 20) };
        explanation = "A new path appeared on the edge of the neighborhood.";
      }

      resident.goal = goal;
      resident.target = target;
      resident.lastDecisionExplanation = explanation;
      if (target) this.moveOneStep(resident, target);

      if (target && sameCell(resident.position, target)) {
        if (goal === "forage") resident.needs.food = clamp(resident.needs.food + 5);
        if (goal === "rest") resident.needs.shelter = clamp(resident.needs.shelter + 6);
        if (goal === "socialize") resident.needs.belonging = clamp(resident.needs.belonging + 7);
        if (goal === "explore") resident.needs.safety = clamp(resident.needs.safety + 3);
        if (goal === "work") {
          resident.needs.food = clamp(resident.needs.food + 1.5);
          resident.needs.belonging = clamp(resident.needs.belonging + 1);
        }
      }
    }
  }

  private maybeWelcomeResident(): void {
    if (this.state.tick % ARRIVAL_INTERVAL !== 0) return;
    if (this.state.residents.length >= MAX_POPULATION) return;
    if (this.state.metrics.population >= this.state.metrics.housingCapacity) return;
    if (this.state.metrics.averageWellbeing < 57 || this.state.metrics.resourceSecurity < 42) return;
    if (Math.min(...Object.values(this.state.resources)) < 30) return;

    const resident = this.createResident(this.state.residents.length, this.state.buildings);
    if (!resident) return;
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
    this.updateMetrics();
    this.addMessage(
      `ARRIVAL · ${resident.name} joined the Commons · ${this.state.metrics.population}/${this.state.metrics.housingCapacity} housed.`,
      "good",
    );
  }

  private updateMetrics(): void {
    this.state.metrics = this.calculateMetrics(this.state);
  }

  private calculateMetrics(state: WorldState): SettlementMetrics {
    const population = state.residents.length;
    const housingCapacity = this.getHousingCapacity(state.buildings);
    const housingPressure = population / Math.max(1, housingCapacity);
    const averageWellbeing = state.residents.reduce((sum, resident) => {
      return sum + Object.values(resident.needs).reduce((inner, need) => inner + need, 0) / 4;
    }, 0) / Math.max(1, population);
    const resourceSecurity = Object.values(state.resources).reduce((sum, resource) => sum + resource, 0) / 4;
    const speciesCounts = speciesOrder.map((species) => state.residents.filter((resident) => resident.species === species).length);
    const largestSpeciesShare = Math.max(...speciesCounts, 0) / Math.max(1, population);
    const speciesMix = clamp(1 - largestSpeciesShare, 0, 1);
    const housingHealth = clamp(1 - Math.max(0, housingPressure - 0.75) / 0.5, 0, 1);
    const marketBonus = this.countBuildings("commons-market", state) > 0 ? 5 : 0;
    const districtBonus = state.districtFocus === "market" ? 3 : 0;
    const relationshipBalance = state.relationships.reduce((sum, relationship) => {
      return sum + (relationship.kind === "rivalry" ? -relationship.strength : relationship.strength);
    }, 0) / Math.max(1, state.relationships.length);
    const relationshipBonus = clamp(relationshipBalance / 25, -3, 3);
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
    return (Object.entries(resident.needs).sort(([, first], [, second]) => first - second)[0]?.[0] ?? "food") as keyof Resident["needs"];
  }

  private moveOneStep(resident: Resident, target: Vec2): void {
    const dx = Math.sign(target.x - resident.position.x);
    const dy = Math.sign(target.y - resident.position.y);
    if (Math.abs(target.x - resident.position.x) >= Math.abs(target.y - resident.position.y)) {
      resident.position.x = clampCell(resident.position.x + dx, 1, GRID_WIDTH - 2);
    } else {
      resident.position.y = clampCell(resident.position.y + dy, 1, GRID_HEIGHT - 2);
    }
  }

  private updateForecast(): void {
    const localForecast = this.calculateLocalForecast();
    this.localForecast = localForecast;

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
    const foodPressure = clamp(1 - state.resources.food / MAX_RESOURCE, 0, 1);
    const waterPressure = clamp(1 - state.resources.water / MAX_RESOURCE, 0, 1);
    const lightStrength = clamp(state.resources.light / MAX_RESOURCE, 0, 1);
    const harmony = this.calculateHarmony(state);
    const housingPressure = Math.max(0, state.metrics.housingPressure - 0.9);
    const seasonNote = `${this.formatSeason(state.season)} ${state.seasonDay}/${DAYS_PER_SEASON}`;
    const housingNote = `${state.metrics.population}/${state.metrics.housingCapacity} housed`;

    const candidates: Forecast[] = [
      {
        ...EVENT_COPY.emptyShelves,
        probability: clamp(0.08 + foodPressure * 0.62 + housingPressure * 0.12, 0.05, 0.94),
        window: "next 2 days",
        drivers: [
          `${state.resources.food.toFixed(0)} food in stores`,
          `${this.countBuildings("reed-farm", state)} active Reed Farms for ${state.metrics.population} residents`,
          `${seasonNote} · ${housingNote}`,
        ],
      },
      {
        ...EVENT_COPY.lanternFestival,
        probability: clamp(0.12 + lightStrength * 0.42 + harmony * 0.22 + (this.countBuildings("commons-market", state) > 0 ? 0.05 : 0), 0.05, 0.94),
        window: "next 3 days",
        drivers: [
          `${state.resources.light.toFixed(0)} light in the Commons`,
          `harmony ${Math.round(state.metrics.harmony)}% · ${housingNote}`,
          `${seasonNote} · ${this.countBuildings("commons-market", state)} market gathering point`,
        ],
      },
      {
        ...EVENT_COPY.reedWarning,
        probability: clamp(0.08 + waterPressure * 0.58, 0.05, 0.94),
        window: "next 2 days",
        drivers: [
          `${state.resources.water.toFixed(0)} water in the basin`,
          `${this.countBuildings("reed-farm", state)} Reed Farms filtering wetland plots`,
          `resource security ${Math.round(state.metrics.resourceSecurity)}% · Mireling health is sensitive`,
        ],
      },
      {
        ...EVENT_COPY.unmappedBurrow,
        probability: clamp(0.08 + state.residents.filter((resident) => resident.species === "brambleback").length / 180, 0.05, 0.94),
        window: "this week",
        drivers: [
          `${state.residents.filter((resident) => resident.species === "brambleback").length} Bramblebacks are exploring`,
          `${Math.max(0, state.metrics.housingAvailable)} open housing spaces`,
          `${seasonNote} · open ground remains nearby`,
        ],
      },
    ];

    const selected = candidates.sort((first, second) => second.probability - first.probability)[0]!;
    return {
      ...selected,
      probability: Math.min(0.94, selected.probability),
    };
  }

  private calculateHarmony(state: WorldState = this.state): number {
    const metrics = state === this.state ? state.metrics : this.calculateMetrics(state);
    return metrics.harmony / 100;
  }

  private addMessage(text: string, tone: Message["tone"], state = this.state): void {
    state.messages.unshift({ id: this.nextMessageId++, text, tone });
    state.messages = state.messages.slice(0, 5);
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
      if (kind === "collect" && objective.tile && objective.tile !== tile) continue;
      if (kind === "build" && objective.building !== building) continue;
      if (kind === "expedition" && objective.zone !== zone) continue;
      if (kind === "craft" && objective.recipe !== recipe) continue;

      objective.progress = Math.min(objective.target, objective.progress + 1);
      if (objective.progress < objective.target) continue;

      objective.completed = true;
      const rewardText = objective.rewardItem && objective.rewardAmount
        ? ` · reward +${objective.rewardAmount} ${ITEM_DEFINITIONS[objective.rewardItem].label}`
        : "";
      if (objective.rewardItem && objective.rewardAmount) {
        this.state.items[objective.rewardItem] += objective.rewardAmount;
      }
      this.addMessage(`OBJECTIVE · ${objective.title} complete${rewardText}.`, "good");
    }
  }

  private countBuildings(type: BuildingType, state: WorldState = this.state): number {
    return state.buildings.filter((building) => building.type === type).length;
  }

  private findBuilding(idOrType: string): Building | undefined {
    return this.state.buildings.find((building) => building.id === idOrType || building.type === idOrType);
  }

  private getHousingCapacity(buildings: Building[]): number {
    const roots = buildings.filter((building) => building.type === "root-heart").length;
    const homes = buildings.filter((building) => building.type === "burrow-home").length;
    return roots * BASE_HOUSING_CAPACITY + homes * HOME_HOUSING_CAPACITY;
  }

  private formatResource(resource: ResourceKey): string {
    return resource.charAt(0).toUpperCase() + resource.slice(1);
  }

  private formatItem(item: ItemKey): string {
    return ITEM_DEFINITIONS[item].label;
  }

  private formatCollectibleTile(tile: CollectibleTile): string {
    return {
      fern: "Fern Patch",
      mushroom: "Ember Mushroom",
      crystal: "Moon Crystal",
      ruin: "Root Ruin",
    }[tile];
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
    return this.state.buildings.some((building) => sameCell(building.position, position));
  }

  private isRevealed(position: Vec2): boolean {
    return this.state.revealed[position.y]?.[position.x] ?? false;
  }

  private isCollectibleTile(tile: TileKind): tile is CollectibleTile {
    return tile === "fern" || tile === "mushroom" || tile === "crystal" || tile === "ruin";
  }
}

function clampCell(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
