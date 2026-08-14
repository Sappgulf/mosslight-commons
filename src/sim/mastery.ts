import type { Resident, SkillKey, Species } from "./types";

/**
 * How good someone is at the thing they do.
 *
 * Skills already grew with work, but nothing ever said so: a resident who had
 * spent forty days on the reeds looked and read exactly like one who arrived
 * yesterday. Mastery gives that growth a name, a visible mark, and an effect
 * the settlement can feel.
 */
export interface MasteryTier {
  /** Index, 0 = untrained. Compared against a resident's announced tier. */
  readonly rank: number;
  readonly threshold: number;
  readonly label: string;
  /** Short mark drawn beside the resident on the board. */
  readonly mark: string;
  /** Multiplier this tier contributes to the work they do. */
  readonly output: number;
}

export const MASTERY_TIERS: readonly MasteryTier[] = [
  { rank: 0, threshold: 0, label: "Untrained", mark: "", output: 0.9 },
  { rank: 1, threshold: 22, label: "Hand", mark: "·", output: 1 },
  { rank: 2, threshold: 44, label: "Keeper", mark: "∴", output: 1.15 },
  { rank: 3, threshold: 68, label: "Adept", mark: "✦", output: 1.32 },
  { rank: 4, threshold: 88, label: "Master", mark: "✶", output: 1.55 },
];

const CRAFT_NAMES: Record<SkillKey, string> = {
  farming: "the Reeds",
  crafting: "the Workshop",
  scouting: "the Far Paths",
};

export const SKILL_KEYS: readonly SkillKey[] = ["farming", "crafting", "scouting"];

/** The tier a given skill level sits in. */
export function tierFor(level: number): MasteryTier {
  let found = MASTERY_TIERS[0]!;
  for (const tier of MASTERY_TIERS) {
    if (level >= tier.threshold) found = tier;
  }
  return found;
}

/** The craft a resident is best at, and how far along they are. */
export function bestCraft(resident: Resident): { skill: SkillKey; level: number; tier: MasteryTier } {
  let skill: SkillKey = "farming";
  for (const candidate of SKILL_KEYS) {
    if (resident.skills[candidate] > resident.skills[skill]) skill = candidate;
  }
  const level = resident.skills[skill];
  return { skill, level, tier: tierFor(level) };
}

/** "Master of the Reeds", or an empty string for the untrained. */
export function masteryTitle(resident: Resident): string {
  const { skill, tier } = bestCraft(resident);
  if (tier.rank === 0) return "";
  return `${tier.label} of ${CRAFT_NAMES[skill]}`;
}

/** The mark shown beside a resident on the board. */
export function masteryMark(resident: Resident): string {
  return bestCraft(resident).tier.mark;
}

/**
 * Skills a newborn starts with.
 *
 * Children used to begin at a flat 2 in everything, so a settlement a hundred
 * days old produced exactly the same beginners as one on its first morning and
 * nothing accumulated across generations. A child now inherits a quarter of
 * what their parent knows, which is what makes a long-lived Commons visibly
 * better at its work than a young one.
 */
export function inheritedSkills(parent: Resident): Resident["skills"] {
  const inherit = (level: number) => Math.round(Math.min(30, 2 + level * 0.25));
  return {
    farming: inherit(parent.skills.farming),
    crafting: inherit(parent.skills.crafting),
    scouting: inherit(parent.skills.scouting),
  };
}

/** Species have a leaning, which shows up as a small edge in one craft. */
export function speciesAffinity(species: Species): SkillKey {
  switch (species) {
    case "mireling": return "farming";
    case "brambleback": return "crafting";
    default: return "scouting";
  }
}
