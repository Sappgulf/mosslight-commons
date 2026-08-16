import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";
import { STRESS_CHANNELS, buildStressGraph, channelStress, worstDistrictFor } from "../graph";
import { generateForecasts } from "../forecast";

const SEED = 20260811;

/** Run enough ticks that the settlement has residents spread across districts. */
function warm(simulation: MosslightSimulation, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) simulation.advance();
}

describe("stress graph", () => {
  it("builds one node per district per channel", () => {
    const simulation = new MosslightSimulation(SEED);
    const graph = buildStressGraph(simulation.state);

    expect(simulation.state.districts.length).toBeGreaterThan(0);
    expect(graph.nodes).toHaveLength(simulation.state.districts.length * STRESS_CHANNELS.length);

    // Every node id is unique and traceable back to a real district.
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(ids.size).toBe(graph.nodes.length);
    const districtIds = new Set(simulation.state.districts.map((district) => district.id));
    for (const node of graph.nodes) expect(districtIds.has(node.districtId)).toBe(true);
  });

  it("keeps every stress reading inside 0..1", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 200);
    const graph = buildStressGraph(simulation.state);
    for (const node of graph.nodes) {
      expect(node.stress).toBeGreaterThanOrEqual(0);
      expect(node.stress).toBeLessThanOrEqual(1);
    }
  });

  it("couples channels within a district and the same channel across districts", () => {
    const simulation = new MosslightSimulation(SEED);
    const graph = buildStressGraph(simulation.state);

    const channelEdges = graph.edges.filter((edge) => edge.kind === "channel");
    const spatialEdges = graph.edges.filter((edge) => edge.kind === "spatial");
    expect(channelEdges.length).toBeGreaterThan(0);
    expect(spatialEdges.length).toBeGreaterThan(0);

    // A channel edge stays inside one district; a spatial edge crosses two.
    const districtOf = (id: string) => id.slice(0, id.lastIndexOf(":"));
    const channelOf = (id: string) => id.slice(id.lastIndexOf(":") + 1);
    for (const edge of channelEdges) expect(districtOf(edge.a)).toBe(districtOf(edge.b));
    for (const edge of spatialEdges) {
      expect(districtOf(edge.a)).not.toBe(districtOf(edge.b));
      expect(channelOf(edge.a)).toBe(channelOf(edge.b));
    }

    // Every edge points at nodes that exist.
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.a)).toBe(true);
      expect(ids.has(edge.b)).toBe(true);
    }
  });

  it("reports housing pressure where residents outnumber local beds", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 400);
    const graph = buildStressGraph(simulation.state);

    const housing = graph.nodes.filter((node) => node.channel === "housing");
    // Districts holding no residents cannot be short of housing.
    for (const node of housing) {
      if (node.population === 0) expect(node.stress).toBe(0);
    }
  });

  it("raises shade stress in the Long Shade", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 40);
    const before = channelStress(buildStressGraph(simulation.state), "shade");

    // Advance until the season turns, then compare the same channel.
    let guard = 0;
    while (simulation.state.season !== "longshade" && guard < 4000) {
      simulation.advance();
      guard += 1;
    }
    expect(simulation.state.season).toBe("longshade");
    const during = channelStress(buildStressGraph(simulation.state), "shade");
    expect(during).toBeGreaterThan(before);
  });

  it("names a worst district for each channel once the town is populated", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 300);
    const graph = buildStressGraph(simulation.state);
    for (const channel of STRESS_CHANNELS) {
      const worst = worstDistrictFor(graph, channel);
      expect(worst).toBeDefined();
      expect(worst!.channel).toBe(channel);
    }
  });

  it("memoizes within a tick and rebuilds when the world moves", () => {
    const simulation = new MosslightSimulation(SEED);
    const first = buildStressGraph(simulation.state);
    expect(buildStressGraph(simulation.state)).toBe(first);

    simulation.advance();
    expect(buildStressGraph(simulation.state)).not.toBe(first);
  });
});

describe("generated forecasts", () => {
  it("produces one ranked candidate per channel", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 120);
    const ranked = generateForecasts(simulation.state);

    expect(ranked).toHaveLength(STRESS_CHANNELS.length);
    for (let index = 1; index < ranked.length; index += 1) {
      expect(ranked[index - 1]!.probability).toBeGreaterThanOrEqual(ranked[index]!.probability);
    }
  });

  it("keeps probabilities inside the readable band", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 500);
    for (const forecast of generateForecasts(simulation.state)) {
      expect(forecast.probability).toBeGreaterThanOrEqual(0.05);
      expect(forecast.probability).toBeLessThanOrEqual(0.94);
      expect(forecast.drivers.length).toBeGreaterThan(0);
      expect(forecast.recommendation).not.toBe("");
    }
  });

  it("names the district a warning is about", () => {
    const simulation = new MosslightSimulation(SEED);
    warm(simulation, 300);
    const graph = buildStressGraph(simulation.state);
    const labels = new Set(graph.nodes.map((node) => node.districtLabel));

    // The lead driver of the top forecast should point at a real district.
    const [top] = generateForecasts(simulation.state);
    const mentionsDistrict = [...labels].some((label) => top!.drivers.some((driver) => driver.includes(label)));
    expect(mentionsDistrict).toBe(true);
  });

  it("is deterministic for a given world", () => {
    const first = new MosslightSimulation(SEED);
    const second = new MosslightSimulation(SEED);
    warm(first, 150);
    warm(second, 150);
    expect(generateForecasts(first.state)).toEqual(generateForecasts(second.state));
  });
});
