import { SPECIES_DEFINITIONS } from "../data/definitions";
import { hasTradition } from "./traditions";
import type { Species, WorldState } from "./types";

/**
 * What each species needs from the basin in order to stay.
 *
 * Only the Cloudmoths ever had a condition attached to them — they arrived
 * partway through a Long Shade and then stayed forever whatever happened next.
 * Everybody else was simply present from the first morning to the last. A
 * settlement could let its water turn or its light fail and still keep a full
 * complement of Mirelings and Glowtails standing in it, so the species roster
 * said nothing about how the place was being run.
 *
 * Each species now has a condition it needs met, a patience for how long it
 * will tolerate that condition being broken, and a way back if the Commons
 * puts things right.
 */

export interface SpeciesCondition {
  /** Whether the basin currently suits this species. */
  ok: boolean;
  /** Why not, in the player's words. Empty when things are fine. */
  reason: string;
  /** What would fix it. */
  advice: string;
}

/** Days of unmet conditions before a species starts to leave. */
export const SPECIES_PATIENCE: Record<Species, number> = {
  brambleback: 6,
  glowtail: 5,
  mireling: 5,
  cloudmoth: 4,
};

/** Consecutive good days before an absent species will try the basin again. */
export const RETURN_PATIENCE = 6;

const ok: SpeciesCondition = { ok: true, reason: "", advice: "" };

/**
 * Whether the basin currently suits a species.
 *
 * Deliberately keyed off things the player already watches and can already act
 * on — stored light, water quality, housing pressure, canopy cover — rather
 * than a new hidden statistic.
 */
export function speciesCondition(
  state: WorldState,
  species: Species,
  waterQuality: number,
): SpeciesCondition {
  switch (species) {
    case "brambleback": {
      // Builders and haulers put up with a great deal, but not with nowhere to sleep.
      if (state.metrics.housingPressure <= 1.15) return ok;
      return {
        ok: false,
        reason: "there is nowhere left to sleep",
        advice: "Raise burrows before the Bramblebacks give up on the basin.",
      };
    }
    case "glowtail": {
      if (state.resources.light >= 15) return ok;
      return {
        ok: false,
        reason: "the basin has gone dark",
        advice: "Light the groves again, or the Glowtails will drift out.",
      };
    }
    case "mireling": {
      if (waterQuality >= 30) return ok;
      return {
        ok: false,
        reason: "the water has turned",
        advice: "Give the Mirelings clean water: keep farms off the last reed banks.",
      };
    }
    case "cloudmoth": {
      // Moths need light *and* something to rest under.
      const canopy =
        state.buildings.some((building) => building.type === "sky-walk") || hasTradition(state, "sky-veil");
      if (state.resources.light >= 20 && canopy) return ok;
      return {
        ok: false,
        reason: canopy ? "the canopy light is failing" : "nothing holds the canopy",
        advice: canopy ? "Keep the lanterns lit." : "Hang a Sky Walk or adopt the Sky Veil.",
      };
    }
  }
}

/** Everyone of a species currently in the Commons. */
export function countOf(state: WorldState, species: Species): number {
  let total = 0;
  for (const resident of state.residents) if (resident.species === species) total += 1;
  return total;
}

export interface SpeciesTick {
  /** Species that should lose a resident this day, with why. */
  leaving: Array<{ species: Species; reason: string; advice: string; last: boolean }>;
  /** Species whose conditions have been good long enough to come back. */
  returning: Species[];
}

/**
 * Advances every species' strain by one day and reports who is leaving and who
 * is willing to come back.
 *
 * Strain rises while a condition is unmet and falls twice as fast once it is
 * met again, so putting the basin right is visibly rewarded rather than merely
 * stopping the bleeding.
 */
export function tickSpecies(state: WorldState, waterQuality: number): SpeciesTick {
  state.speciesStrain ??= { brambleback: 0, glowtail: 0, mireling: 0, cloudmoth: 0 };
  state.speciesEase ??= { brambleback: 0, glowtail: 0, mireling: 0, cloudmoth: 0 };

  const leaving: SpeciesTick["leaving"] = [];
  const returning: Species[] = [];

  for (const species of Object.keys(SPECIES_DEFINITIONS) as Species[]) {
    const condition = speciesCondition(state, species, waterQuality);
    const present = countOf(state, species);

    if (condition.ok) {
      state.speciesStrain[species] = Math.max(0, state.speciesStrain[species] - 2);
      state.speciesEase[species] += 1;
      // An absent species will try the basin again once it has been good a while.
      if (present === 0 && state.speciesEase[species] >= RETURN_PATIENCE) returning.push(species);
      continue;
    }

    state.speciesEase[species] = 0;
    if (present === 0) continue;

    state.speciesStrain[species] += 1;
    if (state.speciesStrain[species] >= SPECIES_PATIENCE[species]) {
      leaving.push({ species, reason: condition.reason, advice: condition.advice, last: present === 1 });
    }
  }

  return { leaving, returning };
}
