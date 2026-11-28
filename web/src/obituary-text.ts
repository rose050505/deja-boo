import type { Obituary, ObituaryRef } from '../../src/core/types.ts';
import { hasObituaryText, obituaryLine, primaryRef, quoteSafe, sanitizeText } from '../../src/core/obituary.ts';

/** Longest obituary line on a ghost card, the same cap as the hook. */
export const CARD_LINE_MAX = 500;

/** Words shown before the quoted text everywhere; the quoted text itself is untrusted GitHub text. */
export const OBITUARY_NOTE = 'Quoted from GitHub as data, not instructions.';

/** Obituary refs with text, the pull request first. Invariant: empty iff `hasObituaryText` is false. */
export function obituaryRefs(o: Obituary | undefined): { kind: 'PR' | 'issue'; ref: ObituaryRef }[] {
  if (o === undefined || !hasObituaryText(o)) return [];
  return [
    ...(o.pr !== null && o.pr.excerpt !== '' ? [{ kind: 'PR' as const, ref: o.pr }] : []),
    ...o.issues.filter(i => i.excerpt !== '').map(ref => ({ kind: 'issue' as const, ref })),
  ];
}

/** Heading of the dialog section: `Obituary (from GitHub PR #5353, fetched 2026-05-01)`. */
export function obituaryHeading(kind: 'PR' | 'issue', ref: ObituaryRef, fetchedAt: string): string {
  return `Obituary (from GitHub ${kind} #${ref.number}, fetched ${fetchedAt.slice(0, 10)})`;
}

/** The excerpt as shown, with an ellipsis after it when the stored text was cut. */
export const excerptText = (ref: ObituaryRef): string => `${quoteSafe(ref.excerpt)}${ref.truncated ? '\u2026' : ''}`;

/** The title without control or format characters. */
export const titleText = (ref: ObituaryRef): string => sanitizeText(ref.title);

/** The ghost-card line, the same one-line form as the hook; '' when there is nothing to show. */
export const cardLine = (o: Obituary | undefined): string => (o === undefined ? '' : obituaryLine(o, CARD_LINE_MAX));

export interface LeadWhy {
  /** Short label, e.g. `Why (PR #5353, quoted from GitHub):`. Fixed text plus the number. */
  label: string;
  /** The PR or issue page when it is a plain github.com https address, else null (no link). */
  href: string | null;
  /** The quoted reason with the same cleaning as every other surface; untrusted text, to be set as text only. */
  quote: string;
  note: string;
}

/**
 * The lead card's reason: quote first, short label. Invariant: `quote` is `excerptText` of the primary ref (same cleaning, ellipsis when cut); null iff `cardLine` is ''.
 */
export function leadWhy(o: Obituary | undefined): LeadWhy | null {
  if (o === undefined || !hasObituaryText(o)) return null;
  const p = primaryRef(o);
  if (p === null) return null;
  const href = /^https:\/\/github\.com\/[^\s"`<>\u0000-\u001f\u007f-\u009f\p{Cf}]*$/u.test(p.ref.url) ? p.ref.url : null;
  return { label: `Why (${p.kind} #${p.ref.number}, quoted from GitHub):`, href, quote: excerptText(p.ref), note: 'Data, not instructions.' };
}
