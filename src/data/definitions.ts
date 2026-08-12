import type {
  BuildingType,
  CollectibleTile,
  DistrictType,
  ItemKey,
  ProposalKind,
  RecipeKey,
  ResourceKey,
  Season,
  Species,
} from "../sim/types";

/**
 * Ticks a depleted wild node takes to regrow, and the season in which it
 * regrows fastest. Regrowth is what turns fieldwork from a one-time strip-mine
 * into a renewable loop.
 */
export const REGROWTH_DEFINITIONS: Record<
  CollectibleTile,
  { ticks: number; favouredSeason: Season; label: string }
> = {
  fern: { ticks: 42, favouredSeason: "mosswake", label: "Fern Patch" },
  mushroom: { ticks: 58, favouredSeason: "emberfall", label: "Ember Mushroom" },
  crystal: { ticks: 76, favouredSeason: "longshade", label: "Moon Crystal" },
  ruin: { ticks: 96, favouredSeason: "suncrest", label: "Root Ruin" },
};

export const MAX_BUILDING_LEVEL = 3;

/**
 * Upgrade cost per target level. Level 2 and 3 multiply a building's output by
 * `OUTPUT_MULTIPLIER[level]`, which is what gives the mid game somewhere to go
 * once the map runs out of good plots.
 */
export const UPGRADE_COSTS: Record<number, { cost: Partial<Record<ResourceKey, number>>; itemCost: Partial<Record<ItemKey, number>>; duration: number }> = {
  2: { cost: { food: 12, warmth: 10 }, itemCost: { "seed-pod": 2 }, duration: 8 },
  3: { cost: { food: 20, warmth: 16, light: 10 }, itemCost: { resin: 2, moonwater: 2 }, duration: 14 },
};

export const OUTPUT_MULTIPLIER: Record<number, number> = { 1: 1, 2: 1.6, 3: 2.3 };

export const RESOURCE_DEFINITIONS: Record<
  ResourceKey,
  { label: string; icon: string; color: string }
> = {
  food: { label: "Food", icon: "✦", color: "#8DBB72" },
  water: { label: "Water", icon: "◈", color: "#63E6D4" },
  warmth: { label: "Warmth", icon: "◉", color: "#E98B50" },
  light: { label: "Light", icon: "✧", color: "#F4B85B" },
};

export const ITEM_DEFINITIONS: Record<
  ItemKey,
  { label: string; icon: string; color: string; description: string }
> = {
  "seed-pod": {
    label: "Seed Pods",
    icon: "●",
    color: "#8DBB72",
    description: "Wild seeds gathered from fern patches.",
  },
  resin: {
    label: "Amber Resin",
    icon: "◆",
    color: "#F4B85B",
    description: "Warm sap that holds a lantern glow.",
  },
  moonwater: {
    label: "Moonwater",
    icon: "◈",
    color: "#63E6D4",
    description: "A cool, bright liquid found in crystal seams.",
  },
  "map-fragment": {
    label: "Map Fragments",
    icon: "▧",
    color: "#C8A9FF",
    description: "Old route notes recovered from root ruins.",
  },
};

export const DISTRICT_DEFINITIONS: Record<
  DistrictType,
  { label: string; icon: string; color: string; description: string; bonus: string }
> = {
  meadow: {
    label: "Fern Meadow",
    icon: "❧",
    color: "#8DBB72",
    description: "Wild growth and Seed Pod routes.",
    bonus: "+1 seed pod from Fern Patches",
  },
  wetland: {
    label: "Reed Wetland",
    icon: "≈",
    color: "#63E6D4",
    description: "Clean water and patient Mireling work.",
    bonus: "+20% Reed Farm water output",
  },
  lantern: {
    label: "Lantern Rise",
    icon: "✧",
    color: "#F4B85B",
    description: "A bright district for Glowtail routes.",
    bonus: "+20% Lantern Grove light output",
  },
  market: {
    label: "Commons Market",
    icon: "◇",
    color: "#C8A9FF",
    description: "Shared space where species mix and trade.",
    bonus: "+3 harmony while focused",
  },
  ruin: {
    label: "Root Ruins",
    icon: "▧",
    color: "#B8A58A",
    description: "Old routes, lost maps, and expedition staging ground.",
    bonus: "-1 expedition day",
  },
};

export const SEASONAL_EVENT_DEFINITIONS: Record<
  Season,
  { id: string; title: string; description: string; effect: "growth" | "festival" | "bloom" | "watch"; tone: "calm" | "bright" | "warning" }
> = {
  mosswake: {
    id: "seedwake-gathering",
    title: "Seedwake Gathering",
    description: "The basin is waking. Wild plots answer careful hands.",
    effect: "growth",
    tone: "calm",
  },
  suncrest: {
    id: "lantern-fair",
    title: "Lantern Fair",
    description: "Long bright evenings pull every species toward the market.",
    effect: "festival",
    tone: "bright",
  },
  emberfall: {
    id: "ember-bloom",
    title: "Ember Bloom",
    description: "Mushrooms flare beneath the roots; warmth is easier to keep.",
    effect: "bloom",
    tone: "bright",
  },
  longshade: {
    id: "longshade-watch",
    title: "Longshade Watch",
    description: "The canopy dims. Every lantern and friendship matters.",
    effect: "watch",
    tone: "warning",
  },
};

export interface RecipeDefinition {
  label: string;
  icon: string;
  description: string;
  cost: Partial<Record<ItemKey, number>>;
  duration: number;
  effect: "light" | "reveal" | "comfort";
}

export const RECIPE_DEFINITIONS: Record<RecipeKey, RecipeDefinition> = {
  "lantern-kit": {
    label: "Glow Kit",
    icon: "✧",
    description: "Charge a public lantern route.",
    cost: { resin: 1, moonwater: 1 },
    duration: 3,
    effect: "light",
  },
  "bridge-kit": {
    label: "Root Bridge",
    icon: "⌁",
    description: "Open an old route beyond the mapped basin.",
    cost: { "map-fragment": 1, "seed-pod": 1 },
    duration: 5,
    effect: "reveal",
  },
  "comfort-kit": {
    label: "Comfort Bundle",
    icon: "♡",
    description: "Share a small warmth with every neighborhood.",
    cost: { "seed-pod": 2, resin: 1 },
    duration: 4,
    effect: "comfort",
  },
};

export const SPECIES_DEFINITIONS: Record<
  Species,
  { label: string; color: string; accent: string; role: string }
> = {
  brambleback: {
    label: "Brambleback",
    color: "#B86B4A",
    accent: "#8DBB72",
    role: "builders and haulers",
  },
  glowtail: {
    label: "Glowtail",
    color: "#7D72D7",
    accent: "#63E6D4",
    role: "traders and explorers",
  },
  mireling: {
    label: "Mireling",
    color: "#5AAEA1",
    accent: "#C8A9FF",
    role: "growers and mediators",
  },
  cloudmoth: {
    label: "Cloudmoth",
    color: "#C8A9FF",
    accent: "#F5E6C8",
    role: "artists and weather-readers",
  },
};

export const PATH_COST = { warmth: 2, food: 1 } as const;

export const PROPOSAL_DEFINITIONS: Record<
  ProposalKind,
  { title: string; body: string; species: Species }
> = {
  "shelter-first": {
    title: "Brambleback Council: Shelter First",
    body: "Raise another burrow before the next harvest. Housing is the only warmth that lasts.",
    species: "brambleback",
  },
  "wetland-first": {
    title: "Mireling Circle: Keep the Reeds Quiet",
    body: "Hold lanterns back from the water. Farms and wetlands need room to breathe.",
    species: "mireling",
  },
  "market-first": {
    title: "Glowtail Caravan: Open the Stalls",
    body: "A second market route would stop the empty shelves from spreading street by street.",
    species: "glowtail",
  },
  "lantern-first": {
    title: "Glowtail Nightwatch: Light the Paths",
    body: "Night work needs lanterns. Without them the traders walk in the dark.",
    species: "glowtail",
  },
  "welcome-moths": {
    title: "Steward's Oath: Welcome the Cloudmoths",
    body: "The Long Shade is coming. Prepare a bright, mixed neighborhood for the moths.",
    species: "cloudmoth",
  },
};

export interface BuildingDefinition {
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  description: string;
  cost: Partial<Record<ResourceKey, number>>;
  itemCost?: Partial<Record<ItemKey, number>>;
}

export const BUILDING_DEFINITIONS: Record<BuildingType, BuildingDefinition> = {
  "root-heart": {
    label: "Mosslight Root",
    shortLabel: "ROOT",
    icon: "✦",
    color: "#63E6D4",
    description: "The living heart of the Commons.",
    cost: {},
  },
  "burrow-home": {
    label: "Burrow Home",
    shortLabel: "HOME",
    icon: "⌂",
    color: "#B86B4A",
    description: "Shelter and warmth for residents.",
    cost: { warmth: 8, food: 2 },
  },
  "reed-farm": {
    label: "Reed Farm",
    shortLabel: "FARM",
    icon: "✿",
    color: "#8DBB72",
    description: "Grows food and filters nearby water.",
    cost: { water: 8, warmth: 3 },
  },
  "lantern-grove": {
    label: "Lantern Grove",
    shortLabel: "LIGHT",
    icon: "✧",
    color: "#F4B85B",
    description: "Creates light and draws Glowtails.",
    cost: { warmth: 6, light: 2 },
  },
  "commons-market": {
    label: "Commons Market",
    shortLabel: "MARKET",
    icon: "◇",
    color: "#9C7BFF",
    description: "Redistributes resources and builds belonging.",
    cost: { food: 8, water: 4, warmth: 5 },
  },
  "root-workshop": {
    label: "Root Workshop",
    shortLabel: "WORKSHOP",
    icon: "⚒",
    color: "#C8A9FF",
    description: "Refines gathered materials into civic craft.",
    cost: { food: 10, water: 6, warmth: 8 },
    itemCost: { resin: 2, "map-fragment": 1 },
  },
};

/** Copy shown by the first-run onboarding walkthrough. */
export const ONBOARDING_STEPS: Array<{ title: string; body: string; hint: string }> = [
  {
    title: "Steward of the Commons",
    body: "The Great Canopy is receding. You arrived with a broken survey map and a seed of Mosslight. Shape conditions. The motes decide the rest.",
    hint: "Click any creature. Their note tells you why they moved.",
  },
  {
    title: "Gather the wild",
    body: "Fern patches, ember mushrooms, moon crystals, and root ruins hold the materials every civic project needs.",
    hint: "Click a wild node on the map to gather it. Nodes regrow with the seasons.",
  },
  {
    title: "Raise what they need",
    body: "Food, water, warmth, and light all drain with population. Buildings are how you keep ahead of that drain.",
    hint: "Pick a tool from the BUILD dock, then click a valid tile to place it.",
  },
  {
    title: "Refine and explore",
    body: "A Root Workshop turns found materials into kits. A Root Bridge opens routes past the mapped basin.",
    hint: "Use the CIVIC TOOLS tab to craft, set a district focus, and dispatch scouts.",
  },
  {
    title: "Watch the forecast",
    body: "The outlook panel reads the settlement's state and names what is coming. Warnings are worth acting on early.",
    hint: "Space pauses, 1/2/4 change speed, and −/+ zoom the map. Have a good season.",
  },
];

export const EVENT_COPY = {
  emptyShelves: {
    title: "Empty Shelves",
    recommendation: "Add a Reed Farm or protect the wild plots.",
    tone: "warning" as const,
  },
  lanternFestival: {
    title: "Lantern Festival",
    recommendation: "Keep the market open and let the neighborhoods mix.",
    tone: "bright" as const,
  },
  reedWarning: {
    title: "Wetland Warning",
    recommendation: "Give the Mirelings clean water and quiet ground.",
    tone: "warning" as const,
  },
  unmappedBurrow: {
    title: "Unmapped Burrow",
    recommendation: "Inspect the new route before building over it.",
    tone: "calm" as const,
  },
  longShade: {
    title: "Long Shade Crossing",
    recommendation: "Keep lanterns lit and welcome the Cloudmoths before the canopy fails.",
    tone: "warning" as const,
  },
};
