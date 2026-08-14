import { PROPOSAL_DEFINITIONS } from "../data/definitions";
import type {
  ActivePolicy,
  Building,
  CouncilProposal,
  Forecast,
  MarketShortage,
  ProposalKind,
  Resident,
  Species,
  SpeciesVote,
  TileKind,
  Vec2,
  WorldState,
} from "./types";

export const GRID_W = 32;
export const GRID_H = 24;

export function createWaterQuality(grid: TileKind[][]): number[][] {
  return grid.map((row) =>
    row.map((tile) => {
      if (tile === "water") return 88;
      if (tile === "wetland") return 82;
      if (tile === "path") return 64;
      if (tile === "stone") return 50;
      return 70;
    }),
  );
}

export function tickWaterQuality(
  grid: TileKind[][],
  quality: number[][],
  buildings: Building[],
): { quality: number[][]; basin: number; stress: number } {
  const next = quality.map((row) => row.slice());
  const stain = new Map<string, number>();
  for (const building of buildings) {
    const radius = building.type === "reed-farm" ? 2 : building.type === "lantern-grove" ? 2 : 0;
    const amount = building.type === "reed-farm" ? 4 + building.level : building.type === "lantern-grove" ? 3 : 0;
    if (!radius) continue;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = building.position.x + dx;
        const y = building.position.y + dy;
        const key = `${x},${y}`;
        stain.set(key, (stain.get(key) ?? 0) + amount);
      }
    }
  }

  let basin = 0;
  let wet = 0;
  let stress = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y]!.length; x += 1) {
      const tile = grid[y]![x]!;
      let value = next[y]![x] ?? 70;
      if (tile === "wetland" || tile === "water") value += 2.4;
      else value += 0.15;
      value -= stain.get(`${x},${y}`) ?? 0;
      value = Math.max(0, Math.min(100, value));
      next[y]![x] = value;
      if (tile === "water" || tile === "wetland") {
        basin += value;
        wet += 1;
      }
    }
  }

  for (const building of buildings) {
    if (building.type !== "lantern-grove" && building.type !== "reed-farm") continue;
    const { x, y } = building.position;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const tile = grid[y + dy]?.[x + dx];
        if (tile === "wetland" || tile === "water") stress += 1;
      }
    }
  }

  return { quality: next, basin: wet ? basin / wet : 70, stress };
}

export function qualityAt(quality: number[][], position: Vec2): number {
  return quality[position.y]?.[position.x] ?? 70;
}

export function marketShortages(buildings: Building[], food: number): MarketShortage[] {
  return buildings
    .filter((building) => building.type === "commons-market")
    .map((building) => ({
      buildingId: building.id,
      pressure: Math.max(0, 55 - food) / 55,
    }));
}

const ALLIES: Record<ProposalKind, Species[]> = {
  "shelter-first": ["brambleback"],
  "wetland-first": ["mireling"],
  "market-first": ["glowtail"],
  "lantern-first": ["glowtail", "cloudmoth"],
  "welcome-moths": ["cloudmoth", "glowtail"],
};

const RIVALS: Record<ProposalKind, Species[]> = {
  "shelter-first": ["mireling"],
  "wetland-first": ["glowtail"],
  "market-first": ["mireling"],
  "lantern-first": ["mireling"],
  "welcome-moths": ["brambleback"],
};

export function tallyVotes(kind: ProposalKind, residents: Resident[]): SpeciesVote[] {
  const species: Species[] = ["brambleback", "glowtail", "mireling", "cloudmoth"];
  return species.map((name) => {
    const count = residents.filter((resident) => resident.species === name).length;
    if (count === 0) return { species: name, stance: "split" as const, weight: 0 };
    const allies = ALLIES[kind];
    const rivals = RIVALS[kind];
    const stance: SpeciesVote["stance"] = allies.includes(name) ? "for" : rivals.includes(name) ? "against" : "split";
    return { species: name, stance, weight: count };
  }).filter((vote) => vote.weight > 0);
}

export function nextProposal(day: number, chapter: number, id: number, residents: Resident[] = []): CouncilProposal {
  const kinds: ProposalKind[] = chapter >= 2 || residents.some((resident) => resident.species === "cloudmoth")
    ? ["welcome-moths", "shelter-first", "wetland-first", "lantern-first", "market-first"]
    : ["shelter-first", "wetland-first", "market-first", "lantern-first"];
  const kind = kinds[id % kinds.length]!;
  const definition = PROPOSAL_DEFINITIONS[kind];
  return {
    id: `proposal-${id}`,
    kind,
    title: definition.title,
    body: definition.body,
    species: definition.species,
    status: "pending",
    createdDay: day,
    deadlineDay: day + 4,
    votes: tallyVotes(kind, residents),
  };
}

export function policyFrom(kind: ProposalKind): ActivePolicy {
  const labels: Record<ProposalKind, string> = {
    "shelter-first": "Housing rush · burrows rise faster",
    "wetland-first": "Reed quiet · basin is recovering",
    "market-first": "Open stalls · food routes thicken",
    "lantern-first": "Nightwatch · groves burn brighter",
    "welcome-moths": "Moth roost · mixed neighborhoods",
  };
  return { kind, daysRemaining: 8, label: labels[kind] };
}

export function pushForecastHistory(history: Forecast[], forecast: Forecast): Forecast[] {
  const last = history[history.length - 1];
  if (last && last.title === forecast.title && Math.abs(last.probability - forecast.probability) < 0.02) {
    return history;
  }
  const next = [...history, forecast];
  return next.length > 12 ? next.slice(next.length - 12) : next;
}

export function normalizeWorld(state: WorldState, grid: TileKind[][]): WorldState {
  if (!state.waterQuality || state.waterQuality.length !== grid.length) {
    state.waterQuality = createWaterQuality(grid);
  }
  state.habitatStress ??= 0;
  state.births ??= 0;
  state.cloudmothsArrived ??= false;
  state.longShadeCrisis ??= false;
  state.longShadeStartDay ??= 0;
  state.longShadeEndsDay ??= 0;
  state.longShadeOutcome ??= null;
  state.proposal ??= null;
  if (state.proposal) {
    state.proposal.deadlineDay ??= state.proposal.createdDay + 4;
    state.proposal.votes ??= [];
  }
  state.activePolicies ??= [];
  state.traditions ??= [];
  state.generations ??= 0;
  state.peakMastery ??= 0;
  // Footfall is sized to the board; a save from before it existed, or from a
  // different board size, gets a fresh one rather than a ragged array.
  const cells = grid.length * (grid[0]?.length ?? 0);
  if (!Array.isArray(state.footfall) || state.footfall.length !== cells) {
    state.footfall = new Array(cells).fill(0);
  }
  for (const resident of state.residents) {
    resident.masteryTier ??= 0;
    resident.taught ??= 0;
  }
  state.wantsMet ??= 0;
  state.wantsMissed ??= 0;
  state.districtFocusDay ??= state.day;
  state.selfBuildDay ??= state.day;
  /*
   * Requests gained a deadline and a payout. A resident carrying a want from
   * before that change would have had neither, and the petition list reads the
   * reward's label directly — an undefined item there took the whole HUD down
   * on the first render.
   */
  for (const resident of state.residents) {
    const want = resident.want;
    if (!want) continue;
    want.deadlineDay ??= (want.createdDay ?? state.day) + 6;
    want.rewardItem ??= "seed-pod";
    want.rewardAmount ??= 2;
  }
  state.crafted ??= { "lantern-kit": 0, "bridge-kit": 0, "comfort-kit": 0, "sky-lantern": 0 };
  state.crafted["sky-lantern"] ??= 0;
  state.forecastHistory ??= [state.forecast];
  state.forecastCursor ??= Math.max(0, state.forecastHistory.length - 1);
  state.marketShortages ??= [];
  state.titleSeen ??= false;
  for (const resident of state.residents) {
    if ((resident.species as Species | string) === "cloudmoth") continue;
  }
  return state;
}
