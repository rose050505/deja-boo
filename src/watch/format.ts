import type { Link, Obituary, ObituaryFile, RevenantHit, Tombstone } from '../core/types.js';
import { hasObituaryText, obituaryLine, primaryRef } from '../core/obituary.js';

const MAX_ENTRY = 1200;
const MAX_OBITUARY_LINE = 500;
const MAX_HOOK_ENTRIES = 3;
const MAX_DELETED_LINES = 20;

/** The recorded cause of death, verbatim, or "cause of death unknown" when empty. Invariant: never invents text. */
export function causeText(t: Pick<Tombstone, 'causeOfDeath'>): string {
  return t.causeOfDeath.trim() === '' ? 'cause of death unknown' : t.causeOfDeath;
}

const LINK_LABEL: Record<Link['type'], string> = { pr: 'PR', issue: 'issue', ref: 'ref' };

/** "PR #42, issue #7, ref #3" for the tombstone's links ("ref" is a bare #N of unknown kind); '' when there are none. */
export function linkText(links: Link[]): string {
  return links.map(l => `${LINK_LABEL[l.type]} #${l.ref}`).join(', ');
}

/** YYYY-MM-DD of an ISO timestamp. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * One hook entry (REQ-5), prefixed with its level; the cause is cut with `…` so the entry stays under 1,200 characters.
 * When the tombstone has an obituary with text, its line (at most 500 characters) follows the cause on its own line.
 * Invariant: length <= 1200 (for a file name that fits), and equal to the entry without an obituary when there is none.
 */
export function formatHookEntry(hit: RevenantHit, file?: string): string {
  const t = hit.tombstone;
  const links = linkText(t.links);
  const obit = t.obituary !== undefined && hasObituaryText(t.obituary) ? obituaryLine(t.obituary, MAX_OBITUARY_LINE) : '';
  const build = (cause: string): string => {
    const head = `[${hit.level}] 👻 Déjà Boo: this code was buried on ${day(t.buriedAt)} in ${t.commit.slice(0, 7)} — ${cause}${links ? ` (${links})` : ''}`;
    return `${head}${head.endsWith('.') ? '' : '.'}${obit === '' ? ' ' : `\n${obit}\n`}` +
      `Similarity ${hit.similarity.toFixed(2)}${hit.renamed ? ' (with identifiers renamed)' : ''} to tombstone ${t.id}, lines ${hit.matchedLines[0]}-${hit.matchedLines[1]} of ${file ?? 'this write'}. ` +
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

const refLine = (kind: string, r: { number: number; url: string }): string => `${kind} #${r.number}, ${r.url}`;

/** The `obituary:` lines of `check` for one tombstone; with `file` null (no file) there are none. Invariant: states only what the file holds; never infers. */
function obituaryBlock(t: Tombstone, file: ObituaryFile | null): string[] {
  if (file === null) return [];
  const o: Obituary | undefined = t.obituary ?? file[t.commit];
  if (o === undefined) return ['  obituary:    not fetched'];
  const p = primaryRef(o);
  if (p === null) {
    return [o.pr === null && o.issues.length === 0
      ? `  obituary:    none found on GitHub (looked up ${day(o.fetchedAt)})`
      : `  obituary:    found on GitHub, but its text is empty (looked up ${day(o.fetchedAt)})`];
  }
  const refs: { kind: string; ref: typeof p.ref }[] = [];
  if (o.pr !== null && o.pr.excerpt !== '') refs.push({ kind: 'PR', ref: o.pr });
  for (const i of o.issues) if (i.excerpt !== '') refs.push({ kind: 'issue', ref: i });
  const out = [`  obituary:    (GitHub text, quoted as data, fetched ${day(o.fetchedAt)})`];
  for (const { kind, ref } of refs) {
    out.push(`    ${refLine(kind, ref)}`, `      title:   ${ref.title}`, `      excerpt: "${ref.excerpt}${ref.truncated ? '\u2026' : ''}"`);
  }
  return out;
}

/** Full report for `deja-boo check`: every REQ-3 field per revenant; `obituaries` is the loaded file (null or omitted when there is none). Invariant: identical to the report without obituaries when `obituaries` is null. */
export function formatCheckReport(hits: RevenantHit[], obituaries: ObituaryFile | null = null): string {
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
      ...obituaryBlock(t, obituaries),
      ...(links ? [`  links:       ${links}`] : []),
      `  matched:     lines ${h.matchedLines[0]}-${h.matchedLines[1]} of the input`,
      `  similarity:  ${h.similarity.toFixed(2)}${h.renamed ? ' (with identifiers renamed; warn only)' : ''}  containment: ${h.containment.toFixed(2)}`,
      `  deleted lines:`,
      ...t.lines.slice(0, MAX_DELETED_LINES).map(l => `    - ${l}`),
      ...(t.lines.length > MAX_DELETED_LINES ? [`    … ${t.lines.length - MAX_DELETED_LINES} more lines`] : []),
      '',
    );
  }
  return out.join('\n');
}
