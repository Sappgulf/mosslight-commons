import { ITEM_DEFINITIONS } from "../../data/definitions";
import { TICKS_PER_DAY } from "../constants";
import { applySpeciesMood } from "../mood";
import { describeWant, isWantSatisfied, unmetWantKinds } from "../wants";
import type { ItemKey, Resident, WantKind } from "../types";
import type { SimContext } from "./context";

/**
 * Personal requests: who is asking for what, and what it costs the Commons to
 * ignore them.
 *
 * The rules for *what* a resident can want already lived in `sim/wants.ts`.
 * This is the tick half — assigning, resolving, and lapsing them — which was
 * still four methods on the simulation class.
 */

/** Ticks between offering somebody a new request: once a day. */
export const WANT_INTERVAL = TICKS_PER_DAY;

/** Days a resident will wait before giving up on being heard. */
export const WANT_PATIENCE = 6;

/** What answering each kind of request pays the Commons back. */
const WANT_REWARDS: Record<WantKind, { item: ItemKey; amount: number }> = {
  lantern: { item: "moonwater", amount: 2 },
  neighbour: { item: "seed-pod", amount: 3 },
  market: { item: "seed-pod", amount: 2 },
  quiet: { item: "resin", amount: 2 },
  company: { item: "resin", amount: 1 },
  sky: { item: "moonwater", amount: 2 },
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/** Only offer a want the resident does not already have satisfied. */
function pickWantFor(context: SimContext, resident: Resident): WantKind | null {
  const home = context.buildingById(resident.homeId);
  const options = unmetWantKinds(resident, context.state.buildings, context.state.relationships, home);
  return options.length === 0 ? null : context.rng.pick(options);
}

function wantSatisfied(context: SimContext, resident: Resident, kind: WantKind): boolean {
  return isWantSatisfied(
    resident,
    kind,
    context.state.buildings,
    context.state.relationships,
    context.buildingById(resident.homeId),
  );
}

/** Offers one resident a new request, on an interval. */
export function maybeAssignWant(context: SimContext): void {
  const { state } = context;
  if (state.tick % WANT_INTERVAL !== 0) return;
  const candidates = state.residents.filter((resident) => !resident.want && resident.stage !== "sprout");
  if (candidates.length === 0) return;

  const resident = context.rng.pick(candidates);
  const kind = pickWantFor(context, resident);
  if (!kind) return;

  const home = context.buildingById(resident.homeId);
  const where = home ? `plot ${home.position.x + 1}:${home.position.y + 1}` : "the Commons";
  const description = describeWant(resident, kind, where);

  const reward = WANT_REWARDS[kind];
  resident.want = {
    kind,
    description,
    createdDay: state.day,
    deadlineDay: state.day + WANT_PATIENCE,
    rewardItem: reward.item,
    rewardAmount: reward.amount,
    fulfilled: false,
  };
  context.addMessage(
    `REQUEST · ${description} Answer within ${WANT_PATIENCE} days for ${reward.amount} ${ITEM_DEFINITIONS[reward.item].label}.`,
    "info",
  );
}

/**
 * Resolves outstanding wants. Meeting one is a small, visible reward; letting
 * one sit unanswered slowly costs belonging, which is the pressure that makes
 * the request worth reading in the first place.
 */
export function updateWants(context: SimContext): void {
  const { state } = context;
  for (const resident of state.residents) {
    const want = resident.want;
    if (!want || want.fulfilled) continue;

    if (wantSatisfied(context, resident, want.kind)) {
      want.fulfilled = true;
      resident.needs.belonging = clamp(resident.needs.belonging + 18);
      state.items[want.rewardItem] += want.rewardAmount;
      state.wantsMet += 1;
      // A kept promise is remembered by the whole species, not just the asker.
      applySpeciesMood(state, resident.species, 4, 0);
      context.markMetricsDirty();
      context.addMessage(
        `REQUEST MET · ${resident.name} got their wish · +${want.rewardAmount} ${ITEM_DEFINITIONS[want.rewardItem].label}.`,
        "good",
      );
      context.emit({ type: "want", position: resident.position, label: "♥", tone: "good" });
      // Clear it so the resident can want something else later.
      resident.want = undefined;
      continue;
    }

    /*
     * A lapsed request is the cost of ignoring the ledger. Wants used to sit
     * open forever for a fraction of a belonging point a tick — twenty-six of
     * them were outstanding by day 35 with nothing to show for it either way.
     */
    if (state.day > want.deadlineDay) {
      resident.needs.belonging = clamp(resident.needs.belonging - 14);
      resident.distress += 4;
      state.wantsMissed += 1;
      applySpeciesMood(state, resident.species, -5, 0);
      state.metrics.harmony = clamp(state.metrics.harmony - 3);
      context.markMetricsDirty();
      context.addMessage(
        `REQUEST LAPSED · ${resident.name} waited ${WANT_PATIENCE} days and gave up asking.`,
        "warning",
      );
      context.emit({ type: "want", position: resident.position, label: "✕", tone: "warning" });
      resident.want = undefined;
    }
  }
}
