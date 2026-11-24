/**
 * Fast windowed fingerprints of a candidate file. Pure and browser-safe.
 *
 * `matchWindowed` fingerprints every window of `size` lines from scratch. Here every line is normalized and tokenized once,
 * every token k-gram is hashed once, and a window's fingerprint is the winnowing of a slice of those hashes.
 * A window normalizes line by line, starting outside any block comment, so it equals a slice of one of two precomputed streams:
 *   - N: every line normalized from the "outside" state; valid for a window whose lines all end outside a comment.
 *   - G: the whole file normalized in one pass; valid for a window that starts outside a comment in that pass.
 *   - M (mixed): a window that starts inside a comment in G and later opens its own comment. Up to its first line that leaves the "outside"
 *     state it is N, and from there on it is G; the (at most K-1) k-grams across that seam are hashed separately.
 * Any other window (the seam line itself sits inside a comment in G) is "slow" and is normalized on its own.
 * Only windows that contain a k-gram of the tombstone are fingerprinted, because every other window has Jaccard 0.
 */
import { kgramHashAt, sortedDistinct, winnowHashes } from './fingerprint.js';
import { normalizeLineFrom, renameIdentifiers, type CommentState } from './normalize.js';
import { tokenize } from './tokenize.js';
import { DEFAULT_MINER_CONFIG } from './types.js';

const K = DEFAULT_MINER_CONFIG.kgramSize;
const W = DEFAULT_MINER_CONFIG.windowSize;
const STATES: readonly CommentState[] = ['normal', 'slash_star', 'html', 'haskell'];

interface LineOut { tokens: string[]; out: CommentState }

/** All lines tokenized into one stream, with k-gram hashes and the line each token sits on. */
class Stream {
  /** off[i] = index of the first token of line i; off[n] = token count. */
  readonly off: Int32Array;
  readonly hashes: Uint32Array;
  readonly lineOf: Int32Array;
  readonly tokens: string[];
  private positions: Map<number, number[]> | undefined;

  constructor(perLine: readonly (readonly string[])[]) {
    const n = perLine.length;
    this.off = new Int32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) {
      this.off[i] = total;
      total += (perLine[i] as readonly string[]).length;
    }
    this.off[n] = total;
    const tokens: string[] = new Array<string>(total);
    this.tokens = tokens;
    this.lineOf = new Int32Array(total);
    let at = 0;
    for (let i = 0; i < n; i++) for (const t of perLine[i] as readonly string[]) { this.lineOf[at] = i; tokens[at++] = t; }
    this.hashes = new Uint32Array(Math.max(0, total - K + 1));
    for (let j = 0; j < this.hashes.length; j++) this.hashes[j] = kgramHashAt(tokens, j, K);
  }

  /** Token index of every k-gram with this hash, ascending. */
  at(hash: number): number[] {
    if (!this.positions) {
      const m = new Map<number, number[]>();
      for (let j = 0; j < this.hashes.length; j++) {
        const h = this.hashes[j] as number;
        const list = m.get(h);
        if (list) list.push(j);
        else m.set(h, [j]);
      }
      this.positions = m;
    }
    return this.positions.get(hash) ?? [];
  }

  private mins: Uint32Array | undefined;

  /** Fingerprint of the window made of lines [s, e): the distinct per-position window minimums, precomputed once per stream. */
  fingerprint(s: number, e: number): number[] {
    const from = this.off[s] as number;
    const to = Math.max(from, (this.off[e] as number) - K + 1);
    if (to - from < W) return winnowHashes(this.hashes, from, to, W);
    if (!this.mins) {
      // mins[i] = min(hashes[i .. i + W)), the value winnowing picks for the window of hashes starting at i.
      const m = new Uint32Array(Math.max(0, this.hashes.length - W + 1));
      for (let i = 0; i < m.length; i++) {
        let min = this.hashes[i] as number;
        for (let j = i + 1; j < i + W; j++) if ((this.hashes[j] as number) < min) min = this.hashes[j] as number;
        m[i] = min;
      }
      this.mins = m;
    }
    return sortedDistinct(this.mins.slice(from, to - W + 1));
  }
}

/** Per-width cache: fingerprints already computed, and the slow windows with their hash index. */
export interface WindowIndex {
  fps: Map<number, number[]>;
  /** Slow windows: hash of their fingerprint -> window starts. */
  slow?: { byHash: Map<number, number[]> };
  /** Mixed windows: hash of a k-gram across the seam -> window starts. */
  seam?: { byHash: Map<number, number[]> };
}

/** Precomputed streams of one candidate. */
export class CandidateWindows {
  readonly n: number;
  private readonly memo: (LineOut | undefined)[];
  private readonly N: Stream;
  /** badPrefix[i] = lines before i whose outcome from 'normal' is not 'normal'. */
  private readonly badPrefix: Int32Array;
  /** nextBad[i] = first line >= i whose outcome from 'normal' is not 'normal' (n when none). */
  private readonly nextBad: Int32Array;
  /** Single-pass stream and the state at each line start; undefined when it equals N (no line leaves 'normal'). */
  private readonly G: { stream: Stream; startsNormal: Uint8Array } | undefined;

  /** `language` picks the comment syntax; `renameIds` replaces identifiers by `_ID_`, like `normalizeBlock` does. */
  constructor(readonly lines: readonly string[], private readonly options: { language?: string | undefined; renameIds?: boolean } = {}) {
    this.n = lines.length;
    this.memo = new Array<LineOut | undefined>(this.n * 4);
    this.badPrefix = new Int32Array(this.n + 1);
    const normal: string[][] = [];
    for (let i = 0; i < this.n; i++) {
      const o = this.lineOut(i, 'normal');
      normal.push(o.tokens);
      this.badPrefix[i + 1] = (this.badPrefix[i] as number) + (o.out === 'normal' ? 0 : 1);
    }
    this.N = new Stream(normal);
    this.nextBad = new Int32Array(this.n + 1);
    this.nextBad[this.n] = this.n;
    for (let i = this.n - 1; i >= 0; i--) this.nextBad[i] = (this.badPrefix[i + 1] as number) > (this.badPrefix[i] as number) ? i : (this.nextBad[i + 1] as number);
    if ((this.badPrefix[this.n] as number) === 0) return;
    const chained: string[][] = [];
    const startsNormal = new Uint8Array(this.n);
    let q: CommentState = 'normal';
    for (let i = 0; i < this.n; i++) {
      startsNormal[i] = q === 'normal' ? 1 : 0;
      const o = this.lineOut(i, q);
      chained.push(o.tokens);
      q = o.out;
    }
    this.G = { stream: new Stream(chained), startsNormal };
  }

  private lineOut(i: number, q: CommentState): LineOut {
    const key = i * 4 + STATES.indexOf(q);
    let o = this.memo[key];
    if (!o) {
      const r = normalizeLineFrom(this.lines[i] as string, q, this.options.language);
      o = { tokens: tokenize(this.options.renameIds === true ? renameIdentifiers(r.text) : r.text), out: r.state };
      this.memo[key] = o;
    }
    return o;
  }

  private isN(s: number, width: number): boolean {
    return (this.badPrefix[s + width] as number) - (this.badPrefix[s] as number) === 0;
  }

  private isG(s: number, width: number): boolean {
    return this.G !== undefined && !this.isN(s, width) && this.G.startsNormal[s] === 1;
  }

  /** First line of the mixed window's G part, or -1 when the window is not mixed. */
  private seamLine(s: number, width: number): number {
    if (!this.G || this.isN(s, width) || this.G.startsNormal[s] === 1) return -1;
    const j = this.nextBad[s] as number;
    return this.G.startsNormal[j] === 1 ? j : -1;
  }

  private isMixed(s: number, width: number): boolean {
    return this.seamLine(s, width) >= 0;
  }

  private isSlow(s: number, width: number): boolean {
    return !this.isN(s, width) && !this.isG(s, width) && !this.isMixed(s, width);
  }

  /** Hashes of the k-grams across the seam of a mixed window, and the hashes of the whole window in stream order. */
  private mixedHashes(s: number, width: number, seam: number): { across: number[]; all: Uint32Array } {
    const G = (this.G as NonNullable<typeof this.G>).stream;
    const aStart = this.N.off[s] as number;
    const aEnd = this.N.off[seam] as number;
    const bStart = G.off[seam] as number;
    const bEnd = G.off[s + width] as number;
    const aHashes = this.N.hashes.subarray(aStart, Math.max(aStart, aEnd - K + 1));
    const bHashes = G.hashes.subarray(bStart, Math.max(bStart, bEnd - K + 1));
    const across: number[] = [];
    for (let t = Math.max(aStart, aEnd - K + 1); t < aEnd; t++) {
      const tokens = this.N.tokens.slice(t, aEnd).concat(G.tokens.slice(bStart, Math.min(bEnd, bStart + K - (aEnd - t))));
      if (tokens.length === K) across.push(kgramHashAt(tokens, 0, K));
    }
    const all = new Uint32Array(aHashes.length + across.length + bHashes.length);
    all.set(aHashes, 0);
    all.set(across, aHashes.length);
    all.set(bHashes, aHashes.length + across.length);
    return { across, all };
  }

  /** Fingerprint of lines [s, s + width), equal to `fingerprintLines(lines.slice(s, s + width))`. */
  fingerprint(s: number, width: number, index: WindowIndex): number[] {
    let fp = index.fps.get(s);
    if (fp) return fp;
    const seam = this.seamLine(s, width);
    if (this.isN(s, width)) fp = this.N.fingerprint(s, s + width);
    else if (this.isG(s, width)) fp = (this.G as NonNullable<typeof this.G>).stream.fingerprint(s, s + width);
    else if (seam >= 0) {
      const { all } = this.mixedHashes(s, width, seam);
      fp = winnowHashes(all, 0, all.length, W);
    } else {
      const tokens: string[] = [];
      let q: CommentState = 'normal';
      for (let i = s; i < s + width; i++) {
        const o = this.lineOut(i, q);
        for (const t of o.tokens) tokens.push(t);
        q = o.out;
      }
      const hashes: number[] = [];
      for (let j = 0; j + K <= tokens.length; j++) hashes.push(kgramHashAt(tokens, j, K));
      fp = winnowHashes(hashes, 0, hashes.length, W);
    }
    index.fps.set(s, fp);
    return fp;
  }

  /**
   * Ascending window starts that can reach Jaccard >= `minSimilarity` with `fingerprint`; every other window scores below it
   * (with `minSimilarity` 0: every window that shares a hash, since the rest score 0).
   * A window can only share hashes with the tombstone that occur as k-grams in it, and Jaccard <= shared / |fingerprint|,
   * so a window needs at least ceil(minSimilarity * |fingerprint|) of the tombstone's distinct hashes among its k-grams.
   */
  candidateStarts(fingerprint: readonly number[], width: number, index: WindowIndex, minSimilarity = 0): number[] {
    const last = this.n - width;
    const need = Math.max(1, Math.ceil(minSimilarity * fingerprint.length - 1e-9));
    const starts = new Set<number>();
    const bump = (delta: Map<number, number>, at: number, by: number): void => { delta.set(at, (delta.get(at) ?? 0) + by); };
    /** delta[x] = change in the number of tombstone hashes that occur as a k-gram in windows starting at x. */
    const deltaOf = (stream: Stream): Map<number, number> => {
      const delta = new Map<number, number>();
      for (const h of fingerprint) {
        let curLo = -1;
        let curHi = -2;
        for (const j of stream.at(h)) {
          const lo = Math.max(0, (stream.lineOf[j + K - 1] as number) - width + 1);
          const hi = Math.min(last, stream.lineOf[j] as number);
          if (lo > hi) continue;
          if (lo > curHi + 1) {
            if (curHi >= curLo) { bump(delta, curLo, 1); bump(delta, curHi + 1, -1); }
            curLo = lo;
            curHi = hi;
          } else if (hi > curHi) curHi = hi;
        }
        if (curHi >= curLo) { bump(delta, curLo, 1); bump(delta, curHi + 1, -1); }
      }
      return delta;
    };
    const sweep = (delta: Map<number, number>, accept: (s: number) => boolean): void => {
      const points = [...delta.keys()].sort((a, b) => a - b);
      let count = 0;
      for (let i = 0; i < points.length; i++) {
        count += delta.get(points[i] as number) as number;
        if (count < need) continue;
        const to = (points[i + 1] ?? last + 1) - 1;
        for (let s = points[i] as number; s <= to; s++) if (accept(s)) starts.add(s);
      }
    };
    const dN = deltaOf(this.N);
    sweep(dN, s => this.isN(s, width));
    if (this.G) {
      const dG = deltaOf(this.G.stream);
      sweep(dG, s => this.isG(s, width));

      if (!index.seam) {
        const byHash = new Map<number, number[]>();
        for (let s = 0; s <= last; s++) {
          const seam = this.seamLine(s, width);
          if (seam < 0) continue;
          for (const h of new Set(this.mixedHashes(s, width, seam).across)) {
            const bucket = byHash.get(h);
            if (bucket) bucket.push(s);
            else byHash.set(h, [s]);
          }
        }
        index.seam = { byHash };
      }
      // A mixed window shares a hash with the tombstone only through N k-grams, G k-grams or seam k-grams; the sum over-counts, never under-counts.
      const dM = new Map(dN);
      for (const [x, d] of dG) bump(dM, x, d);
      for (const h of fingerprint) for (const s of index.seam.byHash.get(h) ?? []) { bump(dM, s, 1); bump(dM, s + 1, -1); }
      sweep(dM, s => this.isMixed(s, width));

      if (!index.slow) {
        const byHash = new Map<number, number[]>();
        for (let s = 0; s <= last; s++) {
          if (!this.isSlow(s, width)) continue;
          for (const h of this.fingerprint(s, width, index)) {
            const bucket = byHash.get(h);
            if (bucket) bucket.push(s);
            else byHash.set(h, [s]);
          }
        }
        index.slow = { byHash };
      }
      const shared = new Map<number, number>();
      for (const h of fingerprint) for (const s of index.slow.byHash.get(h) ?? []) shared.set(s, (shared.get(s) ?? 0) + 1);
      for (const [s, c] of shared) if (c >= need) starts.add(s);
    }
    return [...starts].sort((a, b) => a - b);
  }
}
