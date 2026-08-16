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
