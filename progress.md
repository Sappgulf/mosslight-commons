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

## Gameplay pass

Measured first. A headless 1,200-tick run with no player input showed the
settlement collapsing on day 94 with **every stockpile at 100** — 48 residents
gone, zero of thirteen objectives touched, and the four bars the player watches
all the way through reading full. Average food *need* fell 72 → 23 while the
food *store* was pinned at max. The two halves of the economy were unrelated.

### 1 · The stores actually feed the settlement

- [x] Stores were a threshold, not a supply: `food < 25` made needs drain
      faster and that was the whole of the relationship. Eating, resting and
      lighting the routes now draw real stock, so an empty granary is felt.
- [x] Consumption moved out of the production step. It was a flat per-head
      subtraction disconnected from anything a resident did; it is now the
      residents doing it, at the moment they do it.
- [x] **Fixed a one-way ratchet:** safety had no recovery path outside
      expedition leaders. It fell 0.2 a tick forever, so every resident was on a
      silent countdown to leaving that no play could interrupt. Standing in
      lantern light restores it and burns light — which is what groves are for.
- [x] Satiety thresholds: a resident who reached the market used to eat on
      every tick they lingered, emptying a full granary in twenty days.

### 2 · Storage is built, not given

- [x] Everything capped at a flat 100, which food reached by day 24 and never
      left. Capacity now comes from buildings, so surplus needs somewhere to go.

### 3 · Requests are contracts

- [x] Wants carry a deadline and a payout. Twenty-six could sit open at once
      for a twentieth of a belonging point a tick; answering one now pays items
      and species standing, and letting one lapse costs both.
- [x] The petition list shows the clock and the reward, and focuses the map.

### 4 · The settlement can help itself

- [x] Building count sat at five for the whole 1,200-tick run. When the burrows
      are full and there is a real surplus, residents now raise a home
      themselves — slowly, and out of stock, so the player still builds better.

### 5 · Choices cost something

- [x] District focus was a free toggle with pure upside; it now takes days to
      settle and costs the changeover, and the HUD shows the lock-out.
- [x] Approving a council proposal costs stores, so the council is a decision
      rather than a formality.
- [x] Roads are visibly faster to walk. The pathfinder already preferred them,
      but a preference the player cannot see is not a mechanic.

### 6 · The decline explains itself

- [x] A Commons Report naming the need in the worst shape, its cause and its
      fix, and warning on a shortage *before* needs fall.

### The curve now

Grows 36 → 60 over ~80 days, self-builds when housing binds, then the economy
cannot feed sixty on one farm: strained around day 95, departures from day 100.
Passive play survives roughly a hundred days and then declines; building farms
and markets is what carries it past that.

### Bug found

- Adding fields to `Want` without bumping the save version meant every existing
  save crashed the HUD on first render (`reading 'label'` on an undefined
  reward). `SAVE_VERSION` 5 → 6 plus normalisation for wants carried over.

### Verification

- 114 Vitest tests (13 new covering supply, storage, contracts and costs) and
  19 Playwright tests pass. Two snapshots re-recorded deliberately.

## Progression pass

Wrote a headless "player" that plays the game properly — gathers every revealed
node, raises the workshop, keeps a scout out, crafts what the stores allow,
upgrades what it can, packs roads when asked. Nothing had ever tested whether
the game can actually be finished. It could not.

### Two objectives were unreachable

- [x] **The workshop ate all the resin.** A Root Workshop consumed one resin a
      tick with no floor, pinning the stock at zero eight ticks after it went
      up. Glow Kits and Comfort Bundles both need resin in hand, so raising the
      workshop — a chapter-zero objective — permanently blocked the chapter-one
      objective asking for two Glow Kits. It now renders only *surplus* resin
      above a reserve of four.
- [x] **Opening the Old Hollow could not be credited.** Expeditions only ever
      target an unrevealed zone, and crafting a Root Bridge reveals the Old
      Hollow outright — so the bridge the chapter-one ledger asks for left "Open
      the Old Hollow" stuck at 0/1 with no expedition able to reach it again.
      Chapter two could never finish and chapter three never unlocked.
      Crediting it at reveal was not enough on its own, because the reveal
      happens during chapter one and objectives from a future chapter are
      skipped; zone objectives are now swept from `revealedAreas` the way
      population and harmony are swept from live metrics.

### Result

A played game now runs 3/13 objectives → **13/13, chapter 3, by day 58**. A
passive game still sits at 0/13, which is correct: the ledger is a list of
things the player does.

### Known gap

The bot finishes the ledger on day 58 and then has nothing left to pursue for
the remaining hundred and fifty days it was run. There is no endgame past
chapter 3, and gathered items have almost no sink — a play-through accumulates
hundreds of seed pods with nothing to spend them on.

### Verification

- 119 Vitest tests (5 new, including an end-to-end play-through that asserts
  every objective completes) and 19 Playwright tests pass.

## Growth pass — the city grows, people get better, generations compound

### People get better

- [x] **Mastery.** Five tiers — Untrained, Hand, Keeper, Adept, Master — each
      with a title ("Master of the Reeds"), a mark drawn beside the resident on
      the board, and a real output multiplier. Promotions are announced once.
- [x] **Skill actually accrues.** It used to be granted only in the tick a
      resident happened to arrive at their workplace with `work` as their goal,
      which almost never happened once needs steered them: a hundred and
      seventy days in, an entire settlement was still Untrained. Everyone
      assigned to a bench now practises daily, and learning slows near the top.
- [x] **Mentorship.** An experienced worker at the same building brings a
      beginner on 60% faster, and the pairing is announced.

### Generations compound

- [x] Children inherit a quarter of a parent's craft instead of a flat 2 in
      everything, plus a species leaning. A hundred-day-old Commons now raises
      visibly better workers than a young one.

### The city grows

- [x] The settlement builds what the report says it lacks — farms when the
      stalls run thin, groves when the edges are dark, a market when neighbours
      never meet — and builds ahead of the crunch rather than after it.
- [x] **Desire paths.** Footfall is recorded per tile and well-walked ground
      packs itself into a road, capped at one a day so the basin never paves
      over. The map now records how it has been lived in.
- [x] Population ceiling 60 → 110. The old cap was reached by day 74, after
      which housing stopped meaning anything.

### Traditions

- [x] Five settlement-wide practices bought once with gathered goods and kept
      for good: Seed Vault, Open Table, Hearthcraft, Lantern Vigil, Long
      Memory. They are the sink a play-through's hundreds of surplus seed pods
      never had, and they compete with crafting for the same materials.

### The curve now

Over ~180 days: population **36 → 110**, housing capacity **42 → 148**,
buildings **6 → 8 at a combined level of 22**, average mastery **0 → 3.9** with
99 Masters, and **38 births**. Still thriving at the end.

### Bug found — the same one as last pass

Adding world fields without bumping the save version broke every existing save
again, this time on `state.traditions.includes`. `SAVE_VERSION` 6 → 7, with
normalisation for the new fields. A test now strips every field added since the
schema first shipped and asserts `normalizeWorld` fills them and the world
keeps ticking, so this cannot make it three times.

### Verification

- 134 Vitest tests (16 new) and 19 Playwright tests pass.

## Living basin pass — a third route and a map you can click

- [x] Canopy Rift: a third fogged bank, opened by a Sky Walk, a Sky Lantern,
      or a scout.
- [x] Chapter 5: chart the rift and hang a Sky Lantern. Craft progress now
      sweeps from `crafted` so early work still counts.
- [x] Cloudmoths ask for a Sky Walk. Answering pays moonwater.
- [x] Clickable basin minimap on the brand card.
- [x] Build hotkeys: H home, R farm, G grove, C market, T workshop, Y sky, N path.

## Playtest pass — the HUD has to hold seven tools

E2E was already green (19). Playing the dock showed the new Sky Walk and the
fourth recipe wrapping off the row, and NEW wiping a run on one click.

- [x] Build dock is seven columns so PATH and Sky Walk stay on one row.
- [x] Craft grid is 2×2 so Sky Lantern is not a leftover chip.
- [x] NEW asks for a second press.
- [x] Closing the ledger pauses on the victory card.
- [x] Click the Commons Report to arm the building it is asking for.
- [x] Phase tints the HUD; a selected resident says the camera is following.

## Polish pass — close the loop, keep the page alive

- [x] Victory overlay when the ledger is finished; sandbox play continues.
- [x] Camera follows a selected resident until the player pans away.
- [x] Save, load, import, and export speak back through a toast.
- [x] A thrown tick pauses the world instead of freezing the canvas.
- [x] HUD and scene paints are isolated so one cannot take down the other.
- [x] Reduced-motion skips weather, shake, and camera follow.
- [x] Missing textures no longer stall the loader.
- [x] Vercel cache headers: HTML always fresh, hashed assets immutable.

## Presence pass — Sky Walk, Sky Lantern, and a real Torx graph

- [x] New late building: Sky Walk. Unlocks at chapter 2 or when Cloudmoths
      arrive. Produces light, assigns moths as crew, likes lantern groves.
- [x] New recipe: Sky Lantern. Comforts Cloudmoths and adds light.
- [x] Chapter 4 now asks the player to hang a Sky Walk. Played runs still
      finish the whole ledger.
- [x] New painterly Sky Walk sprite, keyed and shipped as 8KB WebP.
- [x] Torx+THRML sidecar now samples a six-node Ising graph (stores, housing,
      shade) and returns four policy axes plus two alternative futures.
- [x] The forecast card shows those signals when the sidecar is live.
- [x] Local CORS now accepts the Vite origin, not only the preview port.

## Atmosphere pass — weather, light, and a last chapter

The systems already played like a city. The basin still *looked* like a
diagram. This pass gives the world weather, punch, and somewhere to go after
chapter three.

- [x] Seasonal weather layer: mosswake petals, suncrest spores, emberfall
      embers, Long Shade ash, rain, and Cloudmoth dust.
- [x] Water shimmer, node bob, camera shake/flash on gather, build, upgrade,
      and ledger beats.
- [x] Cloudmoths carry lilac light; Sky Veil tradition widens lanterns and
      helps moths belong.
- [x] Wind/ash audio bed that thickens with the season.
- [x] Chapter 4: Raise the Sky Veil, keep three Cloudmoths. A played game now
      finishes 15/15 and ends on chapter 4.

## Dispersal pass — a town rather than a pile

Residents resolved their market, farm and grove from a map that held exactly
one building per type, then walked to that building's own tile. A settlement of
ninety put **twenty residents on a single cell**, and every market after the
first was ignored entirely — building a second one bought the player nothing.

- [x] **Nearest, not first.** Every building of a type is indexed now, and
      residents route to whichever is closest to them.
- [x] **Standing spots.** Each resident has a settled place on the two-deep
      ring around a building they visit, hashed from their own id so they keep
      it between visits. A crowd reads as a gathering around a market instead
      of a pile on top of one.
- [x] **Workplaces rebalance daily** across every bench of the same craft,
      nearest first and weighted against crowding, so a new workshop draws a
      crew instead of standing empty.
- [x] **Placement suits the building.** New construction was dropped on the
      first free tile spiralling out from the Root Heart, so the town stayed one
      dense knot however much it grew. Homes now go just beyond the edge of the
      housing, farms by the water, groves over the darkest inhabited ground, and
      markets central to where people actually live.
- [x] Markets scale with population rather than being capped at two.

### Result

At 110 residents: the worst-occupied tile went from **20 to 4**, residents
spread over **53 tiles instead of 26**, and the built area grew from 16×11 to
16×16 with fourteen buildings of five kinds.

### Verification

- 138 Vitest tests (4 new, including one asserting reed farms end up near
  water) and 19 Playwright tests pass.

## Stress-graph pass — a model shaped like the town

The forecast was two hardcoded lists. The browser ranked five hand-tuned
candidates; the sidecar ranked seven more and sampled a **fixed six-node Ising
chain** of basin-wide aggregates. Neither knew the settlement had districts, so
a basin with full stores could never surface the one neighborhood in the dark,
and every forecast read the same however the player had built.

- [x] **New `src/sim/graph.ts`.** The settlement's stress graph: one node per
      (district × channel) over six pressures — food, water, warmth, light,
      housing, shade — so the graph's *shape* now follows the town.
- [x] **Two kinds of coupling.** `channel` edges tie pressures together inside
      one district (light↔shade at 0.55, warmth↔housing at 0.36); `spatial`
      edges tie the same pressure across districts, weighted by real
      centre-to-centre distance and cut off past 14 tiles.
- [x] **Local stress is genuinely local.** Each channel blends the basin-wide
      stockpile with what the district can actually reach: a grove lights its
      own ground, a district feeding many mouths from few farms is short even
      when stores are full.
- [x] **Forecasts are generated, not picked.** `generateForecasts()` builds one
      candidate per channel from measured stress. A basin never short of water
      simply stops surfacing a Wetland Warning, and a forecast names the
      district it is about: *"Fern Meadow reads 55% light pressure with 36
      residents · basin-wide 44% across 5 districts · spreading toward Reed
      Wetland and Commons Market."*
- [x] **The sidecar builds its Ising model from the transmitted graph** rather
      than a hardcoded chain — variable node count, per-edge weights — and
      generates its candidates the same way the browser does.
- [x] `BASE_HOUSING_CAPACITY` / `HOME_HOUSING_CAPACITY` moved to
      `data/definitions.ts` so the per-district reading and the basin-wide
      metric cannot drift apart.

### Performance

The graph runs on the every-tick forecast path, and the first cut timed the
full-playthrough test out. Three fixes: entities are bucketed into districts in
a **single pass** instead of a filter per district, each channel's mean and
worst district are **rolled up once during the build** instead of rescanned per
read, and the graph is **memoized per world** on tick plus collection lengths.
The 1600-tick playthrough went from 4.44s at baseline to 3.54s with the graph
in place.

`vite.config.ts` now sets `testTimeout: 30000`. Several tests play a full game
out; at the 5s default they passed alone and timed out under parallel load, so
the suite was failing on machine load rather than on behaviour.

### Verification

- 150 Vitest tests (11 new, covering graph shape, edge validity, the 0..1
  stress bound, Long Shade raising shade stress, memoization, and generated
  forecast ranking/determinism) and 20 Playwright tests pass.
- The Python sidecar's pure logic is exercised with the numeric stack stubbed;
  that harness caught an ordering bug where an empty graph did Torx work before
  bailing. The THRML/Torx sampling paths are **unverified on this machine** —
  see below.

## Consequence pass — the social graph does something

Relationships were tracked in detail — four kinds, strength, shared days,
friendships promoted to family — and then changed almost nothing. Traditions
were framed as "lasting choices" that every settlement eventually took all of.

- [x] **Rivalry is felt where it happens.** It was a single settlement-wide
      multiplier on food and water, so two residents who could not stand each
      other slowed farms on the far side of the basin, and splitting them
      across benches changed nothing at all. It now costs the bench they
      actually share — 8% per rival pair standing on it, floored at 0.6 — so
      moving one of them fixes it and assignment matters.
- [x] **Families move in together.** Kinship and family ties were promoted,
      strengthened, and then only ever coloured a line in the inspector:
      residents were housed by `index % homes.length` at world creation and
      never moved again. Once a day a resident with a family or kinship tie
      above 70 moves into that relative's burrow if it has room, so the social
      graph is now visible on the board.
- [x] **Traditions rule each other out.** Seed Vault ↔ Open Table (store the
      harvest or give it away) and Hearthcraft ↔ Lantern Vigil (build around
      the hearth or the lantern) are now exclusive pairs, which makes chapters
      one and two a decision rather than a checklist. Sky Veil is deliberately
      unpaired: a chapter-four objective requires it, and no choice may lock
      the ledger. A ruled-out practice stays on the list, struck through and
      naming what closed it, rather than silently vanishing.

### Verification

- 168 Vitest tests (18 new across rivalry penalties, kinship rehoming, and the
  exclusion rules — including one asserting the Sky Veil stays reachable
  whatever else the Commons kept) and 20 Playwright tests pass.
- Browser-checked: the game boots clean, the only console errors are the
  optional sidecar's refused polls, and the blocked-practice styling resolves
  to opacity 0.45 with a struck-through label.
- Two snapshots updated on purpose: the pipeline gained a `kinship-homes`
  stage, and the 500-tick digest moved slightly now that rivalry is local
  rather than global.

## Memory pass — a Commons that remembers

The settlement had no past. A basin that scraped through a Long Shade by three
points of light and one that sailed through it read identically the next
morning: the crisis resolved, a line went into the ledger, and nothing carried
forward. The residents who were actually there had nothing to show for it.

- [x] **`src/sim/memory.ts`.** Residents carry up to four memories. A resolved
      Long Shade is recorded on everyone who was an adult or elder at the time,
      in the outcome's own voice — *"I stood the Long Shade when the light
      guttered. We came through thinner than we went in."*
- [x] **Sprouts do not remember**, so a settlement's history belongs to the
      generation that lived it and ages out with them.
- [x] **The Commons Report speaks for the past.** The oldest resident who
      actually remembers something is quoted beneath the present-tense
      diagnosis, set apart in italic behind a rule, and coloured by whether the
      memory is a hard one.
- [x] Memory-carrying residents leaving takes the memory with them; a Commons
      with nobody left who was there says nothing.

### A development handle

Verifying anything that depends on late state — a ruled-out tradition, an
elder's memory, a settlement in decline — meant playing to it by hand, so those
paths were unit-tested and then never actually looked at. `window.mosslight`
now exposes the simulation, the HUD, and a `days(n)` fast-forward. It is behind
`import.meta.env.DEV`, which is statically replaced at build time, so the block
is dropped from the production bundle rather than shipped and guarded — checked
against the built asset.

It immediately paid for itself: the tradition exclusions from the previous pass
had only ever been asserted in unit tests, and driving a real game to a kept
Seed Vault showed Open Table struck through and reading *RULED OUT BY SEED
VAULT* on the board for the first time.

### Verification

- 177 Vitest tests (9 new) and 20 Playwright tests pass.
- Browser-driven: a real game fast-forwarded to a resolved Long Shade recorded
  the memory on 47 of 49 residents — the two without are sprouts — and the
  Commons Report rendered *Juniper 1, elder: "…"* in warning colour.

## Lifecycle pass — a species can leave, and the decline shows

Only Cloudmoths ever had a condition attached to them, and once they arrived
they stayed forever whatever happened next. Everybody else was simply present
from the first morning to the last, so a Commons that let its water turn or its
light fail kept a full complement of Mirelings and Glowtails standing in it and
the species roster said nothing about how the place was being run.

- [x] **`src/sim/species.ts`.** Each species has a condition keyed to something
      the player already watches: Bramblebacks need somewhere to sleep,
      Glowtails need light, Mirelings need clean water, Cloudmoths need light
      *and* a canopy to rest under.
- [x] **Patience, then departure.** Past a species' patience (4–6 days) it
      loses someone a day, least-settled first, with a ledger line naming both
      the cause and the fix. The last one out is called out as the last.
- [x] **Strain heals twice as fast as it accrues**, so putting the basin right
      is rewarded rather than merely stopping the bleeding.
- [x] **A lost species can come back.** Six consecutive good days and they try
      the basin again — verified end to end in a live game: the Glowtails went
      to zero in the dark and two returned once the groves were lit.

### The trap this uncovered

The collapse test started failing: a starved basin that used to collapse now
only reached `strained`. The cause was the new departures themselves. Failure
was read from **average wellbeing**, and departures take the least settled
residents first — so a Commons haemorrhaging people watched its own average
*rise* and read as recovering. A starved settlement could shed a third of its
population and call itself strained.

Decline is now measured against `peakPopulation`, the settlement's own
high-water mark, which cannot be flattered by losing the unhappy: 20% below
peak is strained, 45% below is failing, whatever the remainder feel.

### Verification

- 190 Vitest tests (13 new) and 20 Playwright tests pass, including the full
  headless playthrough — the game is still finishable with species able to
  leave, because a species that leaves can also return.
- Browser-driven on a live game: holding the basin dark for twelve days took
  the Glowtails from 12 to 4 and the settlement from `thriving` to `strained`;
  eight more emptied them out entirely; ten lit days brought them back.
- Two snapshots updated on purpose: a new `species` pipeline stage, and the
  500-tick digest.
- `SAVE_VERSION` is 8. Old saves are rejected rather than migrated, which is
  the existing convention.

## Extraction pass — paying down the god class

Three passes in a row added systems to `simulation.ts` while the notes kept
calling it too big. It went 3,334 → 3,494 lines. This pass reverses that, and
adds nothing: every test that passed before passes after, with no snapshot
changes, because none of it is a behaviour change.

- [x] **`systems/metrics.ts`** (323 lines). Capacity, storage, harmony, and the
      plain-language diagnosis — every one of them a pure reading of world
      state that never needed the class. The edge-triggered warning bands moved
      too, carrying their "have we said this already?" bookkeeping with them as
      an explicit `WarningBands` argument instead of instance fields.
- [x] **`systems/movement.ts`** (109 lines). Targeting, stepping, road speed,
      and finding walkable ground, over an explicit `Terrain` — the world plus
      the set of blocked cells — rather than `this.occupiedCells`.
- [x] **`systems/wants.ts`** (132 lines). The tick half of personal requests:
      assigning, resolving, lapsing. The rules for *what* can be wanted already
      lived in `sim/wants.ts`; this is the half that was still on the class.
- [x] **`mood.ts`**, shared by wants and council proposals.
- [x] **`grid.ts`** and **`constants.ts`.** `GRID_WIDTH`, `TICKS_PER_DAY` and
      `DAYS_PER_SEASON` lived in `simulation.ts`, so a system needing them had
      to import the god class — impossible for a system the class imports. They
      have no dependencies, so they live apart and everything reads one copy.
      `forecast.ts` had already been forced into declaring its own
      `DAYS_PER_SEASON = 7`; that duplicate is gone.
- [x] `SimContext` gained `buildingById`, so a system can reach the building
      index rather than scanning the array.
- [x] Dead imports and constants left behind by the moves are removed —
      `MAX_RESOURCE`, `STORAGE_YIELD`, `BASE_STORAGE`, `PathContext`,
      `findPath`, and four want helpers.

`simulation.ts`: **3,494 → 3,112 lines**, and the pieces that came out are
testable without standing up a played game.

### A near miss

Moving `WANT_INTERVAL` I typed `18` where the original was `TICKS_PER_DAY`,
which is 12 — requests would have been offered a third less often, with every
test still green because nothing pins the interval. Caught by reading the old
declaration rather than by the suite. It is the argument for moving constants
to a shared module rather than retyping them at each call site.

### Verification

- 205 Vitest tests (15 new, covering the extracted metrics functions directly)
  and 20 Playwright tests pass. **No snapshot changed**, which is the real
  assertion for a refactor: the tick order and the 500-tick digest are both
  byte-identical.
- Browser-driven on a live game: 40 days in, harmony 85, housing 55/78, storage
  and diagnosis all reading correctly, console clean.

## Animation pass — frames instead of a squashed image

There was no animation system. Every resident was one static WebP, and
"walking" was that image squashed and rotated on a four-step counter inside the
scene's `update`. It reads acceptably in motion and it was the ceiling: a
resident could never show anything a single texture cannot, so the work loops,
life stages and facing the simulation already tracked had no way to reach the
screen.

- [x] **`render/ResidentAnimator.ts`.** Generated sheets — a row per state, a
      column per frame — registered as real Phaser animations, with a state
      machine per resident.
- [x] **Three states, driven by the simulation.** `walk` when a resident has a
      route, `work` when they are at their bench with `work` as their goal,
      `idle` otherwise. The work loop is new: the simulation has always known
      this and had no way to show it.
- [x] **Facing** from real movement, held through a stop so a resident who
      pauses does not snap back to a default direction.
- [x] **Life stages are visible at last.** Sprouts draw at 0.72, adults at 1,
      elders at 0.94 — measured on the board at 22, 30 and 28 pixels.
- [x] The inline squash/rotate block is gone; the body container keeps only the
      gentle vertical bob, which moves the creature without lifting its shadow.

### PLACEHOLDER ART

Nothing here draws a new creature. Each frame is the existing sprite redrawn
under a transform, so the *motion* is frame-based and real while the *art* is
still one pose. When hand-drawn sheets arrive, `buildPlaceholderSheet` is
replaced by a `load.spritesheet` call and everything else is untouched: same
keys, same frame counts, same states. Sheets should be 4 frames per state, in
the order idle / walk / work.

### A phantom bug, chased and dismissed

Residents appeared frozen on frame one with `isPlaying` reporting true, and the
scene's update list held 72 sprites in `_pending` with none active. That looks
exactly like the well-known "a sprite in a Container is off the update list"
trap, and a fix for it was written.

It was wrong. The scene clock was not advancing *at all* — `time.now` was
static and the pre-existing idle bob was frozen too, which no change of mine
could cause. The automation browser runs the page in a background tab, where
`requestAnimationFrame` is throttled to nothing while `setInterval` keeps
firing, so every sample landed on a frame the engine had never stepped. Driving
`game.loop.step()` by hand promoted all 72 sprites to active and advanced the
frames correctly.

The "fix" was removed. Had it shipped, the engine and the manual call would
both have stepped every animation — every resident at double speed.

### Verification

- 205 Vitest and 20 Playwright tests pass; the build is clean.
- Browser-driven: all four species build a sheet and register idle/walk/work;
  72 residents animate across the three states; forcing a `work` goal produces
  `brambleback-work`; stage widths measure 22/30/28; stepping the engine cycles
  frames 1→2→3→4→1.

## Journey pass — scouts, crews, and ground worth crossing

The basin had movement but no travel. A survey resolved on a three-to-six tick
timer wherever the scout happened to be standing — usually inside the
settlement, having walked nowhere — and they never came home. A raising was a
counter nobody attended. Wandering picked a random cell, which mostly meant
walking to another spot in the middle of town.

- [x] **A survey is a journey.** The reveal waits for the scout to actually
      reach the place, then they walk back. `phase` tracks outbound and
      returning, and the HUD says which rather than showing a meaningless
      counter.
- [x] **Scouts route through unmapped ground.** Ordinary routing refuses it —
      correctly, for a resident running errands, and exactly wrong for the one
      sent to chart it. `Terrain.ignoreRevealed` carries the permission, on the
      terrain rather than the call, because `takeStep` repaths mid-route.
- [x] **Destinations are provably reachable.** The Canopy Rift's marker sits on
      open water with water on every side, so that survey could never arrive.
      `reachableNear` searches outward for ground that is walkable *and* has a
      route from the scout.
- [x] **A raising draws a crew.** Residents with nothing pressing walk to a
      nearby site and work it, and hands on site speed the work. Base progress
      is unchanged, so an unattended raising still finishes on schedule and no
      objective can stall.
- [x] **Sites look like sites.** Scaffolding that fills as the work goes,
      with a mark per builder present, replacing a thin teal ring.
- [x] **Ranging means the frontier**, not another cell downtown.

### Three bugs, each hiding the next

The scout reached only within three tiles and every survey ended on its
fallback. Fixing that took three passes because each fix uncovered the next:

1. `setScoutTarget` set a permissive route, and then `takeStep` repathed
   restrictively one tile later. Permission moved onto the terrain.
2. The Canopy Rift target was open water. Destinations became reachable ground.
3. **The real one.** An existing branch in the resident loop re-targeted the
   scout every tick with ordinary routing and `continue`d — so it silently
   overwrote the expedition's route, and a fix I added below it was dead code
   the branch never reached. Three separate changes produced byte-identical
   trace output, which is what finally gave it away.

After: outbound ticks fell from 19/38/41 to 8/16/10, and all three zones are
reached by walking rather than by timeout.

### A pacing cost, taken deliberately

Real journeys are slower than a three-tick timer, and a crew draws some labour
off the benches. Chapter five now arrives after tick 1200 where it used to
arrive before it, so the chapter-order test's budget rises from 1200 to 1600 —
matching the sibling test that proves the ledger still completes in full. The
first cut of the crew was far worse: two thirds of free residents downed tools
for any site anywhere on the board, and since something is nearly always being
upgraded, it emptied the farms. It is now gated on interest, distance, and
whether the site still wants hands.

### Verification

- 209 Vitest tests (4 new, including one asserting every zone is reached on
  foot rather than on the fallback) and 20 Playwright tests pass.
- Browser-driven on a live game: a scout walked 12,9 → 27,12, arrived, and came
  home 27,14 → 13,9; a raising drew a crew and completed to level 2.

## Bloc pass — factions, cults, and people who walk out

The settlement had one social structure: everyone, equally, in one
undifferentiated population, with a council that spoke for species rather than
for anybody's convictions. Nothing could organise, split off, or hold a belief
the Commons disagreed with, so a hundred residents were a hundred copies of the
same civic attitude.

- [x] **`src/sim/factions.ts`.** Three shapes, and which one forms is decided
      by *why* rather than by a roll. A **faction** organises around a species'
      interests when harmony is thin and enough of them are unhappy to make a
      bloc. A **cult** forms around somebody carrying a hard memory — the
      memory system from the previous pass is what makes them possible — and
      speaks to whoever the Commons is failing. A **lone wolf** is one resilient
      resident with nothing left to belong to, who simply goes.
- [x] **Doctrines, not flavour.** Each bloc wants something the Commons can
      actually deliver — provision, shelter, light, clean water, memory — and
      its standing follows whether that thing is being delivered.
- [x] **Every bloc keeps its own history**, written as things happen to it: its
      founding and founder, who joined, when standing broke either way, and its
      dissolution. A run's politics can be read back afterwards.
- [x] **Procedural emblems** in `src/ui/emblem.ts`: deterministic SVG seeded per
      bloc, so the same bloc draws the same sigil across sessions and saves.
      Shape family follows kind — a civic polygon, a cult's star, a lone wolf's
      broken open ring — so the three read apart before the label does.
- [x] **A BLOCS panel** listing each with its mark, creed, membership, standing
      and latest history line. Dissolved blocs stay on the list, greyed: a
      Commons that drove a cult to collapse should still have to look at it.

### The first cut was churn, not politics

It produced **eight factions in forty-six days**, most of them one person, a new
name in the ledger every week — and no cults or lone wolves at all, because the
faction branch always fired first. That directly contradicted the comment
sitting above it about blocs being what a run is remembered for.

Rebalanced: the founding cooldown went 6 → 22 days, at most three organised
blocs exist at once, a faction needs a quorum of three willing members of a
species that has no bloc already, and a cult needs somebody scarred *plus*
people for it to speak to. Lone wolves were moved off the shared cooldown
entirely — one person walking out is not a bloc organising — which is why they
could never appear before.

### On assets

The emblems are genuinely generated rather than placeholder. A geometric sigil
is what a bloc's mark should be, and there is no sense in which hand-drawn art
is being stood in for. This is unlike the resident animation frames, which
remain explicit placeholders.

### Verification

- 224 Vitest tests (15 new, covering each formation path, the cap, the
  cooldown, one-bloc-per-species, dissolution, bounded history, standing
  tracking satisfaction, and that no resident is ever in two blocs) and 20
  Playwright tests pass.
- Browser: all three kinds render with distinct emblems and colour families,
  and a dissolved bloc greys out. Confirmed on screen.
- `SAVE_VERSION` is 10.

## Consequence pass — blocs that act

Blocs held grievances and did nothing with them. Standing fell to zero and the
only consequence was a number in a panel: the settlement could ignore every
organised body inside it forever, at no cost.

- [x] **An escalation with real bite.** `content → restless → striking →
      seceded`. Restless is an attitude; the other two cost the settlement.
- [x] **A strike is felt at the bench.** Striking members are excluded from
      `weightedOutput`, so the loss lands on the buildings those particular
      residents work rather than as an abstract settlement-wide penalty —
      the same principle as the rivalry fix.
- [x] **Secession takes its people.** A bloc ignored through a long strike
      leaves the Commons entirely, removing its members through the ordinary
      departure path so population, housing and the peak-based decline reading
      all account for it. A settlement can lose a fifth of itself to politics.
- [x] **Slow to anger, and reversible.** Standing falls about two a day, so
      unrest does not begin until the middle of a season, and answering the
      doctrine at any point sends them back to work with a line in their
      history saying so.
- [x] **A lone wolf never strikes** — they have already withdrawn and have
      nothing left to withhold.
- [x] The panel leads with the stance rather than the kind once a bloc is
      unhappy, because a strike is output being lost right now: gold for
      restless, coral card and "withholding labour" for a strike.

### Verification

- 230 Vitest tests (6 new, covering the full escalation, its reversal, the
  striker set production consults, that secession needs a long strike first,
  that lone wolves are exempt, and that seceding actually reduces population)
  and 20 Playwright tests pass.
- Browser: all three stances render with their own colour and label.

## Legibility pass — the board, and a town that actually grows

Player feedback, and it was right: the movement felt the same, the settlement
never expanded, and the map was covered in things that should not have been on
it. Seven passes had gone into simulation depth while the three things a player
actually looks at went untouched.

### The board carries no furniture

- [x] Removed the permanent "M O S S L I G H T   B A S I N" title painted over
      the world, and the standing instruction line — "drag to pan · scroll to
      zoom", plus the weather described in words on top of weather already
      visible. The hint survives only when it says something the board cannot:
      what a held tool will place, or what is under the cursor.
- [x] The board went from **36% to 56%** of the stacked layout's height. The
      brand block and its six file-management buttons — SAVE, LOAD, EXPORT,
      IMPORT, NEW, ? — were sitting between the map and the settlement's own
      readouts; they now go to the bottom of the stack where they belong.
- [x] Want glyphs only mark requests actually running out of time. Every open
      want used to float a heart, so a hundred residents wore a permanent
      forest of them that said nothing about which needed answering.

### A settlement that grows out of prosperity, not only crisis

`chooseSelfBuild` returned nothing unless housing was tight or the report was a
warning. A thriving Commons therefore built **nothing at all**: 104 residents
lived in 11 buildings, and the town only ever grew when it was already in
trouble. `chooseGrowth` adds what a population of that size warrants — farms,
groves, markets, burrows and workshops in proportion to the people.

Measured over the same 1400-tick run: **buildings 11 → 23**, footprint 17×17 →
20×17, occupied tiles 53 → 66.

### A wrong diagnosis, corrected

The first attempt raised the hard 16-tile cap on how far from the Root anything
could be built, on the theory that the cap was pinning the town in place. It
was not: the footprint came back **byte-identical to baseline**, because the
cap was never the binding constraint — the settlement simply was not building.
Measuring before and after is what caught it. The reach change was kept, since
a growing town does now need the room, but it was not the fix.

### A naming bug the growth exposed

More population surfaced duplicate residents: two `Sedge 3`, a `Moss 3`
glowtail and a `Moss 3` mireling. Names were built from the population array's
index, so every departure freed an index for the next arrival to reuse. Names
are keyed to the resident's own ever-increasing id now — **0 duplicates across
a 106-resident run**, where before a settlement that had lost anybody produced
them routinely. A mastery test had been quietly absorbing this by keying its
counts on names.

### Verification

- 230 Vitest and 20 Playwright tests pass. One snapshot updated on purpose: the
  500-tick digest now shows 13 buildings where it showed 8.
- Browser: at day 171 the basin holds 110 residents across 25 buildings, spread
  over the board rather than banked in one strip.

## Pace pass — and a feature withheld

Player feedback: "it's the same movement." It was. Every resident moved exactly
one tile per tick, so a sprout, an elder and a scout crossed the basin at
identical speed and a hundred residents slid about in lockstep — which is most
of why the board read as mechanical however much simulation sat behind it.

- [x] **Pace is per-resident.** Species (Mirelings patient, Glowtails and
      Cloudmoths quick), life stage (young legs quick, old legs not) and what
      they are currently doing all multiply together.
- [x] **The remainder is banked.** A resident who moves at 0.82 tiles a tick
      steps on most ticks and pauses on the others, which reads as a slower
      walk rather than a stutter, and no fraction is ever lost.
- [x] Roads still buy an outright extra tile, so packing earth stays worth it.

Measured across a 900-tick settlement: **23 distinct paces, the fastest 2.58×
the slowest.** It was 1.00× for everybody before.

### Dwell: built, measured, and removed

The other half of the plan was for residents to arrive somewhere and stay a
while doing the thing, instead of re-deciding their goal every single tick. It
was built, and it worked — but it cost the settlement's throughput badly enough
that **the ledger could no longer be finished**: chapters stopped at 2 of 5.

Tuning it down did not rescue it. Disabling dwell alone, with pace left in,
restored progression immediately — so the cause was not in doubt. Even a
two-tick dwell failed. The progression test's own comment warns that its tick
budget has already been raised twice for similar reasons and that a third rise
should be treated as a symptom rather than a fix, which is exactly right, so
the budget was left alone and the feature was removed instead.

What that says, and it is worth recording: the pacing budget is now the binding
constraint on any change that makes residents act more deliberately. Dwelling
is the right idea and cannot be afforded until the ledger's pacing has room in
it — that is the thing to fix first, not the dwell.

An interim bug worth noting, since it nearly hid the pacing problem: while a
resident was dwelling their committed goal and the freshly computed one
disagreed, and the arrival effects were testing the fresh one. A resident stood
at the market being checked against their bench, so they never ate. Settlement
wellbeing fell 77 → 63 before that was found.

### Verification

- 236 Vitest tests (6 new, pinning that the young outpace the old, that each
  species has its own gait, that goal changes pace, that nobody stalls, that a
  real settlement spreads across many speeds, and that fractional steps are
  banked) and 20 Playwright tests pass.
- One snapshot updated on purpose.
