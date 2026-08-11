import { MosslightSimulation, SAVE_VERSION, type SavePayload } from "./simulation";

const STORAGE_KEY = "mosslight.save.v2";
const AUTOSAVE_INTERVAL_MS = 20000;

export interface SaveMeta {
  day: number;
  population: number;
  savedAt: number;
}

/**
 * Validates a decoded save well enough to be confident it will not crash the
 * renderer. A save from an older schema is rejected rather than migrated —
 * with the version bump this is a prototype, not a shipped title, and a clean
 * restart is better than a half-populated world.
 */
function isValidPayload(value: unknown): value is SavePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<SavePayload>;
  if (payload.version !== SAVE_VERSION) return false;
  const state = payload.state;
  if (!state || typeof state !== "object") return false;
  return (
    Array.isArray(state.grid)
    && Array.isArray(state.residents)
    && Array.isArray(state.buildings)
    && Array.isArray(state.revealed)
    && Array.isArray(state.objectives)
    && typeof state.tick === "number"
    && typeof state.resources === "object"
  );
}

export class SaveManager {
  private timer: number | null = null;
  /**
   * Once the player asks for a new Commons we must stop writing. The reset path
   * clears storage and then reloads, and the reload fires `beforeunload` and
   * `pagehide` — which were promptly saving the discarded world straight back
   * over the clear, so "NEW" appeared to do nothing.
   */
  private sealed = false;

  constructor(private readonly simulation: MosslightSimulation) {}

  hasSave(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  peek(): SaveMeta | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { payload?: unknown; savedAt?: number };
      if (!isValidPayload(parsed.payload)) return null;
      return {
        day: parsed.payload.state.day,
        population: parsed.payload.state.residents.length,
        savedAt: parsed.savedAt ?? 0,
      };
    } catch {
      return null;
    }
  }

  save(): boolean {
    if (this.sealed) return false;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ savedAt: Date.now(), payload: JSON.parse(this.simulation.serialize()) }),
      );
      return true;
    } catch {
      // A full or unavailable localStorage should never interrupt play.
      return false;
    }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { payload?: unknown };
      if (!isValidPayload(parsed.payload)) {
        this.clear();
        return false;
      }
      this.simulation.restore(parsed.payload);
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  /** Clears the save. Pass `seal` when the page is about to reload. */
  clear(seal = false): void {
    if (seal) this.sealed = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do.
    }
  }

  startAutosave(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.save(), AUTOSAVE_INTERVAL_MS);
    window.addEventListener("pagehide", this.handlePageHide);
  }

  stopAutosave(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pagehide", this.handlePageHide);
  }

  private handlePageHide = (): void => {
    this.save();
  };

  /** Serialises the current world to a file the player can keep. */
  exportToFile(): void {
    const blob = new Blob([this.simulation.serialize()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mosslight-day-${this.simulation.state.day}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Reads a previously exported save. Resolves false when the file is not one. */
  async importFromFile(file: File): Promise<boolean> {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isValidPayload(parsed)) return false;
      this.simulation.restore(parsed);
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}
