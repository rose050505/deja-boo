import { clear, h, s } from './dom.ts';
import { commitUrl, type RepoEntry, type WebTombstone } from './data.ts';
import { epitaph, isCracked, layoutStones, type Layout } from './layout.ts';
import { ghostOpacity } from './summon.ts';
import { BIG_GHOST_SCALE, ghostScale } from './moment.ts';
import { REVERT_STONE_LABEL, centerInView, initialStoneId, labelPlacement, tipPosition, tooltipFor } from './first-screen.ts';
import { OBITUARY_NOTE, excerptText, obituaryHeading, obituaryRefs, titleText } from './obituary-text.ts';

/** Empty sky above the first row (px, matches `.gy-inner` padding-top) so the large ghost is never cut off. */
const SKY = 48;
/** How far the big ghost rises above its stone's top edge (px): 3.5 x 21 + 8 of the glyph, rounded up. */
const GHOST_RISE = 66;
/** Width reserved for the big percentage text (22px bold, up to "100%"). */
const PCT_W = 60;

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

/** The dialog's obituary section under the cause: heading, linked PR or issue, title, quoted excerpt. Nothing when the tombstone has none. */
function obituaryNodes(t: WebTombstone): Node[] {
  return obituaryRefs(t.obituary).flatMap(({ kind, ref }) => {
    const href = safeLink(ref.url);
    const label = `${kind} #${ref.number}`;
    return [
      h('h4', {}, obituaryHeading(kind, ref, t.obituary!.fetchedAt)),
      h('p', { class: 'obit-ref' }, href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label) : label, `: ${titleText(ref)}`),
      h('blockquote', { class: 'obituary' }, `\u201C${excerptText(ref)}\u201D`),
      h('p', { class: 'muted small' }, OBITUARY_NOTE),
    ];
  });
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
    ...obituaryNodes(t),
    t.links.length
      ? h('p', {}, 'Links: ', ...t.links.flatMap((l, i) => {
          const href = safeLink(l.url);
          const label = `${l.type === 'pr' ? 'PR' : l.type === 'issue' ? 'issue' : 'ref'} #${l.ref}`;
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

const GHOST_PATH = 'M-9 0 V-12 A9 9 0 0 1 9 -12 V0 L6 -3 L3 0 L0 -3 L-3 0 L-6 -3 Z';

/**
 * A ghost standing on a stone's top edge. Opacity = similarity; the percentage is written next to it.
 * The large one (the first hit) is the same glyph scaled up, so it rises out of the stone it haunts.
 */
function ghostGlyph(similarity: number, box: { x: number; y: number; w: number }, scale: number): SVGGElement {
  const big = scale > 1;
  const pct = `${Math.round(similarity * 100)}%`;
  return s('g', { class: big ? 'ghost big' : 'ghost', transform: `translate(${box.x + box.w / 2} ${box.y})` },
    s('g', { class: 'ghost-body', opacity: ghostOpacity(similarity), transform: big ? `translate(0 8) scale(${scale}) translate(0 26)` : 'translate(0 18)' },
      s('path', { d: GHOST_PATH, transform: 'translate(0 -26)' }),
      s('circle', { cx: -3, cy: -40, r: 1.6, class: 'eye' }),
      s('circle', { cx: 3, cy: -40, r: 1.6, class: 'eye' }),
    ),
    big
      ? s('text', { x: 9 * BIG_GHOST_SCALE + 8, y: -26, class: 'ghost-pct big' }, pct)
      : s('text', { x: 12, y: -14, class: 'ghost-pct' }, pct),
  );
}

/** Caption text for a stone: epitaph, Revert mark, path. */
export function captionFor(t: WebTombstone): string {
  return `${epitaph(t)}${isCracked(t) ? ' (Revert)' : ''} · ${t.path}`;
}

let escHide: () => void = () => undefined;
if (typeof document !== 'undefined') document.addEventListener('keydown', e => { if (e.key === 'Escape') escHide(); });

export function mountGraveyard(
  scroll: HTMLElement,
  caption: HTMLElement,
  dialog: HTMLDialogElement,
  repo: RepoEntry,
  tombstones: readonly WebTombstone[],
): GraveyardView {
  const byId = new Map(tombstones.map(t => [t.id, t] as const));
  const layout: Layout = layoutStones(tombstones);
  clear(scroll);

  const labels = h('div', { class: 'row-labels', style: `height:${layout.height}px` },
    ...layout.rows.map(r => h('div', { class: 'row-label', title: `${r.name} (${r.count})`, 'aria-label': `${r.name}, ${r.count} tombstones`, style: `top:${r.y}px;height:${r.h}px` }, h('span', { class: 'rl-name' }, r.name), h('small', {}, ` ${r.count}`))));
  /** Width of the sticky label column now (150 px, 68 px below 600 px; set in CSS). */
  const labelW = (): number => labels.offsetWidth || 150;

  const svg = s('svg', {
    class: 'stones', width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: 'group', 'aria-label': `${tombstones.length} tombstones of ${repo.name}, by date and directory`,
  });
  // Shared paints: stone shading (grey top-left to moss, dark base) and the grass strip.
  svg.append(s('defs', {},
    s('linearGradient', { id: 'stone-grad', x1: 0, y1: 0, x2: 0.7, y2: 1 },
      s('stop', { offset: '0', class: 'st-hi' }), s('stop', { offset: '0.55', class: 'st-mid' }), s('stop', { offset: '1', class: 'st-lo' })),
    s('pattern', { id: 'grass-pat', width: 14, height: 9, patternUnits: 'userSpaceOnUse' },
      s('rect', { width: 14, height: 9, class: 'soil' }),
      s('path', { class: 'blade', d: 'M1 9 L2 3 L3.5 9 Z M6 9 L7.5 2 L9 9 Z M10.5 9 L11.5 4 L13 9 Z' })),
  ));
  // Row bands, a grassy ground strip under each row, and year ticks.
  layout.rows.forEach((r, i) => svg.append(
    s('rect', { x: 0, y: r.y, width: layout.width, height: r.h, class: i % 2 ? 'band b1' : 'band b0' }),
    s('g', { transform: `translate(0 ${r.y + r.h - 9})` }, s('rect', { width: layout.width, height: 9, fill: 'url(#grass-pat)' })),
  ));
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
      s('path', { class: 'body', fill: 'url(#stone-grad)', d: `M0 ${b.h} V${r} A${r} ${r} 0 0 1 ${b.w} ${r} V${b.h} Z` }),
    );
    if (cracked) g.append(s('path', { class: 'crack', d: `M${b.w * 0.55} ${b.h * 0.1} l${-b.w * 0.18} ${b.h * 0.28} l${b.w * 0.2} ${b.h * 0.1} l${-b.w * 0.15} ${b.h * 0.3}` }));
    nodes.set(t.id, g);
    svg.append(g);
  }

  // Label next to the opening stone. pointer-events: none (CSS) so it never blocks a click on another stone.
  const openId = initialStoneId(repo.name, tombstones);
  const openBox = layout.stones.find(b => b.id === openId);
  let stoneLabel: SVGTextElement | null = null;
  if (openBox) {
    stoneLabel = s('text', { class: 'stone-label', x: openBox.x + openBox.w + 6, y: openBox.y + 16 }, REVERT_STONE_LABEL);
    svg.append(stoneLabel);
    nodes.get(openBox.id)?.setAttribute('aria-label', `Tombstone in ${byId.get(openBox.id)!.path}: ${tooltipFor(byId.get(openBox.id)!)}. ${REVERT_STONE_LABEL}. Press Enter to open.`);
  }

  scroll.append(h('div', { class: 'gy-inner', style: `width:calc(var(--label-w) + ${layout.width}px)` }, labels, svg));
  const boxes = new Map(layout.stones.map(b => [b.id, b] as const));
  /** Put the stone label on the side of the stone that is visible; hidden while the big ghost stands on that stone. */
  let labelHidden = false;
  const placeLabel = (): void => {
    if (!stoneLabel || !openBox) return;
    stoneLabel.style.display = labelHidden ? 'none' : '';
    if (labelHidden) return;
    const textW = stoneLabel.getComputedTextLength?.() || REVERT_STONE_LABEL.length * 7.5;
    const lw = labelW();
    const p = labelPlacement(openBox, textW, scroll.scrollLeft + 4, scroll.scrollLeft + scroll.clientWidth - lw - 4);
    stoneLabel.setAttribute('x', String(p.x));
    stoneLabel.setAttribute('text-anchor', p.anchor);
  };
  // The stone in focus (the first haunted one, else the opening one) with its big ghost and percentage, kept centred in the visible area.
  type Box = { x: number; y: number; w: number; h: number };
  let focus: { box: Box; ghost: boolean } | null = openBox ? { box: openBox, ghost: false } : null;
  const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const centerFocus = (behavior: ScrollBehavior): void => {
    if (!focus) return;
    const { box, ghost } = focus;
    const cx = box.x + box.w / 2;
    // Ghost: from its left edge to the end of the percentage, from its top to the stone's foot (about 3.5 x the glyph, see ghostGlyph).
    const ext = ghost
      ? { left: cx - 9 * BIG_GHOST_SCALE, right: cx + 9 * BIG_GHOST_SCALE + 8 + PCT_W, top: SKY + box.y - GHOST_RISE, bottom: SKY + box.y + box.h }
      : { left: cx - box.w / 2, right: cx + box.w / 2, top: SKY + box.y, bottom: SKY + box.y + box.h };
    const to = centerInView(ext, scroll.clientWidth, scroll.clientHeight, labelW());
    scroll.scrollTo({ ...to, behavior });
  };
  if (openBox) {
    centerFocus('auto');
    placeLabel();
    let raf = 0;
    scroll.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(placeLabel); }, { passive: true });
  }

  if (typeof ResizeObserver !== 'undefined') {
    // The evidence card is laid out beside the graveyard after haunt(), which narrows this area: centre again for the new width.
    let lastW = scroll.clientWidth;
    new ResizeObserver(() => {
      if (scroll.clientWidth === lastW) return;
      lastW = scroll.clientWidth;
      centerFocus('auto');
      placeLabel();
    }).observe(scroll);
  }

  // F5: epitaph tooltip next to the stone, on hover and keyboard focus; Esc hides it.
  const wrap = scroll.parentElement!;
  wrap.querySelector('.tip')?.remove();
  const tip = h('div', { class: 'tip', role: 'tooltip', id: 'gy-tip', hidden: '' });
  wrap.append(tip);
  const hideTip = (): void => { tip.hidden = true; };
  const showTip = (g: SVGGElement): void => {
    const t = byId.get(g.dataset['id']!);
    if (!t) return;
    tip.textContent = tooltipFor(t);
    tip.hidden = false;
    const r = g.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const p = tipPosition(r, w, { width: tip.offsetWidth, height: tip.offsetHeight });
    tip.style.left = `${p.left}px`;
    tip.style.top = `${p.top}px`;
  };

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

  svg.addEventListener('mouseover', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) { show(g.dataset['id']!); showTip(g); } });
  svg.addEventListener('focusin', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) { show(g.dataset['id']!); showTip(g); } });
  svg.addEventListener('mouseout', hideTip);
  svg.addEventListener('focusout', hideTip);
  scroll.addEventListener('scroll', hideTip, { passive: true });
  escHide = hideTip;
  svg.addEventListener('click', hideTip);
  svg.addEventListener('click', e => { const g = (e.target as Element).closest<SVGGElement>('.stone'); if (g) open(g.dataset['id']!); });
  svg.addEventListener('keydown', e => {
    const g = (e.target as Element).closest<SVGGElement>('.stone');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(g.dataset['id']!); }
  });

  return {
    open,
    haunt(hits) {
      for (const g of nodes.values()) g.classList.remove('haunted');
      svg.querySelector('.ghost-layer')?.remove();
      const layer = s('g', { class: 'ghost-layer', 'pointer-events': 'none' });
      let index = 0;
      for (const { id, similarity } of hits) {
        const g = nodes.get(id);
        const box = boxes.get(id);
        if (!g || !box) continue;
        g.classList.add('haunted');
        layer.append(ghostGlyph(similarity, box, ghostScale(index++)));
      }
      // The ghost layer is last in the svg, so ghosts draw over neighbouring stones.
      if (layer.childNodes.length) svg.append(layer);
      const firstId = hits.find(x => nodes.has(x.id))?.id;
      if (firstId !== undefined) show(firstId);
      labelHidden = firstId !== undefined && firstId === openId;
      placeLabel();
      const fb = firstId === undefined ? undefined : boxes.get(firstId);
      focus = fb ? { box: fb, ghost: true } : openBox ? { box: openBox, ghost: false } : null;
      if (fb) {
        centerFocus(reduced() ? 'auto' : 'smooth');
        const behavior = reduced() ? 'auto' : 'smooth';
        wrap.scrollIntoView({ block: 'nearest', behavior });
      }
    },
  };
}
