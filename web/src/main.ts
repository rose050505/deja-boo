import './style.css';
import { clear, h } from './dom.ts';
import { loadGraveyard, loadIndex, loadStats, commitUrl, type RepoEntry, type SiteStats, type WebTombstone } from './data.ts';
import { mountGraveyard, type GraveyardView } from './graveyard-view.ts';
import { DEMO_REPO, DEMO_SNIPPET } from './demo-snippet.ts';
import { fogDensity, restLine, summon, type SummonResult } from './summon.ts';
import { epitaph } from './layout.ts';
import { cardLine } from './obituary-text.ts';
import { isRevertSubject } from '../../src/core/revert.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const fmt = (n: number): string => n.toLocaleString('en-US');

function renderStats(el: HTMLElement, st: SiteStats): void {
  const items: [string, string][] = [
    ['repos', fmt(st.repos)],
    ['commits walked', fmt(st.commits)],
    ['tombstones mined', fmt(st.tombstones)],
    ...(st.tombstonesShown !== undefined ? [['tombstones listed', fmt(st.tombstonesShown)] as [string, string]] : []),
    ['revivals of listed tombstones', fmt(st.revivals)],
    ['revivals via Revert', fmt(st.revivalsViaRevert)],
    ['median gap', st.medianRevivalGapDays === null ? 'n/a' : `${st.medianRevivalGapDays} days`],
  ];
  clear(el);
  el.append(
    h('dl', { class: 'stat-list' }, ...items.map(([k, v]) => h('div', { class: 'stat' }, h('dd', {}, v), h('dt', {}, k)))),
    h('p', { class: 'muted small' }, `Measured by the deja-boo CLI on ${st.repos} public repos (requests, express, axios, flask, got, httpie/cli) when this page was built. Gap = days from burial to revival. A revival is one commit (one patch), however many tombstones it brings back.${
      st.revivalsAllTombstones !== undefined && st.revivalsAllTombstones !== st.revivals
        ? ` The list leaves out tombstones whose code is still alive at HEAD; counting their revivals too gives ${fmt(st.revivalsAllTombstones)}.`
        : ''}`),
  );
}

function renderHits(out: HTMLElement, repo: RepoEntry, res: SummonResult, text: string, view: GraveyardView): void {
  clear(out);
  if (res.hits.length === 0 && res.rested.length === 0) {
    out.append(h('p', { class: 'nothing' }, 'Nothing rises. No buried code in this graveyard matches what you pasted.'));
    return;
  }
  const lines = text.split('\n');
  const marks = new Map<number, number[]>();
  res.hits.forEach((hit, i) => {
    for (let n = hit.matchedLines[0]; n <= hit.matchedLines[1]; n++) marks.set(n, [...(marks.get(n) ?? []), i + 1]);
  });

  if (res.hits.length) {
    out.append(h('h3', {}, 'Your code, with the haunted lines marked'));
    out.append(h('ol', { class: 'pasted', 'aria-label': 'Pasted code; marked lines match buried code' },
      ...lines.map((l, i) => {
        const m = marks.get(i + 1);
        return h('li', { class: m ? 'marked' : '' },
          h('span', { class: 'gut' }, m ? m.map(n => `#${n}`).join(' ') : ''), h('code', {}, l === '' ? ' ' : l));
      })));
  }

  res.hits.forEach((hit, i) => {
    const t = hit.tombstone as unknown as WebTombstone;
    const pct = Math.round(hit.similarity * 100);
    const url = commitUrl(repo.github, t.commit);
    const label = hit.level === 'block' ? 'BLOCK' : 'WARN';
    out.append(h('article', { class: `ghost-card ${hit.level}` },
      h('h3', {},
        h('span', { class: 'badge' }, label), ` Ghost #${i + 1}: ${pct}% similar`),
      h('p', { class: 'meta' }, hit.level === 'block'
        ? 'The Kiro hook would block this write.'
        : 'The Kiro hook would warn about this write.'),
      h('p', {}, `Lines ${hit.matchedLines[0]}-${hit.matchedLines[1]} of your code match ${t.path}, buried ${t.buriedAt.slice(0, 10)}.`),
      h('p', { class: 'epitaph' }, epitaph(t)),
      h('p', {}, 'Commit ', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, h('code', {}, t.commit)) : h('code', {}, t.commit),
        ' · id ', h('code', {}, t.id)),
      h('pre', { class: 'cause' }, t.causeOfDeath.trim() === '' ? 'cause of death unknown' : t.causeOfDeath),
      cardLine(t.obituary) === '' ? null : h('p', { class: 'obituary-line' }, cardLine(t.obituary)),
      h('p', { class: 'rest' }, restLine(t.id)),
      h('button', { type: 'button', class: 'btn', 'data-open': t.id, 'data-sim': String(hit.similarity) }, 'Open the tombstone'),
    ));
  });

  if (res.rested.length) {
    out.append(h('p', { class: 'muted' }, `Resting (acknowledged in your code): ${res.rested.map(r => `${r.tombstone.id.slice(0, 10)} at ${Math.round(r.similarity * 100)}%`).join(', ')}`));
  }
  out.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b =>
    b.addEventListener('click', () => view.open(b.dataset['open']!, Number(b.dataset['sim']))));
}

async function main(): Promise<void> {
  const [index, stats] = await Promise.all([loadIndex(), loadStats()]);
  renderStats($('stats'), stats);

  const dialog = $<HTMLDialogElement>('tomb');
  dialog.addEventListener('click', e => {
    if (e.target === dialog || (e.target as HTMLElement).closest('[data-close]')) dialog.close();
  });

  const cache = new Map<string, WebTombstone[]>();
  let repo: RepoEntry = index[0]!;
  let tombs: WebTombstone[] = [];
  let view: GraveyardView | undefined;
  const picker = document.querySelector<HTMLElement>('.repo-pick')!;

  async function select(name: string): Promise<void> {
    repo = index.find(r => r.name === name) ?? repo;
    picker.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset['repo'] === repo.name)));
    $('gy-summary').textContent = `Loading ${repo.name}…`;
    let data = cache.get(repo.name);
    if (!data) {
      data = await loadGraveyard(repo.name);
      cache.set(repo.name, data);
    }
    tombs = data;
    const cracked = tombs.filter(t => isRevertSubject(t.causeOfDeath)).length;
    $('gy-summary').textContent = `${repo.name}: ${tombs.length} tombstones watched (${cracked} cracked by a Revert), from ${repo.mined} mined. Stones still alive at HEAD are not shown, except Reverts.`;
    $('sm-repo').textContent = repo.name;
    view = mountGraveyard($('gy-scroll'), $('gy-caption'), dialog, repo, tombs);
    setFog(0);
    clear($('sm-out'));
  }

  function setFog(n: number): void {
    $('fog').style.opacity = String(fogDensity(n));
    $('gy-wrap').classList.toggle('foggy', n > 0);
    $('fog-text').textContent = n === 0 ? 'Fog: clear. No revenants are active.' : `Fog: thick. ${n} revenant${n === 1 ? '' : 's'} active.`;
  }

  function run(): void {
    const text = ($('sm-input') as HTMLTextAreaElement).value;
    const res = summon(tombs, text);
    setFog(res.hits.length);
    view?.haunt(res.hits.map(x => ({ id: x.tombstone.id, similarity: x.similarity })));
    renderHits($('sm-out'), repo, res, text, view!);
  }

  for (const r of index) {
    picker.append(h('button', { type: 'button', class: 'chip', 'data-repo': r.name, 'aria-pressed': 'false' }, r.name));
  }
  picker.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-repo]');
    if (b) void select(b.dataset['repo']!);
  });
  $('sm-go').addEventListener('click', run);
  $('sm-demo').addEventListener('click', async () => {
    ($('sm-input') as HTMLTextAreaElement).value = DEMO_SNIPPET;
    await select(DEMO_REPO);
    run();
    $('sm-out').scrollIntoView({ block: 'nearest' });
  });

  await select(repo.name);
}

main().catch((err: unknown) => {
  $('gy-summary').textContent = `The graveyard failed to load: ${String(err)}`;
});
