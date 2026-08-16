import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { MEMORY_LIMIT, remember, rememberLongShade, testimony, witness } from "../memory";
import type { Memory, Resident } from "../types";

const SEED = 20260811;

const note = (day: number): Memory => ({ day, season: "mosswake", text: `note ${day}`, tone: "good" });

describe("remembering", () => {
  it("keeps only the most recent memories", () => {
    const resident = { memories: [] } as unknown as Resident;
    for (let day = 1; day <= MEMORY_LIMIT + 3; day += 1) remember(resident, note(day));

    expect(resident.memories).toHaveLength(MEMORY_LIMIT);
    // The oldest are the ones dropped, and order is preserved.
    expect(resident.memories[0]!.day).toBe(4);
    expect(resident.memories.at(-1)!.day).toBe(MEMORY_LIMIT + 3);
  });

  it("copes with a resident loaded from a save that predates memories", () => {
    const resident = {} as unknown as Resident;
    remember(resident, note(1));
    expect(resident.memories).toHaveLength(1);
  });
});

describe("a resolved Long Shade", () => {
  it("is remembered by everyone grown at the time, and by no sprout", () => {
    const simulation = new MosslightSimulation(SEED);
    const sprouts = simulation.state.residents.filter((resident) => resident.stage === "sprout").length;
    const grown = simulation.state.residents.length - sprouts;

    const recorded = rememberLongShade(simulation.state, "strained");
    expect(recorded).toBe(grown);

    for (const resident of simulation.state.residents) {
      if (resident.stage === "sprout") expect(resident.memories).toHaveLength(0);
      else expect(resident.memories).toHaveLength(1);
    }
  });

  it("records the outcome that actually happened", () => {
    const simulation = new MosslightSimulation(SEED);
    rememberLongShade(simulation.state, "thrived");
    const carried = simulation.state.residents.find((resident) => resident.memories.length > 0);
    expect(carried!.memories[0]!.tone).toBe("good");
    expect(carried!.memories[0]!.text).toContain("lanterns held");
  });

  it("records nothing while the crisis is unresolved", () => {
    const simulation = new MosslightSimulation(SEED);
    expect(rememberLongShade(simulation.state, "pending")).toBe(0);
    expect(rememberLongShade(simulation.state, null)).toBe(0);
  });
});

describe("who speaks for the Commons", () => {
  it("says nothing while the settlement has no history", () => {
    const simulation = new MosslightSimulation(SEED);
    expect(witness(simulation.state)).toBeUndefined();
    expect(testimony(simulation.state)).toBeUndefined();
  });

  it("is the oldest resident who actually remembers something", () => {
    const simulation = new MosslightSimulation(SEED);
    const [young, old] = [...simulation.state.residents].sort((a, b) => a.age - b.age);
    young!.age = 5;
    old!.age = 99;

    // Only the younger one remembers: age alone must not make a witness.
    remember(young!, note(10));
    expect(witness(simulation.state)?.id).toBe(young!.id);

    remember(old!, note(12));
    expect(witness(simulation.state)?.id).toBe(old!.id);
  });

  it("offers that resident's most recent memory", () => {
    const simulation = new MosslightSimulation(SEED);
    const resident = simulation.state.residents[0]!;
    resident.age = 99;
    remember(resident, note(1));
    remember(resident, note(2));

    const spoken = testimony(simulation.state);
    expect(spoken?.resident.id).toBe(resident.id);
    expect(spoken?.memory.day).toBe(2);
  });

  it("forgets the settlement's history when the residents carrying it are gone", () => {
    const simulation = new MosslightSimulation(SEED);
    rememberLongShade(simulation.state, "failed");
    expect(testimony(simulation.state)).toBeDefined();

    simulation.state.residents = [];
    expect(testimony(simulation.state)).toBeUndefined();
  });
});
