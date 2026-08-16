/**
 * The shape of a day and a season.
 *
 * These lived in `simulation.ts`, so a system that needed them either imported
 * the god class — impossible for a system the class itself imports — or
 * redeclared its own copy. `forecast.ts` had done exactly that, and a second
 * literal `7` is a drift waiting to happen.
 */
export const TICKS_PER_DAY = 12;
export const DAYS_PER_SEASON = 7;
