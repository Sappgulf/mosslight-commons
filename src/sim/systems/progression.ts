import { ITEM_DEFINITIONS } from "../../data/definitions";
import type { BuildingType, CollectibleTile, MapZoneKey, Objective, RecipeKey } from "../types";
import type { SimContext } from "./context";

/** Objectives the player can currently see and work toward. */
export function activeObjectives(context: SimContext): Objective[] {
  return context.state.objectives.filter((objective) => objective.chapter <= context.state.chapter);
}

export interface ObjectiveMatch {
  tile?: CollectibleTile;
  building?: BuildingType;
  zone?: MapZoneKey;
  recipe?: RecipeKey;
}

/**
 * Credits every open objective that matches an action the player just took.
 * The `match` fields narrow within a kind — collecting a fern must not tick a
 * "gather five mushrooms" card.
 */
export function advanceObjectives(
  context: SimContext,
  kind: Objective["kind"],
  match: ObjectiveMatch = {},
): void {
  for (const objective of context.state.objectives) {
    if (objective.completed || objective.kind !== kind) continue;
    if (objective.chapter > context.state.chapter) continue;
    if (kind === "collect" && objective.tile && objective.tile !== match.tile) continue;
    if (kind === "build" && objective.building !== match.building) continue;
    if (kind === "upgrade" && objective.building && objective.building !== match.building) continue;
    if (kind === "expedition" && objective.zone !== match.zone) continue;
    if (kind === "craft" && objective.recipe !== match.recipe) continue;

    objective.progress = Math.min(objective.target, objective.progress + 1);
    if (objective.progress < objective.target) continue;

    completeObjective(context, objective);
  }
}

export function completeObjective(context: SimContext, objective: Objective): void {
  objective.completed = true;
  const rewardText = objective.rewardItem && objective.rewardAmount
    ? ` · reward +${objective.rewardAmount} ${ITEM_DEFINITIONS[objective.rewardItem].label}`
    : "";
  if (objective.rewardItem && objective.rewardAmount) {
    context.state.items[objective.rewardItem] += objective.rewardAmount;
  }
  context.addMessage(`OBJECTIVE · ${objective.title} complete${rewardText}.`, "good");
  context.emit({ type: "objective", label: objective.title, tone: "good" });
}

/**
 * Population and harmony objectives track live metrics rather than discrete
 * actions, so they are swept every tick instead of being credited by an event.
 */
export function checkThresholdObjectives(context: SimContext): void {
  for (const objective of context.state.objectives) {
    if (objective.completed || objective.chapter > context.state.chapter) continue;
    if (objective.kind === "population") {
      const count = objective.species
        ? context.state.residents.filter((resident) => resident.species === objective.species).length
        : context.state.metrics.population;
      objective.progress = Math.min(objective.target, count);
    } else if (objective.kind === "tradition" && objective.tradition) {
      objective.progress = context.state.traditions.includes(objective.tradition) ? objective.target : 0;
    } else if (objective.kind === "harmony") {
      objective.progress = Math.min(objective.target, Math.round(context.state.metrics.harmony));
    } else if (objective.kind === "craft" && objective.recipe) {
      objective.progress = Math.min(objective.target, context.state.crafted[objective.recipe] ?? 0);
    } else if (objective.kind === "expedition" && objective.zone) {
      /*
       * Swept from the world rather than credited by the event, because the
       * event can arrive before the objective is open. Crafting a Root Bridge
       * reveals the Old Hollow during chapter one, but "Open the Old Hollow" is
       * a chapter-two card — the credit was discarded for being early, the zone
       * could never be the target of another expedition once revealed, and
       * chapter two could not be finished at all.
       */
      objective.progress = context.state.revealedAreas.includes(objective.zone) ? objective.target : 0;
    } else {
      continue;
    }
    if (objective.progress >= objective.target) completeObjective(context, objective);
  }
}

/** Objectives unlock one chapter at a time as the previous chapter completes. */
export function updateChapter(context: SimContext): void {
  const current = context.state.chapter;
  const chapterObjectives = context.state.objectives.filter((objective) => objective.chapter === current);
  if (chapterObjectives.length === 0) return;
  if (!chapterObjectives.every((objective) => objective.completed)) return;

  const nextChapter = current + 1;
  if (!context.state.objectives.some((objective) => objective.chapter === nextChapter)) return;

  context.state.chapter = nextChapter;
  context.addMessage("CHAPTER · New work is open in the Commons ledger.", "good");
}
