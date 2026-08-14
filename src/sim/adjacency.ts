import type { Building, BuildingType, TileKind, Vec2 } from "./types";

export interface AdjacencyResult {
  /** Multiplier applied to this building's output. 1 is neutral. */
  multiplier: number;
  /** Player-facing lines explaining how the multiplier was reached. */
  notes: Array<{ text: string; good: boolean }>;
}

export interface AdjacencyContext {
  grid: TileKind[][];
  buildings: Building[];
  /** Excluded from neighbour checks when previewing a not-yet-placed building. */
  ignoreId?: string;
}

const chebyshev = (a: Vec2, b: Vec2) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function countAdjacentTiles(grid: TileKind[][], position: Vec2, kinds: TileKind[]): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const tile = grid[position.y + dy]?.[position.x + dx];
      if (tile && kinds.includes(tile)) count += 1;
    }
  }
  return count;
}

function nearby(
  context: AdjacencyContext,
  position: Vec2,
  type: BuildingType,
  radius: number,
): Building[] {
  return context.buildings.filter(
    (building) =>
      building.type === type
      && building.id !== context.ignoreId
      && chebyshev(building.position, position) <= radius
      && chebyshev(building.position, position) > 0,
  );
}

/**
 * Placement bonuses and penalties.
 *
 * Before this, every plot was interchangeable: a Reed Farm produced the same
 * amount anywhere it was legal, so choosing *where* to build carried no
 * decision. These rules give the map opinions — water feeds farms, lanterns
 * want homes to light, workshops are noisy neighbours — which is what turns
 * placement into a puzzle rather than a formality.
 */
export function evaluateAdjacency(
  type: BuildingType,
  position: Vec2,
  context: AdjacencyContext,
): AdjacencyResult {
  const notes: AdjacencyResult["notes"] = [];
  let multiplier = 1;

  switch (type) {
    case "reed-farm": {
      const water = countAdjacentTiles(context.grid, position, ["water", "wetland"]);
      if (water > 0) {
        const bonus = Math.min(0.45, water * 0.12);
        multiplier += bonus;
        notes.push({ text: `Fed by ${water} water ${water === 1 ? "tile" : "tiles"} · +${Math.round(bonus * 100)}%`, good: true });
      } else {
        multiplier -= 0.25;
        notes.push({ text: "No water alongside · −25%", good: false });
      }
      const crowding = nearby(context, position, "reed-farm", 2).length;
      if (crowding > 0) {
        multiplier -= crowding * 0.12;
        notes.push({ text: `${crowding} farm${crowding === 1 ? "" : "s"} competing for the same reeds · −${crowding * 12}%`, good: false });
      }
      break;
    }

    case "lantern-grove": {
      const homes = nearby(context, position, "burrow-home", 4).length;
      if (homes > 0) {
        const bonus = Math.min(0.4, homes * 0.1);
        multiplier += bonus;
        notes.push({ text: `Lighting ${homes} ${homes === 1 ? "burrow" : "burrows"} · +${Math.round(bonus * 100)}%`, good: true });
      } else {
        notes.push({ text: "No burrows in reach — light falls on empty ground", good: false });
      }
      const overlap = nearby(context, position, "lantern-grove", 3).length;
      if (overlap > 0) {
        multiplier -= overlap * 0.22;
        notes.push({ text: `Light overlaps ${overlap} grove${overlap === 1 ? "" : "s"} · −${overlap * 22}%`, good: false });
      }
      break;
    }

    case "burrow-home": {
      if (nearby(context, position, "lantern-grove", 4).length > 0) {
        multiplier += 0.18;
        notes.push({ text: "Warm under a lantern grove · +18%", good: true });
      }
      if (nearby(context, position, "root-workshop", 2).length > 0) {
        multiplier -= 0.2;
        notes.push({ text: "The workshop keeps this burrow awake · −20%", good: false });
      }
      if (nearby(context, position, "commons-market", 4).length > 0) {
        multiplier += 0.1;
        notes.push({ text: "A short walk to the market · +10%", good: true });
      }
      break;
    }

    case "commons-market": {
      const kinds = new Set(
        context.buildings
          .filter(
            (building) =>
              building.id !== context.ignoreId
              && building.type !== "commons-market"
              && chebyshev(building.position, position) <= 5,
          )
          .map((building) => building.type),
      );
      if (kinds.size > 0) {
        const bonus = Math.min(0.32, kinds.size * 0.08);
        multiplier += bonus;
        notes.push({ text: `Trading with ${kinds.size} kinds of neighbour · +${Math.round(bonus * 100)}%`, good: true });
      } else {
        multiplier -= 0.15;
        notes.push({ text: "Nothing nearby to trade with · −15%", good: false });
      }
      break;
    }

    case "root-workshop": {
      const onPath = countAdjacentTiles(context.grid, position, ["path"]);
      if (onPath > 0) {
        multiplier += 0.2;
        notes.push({ text: "Materials arrive by road · +20%", good: true });
      } else {
        notes.push({ text: "No road alongside — hauling is slow", good: false });
      }
      const ruins = countAdjacentTiles(context.grid, position, ["ruin"]);
      if (ruins > 0) {
        multiplier += 0.15;
        notes.push({ text: "Old ruins to salvage from · +15%", good: true });
      }
      break;
    }

    case "sky-walk": {
      const groves = nearby(context, position, "lantern-grove", 4).length;
      if (groves > 0) {
        const bonus = Math.min(0.3, groves * 0.12);
        multiplier += bonus;
        notes.push({ text: `Lanterns travel the walk · +${Math.round(bonus * 100)}%`, good: true });
      }
      const mothsNearby = nearby(context, position, "sky-walk", 3).length;
      if (mothsNearby > 0) {
        multiplier -= mothsNearby * 0.14;
        notes.push({ text: `Walks overlapping · −${mothsNearby * 14}%`, good: false });
      }
      break;
    }

    default:
      break;
  }

  return { multiplier: Math.max(0.4, multiplier), notes };
}
