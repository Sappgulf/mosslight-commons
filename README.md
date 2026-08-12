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

## Tests

```bash
npm test
```

`npm run build` type-checks, runs the test suite, and then builds. The suite covers
simulation determinism, long-run invariants, gathering and regrowth, building and
upgrades, expeditions and crafting, objectives and chapters, the fail state,
save serialization, and A* pathfinding.

## Browser QA hooks

The running page exposes two deterministic inspection hooks:

- `window.render_game_to_text()` returns the current day, phase, resources, buildings, selected resident, forecast, build mode, and zoom level as JSON.
- `window.advanceTime(milliseconds)` advances fixed 520ms simulation ticks and refreshes the scene and HUD.

Keyboard shortcuts: Space/P pauses, 1/2/4 changes speed, +/- zooms the map, 0 resets zoom, Escape cancels build mode, M mutes audio, Ctrl/Cmd+S saves, and F toggles fullscreen.

## Saves

The world autosaves to `localStorage` every 20 seconds and on page hide, and resumes
on load. The brand panel exposes SAVE, LOAD, EXPORT, IMPORT, and NEW; EXPORT writes a
JSON file that IMPORT reads back.
