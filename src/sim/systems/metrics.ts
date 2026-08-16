import {
  BASE_HOUSING_CAPACITY,
  HOME_HOUSING_CAPACITY,
  OUTPUT_MULTIPLIER,
} from "../../data/definitions";
import { hasTradition } from "../traditions";
import type {
  Building,
  BuildingType,
  Message,
  NeedKey,
  Resident,
  ResourceKey,
  SettlementDiagnosis,
  SettlementMetrics,
  Species,
  WorldState,
} from "../types";

/**
 * How the settlement reads itself: capacity, wellbeing, harmony, and the plain
 * diagnosis that tells the player what is going wrong.
 *
 * These were methods on `MosslightSimulation`, but every one of them is a pure
 * reading of world state — nothing here needs the class, and pulling them out
 * lets each be tested against a hand-built world rather than a played game.
 */

const MAX_RESOURCE = 100;
const BASE_STORAGE = 38;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/** How much of each resource a building type lets the Commons hold. */
const STORAGE_YIELD: Partial<Record<BuildingType, Partial<Record<ResourceKey, number>>>> = {
  "root-heart": { food: 8, water: 8, warmth: 8, light: 8 },
  "commons-market": { food: 26, water: 14 },
  "reed-farm": { food: 12, water: 20 },
  "burrow-home": { warmth: 14 },
  "lantern-grove": { light: 26 },
  "root-workshop": { warmth: 10, light: 10 },
  "sky-walk": { light: 18, warmth: 6 },
};

/** Residents the standing buildings can shelter. */
export function housingCapacityOf(buildings: Building[]): number {
  let capacity = 0;
  for (const building of buildings) {
    // Upgraded homes house more; the Root scales too.
    const multiplier = OUTPUT_MULTIPLIER[building.level] ?? 1;
    if (building.type === "root-heart") capacity += BASE_HOUSING_CAPACITY * multiplier;
    else if (building.type === "burrow-home") capacity += HOME_HOUSING_CAPACITY * multiplier;
  }
  return Math.floor(capacity);
}

/**
 * How much of each resource the settlement can hold.
 *
 * Everything used to cap at a flat 100, which food reached inside twenty days
 * and never left — a solved problem for the rest of the run, and no reason to
 * build anything that touched it. Capacity comes from buildings now, so a
 * surplus needs somewhere to go and growth has to be built for.
 */
export function calculateStorage(state: WorldState): Record<ResourceKey, number> {
  const storage: Record<ResourceKey, number> = {
    food: BASE_STORAGE,
    water: BASE_STORAGE,
    warmth: BASE_STORAGE,
    light: BASE_STORAGE,
  };
  for (const building of state.buildings) {
    const yields = STORAGE_YIELD[building.type];
    if (!yields) continue;
    const multiplier = OUTPUT_MULTIPLIER[building.level] ?? 1;
    for (const [resource, amount] of Object.entries(yields) as Array<[ResourceKey, number]>) {
      storage[resource] += amount * multiplier;
    }
  }
  if (hasTradition(state, "open-table")) {
    storage.food *= 1.25;
    storage.water *= 1.25;
  }
  for (const resource of Object.keys(storage) as ResourceKey[]) {
    storage[resource] = Math.min(MAX_RESOURCE, Math.round(storage[resource]));
  }
  return storage;
}

/**
 * Names the need in the worst shape and what would lift it. Without this the
 * settlement declined silently behind four full bars, and a player had no way
 * to tell what was going wrong, let alone what to do about it.
 */
export function diagnose(state: WorldState, housingPressure: number): SettlementDiagnosis {
  const population = state.residents.length;
  if (population === 0) {
    return {
      need: "belonging",
      level: 0,
      cause: "The basin is empty.",
      advice: "Begin again, or load a save from before the quiet.",
      tone: "warning",
    };
  }

  const totals: Record<NeedKey, number> = { food: 0, shelter: 0, safety: 0, belonging: 0 };
  for (const resident of state.residents) {
    totals.food += resident.needs.food;
    totals.shelter += resident.needs.shelter;
    totals.safety += resident.needs.safety;
    totals.belonging += resident.needs.belonging;
  }
  const averages = Object.fromEntries(
    (Object.keys(totals) as NeedKey[]).map((need) => [need, totals[need] / population]),
  ) as Record<NeedKey, number>;

  const need = (Object.keys(averages) as NeedKey[]).reduce((worst, candidate) =>
    averages[candidate] < averages[worst] ? candidate : worst,
  );
  const level = averages[need];

  /*
   * Stores run dry before needs do, so a shortage is the earlier and more
   * actionable warning. Reporting "everyone is fine" while the lanterns have
   * a fifth of their fuel left is how a settlement gets to the edge without
   * the player being told anything was wrong.
   */
  const storage = state.metrics.storage;
  const short = (Object.keys(state.resources) as ResourceKey[])
    .map((resource) => ({ resource, ratio: state.resources[resource] / Math.max(1, storage[resource]) }))
    .filter((entry) => entry.ratio < 0.2)
    .sort((a, b) => a.ratio - b.ratio)[0];

  if (short) {
    const shortfall: Record<ResourceKey, { need: NeedKey; cause: string; advice: string }> = {
      food: { need: "food", cause: "The granary is nearly out and meals are getting thin.", advice: "Raise a Reed Farm, or upgrade one, before the stalls empty." },
      water: { need: "food", cause: "The cistern is nearly dry.", advice: "Raise a Reed Farm near clean water to refill the basin stores." },
      warmth: { need: "shelter", cause: "There is barely any fuel left for the hearths.", advice: "Raise or upgrade a Burrow Home, and keep resin coming from the workshop." },
      light: { need: "safety", cause: "The lanterns are nearly out of fuel and the night routes are going dark.", advice: "Raise a Lantern Grove, or craft a Glow Kit to recharge the routes." },
    };
    const entry = shortfall[short.resource];
    return { need: entry.need, level: averages[entry.need], cause: entry.cause, advice: entry.advice, tone: "warning" };
  }

  if (level > 62) {
    return {
      need,
      level,
      cause: "Everyone is getting what they need.",
      advice: "Room to grow: raise a home, or push into the unmapped basin.",
      tone: "good",
    };
  }

  const crowded = housingPressure > 0.95;
  const reasons: Record<NeedKey, { cause: string; advice: string }> = {
    food: {
      cause: state.resources.food < 12
        ? "The granary is empty, so trips to the market come back with nothing."
        : "More mouths are arriving at the stalls than the farms are filling them.",
      advice: "Raise a Reed Farm, or a Commons Market so food reaches the far neighborhoods.",
    },
    shelter: {
      cause: crowded
        ? "Homes are over capacity and nobody is resting properly."
        : "Hearths are burning more warmth than the Commons is making.",
      advice: crowded
        ? "Raise a Burrow Home — housing is the binding constraint right now."
        : "Raise or upgrade a Burrow Home to bring warmth back up.",
    },
    safety: {
      cause: state.resources.light < 12
        ? "The lanterns have no fuel and the routes go dark after dusk."
        : "Too much of the settlement sits outside the lantern light.",
      advice: "Raise a Lantern Grove near the outer homes, or upgrade the one you have.",
    },
    belonging: {
      cause: crowded
        ? "Crowding is wearing on everyone, and requests are going unanswered."
        : "Neighbors are not meeting often enough, and requests are going unanswered.",
      advice: "Answer an open request, and keep a Commons Market within easy walking distance.",
    },
  };

  return { need, level, ...reasons[need], tone: "warning" };
}

/** The whole settlement readout, recomputed from world state. */
export function calculateMetrics(state: WorldState): SettlementMetrics {
  const population = state.residents.length;
  const housingCapacity = housingCapacityOf(state.buildings);
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
  const marketBonus = state.buildings.some((building) => building.type === "commons-market") ? 5 : 0;
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
    storage: calculateStorage(state),
    diagnosis: diagnose(state, housingPressure),
  };
}

/** Whichever of a resident's four needs is in the worst shape. */
export function mostPressingNeed(resident: Resident): keyof Resident["needs"] {
  const { shelter, food, safety, belonging } = resident.needs;
  let key: keyof Resident["needs"] = "food";
  let lowest = food;
  if (shelter < lowest) { lowest = shelter; key = "shelter"; }
  if (safety < lowest) { lowest = safety; key = "safety"; }
  if (belonging < lowest) { key = "belonging"; }
  return key;
}

export function resourceWarningLevel(value: number): number {
  return value < 10 ? 2 : value < 25 ? 1 : 0;
}

export function housingMessageBand(pressure: number): number {
  return pressure >= 1 ? 2 : pressure >= 0.88 ? 1 : 0;
}

/**
 * Where the "have we already said this?" state lives.
 *
 * Both warnings below are edge-triggered: they speak when a reading crosses a
 * band, not every tick it sits inside one. That bookkeeping was instance state
 * on the simulation; it travels with the functions instead.
 */
export interface WarningBands {
  resources: Record<ResourceKey, number>;
  housing: number;
}

export function createWarningBands(): WarningBands {
  return { resources: { food: 0, water: 0, warmth: 0, light: 0 }, housing: 0 };
}

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  food: "Food",
  water: "Water",
  warmth: "Warmth",
  light: "Light",
};

type Announce = (text: string, tone: Message["tone"]) => void;

export function checkResourceWarnings(state: WorldState, bands: WarningBands, announce: Announce): void {
  const actions: Record<ResourceKey, string> = {
    food: "Add a Reed Farm before the market runs dry.",
    water: "Add a Reed Farm to filter and replenish the basin.",
    warmth: "Build a Burrow Home or reduce the strain on existing shelter.",
    light: "Build a Lantern Grove before night routes become unsafe.",
  };

  for (const resource of Object.keys(state.resources) as ResourceKey[]) {
    const value = state.resources[resource];
    const previousLevel = bands.resources[resource];
    const nextLevel = resourceWarningLevel(value);
    if (nextLevel > previousLevel) {
      announce(
        `ALERT · ${RESOURCE_LABEL[resource]} stores are ${nextLevel === 2 ? "critical" : "low"} at ${Math.round(value)}. ${actions[resource]}`,
        "warning",
      );
    } else if (previousLevel > 0 && nextLevel === 0) {
      announce(`RECOVERY · ${RESOURCE_LABEL[resource]} stores are stable at ${Math.round(value)}.`, "good");
    }
    bands.resources[resource] = nextLevel;
  }
}

export function checkHousingPressure(state: WorldState, bands: WarningBands, announce: Announce): void {
  const nextBand = housingMessageBand(state.metrics.housingPressure);
  if (nextBand === bands.housing) return;

  const { population, housingCapacity } = state.metrics;
  if (nextBand === 2) {
    announce(
      `ALERT · Housing is over capacity at ${population}/${housingCapacity}. Build a Burrow Home before welcoming anyone else.`,
      "warning",
    );
  } else if (nextBand === 1) {
    announce(
      `SETTLEMENT · Housing is tight at ${population}/${housingCapacity}. A Burrow Home will make room for the next arrival.`,
      "info",
    );
  } else {
    announce(`RECOVERY · Housing has breathing room again at ${population}/${housingCapacity}.`, "good");
  }
  bands.housing = nextBand;
}
