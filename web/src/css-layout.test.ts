import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? '';
};

// vitest has no layout engine, so this checks the CSS text. The real check
// (scrollWidth <= innerWidth at 1920 and 375) was done in headless Chrome.
describe('graveyard scroll containment', () => {
  it('main grid column cannot be stretched by the wide .gy-inner', () => {
    expect(rule('main')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
  it('#gy-scroll scrolls on its own', () => {
    expect(rule('.gy-scroll')).toMatch(/overflow:\s*auto/);
  });
});
