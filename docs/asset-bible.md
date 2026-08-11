# Mosslight Commons — Asset Bible

## Visual contract

Mosslight Commons uses a top-down 2D presentation with pixel-informed silhouettes and painterly lighting. Assets should be readable at game scale first and decorative at zoomed-out scale second.

### Palette

- Ink: `#08151B`
- Deep moss: `#12352F`
- Wetland teal: `#2D8C84`
- Mosslight cyan: `#63E6D4`
- Lantern gold: `#F4B85B`
- Glow violet: `#9C7BFF`
- Bramble rust: `#C96E4A`
- Reed green: `#8DBB72`
- Paper cream: `#F5E6C8`
- Warning coral: `#E87968`

## Asset groups

### Brand and key art

| Key | File | Purpose | Status |
| --- | --- | --- | --- |
| `brand.mosslightMark` | `assets/generated/mosslight-mark.png` | Title screen and favicon source | planned |
| `brand.keyArt` | `assets/generated/mosslight-key-art.png` | Title screen, README, loading screen | generated reference |
| `brand.paletteBoard` | `assets/generated/mosslight-palette-board.png` | Internal art reference | planned |

### Characters

| Key | File | Purpose | Status |
| --- | --- | --- | --- |
| `creature.bramblebackSheet` | `assets/characters/brambleback-sheet.png` | Idle and walk starter frames | planned |
| `creature.glowtailSheet` | `assets/characters/glowtail-sheet.png` | Idle and walk starter frames | planned |
| `creature.mirelingSheet` | `assets/characters/mireling-sheet.png` | Idle and walk starter frames | planned |
| `creature.cloudmothSheet` | `assets/characters/cloudmoth-sheet.png` | Future species teaser | planned |
| `creature.speciesPortraitBoard` | `assets/generated/mosslight-species-portraits.png` | Resident inspector art direction and portrait source | generated reference |
| `creature.runtimeResidentSprites` | `assets/runtime/residents/*.png` | Transparent runtime sprites for Brambleback, Glowtail, and Mireling residents | generated runtime |

### World

| Key | File | Purpose | Status |
| --- | --- | --- | --- |
| `world.tileSheet` | `assets/world/mosslight-tiles.png` | Ground, water, roads, wild plots | planned |
| `world.buildingSheet` | `assets/world/mosslight-buildings.png` | Five first-slice structures, including Root Workshop | planned |
| `world.gatheringBoard` | `assets/generated/mosslight-gathering-board.png` | Reference board for four map blocks and four collectible item tokens | generated reference |
| `world.civicExpansionBoard` | `assets/generated/mosslight-civic-expansion-board.png` | Reference board for scouting, fog-of-war zones, district motifs, recipes, relationships, and seasonal events | generated reference |
| `world.runtimeBuildingSprites` | `assets/runtime/buildings/*.png` | Transparent runtime sprites for the root-heart and five civic structures | generated runtime |
| `world.runtimeNodeSprites` | `assets/runtime/nodes/*.png` | Transparent runtime sprites for Fern, Mushroom, Crystal, and Ruin nodes | generated runtime |
| `world.rootHeart` | `assets/world/root-heart.png` | Central landmark | planned |
| `world.eventEffects` | `assets/world/event-effects.png` | Festival, warning, discovery effects | planned |

### UI

| Key | File | Purpose | Status |
| --- | --- | --- | --- |
| `ui.resourceIcons` | `assets/ui/resource-icons.png` | Food, water, warmth, light | planned |
| `ui.forecastGlyphs` | `assets/ui/forecast-glyphs.png` | Event forecast states | planned |
| `ui.ledgerFrame` | `assets/ui/ledger-frame.png` | HUD backing and panel accents | planned |
| `ui.fieldworkIcons` | `assets/ui/fieldwork-icons.png` | Item pack and objective glyphs | planned |
| `ui.civicExpansionIcons` | `assets/ui/civic-expansion-icons.png` | Expedition, district, relationship, and recipe icon family | planned |

## Generation rules

- Generate style sheets and concept boards before individual production assets.
- Keep each creature’s silhouette and palette stable across all poses.
- Characters should be centered bottom-to-center with a consistent ground anchor.
- Prefer transparent backgrounds for gameplay assets.
- Do not bake UI text into gameplay sprites.
- Use generated images as visual source material; normalize or redraw production sprites when frame consistency matters.
- Keep key art separate from gameplay sprite sheets.
- Keep gathering nodes visually distinct at 22px tile scale: a leafy vertical silhouette, a warm cap, a three-point crystal, and a blocky ruin.
- Keep found-item tokens geometric and high contrast so they remain legible in the compact Fieldwork panel.

## Starter asset pack

The first generation pass should produce:

1. A title/key-art scene showing the Mosslight root and a tiny settlement.
2. A character board with the three first-slice species and their silhouettes.
3. A top-down world/building board showing the neighborhood language.
4. A UI/resource board showing the ledger style and icon vocabulary.

These boards are enough to lock the visual direction before investing in animation strips.

## Current generated references

The generated portrait board is intentionally reference-only. It preserves the three species’ silhouette, material, and palette relationships, but its checkerboard preview is baked into the RGB image. Before runtime use, redraw or extract each portrait onto a real alpha channel and normalize the crop to a consistent UI anchor.

The gathering board is also reference-only. It contains four map-block concepts—Fern Patch, Ember Mushroom, Moon Crystal, and Root Ruin—and four item tokens—Seed Pod, Amber Resin, Moonwater, and Map Fragment. The runtime currently uses procedural Phaser marks for fast iteration; the board is the visual target for a future normalized tile/item sheet.

The civic expansion board is reference-only as well. It establishes the scout silhouette, revealed-zone contrast, the five district moods, the three recipe tokens, relationship glyph language, and four seasonal event moods. The runtime currently renders these as palette-consistent DOM labels and procedural map marks; production art should split the board into normalized transparent assets later.

The current runtime pack is the first normalized exception: the building, resident, and gathering-node crops have real alpha channels, stable names, and controlled display sizes. These are production-facing prototype assets; animation strips and a normalized tile sheet remain future work.
