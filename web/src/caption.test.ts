import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_CAPTION, captionFor } from './graveyard-view.ts';
import { epitaph, GHOST_RISE, layoutStones } from './layout.ts';
import type { WebTombstone } from './data.ts';

const demo = JSON.parse(readFileSync(new URL('../public/graveyards/haunted-http.json', import.meta.url), 'utf8')) as WebTombstone[];

describe('caption and ghost headroom', () => {
  it('captionFor is the epitaph plus path, and differs from the default', () => {
    const t = demo[0]!;
    expect(captionFor(t)).toBe(`${epitaph(t)}${/^revert/i.test(t.causeOfDeath) ? ' (Revert)' : ''} · ${t.path}`);
    expect(captionFor(t)).not.toBe(DEFAULT_CAPTION);
  });
  it('the default caption matches the static HTML', () => {
    expect(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).toContain(DEFAULT_CAPTION);
  });
  it('a one-row graveyard leaves room for a ghost above its stone', () => {
    const l = layoutStones(demo);
    expect(l.rows).toHaveLength(1);
    expect(Math.min(...l.stones.map(s => s.y))).toBeGreaterThanOrEqual(GHOST_RISE);
  });
});
