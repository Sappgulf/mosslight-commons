export type Species = "brambleback" | "glowtail" | "mireling" | "cloudmoth";

export type ResourceKey = "food" | "water" | "warmth" | "light";

export type ItemKey = "seed-pod" | "resin" | "moonwater" | "map-fragment";

export type DistrictType = "meadow" | "wetland" | "lantern" | "market" | "ruin";

export type RecipeKey = "lantern-kit" | "bridge-kit" | "comfort-kit";

export type RelationshipKind = "friendship" | "rivalry" | "kinship" | "family";

export type ExpeditionStatus = "active" | "complete";

export type MapZoneKey = "sunken-reach" | "old-hollow";

export type CollectibleTile = "fern" | "mushroom" | "crystal" | "ruin";

export type TileKind =
  | "grass"
  | "water"
  | "wetland"
  | "path"
  | "stone"
  | CollectibleTile;

export type BuildingType =
  | "root-heart"
  | "burrow-home"
  | "reed-farm"
  | "lantern-grove"
  | "commons-market"
  | "root-workshop";

/** Tools the player can hold. Paths are a terrain verb, not a building. */
export type BuildTool = Exclude<BuildingType, "root-heart"> | "path";

export type ProposalKind = "shelter-first" | "wetland-first" | "market-first" | "lantern-first" | "welcome-moths";

export interface CouncilProposal {
  id: string;
  kind: ProposalKind;
  title: string;
  body: string;
  species: Species;
  status: "pending" | "approved" | "rejected";
  createdDay: number;
}

export interface MarketShortage {
  buildingId: string;
  pressure: number;
}

export type ResidentGoal = "rest" | "forage" | "work" | "socialize" | "explore";

export type Season = "mosswake" | "suncrest" | "emberfall" | "longshade";

export type ObjectiveKind = "collect" | "build" | "expedition" | "craft" | "upgrade" | "population" | "harmony";

export type LifeStage = "sprout" | "adult" | "elder";

export type WantKind = "lantern" | "neighbour" | "market" | "quiet" | "company";

/**
 * A named personal desire. Wants are what stop forty residents from being forty
 * copies of the same four need bars — they give individuals something the
 * player can actually do for them, and they generate the settlement's stories.
 */
export interface Want {
  kind: WantKind;
  description: string;
  /** Day the want appeared, used for patience and for ledger copy. */
  createdDay: number;
  fulfilled: boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Needs {
  shelter: number;
  food: number;
  safety: number;
  belonging: number;
}

export interface Traits {
  curiosity: number;
  sociability: number;
  routine: number;
  resilience: number;
}

/** Work skill improves with time on the job and raises a resident's output. */
export interface Skills {
  farming: number;
  crafting: number;
  scouting: number;
}

export interface Resident {
  id: string;
  name: string;
  species: Species;
  position: Vec2;
  homeId: string;
  workplaceId: string;
  needs: Needs;
  traits: Traits;
  skills: Skills;
  goal: ResidentGoal;
  target?: Vec2;
  /** Remaining A* route to `target`, recomputed only when the target changes. */
  path: Vec2[];
  lastDecisionExplanation: string;
  /** Days lived in the Commons. Drives life stage. */
  age: number;
  stage: LifeStage;
  /** Consecutive ticks with a critical need. At the threshold the resident leaves. */
  distress: number;
  /** The resident's current personal request, if any. */
  want?: Want;
}

export interface Building {
  id: string;
  type: BuildingType;
  position: Vec2;
  level: number;
  /** Accumulated ticks toward the next level, when an upgrade is in progress. */
  upgradeProgress: number;
  upgrading: boolean;
}

export interface Forecast {
  title: string;
  probability: number;
  window: string;
  drivers: string[];
  recommendation: string;
  tone: "calm" | "bright" | "warning";
}

export interface Message {
  id: number;
  text: string;
  tone: "info" | "good" | "warning";
  day: number;
}

export interface SettlementMetrics {
  population: number;
  housingCapacity: number;
  housingAvailable: number;
  housingPressure: number;
  averageWellbeing: number;
  harmony: number;
  resourceSecurity: number;
  activeBuildings: number;
}

export interface Objective {
  id: string;
  title: string;
  description: string;
  kind: ObjectiveKind;
  target: number;
  progress: number;
  completed: boolean;
  tile?: CollectibleTile;
  building?: BuildingType;
  zone?: MapZoneKey;
  recipe?: RecipeKey;
  rewardItem?: ItemKey;
  rewardAmount?: number;
  /** Chapter index; objectives unlock a chapter at a time. */
  chapter: number;
}

export interface District {
  id: string;
  type: DistrictType;
  label: string;
  center: Vec2;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  description: string;
  bonus: string;
}

export interface Relationship {
  id: string;
  aId: string;
  bId: string;
  kind: RelationshipKind;
  strength: number;
  sharedDays: number;
}

export interface Expedition {
  id: string;
  leaderId: string;
  target: Vec2;
  zone: MapZoneKey;
  title: string;
  progress: number;
  duration: number;
  status: ExpeditionStatus;
  rewardItem: ItemKey;
  rewardAmount: number;
}

export interface SeasonalEvent {
  id: string;
  title: string;
  season: Season;
  description: string;
  effect: "growth" | "festival" | "bloom" | "watch";
  daysRemaining: number;
  tone: "calm" | "bright" | "warning";
}

export interface CraftingOrder {
  id: string;
  recipe: RecipeKey;
  progress: number;
  duration: number;
}

/** A depleted wild node regrowing on a timer. */
export interface Regrowth {
  x: number;
  y: number;
  tile: CollectibleTile;
  ticksRemaining: number;
  totalTicks: number;
}

export type SettlementStatus = "thriving" | "strained" | "failing" | "collapsed";

export interface WorldState {
  seed: number;
  tick: number;
  day: number;
  season: Season;
  seasonDay: number;
  phase: "dawn" | "day" | "dusk" | "night";
  grid: TileKind[][];
  resources: Record<ResourceKey, number>;
  items: Record<ItemKey, number>;
  revealed: boolean[][];
  revealedAreas: MapZoneKey[];
  regrowth: Regrowth[];
  buildings: Building[];
  residents: Resident[];
  districts: District[];
  districtFocus: DistrictType;
  relationships: Relationship[];
  expeditions: Expedition[];
  seasonalEvent: SeasonalEvent;
  crafting: CraftingOrder | null;
  crafted: Record<RecipeKey, number>;
  objectives: Objective[];
  chapter: number;
  metrics: SettlementMetrics;
  forecast: Forecast;
  forecastSource: "local" | "torx-thrml";
  messages: Message[];
  /** Full ledger history, newest first, capped for memory. */
  history: Message[];
  selectedResidentId: string;
  buildMode: BuildTool | null;
  paused: boolean;
  speed: 1 | 2 | 4;
  status: SettlementStatus;
  /** Ticks spent in a failing state; at the limit the settlement collapses. */
  collapseTimer: number;
  departures: number;
  onboardingStep: number;
  onboardingDismissed: boolean;
  /** Per-tile water cleanliness 0–100. Farms stain it; wetlands restore it. */
  waterQuality: number[][];
  /** Derived civic stain from lanterns and farms sitting on wild ground. */
  habitatStress: number;
  births: number;
  cloudmothsArrived: boolean;
  longShadeCrisis: boolean;
  proposal: CouncilProposal | null;
  forecastHistory: Forecast[];
  forecastCursor: number;
  marketShortages: MarketShortage[];
  titleSeen: boolean;
}
