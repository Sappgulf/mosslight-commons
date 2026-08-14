import { OUTPUT_MULTIPLIER } from "../../data/definitions";
import { marketShortages } from "../civic";
import { tierFor } from "../mastery";
import { hasTradition } from "../traditions";
import type { BuildingType, Resident, ResourceKey } from "../types";
import type { SimContext } from "./context";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/** Resin the workshop will never burn, so recipes always have something to use. */
const RESIN_RESERVE = 4;

/**
 * Effective count of a building type: each building contributes its level
 * multiplier scaled by its placement bonus, then by the average relevant skill
 * of whoever works there.
 */
export function weightedOutput(
  context: SimContext,
  type: BuildingType,
  skill?: keyof Resident["skills"],
): number {
  let total = 0;
  for (const building of context.state.buildings) {
    if (building.type !== type) continue;
    // Where a building sits now matters as much as what level it is.
    let contribution = (OUTPUT_MULTIPLIER[building.level] ?? 1) * context.adjacencyFor(building).multiplier;
    if (skill) {
      const workers = context.state.residents.filter((resident) => resident.workplaceId === building.id);
      if (workers.length > 0) {
        /*
         * Mastery, not just raw skill. Each worker contributes their tier's
         * multiplier, so a bench of Masters is worth substantially more than a
         * bench of beginners and the settlement's accumulated experience shows
         * up in what it can actually produce.
         */
        const mastery = workers.reduce((sum, resident) => sum + tierFor(resident.skills[skill]).output, 0) / workers.length;
        const average = workers.reduce((sum, resident) => sum + resident.skills[skill], 0) / workers.length;
        contribution *= mastery * (0.9 + (average / 100) * 0.2);
      }
    }
    total += contribution;
  }
  return total;
}

/**
 * One tick of production and consumption across every stockpile. Buildings
 * produce, the population eats, and season, district focus, council policy,
 * rivalry, water quality, and habitat stress all bend the rates.
 */
export function updateResources(context: SimContext): void {
  const { state } = context;
  const farmOutput = weightedOutput(context, "reed-farm", "farming");
  const homeOutput = weightedOutput(context, "burrow-home");
  const groveOutput = weightedOutput(context, "lantern-grove");
  const marketOutput = weightedOutput(context, "commons-market");
  const workshops = weightedOutput(context, "root-workshop", "crafting");
  /*
   * The workshop renders *surplus* resin into warmth and light, and leaves a
   * working reserve alone.
   *
   * It used to take every last one: a single workshop consumed a resin a tick
   * and pinned the stock at zero within eight ticks of being built. Since Glow
   * Kits and Comfort Bundles both need resin in hand, raising a Root Workshop —
   * itself a chapter-zero objective — permanently locked the chapter-one
   * objective that asks for two Glow Kits. The game blocked its own progression.
   */
  const craftedResin = Math.min(
    Math.ceil(workshops),
    Math.max(0, state.items.resin - RESIN_RESERVE),
  );
  const farmFactor = state.districtFocus === "wetland" ? 1.2 : 1;
  const groveFactor = state.districtFocus === "lantern" ? 1.2 : 1;
  const marketFactor = state.seasonalEvent.effect === "festival" ? 0.16 : 0.06;
  const seasonalWarmth = state.seasonalEvent.effect === "bloom" ? 0.25 : 0;
  const seasonalDrain = state.seasonalEvent.effect === "watch" ? 0.18 : 0;
  const lanternPolicy = context.hasPolicy("lantern-first") ? 1.18 : 1;
  const farmPolicy = context.hasPolicy("wetland-first") ? 1.12 : 1;
  const marketPolicy = context.hasPolicy("market-first") ? 1.16 : 1;

  // Rivalries in the settlement drag on every workplace.
  const rivalryDrag = clamp(
    1 - state.relationships.filter((relationship) => relationship.kind === "rivalry" && relationship.strength > 60).length * 0.015,
    0.75,
    1,
  );

  const basinQuality = context.averageWaterQuality();
  const habitatPenalty = 1 - Math.min(0.28, state.habitatStress * 0.012);
  const storage = state.metrics.storage;

  /*
   * Production only. Consumption is no longer a flat per-head subtraction
   * here — residents draw food, water and warmth from the stores when they
   * actually eat, rest and light their routes, so the two sides of the economy
   * finally describe the same thing. What is left in this step is what the
   * settlement makes, capped by what it can hold.
   */
  const store = (resource: ResourceKey, delta: number) => {
    state.resources[resource] = clamp(state.resources[resource] + delta, 0, storage[resource]);
  };

  // Practices the Commons keeps, applied to what it makes.
  const seedVault = hasTradition(state, "seed-vault") ? 1.2 : 1;
  store("food", farmOutput * 1.0 * farmFactor * farmPolicy * rivalryDrag * habitatPenalty * seedVault);
  store(
    "water",
    farmOutput * 0.9 * farmFactor * rivalryDrag * (0.65 + basinQuality / 280) - state.habitatStress * 0.02,
  );
  state.marketShortages = marketShortages(state.buildings, state.resources.food);
  store("warmth", homeOutput * 0.55 + craftedResin * 0.18 + seasonalWarmth - seasonalDrain);
  store(
    "light",
    groveOutput * 0.72 * groveFactor * lanternPolicy
      + marketOutput * marketFactor * marketPolicy
      + craftedResin * 0.12
      - seasonalDrain,
  );
  state.items.resin = Math.max(0, state.items.resin - craftedResin);
  // Resource security feeds metrics, and resources move every single tick.
  context.markMetricsDirty();
}
