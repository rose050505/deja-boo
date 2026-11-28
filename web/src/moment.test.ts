import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { BIG_GHOST_SCALE, ghostScale, momentClasses, stampFor, type MomentLevel } from './moment.ts';
import { SOUND_KEY, createSound, readSoundPref, soundLabel, type AudioLike, type StorageLike } from './sound.ts';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('stamp', () => {
  it('block says BLOCKED and the hook line', () => {
    expect(stampFor('block')).toEqual({ word: 'BLOCKED', line: 'The Kiro hook would stop this write.' });
  });
  it('warn says WARN and never BLOCK', () => {
    const s = stampFor('warn')!;
    expect(s.word).toBe('WARN');
    expect(s.line).not.toMatch(/block|stop/i);
  });
  it('no hit, no stamp', () => expect(stampFor(null)).toBeNull());
});

describe('ghost size', () => {
  it('only the first hit is large, 3 to 4 times the glyph', () => {
    expect(BIG_GHOST_SCALE).toBeGreaterThanOrEqual(3);
    expect(BIG_GHOST_SCALE).toBeLessThanOrEqual(4);
    expect(ghostScale(0)).toBe(BIG_GHOST_SCALE);
    fc.assert(fc.property(fc.integer({ min: 1, max: 5000 }), i => ghostScale(i) === 1));
  });
});

describe('reduced-motion class switch', () => {
  it('calm appears exactly when reduced motion is on', () => {
    fc.assert(fc.property(fc.constantFrom<MomentLevel | null>('block', 'warn', null), fc.boolean(), (level, reduced) => {
      const c = momentClasses(level, reduced);
      return c.wrap.includes('calm') === reduced && (level === 'block' ? c.edge.includes('calm') === reduced : c.edge.length === 0);
    }));
  });
  it('the red edge belongs to blocks only', () => {
    fc.assert(fc.property(fc.constantFrom<MomentLevel | null>('block', 'warn', null), fc.boolean(), (level, reduced) =>
      momentClasses(level, reduced).edge.includes('edge-block') === (level === 'block')));
  });
  it('the stylesheet stops shake, rise, drift, tint and stamp motion under reduce, and draws final states', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/animation: none !important/);
    expect(reduce).toMatch(/\.edge-block\s*\{[^}]*opacity/);
    // every keyframe set is declared inside the no-preference block
    const noPref = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const name of ['shake', 'ghost-rise', 'drift', 'edge-flash', 'stamp-in', 'crack-flash']) expect(noPref).toContain(`@keyframes ${name}`);
  });
  it('blood red is used for the block stamp and edge only', () => {
    const blocks = css.split('}').filter(b => !/\d%\s*\{/.test(b) && /var\(--blood\)|rgba\(192, ?57, ?43/.test(b));
    for (const b of blocks) expect(b).toMatch(/block|cracked|crack|badge|edge|ghost-card|stamp/);
    expect(css).not.toMatch(/\.warn[^{]*\{[^}]*--blood/);
  });
});

describe('page structure', () => {
  it('has the sound toggle off by default, the stamp host, the edge tint and the evidence slot under the graveyard', () => {
    expect(html).toMatch(/id="sound"[^>]*>Sound: off</);
    expect(html).toContain('id="gy-stamp"');
    expect(html).toContain('id="edge"');
    expect(html.indexOf('id="gy-wrap"')).toBeLessThan(html.indexOf('id="gy-evidence"'));
    expect(html.indexOf('id="gy-evidence"')).toBeLessThan(html.indexOf('id="summon"'));
  });
  it('loads the display font from a local file with font-display: swap and no CDN', () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*\/fonts\/[^}]*font-display:\s*swap/);
    expect(css + html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|cdn\./);
    expect(readFileSync(new URL('../public/fonts/OFL-Cinzel.txt', import.meta.url), 'utf8')).toContain('SIL Open Font License');
  });
});

class MemStore implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
}

function fakeAudio(): { audio: AudioLike; log: { made: number; oscillators: number; started: number } } {
  const log = { made: 0, oscillators: 0, started: 0 };
  const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const audio: AudioLike = {
    currentTime: 0,
    destination: {},
    createOscillator: () => { log.oscillators++; return { type: '', frequency: param, connect() {}, start() { log.started++; }, stop() {} }; },
    createGain: () => ({ gain: param, connect() {} }),
  };
  log.made = 0;
  return { audio, log };
}

describe('sound toggle (Web Audio stubbed)', () => {
  it('is off by default and the label says so', () => {
    const store = new MemStore();
    const { audio } = fakeAudio();
    const s = createSound(store, () => audio);
    expect(s.enabled()).toBe(false);
    expect(soundLabel(s.enabled())).toBe('Sound: off');
    expect(readSoundPref(store)).toBe(false);
  });
  it('plays nothing and creates no audio context before it is turned on', () => {
    const { audio, log } = fakeAudio();
    let made = 0;
    const s = createSound(new MemStore(), () => { made++; return audio; });
    s.play('block');
    s.play('warn');
    expect(made).toBe(0);
    expect(log.oscillators).toBe(0);
  });
  it('turning it on saves the choice, plays a swell and a chime for block, and survives a reload', () => {
    const store = new MemStore();
    const { audio, log } = fakeAudio();
    const s = createSound(store, () => audio);
    expect(s.toggle()).toBe(true);
    expect(store.getItem(SOUND_KEY)).toBe('on');
    s.play('block');
    expect(log.started).toBe(2);
    expect(createSound(store, () => audio).enabled()).toBe(true);
    expect(s.toggle()).toBe(false);
    expect(store.getItem(SOUND_KEY)).toBe('off');
    s.play('warn');
    expect(log.started).toBe(2);
  });
  it('survives missing Web Audio and a broken store', () => {
    const broken: StorageLike = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const s = createSound(broken, () => null);
    expect(s.enabled()).toBe(false);
    expect(s.toggle()).toBe(true);
    expect(() => s.play('block')).not.toThrow();
  });
});
