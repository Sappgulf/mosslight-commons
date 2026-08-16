/**
 * The dimensions of the basin.
 *
 * These lived in `simulation.ts`, which meant any system wanting to know how
 * wide the board is had to import the god class — and a system the god class
 * itself imports cannot do that without a cycle. They have no dependencies of
 * their own, so they live here and everything else, `simulation.ts` included,
 * reads them from one place.
 */
export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 24;
