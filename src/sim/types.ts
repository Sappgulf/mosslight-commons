export type Species = "brambleback" | "glowtail" | "mireling" | "cloudmoth";

export type ResourceKey = "food" | "water" | "warmth" | "light";

export type ItemKey = "seed-pod" | "resin" | "moonwater" | "map-fragment";

export type DistrictType = "meadow" | "wetland" | "lantern" | "market" | "ruin";

export type RecipeKey = "lantern-kit" | "bridge-kit" | "comfort-kit" | "sky-lantern";

export type RelationshipKind = "friendship" | "rivalry" | "kinship" | "family";

export type ExpeditionStatus = "active" | "complete";

export type MapZoneKey = "sunken-reach" | "old-hollow" | "canopy-rift";

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
  | "root-workshop"
  | "sky-walk";

/** Tools the player can hold. Paths are a terrain verb, not a building. */
export type BuildTool = Exclude<BuildingType, "root-heart"> | "path";

export type ProposalKind = "shelter-first" | "wetland-first" | "market-first" | "lantern-first" | "welcome-moths";

export interface SpeciesVote {
  species: Species;
  stance: "for" | "against" | "split";
  weight: number;
}

export interface CouncilProposal {
  id: string;
  kind: ProposalKind;
  title: string;
  body: string;
  species: Species;
  status: "pending" | "approved" | "rejected" | "expired";
  createdDay: number;
  deadlineDay: number;
  votes: SpeciesVote[];
}

export interface ActivePolicy {
  kind: ProposalKind;
  daysRemaining: number;
  label: string;
}

export type LongShadeOutcome = "pending" | "thrived" | "strained" | "failed";

export interface MarketShortage {
  buildingId: string;
  pressure: number;
}

export type ResidentGoal = "rest" | "forage" | "work" | "socialize" | "explore";

export type Season = "mosswake" | "suncrest" | "emberfall" | "longshade";

export type ObjectiveKind = "collect" | "build" | "expedition" | "craft" | "upgrade" | "population" | "harmony" | "tradition";

export type LifeStage = "sprout" | "adult" | "elder";

export type WantKind = "lantern" | "neighbour" | "market" | "quiet" | "company" | "sky";

/**
 * A named personal desire. Wants are what stop forty residents from being forty
 * copies of the same four need bars — they give individuals something the
 * player can actually do for them, and they generate the settlement's stories.
 */
/**
 * A resident's personal request, and the closest thing the Commons has to a
 * quest. A want now carries a deadline and a payout, so answering one is a
 * decision with a return rather than a line of flavour text.
 */
export interface Want {
  kind: WantKind;
  description: string;
  /** Day the want appeared, used for patience and for ledger copy. */
  createdDay: number;
  /** Day the request lapses. Missing it costs standing across the species. */
  deadlineDay: number;
  rewardItem: ItemKey;
  rewardAmount: number;
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

export type SkillKey = keyof Skills;

/**
 * A settlement-wide practice, bought once with gathered goods and kept for the
 * rest of the run. Traditions are the long horizon the Commons was missing —
 * somewhere for a play-through's hundreds of surplus seed pods to go, and a way
 * for a settlement to end up meaningfully different from the one beside it.
 */
export type TraditionKey =
  | "seed-vault"
  | "lantern-vigil"
  | "long-memory"
  | "hearthcraft"
  | "open-table"
  | "sky-veil";

/**
 * Something a resident lived through and still talks about.
 *
 * The Commons had no memory. A settlement that came through a Long Shade by
 * three points of light and one that sailed through it read exactly the same
 * afterwards, and the residents who were actually there had nothing to show for
 * it. Memories are recorded on the residents who were adults at the time, so
 * they age out of the settlement naturally as those residents do.
 */
export interface Memory {
  /** Day the thing happened. */
  day: number;
  season: Season;
  /** What the resident says about it, in their own voice. */
  text: string;
  /** Whether the memory is a hard one, which colours how it reads. */
  tone: "good" | "hard";
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
  /**
   * Highest mastery tier already announced for this resident, so a promotion is
   * reported once rather than on every tick above the threshold.
   */
  masteryTier: number;
  /** Who taught them, if an elder took them on at a workplace. */
  mentorId?: string;
  /** Lifetime count of sprouts this resident has brought on. */
  taught: number;
  /**
   * What this resident remembers, newest last, capped so a long-lived elder
   * does not accumulate a save-bloating history.
   */
  memories: Memory[];
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

export interface ForecastSnapshot {
  food: number;
  water: number;
  warmth: number;
  light: number;
  harmony: number;
}

export interface Forecast {
  title: string;
  probability: number;
  window: string;
  drivers: string[];
  recommendation: string;
  tone: "calm" | "bright" | "warning";
  recordedDay?: number;
  snapshot?: ForecastSnapshot;
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
  /** How much of each resource the settlement can actually hold. */
  storage: Record<ResourceKey, number>;
  /** Plain reading of what is hurting the Commons, and what would fix it. */
  diagnosis: SettlementDiagnosis;
}

/**
 * The settlement used to fail silently: every stockpile read full while
 * residents left, because stores and needs were unrelated. This is the readout
 * that explains the decline in the terms the player can act on.
 */
export interface SettlementDiagnosis {
  /** The need in the worst shape across the population. */
  need: NeedKey;
  /** Average level of that need, 0-100. */
  level: number;
  /** One sentence naming the cause. */
  cause: string;
  /** One sentence naming the fix. */
  advice: string;
  tone: "good" | "warning";
}

export type NeedKey = "food" | "shelter" | "safety" | "belonging";

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
  tradition?: TraditionKey;
  species?: Species;
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
  /**
   * Consecutive days each species has spent in conditions it cannot abide.
   * Past that species' patience, they start to leave.
   */
  speciesStrain: Record<Species, number>;
  /**
   * Consecutive days each species' conditions have been met. An absent species
   * uses this to decide the basin is worth trying again.
   */
  speciesEase: Record<Species, number>;
  /** Species that have left the Commons entirely, in the order they went. */
  speciesLost: Species[];
  /**
   * The largest the settlement has ever been.
   *
   * Failure was read from average wellbeing, which is a trap once residents can
   * leave: the unhappiest go first, so a settlement bleeding people watched its
   * own average *rise*. Measuring against the high-water mark means sustained
   * loss reads as decline no matter how content the remainder are.
   */
  peakPopulation: number;
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
  /** Requests answered and requests allowed to lapse, for the record. */
  wantsMet: number;
  wantsMissed: number;
  /** Day the district focus last changed, so switching has a cost in time. */
  districtFocusDay: number;
  /** Day the residents last raised something on their own initiative. */
  selfBuildDay: number;
  /** Practices the Commons has taken up for good. */
  traditions: TraditionKey[];
  /**
   * Footfall per tile, flattened row-major. Well-walked ground eventually packs
   * itself into a road, so the shape of the settlement comes from how it is
   * actually used rather than only from where the player draws.
   */
  footfall: number[];
  /** Generations born in the basin, and the best mastery ever reached. */
  generations: number;
  peakMastery: number;
  onboardingStep: number;
  onboardingDismissed: boolean;
  /** Per-tile water cleanliness 0–100. Farms stain it; wetlands restore it. */
  waterQuality: number[][];
  /** Derived civic stain from lanterns and farms sitting on wild ground. */
  habitatStress: number;
  births: number;
  cloudmothsArrived: boolean;
  longShadeCrisis: boolean;
  longShadeStartDay: number;
  longShadeEndsDay: number;
  longShadeOutcome: LongShadeOutcome | null;
  proposal: CouncilProposal | null;
  activePolicies: ActivePolicy[];
  forecastHistory: Forecast[];
  forecastCursor: number;
  marketShortages: MarketShortage[];
  titleSeen: boolean;
}
