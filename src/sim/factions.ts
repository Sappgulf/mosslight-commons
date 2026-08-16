import { SPECIES_DEFINITIONS } from "../data/definitions";
import type { SeededRandom } from "./simulation";
import type { Faction, FactionKind, HistoryEntry, Resident, Season, Species, WorldState } from "./types";

/**
 * Blocs: what people form when the Commons stops answering them.
 *
 * The settlement had exactly one social structure — everyone, equally, in one
 * undifferentiated population — and a council that spoke for species rather
 * than for anybody's convictions. Nothing could organise, split off, or hold a
 * belief the Commons disagreed with, so a hundred residents were a hundred
 * copies of the same civic attitude.
 *
 * A bloc takes one of three shapes, and which one it takes is decided by *why*
 * it formed rather than by a roll:
 *
 * - a **faction** organises around a species' interests when harmony is thin
 *   and that species is numerous enough to press a case;
 * - a **cult** forms around somebody who lived through something terrible, and
 *   recruits the people the Commons is failing;
 * - a **lone wolf** is one resident who stops answering to any of it.
 *
 * Every bloc keeps its own history, written as things actually happen to it,
 * so a settlement's politics can be read back afterwards.
 */

/** Belonging below which a resident is open to being recruited. */
const RECRUITABLE_BELONGING = 42;

/** Harmony below which species factions start to organise. */
const FACTION_HARMONY = 58;

/** A species needs this many present before it can press a case as a bloc. */
const FACTION_MIN_SPECIES = 6;

/** Belonging below which a resilient resident may simply walk away from it all. */
const LONE_BELONGING = 18;

/**
 * Days between any two blocs forming.
 *
 * The first cut used six, which produced eight blocs in forty-six days — most
 * of them one person, a name in the ledger every week, and none of them
 * memorable. A bloc should be a thing a run is remembered for.
 */
export const FOUNDING_COOLDOWN = 22;

/** Blocs the settlement can sustain at once. Past this, discontent has a home already. */
const MAX_ACTIVE_BLOCS = 3;

/** A faction is a bloc, not a person: this many must be willing before it forms. */
const FACTION_QUORUM = 3;

/** Members below which a bloc dissolves. */
const DISSOLVE_AT = 1;

const FACTION_NAMES = {
  first: ["Reed", "Root", "Ash", "Lantern", "Mire", "Bramble", "Stone", "Shade", "Amber", "Fen"],
  second: ["Covenant", "Circle", "Assembly", "Bloc", "Hand", "Compact", "Union", "Bough"],
} as const;

const CULT_NAMES = {
  first: ["Long", "Silent", "Drowned", "Hollow", "Unlit", "Pale", "Deep", "Waning"],
  second: ["Watch", "Vigil", "Chorus", "Communion", "Mourning", "Lantern", "Wake", "Choir"],
} as const;

/** What a bloc actually wants, which is what the Commons can satisfy or refuse. */
export const DOCTRINES = {
  provision: {
    label: "Provision",
    creed: "No one in the Commons should go to the stalls and find them empty.",
    wants: "food",
  },
  shelter: {
    label: "Shelter",
    creed: "A burrow for every back before a lantern for any path.",
    wants: "warmth",
  },
  light: {
    label: "The Lit Path",
    creed: "Keep the routes bright and the dark keeps its distance.",
    wants: "light",
  },
  water: {
    label: "Clean Water",
    creed: "The basin was here before us and will outlast us. Keep it clean.",
    wants: "water",
  },
  memory: {
    label: "Long Memory",
    creed: "What the Commons survived, it must not be allowed to forget.",
    wants: "harmony",
  },
  solitude: {
    label: "Solitude",
    creed: "I answer to the basin, not to the ledger.",
    wants: "none",
  },
} as const;

export type DoctrineKey = keyof typeof DOCTRINES;

const CULT_DOCTRINES: DoctrineKey[] = ["memory", "light", "water"];
const FACTION_DOCTRINES: DoctrineKey[] = ["provision", "shelter", "light", "water"];

/** A short, deterministic emblem seed so the renderer can draw the same mark twice. */
function emblemSeed(rng: SeededRandom): number {
  return rng.int(1, 0xffff);
}

function note(state: WorldState, text: string): HistoryEntry {
  return { day: state.day, season: state.season, text };
}

/** Adds to a bloc's history, keeping it bounded. */
export function record(faction: Faction, state: WorldState, text: string): void {
  faction.history.push(note(state, text));
  if (faction.history.length > 12) faction.history.splice(0, faction.history.length - 12);
}

function nameFor(kind: FactionKind, rng: SeededRandom, founder: Resident): string {
  if (kind === "lone") return `${founder.name}, Unbound`;
  const bank = kind === "cult" ? CULT_NAMES : FACTION_NAMES;
  return `The ${rng.pick([...bank.first])} ${rng.pick([...bank.second])}`;
}

function countSpecies(state: WorldState, species: Species): number {
  let total = 0;
  for (const resident of state.residents) if (resident.species === species) total += 1;
  return total;
}

export function membersOf(state: WorldState, faction: Faction): Resident[] {
  const ids = new Set(faction.memberIds);
  return state.residents.filter((resident) => ids.has(resident.id));
}

export function factionOf(state: WorldState, residentId: string): Faction | undefined {
  return state.factions.find((faction) => faction.active && faction.memberIds.includes(residentId));
}

/**
 * Creates a bloc around a founder. Exported so tests can stand one up without
 * having to drive a settlement into the conditions that produce one.
 */
export function foundFaction(
  state: WorldState,
  rng: SeededRandom,
  kind: FactionKind,
  founder: Resident,
  doctrine: DoctrineKey,
): Faction {
  const faction: Faction = {
    id: `faction-${state.factions.length + 1}`,
    kind,
    name: nameFor(kind, rng, founder),
    emblem: emblemSeed(rng),
    foundedDay: state.day,
    founderId: founder.id,
    founderName: founder.name,
    species: founder.species,
    doctrine,
    creed: DOCTRINES[doctrine].creed,
    memberIds: [founder.id],
    standing: kind === "lone" ? 30 : 55,
    history: [],
    active: true,
  };

  const origin = kind === "cult"
    ? `${founder.name} came through the ${founder.memories.at(-1) ? "Long Shade" : "hard season"} and would not let it be forgotten.`
    : kind === "lone"
      ? `${founder.name} stopped answering the ledger and walked out to the basin's edge.`
      : `${founder.name} spoke for the ${SPECIES_DEFINITIONS[founder.species].label}s when nobody else would.`;

  faction.history.push(note(state, `Founded on day ${state.day}. ${origin}`));
  state.factions.push(faction);
  return faction;
}

export interface FactionTick {
  founded: Faction[];
  dissolved: Faction[];
  recruited: Array<{ faction: Faction; resident: Resident }>;
}

/**
 * How well the Commons is currently serving what a bloc believes in. 0-100.
 */
export function satisfaction(state: WorldState, faction: Faction): number {
  const wants = DOCTRINES[faction.doctrine as DoctrineKey].wants;
  if (wants === "none") return 50;
  if (wants === "harmony") return state.metrics.harmony;
  const storage = state.metrics.storage[wants] || 100;
  return Math.max(0, Math.min(100, (state.resources[wants] / storage) * 100));
}

/**
 * One day of bloc politics: who forms, who joins, who gives up.
 *
 * Deliberately slow. Blocs are meant to be the memorable structure of a
 * particular run, not a constant churn of names in the ledger.
 */
export function tickFactions(state: WorldState, rng: SeededRandom): FactionTick {
  state.factions ??= [];
  const result: FactionTick = { founded: [], dissolved: [], recruited: [] };

  // Standing follows whether the Commons is actually serving the belief.
  for (const faction of state.factions) {
    if (!faction.active) continue;
    const served = satisfaction(state, faction);
    const drift = (served - 50) / 25;
    const previous = faction.standing;
    faction.standing = Math.max(0, Math.min(100, faction.standing + drift));
    if (previous >= 30 && faction.standing < 30) {
      record(faction, state, `Standing fell to ${Math.round(faction.standing)}. The Commons is not listening.`);
    } else if (previous < 70 && faction.standing >= 70) {
      record(faction, state, `Standing rose to ${Math.round(faction.standing)}. The Commons has been good to them.`);
    }

    // Members who left the settlement are no longer members of anything.
    const before = faction.memberIds.length;
    const present = new Set(state.residents.map((resident) => resident.id));
    faction.memberIds = faction.memberIds.filter((id) => present.has(id));
    if (faction.memberIds.length < before) {
      record(faction, state, `${before - faction.memberIds.length} left the Commons entirely.`);
    }

    if (faction.memberIds.length < DISSOLVE_AT) {
      faction.active = false;
      record(faction, state, `Dissolved on day ${state.day}. Nobody was left to keep it.`);
      result.dissolved.push(faction);
    }
  }

  const active = state.factions.filter((faction) => faction.active);
  const claimed = new Set(active.flatMap((faction) => faction.memberIds));

  // Recruiting: a bloc speaks to whoever the Commons is failing.
  for (const faction of active) {
    if (faction.kind === "lone") continue;
    const candidates = state.residents.filter(
      (resident) =>
        !claimed.has(resident.id) &&
        resident.stage !== "sprout" &&
        resident.needs.belonging < RECRUITABLE_BELONGING &&
        (faction.kind === "faction" ? resident.species === faction.species : true),
    );
    if (candidates.length === 0) continue;
    // One at a time, and only sometimes: a bloc grows by persuasion.
    if (rng.next() > 0.45) continue;
    const recruit = rng.pick(candidates);
    faction.memberIds.push(recruit.id);
    claimed.add(recruit.id);
    recruit.needs.belonging = Math.min(100, recruit.needs.belonging + 12);
    record(faction, state, `${recruit.name} joined. ${faction.memberIds.length} now hold to it.`);
    result.recruited.push({ faction, resident: recruit });
  }

  // A lone wolf is one person walking out, not a bloc organising, so it is not
  // held behind the founding cooldown — but it is rare, and it needs somebody
  // genuinely at the end of their tether.
  const unclaimedNow = state.residents.filter(
    (resident) => !claimed.has(resident.id) && resident.stage !== "sprout",
  );
  const wolf = unclaimedNow.find(
    (resident) => resident.needs.belonging < LONE_BELONGING && resident.traits.resilience > 0.6,
  );
  if (wolf && rng.next() < 0.25) {
    const faction = foundFaction(state, rng, "lone", wolf, "solitude");
    result.founded.push(faction);
    claimed.add(wolf.id);
  }

  // Organised blocs are rate-limited, and capped: past a point, everyone who
  // is unhappy already has somewhere to take it.
  const organised = state.factions.filter((faction) => faction.active && faction.kind !== "lone");
  if (organised.length >= MAX_ACTIVE_BLOCS) return result;

  const sinceLast = state.day - (state.lastFoundingDay ?? -FOUNDING_COOLDOWN);
  if (sinceLast < FOUNDING_COOLDOWN) return result;

  const unclaimed = state.residents.filter(
    (resident) => !claimed.has(resident.id) && resident.stage !== "sprout",
  );
  const discontented = unclaimed.filter((resident) => resident.needs.belonging < RECRUITABLE_BELONGING);

  // A cult forms around somebody who lived through something hard, and needs
  // people for it to speak to.
  const scarred = discontented.find((resident) =>
    resident.memories.some((memory) => memory.tone === "hard"),
  );
  if (scarred && discontented.length >= 2) {
    const faction = foundFaction(state, rng, "cult", scarred, rng.pick(CULT_DOCTRINES));
    state.lastFoundingDay = state.day;
    result.founded.push(faction);
    return result;
  }

  // A species faction organises when harmony is thin, they have numbers, and
  // enough of them are actually unhappy to make a bloc rather than a lone voice.
  if (state.metrics.harmony < FACTION_HARMONY) {
    const speaker = discontented.find((resident) => {
      if (countSpecies(state, resident.species) < FACTION_MIN_SPECIES) return false;
      // No second bloc for a species that already has one.
      if (organised.some((faction) => faction.kind === "faction" && faction.species === resident.species)) return false;
      const willing = discontented.filter((other) => other.species === resident.species).length;
      return willing >= FACTION_QUORUM;
    });
    if (speaker) {
      const faction = foundFaction(state, rng, "faction", speaker, rng.pick(FACTION_DOCTRINES));
      state.lastFoundingDay = state.day;
      result.founded.push(faction);
    }
  }

  return result;
}
