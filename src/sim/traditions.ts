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
  /**
   * Practices this one rules out, and which rule it out in turn.
   *
   * Six practices that were all eventually affordable meant every settlement
   * ended up with the same six, so a "lasting choice" was really just a
   * checklist. A Commons that stores its harvest cannot also be the one that
   * gives it away; a Commons built around its hearths is not the one built
   * around its lanterns. Sky Veil is deliberately unpaired — a chapter-four
   * objective requires it, and no choice should be able to lock the ledger.
   */
  readonly excludes?: readonly TraditionKey[];
}

export const TRADITION_DEFINITIONS: Record<TraditionKey, TraditionDefinition> = {
  "seed-vault": {
    key: "seed-vault",
    label: "Seed Vault",
    icon: "❖",
    effect: "Reed farms yield a fifth more, in every season.",
    cost: { "seed-pod": 14 },
    chapter: 0,
    excludes: ["open-table"],
  },
  "open-table": {
    key: "open-table",
    label: "Open Table",
    icon: "◈",
    effect: "The Commons holds more food and water, and meals go further.",
    cost: { "seed-pod": 10, moonwater: 4 },
    chapter: 1,
    excludes: ["seed-vault"],
  },
  hearthcraft: {
    key: "hearthcraft",
    label: "Hearthcraft",
    icon: "◉",
    effect: "Burrows keep their warmth, and rest restores more.",
    cost: { resin: 6 },
    chapter: 1,
    excludes: ["lantern-vigil"],
  },
  "lantern-vigil": {
    key: "lantern-vigil",
    label: "Lantern Vigil",
    icon: "✧",
    effect: "Lantern light reaches half again as far across the basin.",
    cost: { moonwater: 8, resin: 4 },
    chapter: 2,
    excludes: ["hearthcraft"],
  },
  "long-memory": {
    key: "long-memory",
    label: "Long Memory",
    icon: "⌁",
    effect: "Every resident learns their craft markedly faster.",
    cost: { "map-fragment": 6, "seed-pod": 12 },
    chapter: 2,
  },
  "sky-veil": {
    key: "sky-veil",
    label: "Sky Veil",
    icon: "✶",
    effect: "Lanterns reach farther, and Cloudmoths feel they can stay.",
    cost: { moonwater: 6, resin: 3, "map-fragment": 3 },
    chapter: 3,
  },
};

export const TRADITION_ORDER: readonly TraditionKey[] = [
  "seed-vault",
  "open-table",
  "hearthcraft",
  "lantern-vigil",
  "long-memory",
  "sky-veil",
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

/**
 * The practice already kept that rules this one out, if any.
 *
 * Exclusions are declared on both sides, but this checks the whole set rather
 * than trusting that, so a one-sided declaration cannot open a door that should
 * be shut.
 */
export function blockedBy(state: WorldState, key: TraditionKey): TraditionDefinition | undefined {
  for (const held of state.traditions) {
    if (held === key) continue;
    const definition = TRADITION_DEFINITIONS[held];
    if (!definition) continue;
    if (definition.excludes?.includes(key)) return definition;
    if (TRADITION_DEFINITIONS[key].excludes?.includes(held)) return definition;
  }
  return undefined;
}

export function isAvailable(state: WorldState, key: TraditionKey): boolean {
  return (
    state.chapter >= TRADITION_DEFINITIONS[key].chapter &&
    !hasTradition(state, key) &&
    blockedBy(state, key) === undefined
  );
}
