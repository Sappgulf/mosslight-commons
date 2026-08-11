import type { Forecast, WorldState } from "./types";

export interface TorxThrmlForecastResponse {
  provider: "torx-thrml";
  forecast: Forecast;
  sampledRisks: Record<string, number>;
  torxPolicy: { exploration: number; social: number };
  explanation: string[];
}

export type BridgeStatus = "connected" | "offline" | "connecting";

const BASE_POLL_MS = 15000;
const MAX_POLL_MS = 120000;
const DEFAULT_ENDPOINT = "http://127.0.0.1:8001/forecast";

/** True when the page is served from a developer machine, where the sidecar may be running. */
function isLocalHost(): boolean {
  if (typeof location === "undefined") return false;
  return ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
}

/**
 * Client for the optional Python Torx+THRML sidecar.
 *
 * The sidecar is genuinely optional, so every failure path here is quiet by
 * design — but the poll interval backs off exponentially while it is down, so
 * a player running without the bridge is not making a doomed request every
 * fifteen seconds for their whole session.
 */
export class TorxThrmlBridge {
  private readonly endpoint: string;
  private consecutiveFailures = 0;
  private inFlight: AbortController | null = null;
  private status: BridgeStatus = "connecting";

  private readonly enabled: boolean;

  constructor(endpoint = import.meta.env.VITE_TORX_ENDPOINT ?? DEFAULT_ENDPOINT) {
    this.endpoint = endpoint;
    // The sidecar is a local research tool. On a deployed build there is no
    // 127.0.0.1:8001 to reach, and polling it would fill every visitor's
    // console with connection errors, so stand down unless it is plausible.
    this.enabled = Boolean(import.meta.env.VITE_TORX_ENDPOINT) || isLocalHost();
    if (!this.enabled) this.status = "offline";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  /** Poll delay for the next attempt, growing while the sidecar is unavailable. */
  getPollDelay(): number {
    if (this.consecutiveFailures === 0) return BASE_POLL_MS;
    return Math.min(MAX_POLL_MS, BASE_POLL_MS * 2 ** Math.min(this.consecutiveFailures, 3));
  }

  public async forecast(state: WorldState): Promise<TorxThrmlForecastResponse | null> {
    if (!this.enabled) return null;

    // Supersede any request still outstanding rather than stacking them up.
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    // The CPU-backed THRML/Torx sample is intentionally off the animation
    // loop. Give a warm service a few seconds, then keep the local model
    // authoritative if the sidecar is unavailable.
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: serializeForBridge(state) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.recordFailure();
        return null;
      }
      const payload = (await response.json()) as TorxThrmlForecastResponse;
      if (!payload?.forecast || typeof payload.forecast.probability !== "number") {
        this.recordFailure();
        return null;
      }
      this.consecutiveFailures = 0;
      this.status = "connected";
      return payload;
    } catch {
      this.recordFailure();
      return null;
    } finally {
      clearTimeout(timeout);
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    this.status = "offline";
  }
}

/**
 * The sidecar only reads a handful of aggregate fields. Sending the whole world
 * — grid, revealed mask, every resident's path — was several hundred kilobytes
 * per poll, so this trims the payload to what the model actually consumes.
 */
function serializeForBridge(state: WorldState) {
  return {
    // `seed` and `tick` key the sidecar's THRML sampler; keep both.
    seed: state.seed,
    tick: state.tick,
    day: state.day,
    season: state.season,
    seasonDay: state.seasonDay,
    phase: state.phase,
    resources: state.resources,
    items: state.items,
    districtFocus: state.districtFocus,
    seasonalEvent: { effect: state.seasonalEvent.effect, title: state.seasonalEvent.title },
    metrics: state.metrics,
    status: state.status,
    revealedAreas: state.revealedAreas,
    buildings: state.buildings.map((building) => ({ type: building.type, level: building.level })),
    residents: state.residents.map((resident) => ({
      species: resident.species,
      goal: resident.goal,
      stage: resident.stage,
      needs: resident.needs,
    })),
    relationships: state.relationships.map((relationship) => ({
      kind: relationship.kind,
      strength: relationship.strength,
    })),
  };
}
