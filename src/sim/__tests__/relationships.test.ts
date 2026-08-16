import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { activeRivalries, benchRivalryPenalty } from "../systems/production";
import type { Resident } from "../types";

const SEED = 20260811;

const worker = (id: string): Resident => ({ id } as Resident);

describe("rivalry is felt on the bench it happens on", () => {
  it("costs nothing when the crew get on", () => {
    expect(benchRivalryPenalty([worker("a"), worker("b")], new Set())).toBe(1);
  });

  it("costs nothing for a lone worker, whoever they dislike", () => {
    expect(benchRivalryPenalty([worker("a")], new Set(["a|b"]))).toBe(1);
  });

  it("costs the bench for each rival pair standing on it", () => {
    const rivals = new Set(["a|b"]);
    expect(benchRivalryPenalty([worker("a"), worker("b")], rivals)).toBeCloseTo(0.92);
  });

  it("does not care which order the pair is stored in", () => {
    const rivals = new Set(["a|b"]);
    expect(benchRivalryPenalty([worker("b"), worker("a")], rivals)).toBeCloseTo(0.92);
  });

  it("never drops a bench below the floor", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const rivals = new Set<string>();
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        rivals.add(`${ids[first]}|${ids[second]}`);
      }
    }
    expect(benchRivalryPenalty(ids.map(worker), rivals)).toBe(0.6);
  });

  it("only counts rivalries that have actually soured", () => {
    const simulation = new MosslightSimulation(SEED);
    for (const relationship of simulation.state.relationships) {
      relationship.kind = "rivalry";
      relationship.strength = 20;
    }
    expect(activeRivalries(simulation.state).size).toBe(0);

    for (const relationship of simulation.state.relationships) relationship.strength = 90;
    expect(activeRivalries(simulation.state).size).toBe(simulation.state.relationships.length);
  });

  it("ignores ties that are not rivalries", () => {
    const simulation = new MosslightSimulation(SEED);
    for (const relationship of simulation.state.relationships) {
      relationship.kind = "friendship";
      relationship.strength = 95;
    }
    expect(activeRivalries(simulation.state).size).toBe(0);
  });
});

describe("families move in together", () => {
  it("moves a resident into a strong relative's burrow", () => {
    const simulation = new MosslightSimulation(SEED);

    // Give the basin a second burrow so there is anywhere to move to.
    let guard = 0;
    while (simulation.state.buildings.filter((b) => b.type === "burrow-home").length < 2 && guard < 3000) {
      simulation.advance();
      guard += 1;
    }
    const homes = simulation.state.buildings.filter((building) => building.type === "burrow-home");
    expect(homes.length).toBeGreaterThanOrEqual(2);

    // Put two residents in different burrows and bind them as family.
    const [first, second] = simulation.state.residents;
    expect(first && second).toBeTruthy();
    first!.homeId = homes[0]!.id;
    second!.homeId = homes[1]!.id;
    simulation.state.relationships.push({
      id: "relationship-test",
      aId: first!.id,
      bId: second!.id,
      kind: "family",
      strength: 95,
      sharedDays: 50,
    });

    const before = first!.homeId;
    // Run a full day so the daily stage fires.
    for (let index = 0; index < 12; index += 1) simulation.advance();

    const moved = first!.homeId !== before || second!.homeId !== homes[1]!.id;
    expect(moved).toBe(true);
    expect(first!.homeId).toBe(second!.homeId);
  });

  it("leaves residents alone when the tie is only a passing friendship", () => {
    const simulation = new MosslightSimulation(SEED);
    let guard = 0;
    while (simulation.state.buildings.filter((b) => b.type === "burrow-home").length < 2 && guard < 3000) {
      simulation.advance();
      guard += 1;
    }
    const homes = simulation.state.buildings.filter((building) => building.type === "burrow-home");
    const [first, second] = simulation.state.residents;
    first!.homeId = homes[0]!.id;
    second!.homeId = homes[1]!.id;

    // Strip every tie involving the first resident — they start the world with
    // same-species kinship to several neighbours, any one of which would
    // legitimately pull them somewhere else — then give them a friendship only.
    simulation.state.relationships = simulation.state.relationships.filter(
      (relationship) => relationship.aId !== first!.id && relationship.bId !== first!.id,
    );
    simulation.state.relationships.push({
      id: "relationship-test",
      aId: first!.id,
      bId: second!.id,
      kind: "friendship",
      // Deliberately below the strength/shared-days at which the simulation
      // promotes a friendship into family, which would legitimately move them.
      strength: 55,
      sharedDays: 5,
    });

    for (let index = 0; index < 12; index += 1) simulation.advance();
    expect(first!.homeId).toBe(homes[0]!.id);
  });
});
