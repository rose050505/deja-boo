import { isRevertCause } from '../../src/core/level.ts';

export interface StoneInput {
  id: string;
  path: string;
  buriedAt: string;
  causeOfDeath: string;
  lines: readonly string[];
  totalLines?: number;
}

export interface StoneBox {
  id: string;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RowBox {
  name: string;
  y: number;
  h: number;
  count: number;
}

export interface Layout {
  stones: StoneBox[];
  rows: RowBox[];
  width: number;
  height: number;
  /** Epoch ms of the left and right edge of the time axis. */
  t0: number;
  t1: number;
}

export const PAD = 24;
export const GAP = 4;
const ROW_PAD = 10;
/** Space a ghost glyph needs above a stone's top edge (ghost top is at about -47). */
export const GHOST_RISE = 52;

/** Top-level directory of a path, or `(root)` for a file at the top. */
export function topDir(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '(root)' : path.slice(0, i);
}

/**
 * First line of the cause of death plus the burial date; "cause of death unknown" when the message is empty.
 * Invariant: never invents text; the result always ends with the YYYY-MM-DD of `buriedAt`.
 */
export function epitaph(t: Pick<StoneInput, 'causeOfDeath' | 'buriedAt'>): string {
  const first = t.causeOfDeath.split('\n')[0]?.trim() ?? '';
  return `${first === '' ? 'cause of death unknown' : first} · ${t.buriedAt.slice(0, 10)}`;
}

/** True for a Revert death (cracked stone). */
export const isCracked = (t: Pick<StoneInput, 'causeOfDeath'>): boolean => isRevertCause(t.causeOfDeath);

/** Stone width in px; grows with the lines buried and is clamped to [16, 52]. Invariant: monotone in `lines`. */
export function stoneWidth(lines: number): number {
  return Math.min(52, Math.max(16, Math.round(12 + 5 * Math.sqrt(Math.max(1, lines)))));
}

/**
 * Place stones by time (x) and top-level directory (rows); stones that would overlap in a row go to the next free lane.
 * Invariant: deterministic; every stone lies inside [0, width] x [0, height] with at least GHOST_RISE px free above it; no two stones in a row overlap.
 */
export function layoutStones(items: readonly StoneInput[], canvasWidth = 2600): Layout {
  const times = items.map(i => Date.parse(i.buriedAt));
  const t0 = times.length ? Math.min(...times) : 0;
  const t1 = times.length ? Math.max(...times) : 1;
  const span = Math.max(1, t1 - t0);
  const inner = canvasWidth - 2 * PAD;

  const byDir = new Map<string, StoneInput[]>();
  for (const it of items) {
    const d = topDir(it.path);
    const list = byDir.get(d);
    if (list) list.push(it);
    else byDir.set(d, [it]);
  }
  const dirs = [...byDir.keys()].sort((a, b) => (byDir.get(b)!.length - byDir.get(a)!.length) || (a < b ? -1 : a > b ? 1 : 0));

  const stones: StoneBox[] = [];
  const rows: RowBox[] = [];
  let y = GHOST_RISE;
  dirs.forEach((dir, row) => {
    const list = [...byDir.get(dir)!].sort((a, b) => Date.parse(a.buriedAt) - Date.parse(b.buriedAt) || (a.id < b.id ? -1 : 1));
    const laneEnds: number[] = [];
    const placed: { it: StoneInput; x: number; w: number; h: number; lane: number }[] = [];
    let maxH = 0;
    for (const it of list) {
      const w = stoneWidth(it.totalLines ?? it.lines.length);
      const h = Math.round(w * 1.3);
      maxH = Math.max(maxH, h);
      const cx = PAD + ((Date.parse(it.buriedAt) - t0) / span) * inner;
      const x = Math.min(canvasWidth - PAD - w, Math.max(PAD, Math.round(cx - w / 2)));
      let lane = laneEnds.findIndex(end => end + GAP <= x);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = x + w;
      placed.push({ it, x, w, h, lane });
    }
    const laneH = maxH + GAP;
    const rowH = Math.max(1, laneEnds.length) * laneH + ROW_PAD;
    for (const p of placed) stones.push({ id: p.it.id, row, x: p.x, y: y + ROW_PAD / 2 + p.lane * laneH + (maxH - p.h), w: p.w, h: p.h });
    rows.push({ name: dir, y, h: rowH, count: list.length });
    y += rowH;
  });

  return { stones, rows, width: canvasWidth, height: y + PAD, t0, t1 };
}
