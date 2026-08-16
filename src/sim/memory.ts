import type { LongShadeOutcome, Memory, Resident, WorldState } from "./types";

/**
 * The Commons remembers what its residents lived through.
 *
 * A settlement that scraped through a Long Shade and one that sailed through it
 * read identically afterwards — the crisis resolved, a line went into the
 * ledger, and nothing carried forward. Memories sit on the residents who were
 * actually there, so the settlement's history is held by particular people and
 * leaves with them when they go.
 */

/** How many memories one resident keeps. Oldest are dropped first. */
export const MEMORY_LIMIT = 4;

/** Only residents old enough to understand it remember an event. */
const REMEMBERS = new Set(["adult", "elder"]);

const LONG_SHADE_MEMORY: Record<LongShadeOutcome & string, { text: string; tone: Memory["tone"] }> = {
  thrived: {
    text: "I stood the Long Shade when the lanterns held. We never once went dark.",
    tone: "good",
  },
  strained: {
    text: "I stood the Long Shade when the light guttered. We came through thinner than we went in.",
    tone: "hard",
  },
  failed: {
    text: "I stood the Long Shade when the light failed. I do not care to talk about that season.",
    tone: "hard",
  },
  pending: { text: "", tone: "hard" },
};

/** Appends a memory, keeping only the most recent {@link MEMORY_LIMIT}. */
export function remember(resident: Resident, memory: Memory): void {
  resident.memories ??= [];
  resident.memories.push(memory);
  if (resident.memories.length > MEMORY_LIMIT) {
    resident.memories.splice(0, resident.memories.length - MEMORY_LIMIT);
  }
}

/**
 * Records a resolved Long Shade on everyone who was grown when it happened.
 * Returns how many residents now carry it.
 */
export function rememberLongShade(state: WorldState, outcome: LongShadeOutcome | null): number {
  if (!outcome || outcome === "pending") return 0;
  const copy = LONG_SHADE_MEMORY[outcome];
  if (!copy?.text) return 0;

  let recorded = 0;
  for (const resident of state.residents) {
    if (!REMEMBERS.has(resident.stage)) continue;
    remember(resident, { day: state.day, season: state.season, text: copy.text, tone: copy.tone });
    recorded += 1;
  }
  return recorded;
}

/**
 * The resident best placed to speak for the settlement's past: the oldest one
 * who actually remembers something. Undefined while the Commons is still young
 * enough to have no history worth telling.
 */
export function witness(state: WorldState): Resident | undefined {
  let best: Resident | undefined;
  for (const resident of state.residents) {
    if (!resident.memories?.length) continue;
    if (!best || resident.age > best.age) best = resident;
  }
  return best;
}

/** The line a witness would offer, or undefined when nobody remembers anything. */
export function testimony(state: WorldState): { resident: Resident; memory: Memory } | undefined {
  const resident = witness(state);
  const memory = resident?.memories[resident.memories.length - 1];
  if (!resident || !memory) return undefined;
  return { resident, memory };
}
