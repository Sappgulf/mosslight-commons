# Mosslight Commons

Mosslight Commons is a living city-builder about shaping a habitat for small, strange creatures and then watching their society adapt.

The project pairs a Phaser/TypeScript browser game with a Python simulation layer backed by Extropic's Torx and THRML libraries. The renderer presents the world; the simulation owns the world state.

## Project documents

- [Game Bible](docs/game-bible.md) — story, fantasy, systems, creatures, buildings, progression, and MVP scope.
- [Asset Bible](docs/asset-bible.md) — art direction, generated asset list, naming rules, and production checklist.
- [Technical Plan](docs/tech-plan.md) — Phaser architecture, simulation boundary, Torx/THRML integration, and verification plan.

## Current direction

- Genre: 2D top-down creature colony / city builder
- Tone: warm, curious, lightly weird, with readable systemic consequences
- First vertical slice: one 32×24 neighborhood, three species, four buildings, resource pressure, and an event forecast
- Browser stack: Phaser, TypeScript, Vite, DOM HUD
- Simulation stack: Python, JAX, THRML, Torx

The upstream Torx checkout remains at the parent workspace root. This folder is the fresh game project that will consume it.

## Run the prototype

In one terminal:

```bash
cd mosslight-commons
npm install
npm run dev
```

The optional Torx/THRML sidecar is only for localhost research. On Vercel the HUD stays on `LOCAL MODEL`. To run the sidecar locally:

```bash
python sim/mosslight_sim.py
```

The browser prototype works without the second process by using its deterministic local forecast. When the bridge is running, the HUD changes to `TORX+THRML`. The bridge is only polled when the page is served from localhost, or when `VITE_TORX_ENDPOINT` is set.

## Architecture

Three layers, kept apart on purpose:

- `src/sim/` owns the world. It has no Phaser and no DOM, which is why it is the
  part that can be tested exhaustively. `MosslightSimulation` holds the state and
  runs a named, ordered pipeline of tick stages (`getPipelineOrder()` exposes the
  order, and a test pins it). Self-contained stages live in `src/sim/systems/` as
  plain functions over a narrow `SimContext` rather than methods on the class.
- `src/render/` draws the world with Phaser. It is retained-mode: entities are
  pooled and redrawn only when their inputs change.
- `src/ui/` owns the DOM HUD, plus `keymap.ts`, the single owner of keyboard
  input — one listener, with modal layers taking precedence over game bindings.

## Tests

```bash
npm test          # unit and simulation tests
npm run test:e2e  # Playwright, boots the real game
npm run lint      # oxlint
```

`npm run build` lints, type-checks, runs the test suite, and then builds.

The unit suite covers simulation determinism (including a recorded golden
snapshot), save/load round-trip fidelity, long-run invariants, gathering and
regrowth, building and upgrades, expeditions and crafting, objectives and
chapters, the fail and collapse states, tick ordering, A* pathfinding, and the
keyboard router. The end-to-end suite boots the real game and covers the loading
splash, console cleanliness, asset payload size, every keyboard binding, session
resume across a reload, and the mobile layout and touch build flow.

## Art pipeline

Full-resolution originals live in `assets/source/` and are never shipped. The
runtime set in `public/assets/` is generated from them:

```bash
npm run assets
```

Each family is resampled to twice its real on-screen size and encoded as WebP,
which takes the shipped art from 7.9MB to about 185KB. Requires `cwebp`
(`brew install webp`). Reference boards in `assets/generated/` are art direction
only and are deliberately untracked.

## Browser QA hooks

The running page exposes two deterministic inspection hooks:

- `window.render_game_to_text()` returns the current day, phase, resources, buildings, selected resident, forecast, build mode, and zoom level as JSON.
- `window.advanceTime(milliseconds)` advances fixed 900ms simulation ticks and refreshes the scene and HUD.

Keyboard shortcuts: Space/P pauses, 1/2/4 changes speed, +/- zooms the map, 0 resets zoom, Escape cancels build mode, M mutes audio, Ctrl/Cmd+S saves, F toggles fullscreen, and `?` opens the shortcuts card. The card is generated from the binding list itself, so it cannot drift out of date.

## Touch

On touch there is no hover, so placing a building is two-stage: the first tap on
a cell arms it and shows the same validity, cost, and adjacency preview a mouse
player gets, and a second tap on that cell commits. Pinch to zoom, drag to pan.

## Saves

The world autosaves to `localStorage` every 20 seconds and on page hide, and resumes
on load. The brand panel exposes SAVE, LOAD, EXPORT, IMPORT, and NEW; EXPORT writes a
JSON file that IMPORT reads back.
