import { EVENT_COPY } from "../data/definitions";
import type { BuildingType, Forecast, ForecastSnapshot, WorldState } from "./types";

const MAX_RESOURCE = 100;
const DAYS_PER_SEASON = 7;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const formatSeason = (season: WorldState["season"]): string => {
  if (season === "mosswake") return "Mosswake";
  if (season === "suncrest") return "Suncrest";
  if (season === "emberfall") return "Emberfall";
  return "Long Shade";
};

export function snapshotFrom(state: WorldState): ForecastSnapshot {
  return {
    food: state.resources.food,
    water: state.resources.water,
    warmth: state.resources.warmth,
    light: state.resources.light,
    harmony: state.metrics.harmony,
  };
}

export function annotateForecast(forecast: Forecast, state: WorldState): Forecast {
  return {
    ...forecast,
    recordedDay: state.day,
    snapshot: snapshotFrom(state),
  };
}

export function compareForecasts(past: Forecast, live: Forecast): string[] {
  const a = past.snapshot;
  const b = live.snapshot;
  if (!a || !b) return [];
  const lines: string[] = [];
  const note = (label: string, before: number, after: number) => {
    const delta = Math.round(after - before);
    if (delta === 0) return;
    lines.push(`${label} ${delta > 0 ? "+" : ""}${delta} since Day ${past.recordedDay ?? "?"}`);
  };
  note("Food", a.food, b.food);
  note("Water", a.water, b.water);
  note("Warmth", a.warmth, b.warmth);
  note("Light", a.light, b.light);
  note("Harmony", a.harmony, b.harmony);
  if (past.title !== live.title) {
    lines.unshift(`Then: ${past.title} → now: ${live.title}`);
  }
  return lines.slice(0, 4);
}

export function calculateLocalForecast(
  state: WorldState,
  countBuildings: (type: BuildingType, world?: WorldState) => number,
  averageWaterQuality: (world?: WorldState) => number,
): Forecast {
  const foodPressure = clamp(1 - state.resources.food / MAX_RESOURCE, 0, 1);
  const waterPressure = clamp(1 - state.resources.water / MAX_RESOURCE, 0, 1);
  const lightStrength = clamp(state.resources.light / MAX_RESOURCE, 0, 1);
  const harmony = state.metrics.harmony / 100;
  const housingPressure = Math.max(0, state.metrics.housingPressure - 0.9);
  const seasonNote = `${formatSeason(state.season)} ${state.seasonDay}/${DAYS_PER_SEASON}`;
  const housingNote = `${state.metrics.population}/${state.metrics.housingCapacity} housed`;
  const crisis = state.longShadeCrisis ? 0.22 : 0;

  const candidates: Forecast[] = [
    {
      ...EVENT_COPY.emptyShelves,
      probability: clamp(0.08 + foodPressure * 0.62 + housingPressure * 0.12, 0.05, 0.94),
      window: "next 2 days",
      drivers: [
        `${state.resources.food.toFixed(0)} food in stores`,
        `${countBuildings("reed-farm", state)} active Reed Farms for ${state.metrics.population} residents`,
        `${seasonNote} · ${housingNote}`,
      ],
    },
    {
      ...EVENT_COPY.lanternFestival,
      probability: clamp(0.12 + lightStrength * 0.42 + harmony * 0.22 + (countBuildings("commons-market", state) > 0 ? 0.05 : 0), 0.05, 0.94),
      window: "next 3 days",
      drivers: [
        `${state.resources.light.toFixed(0)} light in the Commons`,
        `harmony ${Math.round(state.metrics.harmony)}% · ${housingNote}`,
        `${seasonNote} · ${countBuildings("commons-market", state)} market gathering point`,
      ],
    },
    {
      ...EVENT_COPY.reedWarning,
      probability: clamp(0.08 + waterPressure * 0.58 + (100 - averageWaterQuality(state)) / 400, 0.05, 0.94),
      window: "next 2 days",
      drivers: [
        `${state.resources.water.toFixed(0)} water in the basin`,
        `water quality ${Math.round(averageWaterQuality(state))}%`,
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
    {
      ...EVENT_COPY.longShade,
      probability: clamp(
        (state.season === "longshade" ? 0.42 : 0.08) + crisis + (state.cloudmothsArrived ? 0.12 : 0.2) + (100 - averageWaterQuality(state)) / 400,
        0.05,
        0.94,
      ),
      window: state.longShadeCrisis ? `${Math.max(0, state.longShadeEndsDay - state.day)} days of shade left` : "this season",
      drivers: [
        `${seasonNote} · habitat stain ${state.habitatStress}`,
        `water quality ${Math.round(averageWaterQuality(state))}%`,
        state.cloudmothsArrived ? "Cloudmoths are already among you" : "Cloudmoths have not yet arrived",
      ],
    },
  ];

  const selected = candidates.sort((first, second) => second.probability - first.probability)[0]!;
  return annotateForecast(
    { ...selected, probability: Math.min(0.94, selected.probability) },
    state,
  );
}
