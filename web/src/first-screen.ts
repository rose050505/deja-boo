import type { SiteStats, WebTombstone } from './data.ts';
import { epitaph, isCracked } from './layout.ts';
import { DEMO_REPO, DEMO_STONE_ID } from './demo-snippet.ts';

/**
 * Comebacks a reviewer opened in git and confirmed real. Not in stats.json.
 * Source: research/labels/ and the README line in "Why it matters" ("26 comebacks, 20 confirmed real by a reviewer").
 * A test checks that this number is still the one the README quotes.
 */
export const CONFIRMED_REAL = 20;

export const EVIDENCE = {
  labels: 'https://github.com/rose050505/deja-boo/tree/main/research/labels',
  readme: 'https://github.com/rose050505/deja-boo#why-it-matters',
  setup: 'https://github.com/rose050505/deja-boo#use-it-on-your-repo',
  video: 'https://youtu.be/E0bHgE6uA8I',
} as const;

export interface Headline {
  commits: number;
  /** Comebacks of all mined tombstones; null when stats.json does not carry the number. */
  comebacks: number | null;
  confirmedReal: number;
  viaRevert: number;
}

/** The three headline numbers. Invariant: every field except `confirmedReal` is copied from `stats`, never recomputed or defaulted. */
export function headlineNumbers(stats: SiteStats): Headline {
  return {
    commits: stats.commits,
    comebacks: stats.revivalsAllTombstones ?? null,
    confirmedReal: CONFIRMED_REAL,
    viaRevert: stats.revivalsViaRevert,
  };
}

/** Label shown beside the 2020 Revert stone when requests is open. */
export const REVERT_STONE_LABEL = '2020 Revert \u00B7 Kiro rewrote this in our test';

/** The stone the graveyard opens on, or null. Invariant: only the demo repo has one, and only when its tombstone is listed. */
export function initialStoneId(repoName: string, tombstones: readonly Pick<WebTombstone, 'id'>[]): string | null {
  return repoName === DEMO_REPO && tombstones.some(t => t.id === DEMO_STONE_ID) ? DEMO_STONE_ID : null;
}

/** Tooltip text of a stone: its epitaph, plus a Revert mark. Invariant: begins with the epitaph, so it never adds a cause. */
export function tooltipFor(t: Pick<WebTombstone, 'causeOfDeath' | 'buriedAt'>): string {
  return `${epitaph(t)}${isCracked(t) ? ' (Revert)' : ''}`;
}

export interface Box { left: number; top: number; width: number; height: number }

/**
 * Where to put a tooltip, relative to the wrap: right of the stone, flipped left when it would pass the wrap's right edge, clamped inside.
 * Invariant: the result lies inside [0, wrap.width - tip.width] x [0, wrap.height - tip.height] whenever the tip fits.
 */
export function tipPosition(stone: Box, wrap: Box, tip: { width: number; height: number }): { left: number; top: number } {
  const gap = 8;
  let left = stone.left - wrap.left + stone.width + gap;
  if (left + tip.width > wrap.width) left = stone.left - wrap.left - gap - tip.width;
  const top = stone.top - wrap.top;
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(v, max));
  return { left: clamp(left, wrap.width - tip.width), top: clamp(top, wrap.height - tip.height) };
}
