import './style.css';
import { clear, h } from './dom.ts';
import { loadGraveyard, loadIndex, loadStats, commitUrl, type RepoEntry, type SiteStats, type WebTombstone } from './data.ts';
import { mountGraveyard, type GraveyardView } from './graveyard-view.ts';
import { DEMO_REPO, DEMO_SNIPPET } from './demo-snippet.ts';
import { fogDensity, restLine, summon, type SummonResult } from './summon.ts';
import { EVIDENCE, headlineNumbers } from './first-screen.ts';
import { epitaph } from './layout.ts';
import { cardLine, leadWhy } from './obituary-text.ts';
import { isRevertSubject } from '../../src/core/revert.ts';
import { momentClasses, stampFor, type MomentLevel } from './moment.ts';
import { MAX_FILE_BYTES, parseDropped, parseGithubSlug, toWebGraveyard } from './your-graveyard.ts';
import type { Obituary, Tombstone } from '../../src/core/types.ts';
import { browserAudio, createSound, soundLabel } from './sound.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** localStorage, or null where the browser blocks it. */
function safeStorage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

const fmt = (n: number): string => n.toLocaleString('en-US');

function statCard(value: string, ...label: (Node | string)[]): HTMLElement {
  return h('div', { class: 'stat' }, h('dd', {}, value), h('dt', {}, ...label));
}

function ext(href: string, text: string): HTMLElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

/** The three headline numbers (from stats.json, except the reviewer-confirmed count) and the collapsed "How we counted" block. */
function renderStats(el: HTMLElement, more: HTMLElement, st: SiteStats): void {
  const n = headlineNumbers(st);
  clear(el);
  el.append(
    h('dl', { class: 'stat-list' },
      statCard(fmt(n.commits), 'commits walked, in ', String(st.repos), ' public repos'),
      n.comebacks === null
        ? statCard(fmt(st.revivals), 'comebacks found in history')
        : statCard(fmt(n.comebacks), 'comebacks found; ', fmt(n.confirmedReal), ' confirmed real by a reviewer (', ext(EVIDENCE.labels, 'labels'), ')'),
      statCard(fmt(n.viaRevert), 'comebacks via Revert, all real (', ext(EVIDENCE.readme, 'README'), ')'),
    ),
  );
  const items: [string, string][] = [
    ['repos', fmt(st.repos)],
    ['commits walked', fmt(st.commits)],
    ['tombstones mined', fmt(st.tombstones)],
    ...(st.tombstonesShown !== undefined ? [['tombstones listed', fmt(st.tombstonesShown)] as [string, string]] : []),
    ['comebacks of listed tombstones', fmt(st.revivals)],
    ['comebacks via Revert', fmt(st.revivalsViaRevert)],
    ['median gap', st.medianRevivalGapDays === null ? 'n/a' : `${st.medianRevivalGapDays} days`],
  ];
  clear(more);
  more.append(
    h('dl', { class: 'stat-list' }, ...items.map(([k, v]) => statCard(v, k))),
    h('p', { class: 'muted small' }, `Measured by the deja-boo CLI on ${st.repos} public repos (requests, express, axios, flask, got, httpie/cli) when this page was built. Gap = days from burial to revival. A revival is one commit (one patch), however many tombstones it brings back.${
      st.revivalsAllTombstones !== undefined && st.revivalsAllTombstones !== st.revivals
        ? ` The list leaves out tombstones whose code is still alive at HEAD; counting their revivals too gives ${fmt(st.revivalsAllTombstones)}.`
        : ''}`),
    h('p', { class: 'muted small' }, `${fmt(n.confirmedReal)} confirmed real is the reviewer's count, not in stats.json: see `, ext(EVIDENCE.labels, 'research/labels/'), ' and the ', ext(EVIDENCE.readme, 'README'), '.'),
  );
}

/** Lead-card reason: short label with the PR link, then the quoted text (set as text, never HTML), then a small note. null without obituary text. */
function leadWhyNode(t: WebTombstone): HTMLElement | null {
  const w = leadWhy(t.obituary);
  if (w === null) return null;
  return h('div', { class: 'why' },
    h('p', { class: 'why-label' }, w.href ? h('a', { href: w.href, target: '_blank', rel: 'noopener noreferrer' }, w.label) : w.label),
    h('blockquote', { class: 'why-quote' }, `\u201C${w.quote}\u201D`),
    h('p', { class: 'muted small' }, w.note),
  );
}

/** One evidence card: level, %, epitaph, commit, verbatim cause, obituary line. Used in the list and as the lead card beside the graveyard. */
function ghostCard(repo: RepoEntry, hit: SummonResult['hits'][number], i: number, lead = false): HTMLElement {
  const t = hit.tombstone as unknown as WebTombstone;
  const pct = Math.round(hit.similarity * 100);
  const url = commitUrl(repo.github, t.commit);
  const label = hit.level === 'block' ? 'BLOCK' : 'WARN';
  return h('article', { class: `ghost-card ${hit.level}` },
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
    lead ? leadWhyNode(t) : cardLine(t.obituary) === '' ? null : h('p', { class: 'obituary-line' }, cardLine(t.obituary)),
    h('p', { class: 'rest' }, restLine(t.id)),
    h('button', { type: 'button', class: 'btn', 'data-open': t.id, 'data-sim': String(hit.similarity) }, 'Open the tombstone'),
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

  res.hits.forEach((hit, i) => out.append(ghostCard(repo, hit, i)));

  if (res.rested.length) {
    out.append(h('p', { class: 'muted' }, `Resting (acknowledged in your code): ${res.rested.map(r => `${r.tombstone.id.slice(0, 10)} at ${Math.round(r.similarity * 100)}%`).join(', ')}`));
  }
  out.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b =>
    b.addEventListener('click', () => view.open(b.dataset['open']!, Number(b.dataset['sim']))));
}

async function main(): Promise<void> {
  const [index, stats] = await Promise.all([loadIndex(), loadStats()]);
  renderStats($('stats'), $('stats-more'), stats);

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
    $('gy-summary').textContent = `${repo.name}: ${tombs.length} tombstones watched (${cracked} cracked by a Revert), from ${repo.mined} mined. Stones still alive at HEAD are not shown, except Reverts.${
      tombs.length > 0 ? '' : repo.mined === 0 ? ' This graveyard is empty: the file has no tombstones, so there is nothing to draw.' : ' Nothing to draw: every mined tombstone is still alive at HEAD.'}`;
    $('sm-repo').textContent = repo.name;
    view = mountGraveyard($('gy-scroll'), $('gy-caption'), dialog, repo, tombs);
    setFog(0);
    clearMoment();
    clear($('sm-out'));
    clear($('gy-verdict'));
  }

  function setFog(n: number): void {
    $('fog').style.opacity = String(fogDensity(n));
    $('gy-wrap').classList.toggle('foggy', n > 0);
    $('fog-text').textContent = n === 0 ? 'Fog: clear. No revenants are active.' : `Fog: thick. ${n} revenant${n === 1 ? '' : 's'} active.`;
  }

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const sound = createSound(safeStorage(), browserAudio);
  const soundBtn = $<HTMLButtonElement>('sound');
  soundBtn.textContent = soundLabel(sound.enabled());
  soundBtn.addEventListener('click', () => { soundBtn.textContent = soundLabel(sound.toggle()); });

  const MOMENT_WRAP = ['hit', 'hit-block', 'hit-warn', 'calm'];
  /** Remove the stamp, the red edge, the lead evidence card and the "hit" state. A new summon or a new repo starts from here. */
  function clearMoment(): void {
    clear($('gy-stamp'));
    clear($('gy-evidence'));
    $('gy-evidence').hidden = true;
    $('gy-stage').classList.remove('has-evidence');
    $('gy-wrap').classList.remove(...MOMENT_WRAP);
    $('edge').className = 'edge';
  }

  /** Stamp, edge tint, lead evidence card and sound for a summon that has hits. */
  function showMoment(repoEntry: RepoEntry, res: SummonResult, level: MomentLevel): void {
    const reduced = reducedQuery.matches;
    const cls = momentClasses(level, reduced);
    $('gy-wrap').classList.add(...cls.wrap);
    const edge = $('edge');
    edge.className = 'edge';
    void edge.offsetWidth; // restart the one-second flash
    edge.classList.add(...cls.edge);

    const st = stampFor(level)!;
    $('gy-stamp').append(h('div', { class: `stamp ${level}` }, h('p', { class: 'word' }, st.word), h('p', { class: 'line' }, st.line)));

    const ev = $('gy-evidence');
    clear(ev);
    ev.append(
      h('h3', { class: 'ev-title' }, 'Evidence'),
      ghostCard(repoEntry, res.hits[0]!, 0, true),
      res.hits.length > 1 ? h('p', { class: 'muted small' }, `${res.hits.length} ghosts in all. `, h('a', { href: '#sm-out' }, 'All of them and your marked code are below.')) : h('p', { class: 'muted small' }, h('a', { href: '#sm-out' }, 'Your code with the haunted lines marked is below.')),
    );
    ev.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => b.addEventListener('click', () => view?.open(b.dataset['open']!, Number(b.dataset['sim']))));
    ev.hidden = false;
    $('gy-stage').classList.add('has-evidence');
    sound.play(level);
  }

  function run(): void {
    const text = ($('sm-input') as HTMLTextAreaElement).value;
    const res = summon(tombs, text);
    clearMoment();
    setFog(res.hits.length);
    view?.haunt(res.hits.map(x => ({ id: x.tombstone.id, similarity: x.similarity })));
    renderHits($('sm-out'), repo, res, text, view!);
    const top = res.hits[0];
    clear($('gy-verdict'));
    if (top) {
      showMoment(repo, res, top.level);
      const t = top.tombstone as unknown as WebTombstone;
      $('gy-verdict').append(`${top.level === 'block' ? 'BLOCK' : 'WARN'}: ${Math.round(top.similarity * 100)}% similar to ${t.path}, ${epitaph(t)}. `, h('a', { href: '#sm-out' }, 'Read the full result'));
    }
  }

  const FIXTURE = 'haunted-http';
  for (const r of [...index].sort((a, b) => Number(a.name === FIXTURE) - Number(b.name === FIXTURE))) {
    picker.append(h('button', { type: 'button', class: 'chip', 'data-repo': r.name, 'aria-pressed': 'false' }, r.name === FIXTURE ? `${r.name} (fixture)` : r.name));
  }
  picker.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-repo]');
    if (b) void select(b.dataset['repo']!);
  });
  $('sm-go').addEventListener('click', run);
  async function demo(): Promise<void> {
    ($('sm-input') as HTMLTextAreaElement).value = DEMO_SNIPPET;
    await select(DEMO_REPO);
    run();
  }
  $('sm-demo').addEventListener('click', async () => {
    await demo();
    $('sm-out').scrollIntoView({ block: 'nearest' });
  });
  // Hero button: same demo, then the haunted stone (scrolled to by haunt) and the verdict line stay in view.
  const heroDemo = async (e: Event): Promise<void> => {
    e.preventDefault();
    await demo();
    $('gy-wrap').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  $('hero-demo').addEventListener('click', heroDemo);
  document.querySelector('[data-demo]')?.addEventListener('click', heroDemo);

  setupYours();
  await select(repo.name);

  /** "Your graveyard": read in the browser with the File API, never stored or sent. */
  function setupYours(): void {
    const zone = $('yours-drop');
    const msg = $('yours-msg');
    const slugInput = $<HTMLInputElement>('yours-slug');
    const fileInput = $<HTMLInputElement>('yours-file');
    let raw: Tombstone[] | null = null;
    let obits: Record<string, Obituary> | null = null;
    let entry: RepoEntry | null = null;

    const say = (text: string, error = false): void => { msg.textContent = text; msg.classList.toggle('error', error); };
    const fail = (reason: string): void => say(`This is not a deja-boo graveyard: ${reason}`, true);
    const nextFrame = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()));

    /** The slug field's value: a valid `owner/name`, null when empty or invalid (with a note). */
    function slug(): string | null {
      const v = slugInput.value.trim();
      if (v === '') return null;
      const ok = parseGithubSlug(v);
      if (ok === null) say('That is not an owner/name (for example pallets/click). Commit links stay off.', true);
      return ok;
    }

    async function show(label: string): Promise<void> {
      const data = toWebGraveyard(raw!, obits);
      if (entry) {
        cache.delete(entry.name);
        index.splice(index.indexOf(entry), 1);
        picker.querySelector(`[data-repo="${CSS.escape(entry.name)}"]`)?.remove();
      }
      entry = { name: `yours: ${label}`, github: slug(), tombstones: data.length, mined: raw!.length };
      index.unshift(entry);
      cache.set(entry.name, data);
      picker.prepend(h('button', { type: 'button', class: 'chip', 'data-repo': entry.name, 'aria-pressed': 'false' }, entry.name));
      await select(entry.name);
      say(`Read ${raw!.length} tombstones in your browser; nothing was uploaded.${obits ? ' Obituaries merged.' : ''}${
        slugInput.value.trim() !== '' && entry.github === null ? ' The owner/name is not valid (for example pallets/click), so commit links are off.' : ''}`);
    }

    async function open(files: File[], folder: string | null): Promise<void> {
      say('Reading…');
      await nextFrame();
      let graveyard: Tombstone[] | null = null;
      let obit: Record<string, Obituary> | null = null;
      let label: string | null = null;
      for (const f of files) {
        if (f.size > MAX_FILE_BYTES) return fail(`${f.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
        let text: string;
        try { text = await f.text(); } catch { return fail(`${f.name} could not be read`); }
        const p = parseDropped(f.name, text);
        if (p.kind === 'error') return fail(p.reason);
        if (p.kind === 'graveyard') { graveyard = p.tombstones; label = folder ?? f.name; } else obit = p.obituaries;
      }
      if (graveyard === null && raw === null) return fail('drop graveyard.json together with obituaries.json (or first)');
      if (graveyard === null && obit === null) return fail('no graveyard.json found');
      const prev = { raw, obits };
      if (graveyard !== null) { raw = graveyard; obits = obit; } else obits = obit;
      await nextFrame();
      try { await show(label ?? entry?.name.slice('yours: '.length) ?? 'graveyard.json'); } catch (e) { raw = prev.raw; obits = prev.obits; fail(String(e)); }
    }

    $('yours-pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { const fs = [...(fileInput.files ?? [])]; fileInput.value = ''; if (fs.length) void open(fs, null); });
    slugInput.addEventListener('change', () => {
      say('');
      const github = slug();
      if (entry) { entry.github = github; if (repo === entry) void select(entry.name); }
    });

    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('over');
      const dt = e.dataTransfer;
      if (!dt) return;
      // The DataTransfer is only valid during this event: take files and folder entries now, read them after.
      const plain = [...dt.files];
      const dirs = [...dt.items].map(i => i.webkitGetAsEntry?.() ?? null).filter((x): x is FileSystemEntry => x !== null && x.isDirectory);
      if (dirs.length === 0) { if (plain.length) void open(plain, null); return; }
      void (async () => {
        const found: File[] = [];
        for (const d of dirs) await collect(d, 0, found);
        void open(found.length ? found : plain, dirs[0]!.name);
      })().catch(() => fail('the folder could not be read'));
    });
  }
}

/** Find graveyard.json and obituaries.json inside a dropped folder (at most 3 levels deep, no .git or node_modules). */
async function collect(entry: FileSystemEntry, depth: number, out: File[]): Promise<void> {
  if (entry.isFile) {
    if (/^(graveyard|obituaries)\.json$/i.test(entry.name)) out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    return;
  }
  if (depth >= 3 || entry.name === '.git' || entry.name === 'node_modules') return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    for (const child of batch) await collect(child, depth + 1, out);
  }
}

main().catch((err: unknown) => {
  $('gy-summary').textContent = `The graveyard failed to load: ${String(err)}`;
});
