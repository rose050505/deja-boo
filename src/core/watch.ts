import type { Graveyard, RevenantHit, Thresholds, Tombstone, WindowedMatch } from './types.js';
import { containment, fingerprintLines, similarity } from './match.js';
import { kgramHashSet } from './fingerprint.js';
import { normalizeBlock } from './normalize.js';
import { DEFAULT_MINER_CONFIG, DEFAULT_MIN_HASHES } from './types.js';
import { hauntLevel } from './level.js';
import { CandidateWindows, sharedNeeded, type WindowIndex } from './windows.js';

/** Minimum rise in similarity, versus the file on disk, for a tombstone that already scored at or above warn to count as made worse. */
export const WORSE_BY = 0.1;

/**
 * Indices of `b` that belong to a longest common subsequence with `a` (Myers O(ND) diff).
 * Invariant: the result has exactly LCS(a, b) entries.
 */
function matchedInB(a: string[], b: string[]): Set<number> {
  const matched = new Set<number>();
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) matched.add(lo++);
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) matched.add(--eb), ea--;

  const N = ea - lo;
  const M = eb - lo;
  if (N === 0 || M === 0) return matched;

  const max = N + M;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))) x = v[off + k + 1] as number;
      else x = (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < N && y < M && a[lo + x] === b[lo + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) found = d;
    }
    trace.push(v.slice(off - d, off + d + 1));
  }

  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1] as Int32Array;
    const at = (k: number): number => prev[k + d - 1] as number;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { matched.add(lo + y - 1); x--; y--; }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { matched.add(lo + y - 1); x--; y--; }
  return matched;
}

/**
 * 1-based line numbers of `after` that a line diff against `before` marks as inserted or replaced; trimmed lines are compared.
 * Invariant: addedLineNumbers(x, x) is empty; inserting k non-blank lines that are not whitespace variants of existing lines marks exactly those k lines.
 */
export function addedLineNumbers(before: string, after: string): Set<number> {
  const a = before === '' ? [] : before.split('\n').map(l => l.trim());
  const rawAfter = after === '' ? [] : after.split('\n');
  const b = rawAfter.map(l => l.trim());
  const matched = matchedInB(a, b);
  const added = new Set<number>();
  for (let i = 0; i < b.length; i++) if (!matched.has(i)) added.add(i + 1);
  return added;
}

/** Ids named by `deja-boo: checked <40 hex>` in `content`. Invariant: includes every id appended in that form. */
export function acknowledgedIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const m of content.matchAll(/deja-boo: checked ([0-9a-f]{40})/g)) ids.add(m[1] as string);
  return ids;
}

export type { WindowIndex } from './windows.js';

const candidates = new WeakMap<Map<number, WindowIndex>, CandidateWindows>();

/** How candidate windows are normalized: the comment syntax of `language`, and identifiers renamed when `renameIds`. A cache map must always be used with the same options. */
export interface WindowOptions {
  language?: string | undefined;
  renameIds?: boolean;
}

/**
 * `matchWindowed(t, candidate)` computed from per-line precomputed k-gram hashes (see windows.ts). Only windows that contain a k-gram of the tombstone
 * are fingerprinted, because every other window has Jaccard 0 and can never beat the "no match" result.
 * With `minSimilarity` > 0, windows that cannot reach it are skipped.
 * `options` must match the normalization of `t.fingerprint` (its language; renameIds for an identifier-renamed fingerprint).
 * Invariant: equals matchWindowed(t, candidate, { ...DEFAULT_MINER_CONFIG, ...options }) for every input when minSimilarity is 0; for any minSimilarity it returns the same
 * match whenever matchWindowed's similarity is >= minSimilarity, and a similarity below minSimilarity otherwise.
 */
export function matchWindowedIndexed(
  t: Pick<Tombstone, 'lines' | 'fingerprint'>,
  candidate: string[],
  cache: Map<number, WindowIndex>,
  minSimilarity = 0,
  options: WindowOptions = {},
): WindowedMatch {
  const none: WindowedMatch = { similarity: 0, matchedLines: [0, 0], containment: 0 };
  const size = t.lines.length;
  if (size === 0 || candidate.length === 0 || t.fingerprint.length === 0) return none;
  const width = Math.min(size, candidate.length);
  let cw = candidates.get(cache);
  if (!cw || cw.lines !== candidate) {
    cache.clear();
    candidates.set(cache, (cw = new CandidateWindows(candidate, options)));
  }
  let index = cache.get(width);
  if (!index) cache.set(width, (index = { fps: new Map() }));
  let best = none;
  let bestSim = 0;
  for (const start of cw.candidateStarts(t.fingerprint, width, index, minSimilarity)) {
    const fp = cw.fingerprint(start, width, index);
    const sim = similarity(t.fingerprint, fp);
    if (sim > bestSim) {
      bestSim = sim;
      best = { similarity: sim, matchedLines: [start + 1, start + width], containment: containment(t.fingerprint, fp) };
    }
  }
  return best;
}

/**
 * Whether a text has a block-comment opener (`/*`, `<!--`, `{-`). Without openers, a window normalizes to a contiguous run of the text's normalized lines, so
 * every window k-gram is a k-gram of the whole text (`CandidateWindows.plainGrams`) and can serve as a prefilter. With openers, a window can start inside a comment, so no prefilter is used.
 */
function hasCommentOpener(candidate: string[]): boolean {
  const raw = candidate.join('\n');
  return raw.includes('/*') || raw.includes('<!--') || raw.includes('{-');
}

function sharedCount(fingerprint: number[], grams: ReadonlySet<number>): number {
  let n = 0;
  for (const h of fingerprint) if (grams.has(h)) n++;
  return n;
}

/** Minimum share of a tombstone's distinct hashes that a write must bring back for the one-line-difference rule. */
export const RECOVERY_SHARE = 0.5;

/**
 * Fingerprint hashes of `tombstone` absent from the k-gram hash set of `beforeText` (distinct), and how many of those the k-gram hash set of `afterText` contains (recovered).
 * Invariant: recovered <= distinct, and recovered is 0 when afterText equals beforeText.
 */
export function distinctRecovery(tombstone: Pick<Tombstone, 'fingerprint'>, beforeText: string, afterText: string): { distinct: number; recovered: number } {
  return recoveryFromGrams(tombstone, textGrams(beforeText), textGrams(afterText));
}

/** k-gram hash set of a whole text, normalized as one block. */
function textGrams(text: string): Set<number> {
  return kgramHashSet(normalizeBlock(text === '' ? [] : text.split('\n'), DEFAULT_MINER_CONFIG), DEFAULT_MINER_CONFIG.kgramSize);
}

function recoveryFromGrams(tombstone: Pick<Tombstone, 'fingerprint'>, inBefore: ReadonlySet<number>, inAfter: ReadonlySet<number>): { distinct: number; recovered: number } {
  let distinct = 0;
  let recovered = 0;
  for (const h of tombstone.fingerprint) {
    if (inBefore.has(h)) continue;
    distinct++;
    if (inAfter.has(h)) recovered++;
  }
  return { distinct, recovered };
}

/** Subtracted from the identifier-renamed score before it competes with the raw score; see research/matching-eval.md section 10. */
export const RENAME_PENALTY = 0.2;
/** The identifier-renamed score of a window counts only when the raw score of the same window is at least this; see research/matching-eval.md section 10. */
export const RENAME_RAW_FLOOR = 0.3;

/** How the identifier-renamed score competes with the raw one. */
export interface RenameScoring {
  penalty: number;
  rawFloor: number;
}

const idFingerprints = new WeakMap<object, number[]>();

/**
 * The tombstone's identifier-renamed fingerprint: `idFingerprint` when the graveyard has it, else computed from `lines` (and cached).
 * Invariant: equals fingerprintLines(lines, { renameIds: true, language }) for a tombstone built by the miner.
 */
export function idFingerprintOf(t: Pick<Tombstone, 'lines' | 'language'> & { idFingerprint?: number[] | undefined }): number[] {
  if (t.idFingerprint) return t.idFingerprint;
  let fp = idFingerprints.get(t);
  if (!fp) idFingerprints.set(t, (fp = fingerprintLines(t.lines, { ...DEFAULT_MINER_CONFIG, renameIds: true, language: t.language })));
  return fp;
}

/** Precomputed windows and k-gram prefilter of one text, for one normalization. */
interface TextView {
  cw: CandidateWindows;
  indexes: Map<number, WindowIndex>;
  grams: Set<number> | undefined;
}

/** Window caches and k-gram prefilters of one text, per (language, renamed). */
export class TextIndex {
  private readonly views = new Map<string, TextView>();
  constructor(readonly lines: string[]) {}

  /** The text's windows normalized with `options`, built on first use. */
  view(options: WindowOptions): TextView {
    const key = `${options.language ?? ''}:${options.renameIds === true ? 1 : 0}`;
    let v = this.views.get(key);
    if (!v) {
      const cw = new CandidateWindows(this.lines, options);
      this.views.set(key, (v = { cw, indexes: new Map(), grams: hasCommentOpener(this.lines) ? undefined : cw.plainGrams() }));
    }
    return v;
  }
}

function indexFor(v: TextView, width: number): WindowIndex {
  let index = v.indexes.get(width);
  if (!index) v.indexes.set(width, (index = { fps: new Map() }));
  return index;
}

/**
 * Score of a tombstone on a text, over windows of the tombstone's line count normalized in its language:
 * the best of raw Jaccard (fingerprint) and, for windows whose raw Jaccard is at least `rawFloor`, identifier-renamed Jaccard (idFingerprint) minus `penalty`.
 * The renamed score is skipped when the renamed fingerprint has fewer than `minHashes` distinct hashes.
 * Only scores that can reach `warn` are computed exactly; a lower result may be reported as 0 or as a lower window.
 * Invariant: similarity >= the raw windowed Jaccard whenever that is >= warn; never above max(raw, renamed - penalty) over the windows; a text that contains the tombstone's lines scores 1;
 * with penalty Infinity it equals matchWindowedIndexed(t, lines, ..., warn, { language }) whenever that is >= warn.
 */
export function scoreTombstone(
  t: Pick<Tombstone, 'lines' | 'fingerprint' | 'language'> & { idFingerprint?: number[] | undefined },
  text: TextIndex,
  warn: number,
  minHashes: number = DEFAULT_MIN_HASHES,
  rename: RenameScoring = { penalty: RENAME_PENALTY, rawFloor: RENAME_RAW_FLOOR },
): WindowedMatch & { renamed: boolean } {
  const none = { similarity: 0, matchedLines: [0, 0] as [number, number], containment: 0, renamed: false };
  const width = Math.min(t.lines.length, text.lines.length);
  if (width === 0 || t.fingerprint.length === 0) return none;
  const raw = text.view({ language: t.language });
  const rawIndex = indexFor(raw, width);
  const useRenamed = Number.isFinite(rename.penalty);
  const floor = useRenamed ? Math.min(rename.rawFloor, warn) : warn;
  if (raw.grams && sharedCount(t.fingerprint, raw.grams) < floor * t.fingerprint.length - 1e-9) return none;

  // 1. Raw windows that can reach warn, exactly as before the renamed score existed.
  // One candidate search serves both passes: the windows for rawFloor are a superset of those for warn, each with its shared count.
  const bounds = raw.cw.candidateBounds(t.fingerprint, width, rawIndex, floor);
  const size = t.fingerprint.length;
  const needWarn = sharedNeeded(warn, size);
  /** Upper bound of the window's Jaccard: I / (|A| + |B| - I) grows with I <= min(shared, |B|), and |B| is known exactly for plain windows. */
  const upper = (start: number, shared: number): number => {
    const b = raw.cw.fingerprintSize(start, width);
    if (b === undefined) return shared / size;
    const i = Math.min(shared, b);
    return i / (size + b - i);
  };
  const bound = new Map<number, number>();
  const sims = new Map<number, number>();
  let best = none;
  for (const start of [...bounds.keys()].sort((a, b) => a - b)) {
    const shared = bounds.get(start) as number;
    if (shared < sharedNeeded(floor, size)) continue;
    const ub = upper(start, shared);
    bound.set(start, ub);
    // A window whose bound is below warn cannot be reported; its exact score is only needed for the ranking in pass 2, and is computed there when it matters.
    if (shared < needWarn || ub < warn) continue;
    const fp = raw.cw.fingerprint(start, width, rawIndex);
    const sim = similarity(t.fingerprint, fp);
    sims.set(start, sim);
    if (sim > best.similarity) best = { similarity: sim, matchedLines: [start + 1, start + width], containment: containment(t.fingerprint, fp), renamed: false };
  }
  if (!useRenamed || best.similarity >= 1 - rename.penalty) return best;

  // 2. Renamed windows: only windows whose raw Jaccard reaches rawFloor, and only when the renamed text can beat the current best after the penalty.
  const idFp = idFingerprintOf(t);
  if (idFp.length < minHashes) return best;
  const need = Math.max(best.similarity, warn) + rename.penalty;
  const ren = text.view({ language: t.language, renameIds: true });
  if (ren.grams && sharedCount(idFp, ren.grams) < need * idFp.length - 1e-9) return best;
  const renIndex = indexFor(ren, width);
  // Walk the windows by raw Jaccard (best first, then lower start) and stop at the first renamed score that cannot be beaten (1 - penalty).
  // Raw Jaccard is computed lazily: a window's Jaccard is at most its bound (`upper`), so a computed window is next in line as soon as it beats that bound for every window not yet computed.
  const needFloor = sharedNeeded(rename.rawFloor, size);
  const ready: Array<{ start: number; sim: number }> = [];
  const pending: Array<{ start: number; ub: number }> = [];
  const insert = (start: number, sim: number): void => {
    let i = ready.length;
    while (i > 0 && ((ready[i - 1] as { sim: number }).sim < sim || ((ready[i - 1] as { sim: number }).sim === sim && (ready[i - 1] as { start: number }).start > start))) i--;
    ready.splice(i, 0, { start, sim });
  };
  for (const [start, shared] of bounds) {
    if (shared < needFloor) continue;
    const known = sims.get(start);
    if (known === undefined) {
      const ub = bound.get(start) as number;
      if (ub >= rename.rawFloor) pending.push({ start, ub });
    }
    else if (known >= rename.rawFloor) insert(start, known);
  }
  pending.sort((x, y) => y.ub - x.ub || x.start - y.start);
  let next = 0;
  for (;;) {
    // Compute windows, highest bound first, until the best computed one beats the bound of every window left (or none is computed yet).
    while (next < pending.length && (ready.length === 0 || !((ready[0] as { sim: number }).sim > (pending[next] as { ub: number }).ub))) {
      const w = pending[next++] as { start: number };
      const sim = similarity(t.fingerprint, raw.cw.fingerprint(w.start, width, rawIndex));
      if (sim >= rename.rawFloor) insert(w.start, sim);
    }
    const top = ready.shift();
    if (!top) break;
    const adjusted = similarity(idFp, ren.cw.fingerprint(top.start, width, renIndex)) - rename.penalty;
    if (adjusted > best.similarity) best = { similarity: adjusted, matchedLines: [top.start + 1, top.start + width], containment: containment(t.fingerprint, raw.cw.fingerprint(top.start, width, rawIndex)), renamed: true };
    if (best.similarity >= 1 - rename.penalty - 1e-9) break;
  }
  return best;
}

/** Positions of every distinct line in `lines`, ascending. */
function lineIndex(lines: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const at = out.get(lines[i] as string);
    if (at) at.push(i);
    else out.set(lines[i] as string, [i]);
  }
  return out;
}

/** Whether `run` occurs as consecutive whole lines of `lines` (`index` = lineIndex(lines)). Invariant: equals `\n${lines.join('\n')}\n`.includes(`\n${run.join('\n')}\n`) for a non-empty run. */
function containsRun(index: Map<string, number[]>, lines: string[], run: string[]): boolean {
  if (run.length === 0) return lines.length === 0;
  for (const p of index.get(run[0] as string) ?? []) {
    if (p + run.length > lines.length) break;
    let k = 1;
    while (k < run.length && lines[p + k] === run[k]) k++;
    if (k === run.length) return true;
  }
  return false;
}

/**
 * All tombstones with level != 'none', sorted by similarity desc, id asc.
 * A tombstone's similarity is max(raw windowed Jaccard, identifier-renamed windowed Jaccard - RENAME_PENALTY), with windows normalized in the tombstone's language;
 * the renamed score counts only on windows whose raw score is at least RENAME_RAW_FLOOR (scoreTombstone), and a hit that only the renamed score raises is 'warn', never 'block'.
 * With `before` (the lines on disk, empty for a new file), a hit is kept only if the write makes it worse: its level on `before` is 'none',
 * its similarity rose by at least WORSE_BY, or the write recovers at least RECOVERY_SHARE of the tombstone's hashes missing from `before` (distinctRecovery). Unchanged or unrelated edits never raise a score, so they never fire.
 * Tombstones with fewer than `options.minHashes` (default 4) distinct hashes are never watched.
 * Invariant: raising a threshold or minHashes never adds a hit; with `before` equal to `candidate` there are no hits.
 */
export function findRevenants(
  graveyard: Graveyard,
  candidate: string[],
  thresholds: Thresholds,
  before?: string[],
  options: { minHashes?: number; rename?: RenameScoring } = {},
): RevenantHit[] {
  const minHashes = options.minHashes ?? DEFAULT_MIN_HASHES;
  const rename = options.rename ?? { penalty: RENAME_PENALTY, rawFloor: RENAME_RAW_FLOOR };
  const hits: RevenantHit[] = [];
  const after = new TextIndex(candidate);
  const prior = before ? new TextIndex(before) : undefined;
  let recoveryGrams: { before: Set<number>; after: Set<number> } | undefined;
  let priorLines: Map<string, number[]> | undefined;
  for (const tombstone of graveyard.tombstones) {
    if (tombstone.fingerprint.length < minHashes) continue;
    const m = scoreTombstone(tombstone, after, thresholds.warn, minHashes, rename);
    const raised = hauntLevel(tombstone, m.similarity, thresholds);
    if (raised === 'none') continue;
    // A score that only the renamed fingerprint reaches is weaker evidence: warn, never block.
    const level = m.renamed && raised === 'block' ? 'warn' : raised;
    if (prior && before) {
      // Shortcut, exact: when the matched window's lines occur unchanged in `before`, its score there is at least m.similarity,
      // so the hit is "not made worse" exactly as if sBefore were computed.
      const window = candidate.slice(m.matchedLines[0] - 1, m.matchedLines[1]);
      priorLines ??= lineIndex(before);
      const sameWidth = Math.min(tombstone.lines.length, before.length) === window.length;
      const sBefore = sameWidth && containsRun(priorLines, before, window) ? m.similarity : scoreTombstone(tombstone, prior, thresholds.warn, minHashes, rename).similarity;
      if (hauntLevel(tombstone, sBefore, thresholds) !== 'none' && m.similarity < sBefore + WORSE_BY - 1e-9) {
        recoveryGrams ??= { before: textGrams(before.join('\n')), after: textGrams(candidate.join('\n')) };
        const { distinct, recovered } = recoveryFromGrams(tombstone, recoveryGrams.before, recoveryGrams.after);
        if (!(distinct >= 1 && recovered / distinct >= RECOVERY_SHARE)) continue;
      }
    }
    const hit: RevenantHit = { tombstone, level, similarity: m.similarity, containment: m.containment, matchedLines: m.matchedLines };
    if (m.renamed) hit.renamed = true;
    hits.push(hit);
  }
  return hits.sort((x, y) => y.similarity - x.similarity || (x.tombstone.id < y.tombstone.id ? -1 : 1));
}
