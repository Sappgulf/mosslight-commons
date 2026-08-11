import type { Forecast, WorldState } from "./types";

export interface TorxThrmlForecastResponse {
  provider: "torx-thrml";
  forecast: Forecast;
  sampledRisks: Record<string, number>;
  torxPolicy: { exploration: number; social: number };
  explanation: string[];
}

export class TorxThrmlBridge {
  private readonly endpoint: string;

  constructor(endpoint = "http://127.0.0.1:8001/forecast") {
    this.endpoint = endpoint;
  }

  public async forecast(state: WorldState): Promise<TorxThrmlForecastResponse | null> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
        // The CPU-backed THRML/Torx sample is intentionally off the animation
        // loop. Give a warm service a few seconds, then keep the local model
        // authoritative if the sidecar is unavailable.
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      return (await response.json()) as TorxThrmlForecastResponse;
    } catch {
      return null;
    }
  }
}
