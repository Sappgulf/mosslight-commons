import { describe, expect, it } from "vitest";

import { MosslightSimulation } from "../simulation";

const SEED = 20260811;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * A survey is a journey now, not a counter.
 *
 * The reveal used to fire on a flat three-to-six tick timer wherever the scout
 * happened to be standing — often inside the settlement, having walked nowhere.
 */
describe("scouts cross the basin", () => {
  it("walks to every zone in turn rather than timing out", () => {
    const simulation = new MosslightSimulation(SEED);
    const walked: string[] = [];
    const timedOut: string[] = [];

    for (let survey = 0; survey < 3; survey += 1) {
      for (let tick = 0; tick < 24; tick += 1) simulation.advance();
      expect(simulation.dispatchExpedition()).toBe(true);

      const expedition = simulation.state.expeditions.filter((entry) => entry.status === "active").pop()!;
      const leader = simulation.state.residents.find((resident) => resident.id === expedition.leaderId)!;

      /*
       * Closest approach, not "distance while outbound": the phase flips
       * inside the same tick the arrival is detected, so sampling after
       * `advance()` never sees the scout standing on the target.
       */
      let closest = Number.POSITIVE_INFINITY;
      let outbound = 0;
      for (let tick = 0; tick < 900; tick += 1) {
        simulation.advance();
        if (expedition.phase === "outbound") outbound += 1;
        closest = Math.min(closest, distance(leader.position, expedition.target));
        if (expedition.status === "complete") break;
      }
      const reachedTarget = closest <= 2;

      // The scout must have arrived under its own steam, not on the fallback.
      if (reachedTarget) walked.push(expedition.zone);
      else timedOut.push(expedition.zone);

      expect(expedition.status).toBe("complete");
      expect(simulation.state.revealedAreas).toContain(expedition.zone);
      expect(outbound).toBeLessThan(expedition.duration * 3);
    }

    expect(timedOut).toEqual([]);
    expect(walked).toHaveLength(3);
  });

  it("routes a scout through ground nobody has mapped yet", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let tick = 0; tick < 24; tick += 1) simulation.advance();
    expect(simulation.dispatchExpedition()).toBe(true);

    const expedition = simulation.state.expeditions.find((entry) => entry.status === "active")!;
    const leader = simulation.state.residents.find((resident) => resident.id === expedition.leaderId)!;

    // The target sits in unrevealed ground — an ordinary resident could not
    // route to it at all, which is what stranded the survey before.
    expect(simulation.state.revealed[expedition.target.y]![expedition.target.x]).toBe(false);
    simulation.advance();
    expect(leader.path.length).toBeGreaterThan(0);
  });

  it("still resolves if the scout leaves the Commons mid-survey", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let tick = 0; tick < 24; tick += 1) simulation.advance();
    expect(simulation.dispatchExpedition()).toBe(true);

    const expedition = simulation.state.expeditions.find((entry) => entry.status === "active")!;
    simulation.state.residents = simulation.state.residents.filter(
      (resident) => resident.id !== expedition.leaderId,
    );

    simulation.advance();
    expect(expedition.status).toBe("complete");
    // The map is still owed to the Commons even when nobody walked it.
    expect(simulation.state.revealedAreas).toContain(expedition.zone);
  });

  it("brings the scout home before the survey closes", () => {
    const simulation = new MosslightSimulation(SEED);
    for (let tick = 0; tick < 24; tick += 1) simulation.advance();
    simulation.dispatchExpedition();

    const expedition = simulation.state.expeditions.find((entry) => entry.status === "active")!;
    const leader = simulation.state.residents.find((resident) => resident.id === expedition.leaderId)!;

    for (let tick = 0; tick < 900 && expedition.status === "active"; tick += 1) simulation.advance();
    expect(expedition.status).toBe("complete");
    expect(distance(leader.position, expedition.home)).toBeLessThanOrEqual(2);
  });
});
