# Mosslight Commons — Technical Plan

## Stack

- Phaser for 2D rendering, camera, sprites, tilemap presentation, and scene orchestration
- TypeScript for game and UI code
- Vite for the browser build and dev server
- DOM/CSS for the HUD, inspector, forecast, and menus
- Python/JAX for the simulation service
- THRML for probabilistic graphical models and structured sampling
- Torx for parameterized stochastic circuits and differentiable behavior policies

## Boundary rules

### Simulation owns

- map tiles and buildable cells
- residents, species, traits, needs, and relationships
- resources and production
- gatherable map nodes, found-item inventory, and objective progress
- fog-of-war reveal state, expeditions, district focus, and civic unlocks
- resident relationships and relationship-driven harmony modifiers
- seasonal event rotation and active event effects
- Root Workshop crafting queues and recipe completion
- time, day/night, and event state
- seeded randomness and replay state
- explanations for decisions
- serializable save data

### Phaser owns

- camera and world presentation
- sprite placement, asset loading, and animation
- particles and effects
- tile highlighting
- translating pointer/keyboard input into simulation actions
- showing gather/build affordances while keeping collection rules in `MosslightSimulation`

### DOM UI owns

- resource strip
- forecast panel
- resident inspector
- build menu
- speed and pause controls
- accessibility-readable text and tooltips

## Project shape

```text
creaturecity/
  assets/
  docs/
  public/
  sim/
    mosslight_sim.py
    requirements.txt
  src/
    data/
    render/
    sim/
    ui/
    styles/
    main.ts
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

## Simulation phases

### Phase 1 — local deterministic slice

Implement the game loop with a seeded, explainable simulation in TypeScript. This lets us prove the UI and player verbs before network/service complexity exists.

### Phase 2 — Python bridge

Expose a small local API or command bridge that accepts a serialized state and returns a forecast/result. The browser should not know whether the response came from a local heuristic or JAX-backed sampling.

### Phase 3 — THRML integration

Use a factor graph for resource pressure, resident needs, and event likelihood. Return a small set of sampled futures plus a confidence/uncertainty summary.

### Phase 4 — Torx integration

Use parameterized stochastic policies for resident action selection and city-style tuning. The first Torx-backed behavior should be narrow and visible, such as Glowtail market-route selection.

### Phase 5 — player-facing iteration

Keep the browser experience verifiable without the Python process. The page exposes `window.render_game_to_text()` for concise state assertions and `window.advanceTime(milliseconds)` for fixed-tick replay checks. If the forecast bridge times out or disappears, the HUD returns to `LOCAL MODEL` while preserving the last valid forecast text.

## First simulation model

Each resident has:

```text
species
position
home
workplace
needs: shelter, food, safety, belonging
traits: curiosity, sociability, routine, resilience
currentGoal
lastDecisionExplanation
```

The fieldwork state is also serializable:

```text
items: seed-pod, resin, moonwater, map-fragment
objectives: collect/build target, progress, completion, reward
collectAt(position): consume a gatherable tile and grant its reward
```

The civic expansion state is serializable alongside fieldwork:

```text
revealed: boolean grid plus revealedAreas
districtFocus: meadow, wetland, lantern, market, or ruin
expeditions: leader, target zone, progress, reward, status
relationships: resident pairs, kind, strength, shared days
seasonalEvent: season, title, effect, days remaining
crafting: one queued recipe with progress and duration
crafted: completed recipe counts
```

Each forecast returns:

```text
event
probability
window
drivers[]
affectedSpecies[]
recommendedActions[]
```

## Save/debug strategy

- Save only JSON-serializable simulation state.
- Persist a seed and event history so a run can be replayed.
- Add a debug drawer with current tick, seed, sampled outcomes, and decision explanations.
- Keep a deterministic fallback policy so the game remains playable if the Python service is unavailable.

## Verification plan

- Unit-test resource production and need updates.
- Test that resident choices are seeded and replayable.
- Test that every generated neighborhood has valid paths between homes and services.
- Smoke-test Torx and THRML from the existing parent virtual environment.
- Browser-test pause, speed, build, inspector, and forecast interactions.
- Browser-test node collection, item-gated workshop placement, and objective completion.
- Browser-test expedition dispatch, fog-of-war reveal, district focus, relationship display, seasonal rotation, and recipe completion.
- Browser-test that runtime building, resident, and gathering-node assets load with HTTP 200 responses and that the canvas stays inside its reserved stage.
- Browser-test the same interactions at desktop and narrow viewport sizes, including keyboard pause/speed/cancel/fullscreen shortcuts.
- Playtest whether a new player can explain one resident decision after five minutes.
