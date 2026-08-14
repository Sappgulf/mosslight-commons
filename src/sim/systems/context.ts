import type { SeededRandom, SimEvent } from "../simulation";
import type { AdjacencyResult } from "../adjacency";
import type { Building, BuildingType, Message, WorldState } from "../types";

/**
 * The surface a tick system is allowed to touch.
 *
 * `MosslightSimulation` had grown to 2,400 lines and roughly 110 methods
 * covering resources, residents, relationships, wants, construction, civics,
 * crisis, forecasting, objectives, and serialization — every one of them
 * reaching into every other through `this`. Systems now receive this narrow
 * context instead, which makes them plain functions that can be tested without
 * standing up a whole world, and makes each system's real dependencies visible
 * in its signature rather than implied by the class it lives in.
 */
export interface SimContext {
  readonly state: WorldState;
  readonly rng: SeededRandom;

  /** Appends to the ledger. */
  addMessage(text: string, tone: Message["tone"]): void;
  /** Announces something the renderer may want to acknowledge in place. */
  emit(event: SimEvent): void;
  /** Marks the cached settlement metrics stale. */
  markMetricsDirty(): void;

  /** Placement bonuses for a building, cached per tick. */
  adjacencyFor(building: Building): AdjacencyResult;
  /** Whether a council policy is currently in force. */
  hasPolicy(kind: WorldState["activePolicies"][number]["kind"]): boolean;
  /** Mean basin water quality, 0-100. */
  averageWaterQuality(): number;
  /** First building of a type, or undefined. */
  buildingOfType(type: BuildingType): Building | undefined;
}
