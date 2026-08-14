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
- [x] Add camera-aware stepped map zoom from 80% to 130% with HUD controls, keyboard shortcuts, and reset.

## HUD and asset verification

- Desktop browser bounds at 1200×720: canvas stays inside the reserved center stage; left/right rails and bottom docks do not intersect the map.
- Mobile browser bounds at 390×844: canvas occupies the top row, HUD begins below it, canvas hit-testing reaches `CANVAS`, bottom controls are reachable after HUD scroll, and horizontal overflow is false.
- Full deterministic gameplay chain still passes after the scene-scale change: gather five nodes, build Root Workshop, dispatch expedition, craft Root Bridge, reveal both zones, and complete all related objectives.
- Browser network audit returned HTTP 200 for all six building/resident texture families and four node sprites.
- Torx/THRML bridge restarted successfully; `/health` returns JAX 0.11.0, Torx 0.0.1, and THRML 0.1.4.
- Zoom QA verified 100% → 110% → 120% button changes, keyboard `+` and `0` reset synchronization, and a successful gather click at 110% zoom.

## Handoff notes

- Keep simulation rules outside Phaser scenes.
- Keep text-heavy interface elements in the DOM.
- Preserve the Mosslight palette: ink, deep moss, teal, paper, gold, and warning coral.
- Do not discard unrelated untracked Torx/THRML work in the parent repository.

## Systems overhaul pass

Addressed the fourteen findings from the codebase audit.

### Foundation

- [x] Replace the immediate-mode renderer with a retained-mode one. Terrain, fog,
      districts, buildings, and residents are pooled per entity and redrawn only
      when their inputs change. A pointer move now touches one small hover layer
      instead of rebuilding ~800 tiles plus every sprite.
- [x] Move the simulation clock out of the Phaser scene into a fixed-step
      accumulator (`src/sim/clock.ts`) with tab-visibility handling, so a
      stalled frame or backgrounded tab cannot desynchronise the world.
- [x] Add save/load: versioned localStorage autosave, manual save/load, file
      export/import, and a "new Commons" reset.
- [x] Add Vitest with 41 deterministic simulation and pathfinding tests, wired
      into `npm run build`.
- [x] Cache settlement metrics behind a dirty flag; the tick loop recomputed
      them four times per tick.
- [x] Rework the Torx bridge: AbortController, exponential backoff, a trimmed
      request payload, and a hard stand-down on non-local hosts.
- [x] Upgrade Phaser 3 → 4, Vite 7 → 8, TypeScript 5 → 7, `@types/node` 22 → 26,
      and split Phaser into its own long-lived chunk.
- [x] Repo hygiene: screenshots moved under `docs/screenshots`, Playwright
      session artifacts and build output gitignored.

### Gameplay

- [x] A* pathfinding over the tile grid with per-tile movement costs. Residents
      no longer walk through water, stone, or buildings, and prefer roads.
- [x] Wild nodes regrow on a season-weighted timer instead of being consumed
      permanently.
- [x] Building levels 1–3 with a cost, a build time, larger art, and higher
      output; housing capacity scales with home level.
- [x] Resident lifecycle: ageing, life stages, skills that grow with work and
      feed production, and departure after sustained hardship.
- [x] Relationships drive behaviour — residents seek out friends, rivalries drag
      on output, and long friendships become family.
- [x] Settlement status (thriving/strained/failing/collapsed) with a real fail
      state and an end-of-run screen.
- [x] Full ledger with day-stamped scrollback and tone filtering, replacing the
      five-line cap.
- [x] Synthesised audio (phase-dependent ambient bed plus event cues) and a
      five-step first-run walkthrough.
- [x] Objectives split into three chapters that unlock in sequence.

### Verification

- `npm run build` runs `tsc --noEmit`, 41 Vitest tests, and `vite build`; all pass.
- Live browser checks confirmed: gather → item → regrowth queue → objective →
  ledger; a full L1→L2 upgrade raising housing capacity 42 → 52; expedition
  completion revealing the Sunken Reach; district focus; save → drift → load
  restoring the exact tick and resources; state surviving a page reload; and a
  fern regrowing on schedule.
- Full re-render measured at 1.38ms per tick.
- Desktop (1280×720) and mobile (375×812) layouts inspected; no horizontal
  overflow, and the right rail scrolls with the building inspector open.
- Console is clean apart from the optional sidecar, which is now disabled off
  localhost.

### Bugs found and fixed during this pass

- Metrics cache was never invalidated by per-tick resource changes, so
  `resourceSecurity` went stale. Caught by a test.
- `setScale` on building art discarded `setDisplaySize`, rendering sprites at
  native texture size.
- A CSS `display: grid` rule silently defeated the `hidden` attribute on the
  building inspector.
- `Scene.events` was accessed before the scene had booted inside a Game.

## P0–P5 overhaul pass

Addressed the six priorities from the codebase audit.

### P0 · Asset pipeline

- [x] Removed the duplicated art tree. `assets/runtime/` and
      `public/assets/runtime/` held byte-identical copies of every sprite;
      originals now live in `assets/source/` and the shipped set is generated.
- [x] Added `scripts/optimize-assets.sh` (`npm run assets`). Each family is
      resampled to 2× its real draw size and encoded as WebP. Buildings were
      ~350px textures drawn at 40px; portraits were 844KB drawn at 44px.
- [x] Shipped art dropped from **7.9MB to 185KB (-98%)**, and the ~16MB of
      art-direction reference boards are untracked.

### P1 · Keyboard

- [x] Fixed a real bug: the HUD listened on both `#hud` and `window`, so keys
      pressed inside the HUD ran its handler twice and the first-run coach
      advanced two cards per Enter.
- [x] Added `src/ui/keymap.ts` — one listener, one precedence chain, bindings
      declared as data with modal layers ranked above game bindings.
- [x] Added a shortcuts card (`?`) generated from the binding list.

### P2 · Simulation decomposition

- [x] Extracted `src/sim/systems/` (`context`, `production`, `progression`)
      as plain functions over a narrow `SimContext`.
- [x] Replaced the 30-statement tick body with a named, ordered pipeline;
      `getPipelineOrder()` exposes it and tests pin the ordering constraints.
- [x] This is a first pass, not a finished decomposition: `simulation.ts` is
      down from 2,405 to ~2,290 lines and residents, relationships, wants,
      civics, and crisis remain on the class.

### P3 · Lint and test coverage

- [x] Added oxlint (typescript-eslint does not yet support TypeScript 7) and
      Prettier; lint runs in `npm run build` and in CI.
- [x] Unit tests 63 → 100: determinism with a golden snapshot, save/load
      round-trip and continued-evolution fidelity, corrupt-save rejection,
      collapse and departure behaviour, tick ordering, and the keyboard router.
- [x] End-to-end tests 1 → 12: boot splash teardown, console cleanliness,
      asset payload budget, every keybinding, reload resume, mobile layout,
      and the touch build flow.

### P4 · Boot experience

- [x] Added an inline boot splash with real Phaser load progress, so the first
      paint is not an unexplained dark rectangle.
- [x] Added a `<noscript>` message and a WebGL/canvas capability check that
      explains itself instead of leaving a permanently blank page.

### P5 · Touch

- [x] Two-stage build placement on touch: first tap arms and previews a cell,
      second tap commits. Previously a tap built immediately with no preview.
- [x] Added pinch-to-zoom; touch previously had no zoom outside the HUD buttons.
- [x] The build detail panel now fills in on tap, not only on hover/focus.

### Bugs found and fixed during this pass

- **Council proposals were not deterministic.** `nextProposalId` was a
  module-level counter shared by every simulation in the process, and
  `nextProposal` picks the proposal kind with `id % kinds.length`. Two runs
  from the same seed diverged into different politics and different
  populations. Now per-instance and serialized; `SAVE_VERSION` 4 → 5.
- **A cold boot threw and silently disabled the game.** `main.ts` renders the
  HUD once at start-up, the HUD reads the zoom level, and Phaser had not yet
  created the scene's camera. The throw happened at module scope, so
  everything below it — the simulation clock, the key bindings, and the debug
  hooks — never ran. Caught by the new end-to-end console check.

### Verification

- `npm run build` passes: oxlint clean, `tsc --noEmit` clean, 100 Vitest tests,
  and `vite build`.
- 12 Playwright tests pass against the real game, desktop and mobile.

## Pace and layout pass

### Gameplay pace

- [x] `TICK_MS` 520 → 900. A day was 6.2 seconds and a season 44; residents
      teleported between cells and the ledger scrolled past unread. A day is
      now about eleven seconds, and 2×/4× still exist for the old pace.

### Layout

- [x] Replaced the absolutely positioned HUD with a real grid shell. The map's
      position was hardcoded (`inset: 118px 300px 90px`) and had to be kept in
      sync by hand with the width of every floating panel; there were three
      such sets at different breakpoints, disagreeing with each other. The HUD
      grid and the map now read the same four tokens.
- [x] Deleted a stale second layout pass that re-positioned every panel
      absolutely at `min-width: 901px`, which was fighting the first set.
- [x] Panels no longer float over the board — the map has its own cell.
- [x] Added a spacing scale and radius scale; gaps had been drawn ad hoc from
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, and 14px.

### Sizing and readability

- [x] Raised the type floor. 66 declarations sat between 5px and 9px, including
      5px craft-cost labels and 6px item names. Nothing is below 10px now.
- [x] Removed the truncation those sizes forced: item, district, craft, and
      build labels wrapped or ellipsed to "SEED…", "COST F…", "MOO…".
- [x] Build chips show costs as icon-and-number pairs; the itemised wording
      stays in the detail line and the tooltip. The Root Workshop's four-part
      cost had pushed its button out of the dock.
- [x] All six build options fit one row; the sixth used to wrap out of view.
- [x] Rebuilt the control dock as a single grouped column instead of a loose
      strip, and widened the day card, which had been stacking one word a line.
- [x] Fixed the mobile column, where panels collapsed under their own content
      and overlapped: the desktop rules' `min-height: 0` was being inherited
      into the flex column, and two new breakpoint blocks were overriding the
      mobile rules because they were not bounded below.

### Bug found

- Missing-cost text always used the plural item label, so a single missing
  fragment read "1 MAP FRAGMENTS".

### Verification

- 100 Vitest tests and 14 Playwright tests pass.
- Two new end-to-end layout tests assert that no HUD panel clips its own
  content and that no panel overlaps the board. They check the symptom rather
  than pixel values, so the design can still be tuned freely.
- Inspected at 1440×900, 1280×800, and 375×812.

## Playability pass

### The board was unplayable at normal window sizes

- [x] The canvas was a fixed 900×640 surface letterboxed by `Scale.FIT`. On a
      1280×720 laptop the map cell was 640×320 and the canvas shrank to
      **450×300 inside it** — a third of the width thrown away. The surface is
      now measured from the map cell before the game boots, so it fills it.
- [x] The camera opened at "fit the whole 32×24 board", which put a tile at
      ~14px and a resident at ~10px. It now opens on a readable framing centred
      on the Root Heart, with a guaranteed minimum field of view so a small
      screen still shows somewhere to act.
- [x] Zoom limits were absolute (0.5–1.8). On a small window, fitting the board
      needs less than 0.5, so the player could not zoom out far enough to see
      their own settlement. Limits are now multiples of "fit".
- [x] Short windows: the top bar and dock together claimed 400 of 720 pixels.
      A short-viewport mode gives that height back to the board.

Net effect at 1280×720: the play area went from 450×300 to 638×352, and the
opening view from 14px tiles to 26px.

### Testing the game, not just the panels

- [x] Added `window.probe_board()`, which reports wild nodes and buildable
      plots with their on-screen positions. Every existing end-to-end test drove
      the HUD; none could touch the board, so the actual loop had no coverage.
- [x] Five new tests play the game: the opening view has something to act on,
      the canvas fills its cell, gathering a node pays out and credits the
      objective, a gathered node leaves the map and is queued to regrow, and a
      building can be placed.

### Bugs found

- `Scale.RESIZE` and manual resizing both stall Phaser's asset loader when the
  drawing buffer is resized while it is still running: 6 of 16 files loaded,
  nothing in flight, nothing failed, `create()` never reached, game stuck on the
  boot splash. Avoided by sizing the surface once before boot.
- Dismissing the title card left focus on the button it had just hidden, so the
  next Enter was swallowed as that button's activation instead of advancing the
  first-run coach. Focus is now released, which also keeps Space on the clock.

### Known risk

- The in-app browser preview's **mobile emulation** hangs on the boot splash
  with the loader stalled the same way. Playwright's mobile emulation
  (390×844, touch, 19/19 green) does not reproduce it, and neither does a
  desktop context at the same small surface size, so the evidence points to an
  emulator artifact — but it is not explained, and it has not been checked on
  real hardware.

### Verification

- 100 Vitest tests and 19 Playwright tests pass, twice in a row.
