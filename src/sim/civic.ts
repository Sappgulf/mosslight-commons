import { PROPOSAL_DEFINITIONS } from "../data/definitions";
import type {
  Building,
  CouncilProposal,
  Forecast,
  MarketShortage,
  ProposalKind,
  Species,
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

export function nextProposal(day: number, chapter: number, id: number): CouncilProposal {
  const kinds: ProposalKind[] = chapter >= 2
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
  };
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
  state.proposal ??= null;
  state.forecastHistory ??= [state.forecast];
  state.forecastCursor ??= Math.max(0, state.forecastHistory.length - 1);
  state.marketShortages ??= [];
  state.titleSeen ??= false;
  for (const resident of state.residents) {
    if ((resident.species as Species | string) === "cloudmoth") continue;
  }
  return state;
}
