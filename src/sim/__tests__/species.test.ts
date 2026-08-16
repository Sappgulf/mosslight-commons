import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { RETURN_PATIENCE, SPECIES_PATIENCE, countOf, speciesCondition, tickSpecies } from "../species";
import type { Species } from "../types";

const SEED = 20260811;
const CLEAN_WATER = 90;
const FOUL_WATER = 5;

describe("what each species needs", () => {
  it("is content in a well-run basin", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    state.resources.light = 80;
    state.metrics.housingPressure = 0.5;

    for (const species of ["brambleback", "glowtail", "mireling"] as Species[]) {
      expect(speciesCondition(state, species, CLEAN_WATER).ok).toBe(true);
    }
  });

  it("turns Glowtails out when the basin goes dark", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.resources.light = 2;
    const condition = speciesCondition(simulation.state, "glowtail", CLEAN_WATER);
    expect(condition.ok).toBe(false);
    expect(condition.reason).toContain("dark");
    expect(condition.advice).not.toBe("");
  });

  it("turns Mirelings out when the water turns", () => {
    const simulation = new MosslightSimulation(SEED);
    expect(speciesCondition(simulation.state, "mireling", FOUL_WATER).ok).toBe(false);
    expect(speciesCondition(simulation.state, "mireling", CLEAN_WATER).ok).toBe(true);
  });

  it("turns Bramblebacks out only when there is nowhere to sleep", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.metrics.housingPressure = 0.9;
    expect(speciesCondition(simulation.state, "brambleback", CLEAN_WATER).ok).toBe(true);
    simulation.state.metrics.housingPressure = 1.6;
    expect(speciesCondition(simulation.state, "brambleback", CLEAN_WATER).ok).toBe(false);
  });

  it("needs both light and a canopy to keep Cloudmoths", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    state.resources.light = 80;

    // Light alone is not enough: there must be something to rest under.
    expect(speciesCondition(state, "cloudmoth", CLEAN_WATER).ok).toBe(false);
    expect(speciesCondition(state, "cloudmoth", CLEAN_WATER).reason).toContain("canopy");

    state.traditions.push("sky-veil");
    expect(speciesCondition(state, "cloudmoth", CLEAN_WATER).ok).toBe(true);

    state.resources.light = 4;
    expect(speciesCondition(state, "cloudmoth", CLEAN_WATER).ok).toBe(false);
  });
});

describe("a species leaving", () => {
  it("waits out its patience before anyone goes", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.resources.light = 0;

    for (let day = 1; day < SPECIES_PATIENCE.glowtail; day += 1) {
      const { leaving } = tickSpecies(simulation.state, CLEAN_WATER);
      expect(leaving.some((entry) => entry.species === "glowtail")).toBe(false);
    }
    const { leaving } = tickSpecies(simulation.state, CLEAN_WATER);
    expect(leaving.some((entry) => entry.species === "glowtail")).toBe(true);
  });

  it("recovers twice as fast as it strains once things are put right", () => {
    const simulation = new MosslightSimulation(SEED);
    simulation.state.resources.light = 0;
    tickSpecies(simulation.state, CLEAN_WATER);
    tickSpecies(simulation.state, CLEAN_WATER);
    expect(simulation.state.speciesStrain.glowtail).toBe(2);

    simulation.state.resources.light = 90;
    tickSpecies(simulation.state, CLEAN_WATER);
    expect(simulation.state.speciesStrain.glowtail).toBe(0);
  });

  it("says nothing about a species that is not here", () => {
    const simulation = new MosslightSimulation(SEED);
    // No Cloudmoths have arrived, and there is no canopy: they must not "leave".
    expect(countOf(simulation.state, "cloudmoth")).toBe(0);
    for (let day = 0; day < SPECIES_PATIENCE.cloudmoth + 3; day += 1) {
      const { leaving } = tickSpecies(simulation.state, CLEAN_WATER);
      expect(leaving.some((entry) => entry.species === "cloudmoth")).toBe(false);
    }
  });

  it("flags the last one out as the last", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    state.resources.light = 0;
    // Leave exactly one Glowtail standing.
    const glowtails = state.residents.filter((resident) => resident.species === "glowtail");
    state.residents = state.residents.filter(
      (resident) => resident.species !== "glowtail" || resident.id === glowtails[0]!.id,
    );

    let flagged = false;
    for (let day = 0; day < SPECIES_PATIENCE.glowtail + 2; day += 1) {
      const { leaving } = tickSpecies(state, CLEAN_WATER);
      const entry = leaving.find((candidate) => candidate.species === "glowtail");
      if (entry?.last) flagged = true;
    }
    expect(flagged).toBe(true);
  });

  it("drives a real departure through the daily pipeline", () => {
    const simulation = new MosslightSimulation(SEED);
    const before = countOf(simulation.state, "glowtail");
    expect(before).toBeGreaterThan(0);

    // Hold the basin dark across enough days for patience to run out.
    for (let day = 0; day < SPECIES_PATIENCE.glowtail + 2; day += 1) {
      for (let tick = 0; tick < 12; tick += 1) {
        simulation.state.resources.light = 0;
        simulation.advance();
      }
    }
    expect(countOf(simulation.state, "glowtail")).toBeLessThan(before);
    expect(simulation.state.history.some((message) => /LEAVING|EXODUS/.test(message.text))).toBe(true);
  });
});

describe("a species coming back", () => {
  it("returns once the basin has been good long enough", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    state.resources.light = 90;
    state.metrics.housingPressure = 0.4;
    state.residents = state.residents.filter((resident) => resident.species !== "glowtail");
    expect(countOf(state, "glowtail")).toBe(0);

    let returned = false;
    for (let day = 0; day <= RETURN_PATIENCE; day += 1) {
      const { returning } = tickSpecies(state, CLEAN_WATER);
      if (returning.includes("glowtail")) returned = true;
    }
    expect(returned).toBe(true);
  });

  it("will not return while the basin is still bad", () => {
    const simulation = new MosslightSimulation(SEED);
    const state = simulation.state;
    state.resources.light = 0;
    state.residents = state.residents.filter((resident) => resident.species !== "glowtail");

    for (let day = 0; day <= RETURN_PATIENCE + 4; day += 1) {
      const { returning } = tickSpecies(state, CLEAN_WATER);
      expect(returning).not.toContain("glowtail");
    }
  });
});

describe("decline is measured against the settlement's peak", () => {
  it("does not let losing the unhappiest residents flatter the Commons", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let tick = 0; tick < 60; tick += 1) simulation.advance();

    const peak = simulation.state.peakPopulation;
    expect(peak).toBeGreaterThan(0);

    // Remove half the settlement outright, leaving the most content behind.
    const sorted = [...simulation.state.residents].sort(
      (a, b) => b.needs.belonging - a.needs.belonging,
    );
    simulation.state.residents = sorted.slice(0, Math.floor(sorted.length / 2));
    for (let tick = 0; tick < 12; tick += 1) simulation.advance();

    // Average wellbeing is now high, but the Commons has plainly declined.
    expect(simulation.state.peakPopulation).toBe(peak);
    expect(simulation.state.status).not.toBe("thriving");
  });
});
