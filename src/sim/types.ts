export type Species = "brambleback" | "glowtail" | "mireling";

export type ResourceKey = "food" | "water" | "warmth" | "light";

export type ItemKey = "seed-pod" | "resin" | "moonwater" | "map-fragment";

export type DistrictType = "meadow" | "wetland" | "lantern" | "market" | "ruin";

export type RecipeKey = "lantern-kit" | "bridge-kit" | "comfort-kit";

export type RelationshipKind = "friendship" | "rivalry" | "kinship";

export type ExpeditionStatus = "active" | "complete";

export type MapZoneKey = "sunken-reach" | "old-hollow";

export type TileKind =
  | "grass"
  | "water"
  | "wetland"
  | "path"
  | "stone"
  | "fern"
  | "mushroom"
  | "crystal"
  | "ruin";

export type BuildingType =
  | "root-heart"
  | "burrow-home"
  | "reed-farm"
  | "lantern-grove"
  | "commons-market"
  | "root-workshop";

export type ResidentGoal = "rest" | "forage" | "work" | "socialize" | "explore";

export type Season = "mosswake" | "suncrest" | "emberfall" | "longshade";

export type ObjectiveKind = "collect" | "build" | "expedition" | "craft";

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

export interface Resident {
  id: string;
  name: string;
  species: Species;
  position: Vec2;
  homeId: string;
  workplaceId: string;
  needs: Needs;
  traits: Traits;
  goal: ResidentGoal;
  target?: Vec2;
  lastDecisionExplanation: string;
}

export interface Building {
  id: string;
  type: BuildingType;
  position: Vec2;
  level: number;
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
  tile?: "fern" | "mushroom" | "crystal" | "ruin";
  building?: BuildingType;
  zone?: MapZoneKey;
  recipe?: RecipeKey;
  rewardItem?: ItemKey;
  rewardAmount?: number;
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
  metrics: SettlementMetrics;
  forecast: Forecast;
  forecastSource: "local" | "torx-thrml";
  messages: Message[];
  selectedResidentId: string;
  buildMode: Exclude<BuildingType, "root-heart"> | null;
  paused: boolean;
  speed: 1 | 2 | 4;
}
