import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { CONFIRMED_REAL, centerInView, headlineNumbers, initialStoneId, tipPosition, tooltipFor } from './first-screen.ts';
import { DEMO_STONE_ID } from './demo-snippet.ts';
import { epitaph } from './layout.ts';
import type { SiteStats, WebTombstone } from './data.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
const stats = JSON.parse(read('../public/stats.json')) as SiteStats;
const requests = JSON.parse(read('../public/graveyards/requests.json')) as WebTombstone[];
const readme = read('../../README.md');

describe('headline numbers', () => {
  it('come from stats.json', () => {
    const n = headlineNumbers(stats);
    expect(n.commits).toBe(stats.commits);
    expect(n.comebacks).toBe(stats.revivalsAllTombstones);
    expect(n.viaRevert).toBe(stats.revivalsViaRevert);
    expect(n.confirmedReal).toBe(CONFIRMED_REAL);
  });
  it('match the README "Why it matters" line', () => {
    const n = headlineNumbers(stats);
    expect(readme).toContain(`${n.comebacks} comebacks, ${CONFIRMED_REAL} confirmed real by a reviewer`);
    expect(readme).toContain(`all ${n.viaRevert} via Revert are real`);
    expect(readme).toContain(`${n.commits.toLocaleString('en-US')} commits`);
  });
  it('never invents a comeback count', () => {
    const { revivalsAllTombstones: _drop, ...rest } = stats;
    expect(headlineNumbers(rest as SiteStats).comebacks).toBeNull();
  });
  it('the index page shows the hero text, the judges strip and the collapsed block', () => {
    const html = read('../index.html');
    expect(html).toContain('Paste what Kiro wrote (real requests history)');
    expect(html).toMatch(/<details[^>]*id="how-counted"(?![^>]*\sopen)/);
    expect(html).toContain('Pick a sample graveyard, or open your own above');
    expect(html).toContain('never uploaded');
  });
});

describe('initial scroll target', () => {
  it('requests opens on the 2020 Revert stone', () => {
    expect(initialStoneId('requests', requests)).toBe(DEMO_STONE_ID);
    expect(requests.find(t => t.id === DEMO_STONE_ID)?.buriedAt.startsWith('2020-02-18')).toBe(true);
  });
  it('other repos open as before', () => {
    for (const r of ['express', 'axios', 'flask', 'got', 'httpie-cli', 'haunted-http']) expect(initialStoneId(r, requests)).toBeNull();
  });
  it('a requests graveyard without that stone has no target', () => {
    expect(initialStoneId('requests', requests.filter(t => t.id !== DEMO_STONE_ID))).toBeNull();
  });
});

describe('tooltip', () => {
  it('shows the epitaph, with a Revert mark on the cracked stone', () => {
    const t = requests.find(x => x.id === DEMO_STONE_ID)!;
    expect(tooltipFor(t)).toBe(`${epitaph(t)} (Revert)`);
    expect(tooltipFor(t)).toBe('Revert "Use urllib for chunked requests" \u00B7 2020-02-18 (Revert)');
  });
  it('an empty cause says it is unknown', () => {
    expect(tooltipFor({ causeOfDeath: '', buriedAt: '2021-05-04T00:00:00Z' })).toBe('cause of death unknown \u00B7 2021-05-04');
  });
  it('tipPosition stays inside the wrap when the tip fits', () => {
    const n = fc.integer({ min: 0, max: 3000 });
    fc.assert(fc.property(n, n, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 80 }), (x, y, w, h) => {
      const wrap = { left: 100, top: 50, width: 900, height: 500 };
      const tip = { width: 280, height: 40 };
      const p = tipPosition({ left: 100 + (x % 900), top: 50 + (y % 500), width: w, height: h }, wrap, tip);
      return p.left >= 0 && p.top >= 0 && p.left + tip.width <= wrap.width && p.top + tip.height <= wrap.height;
    }));
  });
  it('tipPosition flips left of a stone near the right edge', () => {
    const p = tipPosition({ left: 880, top: 100, width: 20, height: 40 }, { left: 0, top: 0, width: 900, height: 500 }, { width: 200, height: 30 });
    expect(p.left).toBeLessThan(880);
  });
});

describe('centerInView', () => {
  const dim = fc.integer({ min: 300, max: 2000 });
  it('a box that fits ends up fully inside the visible part (right of the labels) after scrolling', () => {
    fc.assert(fc.property(dim, fc.integer({ min: 300, max: 1000 }), fc.integer({ min: 40, max: 160 }), fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 20, max: 200 }), fc.integer({ min: 20, max: 200 }), (cw, ch, lw, x, y, w, hgt) => {
      const view = cw - lw;
      fc.pre(w <= view && hgt <= ch);
      const { left, top } = centerInView({ left: x, right: x + w, top: y, bottom: y + hgt }, cw, ch, lw);
      if (x + w / 2 - view / 2 >= 0) { expect(x - left).toBeGreaterThanOrEqual(-1e-9); expect(x + w - left).toBeLessThanOrEqual(view + 1e-9); }
      if (y + hgt / 2 - ch / 2 >= 0) { expect(y - top).toBeGreaterThanOrEqual(-1e-9); expect(y + hgt - top).toBeLessThanOrEqual(ch + 1e-9); }
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
    }));
  });
  it('centres: 1280 px wide area with 150 px labels, box 400..500 -> centre of the visible part', () => {
    expect(centerInView({ left: 1000, right: 1100, top: 100, bottom: 200 }, 880, 400, 150)).toEqual({ left: 1050 - 365, top: 0 });
  });
  it('a box wider than the view shows its left edge', () => {
    expect(centerInView({ left: 500, right: 2000, top: 0, bottom: 10 }, 600, 400, 100).left).toBe(500);
  });
  it('narrowing the area moves the target: the old width gives a different scrollLeft', () => {
    const box = { left: 900, right: 1000, top: 0, bottom: 100 };
    expect(centerInView(box, 1000, 500, 150).left).not.toBe(centerInView(box, 700, 500, 150).left);
  });
});
