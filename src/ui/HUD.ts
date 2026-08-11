import {
  BUILDING_DEFINITIONS,
  DISTRICT_DEFINITIONS,
  ITEM_DEFINITIONS,
  RECIPE_DEFINITIONS,
  RESOURCE_DEFINITIONS,
  SPECIES_DEFINITIONS,
} from "../data/definitions";
import { MosslightSimulation } from "../sim/simulation";
import type { BuildingType, DistrictType, ItemKey, RecipeKey, ResourceKey } from "../sim/types";

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

type BuildChoice = Exclude<BuildingType, "root-heart">;
type MissingCost =
  | { resource: ResourceKey; amount: number }
  | { item: ItemKey; amount: number };

const formatResourceName = (resource: ResourceKey): string => RESOURCE_DEFINITIONS[resource].label.toUpperCase();

export class HUD {
  private readonly root: HTMLElement;
  private readonly simulation: MosslightSimulation;
  private readonly onChange: () => void;
  private activeFieldTab: "field" | "civic" = "field";

  constructor(root: HTMLElement, simulation: MosslightSimulation, onChange: () => void) {
    this.root = root;
    this.simulation = simulation;
    this.onChange = onChange;
    this.root.innerHTML = this.template();
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("keydown", (event) => this.handleKeydown(event));
    this.root.addEventListener("focusin", (event) => this.handleFocus(event));
    this.root.addEventListener("pointerover", (event) => this.handlePointerover(event));
    this.render();
  }

  public render(): void {
    const state = this.simulation.state;
    this.setText("[data-day]", `DAY ${String(state.day).padStart(2, "0")}`);
    this.setText("[data-season]", `${state.season.toUpperCase()} ${state.seasonDay}/7`);
    this.setText("[data-settlement-summary]", `${state.metrics.population}/${state.metrics.housingCapacity} HOUSED · HARMONY ${Math.round(state.metrics.harmony)}%`);
    this.setText("[data-phase]", state.phase.toUpperCase());
    this.setText("[data-status]", state.paused ? "PAUSED" : "LIVE");
    this.setText("[data-provider]", state.forecastSource === "torx-thrml" ? "TORX+THRML" : "LOCAL MODEL");
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
      this.setText(`[data-resource-value="${resource}"]`, String(value));
      const fill = this.root.querySelector<HTMLElement>(`[data-resource-fill="${resource}"]`);
      if (fill) fill.style.width = `${value}%`;
      const meter = this.root.querySelector<HTMLElement>(`[data-resource-meter="${resource}"]`);
      if (meter) {
        meter.setAttribute("aria-valuenow", String(value));
        meter.setAttribute("aria-valuetext", `${value} percent ${RESOURCE_DEFINITIONS[resource].label.toLowerCase()} in stores`);
      }
    }

    const itemTotal = itemOrder.reduce((sum, item) => sum + state.items[item], 0);
    this.setText("[data-item-summary]", `${itemTotal} FOUND`);
    for (const item of itemOrder) {
      this.setText(`[data-item-value="${item}"]`, String(state.items[item]));
    }
    const objectiveList = this.root.querySelector<HTMLElement>("[data-objectives]");
    if (objectiveList) {
      objectiveList.replaceChildren(...state.objectives.map((objective) => {
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
      `${state.objectives.filter((objective) => objective.completed).length}/${state.objectives.length} DONE`,
    );

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
    this.root.querySelectorAll<HTMLButtonElement>("[data-district]").forEach((button) => {
      const district = button.dataset.district as DistrictType;
      const active = district === state.districtFocus;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.title = `${DISTRICT_DEFINITIONS[district].label}: ${DISTRICT_DEFINITIONS[district].bonus}`;
    });
    this.setText("[data-district-focus]", DISTRICT_DEFINITIONS[state.districtFocus].label);

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

    const resident = this.simulation.getSelectedResident();
    if (resident) {
      const species = SPECIES_DEFINITIONS[resident.species];
      this.setText("[data-resident-name]", resident.name);
      this.setText("[data-resident-species]", `${species.label} · ${species.role}`);
      this.setText("[data-resident-goal]", resident.goal);
      this.setText("[data-resident-explanation]", resident.lastDecisionExplanation);
      this.setText("[data-resident-glyph]", resident.species === "glowtail" ? "✧" : resident.species === "mireling" ? "◌" : "●");
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

    const messageList = this.root.querySelector<HTMLElement>("[data-messages]");
    const latestMessage = state.messages[0];
    const feedback = this.root.querySelector<HTMLElement>("[data-feedback]");
    const feedbackPanel = this.root.querySelector<HTMLElement>("[data-feedback-panel]");
    if (feedbackPanel) feedbackPanel.className = `latest-feedback${latestMessage ? ` message--${latestMessage.tone}` : ""}`;
    if (feedback) feedback.textContent = latestMessage?.text ?? "No new notes from the Commons.";
    this.setText("[data-message-count]", `${Math.min(state.messages.length, 3)} RECENT`);
    if (messageList) {
      messageList.replaceChildren(...state.messages.slice(1, 3).map((message) => {
        const item = document.createElement("li");
        item.className = `message message--${message.tone}`;
        item.textContent = message.text;
        return item;
      }));
    }

    this.root.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => {
      const build = button.dataset.build as BuildChoice;
      const definition = BUILDING_DEFINITIONS[build];
      const missing: MissingCost[] = [...this.getMissingResources(build), ...this.getMissingItems(build)];
      const affordable = missing.length === 0;
      const active = build === state.buildMode;
      const status = affordable ? "READY" : `NEEDS ${this.formatMissingCosts(missing)}`;

      button.classList.toggle("is-active", active);
      button.classList.toggle("is-unavailable", !affordable);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-label", definition.label);
      button.setAttribute("aria-describedby", `build-${build}-description build-${build}-cost build-${build}-status`);
      this.setText(`[data-build-cost="${build}"]`, `COST · ${this.formatCost(definition)}`);
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
    this.updateBuildDetail();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const fieldTab = target.closest<HTMLButtonElement>("[data-field-tab]");
    if (fieldTab?.dataset.fieldTab === "field" || fieldTab?.dataset.fieldTab === "civic") {
      this.activeFieldTab = fieldTab.dataset.fieldTab;
      this.render();
      return;
    }
    const buildButton = target.closest<HTMLButtonElement>("[data-build]");
    if (buildButton) {
      const build = buildButton.dataset.build as BuildChoice;
      this.simulation.setBuildMode(this.simulation.state.buildMode === build ? null : build);
      this.render();
      this.onChange();
      return;
    }

    const districtButton = target.closest<HTMLButtonElement>("[data-district]");
    if (districtButton?.dataset.district) {
      this.simulation.setDistrictFocus(districtButton.dataset.district as DistrictType);
      this.render();
      this.onChange();
      return;
    }

    const craftButton = target.closest<HTMLButtonElement>("[data-craft]");
    if (craftButton?.dataset.craft) {
      this.simulation.startCraft(craftButton.dataset.craft as RecipeKey);
      this.render();
      this.onChange();
      return;
    }

    const speedButton = target.closest<HTMLButtonElement>("[data-speed]");
    if (speedButton) {
      const speed = Number(speedButton.dataset.speed) as 1 | 2 | 4;
      this.simulation.setSpeed(speed);
      this.render();
      return;
    }

    const actionButton = target.closest<HTMLButtonElement>("[data-action]");
    if (actionButton?.dataset.action === "pause") {
      this.simulation.togglePause();
      this.render();
      return;
    }

    if (actionButton?.dataset.action === "clear-build") {
      this.simulation.setBuildMode(null);
      this.render();
      this.onChange();
      return;
    }

    if (actionButton?.dataset.action === "dispatch-expedition") {
      this.simulation.dispatchExpedition();
      this.render();
      this.onChange();
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLButtonElement)) return;
    if (event.key === " " || event.key === "Enter") {
      // Keep native button activation from also triggering main.ts's global pause shortcut.
      event.stopPropagation();
    }
  }

  private handleFocus(event: FocusEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-build]");
    if (button?.dataset.build) this.updateBuildDetail(button.dataset.build as BuildChoice);
  }

  private handlePointerover(event: PointerEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-build]");
    if (button?.dataset.build) this.updateBuildDetail(button.dataset.build as BuildChoice);
  }

  private getMissingResources(build: BuildChoice): Array<{ resource: ResourceKey; amount: number }> {
    const definition = BUILDING_DEFINITIONS[build];
    return resourceOrder.flatMap((resource) => {
      const cost = definition.cost[resource] ?? 0;
      const available = this.simulation.state.resources[resource];
      return available < cost ? [{ resource, amount: Math.max(1, Math.ceil(cost - available)) }] : [];
    });
  }

  private getMissingItems(build: BuildChoice): Array<{ item: ItemKey; amount: number }> {
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

  private formatMissingCosts(missing: MissingCost[]): string {
    return missing
      .map((cost) => "resource" in cost
        ? `${cost.amount} ${formatResourceName(cost.resource)}`
        : `${cost.amount} ${ITEM_DEFINITIONS[cost.item].label.toUpperCase()}`)
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
      return `<div class="resource-chip" style="--resource-color: ${definition.color}">
        <span class="resource-icon" aria-hidden="true">${definition.icon}</span>
        <div class="resource-copy"><span>${definition.label}</span><strong data-resource-value="${resource}">0</strong></div>
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
    </section>

    <section class="resource-strip panel" aria-label="Settlement resources">
      <div class="day-card"><span data-day>DAY 08</span><small data-season>MOSSWAKE 1/7</small><strong class="day-summary" data-settlement-summary>36/42 HOUSED · HARMONY 72%</strong></div>
      ${resourceMarkup}
    </section>

    <section class="field-panel panel" aria-labelledby="field-heading">
      <div class="panel-eyebrow"><span id="field-heading">FIELDWORK</span><span data-item-summary>0 FOUND</span></div>
      <div class="field-tabs" role="tablist" aria-label="Ledger tools">
        <button class="field-tab is-active" type="button" data-field-tab="field" role="tab" aria-selected="true">FIELDWORK</button>
        <button class="field-tab" type="button" data-field-tab="civic" role="tab" aria-selected="false">CIVIC TOOLS</button>
      </div>
      <div class="field-view" data-field-view="field">
        <div class="item-grid" aria-label="Found materials">${itemMarkup}</div>
        <div class="objective-heading objective-heading--panel"><span>OBJECTIVES</span><span data-objective-count>0/5 DONE</span></div>
        <div class="objective-list" data-objectives aria-label="Fieldwork objectives"></div>
        <div class="field-section expedition-section">
          <div class="objective-heading"><span>EXPEDITION</span><span data-expedition-status>READY TO DISPATCH</span></div>
          <button class="dispatch-button" type="button" data-action="dispatch-expedition">DISPATCH SCOUT</button>
        </div>
      </div>
      <div class="field-view" data-field-view="civic" hidden>
        <div class="field-section district-section">
          <div class="objective-heading"><span>DISTRICT FOCUS</span><strong data-district-focus>Commons Market</strong></div>
          <div class="district-grid" role="group" aria-label="District focus">${districtMarkup}</div>
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
        <div class="season-event" data-season-event data-tone="calm">
          <div class="panel-eyebrow"><span>SEASONAL EVENT</span><span data-season-event-days>7 DAYS LEFT</span></div>
          <strong data-season-event-title>Seedwake Gathering</strong>
          <p data-season-event-description>The basin is waking.</p>
        </div>
      </section>

      <section class="inspector-card panel" aria-labelledby="resident-heading">
        <div class="panel-eyebrow"><span>RESIDENT</span><span data-resident-goal>work</span></div>
        <div class="resident-heading"><span class="resident-glyph" data-resident-glyph aria-hidden="true">●</span><div><h2 id="resident-heading" data-resident-name>Loading</h2><p data-resident-species>Brambleback</p></div></div>
        <div class="need-list">
          ${["shelter", "food", "safety", "belonging"].map((need) => `<div class="need-row"><span>${need}</span><div class="need-meter" data-need-meter="${need}" role="progressbar" aria-label="${need} need fulfilled" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-need-fill="${need}"></i></div><b data-need-value="${need}">0</b></div>`).join("")}
        </div>
        <div class="relationship-panel">
          <div class="panel-eyebrow"><span>SOCIAL CIRCLE</span><span>NEARBY BONDS</span></div>
          <ul class="relationship-list" data-relationships aria-label="Resident relationships"></ul>
        </div>
        <p class="decision-note" data-resident-explanation></p>
      </section>
    </aside>

    <section class="build-dock panel" aria-labelledby="build-heading">
      <div class="dock-heading"><span id="build-heading">BUILD</span><button type="button" data-action="clear-build" aria-label="Cancel building mode" aria-keyshortcuts="Escape">cancel <kbd>Esc</kbd></button></div>
      <p class="build-detail" data-build-detail aria-live="polite">Choose a tool. Costs are shown on every tile; press Escape to clear a selection.</p>
      <div class="build-grid" role="group" aria-label="Building choices">${buildMarkup}</div>
    </section>

    <section class="control-dock panel" aria-label="Simulation controls">
      <button class="control-button control-button--pause" type="button" data-action="pause" aria-pressed="false" aria-keyshortcuts="Space P" title="Pause simulation (Space or P)"><span class="control-icon" data-pause-icon aria-hidden="true">Ⅱ</span><span class="control-label" data-pause-label>PAUSE</span></button>
      <div class="speed-group" role="group" aria-label="Simulation speed"><button type="button" data-speed="1" class="is-active" aria-pressed="true" aria-keyshortcuts="1">1×</button><button type="button" data-speed="2" aria-pressed="false" aria-keyshortcuts="2">2×</button><button type="button" data-speed="4" aria-pressed="false" aria-keyshortcuts="4">4×</button></div>
      <span class="control-hint">SPACE pause · 1/2/4 speed</span>
    </section>

    <section class="message-log panel" aria-labelledby="ledger-heading"><div class="panel-eyebrow"><span id="ledger-heading">LEDGER NOTES</span><span data-message-count>1 RECENT</span></div><div class="latest-feedback" data-feedback-panel role="status" aria-live="polite" aria-atomic="true"><span class="feedback-kicker">LATEST</span><p data-feedback>No new notes from the Commons.</p></div><ul data-messages aria-label="Previous ledger notes"></ul></section>`;
  }
}
