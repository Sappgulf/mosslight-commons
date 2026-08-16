import {
  BASE_HOUSING_CAPACITY,
  DISTRICT_DEFINITIONS,
  HOME_HOUSING_CAPACITY,
  OUTPUT_MULTIPLIER,
} from "../data/definitions";
import type { Building, District, DistrictType, Resident, WorldState } from "./types";

/**
 * The six pressures the settlement can be under. These are the same channels
 * the old six-node sidecar graph used, but they are now measured *per district*
 * rather than once for the whole basin.
 */
export type StressChannel = "food" | "water" | "warmth" | "light" | "housing" | "shade";

export const STRESS_CHANNELS: StressChannel[] = ["food", "water", "warmth", "light", "housing", "shade"];

export interface StressNode {
  /** `${districtId}:${channel}` — stable across ticks so samples can be compared. */
  id: string;
  districtId: string;
  districtType: DistrictType;
  districtLabel: string;
  channel: StressChannel;
  /**
   * Local stress, 0 (comfortable) to 1 (critical). This becomes the node's
   * Ising bias on the sidecar, and the local model reads it directly.
   */
  stress: number;
  /** Residents standing inside this district when the graph was built. */
  population: number;
}

export interface StressEdge {
  a: string;
  b: string;
  weight: number;
  /**
   * `channel` couples two pressures inside one district; `spatial` couples the
   * same pressure across two neighbouring districts. Keeping the kinds apart
   * lets the sidecar weight them differently.
   */
  kind: "channel" | "spatial";
}

export interface ChannelSummary {
  /** Mean stress for this channel across every district. */
  mean: number;
  /**
   * The district this channel is worst in, weighted by how many residents stand
   * there — a dark district nobody lives in is not the story to lead with.
   */
  worst: StressNode | undefined;
}

export interface StressGraph {
  nodes: StressNode[];
  edges: StressEdge[];
  /** Node ids grouped by channel, so a consumer can read one pressure basin-wide. */
  byChannel: Record<StressChannel, string[]>;
  /**
   * Per-channel rollup, computed once during the build.
   *
   * Forecast generation reads the mean and the worst district several times per
   * channel; recomputing them by scanning `nodes` each time was enough repeated
   * work to matter on the every-tick forecast path.
   */
  summary: Record<StressChannel, ChannelSummary>;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Pressures that plausibly move together inside a single district, with how
 * strongly. A chain would have been simpler, but these are the couplings the
 * game's own systems actually implement: groves need warmth, homes need light,
 * shade eats light, farms need water.
 */
const CHANNEL_COUPLINGS: Array<[StressChannel, StressChannel, number]> = [
  ["food", "water", 0.42],
  ["food", "housing", 0.3],
  ["water", "warmth", 0.22],
  ["warmth", "housing", 0.36],
  ["light", "shade", 0.55],
  ["light", "housing", 0.26],
  ["shade", "warmth", 0.3],
];

/** How much of a district's own stress bleeds into a neighbour, before distance falloff. */
const SPATIAL_BASE_WEIGHT = 0.34;

/** Districts further apart than this (centre to centre, in tiles) do not couple. */
const SPATIAL_RANGE = 14;

interface DistrictAggregate {
  district: District;
  residents: Resident[];
  buildings: Building[];
  /** Housing capacity contributed by burrow homes inside the bounds. */
  housingCapacity: number;
  /** Lantern output inside the bounds, used as the local light supply. */
  lightSupply: number;
  /** Reed farm output inside the bounds, used as the local food/water supply. */
  foodSupply: number;
}

const contains = (district: District, position: { x: number; y: number }): boolean =>
  position.x >= district.bounds.xMin &&
  position.x <= district.bounds.xMax &&
  position.y >= district.bounds.yMin &&
  position.y <= district.bounds.yMax;

/**
 * Bucket every resident and building into its district in a single pass.
 *
 * The obvious shape here is one `filter` per district, but this runs on every
 * forecast — which is every tick — and a filter-per-district is
 * O(districts × entities). At a hundred residents over a long game that was
 * enough on its own to time the full-playthrough test out.
 */
function aggregateAll(state: WorldState): DistrictAggregate[] {
  const aggregates = new Map<string, DistrictAggregate>();
  for (const district of state.districts) {
    aggregates.set(district.id, {
      district,
      residents: [],
      buildings: [],
      housingCapacity: 0,
      lightSupply: 0,
      foodSupply: 0,
    });
  }

  const locate = (position: { x: number; y: number }): DistrictAggregate | undefined => {
    for (const district of state.districts) {
      if (contains(district, position)) return aggregates.get(district.id);
    }
    return undefined;
  };

  for (const resident of state.residents) locate(resident.position)?.residents.push(resident);

  for (const building of state.buildings) {
    const local = locate(building.position);
    if (!local) continue;
    local.buildings.push(building);
    // Same multiplier the simulation uses, so a district's local reading and the
    // basin-wide metric never disagree about what an upgraded building is worth.
    const multiplier = OUTPUT_MULTIPLIER[building.level] ?? 1;
    if (building.type === "root-heart") local.housingCapacity += BASE_HOUSING_CAPACITY * multiplier;
    else if (building.type === "burrow-home") local.housingCapacity += HOME_HOUSING_CAPACITY * multiplier;
    if (building.type === "lantern-grove" || building.type === "sky-walk") local.lightSupply += multiplier;
    if (building.type === "reed-farm") local.foodSupply += multiplier;
  }

  return state.districts.map((district) => aggregates.get(district.id)!);
}

/** Mean of one need across a set of residents, 0-100, defaulting to comfortable. */
function meanNeed(residents: Resident[], key: "food" | "shelter" | "safety" | "belonging"): number {
  if (residents.length === 0) return 70;
  let total = 0;
  for (const resident of residents) total += resident.needs[key];
  return total / residents.length;
}

/**
 * Local stress for one channel in one district.
 *
 * Every channel blends a basin-wide term (the shared stockpile everyone draws
 * from) with a local term (what this district can actually reach). That blend
 * is the whole point of the per-district graph: a well-supplied basin can still
 * have a district in the dark.
 */
function stressFor(channel: StressChannel, local: DistrictAggregate, state: WorldState): number {
  const { residents, district } = local;
  const crowd = residents.length;
  const globalShortage = (key: "food" | "water" | "warmth" | "light") => clamp01(1 - state.resources[key] / 100);

  switch (channel) {
    case "food": {
      const hunger = clamp01(1 - meanNeed(residents, "food") / 100);
      // A district feeding many mouths from few farms is short even when stores are full.
      const localDeficit = crowd === 0 ? 0 : clamp01((crowd - local.foodSupply * 8) / Math.max(8, crowd));
      const meadowRelief = district.type === "meadow" ? 0.12 : 0;
      return clamp01(globalShortage("food") * 0.45 + hunger * 0.3 + localDeficit * 0.25 - meadowRelief);
    }
    case "water": {
      const wetlandRelief = district.type === "wetland" ? 0.18 : 0;
      const localDeficit = crowd === 0 ? 0 : clamp01((crowd - local.foodSupply * 10) / Math.max(10, crowd));
      return clamp01(globalShortage("water") * 0.62 + localDeficit * 0.2 - wetlandRelief);
    }
    case "warmth": {
      const exposure = clamp01(1 - meanNeed(residents, "shelter") / 100);
      return clamp01(globalShortage("warmth") * 0.5 + exposure * 0.35);
    }
    case "light": {
      // Light is the most local pressure in the game: a grove lights its own ground.
      const localDark = clamp01(1 - local.lightSupply / Math.max(1, Math.ceil(crowd / 6)));
      const lanternRelief = district.type === "lantern" ? 0.16 : 0;
      return clamp01(globalShortage("light") * 0.4 + localDark * 0.45 - lanternRelief);
    }
    case "housing": {
      if (crowd === 0) return 0;
      return clamp01((crowd - local.housingCapacity) / Math.max(4, crowd));
    }
    case "shade": {
      const seasonal = state.season === "longshade" ? 0.58 : state.season === "emberfall" ? 0.16 : 0.05;
      const crisis = state.longShadeCrisis ? 0.2 : 0;
      // Sky Walks and groves hold the shade off the ground beneath them.
      const canopy = clamp01(local.lightSupply / 3) * 0.22;
      return clamp01(seasonal + crisis - canopy);
    }
  }
}

/**
 * Build the settlement's stress graph.
 *
 * This replaces the sidecar's hardcoded six-node chain. Nodes are (district ×
 * channel), so the graph's *shape* now depends on how the player built their
 * town: a sprawling settlement with five districts samples differently from a
 * dense one with two, and neighbouring districts share stress through spatial
 * edges weighted by how close they actually are.
 */
/**
 * One-entry memo per world.
 *
 * The forecast stage runs every tick, and build/collect actions re-run it
 * mid-tick, so an uncached graph is rebuilt several times over identical state.
 * The key covers everything that moves: the tick (resident positions), and the
 * two collection lengths (a building raised or a resident lost mid-tick).
 */
const graphCache = new WeakMap<WorldState, { key: string; graph: StressGraph }>();

const cacheKey = (state: WorldState): string =>
  `${state.tick}:${state.residents.length}:${state.buildings.length}:${state.districts.length}`;

export function buildStressGraph(state: WorldState): StressGraph {
  const key = cacheKey(state);
  const cached = graphCache.get(state);
  if (cached && cached.key === key) return cached.graph;
  const graph = computeStressGraph(state);
  graphCache.set(state, { key, graph });
  return graph;
}

function computeStressGraph(state: WorldState): StressGraph {
  const aggregates = aggregateAll(state);

  const nodes: StressNode[] = [];
  const byChannel = {} as Record<StressChannel, string[]>;
  for (const channel of STRESS_CHANNELS) byChannel[channel] = [];

  for (const local of aggregates) {
    for (const channel of STRESS_CHANNELS) {
      const id = `${local.district.id}:${channel}`;
      nodes.push({
        id,
        districtId: local.district.id,
        districtType: local.district.type,
        districtLabel: DISTRICT_DEFINITIONS[local.district.type].label,
        channel,
        stress: Number(stressFor(channel, local, state).toFixed(4)),
        population: local.residents.length,
      });
      byChannel[channel].push(id);
    }
  }

  const edges: StressEdge[] = [];

  // Pressures inside one district pull on each other.
  for (const local of aggregates) {
    for (const [a, b, weight] of CHANNEL_COUPLINGS) {
      edges.push({ a: `${local.district.id}:${a}`, b: `${local.district.id}:${b}`, weight, kind: "channel" });
    }
  }

  // The same pressure bleeds between districts that are close enough to share it.
  for (let first = 0; first < aggregates.length; first += 1) {
    for (let second = first + 1; second < aggregates.length; second += 1) {
      const a = aggregates[first]!.district;
      const b = aggregates[second]!.district;
      const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      if (distance > SPATIAL_RANGE) continue;
      const falloff = 1 - distance / SPATIAL_RANGE;
      const weight = Number((SPATIAL_BASE_WEIGHT * falloff).toFixed(4));
      if (weight <= 0.01) continue;
      for (const channel of STRESS_CHANNELS) {
        edges.push({ a: `${a.id}:${channel}`, b: `${b.id}:${channel}`, weight, kind: "spatial" });
      }
    }
  }

  // One pass over the nodes fills every channel's rollup.
  const summary = {} as Record<StressChannel, ChannelSummary>;
  for (const channel of STRESS_CHANNELS) summary[channel] = { mean: 0, worst: undefined };
  const totals = {} as Record<StressChannel, { sum: number; count: number; bestScore: number }>;
  for (const channel of STRESS_CHANNELS) totals[channel] = { sum: 0, count: 0, bestScore: -1 };

  for (const node of nodes) {
    const running = totals[node.channel];
    running.sum += node.stress;
    running.count += 1;
    const score = node.stress * (1 + Math.min(1, node.population / 12));
    if (score > running.bestScore) {
      running.bestScore = score;
      summary[node.channel].worst = node;
    }
  }
  for (const channel of STRESS_CHANNELS) {
    const running = totals[channel];
    summary[channel].mean = running.count === 0 ? 0 : running.sum / running.count;
  }

  return { nodes, edges, byChannel, summary };
}

/** Mean stress for one channel across every district. */
export function channelStress(graph: StressGraph, channel: StressChannel): number {
  return graph.summary[channel].mean;
}

/** The district a channel is worst in, weighted by the crowd standing there. */
export function worstDistrictFor(graph: StressGraph, channel: StressChannel): StressNode | undefined {
  return graph.summary[channel].worst;
}
