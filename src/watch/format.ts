import type { Link, RevenantHit, Tombstone } from '../core/types.js';

const MAX_ENTRY = 1200;
const MAX_HOOK_ENTRIES = 3;
const MAX_DELETED_LINES = 20;

/** The recorded cause of death, verbatim, or "cause of death unknown" when empty. Invariant: never invents text. */
export function causeText(t: Pick<Tombstone, 'causeOfDeath'>): string {
  return t.causeOfDeath.trim() === '' ? 'cause of death unknown' : t.causeOfDeath;
}

/** "PR #42, issue #7" for the tombstone's links; '' when there are none. */
export function linkText(links: Link[]): string {
  return links.map(l => `${l.type === 'pr' ? 'PR' : 'issue'} #${l.ref}`).join(', ');
}

/** YYYY-MM-DD of an ISO timestamp. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/** One hook entry (REQ-5), prefixed with its level; the cause is cut with `…` so the entry stays under 1,200 characters. Invariant: length <= 1200. */
export function formatHookEntry(hit: RevenantHit, file?: string): string {
  const t = hit.tombstone;
  const links = linkText(t.links);
  const build = (cause: string): string => {
    const head = `[${hit.level}] 👻 Déjà Boo: this code was buried on ${day(t.buriedAt)} in ${t.commit.slice(0, 7)} — ${cause}${links ? ` (${links})` : ''}`;
    return `${head}${head.endsWith('.') ? '' : '.'} ` +
      `Similarity ${hit.similarity.toFixed(2)} to tombstone ${t.id}, lines ${hit.matchedLines[0]}-${hit.matchedLines[1]} of ${file ?? 'this write'}. ` +
      `Read it with the MCP tool get_tombstone. If the cause no longer applies, add the comment \`deja-boo: checked ${t.id}\` near the code${file ? '.' : ' and write again.'}`;
  };
  let cause = causeText(t);
  const full = build(cause);
  if (full.length <= MAX_ENTRY) return full;
  const room = MAX_ENTRY - (build('').length);
  cause = room > 1 ? `${cause.slice(0, room - 1)}…` : '…';
  return build(cause);
}

/** Hook stderr text: at most 3 entries, then "… and N more buried things". The level is stated per entry. */
export function formatHookMessage(hits: RevenantHit[], files?: string[]): string {
  const shown = hits.slice(0, MAX_HOOK_ENTRIES).map((h, i) => formatHookEntry(h, files?.[i]));
  if (hits.length > MAX_HOOK_ENTRIES) shown.push(`… and ${hits.length - MAX_HOOK_ENTRIES} more buried things`);
  return shown.join('\n') + '\n';
}

/** Full report for `deja-boo check`: every REQ-3 field per revenant. */
export function formatCheckReport(hits: RevenantHit[]): string {
  const out: string[] = [];
  for (const h of hits) {
    const t = h.tombstone;
    const links = linkText(t.links);
    out.push(
      `👻 ${h.level.toUpperCase()} tombstone ${t.id}`,
      `  path:        ${t.path}`,
      `  commit:      ${t.commit}`,
      `  buried:      ${t.buriedAt}`,
      `  cause:       ${causeText(t)}`,
      ...(links ? [`  links:       ${links}`] : []),
      `  matched:     lines ${h.matchedLines[0]}-${h.matchedLines[1]} of the input`,
      `  similarity:  ${h.similarity.toFixed(2)}  containment: ${h.containment.toFixed(2)}`,
      `  deleted lines:`,
      ...t.lines.slice(0, MAX_DELETED_LINES).map(l => `    - ${l}`),
      ...(t.lines.length > MAX_DELETED_LINES ? [`    … ${t.lines.length - MAX_DELETED_LINES} more lines`] : []),
      '',
    );
  }
  return out.join('\n');
}
