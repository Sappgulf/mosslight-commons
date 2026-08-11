# Mosslight Commons — Game Bible

## One-line pitch

Build a refuge beneath a dying canopy, balance the needs of several creature species, and discover the stories that emerge when a city becomes a living ecosystem.

## Product identity

- **Working title:** Mosslight Commons
- **Genre:** 2D top-down colony sim / city builder
- **Primary fantasy:** I am the steward of a habitat, not the ruler of individual creatures. I shape conditions, and the residents decide what the city becomes.
- **Reference feeling:** The legibility and civic feedback of a classic city builder, combined with the intimate population stories of a creature sim.
- **Target session:** 10–20 minute neighborhood experiments in the first prototype; longer sandbox sessions later.
- **Audience:** Players who enjoy management games, emergent stories, cozy simulation, and readable systems.

## Design pillars

1. **Shape conditions, not puppets.** The player places structures, sets priorities, and responds to events. Creatures choose actions based on needs, traits, relationships, and local conditions.
2. **Every system should be legible.** The game shows why a creature moved, why a building is failing, and which probabilities changed after a player decision.
3. **Small choices create civic stories.** A missing bridge, an overworked market, or a lantern shortage should become a story the player can understand.
4. **A beautiful habitat is a functional habitat.** Wildness, comfort, prosperity, and harmony are complementary goals rather than a single score bar.
5. **Uncertainty is part of the fun.** Forecasts are useful but not absolute. The player makes plans knowing that the city is alive and partially unpredictable.

## Story and setting

The world was once covered by the Great Canopy, a continent-sized living forest that fed every species through a network of luminous roots. The Canopy is receding. Its last healthy root-heart, the **Mosslight**, has awakened beneath a forgotten basin and called for caretakers.

The player is the first **Steward of the Commons**, given a broken survey map, a seed of Mosslight, and one promise: make a place where different species can stay through the coming Long Shade.

The settlement begins as a few shelters around a glowing root. It becomes a borough, then a city, and eventually a test of whether cooperation can outgrow scarcity. The story is told through city events, resident notes, construction milestones, and the changing shape of the habitat—not through long cutscenes.

### Story tensions

- **Shelter versus wildness:** Expanding the city protects residents but can choke the living wetlands.
- **Efficiency versus belonging:** Centralized markets are productive but can make neighborhoods feel interchangeable.
- **Certainty versus possibility:** Safe policies reduce risk but also reduce the surprising discoveries that make the Commons special.
- **Species identity versus civic identity:** Each species needs a home culture without turning the city into segregated zones.

## The residents

Residents are called **Motes** by outsiders, but each species has its own name and customs.

### Bramblebacks

Small, broad-shouldered burrowers with bark-like plates and expressive whiskers.

- Strengths: construction, hauling, shelter maintenance
- Needs: warmth, stable housing, dependable food
- Social tendency: form tight neighborhood circles
- Risk: become exhausted and stubborn when infrastructure is unreliable
- Visual language: russet, moss green, chunky silhouettes, tool belts

### Glowtails

Nocturnal fox-mouse creatures whose tails store soft blue light.

- Strengths: trade, exploration, information exchange
- Needs: lanterns, novelty, markets, social variety
- Social tendency: create informal routes and rumor networks
- Risk: migrate away when the city becomes too quiet or over-regulated
- Visual language: indigo, cyan, gold accents, long readable tails

### Mirelings

Amphibious reed-creatures with petal-like ears and translucent fins.

- Strengths: farming, water management, mediation
- Needs: clean water, wetlands, low noise
- Social tendency: maintain shared gardens and public rituals
- Risk: become ill or leave when water quality drops
- Visual language: teal, lilac, pale green, soft rounded shapes

### Later species: Cloudmoths

A late-game species that arrives with the Long Shade. Cloudmoths are artists, weather-readers, and builders of suspended walkways. They are intentionally out of the first vertical slice.

## Player role and verbs

The player acts through a civic tablet called the **Mosslight Ledger**.

- Survey a neighborhood and inspect needs, flows, and forecasts.
- Place roads, homes, services, resource buildings, and wild habitat.
- Set civic priorities such as shelter-first, market-first, or wetland-first.
- Approve or reject proposals from species councils.
- Pause, fast-forward, and step through simulation time.
- Follow individual residents to understand their decisions.
- Compare likely futures before committing to a major construction choice.

## Core loop

```text
Survey the neighborhood
        ↓
Place or upgrade a structure
        ↓
Advance time and observe residents
        ↓
Read the forecast and respond to an event
        ↓
Adjust priorities, infrastructure, or habitat
        ↓
Unlock the next civic possibility
```

## Fieldwork loop

The basin is not only empty space between buildings. Wild nodes are short-form discoveries that turn a player’s attention outward before the city grows inward.

1. **Spot a node:** Fern Patches, Ember Mushrooms, Moon Crystals, and Root Ruins use distinct silhouettes and colors.
2. **Gather it:** Click the node to clear the tile, receive a found item, and sometimes recover a small amount of food, warmth, water, or light.
3. **Read the objective:** Fieldwork cards track broad surveying, species-specific gathering, and civic construction goals.
4. **Invest the find:** A Root Workshop consumes gathered materials to produce a small ongoing warmth/light benefit and unlocks the next construction story.

The first three objectives are intentionally readable in one glance: gather any three nodes, gather two Fern Patches, and raise a Root Workshop. This creates a compact tutorial without a separate quest screen.

## Civic expansion loop

The fieldwork layer now opens into a small civic sandbox instead of ending at the first workshop.

- **Expeditions:** A resident can lead a timed scouting run into an unrevealed zone. The Sunken Reach is revealed by a successful expedition and returns Map Fragments.
- **Map reveals:** The Old Hollow begins hidden behind fog-of-war and becomes accessible after the settlement crafts a Root Bridge kit. Hidden cells cannot be gathered from or built on until the map is opened.
- **District focus:** The player can focus the settlement on Fern Meadow, Reed Wetland, Lantern Rise, Commons Market, or Root Ruins. Each focus changes one visible production, harmony, light, or expedition rule.
- **Relationships:** Residents carry lightweight social bonds. Nearby residents grow more familiar, the inspector shows a social circle, and the network contributes to Commons Harmony.
- **Seasonal events:** Each season presents a named civic moment—Seedwake Gathering, Lantern Fair, Ember Bloom, or Longshade Watch—with a short-lived modifier and a readable forecast explanation.
- **Crafting:** A Root Workshop accepts one order at a time. Glow Kits, Root Bridge kits, and Comfort Bundles consume found items and turn exploration into durable city improvements.

This creates a repeatable decision chain: scout or gather, choose a district priority, invest in a relationship-rich neighborhood, then craft the tool that changes the next decision.

## First vertical slice

The first playable build is deliberately small:

- One 32×24 tile neighborhood
- Three species: Bramblebacks, Glowtails, Mirelings
- Fifty simulated residents
- Five buildable structures: burrow home, market, reed farm, lantern grove, Root Workshop
- Four resources: food, water, warmth, light
- Four found items: Seed Pods, Amber Resin, Moonwater, Map Fragments
- Four gatherable wild node types: Fern Patch, Ember Mushroom, Moon Crystal, Root Ruin
- Five fieldwork objectives that bridge discovery into construction, expedition, and crafting
- Two fog-of-war zones: Sunken Reach and Old Hollow
- Five district focuses, a resident relationship network, and one active seasonal event
- Three Root Workshop recipes: Glow Kit, Root Bridge, and Comfort Bundle
- Four resident needs: shelter, food, safety, belonging
- One public metric: Commons Harmony
- Day/night cycle
- Resident movement between home, work, market, and wild habitat
- Three forecast events: food shortage, lantern festival, wetland warning
- A forecast panel showing the next likely event and its uncertainty
- A resident inspector showing traits, needs, current goal, and reason for action

## City systems

### Resources

- **Food:** produced by reed farms and gathered from wild plots
- **Water:** collected from the basin and filtered through wetland buildings
- **Warmth:** generated by communal hearths and sheltered construction
- **Light:** generated by lantern groves and used by Glowtails and public spaces
- **Harmony:** a derived civic measure based on need satisfaction, species mixing, and recent disruptions

### Structures

| Structure | Function | Tradeoff |
| --- | --- | --- |
| Burrow Home | Provides shelter and warmth | Uses space and building materials |
| Reed Farm | Produces food and cleans nearby water | Needs wetland space and attention |
| Lantern Grove | Produces light and attracts Glowtails | Can disturb Mireling habitats |
| Commons Market | Redistributes resources and creates social contact | Becomes fragile during shortages |
| Root Workshop | Refines gathered materials into civic craft | Needs resin and map fragments; consumes resin over time |

### Wild nodes and found items

| Node | Immediate recovery | Found item | Gameplay purpose |
| --- | --- | --- | --- |
| Fern Patch | Food | Seed Pods | Starts the “Seed the Commons” objective |
| Ember Mushroom | Warmth | Amber Resin | Feeds Root Workshop output |
| Moon Crystal | Water | Moonwater | Makes the basin’s edges worth surveying |
| Root Ruin | Light | Map Fragment | Supplies the workshop’s route-planning requirement |

### Events

Events are sampled from current conditions rather than selected from a purely random list.

- **Empty Shelves:** food supply is below demand; migration risk rises.
- **Lantern Festival:** light and belonging are high; trade and resident mixing improve.
- **Reed Blight:** water quality falls; Mireling health and farm output decline.
- **Unmapped Burrow:** Bramblebacks discover a construction shortcut or hidden resource.
- **Night Caravan:** Glowtails bring a rare trade opportunity if the city has enough light.

## Simulation philosophy

THRML models structured uncertainty over residents, resources, and events. Torx models parameterized stochastic decision programs for resident behavior and city response.

The simulation must always return explanations alongside outcomes:

- what a resident wanted
- what options were available
- what local conditions changed the decision
- how confident the simulation was

Randomness is seeded and replayable. The player should be able to rewind a short forecast window for debugging and learning.

## Progression

1. **Root Camp:** establish shelter, food, and water.
2. **First Borough:** connect species neighborhoods and open the market.
3. **Civic Trust:** pass the first shared policy and resolve a conflict.
4. **Long Shade:** prepare for the arrival of Cloudmoths and the seasonal crisis.

## UI direction

The playfield stays open and readable. The DOM HUD contains:

- top-left: day, season, and settlement name
- top-center: compact resource strip
- right rail: forecast and event response
- bottom-left: selected resident or building inspector
- bottom-right: pause, speed, and ledger controls

The UI should feel like a field notebook and civic instrument: dark moss panels, warm paper highlights, cyan light accents, and small animated signal marks.

## Art direction

- Top-down 2D with chunky readable silhouettes
- Pixel-informed shapes with modern illustration polish
- Deep blue-green night palette with amber, cyan, lilac, and rust accents
- Soft bioluminescence instead of hard neon
- Buildings should read at 32–64 pixels high
- Residents need distinct silhouettes before facial details
- Wild habitat should feel valuable, not decorative

## Audio direction

Warm percussion, hollow wood, soft reed instruments, tiny glass chimes, and low root-like bass pulses. Music should become denser as the city gains harmony, not simply louder.

## Non-goals for the first build

- No combat system
- No procedural infinite world
- No multiplayer
- No complex taxation or zoning simulation
- No full story campaign
- No direct creature micromanagement

## Success criteria for the first prototype

The prototype succeeds if a player can answer these questions without reading documentation:

1. What does my city need right now?
2. Why did that creature make that choice?
3. What might happen if I build this structure?
4. What tradeoff did my decision create?
5. Did the neighborhood become more alive over five minutes?
