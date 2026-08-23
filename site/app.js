/* ===========================================================================
   SHALL — site behaviour

   Three jobs, in order of how much they matter:

   1. The hero animates the thesis: a sentence appears, a squiggle is drawn
      under the undefined word, and the programs it produced fan out beneath it.
   2. The witness explorer is the signature interaction — real recorded outputs,
      regrouping as the visitor picks different inputs.
   3. Everything else reveals on scroll and then gets out of the way.

   Every motion path has a still equivalent under prefers-reduced-motion.
   =========================================================================== */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --- hero ---------------------------------------------------------------- */

const SENTENCE = [
  { t: 'THE SYSTEM', kw: true },
  { t: 'SHALL', kw: true },
  { t: 'count' }, { t: 'the' },
  { t: 'words', flag: true },
  { t: 'in' }, { t: 'the' }, { t: 'text' },
];

/** The three answers the recorded readers actually gave for this clause. */
const SHARDS = [
  { v: '5', who: 'gpt-4.1 · o4-mini · gpt-5.2 · gpt-5.6-terra', short: '4 readers', cls: 'a' },
  { v: '2', who: 'gpt-4o · gpt-5.6-luna', short: '2 readers', cls: 'b' },
  { v: '0', who: 'on "a-a" · five readers', short: 'on "a-a"', cls: 'a' },
];

function buildHero() {
  const el = document.getElementById('sentence');
  const stage = document.getElementById('stage');
  const shards = document.getElementById('shards');
  if (!el) return;

  SENTENCE.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.style.animationDelay = `${140 + i * 55}ms`;

    const tok = document.createElement('span');
    tok.className = `tok${w.flag ? ' flagged' : ''}${w.kw ? ' kw' : ''}`;
    tok.textContent = w.t;

    if (w.flag) {
      // The squiggle is drawn as an SVG so the stroke can animate on.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'squiggle');
      svg.setAttribute('viewBox', '0 0 80 12');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M 2 8 q 6 -9 12 0 t 12 0 t 12 0 t 12 0 t 12 0 t 12 0');
      p.style.animationDelay = `${140 + SENTENCE.length * 55 + 120}ms`;
      svg.appendChild(p);
      tok.appendChild(svg);
    }

    span.appendChild(tok);
    el.appendChild(span);
    el.appendChild(document.createTextNode(' '));
  });

  SHARDS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = `shard ${s.cls}`;
    d.style.animationDelay = `${900 + i * 130}ms`;
    d.dataset.short = s.short;
    d.innerHTML = `<b>${s.v}</b><i class="dotline"></i><span>${s.who}</span>`;
    shards.appendChild(d);
  });

  // One frame later so the animations actually run rather than being skipped.
  requestAnimationFrame(() => stage.classList.add('lit'));
}

/* --- witness explorer ---------------------------------------------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatInput(input) {
  return Object.entries(input)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ');
}

function renderGroups(divergence) {
  const box = document.getElementById('groups');
  const q = document.getElementById('question');
  if (!box) return;

  q.innerHTML =
    `<span style="color:var(--muted)">${escapeHtml(divergence.label ?? '')}</span>` +
    ` &nbsp;·&nbsp; given <code style="color:var(--ink)">${escapeHtml(formatInput(divergence.input))}</code>, each reader returns`;

  box.innerHTML = '';
  divergence.readings.forEach((r, i) => {
    const g = document.createElement('div');
    g.className = `group ${i === 0 ? 'one' : 'two'}`;
    g.style.animationDelay = REDUCED ? '0ms' : `${i * 70}ms`;
    g.innerHTML =
      `<div class="val">${escapeHtml(r.value)}</div>` +
      `<div class="chips">${r.readers.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join('')}</div>`;
    box.appendChild(g);
  });

  const foot = document.getElementById('foot-note');
  if (foot) {
    foot.innerHTML = divergence.minimised
      ? `minimised from <code>${escapeHtml(formatInput(divergence.original))}</code> · recorded 2026-08-22`
      : 'recorded 2026-08-22 · gpt-4o through gpt-5.6';
  }
}

/**
 * Finding 5, rendered from the same measurement the CLI makes.
 *
 * The two sides are the point: on the boundary the readers are unanimous, one
 * step past it they are not. Nothing on this page is typed in - if the
 * recordings change and the split goes away, the section empties itself rather
 * than keep claiming it.
 */
function buildBoundary(data) {
  const b = data?.boundary;
  const section = document.getElementById('boundary');
  if (!section) return;
  if (!b) { section.remove(); return; }

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set('b-id', b.criterion);
  set('b-clause', b.clause);
  set('b-why', b.rationale);

  for (const [key, side] of [['on', b.onBoundary], ['past', b.pastBoundary]]) {
    set(`b-${key}-input`, formatInput(side.input));
    const state = document.getElementById(`b-${key}-state`);
    if (state) {
      const n = side.readings.length;
      state.textContent = n === 1 ? 'unanimous' : `${n} readings`;
      state.className = `state ${n === 1 ? 'ok' : 'bad'}`;
    }

    // Both sides state their own count. It fills the space the unanimous side
    // would otherwise leave empty, and it says the comparison out loud rather
    // than asking the reader to count chips.
    const readers = side.readings.reduce((n, r) => n + r.readers.length, 0);
    const values = side.readings.length;
    set(
      `b-${key}-note`,
      values === 1
        ? `all ${readers} readers returned the same value`
        : `${readers} readers, ${values} different values`,
    );

    const box = document.getElementById(`b-${key}-readings`);
    if (!box) continue;
    box.innerHTML = '';
    side.readings.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = `group ${side.readings.length === 1 ? 'one' : i === 0 ? 'one' : 'two'}`;
      row.style.animationDelay = REDUCED ? '0ms' : `${i * 70}ms`;
      row.innerHTML =
        `<div class="val">${escapeHtml(r.value)}</div>` +
        `<div class="chips">${r.readers.map((n) => `<span class="chip">${escapeHtml(n)}</span>`).join('')}</div>`;
      box.appendChild(row);
    });
  }
}

function buildExplorer(data) {
  const list = document.getElementById('inputs');
  if (!list || !data?.wordCount) return;

  const divergences = data.wordCount.divergences.slice(0, 7);

  divergences.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'inp';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === 0));
    // Lead with the convention at stake; the raw input is the evidence for it.
    b.innerHTML =
      `<span class="tag">${escapeHtml(d.label ?? 'witness')}</span>` +
      escapeHtml(formatInput(d.input));

    b.addEventListener('click', () => {
      list.querySelectorAll('.inp').forEach((x) => x.setAttribute('aria-selected', 'false'));
      b.setAttribute('aria-selected', 'true');
      renderGroups(d);
    });

    list.appendChild(b);
  });

  renderGroups(divergences[0]);
}

/* --- scroll reveal ------------------------------------------------------- */

function watchReveals() {
  const items = document.querySelectorAll('.reveal');
  if (REDUCED || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('seen'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('seen');
        io.unobserve(e.target);
      });
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

/* --- chrome -------------------------------------------------------------- */

function watchNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function wireCopy() {
  const btn = document.getElementById('copy');
  const pre = document.getElementById('cmds');
  if (!btn || !pre) return;

  btn.addEventListener('click', async () => {
    // Strip the prompt markers and comments; paste what actually runs.
    const text = pre.innerText
      .split('\n')
      .map((l) => l.replace(/^\$\s?/, '').replace(/\s+#.*$/, '').trimEnd())
      .filter((l) => l.length)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1800);
    } catch {
      btn.textContent = 'Select it';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    }
  });
}

function fillStats(data) {
  if (!data?.stats) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('s-tests', data.stats.tests);
  set('s-criteria', data.stats.criteria);
  set('s-recordings', data.stats.recordings);
  set('s-readers', data.wordCount?.readers?.length ?? 6);
}

/* --- boot ---------------------------------------------------------------- */

buildHero();
watchReveals();
watchNav();
wireCopy();

fetch('/data.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    buildExplorer(data);
    buildBoundary(data);
    fillStats(data);
  })
  .catch(() => {
    // The page is a complete read without the explorer; it simply loses the
    // interactive panel rather than showing a broken one.
    const ex = document.getElementById('groups');
    if (ex) ex.innerHTML = '<div class="agree">Recorded data unavailable — see the repository.</div>';
  });
