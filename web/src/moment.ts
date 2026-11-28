export type MomentLevel = 'block' | 'warn';

export interface Stamp {
  word: string;
  line: string;
}

/** Scale of the ghost raised from the first haunted stone, against the normal glyph. */
export const BIG_GHOST_SCALE = 3.5;

const STAMPS: Record<MomentLevel, Stamp> = {
  block: { word: 'BLOCKED', line: 'The Kiro hook would stop this write.' },
  warn: { word: 'WARN', line: 'The Kiro hook would warn about this write.' },
};

/** Stamp text for a result level; null when nothing rose. Invariant: block and warn never share a word; no level, no stamp. */
export const stampFor = (level: MomentLevel | null): Stamp | null => (level === null ? null : STAMPS[level]);

/** Scale of the ghost for hit number `index` (0 = the first, strongest hit). Invariant: only index 0 is large. */
export const ghostScale = (index: number): number => (index === 0 ? BIG_GHOST_SCALE : 1);

/**
 * Class names for the graveyard wrap and the edge tint. Invariant: blood-red tint (`edge-block`) only for a block;
 * `calm` (no motion) appears exactly when reduced motion is on.
 */
export function momentClasses(level: MomentLevel | null, reducedMotion: boolean): { wrap: string[]; edge: string[] } {
  const calm = reducedMotion ? ['calm'] : [];
  return {
    wrap: [...(level === null ? [] : ['hit', `hit-${level}`]), ...calm],
    edge: level === 'block' ? ['edge-block', ...calm] : [],
  };
}
