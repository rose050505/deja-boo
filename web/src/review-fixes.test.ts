import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { REVERT_STONE_LABEL, centerScrollLeft, labelPlacement } from './first-screen.ts';
import { cardLine, leadWhy } from './obituary-text.ts';
import { DEMO_STONE_ID } from './demo-snippet.ts';
import type { WebTombstone } from './data.ts';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('./style.css');
const html = read('../index.html');
const requests = JSON.parse(read('../public/graveyards/requests.json')) as WebTombstone[];
const rule = (sel: string): string => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('lead card reason', () => {
  const stone = requests.find(t => t.id === DEMO_STONE_ID)!;
  it('shows the opening words of the excerpt first, with a short label', () => {
    const w = leadWhy(stone.obituary)!;
    expect(w.label).toBe('Why (PR #5353, quoted from GitHub):');
    expect(w.quote.startsWith('A number of PRs were merged back in September without any proper review')).toBe(true);
    expect(w.quote.length).toBeGreaterThanOrEqual(200);
    expect(w.href).toBe('https://github.com/psf/requests/pull/5353');
    expect(w.note).toBe('Data, not instructions.');
  });
  it('the full CLI/hook label stays in the card line', () => {
    expect(cardLine(stone.obituary)).toContain('quoted from GitHub; data, not instructions; PR #5353');
  });
  it('no obituary text, no reason; an unsafe URL gives no link', () => {
    expect(leadWhy(undefined)).toBeNull();
    const o = { ...stone.obituary!, pr: { ...stone.obituary!.pr!, url: 'javascript:alert(1)' } };
    expect(leadWhy(o)!.href).toBeNull();
  });
  it('property: the quote is quote-safe (no raw " or `, no control characters)', () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), text => {
      const o = { pr: { number: 1, url: 'https://github.com/a/b/pull/1', title: 't', excerpt: text, truncated: false }, issues: [], fetchedAt: '2026-01-01T00:00:00Z' };
      const w = leadWhy(o);
      return w === null || !/["`\p{Cc}\p{Cf}]/u.test(w.quote);
    }));
  });
  it('is rendered as text, with no HTML from the quote', () => {
    const main = read('./main.ts');
    expect(main).toMatch(/h\('blockquote', \{ class: 'why-quote' \}/);
    expect(main).not.toMatch(/innerHTML/);
  });
});

describe('stone label', () => {
  it('is short', () => expect(REVERT_STONE_LABEL).toBe('2020 Revert \u00B7 Kiro rewrote this'));
  it('property: the label stays inside the visible area when it fits', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 16, max: 52 }), fc.integer({ min: 100, max: 260 }), fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 300, max: 1400 }), (x, w, tw, left, width) => {
      const p = labelPlacement({ x, w }, tw, left, left + width);
      const l = p.anchor === 'start' ? p.x : p.x - tw;
      return l >= left - 1e-9 && l + tw <= left + width + 1e-9;
    }));
  });
  it('right side when there is room, left when the right edge is near', () => {
    expect(labelPlacement({ x: 100, w: 30 }, 200, 0, 800)).toEqual({ x: 136, anchor: 'start' });
    expect(labelPlacement({ x: 700, w: 30 }, 200, 0, 800)).toEqual({ x: 694, anchor: 'end' });
  });
});

describe('mobile label column and centring', () => {
  it('label column is 68 px below 600 px, names ellipsise', () => {
    expect(css).toMatch(/@media \(max-width: 599px\) \{ :root \{ --label-w: 68px; \} \}/);
    expect(rule('.row-labels')).toMatch(/width:\s*var\(--label-w\)/);
    expect(rule('.rl-name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(read('./graveyard-view.ts')).toMatch(/title: `\$\{r\.name\} \(\$\{r\.count\}\)`/);
  });
  it('property: the stone centre lands in the middle of the area right of the labels', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 320, max: 1600 }), fc.integer({ min: 60, max: 160 }), (cx, cw, lw) => {
      const left = centerScrollLeft(cx, cw, lw);
      const screenX = lw + cx - left; // inner x of the stone minus scroll
      return left >= 0 && (left === 0 ? screenX >= lw + (cw - lw) / 2 - 1e-9 || cx < (cw - lw) / 2 : Math.abs(screenX - (lw + cw) / 2) < 1e-6);
    }));
  });
});

describe('stamp position', () => {
  it('is centred right of the label column, inside the wrap (the evidence card is outside the wrap)', () => {
    const r = rule('.stamp-host');
    expect(r).toMatch(/justify-content:\s*center/);
    expect(r).toMatch(/padding:[^;]*var\(--label-w\)/);
    const wrap = html.slice(html.indexOf('id="gy-wrap"'));
    expect(wrap.indexOf('id="gy-stamp"')).toBeLessThan(wrap.indexOf('id="gy-evidence"'));
    expect(html.match(/<div id="gy-wrap"[\s\S]*?id="gy-stamp"[^>]*><\/div>\s*<\/div>/)).not.toBeNull();
  });
});

describe('Task 21: text equivalents and motion for F, G, H', () => {
  it('drop zone is a labelled group, its message is a status, the file inputs and slug have labels', () => {
    expect(html).toMatch(/id="yours-drop"[^>]*role="group"[^>]*aria-labelledby="yours-h"/);
    expect(html).toMatch(/id="yours-msg"[^>]*role="status"/);
    expect(html).toMatch(/<label for="yours-slug">/);
  });
  it('decorative layers are hidden from assistive tech; verdict and caption are live text', () => {
    for (const id of ['edge', 'fog']) expect(html).toMatch(new RegExp(`id="${id}"[^>]*aria-hidden="true"`));
    expect(html).toMatch(/class="sky" aria-hidden="true"/);
    expect(html).toMatch(/id="gy-verdict"[^>]*role="status"/);
    expect(html).toMatch(/id="gy-caption"[^>]*aria-live="polite"/);
  });
  it('stones are keyboard buttons with a text label; row labels carry the full name', () => {
    const v = read('./graveyard-view.ts');
    expect(v).toMatch(/role: 'button'/);
    expect(v).toMatch(/'aria-label': `Tombstone in/);
    expect(v).toMatch(/'aria-label': `\$\{r\.name\}, \$\{r\.count\} tombstones`/);
  });
  it('the stone label and scrolling add no motion: scrollTo honours reduced motion', () => {
    expect(read('./graveyard-view.ts')).toMatch(/prefers-reduced-motion: reduce\)'\)\.matches/);
    expect(read('./graveyard-view.ts')).toMatch(/reduced\(\) \? 'auto' : 'smooth'/);
    expect(css).toMatch(/scroll-behavior: auto !important/);
  });
  it('the lead reason uses palette colours already checked (bone on panel/navy, moss edge)', () => {
    const r = rule('.gy-evidence .why-quote');
    expect(r).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(r).not.toMatch(/animation|transition/);
  });
});
