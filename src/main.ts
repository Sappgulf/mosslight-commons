import Phaser from "phaser";

import { AudioEngine } from "./audio/AudioEngine";
import { HUD } from "./ui/HUD";
import { MosslightSimulation } from "./sim/simulation";
import { SaveManager } from "./sim/persistence";
import { SimulationClock, TICK_MS } from "./sim/clock";
import { TorxThrmlBridge } from "./sim/bridge";
import { WorldScene } from "./render/WorldScene";
import "./styles/main.css";

let simulation = new MosslightSimulation(2048);
const bridge = new TorxThrmlBridge();
const audio = new AudioEngine();
let saves = new SaveManager(simulation);
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
  onSave: () => saves.save(),
  onLoad: () => {
    if (!saves.load()) return;
    refreshAll();
  },
  onReset: () => {
    // Drop the save and reload. Rebuilding the scene, HUD, retained view pools,
    // and audio state in place is far more error-prone than a clean boot.
    saves.stopAutosave();
    saves.clear();
    location.reload();
  },
  onExport: () => saves.exportToFile(),
  onImport: (file) => {
    void saves.importFromFile(file).then((ok) => {
      if (ok) refreshAll();
    });
  },
  onToggleMute: () => audio.toggleMute(),
  isMuted: () => audio.isMuted,
});

worldScene = new WorldScene(
  simulation,
  () => hud.render(),
  (buildingId) => hud.selectBuilding(buildingId),
);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 832,
  height: 720,
  backgroundColor: "#08151B",
  pixelArt: false,
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: 832,
    height: 720,
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
}
saves.startAutosave();

declare global {
  interface Window {
    advanceTime: (milliseconds: number) => void;
    render_game_to_text: () => string;
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
const clock = new SimulationClock({
  onTick: () => simulation.advance(),
  onFrame: (ticked) => {
    if (!ticked) return;
    worldScene?.renderNow();
    hud.render();
    audio.setPhase(simulation.state.phase);
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

window.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLButtonElement
    || (event.target instanceof HTMLElement && event.target.isContentEditable)
  ) return;

  if (event.key === " " || event.key.toLowerCase() === "p") {
    event.preventDefault();
    simulation.togglePause();
    hud.render();
    return;
  }

  if (event.key === "1" || event.key === "2" || event.key === "4") {
    simulation.setSpeed(Number(event.key) as 1 | 2 | 4);
    hud.render();
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    worldScene?.zoomIn();
    hud.render();
    return;
  }

  if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    worldScene?.zoomOut();
    hud.render();
    return;
  }

  if (event.key === "0") {
    event.preventDefault();
    worldScene?.resetZoom();
    hud.render();
    return;
  }

  if (event.key.toLowerCase() === "m") {
    audio.toggleMute();
    hud.render();
    return;
  }

  if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saves.save();
    return;
  }

  if (event.key === "Escape") {
    simulation.setBuildMode(null);
    hud.render();
    worldScene?.renderNow();
    return;
  }

  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    game.scale.toggleFullscreen();
  }
});

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
    simulation.applyForecast(result.forecast, result.provider);
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
