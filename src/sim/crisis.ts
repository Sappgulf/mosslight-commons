import type { LongShadeOutcome, WorldState } from "./types";

export const LONG_SHADE_LENGTH = 10;

export function beginLongShade(state: WorldState): boolean {
  if (state.season !== "longshade") return false;
  if (state.longShadeCrisis && state.longShadeOutcome === "pending") return false;
  if (state.longShadeOutcome === "thrived" || state.longShadeOutcome === "strained" || state.longShadeOutcome === "failed") {
    if (state.longShadeStartDay === state.day) return false;
  }
  if (state.longShadeCrisis) return false;
  state.longShadeCrisis = true;
  state.longShadeStartDay = state.day;
  state.longShadeEndsDay = state.day + LONG_SHADE_LENGTH;
  state.longShadeOutcome = "pending";
  return true;
}

export function tickLongShade(state: WorldState): { mothsDue: boolean; resolved: LongShadeOutcome | null } {
  if (!state.longShadeCrisis || state.longShadeOutcome !== "pending") {
    return { mothsDue: false, resolved: null };
  }

  const drain = 0.7 + state.habitatStress * 0.04 + (state.phase === "night" ? 0.35 : 0);
  state.resources.light = Math.max(0, state.resources.light - drain);
  if (state.season === "longshade") {
    state.resources.warmth = Math.max(0, state.resources.warmth - 0.15);
  }

  const elapsed = state.day - state.longShadeStartDay;
  const mothsDue = !state.cloudmothsArrived && elapsed >= 3 && state.metrics.harmony >= 48;

  if (state.day < state.longShadeEndsDay) {
    return { mothsDue, resolved: null };
  }

  const light = state.resources.light;
  const harmony = state.metrics.harmony;
  const water = state.resources.water;
  let outcome: LongShadeOutcome = "failed";
  if (light >= 38 && harmony >= 52 && water >= 28) outcome = "thrived";
  else if (light >= 18 && harmony >= 38) outcome = "strained";

  state.longShadeCrisis = false;
  state.longShadeOutcome = outcome;
  return { mothsDue, resolved: outcome };
}

export function crisisBanner(state: WorldState): string | null {
  if (state.longShadeCrisis && state.longShadeOutcome === "pending") {
    const left = Math.max(0, state.longShadeEndsDay - state.day);
    return `LONG SHADE · ${left} days remain. Light is draining. Welcome the moths or lose the basin.`;
  }
  if (state.longShadeOutcome === "thrived") return "LONG SHADE PASSED · The moths stay. The Commons held.";
  if (state.longShadeOutcome === "strained") return "LONG SHADE PASSED · You survived, but the basin is thinner.";
  if (state.longShadeOutcome === "failed") return "LONG SHADE BROKE · Light failed. The Commons is failing.";
  return null;
}
