# Mosslight Commons Progress

Original prompt: Keep improving the Mosslight Commons creature-city simulation using the available skills, plugins, and agents.

## Current baseline

- Phaser + TypeScript + Vite game shell is running.
- `MosslightSimulation` owns the saveable world state.
- `WorldScene` renders the grid and routes pointer input.
- `HUD` owns the DOM overlay.
- The optional Python bridge returns Torx+THRML forecasts and the browser falls back to the local model when it is unavailable.

## This pass

- [x] Improve simulation depth and player-facing feedback.
- [x] Improve HUD accessibility and responsive layout.
- [x] Improve world hover/selection/build readability.
- [x] Add a species portrait reference asset and document its runtime-readiness boundary.
- [x] Add deterministic browser inspection hooks.
- [x] Re-run build, bridge smoke, and browser QA.

## Verified results

- `npm run build` passes after the simulation, renderer, HUD, main-loop, and bridge changes.
- Torx+THRML `/health` returns JAX 0.11.0, Torx 0.0.1, and THRML 0.1.4.
- A direct bridge forecast returns `torx-thrml`, event probability, THRML resource risks, and Torx policy signals.
- Browser QA verified desktop boot, Torx+THRML forecast rendering, local fallback truthfulness, pause/resume, 1/2/4 speed controls, Escape cancel, farm placement, invalid-water preview, deterministic time stepping, and resident arrivals.
- Desktop and narrow viewport screenshots were visually inspected. The narrow layout keeps all HUD surfaces within a scrollable panel stack.
- No console errors or failed `/forecast` requests were present in the clean final browser session.

## Remaining notes

- Vite reports the expected Phaser bundle-size warning (>500kB). Code splitting or a Phaser chunk budget can be addressed when the game grows beyond the prototype.
- Generated portrait art is reference-only until its baked checkerboard is removed and each portrait is normalized to a real alpha channel and UI anchor.

## Fieldwork pass

- [x] Add four gatherable map blocks: Fern Patch, Ember Mushroom, Moon Crystal, and Root Ruin.
- [x] Add four found items and a Fieldwork inventory panel.
- [x] Add three objective cards that progress from collection into construction.
- [x] Add the item-gated Root Workshop with ongoing resin conversion into warmth/light.
- [x] Add procedural runtime marks plus `assets/generated/mosslight-gathering-board.png` as art-direction reference.
- [x] Verify collection, objective completion, workshop placement, desktop layout, mobile layout, and console cleanliness in the live browser.

## Fieldwork verification

- `npm run build` passes after the fieldwork simulation, HUD, renderer, and snapshot changes.
- Live browser state confirmed Ember Mushroom → Amber Resin, three-node survey completion, workshop affordability, and Root Workshop objective completion.
- Desktop and 390px mobile screenshots were visually inspected. The Fieldwork panel remains readable and the mobile HUD stays scrollable.
- Playwright console check returned zero errors and zero warnings in the clean fieldwork session.

## Civic expansion pass

- [x] Add timed resident expeditions and a Sunken Reach fog-of-war reveal.
- [x] Add Root Bridge crafting to unlock the Old Hollow.
- [x] Add five district focuses with visible production, harmony, light, and expedition effects.
- [x] Add lightweight resident relationships and Social Circle inspector feedback.
- [x] Add named seasonal events with rotation and forecast presentation.
- [x] Add Glow Kit, Root Bridge, and Comfort Bundle workshop recipes.
- [x] Add `assets/generated/mosslight-civic-expansion-board.png` as a reference board and copy it to the public asset set.
- [x] Update the game bible, asset bible, and technical plan with the new state and player loop.

## Civic expansion verification

- The live browser completed the deterministic chain: gather five nodes, build Root Workshop, dispatch a Sunken Reach expedition, craft a Root Bridge, reveal Old Hollow, switch district focus, and advance into a new season.
- `window.render_game_to_text()` confirmed inventory, objective completion, expedition progress, revealed zones, crafting state, district focus, seasonal rotation, and relationship growth.
- Desktop and 390px mobile layouts were visually inspected. The mobile HUD remained within the viewport with no horizontal overflow.
- Browser console verification returned zero errors and zero warnings in the final clean session.

## HUD, UI, and runtime asset polish pass

- [x] Reserve a centered playfield stage so persistent HUD panels no longer cover the desktop map.
- [x] Remove Phaser/CSS double-centering and split mobile into a map row plus a scrollable HUD row.
- [x] Replace the oversized fieldwork scroll trap with Fieldwork/Civic tabs.
- [x] Compact the right inspector so forecast, resident needs, social circle, and decision note remain in one bounded rail.
- [x] Generate and normalize transparent building, resident, and gathering-node runtime sprites.
- [x] Wire runtime sprites into Phaser with vector fallback and smooth painterly filtering.
- [x] Remove baked reference-board UI texture from live panels and close the debug grid gaps between map tiles.

## HUD and asset verification

- Desktop browser bounds at 1200×720: canvas stays inside the reserved center stage; left/right rails and bottom docks do not intersect the map.
- Mobile browser bounds at 390×844: canvas occupies the top row, HUD begins below it, canvas hit-testing reaches `CANVAS`, bottom controls are reachable after HUD scroll, and horizontal overflow is false.
- Full deterministic gameplay chain still passes after the scene-scale change: gather five nodes, build Root Workshop, dispatch expedition, craft Root Bridge, reveal both zones, and complete all related objectives.
- Browser network audit returned HTTP 200 for all six building/resident texture families and four node sprites.
- Torx/THRML bridge restarted successfully; `/health` returns JAX 0.11.0, Torx 0.0.1, and THRML 0.1.4.

## Handoff notes

- Keep simulation rules outside Phaser scenes.
- Keep text-heavy interface elements in the DOM.
- Preserve the Mosslight palette: ink, deep moss, teal, paper, gold, and warning coral.
- Do not discard unrelated untracked Torx/THRML work in the parent repository.
