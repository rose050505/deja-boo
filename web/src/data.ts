import type { WebTombstone } from '../scripts/strip.ts';

export type { WebTombstone };

export interface RepoEntry {
  name: string;
  /** GitHub `owner/repo`, or null for the demo repo. */
  github: string | null;
  tombstones: number;
  mined: number;
}

export interface SiteStats {
  repos: number;
  commits: number;
  tombstones: number;
  revivals: number;
  revivalsViaRevert: number;
  medianRevivalGapDays: number | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadIndex = (): Promise<RepoEntry[]> => getJson('graveyards/index.json');
export const loadStats = (): Promise<SiteStats> => getJson('stats.json');
export const loadGraveyard = (name: string): Promise<WebTombstone[]> => getJson(`graveyards/${name}.json`);

/** Commit URL on GitHub, or null when the repo has no remote. */
export function commitUrl(github: string | null, commit: string): string | null {
  return github === null ? null : `https://github.com/${github}/commit/${commit}`;
}
