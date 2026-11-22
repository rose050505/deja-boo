import type { MinerConfig } from './types.js';

/**
 * Reserved words that must not be replaced by _ID_ when renameIds is true.
 * Covers the most common keywords across JS/TS, Python, Go, Rust, Java, C/C++.
 */
const RESERVED = new Set([
  // JS / TS
  'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch',
  'class', 'const', 'constructor', 'continue', 'debugger', 'declare', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null',
  'number', 'object', 'of', 'package', 'private', 'protected', 'public', 'readonly',
  'return', 'set', 'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw',
  'true', 'try', 'type', 'typeof', 'undefined', 'unique', 'unknown', 'var', 'void',
  'while', 'with', 'yield',
  // Python
  'and', 'assert', 'del', 'elif', 'except', 'exec', 'global', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'print', 'raise',
  // Go
  'chan', 'defer', 'fallthrough', 'func', 'go', 'goto', 'map', 'range', 'select',
  'struct',
  // Rust
  'crate', 'dyn', 'fn', 'impl', 'mod', 'move', 'mut', 'pub', 'ref', 'self', 'trait',
  'unsafe', 'use', 'where',
  // Java / Kotlin
  'final', 'native', 'strictfp', 'synchronized', 'throws', 'transient', 'volatile',
  'when',
  // C / C++
  'auto', 'explicit', 'extern', 'inline', 'operator', 'register', 'sizeof', 'template',
  'typename', 'union', 'unsigned', 'virtual', 'wchar_t',
]);

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Normalizes a code block to a canonical string for fingerprinting.
 *
 * Pipeline (in order):
 *   1. Strip block comments (`/* *\/`, `<!-- -->`, `{- -}`) across the whole block.
 *   2. For each line: strip single-line comments (`//`, `#`, `--`).
 *   3. Trim leading/trailing whitespace; drop now-empty lines.
 *   4. Collapse internal whitespace runs to a single space.
 *   5. Optionally replace non-reserved identifiers with `_ID_`.
 *   6. Join with `\n`.
 *
 * Callers (parse-diff) are responsible for removing the single-character `-`/`+`
 * diff prefix before passing lines to this function.  normalizeBlock does NOT
 * strip leading `-` or `+` characters — doing so would corrupt real code such as
 * `--count;`, `-1`, or `++i`.
 *
 * Idempotent by construction: every step is idempotent.
 */
export function normalizeBlock(
  lines: string[],
  config: Pick<MinerConfig, 'renameIds'>,
): string {
  // Step 1: remove block comments on the whole joined text (handles multi-line blocks).
  const joined = lines.join('\n');
  const noBlockComments = removeBlockComments(joined);
  const linesSplit = noBlockComments.split('\n');

  const cleaned: string[] = [];
  for (const line of linesSplit) {
    // Step 2: single-line comments.
    const noComment = removeSingleLineComment(line);

    // Step 3: trim; drop empty lines.
    const trimmed = noComment.trim();
    if (trimmed.length > 0) {
      cleaned.push(trimmed);
    }
  }

  // Step 4: collapse internal whitespace runs to a single space.
  const collapsed = cleaned.map(l => l.replace(/\s+/g, ' '));

  // Step 5: optionally replace identifiers with _ID_.
  const renamed = config.renameIds
    ? collapsed.map(l => l.replace(IDENT_RE, token => RESERVED.has(token) ? token : '_ID_'))
    : collapsed;

  // Step 6: join with newline.
  return renamed.join('\n');
}

/** Remove `//…`, `#…`, `--…` from a single line (trailing comment only). */
function removeSingleLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;

    // `//` comment
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    // `#` comment
    if (c === '#') return line.slice(0, i);
    // `--` comment (SQL / Haskell / Lua)
    if (c === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

/**
 * Remove block comments from a multi-line string.
 * Handles: `/* ... *\/`, `<!-- ... -->`, `{- ... -}`.
 * Uses a state machine; never backtracks.
 */
function removeBlockComments(text: string): string {
  type State = 'normal' | 'slash_star' | 'html' | 'haskell';
  let state: State = 'normal';
  let result = '';
  let i = 0;

  while (i < text.length) {
    const c = text[i] as string;

    if (state === 'normal') {
      if (c === '/' && text[i + 1] === '*') {
        state = 'slash_star';
        i += 2;
      } else if (c === '<' && text.startsWith('<!--', i)) {
        state = 'html';
        i += 4;
      } else if (c === '{' && text[i + 1] === '-') {
        state = 'haskell';
        i += 2;
      } else {
        result += c;
        i++;
      }
    } else if (state === 'slash_star') {
      if (c === '*' && text[i + 1] === '/') {
        state = 'normal';
        i += 2;
        result += ' ';
      } else {
        if (c === '\n') result += '\n';
        i++;
      }
    } else if (state === 'html') {
      if (c === '-' && text.startsWith('-->', i)) {
        state = 'normal';
        i += 3;
        result += ' ';
      } else {
        if (c === '\n') result += '\n';
        i++;
      }
    } else {
      // haskell {- ... -}
      if (c === '-' && text[i + 1] === '}') {
        state = 'normal';
        i += 2;
        result += ' ';
      } else {
        if (c === '\n') result += '\n';
        i++;
      }
    }
  }

  return result;
}
