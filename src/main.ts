import Phaser from "phaser";

import { HUD } from "./ui/HUD";
import { MosslightSimulation } from "./sim/simulation";
import { TorxThrmlBridge } from "./sim/bridge";
import { WorldScene } from "./render/WorldScene";
import "./styles/main.css";

const simulation = new MosslightSimulation(2048);
const bridge = new TorxThrmlBridge();
let worldScene: WorldScene | undefined;

const hudElement = document.querySelector<HTMLElement>("#hud");
if (!hudElement) throw new Error("Missing #hud element");

const hud = new HUD(hudElement, simulation, () => worldScene?.renderNow());
worldScene = new WorldScene(simulation, () => hud.render());

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
    resources: Object.fromEntries(Object.entries(state.resources).map(([key, value]) => [key, Math.round(value)])),
    items: state.items,
    revealedAreas: state.revealedAreas,
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
    objectives: state.objectives.map((objective) => ({
      id: objective.id,
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
    buildings: state.buildings.map((building) => ({ type: building.type, x: building.position.x, y: building.position.y })),
    selectedResident: resident ? {
      name: resident.name,
      species: resident.species,
      goal: resident.goal,
      x: resident.position.x,
      y: resident.position.y,
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
    buildMode: state.buildMode,
  });
};

window.advanceTime = (milliseconds: number) => {
  const steps = Math.max(0, Math.round(milliseconds / 520));
  if (steps === 0) return;
  const wasPaused = simulation.state.paused;
  simulation.state.paused = false;
  for (let index = 0; index < steps; index += 1) simulation.advance();
  simulation.state.paused = wasPaused;
  worldScene?.renderNow();
  hud.render();
};

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

window.addEventListener("beforeunload", () => game.destroy(true));

let forecastInFlight = false;
const syncResearchForecast = async () => {
  if (forecastInFlight) return;
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
  }
};

void syncResearchForecast();
window.setInterval(() => void syncResearchForecast(), 15000);
