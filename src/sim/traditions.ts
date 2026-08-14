import type { ItemKey, TraditionKey, WorldState } from "./types";

/**
 * Practices the Commons takes up permanently.
 *
 * A play-through finished its whole ledger by day 58 and then had nothing left
 * to want, while piling up hundreds of seed pods with nowhere to spend them.
 * Traditions are both halves of that gap: a sink for gathered goods, and a set
 * of lasting choices that leave one settlement genuinely different from
 * another. They are never lost once taken up.
 */
export interface TraditionDefinition {
  readonly key: TraditionKey;
  readonly label: string;
  readonly icon: string;
  /** What the Commons gains, in the player's words. */
  readonly effect: string;
  readonly cost: Partial<Record<ItemKey, number>>;
  /** Chapter the practice becomes available in. */
  readonly chapter: number;
}

export const TRADITION_DEFINITIONS: Record<TraditionKey, TraditionDefinition> = {
  "seed-vault": {
    key: "seed-vault",
    label: "Seed Vault",
    icon: "❖",
    effect: "Reed farms yield a fifth more, in every season.",
    cost: { "seed-pod": 14 },
    chapter: 0,
  },
  "open-table": {
    key: "open-table",
    label: "Open Table",
    icon: "◈",
    effect: "The Commons holds more food and water, and meals go further.",
    cost: { "seed-pod": 10, moonwater: 4 },
    chapter: 1,
  },
  hearthcraft: {
    key: "hearthcraft",
    label: "Hearthcraft",
    icon: "◉",
    effect: "Burrows keep their warmth, and rest restores more.",
    cost: { resin: 6 },
    chapter: 1,
  },
  "lantern-vigil": {
    key: "lantern-vigil",
    label: "Lantern Vigil",
    icon: "✧",
    effect: "Lantern light reaches half again as far across the basin.",
    cost: { moonwater: 8, resin: 4 },
    chapter: 2,
  },
  "long-memory": {
    key: "long-memory",
    label: "Long Memory",
    icon: "⌁",
    effect: "Every resident learns their craft markedly faster.",
    cost: { "map-fragment": 6, "seed-pod": 12 },
    chapter: 2,
  },
};

export const TRADITION_ORDER: readonly TraditionKey[] = [
  "seed-vault",
  "open-table",
  "hearthcraft",
  "lantern-vigil",
  "long-memory",
];

export function hasTradition(state: WorldState, key: TraditionKey): boolean {
  return state.traditions.includes(key);
}

/** Whether the Commons could pay for a practice right now. */
export function canAfford(state: WorldState, key: TraditionKey): boolean {
  const definition = TRADITION_DEFINITIONS[key];
  return (Object.entries(definition.cost) as Array<[ItemKey, number]>).every(
    ([item, amount]) => state.items[item] >= amount,
  );
}

/** What is still missing before a practice can be taken up. */
export function missingFor(state: WorldState, key: TraditionKey): Array<{ item: ItemKey; amount: number }> {
  const definition = TRADITION_DEFINITIONS[key];
  return (Object.entries(definition.cost) as Array<[ItemKey, number]>)
    .filter(([item, amount]) => state.items[item] < amount)
    .map(([item, amount]) => ({ item, amount: amount - state.items[item] }));
}

export function isAvailable(state: WorldState, key: TraditionKey): boolean {
  return state.chapter >= TRADITION_DEFINITIONS[key].chapter && !hasTradition(state, key);
}
