import { describe, expect, it } from "vitest";

import { MosslightSimulation, SeededRandom } from "../simulation";
import {
  DOCTRINES,
  FOUNDING_COOLDOWN,
  factionOf,
  foundFaction,
  membersOf,
  satisfaction,
  secededFactions,
  strikingResidents,
  tickFactions,
} from "../factions";
import type { Resident, WorldState } from "../types";

const SEED = 20260811;

function world(): { simulation: MosslightSimulation; state: WorldState; rng: SeededRandom } {
  const simulation = new MosslightSimulation(SEED);
  return { simulation, state: simulation.state, rng: new SeededRandom(7) };
}

/** Makes everyone miserable enough to be recruitable. */
function disaffect(state: WorldState, belonging = 20): void {
  for (const resident of state.residents) resident.needs.belonging = belonging;
}

/** Runs a day of politics repeatedly, moving the clock so cooldowns expire. */
function days(state: WorldState, rng: SeededRandom, count: number): void {
  for (let index = 0; index < count; index += 1) {
    state.day += 1;
    tickFactions(state, rng);
  }
}

describe("blocs form for a reason", () => {
  it("produces nothing in a contented settlement", () => {
    const { state, rng } = world();
    for (const resident of state.residents) resident.needs.belonging = 90;
    state.metrics.harmony = 90;
    days(state, rng, 60);
    expect(state.factions.filter((faction) => faction.active)).toHaveLength(0);
  });

  it("organises a species faction when harmony is thin and enough are unhappy", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 30;
    days(state, rng, 40);

    const factions = state.factions.filter((faction) => faction.kind === "faction");
    expect(factions.length).toBeGreaterThan(0);
    expect(factions[0]!.memberIds.length).toBeGreaterThan(0);
    expect(factions[0]!.creed).not.toBe("");
  });

  it("forms a cult around someone carrying a hard memory", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 90; // rule factions out, so only the cult path can fire
    const scarred = state.residents[0]!;
    scarred.memories = [{ day: 3, season: "longshade", text: "I stood the Long Shade.", tone: "hard" }];

    days(state, rng, 40);
    const cults = state.factions.filter((faction) => faction.kind === "cult");
    expect(cults.length).toBeGreaterThan(0);
    expect(cults[0]!.memberIds).toContain(scarred.id);
  });

  it("lets one desperate, resilient resident walk out alone", () => {
    const { state, rng } = world();
    for (const resident of state.residents) {
      resident.needs.belonging = 60;
      resident.traits.resilience = 0.1;
    }
    state.metrics.harmony = 90;
    const wolf = state.residents[0]!;
    wolf.needs.belonging = 5;
    wolf.traits.resilience = 0.95;

    days(state, rng, 60);
    const lone = state.factions.filter((faction) => faction.kind === "lone");
    expect(lone.length).toBeGreaterThan(0);
    expect(lone[0]!.memberIds).toEqual([wolf.id]);
    expect(lone[0]!.name).toContain("Unbound");
  });
});

describe("blocs do not overrun the settlement", () => {
  it("caps how many organise at once", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 20;
    days(state, rng, 400);

    const organised = state.factions.filter((faction) => faction.active && faction.kind !== "lone");
    expect(organised.length).toBeLessThanOrEqual(3);
  });

  it("holds a cooldown between foundings", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 20;

    days(state, rng, 1);
    const first = state.factions.filter((faction) => faction.kind !== "lone").length;
    days(state, rng, FOUNDING_COOLDOWN - 2);
    const second = state.factions.filter((faction) => faction.kind !== "lone").length;
    expect(second).toBe(first);
  });

  it("will not give one species two factions", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 20;
    days(state, rng, 400);

    const species = state.factions
      .filter((faction) => faction.active && faction.kind === "faction")
      .map((faction) => faction.species);
    expect(new Set(species).size).toBe(species.length);
  });
});

describe("a bloc keeps its own account", () => {
  it("records its founding, and its history is bounded", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "cult", state.residents[0]!, "memory");
    expect(faction.history).toHaveLength(1);
    expect(faction.history[0]!.text).toContain("Founded on day");

    for (let index = 0; index < 40; index += 1) {
      faction.history.push({ day: index, season: "mosswake", text: `entry ${index}` });
    }
    disaffect(state);
    days(state, rng, 5);
    expect(faction.history.length).toBeLessThanOrEqual(44);
  });

  it("dissolves when the last member is gone, and says so", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "cult", state.residents[0]!, "memory");
    state.residents = [];
    days(state, rng, 1);

    expect(faction.active).toBe(false);
    expect(faction.history.at(-1)!.text).toContain("Dissolved");
  });

  it("keeps the founder's name after they are gone", () => {
    const { state, rng } = world();
    const founder = state.residents[0]!;
    const faction = foundFaction(state, rng, "faction", founder, "provision");
    state.residents = state.residents.filter((resident) => resident.id !== founder.id);
    days(state, rng, 1);
    expect(faction.founderName).toBe(founder.name);
  });
});

describe("standing follows whether the Commons delivers", () => {
  it("reads satisfaction from the thing the bloc actually wants", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    state.resources.food = state.metrics.storage.food;
    expect(satisfaction(state, faction)).toBeGreaterThan(90);
    state.resources.food = 0;
    expect(satisfaction(state, faction)).toBe(0);
  });

  it("rises when served and falls when ignored", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    faction.standing = 50;

    state.resources.food = 0;
    days(state, rng, 10);
    const afterNeglect = faction.standing;
    expect(afterNeglect).toBeLessThan(50);

    state.resources.food = state.metrics.storage.food;
    days(state, rng, 10);
    expect(faction.standing).toBeGreaterThan(afterNeglect);
  });

  it("treats a lone wolf as answering to nobody", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "lone", state.residents[0]!, "solitude");
    expect(satisfaction(state, faction)).toBe(50);
    expect(DOCTRINES.solitude.wants).toBe("none");
  });
});

describe("membership", () => {
  it("resolves members and looks a resident's bloc up", () => {
    const { state, rng } = world();
    const founder = state.residents[0]!;
    const faction = foundFaction(state, rng, "cult", founder, "memory");
    expect(membersOf(state, faction).map((resident: Resident) => resident.id)).toEqual([founder.id]);
    expect(factionOf(state, founder.id)?.id).toBe(faction.id);
    expect(factionOf(state, "nobody")).toBeUndefined();
  });

  it("never puts one resident in two blocs", () => {
    const { state, rng } = world();
    disaffect(state);
    state.metrics.harmony = 20;
    days(state, rng, 300);

    const seen = new Set<string>();
    for (const faction of state.factions.filter((entry) => entry.active)) {
      for (const id of faction.memberIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });
});

describe("a bloc acts on being ignored", () => {
  it("escalates from content to restless to striking", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    expect(faction.stance).toBe("content");

    /*
     * Standing starts at 55 and falls two a day while the doctrine goes
     * unanswered, so unrest does not even begin until the middle of a season.
     * A bloc is slow to anger on purpose.
     */
    state.resources.food = 0;
    days(state, rng, 15);
    expect(faction.stance).toBe("restless");

    days(state, rng, 6);
    expect(faction.stance).toBe("striking");
  });

  it("puts the grievance down when the Commons delivers", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    state.resources.food = 0;
    days(state, rng, 22);
    expect(faction.stance).toBe("striking");

    state.resources.food = state.metrics.storage.food;
    days(state, rng, 30);
    expect(faction.stance).toBe("content");
    expect(faction.unrestDays).toBe(0);
  });

  it("names its strikers so production can feel it", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    expect(strikingResidents(state).size).toBe(0);

    state.resources.food = 0;
    days(state, rng, 22);
    expect(faction.stance).toBe("striking");
    expect(strikingResidents(state).has(state.residents[0]!.id)).toBe(true);
  });

  it("secedes only after a long strike goes unanswered", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    state.resources.food = 0;

    days(state, rng, 15);
    expect(secededFactions(state)).toHaveLength(0);

    days(state, rng, 40);
    expect(faction.stance).toBe("seceded");
    expect(secededFactions(state).map((entry) => entry.id)).toContain(faction.id);
  });

  it("never asks a lone wolf to strike — they already left", () => {
    const { state, rng } = world();
    const faction = foundFaction(state, rng, "lone", state.residents[0]!, "solitude");
    state.resources.food = 0;
    days(state, rng, 60);
    expect(faction.stance).toBe("content");
    expect(strikingResidents(state).size).toBe(0);
  });
});

describe("secession costs the settlement", () => {
  it("takes its members out of the Commons", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    const rng = new SeededRandom(7);
    const faction = foundFaction(state, rng, "faction", state.residents[0]!, "provision");
    faction.memberIds = state.residents.slice(0, 4).map((resident) => resident.id);

    // Drive them out through the simulation's own daily stage.
    const before = state.residents.length;
    faction.stance = "seceded";
    for (let tick = 0; tick < 12; tick += 1) simulation.advance();

    expect(state.residents.length).toBeLessThan(before);
    expect(faction.active).toBe(false);
    expect(state.history.some((message) => message.text.includes("SECESSION"))).toBe(true);
  });
});
