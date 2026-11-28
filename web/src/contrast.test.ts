import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const vars = Object.fromEntries([...css.matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1]!, m[2]!.toLowerCase()]));

function lum(hex: string): number {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('palette contrast (WCAG AA)', () => {
  it('uses the steering palette', () => {
    expect(vars).toMatchObject({ navy: '#0b1020', moss: '#3d5a40', bone: '#e8e2d0', ecto: '#7cffb2', blood: '#c0392b' });
  });
  const text: [string, string][] = [['bone', 'navy'], ['bone', 'panel'], ['mist', 'navy'], ['mist', 'panel'], ['ecto', 'navy'], ['ecto', 'panel'], ['bone', 'moss'], ['navy', 'ecto'], ['navy', 'bone'],
    // Batch G: text over the night sky (header, graveyard backdrop, stamp lines).
    ['bone', 'sky'], ['mist', 'sky'], ['ecto', 'sky'], ['bone', 'skytop'], ['mist', 'skytop'], ['ecto', 'skytop']];
  for (const [fg, bg] of text) {
    it(`text ${fg} on ${bg} >= 4.5:1`, () => expect(ratio(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(4.5));
  }
  // Blood is used for borders and cracks only (graphical objects need 3:1); its words are always bone on navy.
  for (const bg of ['navy', 'panel']) it(`blood edge on ${bg} >= 3:1`, () => expect(ratio(vars['blood']!, vars[bg]!)).toBeGreaterThanOrEqual(3));
  // Batch G: stone shading, ground and the stamp border sit on the sky gradient.
  for (const bg of ['sky', 'skytop']) it(`blood stamp border on ${bg} >= 3:1`, () => expect(ratio(vars['blood']!, vars[bg]!)).toBeGreaterThanOrEqual(3));
  for (const fg of ['bone', 'ecto']) it(`stone edge ${fg} on the lightest stone shade >= 3:1`, () => expect(ratio(vars[fg]!, vars['stonehi']!)).toBeGreaterThanOrEqual(3));
  it('ground and stone base stay darker than the stone top, so the base reads as shade', () => {
    expect(lum(vars['ground']!)).toBeLessThan(lum(vars['stonehi']!));
    expect(lum(vars['stonelo']!)).toBeLessThan(lum(vars['moss']!));
  });
  // Batch H: the drop zone dashed border (mist) and error edge (bone) sit on the panel; the slug field is bone on navy with a bone border.
  it('drop zone border mist on panel >= 3:1', () => expect(ratio(vars['mist']!, vars['panel']!)).toBeGreaterThanOrEqual(3));
  it('slug field text bone on navy >= 4.5:1', () => expect(ratio(vars['bone']!, vars['navy']!)).toBeGreaterThanOrEqual(4.5));
  it('stone edge (bone) on moss >= 3:1', () => expect(ratio(vars['bone']!, vars['moss']!)).toBeGreaterThanOrEqual(3));
  it('every animation sits under no-preference, and reduce turns animations off', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, '');
    expect(outside).not.toMatch(/animation:\s*(?!none)[a-z]/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  });
});
