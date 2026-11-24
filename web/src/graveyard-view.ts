import { clear, h, s } from './dom.ts';
import { commitUrl, type RepoEntry, type WebTombstone } from './data.ts';
import { epitaph, isCracked, layoutStones, type Layout } from './layout.ts';
import { ghostOpacity } from './summon.ts';

export const DEFAULT_CAPTION = 'Hover or focus a stone to read its epitaph.';

export interface GraveyardView {
  /** Mark stones as haunted, raise a ghost over each (opacity = similarity), scroll the first into view; pass [] to clear. */
  haunt(hits: readonly { id: string; similarity: number }[]): void;
  open(id: string, similarity?: number): void;
}

const isHex40 = (x: string): boolean => /^[0-9a-f]{40}$/.test(x);

function safeLink(url: string | undefined): string | null {
  return url !== undefined && /^https:\/\/github\.com\//.test(url) ? url : null;
}

/** Fill the dialog with the full tombstone: verbatim cause, deleted lines, commit link, revivals. */
export function renderTombstone(dialog: HTMLDialogElement, repo: RepoEntry, t: WebTombstone, hit?: { similarity: number }): void {
  clear(dialog);
  const url = isHex40(t.commit) ? commitUrl(repo.github, t.commit) : null;
  const cause = t.causeOfDeath.trim() === '' ? 'cause of death unknown' : t.causeOfDeath;
  const shown = t.lines.length;
  const total = t.totalLines ?? shown;

  dialog.append(
    h('div', { class: 'dlg-head' },
      h('h3', { id: 'tomb-h' }, isCracked(t) ? 'Cracked stone: a Revert' : 'Tombstone'),
      h('button', { type: 'button', class: 'btn', 'data-close': '' }, 'Close'),
    ),
    h('p', { class: 'epitaph' }, epitaph(t)),
    h('dl', { class: 'facts' },
      h('dt', {}, 'File'), h('dd', {}, h('code', {}, t.path), ` (${t.language})`),
      h('dt', {}, 'Buried'), h('dd', {}, t.buriedAt),
      h('dt', {}, 'Commit'),
      h('dd', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, h('code', {}, t.commit)) : h('code', {}, t.commit),
        url ? '' : repo.github === null ? ' (demo repo, no remote)' : ''),
      h('dt', {}, 'Id'), h('dd', {}, h('code', {}, t.id)),
      hit ? h('dt', {}, 'Match') : null,
      hit ? h('dd', {}, `${Math.round(hit.similarity * 100)}% similar to your code`) : null,
    ),
    h('h4', {}, 'Cause of death (verbatim from the commit message)'),
    h('pre', { class: 'cause' }, cause),
    t.links.length
      ? h('p', {}, 'Links: ', ...t.links.flatMap((l, i) => {
          const href = safeLink(l.url);
          const label = `${l.type === 'pr' ? 'PR' : 'issue'} #${l.ref}`;
          return [i ? ', ' : '', href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label) : label];
        }))
      : h('p', { class: 'muted' }, 'Links: none in the commit message.'),
    h('h4', {}, total > shown ? `Deleted lines (showing ${shown} of ${total})` : `Deleted lines (${total})`),
    h('pre', { class: 'code' }, t.lines.join('\n')),
    h('h4', {}, `Revivals (${t.revivals.length})`),
    t.revivals.length
      ? h('ul', { class: 'revivals' }, ...t.revivals.map(r =>
          h('li', {},
            `${r.date.slice(0, 10)} · ${r.isRevert ? 'via Revert' : 'came back'} · ${Math.round(r.similarity * 100)}% similar · `,
            h('code', {}, r.commit.slice(0, 10)), ` "${r.subject}"`)))
      : h('p', { class: 'muted' }, 'None found in history.'),
  );
}

/** A small ghost above a stone. Opacity = similarity; the percentage is also written next to it. */
function ghostGlyph(similarity: number): SVGGElement {
  return s('g', { class: 'ghost' },
    s('g', { class: 'ghost-body', opacity: ghostOpacity(similarity) },
      s('path', { d: 'M-9 0 V-12 A9 9 0 0 1 9 -12 V0 L6 -3 L3 0 L0 -3 L-3 0 L-6 -3 Z', transform: 'translate(0 -26)' }),
      s('circle', { cx: -3, cy: -40, r: 1.6, class: 'eye' }),
      s('circle', { cx: 3, cy: -40, r: 1.6, class: 'eye' }),
    ),
    s('text', { x: 12, y: -34, class: 'ghost-pct' }, `${Math.round(similarity * 100)}%`),
  );
}

/** Caption text for a stone: epitaph, Revert mark, path. */
export function captionFor(t: WebTombstone): string {
  return `${epitaph(t)}${isCracked(t) ? ' (Revert)' : ''} · ${t.path}`;
}

export function mountGraveyard(
  scroll: HTMLElement,
  caption: HTMLElement,
  dialog: HTMLDialogElement,
  repo: RepoEntry,
  tombstones: readonly WebTombstone[],
): GraveyardView {
  const byId = new Map(tombstones.map(t => [t.id, t] as const));
  const layout: Layout = layoutStones(tombstones);
  const labelW = 150;
  clear(scroll);

  const labels = h('div', { class: 'row-labels', style: `height:${layout.height}px;width:${labelW}px` },
    ...layout.rows.map(r => h('div', { class: 'row-label', style: `top:${r.y}px;height:${r.h}px` }, h('span', {}, r.name), h('small', {}, ` ${r.count}`))));

  const svg = s('svg', {
    class: 'stones', width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: 'group', 'aria-label': `${tombstones.length} tombstones of ${repo.name}, by date and directory`,
  });
  // Row bands and year ticks.
  layout.rows.forEach((r, i) => svg.append(s('rect', { x: 0, y: r.y, width: layout.width, height: r.h, class: i % 2 ? 'band b1' : 'band b0' })));
  if (tombstones.length) {
    const y0 = new Date(layout.t0).getUTCFullYear();
    const y1 = new Date(layout.t1).getUTCFullYear();
    const step = y1 - y0 > 12 ? 2 : 1;
    for (let y = y0 + 1; y <= y1; y += step) {
      const x = 24 + ((Date.UTC(y, 0, 1) - layout.t0) / Math.max(1, layout.t1 - layout.t0)) * (layout.width - 48);
      svg.append(s('line', { x1: x, x2: x, y1: 0, y2: layout.height, class: 'tick' }), s('text', { x: x + 3, y: 12, class: 'tick-label' }, String(y)));
    }
  }

  const nodes = new Map<string, SVGGElement>();
  for (const b of layout.stones) {
    const t = byId.get(b.id)!;
    const cracked = isCracked(t);
    const text = `${epitaph(t)}${cracked ? ' (Revert)' : ''}`;
    const g = s('g', {
      class: cracked ? 'stone cracked' : 'stone', tabindex: 0, role: 'button',
      'aria-label': `Tombstone in ${t.path}: ${text}. Press Enter to open.`, 'data-id': t.id,
      transform: `translate(${b.x} ${b.y})`,
    });
    const r = b.w / 2;
    g.append(
      s('title', {}, text),
      s('path', { class: 'body', d: `M0 ${b.h} V${r} A${r} ${r} 0 0 1 ${b.w} ${r} V${b.h} Z` }),
    );
    if (cracked) g.append(s('path', { class: 'crack', d: `M${b.w * 0.55} ${b.h * 0.1} l${-b.w * 0.18} ${b.h * 0.28} l${b.w * 0.2} ${b.h * 0.1} l${-b.w * 0.15} ${b.h * 0.3}` }));
    nodes.set(t.id, g);
    svg.append(g);
  }

  scroll.append(h('div', { class: 'gy-inner', style: `width:${labelW + layout.width}px` }, labels, svg));

  const show = (id: string): void => {
    const t = byId.get(id);
    if (t) caption.textContent = captionFor(t);
  };
  caption.textContent = DEFAULT_CAPTION;
  const open = (id: string, similarity?: number): void => {
    const t = byId.get(id);
    if (!t) return;
    renderTombstone(dialog, repo, t, similarity === undefined ? undefined : { similarity });
    if (!dialog.open) dialog.showModal();
  };

  svg.addEventListener('mouseover', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) show(g.dataset['id']!); });
  svg.addEventListener('focusin', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) show(g.dataset['id']!); });
  svg.addEventListener('click', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) open(g.dataset['id']!); });
  svg.addEventListener('keydown', e => {
    const g = (e.target as Element).closest<SVGGElement>('.stone');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(g.dataset['id']!); }
  });

  return {
    open,
    haunt(hits) {
      for (const g of nodes.values()) {
        g.classList.remove('haunted');
        g.querySelector('.ghost')?.remove();
      }
      let first: SVGGElement | undefined;
      for (const { id, similarity } of hits) {
        const g = nodes.get(id);
        if (!g) continue;
        g.classList.add('haunted');
        g.append(ghostGlyph(similarity));
        first ??= g;
      }
      const firstId = hits.find(x => nodes.has(x.id))?.id;
      if (firstId !== undefined) show(firstId);
      first?.scrollIntoView({ block: 'center', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
  };
}
