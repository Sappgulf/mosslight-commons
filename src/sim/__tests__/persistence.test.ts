// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { MosslightSimulation, SAVE_VERSION } from "../simulation";
import { SaveManager } from "../persistence";
import type { WorldState } from "../types";

const SEED = 2048;

function advance(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

function digest(state: WorldState): string {
  return JSON.stringify({
    tick: state.tick,
    day: state.day,
    season: state.season,
    resources: Object.fromEntries(
      Object.entries(state.resources).map(([key, value]) => [key, Math.round(value * 100)]),
    ),
    items: state.items,
    residents: state.residents.map((resident) => `${resident.id}:${resident.name}:${Math.round(resident.age)}`),
    buildings: state.buildings.map((building) => `${building.id}:${building.type}:${building.level}`),
    objectives: state.objectives.map((objective) => `${objective.id}:${objective.progress}`),
    chapter: state.chapter,
    status: state.status,
  });
}

describe("SaveManager", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a world through localStorage without drift", () => {
    const original = new MosslightSimulation(SEED);
    advance(original, 240);
    const expected = digest(original.state);

    expect(new SaveManager(original).save()).toBe(true);

    const restored = new MosslightSimulation(SEED);
    expect(new SaveManager(restored).load()).toBe(true);
    expect(digest(restored.state)).toBe(expected);
  });

  /**
   * The stricter claim: a restored world must not merely *look* the same, it
   * must keep evolving identically. That is what catches an un-serialized
   * counter — the divergence only shows up after the reload keeps running.
   */
  it("keeps a restored world on the same future as one that never stopped", () => {
    const continuous = new MosslightSimulation(SEED);
    advance(continuous, 200);

    const saved = new MosslightSimulation(SEED);
    advance(saved, 200);
    new SaveManager(saved).save();

    const restored = new MosslightSimulation(SEED);
    new SaveManager(restored).load();

    advance(continuous, 200);
    advance(restored, 200);

    expect(digest(restored.state)).toBe(digest(continuous.state));
  });

  it("reports no save before anything is written", () => {
    const simulation = new MosslightSimulation(SEED);
    const saves = new SaveManager(simulation);
    expect(saves.hasSave()).toBe(false);
    expect(saves.peek()).toBeNull();
    expect(saves.load()).toBe(false);
  });

  it("summarises a save without loading it", () => {
    const simulation = new MosslightSimulation(SEED);
    advance(simulation, 120);
    new SaveManager(simulation).save();

    const meta = new SaveManager(new MosslightSimulation(SEED)).peek();
    expect(meta?.day).toBe(simulation.state.day);
    expect(meta?.population).toBe(simulation.state.residents.length);
  });

  it("rejects a save from an older schema and clears it", () => {
    const simulation = new MosslightSimulation(SEED);
    const saves = new SaveManager(simulation);
    saves.save();

    const raw = JSON.parse(localStorage.getItem("mosslight.save.v6")!);
    raw.payload.version = SAVE_VERSION - 1;
    localStorage.setItem("mosslight.save.v6", JSON.stringify(raw));

    expect(saves.load()).toBe(false);
    expect(saves.hasSave()).toBe(false);
  });

  it("rejects malformed JSON rather than throwing", () => {
    localStorage.setItem("mosslight.save.v6", "{ not json");
    const saves = new SaveManager(new MosslightSimulation(SEED));
    expect(saves.peek()).toBeNull();
    expect(saves.load()).toBe(false);
  });

  it("rejects a payload whose shape would crash the renderer", () => {
    const simulation = new MosslightSimulation(SEED);
    const saves = new SaveManager(simulation);
    saves.save();

    const raw = JSON.parse(localStorage.getItem("mosslight.save.v6")!);
    delete raw.payload.state.grid;
    localStorage.setItem("mosslight.save.v6", JSON.stringify(raw));

    expect(saves.load()).toBe(false);
  });

  it("stops writing once sealed for a reset", () => {
    const simulation = new MosslightSimulation(SEED);
    const saves = new SaveManager(simulation);
    saves.clear(true);
    expect(saves.save()).toBe(false);
    expect(saves.hasSave()).toBe(false);
  });
});
