import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeBlock } from './normalize.js';

const cfgOn = { renameIds: true };
const cfgOff = { renameIds: false };

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('normalizeBlock – unit', () => {
  it('drops comment-only lines', () => {
    const result = normalizeBlock(['// only a comment', '# another comment'], cfgOff);
    expect(result).toBe('');
  });

  it('drops blank lines', () => {
    const result = normalizeBlock(['   ', '\t', 'real code'], cfgOff);
    expect(result).toBe('real code');
  });

  it('strips leading/trailing whitespace from lines', () => {
    expect(normalizeBlock(['  hello world  '], cfgOff)).toBe('hello world');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeBlock(['a   b   c'], cfgOff)).toBe('a b c');
  });

  it('strips the leading diff prefix (-/+)', () => {
    expect(normalizeBlock(['-removed line'], cfgOff)).toBe('removed line');
    expect(normalizeBlock(['+added line'], cfgOff)).toBe('added line');
  });

  it('removes /* … */ block comments', () => {
    const result = normalizeBlock(['int x = /* magic */ 42;'], cfgOff);
    expect(result).toBe('int x = 42;');
  });

  it('removes multi-line /* … */ comments', () => {
    const result = normalizeBlock(['/* start', '   middle', '   end */', 'code'], cfgOff);
    expect(result).toBe('code');
  });

  it('removes <!-- … --> comments', () => {
    expect(normalizeBlock(['<div <!-- comment --> >'], cfgOff)).toBe('<div >');
  });

  it('removes {- … -} comments', () => {
    expect(normalizeBlock(['{- haskell comment -}', 'code'], cfgOff)).toBe('code');
  });

  it('with renameIds: false, different names produce different output', () => {
    const a = normalizeBlock(['let foo = bar + 1'], cfgOff);
    const b = normalizeBlock(['let baz = qux + 1'], cfgOff);
    expect(a).not.toBe(b);
  });

  it('with renameIds: true, blocks differing only in identifier names are equal', () => {
    const a = normalizeBlock(['let foo = bar + 1'], cfgOn);
    const b = normalizeBlock(['let baz = qux + 1'], cfgOn);
    expect(a).toBe(b);
  });

  it('with renameIds: true, keywords are preserved', () => {
    const result = normalizeBlock(['if (true) { return null; }'], cfgOn);
    expect(result).toContain('if');
    expect(result).toContain('true');
    expect(result).toContain('return');
    expect(result).toContain('null');
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

describe('normalizeBlock – property tests', () => {
  it('Property 1: idempotency – normalize(normalize(x)) === normalize(x)', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), lines => {
        const once = normalizeBlock(lines, cfgOff);
        const twice = normalizeBlock(once.split('\n'), cfgOff);
        return once === twice;
      }),
      { numRuns: 500 },
    );
  });

  it('Property 1 (renameIds: true): idempotency holds', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), lines => {
        const once = normalizeBlock(lines, cfgOn);
        const twice = normalizeBlock(once.split('\n'), cfgOn);
        return once === twice;
      }),
      { numRuns: 500 },
    );
  });

  it('Property 2: whitespace invariance – leading/trailing spaces do not change output', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }).filter(s => s.trim().length > 0)),
        lines => {
          const padded = lines.map(l => `   ${l}   `);
          return normalizeBlock(lines, cfgOff) === normalizeBlock(padded, cfgOff);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('Property 3: comment-only invariance – only-comment block equals empty block', () => {
    fc.assert(
      fc.property(
        // Generate identifiers to use as comment content (avoids newlines / special chars).
        fc.array(fc.hexaString({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
        words => {
          const commentLines = words.map(w => `// ${w}`);
          return normalizeBlock(commentLines, cfgOff) === normalizeBlock([], cfgOff);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 4: renameIds symmetry – blocks differing only in identifier names normalize equally', () => {
    // Use lowercase alphabetic names that are not reserved in any language.
    // The RESERVED set in normalize.ts covers common keywords; we filter them out.
    const reservedInTest = new Set([
      'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch',
      'class', 'const', 'continue', 'debugger', 'declare', 'default', 'delete', 'do',
      'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
      'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
      'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'object',
      'of', 'package', 'private', 'protected', 'public', 'readonly', 'return', 'set',
      'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try',
      'type', 'typeof', 'undefined', 'unique', 'unknown', 'var', 'void', 'while', 'with',
      'yield', 'and', 'assert', 'del', 'elif', 'except', 'exec', 'global', 'is', 'lambda',
      'nonlocal', 'not', 'or', 'pass', 'print', 'raise', 'chan', 'defer', 'fallthrough',
      'func', 'go', 'goto', 'map', 'range', 'select', 'struct', 'crate', 'dyn', 'fn',
      'impl', 'mod', 'move', 'mut', 'pub', 'ref', 'self', 'trait', 'unsafe', 'use',
      'where', 'final', 'native', 'strictfp', 'synchronized', 'throws', 'transient',
      'volatile', 'when', 'auto', 'explicit', 'extern', 'inline', 'operator', 'register',
      'sizeof', 'template', 'typename', 'union', 'unsigned', 'virtual',
    ]);
    const identArb = fc
      .stringMatching(/^[a-z][a-z]{3,9}$/)
      .filter(s => !reservedInTest.has(s));
    fc.assert(
      fc.property(
        fc.array(identArb, { minLength: 1, maxLength: 6 }),
        fc.array(identArb, { minLength: 1, maxLength: 6 }),
        (names1, names2) => {
          const len = Math.min(names1.length, names2.length);
          const linesA = names1.slice(0, len).map(n => `let ${n} = 1`);
          const linesB = names2.slice(0, len).map(n => `let ${n} = 1`);
          return normalizeBlock(linesA, cfgOn) === normalizeBlock(linesB, cfgOn);
        },
      ),
      { numRuns: 300 },
    );
  });
});
