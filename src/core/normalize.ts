
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

/** What `normalizeBlock` needs: whether to rename identifiers, and the language whose comment syntax applies (unset: every syntax). */
export interface NormalizeConfig {
  renameIds: boolean;
  language?: string | undefined;
}

/** Replace every non-reserved identifier of a normalized line with `_ID_`. Invariant: idempotent. */
export function renameIdentifiers(line: string): string {
  return line.replace(IDENT_RE, token => (RESERVED.has(token) ? token : '_ID_'));
}

/** Comment syntax of one language: line-comment markers, block-comment kinds, and whether quoted text hides comment openers. */
export interface CommentSyntax {
  line: readonly string[];
  block: readonly Exclude<CommentState, 'normal'>[];
  quotes: boolean;
}

const HASH: CommentSyntax = { line: ['#'], block: [], quotes: true };
const C_LIKE: CommentSyntax = { line: ['//'], block: ['slash_star'], quotes: true };
const MARKUP: CommentSyntax = { line: [], block: ['html'], quotes: false };
/** Every marker the miner knew before comment syntax was per language; used when the language is not known. */
const ANY: CommentSyntax = { line: ['//', '#', '--'], block: ['slash_star', 'html', 'haskell'], quotes: true };

const SYNTAX: Record<string, CommentSyntax> = {
  typescript: C_LIKE, javascript: C_LIKE, java: C_LIKE, kotlin: C_LIKE, csharp: C_LIKE, cpp: C_LIKE, c: C_LIKE,
  go: C_LIKE, rust: C_LIKE, swift: C_LIKE,
  php: { line: ['//', '#'], block: ['slash_star'], quotes: true },
  css: { line: [], block: ['slash_star'], quotes: true },
  sql: { line: ['--'], block: ['slash_star'], quotes: true },
  python: HASH, ruby: HASH, shell: HASH, yaml: HASH, toml: HASH,
  html: MARKUP, markdown: MARKUP,
};

/**
 * Comment syntax for a language name from `detectLanguage`: `#` only for Python, Ruby, shell, YAML and TOML; `//` and slash-star blocks for C-like languages; every marker when the language is unknown or unset.
 * Invariant: total; an unknown or undefined language gets the same syntax.
 */
export function commentSyntax(language?: string): CommentSyntax {
  // Own keys only: a language named like an Object.prototype member ("valueOf") must not pick up a function.
  return language !== undefined && Object.hasOwn(SYNTAX, language) ? (SYNTAX[language] as CommentSyntax) : ANY;
}

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
  config: NormalizeConfig,
): string {
  const syntax = commentSyntax(config.language);
  // Step 1: remove block comments on the whole joined text (handles multi-line blocks).
  const joined = lines.join('\n');
  const noBlockComments = removeBlockComments(joined, syntax);
  const linesSplit = noBlockComments.split('\n');

  const cleaned: string[] = [];
  for (const line of linesSplit) {
    // Step 2: single-line comments.
    const noComment = removeSingleLineComment(line, syntax);

    // Step 3: trim; drop empty lines.
    const trimmed = noComment.trim();
    if (trimmed.length > 0) {
      cleaned.push(trimmed);
    }
  }

  // Step 4: collapse internal whitespace runs to a single space.
  const collapsed = cleaned.map(l => l.replace(/\s+/g, ' '));

  // Step 5: optionally replace identifiers with _ID_.
  const renamed = config.renameIds ? collapsed.map(renameIdentifiers) : collapsed;

  // Step 6: join with newline.
  return renamed.join('\n');
}

/** Remove a trailing comment that starts with one of the syntax's line markers; markers inside quotes (when the syntax tracks them) are text. */
function removeSingleLineComment(line: string, syntax: CommentSyntax): string {
  if (syntax.line.length === 0) return line;
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    for (const marker of syntax.line) if (line.startsWith(marker, i)) return line.slice(0, i);
  }
  return line;
}

/** Where a line starts relative to block comments: outside any, or inside `/* *\/`, `<!-- -->` or `{- -}`. */
export type CommentState = 'normal' | 'slash_star' | 'html' | 'haskell';

/**
 * Remove block comments from one line, given the state at its start; returns the text and the state at its end.
 * Uses a state machine; never backtracks. Every opener and closer is within one line, so a multi-line text is this function chained over its lines.
 */
export function stripBlockCommentsLine(line: string, from: CommentState, syntax: CommentSyntax = ANY): { text: string; state: CommentState } {
  let state = from;
  let result = '';
  let quote = '';
  let i = 0;
  const opens = (kind: Exclude<CommentState, 'normal'>): boolean => syntax.block.includes(kind);

  while (i < line.length) {
    const c = line[i] as string;

    if (state === 'normal') {
      if (quote !== '') {
        // Inside a quoted string: copy it, and never open a comment.
        result += c;
        if (c === '\\' && i + 1 < line.length) { result += line[i + 1] as string; i += 2; continue; }
        if (c === quote) quote = '';
        i++;
      } else if (syntax.quotes && (c === "'" || c === '"')) {
        quote = c;
        result += c;
        i++;
      } else if (c === '/' && line[i + 1] === '*' && opens('slash_star')) {
        state = 'slash_star';
        i += 2;
      } else if (c === '<' && line.startsWith('<!--', i) && opens('html')) {
        state = 'html';
        i += 4;
      } else if (c === '{' && line[i + 1] === '-' && opens('haskell')) {
        state = 'haskell';
        i += 2;
      } else {
        result += c;
        i++;
      }
    } else if (state === 'slash_star') {
      if (c === '*' && line[i + 1] === '/') {
        state = 'normal';
        i += 2;
        result += ' ';
      } else {
        i++;
      }
    } else if (state === 'html') {
      if (c === '-' && line.startsWith('-->', i)) {
        state = 'normal';
        i += 3;
        result += ' ';
      } else {
        i++;
      }
    } else {
      // haskell {- ... -}
      if (c === '-' && line[i + 1] === '}') {
        state = 'normal';
        i += 2;
        result += ' ';
      } else {
        i++;
      }
    }
  }

  return { text: result, state };
}

/**
 * Remove block comments from a multi-line string.
 * Handles: `/* ... *\/`, `<!-- ... -->`, `{- ... -}`.
 */
function removeBlockComments(text: string, syntax: CommentSyntax): string {
  let state: CommentState = 'normal';
  return text.split('\n').map(line => {
    const r = stripBlockCommentsLine(line, state, syntax);
    state = r.state;
    return r.text;
  }).join('\n');
}

/**
 * Normalize one line the way `normalizeBlock` does (no identifier renaming), given the comment state at its start.
 * Invariant: chaining it over a block's lines from 'normal' and joining the non-empty results with `\n` equals `normalizeBlock(lines, { renameIds: false, language })`.
 */
export function normalizeLineFrom(line: string, from: CommentState, language?: string): { text: string; state: CommentState } {
  const syntax = commentSyntax(language);
  const r = stripBlockCommentsLine(line, from, syntax);
  return { text: removeSingleLineComment(r.text, syntax).trim().replace(/\s+/g, ' '), state: r.state };
}
