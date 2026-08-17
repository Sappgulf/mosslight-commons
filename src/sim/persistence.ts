import { MosslightSimulation, SAVE_VERSION, type SavePayload } from "./simulation";
import type { ResourceKey } from "./types";

const STORAGE_KEY = "mosslight.save.v7";
const BACKUP_STORAGE_KEY = "mosslight.save.v7.backup";
const AUTOSAVE_INTERVAL_MS = 20000;

const BASE_WARNING_BANDS: Record<ResourceKey, number> = {
  food: 0,
  water: 0,
  warmth: 0,
  light: 0,
};

type RecordEnvelope = { payload: SavePayload; savedAt: number };

type RawRecord = {
  payload?: unknown;
  savedAt?: unknown;
};

type RawPayload = RawRecord & {
  version?: unknown;
  rngState?: unknown;
  nextMessageId?: unknown;
  nextResidentId?: unknown;
  nextBuildingId?: unknown;
  nextProposalId?: unknown;
  resourceWarningLevels?: unknown;
  housingMessageBand?: unknown;
  state?: unknown;
};

export interface SaveMeta {
  day: number;
  population: number;
  savedAt: number;
  version: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeWarningBands(value: unknown): Record<ResourceKey, number> {
  if (!isRecord(value)) return { ...BASE_WARNING_BANDS };
  return {
    food: toNumber((value as Record<string, unknown>).food),
    water: toNumber((value as Record<string, unknown>).water),
    warmth: toNumber((value as Record<string, unknown>).warmth),
    light: toNumber((value as Record<string, unknown>).light),
  };
}

function parseSavedAt(value: unknown): number {
  return isRecord(value) ? toNumber((value as RawRecord).savedAt, 0) : toNumber(value, 0);
}

function isLegacyPayload(value: unknown): value is RawPayload {
  if (!isRecord(value)) return false;
  const payload = value as RawPayload;
  if (!payload.state || typeof payload.state !== "object") return false;
      const state = payload.state as {
        grid?: unknown;
        residents?: unknown;
        buildings?: unknown;
        tick?: unknown;
        resources?: unknown;
        revealed?: unknown;
        objectives?: unknown;
      };
  return (
    payload.version !== undefined
    && typeof payload.version === "number"
    && payload.version > 0
    && payload.version <= SAVE_VERSION
    && Array.isArray(state.grid)
    && Array.isArray(state.residents)
    && Array.isArray(state.buildings)
    && Array.isArray(state.revealed)
    && Array.isArray(state.objectives)
    && typeof state.tick === "number"
    && isRecord(state.resources)
  );
}

function normalizePayload(payload: RawPayload): SavePayload {
  return {
    version: toNumber(payload.version, 1),
    rngState: toNumber(payload.rngState, 0),
    nextMessageId: toNumber(payload.nextMessageId, 0),
    nextResidentId: toNumber(payload.nextResidentId, 0),
    nextBuildingId: toNumber(payload.nextBuildingId, 0),
    nextProposalId: toNumber(payload.nextProposalId, 0),
    resourceWarningLevels: normalizeWarningBands(payload.resourceWarningLevels),
    housingMessageBand: toNumber(payload.housingMessageBand, 0),
    state: payload.state as SavePayload["state"],
  };
}

function extractPayload(value: unknown): RecordEnvelope | null {
  if (!isRecord(value)) return null;

  const rawEnvelope = value as RawRecord;
  const direct = isLegacyPayload(rawEnvelope.payload ?? rawEnvelope)
    ? { payload: normalizePayload(rawEnvelope.payload as RawPayload), savedAt: parseSavedAt(rawEnvelope) }
    : null;
  if (direct) return direct;

  const wrapped = rawEnvelope.payload;
  if (!isRecord(wrapped)) return null;

  if (isLegacyPayload(wrapped)) {
    return {
      payload: normalizePayload(wrapped),
      savedAt: parseSavedAt(wrapped as RawRecord & { savedAt?: unknown }),
    };
  }
  return null;
}

function decodeRecord(raw: string): RecordEnvelope | null {
  try {
    return extractPayload(JSON.parse(raw));
  } catch {
    return null;
  }
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

  private readSlot(storageKey: string): RecordEnvelope | null {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? decodeRecord(raw) : null;
    } catch {
      return null;
    }
  }

  private availableRecords(): RecordEnvelope[] {
    const primary = this.readSlot(STORAGE_KEY);
    const backup = this.readSlot(BACKUP_STORAGE_KEY);
    if (!primary && !backup) return [];
    if (!primary) return [backup];
    if (!backup) return [primary];
    return [primary, backup].sort((a, b) => b.savedAt - a.savedAt);
  }

  private latestRecord(): RecordEnvelope | null {
    return this.availableRecords()[0] ?? null;
  }

  hasSave(): boolean {
    return this.latestRecord() !== null;
  }

  peek(): SaveMeta | null {
    const record = this.latestRecord();
    if (!record) return null;
    const payload = record.payload;
    return {
      day: payload.state.day,
      population: payload.state.residents.length,
      savedAt: record.savedAt,
      version: payload.version,
    };
  }

  save(): boolean {
    if (this.sealed) return false;
    try {
      const payload = JSON.parse(this.simulation.serialize()) as unknown;
      const record = JSON.stringify({
        savedAt: Date.now(),
        payload,
      });
      const previous = localStorage.getItem(STORAGE_KEY);
      if (previous) {
        localStorage.setItem(BACKUP_STORAGE_KEY, previous);
      }
      localStorage.setItem(STORAGE_KEY, record);
      return true;
    } catch {
      // A full or unavailable localStorage should never interrupt play.
      return false;
    }
  }

  load(): boolean {
    const records = this.availableRecords();
    if (records.length === 0) return false;
    for (const record of records) {
      try {
        this.simulation.restore(record.payload);
        return true;
      } catch {
        // try older fallback.
      }
    }
    this.clear();
    return false;
  }

  /** Clears the save. Pass `seal` when the page is about to reload. */
  clear(seal = false): void {
    if (seal) this.sealed = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BACKUP_STORAGE_KEY);
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
      const record = extractPayload(parsed);
      if (!record) return false;
      this.simulation.restore(record.payload);
      this.save();
      return true;
    } catch {
      return false;
    }
  }
}
