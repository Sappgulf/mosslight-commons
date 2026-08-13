import type { Building, BuildingType, Relationship, Resident, Vec2, WantKind } from "./types";

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const WANT_GLYPH: Record<WantKind, string> = {
  lantern: "✦",
  neighbour: "⌂",
  market: "◈",
  quiet: "◦",
  company: "♥",
};

export function describeWant(resident: Resident, kind: WantKind, homeLabel: string): string {
  const descriptions: Record<WantKind, string> = {
    lantern: `${resident.name} would like a Lantern Grove near ${homeLabel}.`,
    neighbour: `${resident.name} would like another Burrow Home raised nearby.`,
    market: `${resident.name} wants the market within easy walking distance.`,
    quiet: `${resident.name} wants the workshop noise away from ${homeLabel}.`,
    company: `${resident.name} is hoping for a closer friendship.`,
  };
  return descriptions[kind];
}

export function isWantSatisfied(
  resident: Resident,
  kind: WantKind,
  buildings: Building[],
  relationships: Relationship[],
  home?: Building,
): boolean {
  const near = (type: BuildingType, radius: number): boolean => {
    if (!home) return false;
    return buildings.some(
      (building) => building.type === type && manhattan(building.position, home.position) <= radius,
    );
  };

  switch (kind) {
    case "lantern":
      return near("lantern-grove", 5);
    case "neighbour":
      return buildings.filter(
        (building) => building.type === "burrow-home" && home && manhattan(building.position, home.position) <= 6,
      ).length > 1;
    case "market":
      return near("commons-market", 7);
    case "quiet":
      return !near("root-workshop", 3);
    case "company":
      return relationships.some(
        (relationship) =>
          (relationship.aId === resident.id || relationship.bId === resident.id)
          && relationship.kind !== "rivalry"
          && relationship.strength >= 72,
      );
    default:
      return true;
  }
}

export function unmetWantKinds(
  resident: Resident,
  buildings: Building[],
  relationships: Relationship[],
  home?: Building,
): WantKind[] {
  return (["lantern", "neighbour", "market", "quiet", "company"] as WantKind[])
    .filter((kind) => !isWantSatisfied(resident, kind, buildings, relationships, home));
}
