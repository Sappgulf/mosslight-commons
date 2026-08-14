import { OUTPUT_MULTIPLIER } from "../../data/definitions";
import { marketShortages } from "../civic";
import type { BuildingType, Resident } from "../types";
import type { SimContext } from "./context";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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
        const average = workers.reduce((sum, resident) => sum + resident.skills[skill], 0) / workers.length;
        // Skill swings output between 85% and 130%.
        contribution *= 0.85 + (average / 100) * 0.45;
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
  const population = state.residents.length;
  const craftedResin = Math.min(Math.ceil(workshops), state.items.resin);
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

  state.resources.food = clamp(
    state.resources.food + farmOutput * 1.0 * farmFactor * farmPolicy * rivalryDrag * habitatPenalty - population * 0.022,
  );
  state.resources.water = clamp(
    state.resources.water
      + farmOutput * 0.58 * farmFactor * rivalryDrag * (0.65 + basinQuality / 280)
      - population * 0.014
      - state.habitatStress * 0.02,
  );
  state.marketShortages = marketShortages(state.buildings, state.resources.food);
  state.resources.warmth = clamp(
    state.resources.warmth + homeOutput * 0.55 - population * 0.012 + craftedResin * 0.18 + seasonalWarmth - seasonalDrain,
  );
  state.resources.light = clamp(
    state.resources.light + groveOutput * 0.72 * groveFactor * lanternPolicy - population * 0.009 + marketOutput * marketFactor * marketPolicy + craftedResin * 0.12 - seasonalDrain,
  );
  state.items.resin = Math.max(0, state.items.resin - craftedResin);
  // Resource security feeds metrics, and resources move every single tick.
  context.markMetricsDirty();
}
