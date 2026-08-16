import Phaser from "phaser";

import { AudioEngine } from "./audio/AudioEngine";
import { HUD } from "./ui/HUD";
import { MosslightSimulation } from "./sim/simulation";
import { SaveManager } from "./sim/persistence";
import { SimulationClock, TICK_MS } from "./sim/clock";
import { TorxThrmlBridge } from "./sim/bridge";
import { VIEW_H, VIEW_W, WorldScene } from "./render/WorldScene";
import { KeyboardRouter, bindingLayer, type Binding } from "./ui/keymap";
import { canRenderGame, showBootError } from "./ui/boot";
import "./styles/main.css";

const simulation = new MosslightSimulation(2048);
const bridge = new TorxThrmlBridge();
const audio = new AudioEngine();
const saves = new SaveManager(simulation);
// Declared before the HUD and assigned after it: the HUD's zoom callbacks read
// `worldScene`, and the HUD constructor renders immediately, so a `const`
// declared further down would be in its temporal dead zone on that first render.
// oxlint-disable-next-line prefer-const
let worldScene: WorldScene | undefined;

const hudElement = document.querySelector<HTMLElement>("#hud");
if (!hudElement) throw new Error("Missing #hud element");

const hud = new HUD(hudElement, simulation, {
  onChange: () => worldScene?.renderNow(),
  onZoomChange: (action) => {
    if (action === "in") return worldScene?.zoomIn() ?? 100;
    if (action === "out") return worldScene?.zoomOut() ?? 100;
    return worldScene?.resetZoom() ?? 100;
  },
  getZoomPercent: () => worldScene?.getZoomPercent() ?? 100,
  onSave: () => {
    hud.notify(saves.save() ? "The Commons is saved." : "Could not write a save.");
  },
  onLoad: () => {
    if (!saves.load()) {
      hud.notify("No save to load.");
      return;
    }
    refreshAll();
    hud.notify("The last save is restored.");
  },
  onReset: () => {
    // Drop the save and reload. Rebuilding the scene, HUD, retained view pools,
    // and audio state in place is far more error-prone than a clean boot.
    saves.stopAutosave();
    // Seal so the unload handlers cannot write the discarded world back.
    saves.clear(true);
    location.reload();
  },
  onExport: () => {
    saves.exportToFile();
    hud.notify("A world file is downloading.");
  },
  onImport: (file) => {
    void saves.importFromFile(file).then((ok) => {
      if (ok) {
        refreshAll();
        hud.notify("The imported world is live.");
      } else {
        hud.notify("That file is not a Commons save.");
      }
    });
  },
  onToggleMute: () => audio.toggleMute(),
  isMuted: () => audio.isMuted,
  onFocusResident: (id) => worldScene?.focusResident(id),
  onFocusCell: (x, y) => worldScene?.focusOn({ x, y }),
});

worldScene = new WorldScene(
  simulation,
  () => hud.render(),
  (buildingId) => hud.selectBuilding(buildingId),
);

if (!canRenderGame()) {
  showBootError(
    "This browser cannot open a drawing surface for the basin. Mosslight Commons needs WebGL or canvas — "
    + "try a current browser, or enable hardware acceleration.",
  );
  throw new Error("No WebGL or canvas context available");
}

/**
 * The drawing surface, measured from the map cell before the game boots. Falls
 * back to the design size when the cell has not been laid out yet.
 */
const surface = (() => {
  const host = document.querySelector<HTMLElement>("#game");
  const width = Math.floor(host?.clientWidth ?? 0);
  const height = Math.floor(host?.clientHeight ?? 0);
  return width > 120 && height > 120 ? { width, height } : { width: VIEW_W, height: VIEW_H };
})();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: "#08151B",
  pixelArt: false,
  antialias: true,
  scale: {
    /*
     * FIT, with the surface sized to the map cell at boot (see `surface`).
     *
     * The original 900x640 FIT surface letterboxed badly: on a 1280x720 laptop
     * the cell was 640x320 and the canvas shrank to 450x300 inside it, losing a
     * third of the width. The obvious fix — RESIZE, so the surface tracks the
     * cell — turned out to be unsafe here: resizing the WebGL drawing buffer
     * while the asset loader is still running stalls it mid-queue (six of
     * sixteen files loaded, nothing in flight, nothing failed) and the game
     * never reaches `create`. Choosing the right size once, before the game
     * boots, gets the same full-bleed result without ever resizing the buffer.
     */
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: surface.width,
    height: surface.height,
  },
  scene: [worldScene],
});

/** Re-renders both surfaces after the world object itself was replaced. */
function refreshAll(): void {
  worldScene?.renderNow();
  hud.render();
}

// --- Save bootstrapping ---------------------------------------------------

const existingSave = saves.peek();
if (existingSave) {
  // Resuming is the friendlier default; the HUD exposes NEW for a fresh basin.
  saves.load();
  // A resumed world has already met the basin. Never trap a returning player
  // behind the first-run cards.
  simulation.dismissTitle();
  simulation.dismissOnboarding();
}
saves.startAutosave();
hud.render();

declare global {
  interface Window {
    advanceTime: (milliseconds: number) => void;
    render_game_to_text: () => string;
    probe_board: () => string;
  }
}

window.render_game_to_text = () => {
  const state = simulation.state;
  const resident = simulation.getSelectedResident();
  return JSON.stringify({
    coordinateSystem: "grid origin is top-left; x increases right; y increases down",
    day: state.day,
    season: state.season,
    seasonDay: state.seasonDay,
    phase: state.phase,
    tick: state.tick,
    paused: state.paused,
    speed: state.speed,
    status: state.status,
    departures: state.departures,
    chapter: state.chapter,
    resources: Object.fromEntries(Object.entries(state.resources).map(([key, value]) => [key, Math.round(value)])),
    items: state.items,
    revealedAreas: state.revealedAreas,
    regrowth: state.regrowth.map((entry) => ({ tile: entry.tile, x: entry.x, y: entry.y, ticksRemaining: entry.ticksRemaining })),
    districtFocus: state.districtFocus,
    districts: state.districts.map((district) => ({ type: district.type, label: district.label, bonus: district.bonus })),
    seasonalEvent: {
      title: state.seasonalEvent.title,
      daysRemaining: state.seasonalEvent.daysRemaining,
      effect: state.seasonalEvent.effect,
    },
    expeditions: state.expeditions.map((expedition) => ({
      title: expedition.title,
      zone: expedition.zone,
      progress: expedition.progress,
      duration: expedition.duration,
      status: expedition.status,
    })),
    relationships: state.relationships.length,
    crafting: state.crafting ? {
      recipe: state.crafting.recipe,
      progress: state.crafting.progress,
      duration: state.crafting.duration,
    } : null,
    crafted: state.crafted,
    objectives: simulation.getActiveObjectives().map((objective) => ({
      id: objective.id,
      chapter: objective.chapter,
      progress: objective.progress,
      target: objective.target,
      completed: objective.completed,
    })),
    population: state.residents.length,
    metrics: {
      housingCapacity: state.metrics.housingCapacity,
      housingAvailable: state.metrics.housingAvailable,
      housingPressure: Number(state.metrics.housingPressure.toFixed(3)),
      averageWellbeing: Math.round(state.metrics.averageWellbeing),
      harmony: Math.round(state.metrics.harmony),
      resourceSecurity: Math.round(state.metrics.resourceSecurity),
    },
    buildings: state.buildings.map((building) => ({
      id: building.id,
      type: building.type,
      x: building.position.x,
      y: building.position.y,
      level: building.level,
      upgrading: building.upgrading,
    })),
    selectedResident: resident ? {
      name: resident.name,
      species: resident.species,
      goal: resident.goal,
      stage: resident.stage,
      age: resident.age,
      x: resident.position.x,
      y: resident.position.y,
      pathLength: resident.path.length,
      skills: Object.fromEntries(Object.entries(resident.skills).map(([key, value]) => [key, Math.round(value)])),
      relationships: simulation.getRelationshipsForResident(resident.id).map((relationship) => ({
        kind: relationship.kind,
        strength: Math.round(relationship.strength),
      })),
    } : null,
    forecast: {
      title: state.forecast.title,
      probability: Math.round(state.forecast.probability * 100),
      source: state.forecastSource,
    },
    historyLength: state.history.length,
    onboarding: { step: state.onboardingStep, dismissed: state.onboardingDismissed },
    buildMode: state.buildMode,
    zoomPercent: worldScene?.getZoomPercent() ?? 100,
    habitatStress: state.habitatStress,
    births: state.births,
    cloudmothsArrived: state.cloudmothsArrived,
    longShade: { crisis: state.longShadeCrisis, outcome: state.longShadeOutcome },
    proposal: state.proposal ? { kind: state.proposal.kind, status: state.proposal.status } : null,
    forecastHistory: state.forecastHistory.length,
    waterQuality: Math.round((state.waterQuality?.flat().reduce((sum, value) => sum + value, 0) ?? 0) / Math.max(1, state.waterQuality?.flat().length ?? 1)),
  });
};

/**
 * Board-level QA hook. `render_game_to_text` describes the world but gives no
 * way to reach it with a pointer, so nothing could exercise the core loop.
 */
window.probe_board = () => {
  const state = simulation.state;
  const nodes: Array<{ tile: string; x: number; y: number; screen: { x: number; y: number } | null }> = [];
  for (let y = 0; y < state.grid.length; y += 1) {
    const row = state.grid[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const tile = row[x]!;
      if (tile !== "fern" && tile !== "mushroom" && tile !== "crystal" && tile !== "ruin") continue;
      if (!state.revealed[y]?.[x]) continue;
      nodes.push({ tile, x, y, screen: worldScene?.screenPointForCell({ x, y }) ?? null });
    }
  }
  return JSON.stringify({
    camera: worldScene?.cameraReport() ?? null,
    nodes,
    buildable: (() => {
      const found: Array<{ x: number; y: number; screen: { x: number; y: number } | null }> = [];
      for (let y = 0; y < state.grid.length && found.length < 12; y += 1) {
        for (let x = 0; x < state.grid[y]!.length && found.length < 12; x += 1) {
          if (state.grid[y]![x] !== "grass" || !state.revealed[y]?.[x]) continue;
          if (simulation.getBuildingAt({ x, y })) continue;
          const screen = worldScene?.screenPointForCell({ x, y }) ?? null;
          if (screen) found.push({ x, y, screen });
        }
      }
      return found;
    })(),
  });
};

window.advanceTime = (milliseconds: number) => {
  const steps = Math.max(0, Math.round(milliseconds / TICK_MS));
  if (steps === 0) return;
  const wasPaused = simulation.state.paused;
  simulation.state.paused = false;
  for (let index = 0; index < steps; index += 1) simulation.advance();
  simulation.state.paused = wasPaused;
  refreshAll();
};

// --- Simulation clock -----------------------------------------------------

/**
 * The world advances on its own fixed-step clock rather than a Phaser scene
 * timer, so a stalled frame or a backgrounded tab cannot desynchronise it.
 */
const paintHud = () => {
  try {
    hud.render();
  } catch (error) {
    console.error("HUD render failed", error);
  }
};

const clock = new SimulationClock({
  onTick: () => simulation.advance(),
  onTickError: () => {
    simulation.state.paused = true;
    paintHud();
    hud.notify("Time stuttered. The Commons is paused.");
  },
  onFrame: (ticked) => {
    if (!ticked) return;
    try {
      worldScene?.renderNow();
    } catch (error) {
      console.error("Scene render failed", error);
    }
    paintHud();
    audio.setPhase(simulation.state.phase);
    audio.setSeason(simulation.state.season);
    audio.setHarmony(simulation.state.metrics.harmony);
    audio.reactToMessages(simulation.state.messages);
  },
});
clock.start();

// Audio must be unlocked by a gesture; the first interaction of any kind does it.
const unlockAudio = () => {
  audio.resume();
  audio.setPhase(simulation.state.phase);
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
};
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// --- Keyboard -------------------------------------------------------------

/**
 * Every binding in the game, declared once. The router walks layers by
 * priority, so the HUD's modal layer sees Enter/Space/Escape first and these
 * only run when no card is open. The shortcuts overlay renders from this same
 * list, so it cannot drift.
 */
const GAME_BINDINGS: Binding[] = [
  {
    id: "pause",
    chords: ["space", "p"],
    display: "Space / P",
    description: "Pause or resume the Commons",
    group: "Time",
    preventDefault: true,
    run: () => { simulation.togglePause(); hud.render(); },
  },
  ...([1, 2, 4] as const).map((speed) => ({
    id: `speed-${speed}`,
    chords: [String(speed)],
    display: String(speed),
    description: `Run at ${speed}× speed`,
    group: "Time" as const,
    run: () => { simulation.setSpeed(speed); hud.render(); },
  })),
  {
    id: "zoom-in",
    chords: ["+", "="],
    display: "+",
    description: "Zoom in",
    group: "View",
    preventDefault: true,
    run: () => { worldScene?.zoomIn(); hud.render(); },
  },
  {
    id: "zoom-out",
    chords: ["-", "_"],
    display: "−",
    description: "Zoom out",
    group: "View",
    preventDefault: true,
    run: () => { worldScene?.zoomOut(); hud.render(); },
  },
  {
    id: "zoom-reset",
    chords: ["0"],
    display: "0",
    description: "Reset zoom to fit",
    group: "View",
    preventDefault: true,
    run: () => { worldScene?.resetZoom(); hud.render(); },
  },
  {
    id: "fullscreen",
    chords: ["f"],
    display: "F",
    description: "Toggle fullscreen",
    group: "View",
    preventDefault: true,
    run: () => game.scale.toggleFullscreen(),
  },
  {
    id: "mute",
    chords: ["m"],
    display: "M",
    description: "Mute or unmute",
    group: "View",
    run: () => { audio.toggleMute(); hud.render(); },
  },
  {
    id: "cancel-build",
    chords: ["escape"],
    display: "Esc",
    description: "Cancel the current build",
    group: "World",
    run: () => { simulation.setBuildMode(null); hud.render(); worldScene?.renderNow(); },
  },
  ...([
    ["h", "burrow-home", "Home"],
    ["r", "reed-farm", "Reed Farm"],
    ["g", "lantern-grove", "Lantern Grove"],
    ["c", "commons-market", "Market"],
    ["t", "root-workshop", "Workshop"],
    ["y", "sky-walk", "Sky Walk"],
    ["n", "path", "Path"],
  ] as const).map(([key, tool, label]) => ({
    id: `build-${tool}`,
    chords: [key],
    display: key.toUpperCase(),
    description: `Hold the ${label} tool`,
    group: "World" as const,
    run: () => {
      simulation.setBuildMode(simulation.state.buildMode === tool ? null : tool);
      hud.render();
      worldScene?.renderNow();
    },
  })),
  {
    id: "save",
    chords: ["mod+s"],
    display: "⌘/Ctrl S",
    description: "Save the Commons",
    group: "Session",
    preventDefault: true,
    // Saving from a focused button is still saving; never swallow it.
    allowOnControl: true,
    run: () => { hud.notify(saves.save() ? "The Commons is saved." : "Could not write a save."); },
  },
  {
    id: "shortcuts",
    chords: ["?", "shift+/"],
    display: "?",
    description: "Show this card",
    group: "Session",
    preventDefault: true,
    allowOnControl: true,
    run: () => hud.toggleShortcuts(),
  },
];

const keyboard = new KeyboardRouter();
// Modal cards outrank world bindings; 100 leaves room for layers between.
keyboard.register(hud.keyLayer(100));
keyboard.register(bindingLayer("game", 0, GAME_BINDINGS));
keyboard.attach();
hud.setShortcutBindings(GAME_BINDINGS);

window.addEventListener("beforeunload", () => {
  saves.save();
  clock.stop();
  game.destroy(true);
});

// --- Optional Torx+THRML bridge ------------------------------------------

let forecastInFlight = false;
let forecastTimer: number | null = null;

const syncResearchForecast = async () => {
  // On a deployed build the sidecar cannot exist; the local model is authoritative.
  if (!bridge.isEnabled() || forecastInFlight) return;
  forecastInFlight = true;
  try {
    const result = await bridge.forecast(simulation.state);
    if (!result) {
      if (simulation.state.forecastSource !== "local") {
        simulation.applyForecast(simulation.state.forecast, "local");
        hud.render();
      }
      return;
    }
    simulation.applyResearch(result);
    hud.render();
  } finally {
    forecastInFlight = false;
    // Reschedule with the bridge's own backoff rather than a fixed interval, so
    // a session without the sidecar stops hammering a dead endpoint.
    if (forecastTimer !== null) window.clearTimeout(forecastTimer);
    forecastTimer = window.setTimeout(() => void syncResearchForecast(), bridge.getPollDelay());
  }
};

void syncResearchForecast();

/*
 * A handle on the running world, for development only.
 *
 * Verifying anything that depends on late game state — a tradition ruled out
 * by one already kept, an elder's memory, a settlement in decline — meant
 * playing to it by hand, so those paths got asserted in unit tests and then
 * never actually looked at in a browser. `import.meta.env.DEV` is statically
 * replaced at build time, so this whole block is dropped from a production
 * bundle rather than shipped and guarded at runtime.
 */
if (import.meta.env.DEV) {
  (window as unknown as { mosslight: unknown }).mosslight = {
    simulation,
    hud,
    scene: () => worldScene,
    /** Advance the world by whole days without waiting on the clock. */
    days: (count = 1) => {
      for (let index = 0; index < count * 12; index += 1) simulation.advance();
      hud.render();
      worldScene?.renderNow();
      return simulation.state.day;
    },
  };
}
