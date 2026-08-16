import { EVENT_COPY } from "../data/definitions";
import { STRESS_CHANNELS, buildStressGraph, channelStress, worstDistrictFor } from "./graph";
import type { StressChannel, StressGraph, StressNode } from "./graph";
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

/**
 * Copy for a channel's forecast. The title and recommendation are fixed per
 * channel, but the drivers are written from the graph at call time so the
 * player is told *which district* is in trouble rather than a basin average.
 */
const CHANNEL_COPY: Record<
  StressChannel,
  { title: string; recommendation: string; tone: Forecast["tone"]; window: string }
> = {
  food: { ...EVENT_COPY.emptyShelves, window: "next 2 days" },
  water: { ...EVENT_COPY.reedWarning, window: "next 2 days" },
  warmth: {
    title: "Cold Burrows",
    recommendation: "Raise warmth before the burrows go cold: a Root Workshop or a Comfort Bundle.",
    tone: "warning",
    window: "next 3 days",
  },
  light: { ...EVENT_COPY.lanternFestival, window: "next 3 days" },
  housing: {
    title: "No Room Left",
    recommendation: "Build Burrow Homes where the crowd already stands.",
    tone: "warning",
    window: "next 2 days",
  },
  shade: { ...EVENT_COPY.longShade, window: "this season" },
};

/**
 * Light is the one channel whose *absence* of stress is the interesting event:
 * a well-lit basin throws a Lantern Festival. Every other channel forecasts its
 * own shortage.
 */
const INVERTED_CHANNELS = new Set<StressChannel>(["light"]);

function driversFor(channel: StressChannel, graph: StressGraph, worst: StressNode | undefined, state: WorldState): string[] {
  const mean = channelStress(graph, channel);
  const drivers: string[] = [];

  if (worst) {
    drivers.push(
      `${worst.districtLabel} reads ${Math.round(worst.stress * 100)}% ${channel} pressure with ${worst.population} resident${worst.population === 1 ? "" : "s"}`,
    );
  }
  drivers.push(`basin-wide ${channel} pressure ${Math.round(mean * 100)}% across ${state.districts.length} districts`);

  // Name the neighbour, so spatial coupling is visible rather than implied.
  const spread = graph.nodes
    .filter((node) => node.channel === channel && node.id !== worst?.id && node.stress > 0.45)
    .map((node) => node.districtLabel);
  if (spread.length > 0) drivers.push(`spreading toward ${spread.slice(0, 2).join(" and ")}`);
  else drivers.push(`${formatSeason(state.season)} ${state.seasonDay}/${DAYS_PER_SEASON} · ${state.metrics.population} residents`);

  return drivers.slice(0, 3);
}

/**
 * Generate the full ranked set of plausible futures from the settlement's
 * stress graph.
 *
 * This replaces a hardcoded list of five hand-tuned candidates. Each channel
 * produces one forecast whose probability comes from that channel's measured
 * stress, so a basin that has never been short of water simply does not surface
 * a Wetland Warning — and a forecast can now name the district it is about.
 */
export function generateForecasts(state: WorldState): Forecast[] {
  const graph = buildStressGraph(state);

  const candidates = STRESS_CHANNELS.map((channel) => {
    const copy = CHANNEL_COPY[channel];
    const worst = worstDistrictFor(graph, channel);
    const mean = channelStress(graph, channel);
    // The worst district drives the headline; the basin average tempers it.
    const peak = worst?.stress ?? mean;
    const intensity = INVERTED_CHANNELS.has(channel) ? 1 - (peak * 0.6 + mean * 0.4) : peak * 0.65 + mean * 0.35;

    return {
      title: copy.title,
      probability: clamp(0.06 + intensity * 0.86, 0.05, 0.94),
      window: copy.window,
      drivers: driversFor(channel, graph, worst, state),
      recommendation: copy.recommendation,
      tone: copy.tone,
    } satisfies Forecast;
  });

  return candidates.sort((first, second) => second.probability - first.probability);
}

/**
 * The single most likely future, annotated for the rewind history.
 *
 * The ranked remainder is available through {@link generateForecasts} and is
 * what the HUD scrubs through as alternative branches.
 */
export function calculateLocalForecast(state: WorldState): Forecast {
  const ranked = generateForecasts(state);
  return annotateForecast(ranked[0]!, state);
}

