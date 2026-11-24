/**
 * Path skip list shared by the miner and the HEAD scan. Pure and browser-safe.
 *
 * Pattern forms:
 *   - `dir/`        directory prefix at any depth (`*` and `**` allowed inside)
 *   - `name`        exact basename
 *   - anything with `*` or `/`  glob matched against whole path segments
 *     (`*` = within one segment, `**` = any depth, `**` followed by `/` may match zero directories)
 */

/** Default skip patterns: binaries, lockfiles, vendored, built and generated files. */
export const DEFAULT_SKIP_PATTERNS: string[] = [
  // Binary extensions
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico',
  '*.woff', '*.woff2', '*.ttf', '*.eot', '*.pdf',
  '*.zip', '*.tar', '*.gz', '*.bin', '*.exe', '*.dll', '*.so', '*.dylib',
  // Certificates and key bundles
  '*.pem', '*.crt',
  // Lockfiles: any `*.lock`, plus the ones with other extensions (exact basename)
  '*.lock', 'uv.lock', 'bun.lock', 'bun.lockb', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'composer.lock',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'go.sum', 'Pipfile.lock',
  // Vendored dirs (`*/packages/` is the python vendoring layout, e.g. requests/packages)
  'node_modules/', 'vendor/', 'third_party/', 'extern/', 'Pods/', '*/packages/',
  // Build dirs
  'dist/', 'build/', 'out/', '__pycache__/', '.next/', '.nuxt/',
  // Changelogs and history files (auto-generated prose, not logic)
  'CHANGELOG*', 'HISTORY*',
  // Snapshot files
  '*.snap',
  // Generated HTML docs (zero or more directories below docs/)
  'docs/**/*.html',
];

/** Prose documents; skipped by default, opt in with `--include-docs`. */
export const DOC_SKIP_PATTERNS: string[] = ['*.md', '*.rst', '*.txt'];

/**
 * Build the effective skip list.
 * Invariant: defaults are always a prefix of the result unless `defaults` is false; `extra` is always included.
 */
export function resolveSkipPatterns(opts: {
  extra?: string[];
  defaults?: boolean;
  includeDocs?: boolean;
} = {}): string[] {
  const out: string[] = [];
  if (opts.defaults !== false) {
    out.push(...DEFAULT_SKIP_PATTERNS);
    if (!opts.includeDocs) out.push(...DOC_SKIP_PATTERNS);
  }
  out.push(...(opts.extra ?? []));
  return out;
}

function globSource(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if ('.+^${}()|[]\\?'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * True when the path matches any pattern.
 * Invariant: the result depends only on the path and the patterns; an empty list never skips.
 */
export function shouldSkip(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);

  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
      if (new RegExp(`(^|/)${globSource(pattern)}`).test(normalized)) return true;
      continue;
    }
    if (!pattern.includes('/') && !pattern.includes('*')) {
      if (basename === pattern) return true;
      continue;
    }
    if (new RegExp(`(^|/)${globSource(pattern)}(/|$)`).test(normalized)) return true;
  }
  return false;
}

/**
 * Skip decision used by the miner: pattern list plus minified files and source maps.
 * Invariant: an empty pattern list still skips `*.min.*` and `*.map`.
 */
export function isSkippedPath(filePath: string, patterns: string[]): boolean {
  if (shouldSkip(filePath, patterns)) return true;
  const bn = filePath.slice(filePath.lastIndexOf('/') + 1);
  return bn.includes('.min.') || bn.endsWith('.map');
}
