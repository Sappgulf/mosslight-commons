import type { FactionKind } from "../sim/types";

/**
 * Procedurally drawn faction emblems.
 *
 * Every bloc needs a mark, and there is no painted art for one. These are
 * generated instead: a deterministic function of the faction's own emblem seed,
 * so the same bloc draws the same sigil every time it is rendered, in this
 * session and in a reloaded save, while two blocs are reliably distinct.
 *
 * Unlike the placeholder resident frames, this is not standing in for anything.
 * A geometric sigil is what a bloc's mark should be, and hand-drawn art would
 * not obviously improve it.
 */

/** Palette per bloc kind: civic teal, cult violet, lone amber. */
const PALETTE: Record<FactionKind, { stroke: string; fill: string }> = {
  faction: { stroke: "#63e6d4", fill: "rgba(99, 230, 212, 0.16)" },
  cult: { stroke: "#c8a9ff", fill: "rgba(200, 169, 255, 0.16)" },
  lone: { stroke: "#f4b85b", fill: "rgba(244, 184, 91, 0.14)" },
};

/** A tiny deterministic generator so one seed yields a whole sigil. */
function stream(seed: number): () => number {
  let value = (seed || 1) >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** Points of a regular polygon, optionally starred by pulling alternate points in. */
function polygon(sides: number, radius: number, inner: number | null, rotate: number): string {
  const points: string[] = [];
  const total = inner === null ? sides : sides * 2;
  for (let index = 0; index < total; index += 1) {
    const isInner = inner !== null && index % 2 === 1;
    const r = isInner ? inner : radius;
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2 + rotate;
    points.push(`${(32 + Math.cos(angle) * r).toFixed(2)},${(32 + Math.sin(angle) * r).toFixed(2)}`);
  }
  return points.join(" ");
}

/**
 * Builds an SVG sigil for a bloc. 64×64 viewBox, sized by CSS.
 *
 * The shape family is chosen by kind so the three read apart at a glance —
 * factions get a solid civic polygon, cults a star, lone wolves an open broken
 * ring — and the seed decides the specifics.
 */
export function emblemSvg(seed: number, kind: FactionKind): string {
  const next = stream(seed);
  const { stroke, fill } = PALETTE[kind];
  const rotate = next() * Math.PI;
  const sides = 3 + Math.floor(next() * 4);

  const parts: string[] = [];

  if (kind === "cult") {
    parts.push(
      `<polygon points="${polygon(sides + 2, 26, 11 + next() * 6, rotate)}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`,
    );
    parts.push(`<circle cx="32" cy="32" r="${(4 + next() * 3).toFixed(1)}" fill="${stroke}"/>`);
  } else if (kind === "lone") {
    // An open ring: deliberately unclosed.
    const gap = 40 + next() * 60;
    parts.push(
      `<circle cx="32" cy="32" r="22" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${(138 - gap).toFixed(0)} ${gap.toFixed(0)}" transform="rotate(${(rotate * 57).toFixed(0)} 32 32)"/>`,
    );
    parts.push(`<line x1="32" y1="14" x2="32" y2="50" stroke="${stroke}" stroke-width="1.4" opacity="0.5"/>`);
  } else {
    parts.push(
      `<polygon points="${polygon(sides + 2, 24, null, rotate)}" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/>`,
    );
    const bars = 1 + Math.floor(next() * 3);
    for (let index = 0; index < bars; index += 1) {
      const y = 26 + index * 6;
      parts.push(`<line x1="22" y1="${y}" x2="42" y2="${y}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>`);
    }
  }

  // A ring of marks, one per point, so no two seeds look alike at a glance.
  const marks = 3 + Math.floor(next() * 5);
  for (let index = 0; index < marks; index += 1) {
    const angle = (Math.PI * 2 * index) / marks + rotate;
    const x = 32 + Math.cos(angle) * 28;
    const y = 32 + Math.sin(angle) * 28;
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.5" fill="${stroke}" opacity="0.75"/>`);
  }

  return `<svg viewBox="0 0 64 64" role="img" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}
