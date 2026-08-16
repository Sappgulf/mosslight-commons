import type { Species, WorldState } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/**
 * Shifts how the Commons feels about itself along species lines.
 *
 * Answering one species' request, or refusing it, is felt most by that species
 * and differently by everyone else — which is what stops a council decision
 * from being a free win. Shared by the wants system and the proposal system,
 * so it lives apart from both.
 */
export function applySpeciesMood(
  state: WorldState,
  species: Species,
  allyDelta: number,
  othersDelta: number,
): void {
  for (const resident of state.residents) {
    const delta = resident.species === species ? allyDelta : othersDelta;
    resident.needs.belonging = clamp(resident.needs.belonging + delta);
  }
}
