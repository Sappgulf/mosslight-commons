import {
  BUILDING_DEFINITIONS,
  DISTRICT_DEFINITIONS,
  ITEM_DEFINITIONS,
  MAX_BUILDING_LEVEL,
  ONBOARDING_STEPS,
  OUTPUT_MULTIPLIER,
  PATH_COST,
  RECIPE_DEFINITIONS,
  RESOURCE_DEFINITIONS,
  SPECIES_DEFINITIONS,
  UPGRADE_COSTS,
} from "../data/definitions";
import { MosslightSimulation } from "../sim/simulation";
import { crisisBanner } from "../sim/crisis";
import { WANT_GLYPH } from "../sim/wants";
import type { BuildingType, BuildTool, DistrictType, ItemKey, Message, RecipeKey, ResourceKey } from "../sim/types";
import { isActivationOnControl, isTypingTarget, type Binding, type BindingGroup, type KeyLayer } from "./keymap";
import { masteryTitle, tierFor } from "../sim/mastery";
import { canAfford, isAvailable, missingFor, TRADITION_DEFINITIONS, TRADITION_ORDER } from "../sim/traditions";
import type { TraditionKey } from "../sim/types";

const shortcutGroups: BindingGroup[] = ["Time", "View", "World", "Session"];

const resourceOrder: ResourceKey[] = ["food", "water", "warmth", "light"];
const buildOrder: Exclude<BuildingType, "root-heart">[] = [
  "burrow-home",
  "reed-farm",
  "lantern-grove",
  "commons-market",
  "root-workshop",
];
const itemOrder: ItemKey[] = ["seed-pod", "resin", "moonwater", "map-fragment"];
const districtOrder: DistrictType[] = ["meadow", "wetland", "lantern", "market", "ruin"];
const recipeOrder: RecipeKey[] = ["lantern-kit", "bridge-kit", "comfort-kit"];

type BuildChoice = BuildTool;
type ZoomAction = "in" | "out" | "reset";
type LedgerFilter = "all" | "good" | "warning" | "info";
type MissingCost =
  | { resource: ResourceKey; amount: number }
  | { item: ItemKey; amount: number };

export interface HUDCallbacks {
  onChange: () => void;
  onZoomChange: (action: ZoomAction) => number;
  getZoomPercent: () => number;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onToggleMute: () => boolean;
  isMuted: () => boolean;
  onFocusResident: (id: string) => void;
}

const formatResourceName = (resource: ResourceKey): string => RESOURCE_DEFINITIONS[resource].label.toUpperCase();

/** Drops a trailing S when the count is one. */
const singularise = (label: string, amount: number): string =>
  amount === 1 && label.endsWith("S") ? label.slice(0, -1) : label;

/**
 * Binding text is authored in this repo, not by a player, but the shortcuts
 * card builds markup by concatenation and there is no reason to leave a hole
 * open for whatever ends up flowing through here later.
 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });

export class HUD {
  private readonly root: HTMLElement;
  private readonly simulation: MosslightSimulation;
  private readonly callbacks: HUDCallbacks;
  private activeFieldTab: "field" | "civic" = "field";
  private zoomPercent = 100;
  private selectedBuildingId: string | null = null;
  private ledgerOpen = false;
  private ledgerFilter: LedgerFilter = "all";
  private shortcutsOpen = false;
  private shortcutBindings: readonly Binding[] = [];

  constructor(root: HTMLElement, simulation: MosslightSimulation, callbacks: HUDCallbacks) {
    this.root = root;
    this.simulation = simulation;
    this.callbacks = callbacks;
    this.root.innerHTML = this.template();
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("focusin", (event) => this.handleFocus(event));
    this.root.addEventListener("pointerover", (event) => this.handlePointerover(event));
    this.root.addEventListener("change", (event) => this.handleChange(event));
    this.render();
  }

  /** Called by the scene when the player clicks a building on the map. */
  public selectBuilding(buildingId: string): void {
    this.selectedBuildingId = buildingId;
    this.render();
  }

  /**
   * Progressive disclosure. The first-run screen used to present every system
   * at once — fieldwork, districts, crafting, expeditions, skills, bonds, and
   * the ledger — which is far more than a new player can read. Each surface now
   * appears when it first becomes meaningful.
   */
  private unlocked(feature: "expedition" | "civic" | "skills" | "bonds" | "districts"): boolean {
    const state = this.simulation.state;
    const hasWorkshop = state.buildings.some((building) => building.type === "root-workshop");
    switch (feature) {
      case "expedition":
        // Scouting only makes sense once there is somewhere left to chart and
        // the player has met the idea of map fragments.
        return state.items["map-fragment"] > 0 || state.revealedAreas.length > 0;
      case "civic":
        return hasWorkshop || state.chapter >= 1;
      case "districts":
        return state.chapter >= 1 || hasWorkshop;
      case "skills":
      case "bonds":
        return state.chapter >= 1;
      default:
        return true;
    }
  }

  private applyDisclosure(): void {
    const show = (selector: string, visible: boolean) => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (element) element.hidden = !visible;
    };
    show(".expedition-section", this.unlocked("expedition"));
    show(".district-section", this.unlocked("districts"));
    show('[data-field-tab="civic"]', this.unlocked("civic"));
    show("[data-skills-panel]", this.unlocked("skills"));
    show("[data-bonds-panel]", this.unlocked("bonds"));

    // If the civic tab is still locked, never leave the player stranded on it.
    if (!this.unlocked("civic") && this.activeFieldTab === "civic") {
      this.activeFieldTab = "field";
    }
  }

  public render(): void {
    const state = this.simulation.state;
    this.applyDisclosure();
    this.setText("[data-day]", `DAY ${String(state.day).padStart(2, "0")}`);
    this.setText("[data-season]", `${state.season.toUpperCase()} ${state.seasonDay}/7`);
    this.setText("[data-settlement-summary]", `${state.metrics.population}/${state.metrics.housingCapacity} HOUSED · HARMONY ${Math.round(state.metrics.harmony)}%`);
    const waterAvg = state.waterQuality?.flat().reduce((sum, value) => sum + value, 0) / Math.max(1, state.waterQuality?.flat().length ?? 1);
    this.setText("[data-water-quality]", `WATER ${Math.round(waterAvg)}% · WILD ${Math.max(0, 100 - Math.round(state.habitatStress * 3))}%`);
    this.setText("[data-births]", state.births ? `${state.births} BORN` : "");
    const title = this.root.querySelector<HTMLElement>("[data-title-overlay]");
    if (title) title.hidden = state.titleSeen;
    this.setText("[data-phase]", state.phase.toUpperCase());
    this.setText("[data-status]", state.paused ? "PAUSED" : "LIVE");
    this.setText("[data-provider]", state.forecastSource === "torx-thrml" ? "TORX+THRML" : "LOCAL MODEL");
    this.zoomPercent = this.callbacks.getZoomPercent();
    this.setText("[data-zoom-value]", `${this.zoomPercent}%`);

    // Settlement health banner — the visible face of the new fail state.
    const statusBanner = this.root.querySelector<HTMLElement>("[data-settlement-status]");
    if (statusBanner) {
      statusBanner.dataset.state = state.status;
      const copy: Record<typeof state.status, string> = {
        thriving: "THRIVING · the Commons is steady",
        strained: "STRAINED · stores or spirits are running low",
        failing: `FAILING · restore the basin within ${Math.max(0, Math.ceil((48 - state.collapseTimer) / 12))} days`,
        collapsed: "COLLAPSED · the Mosslight has gone dark",
      };
      statusBanner.textContent = copy[state.status];
      statusBanner.hidden = state.status === "thriving";
    }

    const collapseOverlay = this.root.querySelector<HTMLElement>("[data-collapse-overlay]");
    if (collapseOverlay) collapseOverlay.hidden = state.status !== "collapsed";
    this.setText("[data-collapse-summary]", `The Commons held for ${state.day - 8} days. ${state.departures} residents left before the light failed.`);

    this.root.querySelectorAll<HTMLButtonElement>("[data-field-tab]").forEach((button) => {
      const active = button.dataset.fieldTab === this.activeFieldTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    this.root.querySelectorAll<HTMLElement>("[data-field-view]").forEach((view) => {
      view.hidden = view.dataset.fieldView !== this.activeFieldTab;
    });
    const brandStatus = this.root.querySelector<HTMLElement>(".brand-status");
    if (brandStatus) {
      brandStatus.classList.toggle("is-paused", state.paused);
      brandStatus.setAttribute(
        "aria-label",
        `${state.paused ? "Simulation paused" : "Simulation live"}, ${state.phase} phase, ${state.forecastSource === "torx-thrml" ? "Torx and Thrml forecast" : "local model forecast"}`,
      );
    }

    for (const resource of resourceOrder) {
      const value = Math.round(state.resources[resource]);
      // Stores are held against what the settlement can actually hold, which is
      // built rather than given. A full bar now means "this is all we can keep",
      // not "we reached the number every settlement reaches".
      const capacity = Math.max(1, Math.round(state.metrics.storage[resource]));
      const percent = Math.min(100, Math.round((value / capacity) * 100));
      this.setText(`[data-resource-value="${resource}"]`, String(value));
      this.setText(`[data-resource-cap="${resource}"]`, `/${capacity}`);
      const fill = this.root.querySelector<HTMLElement>(`[data-resource-fill="${resource}"]`);
      if (fill) fill.style.width = `${percent}%`;
      const chip = this.root.querySelector<HTMLElement>(`[data-resource-chip="${resource}"]`);
      if (chip) {
        chip.classList.toggle("is-low", percent < 25);
        chip.classList.toggle("is-full", percent >= 99);
      }
      const meter = this.root.querySelector<HTMLElement>(`[data-resource-meter="${resource}"]`);
      if (meter) {
        meter.setAttribute("aria-valuenow", String(percent));
        meter.setAttribute(
          "aria-valuetext",
          `${value} of ${capacity} ${RESOURCE_DEFINITIONS[resource].label.toLowerCase()} stored`,
        );
      }
    }

    this.renderDiagnosis();

    const itemTotal = itemOrder.reduce((sum, item) => sum + state.items[item], 0);
    this.setText("[data-item-summary]", `${itemTotal} FOUND`);
    for (const item of itemOrder) {
      this.setText(`[data-item-value="${item}"]`, String(state.items[item]));
    }

    this.renderObjectives();
    this.renderBuildingInspector();
    this.renderLedger();
    this.renderPetitions();
    this.renderTraditions();
    this.renderCouncil();

    const activeExpedition = state.expeditions.find((expedition) => expedition.status === "active");
    this.setText(
      "[data-expedition-status]",
      activeExpedition
        ? `${activeExpedition.title} · ${activeExpedition.progress}/${activeExpedition.duration}`
        : state.revealedAreas.length >= 2 ? "ALL ROUTES MAPPED" : "READY TO DISPATCH",
    );
    const dispatchButton = this.root.querySelector<HTMLButtonElement>('[data-action="dispatch-expedition"]');
    if (dispatchButton) {
      dispatchButton.disabled = Boolean(activeExpedition) || state.revealedAreas.length >= 2;
      dispatchButton.textContent = activeExpedition ? "SCOUTING" : state.revealedAreas.length >= 2 ? "MAPPED" : "DISPATCH SCOUT";
    }

    // Re-pointing the districts is a commitment now, so show the lock-out
    // rather than letting the player click into a refusal.
    const switchDays = this.simulation.districtSwitchDaysLeft();
    this.root.querySelectorAll<HTMLButtonElement>("[data-district]").forEach((button) => {
      const district = button.dataset.district as DistrictType;
      const active = district === state.districtFocus;
      const locked = !active && switchDays > 0;
      button.classList.toggle("is-active", active);
      button.classList.toggle("is-locked", locked);
      button.disabled = locked;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.title = locked
        ? `${DISTRICT_DEFINITIONS[district].label}: settling for ${switchDays} more day${switchDays === 1 ? "" : "s"}`
        : `${DISTRICT_DEFINITIONS[district].label}: ${DISTRICT_DEFINITIONS[district].bonus}`;
    });
    this.setText(
      "[data-district-focus]",
      switchDays > 0
        ? `${DISTRICT_DEFINITIONS[state.districtFocus].label} · ${switchDays}d`
        : DISTRICT_DEFINITIONS[state.districtFocus].label,
    );

    const crafting = state.crafting;
    this.setText(
      "[data-crafting-status]",
      crafting
        ? `${RECIPE_DEFINITIONS[crafting.recipe].label} · ${crafting.progress}/${crafting.duration}`
        : state.crafted["bridge-kit"] > 0 ? "BRIDGE ROUTE READY" : "WORKSHOP IDLE",
    );
    this.root.querySelectorAll<HTMLButtonElement>("[data-craft]").forEach((button) => {
      const recipe = button.dataset.craft as RecipeKey;
      const definition = RECIPE_DEFINITIONS[recipe];
      const missing: MissingCost[] = itemOrder.flatMap((item) => {
        const cost = definition.cost[item] ?? 0;
        const available = state.items[item];
        return available < cost ? [{ item, amount: Math.max(1, Math.ceil(cost - available)) }] : [];
      });
      const available = !crafting && state.buildings.some((building) => building.type === "root-workshop") && missing.length === 0;
      button.disabled = !available;
      button.classList.toggle("is-unavailable", !available);
      button.setAttribute("aria-label", `${definition.label}: ${definition.description}`);
      this.setText(`[data-craft-cost="${recipe}"]`, missing.length ? `NEEDS ${this.formatMissingCosts(missing)}` : `READY · ${this.formatItemCost(definition.cost)}`);
    });

    const forecast = state.forecast;
    this.setText("[data-forecast-title]", forecast.title);
    this.setText("[data-forecast-window]", forecast.window);
    this.setText("[data-forecast-probability]", `${Math.round(forecast.probability * 100)}% likely`);
    this.setText("[data-forecast-recommendation]", forecast.recommendation);
    this.setText("[data-season-event-title]", state.seasonalEvent.title);
    this.setText("[data-season-event-description]", state.seasonalEvent.description);
    this.setText("[data-season-event-days]", `${state.seasonalEvent.daysRemaining} DAYS LEFT`);
    const seasonEvent = this.root.querySelector<HTMLElement>("[data-season-event]");
    if (seasonEvent) seasonEvent.dataset.tone = state.seasonalEvent.tone;
    const lesson = this.simulation.forecastLesson();
    const lessonEl = this.root.querySelector<HTMLElement>("[data-forecast-lesson]");
    if (lessonEl) {
      lessonEl.hidden = lesson.length === 0;
      lessonEl.replaceChildren(...lesson.map((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        return item;
      }));
    }
    const cursor = this.simulation.state.forecastCursor + 1;
    const total = Math.max(1, this.simulation.state.forecastHistory.length);
    this.setText("[data-forecast-cursor]", `${cursor}/${total}`);
    const crisis = this.root.querySelector<HTMLElement>("[data-crisis]");
    const banner = crisisBanner(this.simulation.state);
    if (crisis) {
      crisis.hidden = !banner;
      crisis.textContent = banner ?? "";
      crisis.dataset.tone = this.simulation.state.longShadeOutcome === "thrived" ? "good" : "warning";
    }
    const policies = this.root.querySelector<HTMLElement>("[data-policies]");
    if (policies) {
      policies.replaceChildren(...this.simulation.state.activePolicies.map((policy) => {
        const item = document.createElement("span");
        item.className = "policy-chip";
        item.textContent = `${policy.label} · ${policy.daysRemaining}d`;
        return item;
      }));
    }
    const forecastBar = this.root.querySelector<HTMLElement>("[data-forecast-fill]");
    if (forecastBar) forecastBar.style.width = `${Math.round(forecast.probability * 100)}%`;
    const forecastMeter = this.root.querySelector<HTMLElement>("[data-forecast-meter]");
    if (forecastMeter) {
      const probability = Math.round(forecast.probability * 100);
      forecastMeter.setAttribute("aria-valuenow", String(probability));
      forecastMeter.setAttribute("aria-valuetext", `${probability}% likely`);
    }
    const drivers = this.root.querySelector<HTMLElement>("[data-forecast-drivers]");
    if (drivers) {
      drivers.replaceChildren(...forecast.drivers.map((driver) => {
        const item = document.createElement("li");
        item.textContent = driver;
        return item;
      }));
    }

    this.renderResident();
    this.renderMessages();
    this.renderOnboarding();
    this.renderShortcuts();

    this.root.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => {
      const build = button.dataset.build as BuildChoice;
      const active = build === state.buildMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      if (build === "path") {
        const affordable = state.resources.warmth >= PATH_COST.warmth && state.resources.food >= PATH_COST.food;
        button.classList.toggle("is-unavailable", !affordable);
        return;
      }
      const definition = BUILDING_DEFINITIONS[build];
      const missing: MissingCost[] = [...this.getMissingResources(build), ...this.getMissingItems(build)];
      const affordable = missing.length === 0;
      /*
       * The chip has room for a short verdict, not a full shopping list. The
       * Root Workshop needs four things, which spilled the button out of the
       * dock; the itemised list is still in the detail line and the tooltip.
       */
      const shortfall = missing.length === 1
        ? this.formatMissingCosts(missing)
        : `${missing.length} MATERIALS`;
      const status = affordable ? "READY" : `NEEDS ${shortfall}`;
      button.classList.toggle("is-unavailable", !affordable);
      button.setAttribute("aria-label", definition.label);
      this.setText(`[data-build-cost="${build}"]`, this.formatCostCompact(definition));
      this.setText(`[data-build-status="${build}"]`, status);
      this.setText(`[data-build-description="${build}"]`, definition.description);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((button) => {
      const speed = Number(button.dataset.speed);
      const active = speed === state.speed;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-label", `Set simulation speed to ${speed} times${active ? ", selected" : ""}`);
    });

    const pauseButton = this.root.querySelector<HTMLButtonElement>('[data-action="pause"]');
    if (pauseButton) {
      pauseButton.setAttribute("aria-label", state.paused ? "Resume simulation" : "Pause simulation");
      pauseButton.setAttribute("aria-pressed", state.paused ? "true" : "false");
      pauseButton.setAttribute("title", state.paused ? "Resume simulation (Space or P)" : "Pause simulation (Space or P)");
    }
    this.setText("[data-pause-icon]", state.paused ? "▶" : "Ⅱ");
    this.setText("[data-pause-label]", state.paused ? "RESUME" : "PAUSE");

    const muteButton = this.root.querySelector<HTMLButtonElement>('[data-action="mute"]');
    if (muteButton) {
      const muted = this.callbacks.isMuted();
      muteButton.textContent = muted ? "♪̸" : "♪";
      muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
      muteButton.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
      muteButton.title = muted ? "Unmute audio (M)" : "Mute audio (M)";
    }

    this.updateBuildDetail();
  }

  private renderObjectives(): void {
    const state = this.simulation.state;
    const active = this.simulation.getActiveObjectives();
    const objectiveList = this.root.querySelector<HTMLElement>("[data-objectives]");
    if (objectiveList) {
      objectiveList.replaceChildren(...active.map((objective) => {
        const row = document.createElement("article");
        row.className = `objective-row${objective.completed ? " is-complete" : ""}`;

        const heading = document.createElement("div");
        heading.className = "objective-heading";
        const title = document.createElement("strong");
        title.textContent = objective.title;
        const progress = document.createElement("span");
        progress.textContent = `${objective.progress}/${objective.target}`;
        heading.append(title, progress);

        const description = document.createElement("small");
        description.textContent = objective.completed ? "Complete · the Commons remembers." : objective.description;
        const meter = document.createElement("span");
        meter.className = "objective-meter";
        const fill = document.createElement("i");
        fill.style.width = `${Math.round((objective.progress / objective.target) * 100)}%`;
        meter.append(fill);
        row.append(heading, description, meter);
        return row;
      }));
    }
    this.setText(
      "[data-objective-count]",
      `CH.${state.chapter + 1} · ${active.filter((objective) => objective.completed).length}/${active.length} DONE`,
    );
  }

  /** Building inspector — the surface for the new upgrade system. */
  private renderBuildingInspector(): void {
    const panel = this.root.querySelector<HTMLElement>("[data-building-panel]");
    if (!panel) return;

    const building = this.selectedBuildingId
      ? this.simulation.state.buildings.find((candidate) => candidate.id === this.selectedBuildingId)
      : undefined;

    if (!building) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    const definition = BUILDING_DEFINITIONS[building.type];
    const adjacency = this.simulation.getAdjacency(building.id);
    const total = (OUTPUT_MULTIPLIER[building.level] ?? 1) * (adjacency?.multiplier ?? 1);
    this.setText("[data-building-name]", definition.label);
    this.setText("[data-building-level]", `LEVEL ${building.level}/${MAX_BUILDING_LEVEL}`);
    this.setText("[data-building-output]", `OUTPUT ${Math.round(total * 100)}%`);
    this.setText("[data-building-description]", definition.description);

    // Explain the site, so an underperforming building is diagnosable.
    const siteList = this.root.querySelector<HTMLElement>("[data-building-site]");
    if (siteList) {
      const notes = adjacency?.notes ?? [];
      siteList.hidden = notes.length === 0;
      siteList.replaceChildren(...notes.map((note) => {
        const item = document.createElement("li");
        item.className = note.good ? "site-note site-note--good" : "site-note site-note--bad";
        item.textContent = note.text;
        return item;
      }));
    }

    const upgradeButton = this.root.querySelector<HTMLButtonElement>('[data-action="upgrade-building"]');
    const costLabel = this.root.querySelector<HTMLElement>("[data-building-upgrade-cost]");
    const progress = this.root.querySelector<HTMLElement>("[data-building-upgrade-progress]");
    if (!upgradeButton || !costLabel || !progress) return;

    if (building.upgrading) {
      const plan = UPGRADE_COSTS[building.level + 1];
      upgradeButton.disabled = true;
      upgradeButton.textContent = "UNDER WORK";
      costLabel.textContent = `Raising to level ${building.level + 1}.`;
      progress.hidden = false;
      const percent = plan ? Math.round((building.upgradeProgress / plan.duration) * 100) : 0;
      progress.querySelector("i")?.setAttribute("style", `width:${percent}%`);
      return;
    }

    progress.hidden = true;

    if (building.level >= MAX_BUILDING_LEVEL || building.type === "root-heart") {
      upgradeButton.disabled = true;
      upgradeButton.textContent = building.type === "root-heart" ? "THE ROOT ENDURES" : "FULLY GROWN";
      costLabel.textContent = building.type === "root-heart"
        ? "The Mosslight Root cannot be rebuilt."
        : "This building is at its greatest size.";
      return;
    }

    const plan = UPGRADE_COSTS[building.level + 1]!;
    const check = this.simulation.canUpgrade(building.id);
    upgradeButton.disabled = !check.ok;
    upgradeButton.textContent = check.ok ? `UPGRADE TO L${building.level + 1}` : check.reason;
    const parts = [
      ...(Object.entries(plan.cost) as Array<[ResourceKey, number]>).map(([resource, amount]) => `${amount} ${formatResourceName(resource)}`),
      ...(Object.entries(plan.itemCost) as Array<[ItemKey, number]>).map(([item, amount]) => `${amount} ${ITEM_DEFINITIONS[item].label.toUpperCase()}`),
    ];
    costLabel.textContent = `Cost: ${parts.join(" · ")} · ${plan.duration} ticks of work.`;
  }

  private renderResident(): void {
    const state = this.simulation.state;
    const resident = this.simulation.getSelectedResident();
    if (!resident) return;

    const species = SPECIES_DEFINITIONS[resident.species];
    this.setText("[data-resident-name]", resident.name);
    // Lead with what they have become, not only what they were born as.
    const title = masteryTitle(resident);
    this.setText("[data-resident-species]", title ? `${title} · ${species.label}` : `${species.label} · ${species.role}`);
    const portrait = this.root.querySelector<HTMLImageElement>("[data-resident-portrait]");
    if (portrait) {
      portrait.src = `assets/runtime/portraits/${resident.species}.webp`;
      portrait.alt = species.label;
    }
    this.setText("[data-resident-goal]", resident.goal);
    this.setText("[data-resident-explanation]", resident.lastDecisionExplanation);
    this.setText("[data-resident-glyph]", resident.species === "glowtail" ? "✧" : resident.species === "mireling" ? "◌" : resident.species === "cloudmoth" ? "☽" : "●");
    this.setText("[data-resident-stage]", `${resident.stage.toUpperCase()} · ${resident.age}d`);

    // A resident's personal request is the most player-actionable thing about
    // them, so it sits above the generic decision note.
    const wantNote = this.root.querySelector<HTMLElement>("[data-resident-want]");
    if (wantNote) {
      wantNote.hidden = !resident.want;
      if (resident.want) {
        const waited = state.day - resident.want.createdDay;
        wantNote.textContent = `${resident.want.description}${waited > 6 ? " They have been waiting a while." : ""}`;
        wantNote.classList.toggle("is-impatient", waited > 6);
      }
    }

    // Skills panel, added alongside the resident lifecycle.
    const skillList = this.root.querySelector<HTMLElement>("[data-skills]");
    if (skillList) {
      skillList.replaceChildren(...(Object.keys(resident.skills) as Array<keyof typeof resident.skills>).map((skill) => {
        const row = document.createElement("div");
        row.className = "need-row";
        const level = resident.skills[skill];
        const tier = tierFor(level);
        const name = document.createElement("span");
        name.textContent = skill;
        const meter = document.createElement("div");
        meter.className = "need-meter";
        const fill = document.createElement("i");
        fill.style.width = `${Math.round(level)}%`;
        meter.append(fill);
        const value = document.createElement("b");
        // The tier is the readable part; the number is the detail behind it.
        value.textContent = tier.rank > 0 ? tier.label : String(Math.round(level));
        value.title = `${Math.round(level)} / 100`;
        row.classList.toggle("is-mastered", tier.rank >= 3);
        row.append(name, meter, value);
        return row;
      }));
    }

    for (const need of Object.keys(resident.needs) as Array<keyof typeof resident.needs>) {
      const fill = this.root.querySelector<HTMLElement>(`[data-need-fill="${need}"]`);
      const value = Math.round(resident.needs[need]);
      if (fill) fill.style.width = `${value}%`;
      this.setText(`[data-need-value="${need}"]`, `${value}`);
      const meter = this.root.querySelector<HTMLElement>(`[data-need-meter="${need}"]`);
      if (meter) {
        meter.setAttribute("aria-valuenow", String(value));
        meter.setAttribute("aria-valuetext", `${value} percent ${need} need fulfilled`);
      }
    }

    const relationshipList = this.root.querySelector<HTMLElement>("[data-relationships]");
    if (relationshipList) {
      relationshipList.replaceChildren(...this.simulation.getRelationshipsForResident(resident.id).map((relationship) => {
        const partnerId = relationship.aId === resident.id ? relationship.bId : relationship.aId;
        const partner = state.residents.find((candidate) => candidate.id === partnerId);
        const item = document.createElement("li");
        item.textContent = `${relationship.kind} · ${partner?.name ?? "neighbor"} · ${Math.round(relationship.strength)}%`;
        item.className = `relationship relationship--${relationship.kind}`;
        return item;
      }));
    }
  }

  private renderMessages(): void {
    const state = this.simulation.state;
    const messageList = this.root.querySelector<HTMLElement>("[data-messages]");
    const latestMessage = state.messages[0];
    const feedback = this.root.querySelector<HTMLElement>("[data-feedback]");
    const feedbackPanel = this.root.querySelector<HTMLElement>("[data-feedback-panel]");
    if (feedbackPanel) feedbackPanel.className = `latest-feedback${latestMessage ? ` message--${latestMessage.tone}` : ""}`;
    if (feedback) feedback.textContent = latestMessage?.text ?? "No new notes from the Commons.";
    this.setText("[data-message-count]", `${state.history.length} LOGGED`);
    if (messageList) {
      messageList.replaceChildren(...state.messages.slice(1, 3).map((message) => {
        const item = document.createElement("li");
        item.className = `message message--${message.tone}`;
        item.textContent = message.text;
        return item;
      }));
    }
  }

  /** Full scrollback ledger, replacing the old five-line cap. */
  private renderLedger(): void {
    const overlay = this.root.querySelector<HTMLElement>("[data-ledger-overlay]");
    if (!overlay) return;
    overlay.hidden = !this.ledgerOpen;
    if (!this.ledgerOpen) return;

    this.root.querySelectorAll<HTMLButtonElement>("[data-ledger-filter]").forEach((button) => {
      const active = button.dataset.ledgerFilter === this.ledgerFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const history = this.simulation.state.history.filter(
      (message) => this.ledgerFilter === "all" || message.tone === this.ledgerFilter,
    );
    this.setText("[data-ledger-count]", `${history.length} ENTRIES`);

    const list = this.root.querySelector<HTMLElement>("[data-ledger-list]");
    if (!list) return;
    if (history.length === 0) {
      const empty = document.createElement("li");
      empty.className = "message";
      empty.textContent = "Nothing recorded under this filter yet.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...history.map((message: Message) => {
      const item = document.createElement("li");
      item.className = `message message--${message.tone}`;
      const day = document.createElement("b");
      day.className = "ledger-day";
      day.textContent = `D${String(message.day).padStart(2, "0")}`;
      const text = document.createElement("span");
      text.textContent = message.text;
      item.append(day, text);
      return item;
    }));
  }

  private renderPetitions(): void {
    const list = this.root.querySelector<HTMLElement>("[data-petitions]");
    if (!list) return;
    const open = this.simulation.state.residents.filter((resident) => resident.want && !resident.want.fulfilled).slice(0, 4);
    if (open.length === 0) {
      list.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "petition-empty";
      empty.textContent = "No open petitions. Neighbors will ask when something is missing.";
      list.append(empty);
      return;
    }
    list.replaceChildren(...open.map((resident) => {
      const want = resident.want!;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "petition";
      item.dataset.focusResident = resident.id;
      const daysLeft = want.deadlineDay - this.simulation.state.day;
      item.classList.toggle("is-impatient", daysLeft <= 2);

      const text = document.createElement("span");
      text.className = "petition-text";
      text.textContent = `${WANT_GLYPH[want.kind]} ${want.description}`;

      // A request is a small contract, so show both halves of the bargain.
      const terms = document.createElement("span");
      terms.className = "petition-terms";
      const clock = document.createElement("strong");
      clock.textContent = daysLeft <= 0
        ? "LAST DAY"
        : `${daysLeft} DAY${daysLeft === 1 ? "" : "S"} LEFT`;
      const reward = document.createElement("em");
      reward.textContent = `+${want.rewardAmount} ${ITEM_DEFINITIONS[want.rewardItem].label}`;
      terms.append(clock, reward);

      item.append(text, terms);
      return item;
    }));
  }

  /**
   * The plain reading of why the Commons is doing well or badly.
   *
   * The settlement used to decline behind four full bars with nothing
   * explaining it — the status line said "strained" and left the player to
   * guess. This names the need in the worst shape, the cause, and the fix.
   */
  private renderDiagnosis(): void {
    const panel = this.root.querySelector<HTMLElement>("[data-diagnosis]");
    if (!panel) return;
    const { diagnosis } = this.simulation.state.metrics;
    panel.dataset.tone = diagnosis.tone;
    this.setText("[data-diagnosis-need]", `${diagnosis.need.toUpperCase()} ${Math.round(diagnosis.level)}`);
    this.setText("[data-diagnosis-cause]", diagnosis.cause);
    this.setText("[data-diagnosis-advice]", diagnosis.advice);
  }

  /** Fills the traditions panel: what the Commons keeps, and what it could. */
  private renderTraditions(): void {
    const list = this.root.querySelector<HTMLElement>("[data-traditions]");
    if (!list) return;
    const state = this.simulation.state;

    const rows = TRADITION_ORDER
      .filter((key) => state.traditions.includes(key) || isAvailable(state, key))
      .map((key) => {
        const definition = TRADITION_DEFINITIONS[key];
        const kept = state.traditions.includes(key);
        const affordable = canAfford(state, key);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "tradition";
        button.dataset.tradition = key;
        button.disabled = kept || !affordable;
        button.classList.toggle("is-kept", kept);
        button.classList.toggle("is-unaffordable", !kept && !affordable);
        button.title = definition.effect;

        const head = document.createElement("span");
        head.className = "tradition-head";
        const icon = document.createElement("span");
        icon.className = "tradition-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = definition.icon;
        const label = document.createElement("strong");
        label.textContent = definition.label;
        head.append(icon, label);

        const effect = document.createElement("small");
        effect.className = "tradition-effect";
        effect.textContent = definition.effect;

        const cost = document.createElement("small");
        cost.className = "tradition-cost";
        if (kept) {
          cost.textContent = "KEPT";
        } else {
          const missing = missingFor(state, key);
          cost.textContent = missing.length === 0
            ? `TAKE UP · ${this.formatItemCost(definition.cost)}`
            : `NEEDS ${missing.map((entry) => `${entry.amount} ${ITEM_DEFINITIONS[entry.item].label}`).join(" · ")}`;
        }

        button.append(head, effect, cost);
        return button;
      });

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "petition-empty";
      empty.textContent = "No practices to take up yet. Keep gathering.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...rows);
  }

  private renderCouncil(): void {
    const card = this.root.querySelector<HTMLElement>("[data-council]");
    if (!card) return;
    const proposal = this.simulation.state.proposal;
    const pending = proposal?.status === "pending";
    card.hidden = !pending;
    if (!pending || !proposal) return;
    this.setText("[data-council-title]", proposal.title);
    this.setText("[data-council-body]", proposal.body);
    this.setText(
      "[data-council-deadline]",
      `Vote by day ${proposal.deadlineDay} · ${Math.max(0, proposal.deadlineDay - this.simulation.state.day)} days left`,
    );
    const votes = this.root.querySelector<HTMLElement>("[data-council-votes]");
    if (votes) {
      votes.replaceChildren(...(proposal.votes ?? []).map((vote) => {
        const item = document.createElement("span");
        item.className = `vote vote--${vote.stance}`;
        item.textContent = `${vote.species} ${vote.stance} (${vote.weight})`;
        return item;
      }));
    }
  }

  /** First-run walkthrough. */
  private renderOnboarding(): void {
    const overlay = this.root.querySelector<HTMLElement>("[data-onboarding]");
    if (!overlay) return;
    const state = this.simulation.state;
    const done = state.onboardingDismissed || state.onboardingStep >= ONBOARDING_STEPS.length;
    overlay.hidden = done;
    if (done) return;

    const step = ONBOARDING_STEPS[state.onboardingStep]!;
    this.setText("[data-onboarding-title]", step.title);
    this.setText("[data-onboarding-body]", step.body);
    this.setText("[data-onboarding-hint]", step.hint);
    this.setText("[data-onboarding-progress]", `${state.onboardingStep + 1} / ${ONBOARDING_STEPS.length}`);
    const next = this.root.querySelector<HTMLButtonElement>('[data-action="onboarding-next"]');
    if (next) next.textContent = state.onboardingStep === ONBOARDING_STEPS.length - 1 ? "BEGIN" : "NEXT";
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;

    const petition = target.closest<HTMLButtonElement>("[data-focus-resident]");
    if (petition?.dataset.focusResident) {
      this.simulation.selectResident(petition.dataset.focusResident);
      this.callbacks.onFocusResident(petition.dataset.focusResident);
      this.render();
      this.callbacks.onChange();
      return;
    }

    const fieldTab = target.closest<HTMLButtonElement>("[data-field-tab]");
    if (fieldTab?.dataset.fieldTab === "field" || fieldTab?.dataset.fieldTab === "civic") {
      this.activeFieldTab = fieldTab.dataset.fieldTab;
      if (this.activeFieldTab === "civic") this.simulation.noteTutorial("civic");
      this.render();
      return;
    }

    const ledgerFilter = target.closest<HTMLButtonElement>("[data-ledger-filter]");
    if (ledgerFilter?.dataset.ledgerFilter) {
      this.ledgerFilter = ledgerFilter.dataset.ledgerFilter as LedgerFilter;
      this.render();
      return;
    }

    const buildButton = target.closest<HTMLButtonElement>("[data-build]");
    if (buildButton) {
      const build = buildButton.dataset.build as BuildChoice;
      // The detail panel used to fill in on hover or focus only. Touch has no
      // hover, and iOS does not focus a button on tap, so tapping a build
      // option left the player with no description of what they had selected.
      this.updateBuildDetail(build);
      this.simulation.setBuildMode(this.simulation.state.buildMode === build ? null : build);
      this.render();
      this.callbacks.onChange();
      return;
    }

    const districtButton = target.closest<HTMLButtonElement>("[data-district]");
    if (districtButton?.dataset.district) {
      this.simulation.setDistrictFocus(districtButton.dataset.district as DistrictType);
      this.render();
      this.callbacks.onChange();
      return;
    }

    const traditionButton = target.closest<HTMLButtonElement>("[data-tradition]");
    if (traditionButton?.dataset.tradition) {
      this.simulation.adoptTradition(traditionButton.dataset.tradition as TraditionKey);
      this.render();
      this.callbacks.onChange();
      return;
    }

    const craftButton = target.closest<HTMLButtonElement>("[data-craft]");
    if (craftButton?.dataset.craft) {
      this.simulation.startCraft(craftButton.dataset.craft as RecipeKey);
      this.render();
      this.callbacks.onChange();
      return;
    }

    const speedButton = target.closest<HTMLButtonElement>("[data-speed]");
    if (speedButton) {
      this.simulation.setSpeed(Number(speedButton.dataset.speed) as 1 | 2 | 4);
      this.render();
      return;
    }

    const zoomButton = target.closest<HTMLButtonElement>("[data-zoom]");
    if (zoomButton?.dataset.zoom === "in" || zoomButton?.dataset.zoom === "out" || zoomButton?.dataset.zoom === "reset") {
      this.callbacks.onZoomChange(zoomButton.dataset.zoom);
      this.render();
      return;
    }

    const overlayAction = target.closest<HTMLElement>("[data-overlay-action]")?.dataset.overlayAction;
    if (overlayAction === "dismiss-title") {
      this.simulation.dismissTitle();
      this.render();
      /*
       * Drop focus rather than moving it to the coach's NEXT button. Focus had
       * been left on the title button, which is now hidden, so the next Enter
       * was swallowed as that button's activation. Parking focus on NEXT fixes
       * Enter but breaks Space, which would activate the button instead of
       * pausing the game — and in a game Space belongs to the clock. With
       * nothing focused, Enter advances the coach and Space pauses, which is
       * what a player expects from both keys.
       */
      this.blurActive();
      return;
    }
    if (overlayAction === "skip-onboarding") {
      this.simulation.dismissOnboarding();
      this.render();
      return;
    }

    const actionButton = target.closest<HTMLButtonElement>("[data-action]");
    const action = actionButton?.dataset.action;
    if (!action) return;

    switch (action) {
      case "pause":
        this.simulation.togglePause();
        break;
      case "clear-build":
        this.simulation.setBuildMode(null);
        this.callbacks.onChange();
        break;
      case "dispatch-expedition":
        this.simulation.dispatchExpedition();
        this.callbacks.onChange();
        break;
      case "upgrade-building":
        if (this.selectedBuildingId) this.simulation.startUpgrade(this.selectedBuildingId);
        this.callbacks.onChange();
        break;
      case "close-building":
        this.selectedBuildingId = null;
        break;
      case "toggle-ledger":
        this.ledgerOpen = !this.ledgerOpen;
        break;
      case "close-ledger":
        this.ledgerOpen = false;
        break;
      case "shortcuts":
        this.shortcutsOpen = !this.shortcutsOpen;
        break;
      case "shortcuts-close":
        this.shortcutsOpen = false;
        break;
      case "onboarding-next":
        this.simulation.advanceOnboarding();
        break;
      case "onboarding-skip":
        this.simulation.dismissOnboarding();
        break;
      case "dismiss-title":
        this.simulation.dismissTitle();
        break;
      case "approve-proposal":
        this.simulation.approveProposal();
        this.callbacks.onChange();
        break;
      case "reject-proposal":
        this.simulation.rejectProposal();
        this.callbacks.onChange();
        break;
      case "forecast-back":
        this.simulation.rewindForecast(-1);
        break;
      case "forecast-forward":
        this.simulation.rewindForecast(1);
        break;
      case "save":
        this.callbacks.onSave();
        break;
      case "load":
        this.callbacks.onLoad();
        break;
      case "reset":
        this.callbacks.onReset();
        break;
      case "export":
        this.callbacks.onExport();
        break;
      case "import":
        this.root.querySelector<HTMLInputElement>("[data-import-input]")?.click();
        break;
      case "mute":
        this.callbacks.onToggleMute();
        break;
      default:
        return;
    }
    this.render();
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.matches("[data-import-input]")) return;
    const file = input.files?.[0];
    if (file) this.callbacks.onImport(file);
    input.value = "";
  }

  /**
   * The HUD's modal keys, as a layer for the shared router. This sits above the
   * global game bindings so the title card and the first-run coach get first
   * refusal on Enter, Space, and Escape — but it is reached exactly once per
   * press, which is what the two old listeners could not promise.
   */
  public keyLayer(priority: number): KeyLayer {
    return {
      name: "hud-modal",
      priority,
      handle: (event: KeyboardEvent, chord: string): boolean => {
        if (isTypingTarget(event.target)) return false;
        const state = this.simulation.state;

        if (this.shortcutsOpen) {
          if (chord === "escape" || chord === "?" || chord === "shift+/") {
            event.preventDefault();
            this.shortcutsOpen = false;
            this.render();
            return true;
          }
          return false;
        }

        if (!state.titleSeen) {
          if (chord === "enter" || chord === "space" || chord === "escape") {
            event.preventDefault();
            this.simulation.dismissTitle();
            this.render();
            return true;
          }
          return false;
        }

        if (!state.onboardingDismissed && state.onboardingStep < ONBOARDING_STEPS.length) {
          if (chord === "escape") {
            event.preventDefault();
            this.simulation.dismissOnboarding();
            this.render();
            return true;
          }
          // Enter on a focused button is that button's own activation.
          if (chord === "enter" && !isActivationOnControl(event.target, chord)) {
            event.preventDefault();
            this.simulation.advanceOnboarding();
            this.render();
            return true;
          }
        }

        if (this.ledgerOpen && chord === "escape") {
          event.preventDefault();
          this.ledgerOpen = false;
          this.render();
          return true;
        }

        return false;
      },
    };
  }

  /**
   * Renders the shortcuts card straight from the router's binding list, so a
   * new binding documents itself and the card can never drift out of date.
   */
  private renderShortcuts(): void {
    const overlay = this.root.querySelector<HTMLElement>("[data-shortcuts-overlay]");
    if (!overlay) return;
    overlay.hidden = !this.shortcutsOpen;
    if (!this.shortcutsOpen) return;

    const container = this.root.querySelector<HTMLElement>("[data-shortcut-groups]");
    if (!container) return;
    container.innerHTML = shortcutGroups
      .map((group) => {
        const rows = this.shortcutBindings.filter((binding) => binding.group === group);
        if (rows.length === 0) return "";
        const items = rows
          .map((binding) => `<li><kbd>${escapeHtml(binding.display)}</kbd><span>${escapeHtml(binding.description)}</span></li>`)
          .join("");
        return `<div class="shortcut-group"><h3>${group}</h3><ul>${items}</ul></div>`;
      })
      .join("");
  }

  /** Releases focus so global key bindings apply again. */
  private blurActive(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
  }

  /** Opens or closes the keyboard shortcuts card. */
  public toggleShortcuts(): void {
    this.shortcutsOpen = !this.shortcutsOpen;
    this.render();
  }

  /** Fills the shortcuts overlay from the router's own binding list. */
  public setShortcutBindings(bindings: readonly Binding[]): void {
    this.shortcutBindings = bindings;
    this.render();
  }

  private handleFocus(event: FocusEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-build]");
    if (button?.dataset.build) this.updateBuildDetail(button.dataset.build as BuildChoice);
  }

  private handlePointerover(event: PointerEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-build]");
    if (button?.dataset.build) this.updateBuildDetail(button.dataset.build as BuildChoice);
  }

  private getMissingResources(build: Exclude<BuildChoice, "path">): Array<{ resource: ResourceKey; amount: number }> {
    const definition = BUILDING_DEFINITIONS[build];
    return resourceOrder.flatMap((resource) => {
      const cost = definition.cost[resource] ?? 0;
      const available = this.simulation.state.resources[resource];
      return available < cost ? [{ resource, amount: Math.max(1, Math.ceil(cost - available)) }] : [];
    });
  }

  private getMissingItems(build: Exclude<BuildChoice, "path">): Array<{ item: ItemKey; amount: number }> {
    const definition = BUILDING_DEFINITIONS[build];
    return itemOrder.flatMap((item) => {
      const cost = definition.itemCost?.[item] ?? 0;
      const available = this.simulation.state.items[item];
      return available < cost ? [{ item, amount: Math.max(1, Math.ceil(cost - available)) }] : [];
    });
  }

  private formatCost(definition: {
    cost: Partial<Record<ResourceKey, number>>;
    itemCost?: Partial<Record<ItemKey, number>>;
  }): string {
    const resourceCosts = resourceOrder
      .filter((resource) => (definition.cost[resource] ?? 0) > 0)
      .map((resource) => `${formatResourceName(resource)} ${definition.cost[resource]}`);
    const itemCosts = itemOrder
      .filter((item) => (definition.itemCost?.[item] ?? 0) > 0)
      .map((item) => `${ITEM_DEFINITIONS[item].label.toUpperCase()} ${definition.itemCost?.[item]}`);
    return [...resourceCosts, ...itemCosts].join(" · ") || "NONE";
  }

  /**
   * A compact cost for the build chip. The full form ("COST · FOOD 10 · WATER 6
   * · AMBER RESIN 2 · MAP FRAGMENTS 1") wrapped to four lines and pushed the
   * Root Workshop button out of the dock. The chip now shows icon-and-number
   * pairs; the full wording is still spelled out in the detail line above the
   * grid, in the tooltip, and in the button's accessible description.
   */
  private formatCostCompact(definition: {
    cost: Partial<Record<ResourceKey, number>>;
    itemCost?: Partial<Record<ItemKey, number>>;
  }): string {
    const resourceCosts = resourceOrder
      .filter((resource) => (definition.cost[resource] ?? 0) > 0)
      .map((resource) => `${RESOURCE_DEFINITIONS[resource].icon}${definition.cost[resource]}`);
    const itemCosts = itemOrder
      .filter((item) => (definition.itemCost?.[item] ?? 0) > 0)
      .map((item) => `${ITEM_DEFINITIONS[item].icon}${definition.itemCost?.[item]}`);
    return [...resourceCosts, ...itemCosts].join("  ") || "FREE";
  }

  private formatMissingCosts(missing: MissingCost[]): string {
    return missing
      .map((cost) => "resource" in cost
        ? `${cost.amount} ${formatResourceName(cost.resource)}`
        // Item labels are stored plural ("Map Fragments"), which read as
        // "1 MAP FRAGMENTS" whenever exactly one was missing.
        : `${cost.amount} ${singularise(ITEM_DEFINITIONS[cost.item].label.toUpperCase(), cost.amount)}`)
      .join(" · ");
  }

  private formatItemCost(cost: Partial<Record<ItemKey, number>>): string {
    return itemOrder
      .filter((item) => (cost[item] ?? 0) > 0)
      .map((item) => `${ITEM_DEFINITIONS[item].label.toUpperCase()} ${cost[item]}`)
      .join(" · ");
  }

  private updateBuildDetail(build: BuildChoice | null = this.simulation.state.buildMode): void {
    const detail = this.root.querySelector<HTMLElement>("[data-build-detail]");
    if (!detail) return;

    if (!build) {
      detail.textContent = "Choose a tool. Costs are shown on every tile; press Escape to clear a selection.";
      return;
    }

    if (build === "path") {
      const ready = this.simulation.state.resources.warmth >= PATH_COST.warmth && this.simulation.state.resources.food >= PATH_COST.food;
      detail.textContent = `Packed path: motes prefer roads. Cost: ${PATH_COST.food} food · ${PATH_COST.warmth} warmth; ${ready ? "ready to pack" : "short on stores"}.`;
      return;
    }

    const definition = BUILDING_DEFINITIONS[build];
    const missing: MissingCost[] = [...this.getMissingResources(build), ...this.getMissingItems(build)];
    const status = missing.length === 0 ? "ready to place" : `short on ${this.formatMissingCosts(missing)}`;
    detail.textContent = `${definition.label}: ${definition.description} Cost: ${this.formatCost(definition)}; ${status}.`;
  }

  private setText(selector: string, value: string): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  }

  private template(): string {
    const resourceMarkup = resourceOrder.map((resource) => {
      const definition = RESOURCE_DEFINITIONS[resource];
      return `<div class="resource-chip" data-resource-chip="${resource}" style="--resource-color: ${definition.color}">
        <span class="resource-icon" aria-hidden="true">${definition.icon}</span>
        <div class="resource-copy"><span>${definition.label}</span><span class="resource-amount"><strong data-resource-value="${resource}">0</strong><small data-resource-cap="${resource}">/0</small></span></div>
        <div class="resource-meter" data-resource-meter="${resource}" role="progressbar" aria-label="${definition.label} in stores" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-resource-fill="${resource}"></i></div>
      </div>`;
    }).join("");

    const itemMarkup = itemOrder.map((item) => {
      const definition = ITEM_DEFINITIONS[item];
      return `<div class="item-chip" style="--item-color: ${definition.color}" title="${definition.description}">
        <span class="item-icon" aria-hidden="true">${definition.icon}</span><span class="item-copy"><strong data-item-value="${item}">0</strong><small>${definition.label}</small></span>
      </div>`;
    }).join("");

    const districtMarkup = districtOrder.map((district) => {
      const definition = DISTRICT_DEFINITIONS[district];
      return `<button class="district-button" type="button" data-district="${district}" aria-pressed="false" title="${definition.bonus}"><span aria-hidden="true">${definition.icon}</span><small>${definition.label.replace("Commons ", "")}</small></button>`;
    }).join("");

    const recipeMarkup = recipeOrder.map((recipe) => {
      const definition = RECIPE_DEFINITIONS[recipe];
      return `<button class="craft-button" type="button" data-craft="${recipe}" aria-label="${definition.label}: ${definition.description}" title="${definition.description}"><span class="craft-icon" aria-hidden="true">${definition.icon}</span><span>${definition.label}</span><small data-craft-cost="${recipe}">NEEDS MATERIALS</small></button>`;
    }).join("");

    const pathButton = `<button class="build-button" type="button" data-build="path" aria-pressed="false" aria-label="Packed path" title="Lay a road motes prefer"><span class="build-icon" aria-hidden="true">≈</span><span class="build-name">PATH</span><span class="build-cost">${RESOURCE_DEFINITIONS.food.icon}${PATH_COST.food}  ${RESOURCE_DEFINITIONS.warmth.icon}${PATH_COST.warmth}</span><span class="build-status">ROAD</span></button>`;
    const buildMarkup = buildOrder.map((type) => {
      const definition = BUILDING_DEFINITIONS[type];
      return `<button class="build-button" type="button" data-build="${type}" aria-pressed="false" aria-label="${definition.label}" aria-describedby="build-${type}-description build-${type}-cost build-${type}-status" title="${definition.description}">
        <span class="build-icon" aria-hidden="true">${definition.icon}</span><span class="build-name">${definition.shortLabel}</span>
        <span class="build-cost" id="build-${type}-cost" data-build-cost="${type}">COST</span>
        <span class="build-status" id="build-${type}-status" data-build-status="${type}">READY</span>
        <span class="sr-only" id="build-${type}-description" data-build-description="${type}">${definition.description}</span>
      </button>`;
    }).join("");

    return `<section class="brand-card panel" aria-labelledby="brand-heading">
      <div class="brand-kicker">THE LIVING CITY SIM</div>
      <h1 id="brand-heading">Mosslight<br /><em>Commons</em></h1>
      <p>Shape a habitat. Follow the stories.</p>
      <span class="brand-status" role="status" aria-live="polite"><i aria-hidden="true"></i><span data-status>LIVE</span><span aria-hidden="true"> · </span><span data-phase>DAWN</span><span aria-hidden="true"> · </span><span data-provider>LOCAL MODEL</span></span>
      <div class="save-row" role="group" aria-label="Save controls">
        <button type="button" data-action="save" title="Save the Commons">SAVE</button>
        <button type="button" data-action="load" title="Load the last save">LOAD</button>
        <button type="button" data-action="export" title="Download this world as a file">EXPORT</button>
        <button type="button" data-action="import" title="Load a world from a file">IMPORT</button>
        <button type="button" data-action="reset" title="Start a new Commons">NEW</button>
        <button type="button" data-action="shortcuts" title="Keyboard shortcuts (?)" aria-haspopup="dialog">?</button>
        <input type="file" accept="application/json,.json" data-import-input hidden aria-label="Import a saved world" />
      </div>
      <p class="settlement-status" data-settlement-status role="status" aria-live="polite" hidden></p>
    </section>

    <section class="resource-strip panel" aria-label="Settlement resources">
      <div class="day-card"><span data-day>DAY 08</span><small data-season>MOSSWAKE 1/7</small><strong class="day-summary" data-settlement-summary>36/42 HOUSED · HARMONY 72%</strong><small data-water-quality>WATER 70% · WILD 100%</small><small data-births></small></div>
      ${resourceMarkup}
    </section>

    <section class="field-panel panel" aria-labelledby="field-heading">
      <div class="panel-eyebrow"><span id="field-heading">FIELDWORK</span><span data-item-summary>0 FOUND</span></div>
      <div class="field-tabs" role="tablist" aria-label="Ledger tools">
        <button class="field-tab is-active" type="button" data-field-tab="field" role="tab" aria-selected="true">FIELDWORK</button>
        <button class="field-tab" type="button" data-field-tab="civic" role="tab" aria-selected="false" hidden>CIVIC TOOLS</button>
      </div>
      <div class="field-view" data-field-view="field">
        <div class="item-grid" aria-label="Found materials">${itemMarkup}</div>
        <div class="field-section petition-section">
          <div class="commons-report" data-diagnosis data-tone="good">
            <div class="objective-heading"><span>COMMONS REPORT</span><span data-diagnosis-need>FOOD 100</span></div>
            <p data-diagnosis-cause></p>
            <p class="report-advice" data-diagnosis-advice></p>
          </div>

          <div class="objective-heading"><span>PETITIONS</span><span>FROM THE MOTES</span></div>
          <div data-petitions></div>
        </div>
        <div class="objective-heading objective-heading--panel"><span>OBJECTIVES</span><span data-objective-count>CH.1 · 0/5 DONE</span></div>
        <div class="objective-list" data-objectives aria-label="Fieldwork objectives"></div>
        <div class="field-section expedition-section" hidden>
          <div class="objective-heading"><span>EXPEDITION</span><span data-expedition-status>READY TO DISPATCH</span></div>
          <button class="dispatch-button" type="button" data-action="dispatch-expedition">DISPATCH SCOUT</button>
        </div>
      </div>
      <div class="field-view" data-field-view="civic" hidden>
        <div class="field-section district-section" hidden>
          <div class="objective-heading"><span>DISTRICT FOCUS</span><strong data-district-focus>Commons Market</strong></div>
          <div class="district-grid" role="group" aria-label="District focus">${districtMarkup}</div>
        </div>
        <div class="field-section traditions-section">
          <div class="objective-heading"><span>TRADITIONS</span><span>KEPT FOR GOOD</span></div>
          <div class="tradition-list" data-traditions></div>
        </div>
        <div class="field-section crafting-section">
          <div class="objective-heading"><span>CRAFTING</span><span data-crafting-status>WORKSHOP IDLE</span></div>
          <div class="craft-grid" role="group" aria-label="Workshop recipes">${recipeMarkup}</div>
        </div>
      </div>
    </section>

    <aside class="right-stack" aria-label="Settlement outlook and resident inspector">
      <section class="forecast-card panel" aria-labelledby="forecast-heading">
        <div class="panel-eyebrow"><span>FORECAST</span><span data-forecast-window>next 2 days</span></div>
        <h2 id="forecast-heading" data-forecast-title>Lantern Festival</h2>
        <div class="forecast-probability"><strong data-forecast-probability>65% likely</strong><span class="forecast-meter" data-forecast-meter role="progressbar" aria-label="Forecast probability" aria-valuemin="0" aria-valuemax="100" aria-valuenow="65"><i data-forecast-fill></i></span></div>
        <ul class="driver-list" data-forecast-drivers aria-label="Forecast drivers"></ul>
        <p class="recommendation" data-forecast-recommendation></p>
        <p class="crisis-banner" data-crisis hidden></p>
        <div class="policy-row" data-policies></div>
        <div class="forecast-rewind" role="group" aria-label="Forecast history">
          <button type="button" data-action="forecast-back">◂ THEN</button>
          <span data-forecast-cursor>1/1</span>
          <button type="button" data-action="forecast-forward">NOW ▸</button>
        </div>
        <ul class="forecast-lesson" data-forecast-lesson hidden></ul>
        <section class="council-card" data-council hidden>
          <div class="panel-eyebrow"><span>SPECIES COUNCIL</span><span data-council-deadline></span></div>
          <strong data-council-title></strong>
          <p data-council-body></p>
          <div class="council-votes" data-council-votes></div>
          <div class="council-actions">
            <button type="button" class="dispatch-button" data-action="approve-proposal">APPROVE</button>
            <button type="button" class="ghost-button" data-action="reject-proposal">REJECT</button>
          </div>
        </section>
        <div class="season-event" data-season-event data-tone="calm">
          <div class="panel-eyebrow"><span>SEASONAL EVENT</span><span data-season-event-days>7 DAYS LEFT</span></div>
          <strong data-season-event-title>Seedwake Gathering</strong>
          <p data-season-event-description>The basin is waking.</p>
        </div>
      </section>

      <section class="building-card panel" data-building-panel hidden aria-labelledby="building-heading">
        <div class="panel-eyebrow"><span>BUILDING</span><button type="button" class="mini-close" data-action="close-building" aria-label="Close building inspector">×</button></div>
        <h2 id="building-heading" data-building-name>Burrow Home</h2>
        <div class="building-meta"><span data-building-level>LEVEL 1/3</span><span data-building-output>OUTPUT 100%</span></div>
        <p class="building-description" data-building-description></p>
        <ul class="site-notes" data-building-site hidden aria-label="Site effects"></ul>
        <span class="upgrade-meter" data-building-upgrade-progress hidden><i></i></span>
        <button class="dispatch-button" type="button" data-action="upgrade-building">UPGRADE</button>
        <small class="upgrade-cost" data-building-upgrade-cost></small>
      </section>

      <section class="inspector-card panel" aria-labelledby="resident-heading">
        <div class="panel-eyebrow"><span>RESIDENT</span><span data-resident-goal>work</span></div>
        <div class="resident-heading"><img class="resident-portrait" data-resident-portrait alt="" width="44" height="44" /><span class="resident-glyph" data-resident-glyph aria-hidden="true">●</span><div><h2 id="resident-heading" data-resident-name>Loading</h2><p data-resident-species>Brambleback</p></div><span class="resident-stage" data-resident-stage>ADULT</span></div>
        <div class="need-list">
          ${["shelter", "food", "safety", "belonging"].map((need) => `<div class="need-row"><span>${need}</span><div class="need-meter" data-need-meter="${need}" role="progressbar" aria-label="${need} need fulfilled" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-need-fill="${need}"></i></div><b data-need-value="${need}">0</b></div>`).join("")}
        </div>
        <div class="relationship-panel" data-skills-panel hidden>
          <div class="panel-eyebrow"><span>SKILLS</span><span>GROWS WITH WORK</span></div>
          <div class="need-list need-list--skills" data-skills></div>
        </div>
        <div class="relationship-panel" data-bonds-panel hidden>
          <div class="panel-eyebrow"><span>SOCIAL CIRCLE</span><span>NEARBY BONDS</span></div>
          <ul class="relationship-list" data-relationships aria-label="Resident relationships"></ul>
        </div>
        <p class="want-note" data-resident-want hidden></p>
        <p class="decision-note" data-resident-explanation></p>
      </section>
    </aside>

    <section class="build-dock panel" aria-labelledby="build-heading">
      <div class="dock-heading"><span id="build-heading">BUILD</span><button type="button" data-action="clear-build" aria-label="Cancel building mode" aria-keyshortcuts="Escape">cancel <kbd>Esc</kbd></button></div>
      <p class="build-detail" data-build-detail aria-live="polite">Choose a tool. Costs are shown on every tile; press Escape to clear a selection.</p>
      <div class="build-grid" role="group" aria-label="Building choices">${pathButton}${buildMarkup}</div>
    </section>

    <section class="control-dock panel" aria-label="Simulation controls">
      <div class="control-row">
        <button class="control-button control-button--pause" type="button" data-action="pause" aria-pressed="false" aria-keyshortcuts="Space P" title="Pause simulation (Space or P)"><span class="control-icon" data-pause-icon aria-hidden="true">Ⅱ</span><span class="control-label" data-pause-label>PAUSE</span></button>
        <button class="zoom-button mute-button" type="button" data-action="mute" aria-pressed="false" aria-keyshortcuts="M" title="Mute audio (M)">♪</button>
      </div>
      <div class="speed-group" role="group" aria-label="Simulation speed"><button type="button" data-speed="1" class="is-active" aria-pressed="true" aria-keyshortcuts="1">1×</button><button type="button" data-speed="2" aria-pressed="false" aria-keyshortcuts="2">2×</button><button type="button" data-speed="4" aria-pressed="false" aria-keyshortcuts="4">4×</button></div>
      <div class="zoom-group" role="group" aria-label="Map zoom">
        <span class="zoom-label">VIEW</span>
        <button class="zoom-button" type="button" data-zoom="out" aria-label="Zoom map out" title="Zoom map out (minus)">−</button>
        <span class="zoom-value" data-zoom-value aria-live="polite">100%</span>
        <button class="zoom-button" type="button" data-zoom="in" aria-label="Zoom map in" title="Zoom map in (plus)">+</button>
        <button class="zoom-reset" type="button" data-zoom="reset" aria-label="Reset map zoom" title="Reset map zoom (0)">RESET</button>
      </div>
      <span class="control-hint">SPACE pause · 1/2/4 speed · −/+ zoom · M mute</span>
    </section>

    <section class="message-log panel" aria-labelledby="ledger-heading">
      <div class="panel-eyebrow"><span id="ledger-heading">LEDGER NOTES</span><button type="button" class="ledger-open" data-action="toggle-ledger" aria-label="Open the full ledger"><span data-message-count>0 LOGGED</span> ▸</button></div>
      <div class="latest-feedback" data-feedback-panel role="status" aria-live="polite" aria-atomic="true"><span class="feedback-kicker">LATEST</span><p data-feedback>No new notes from the Commons.</p></div>
      <ul data-messages aria-label="Previous ledger notes"></ul>
    </section>

    <div class="overlay ledger-overlay" data-ledger-overlay hidden role="dialog" aria-modal="true" aria-label="Full settlement ledger">
      <div class="overlay-card">
        <div class="panel-eyebrow"><span>SETTLEMENT LEDGER</span><span data-ledger-count>0 ENTRIES</span></div>
        <div class="ledger-filters" role="group" aria-label="Filter ledger entries">
          <button type="button" data-ledger-filter="all" class="is-active" aria-pressed="true">ALL</button>
          <button type="button" data-ledger-filter="good" aria-pressed="false">GOOD</button>
          <button type="button" data-ledger-filter="warning" aria-pressed="false">WARNINGS</button>
          <button type="button" data-ledger-filter="info" aria-pressed="false">NOTES</button>
        </div>
        <ul class="ledger-list" data-ledger-list></ul>
        <button class="dispatch-button" type="button" data-action="close-ledger">CLOSE</button>
      </div>
    </div>

    <div class="overlay title-overlay" data-title-overlay data-overlay-action="dismiss-title" role="dialog" aria-modal="true" aria-labelledby="title-heading">
      <div class="overlay-card overlay-card--title">
        <div class="panel-eyebrow"><span>A BROKEN SURVEY MAP</span><span>THE LAST HEALTHY ROOT</span></div>
        <h2 id="title-heading">Mosslight Commons</h2>
        <p>The canopy is dying. You are the first Steward. Shape a habitat. Let the motes decide what the city becomes.</p>
        <button class="dispatch-button" type="button" data-action="dismiss-title">TAKE UP THE LEDGER</button>
        <small class="overlay-hint">Click anywhere · Enter · Esc</small>
      </div>
    </div>

    <aside class="coach" data-onboarding hidden role="dialog" aria-labelledby="onboarding-title">
      <div class="panel-eyebrow"><span>FIRST SEASON</span><span data-onboarding-progress>1 / 5</span></div>
      <h2 id="onboarding-title" data-onboarding-title></h2>
      <p data-onboarding-body></p>
      <p class="onboarding-hint" data-onboarding-hint></p>
      <div class="onboarding-actions">
        <button type="button" class="ghost-button" data-action="onboarding-skip">SKIP</button>
        <button class="dispatch-button" type="button" data-action="onboarding-next">NEXT</button>
      </div>
    </aside>

    <div class="overlay shortcuts-overlay" data-shortcuts-overlay hidden role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <div class="overlay-card">
        <div class="panel-eyebrow"><span id="shortcuts-title">KEYBOARD</span><button type="button" class="mini-close" data-action="shortcuts-close" aria-label="Close shortcuts">×</button></div>
        <div class="shortcut-groups" data-shortcut-groups></div>
      </div>
    </div>

    <div class="overlay collapse-overlay" data-collapse-overlay hidden role="dialog" aria-modal="true" aria-labelledby="collapse-title">
      <div class="overlay-card overlay-card--narrow">
        <h2 id="collapse-title">The Commons has gone quiet</h2>
        <p data-collapse-summary></p>
        <div class="onboarding-actions">
          <button type="button" class="ghost-button" data-action="load">LOAD LAST SAVE</button>
          <button class="dispatch-button" type="button" data-action="reset">BEGIN AGAIN</button>
        </div>
      </div>
    </div>`;
  }
}
