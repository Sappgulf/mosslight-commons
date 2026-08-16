import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { TRADITION_DEFINITIONS, TRADITION_ORDER, blockedBy, isAvailable } from "../traditions";
import type { TraditionKey } from "../types";

const SEED = 20260811;

/** A world at a chapter high enough that every practice is on the table. */
function worldAtChapter(chapter: number): MosslightSimulation {
  const simulation = new MosslightSimulation(SEED);
  simulation.state.chapter = chapter;
  return simulation;
}

describe("tradition exclusions", () => {
  it("declares every exclusion on both sides", () => {
    for (const key of TRADITION_ORDER) {
      for (const excluded of TRADITION_DEFINITIONS[key].excludes ?? []) {
        expect(TRADITION_DEFINITIONS[excluded].excludes).toContain(key);
      }
    }
  });

  it("never lets a practice exclude itself", () => {
    for (const key of TRADITION_ORDER) {
      expect(TRADITION_DEFINITIONS[key].excludes ?? []).not.toContain(key);
    }
  });

  it("closes the paired practice once one is kept", () => {
    const simulation = worldAtChapter(3);
    expect(isAvailable(simulation.state, "open-table")).toBe(true);

    simulation.state.traditions.push("seed-vault");
    expect(isAvailable(simulation.state, "open-table")).toBe(false);
    expect(blockedBy(simulation.state, "open-table")?.key).toBe("seed-vault");
  });

  it("closes the pairing in the other direction too", () => {
    const simulation = worldAtChapter(3);
    simulation.state.traditions.push("lantern-vigil");
    expect(isAvailable(simulation.state, "hearthcraft")).toBe(false);
    expect(blockedBy(simulation.state, "hearthcraft")?.key).toBe("lantern-vigil");
  });

  it("leaves unpaired practices alone", () => {
    const simulation = worldAtChapter(3);
    simulation.state.traditions.push("seed-vault", "hearthcraft");
    expect(blockedBy(simulation.state, "long-memory")).toBeUndefined();
    expect(isAvailable(simulation.state, "long-memory")).toBe(true);
  });

  it("keeps the Sky Veil reachable whatever else the Commons kept", () => {
    // A chapter-four objective requires it, so no choice may lock it out.
    const simulation = worldAtChapter(3);
    for (const key of TRADITION_ORDER) {
      if (key === "sky-veil") continue;
      simulation.state.traditions.push(key);
    }
    expect(blockedBy(simulation.state, "sky-veil")).toBeUndefined();
    expect(isAvailable(simulation.state, "sky-veil")).toBe(true);
  });

  it("refuses to adopt a practice that is ruled out", () => {
    const simulation = worldAtChapter(3);
    simulation.state.traditions.push("seed-vault");
    // Make it affordable so the refusal can only be the exclusion.
    for (const item of Object.keys(simulation.state.items) as Array<keyof typeof simulation.state.items>) {
      simulation.state.items[item] = 99;
    }
    expect(simulation.adoptTradition("open-table")).toBe(false);
    expect(simulation.state.traditions).not.toContain("open-table");
  });

  it("still adopts an open practice when affordable", () => {
    const simulation = worldAtChapter(3);
    for (const item of Object.keys(simulation.state.items) as Array<keyof typeof simulation.state.items>) {
      simulation.state.items[item] = 99;
    }
    expect(simulation.adoptTradition("seed-vault")).toBe(true);
    expect(simulation.state.traditions).toContain("seed-vault");
  });

  it("leaves at most one of each exclusive pair reachable in a finished run", () => {
    const simulation = worldAtChapter(3);
    const pairs: Array<[TraditionKey, TraditionKey]> = [
      ["seed-vault", "open-table"],
      ["hearthcraft", "lantern-vigil"],
    ];
    for (const [first, second] of pairs) {
      simulation.state.traditions.push(first);
      expect(isAvailable(simulation.state, second)).toBe(false);
    }
  });
});
