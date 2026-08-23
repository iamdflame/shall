import { describe } from '../ears/parser.js';
import type { Report, Status } from '../verify/conformance.js';
/**
 * Self-contained HTML conformance report.
 *
 * Deliberately not a dashboard. The visual job here is to make one thing
 * instantly legible across a room: which requirements are still true. So the
 * page is an instrument, not a template - near-black ground, a single signal
 * colour, hairline rules, and one violent jump in type scale from the headline
 * number to everything else.
 *
 * No external requests: no CDN, no webfont, no analytics. The file opens from
 * disk, offline, forever - which is also what lets anyone open it, and what the
 * test suite asserts by pattern rather than trusting.
 *
 * The escaping matters more than it looks. Every string on this page comes from
 * a requirements document or a source file, and a criterion is free to contain
 * "<script>" as part of the behaviour it describes.
 */
const PALETTE = {
    bg: '#08090b',
    panel: '#0d0f12',
    ink: '#e9e5dd',
    dim: '#565b63',
    signal: '#ffb020',
    alarm: '#ff4438',
    line: 'rgba(233,229,221,0.09)',
};
const STATUS_COLOR: Record<Status, string> = {
    broken: PALETTE.alarm,
    drifted: PALETTE.signal,
    malformed: PALETTE.signal,
    orphan: PALETTE.dim,
    unverified: PALETTE.dim,
    conformant: PALETTE.ink,
};
const STATUS_LABEL: Record<Status, string> = {
    broken: 'broken',
    drifted: 'drifted',
    malformed: 'malformed',
    orphan: 'orphan',
    unverified: 'unverified',
    conformant: 'conformant',
};
function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
export function renderHtml(report: Report): string {
    const nodes = report.verdicts.map((v) => ({
        id: v.criterion.qualifiedId,
        status: v.status,
        label: v.criterion.id,
        text: describe(v.criterion.clauses) || v.criterion.raw,
        reason: v.reason,
        spec: v.criterion.qualifiedId.split('/')[0] ?? '',
        specLine: v.criterion.line,
        impls: v.bindings.filter((b) => b.kind === 'implementation').map((b) => ({ file: b.file, line: b.line })),
        proofs: v.bindings
            .filter((b) => b.kind === 'proof')
            .map((b) => {
            const p = v.proofs.find((x) => x.name === b.testName);
            return {
                file: b.file,
                line: b.line,
                name: b.testName ?? '(unnamed)',
                passed: p?.passed ?? false,
                found: p?.found ?? false,
            };
        }),
    }));
    const score = (report.conformance * 100).toFixed(1);
    const counts = report.counts;
    const generated = new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16);
    const orderedStatuses: Status[] = ['broken', 'drifted', 'malformed', 'orphan', 'unverified', 'conformant'];
    const legend = orderedStatuses
        .filter((s) => counts[s] > 0)
        .map((s) => `<button class="chip" data-filter="${s}">
        <span class="dot" style="background:${STATUS_COLOR[s]}"></span>
        <b>${counts[s]}</b> ${STATUS_LABEL[s]}
      </button>`)
        .join('');
    const barSegments = orderedStatuses
        .slice()
        .reverse()
        .filter((s) => counts[s] > 0)
        .map((s) => `<i style="flex:${counts[s]};background:${STATUS_COLOR[s]};${s === 'drifted' || s === 'broken' ? 'animation:pulse 2.4s ease-in-out infinite;' : ''}"></i>`)
        .join('');
    const rows = report.verdicts
        .slice()
        .sort((a, b) => orderedStatuses.indexOf(a.status) - orderedStatuses.indexOf(b.status) ||
        a.criterion.qualifiedId.localeCompare(b.criterion.qualifiedId))
        .map((v) => {
        const n = nodes.find((x) => x.id === v.criterion.qualifiedId)!;
        const links = [
            ...n.impls.map((i) => `<span class="ref">impl <em>${esc(i.file)}:${i.line}</em></span>`),
            ...n.proofs.map((p) => `<span class="ref${p.found && p.passed ? '' : ' bad'}">test <em>${esc(p.file)}:${p.line}</em></span>`),
            `<span class="ref muted">spec <em>.kiro/specs/${esc(n.spec)}/requirements.md:${n.specLine}</em></span>`,
        ].join('');
        return `<article class="row" data-status="${v.status}">
        <div class="row-id"><span class="dot" style="background:${STATUS_COLOR[v.status]}"></span>${esc(v.criterion.qualifiedId)}</div>
        <div class="row-body">
          <p class="claim">${esc(n.text)}</p>
          <p class="reason" style="color:${STATUS_COLOR[v.status]}">${esc(v.reason)}</p>
          <div class="refs">${links}</div>
        </div>
        <div class="row-status" style="color:${STATUS_COLOR[v.status]}">${STATUS_LABEL[v.status]}</div>
      </article>`;
    })
        .join('');
    const warning = report.testsRan
        ? ''
        : `<div class="warn">test suite did not run &mdash; ${esc(report.testError ?? 'unknown reason')}. Nothing can be proven without it.</div>`;
    const dangling = report.dangling.length
        ? `<section class="block">
        <h2>Dangling annotations</h2>
        <p class="sub">Code claiming criteria that do not exist in any spec.</p>
        ${report.dangling
            .map((d) => `<div class="dangle"><em>${esc(d.binding.file)}:${d.binding.line}</em> <code>@shall ${esc(d.binding.ref)}</code><span>${esc(d.reason)}</span></div>`)
            .join('')}
      </section>`
        : '';
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SHALL &mdash; conformance report</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:${PALETTE.bg}; --panel:${PALETTE.panel}; --ink:${PALETTE.ink};
    --dim:${PALETTE.dim}; --signal:${PALETTE.signal}; --alarm:${PALETTE.alarm};
    --line:${PALETTE.line};
    --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,'JetBrains Mono','Cascadia Code',Consolas,monospace;
  }
  html,body{margin:0;padding:0}
  body{
    background:var(--bg); color:var(--ink); font-family:var(--mono);
    font-size:13px; line-height:1.55; letter-spacing:0.01em;
    -webkit-font-smoothing:antialiased;
    background-image:radial-gradient(circle at 18% -10%,rgba(255,176,32,.05),transparent 55%);
  }
  .wrap{max-width:1180px;margin:0 auto;padding:0 32px 120px}
  @media(max-width:640px){.wrap{padding:0 18px 80px}}

  header{padding:72px 0 40px;border-bottom:1px solid var(--line)}
  .eyebrow{display:flex;gap:16px;align-items:baseline;color:var(--dim);
    font-size:10px;text-transform:uppercase;letter-spacing:.34em}
  .eyebrow b{color:var(--ink);letter-spacing:.34em;font-weight:500}

  .score{display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap;margin:26px 0 0}
  .score .n{
    font-size:clamp(72px,13vw,168px); line-height:.82; font-weight:600;
    letter-spacing:-.055em; font-variant-numeric:tabular-nums;
  }
  .score .n span{font-size:.3em;letter-spacing:0;margin-left:.12em;color:var(--dim)}
  .score .meta{padding-bottom:12px;color:var(--dim);font-size:11px;max-width:290px}
  .score .meta b{color:var(--ink);font-weight:500}

  .bar{display:flex;height:5px;margin:34px 0 20px;gap:2px;overflow:hidden}
  .bar i{display:block;border-radius:1px}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{
    background:transparent;border:1px solid var(--line);color:var(--dim);
    font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;
    padding:6px 11px;cursor:pointer;display:flex;align-items:center;gap:7px;
    transition:border-color .16s,color .16s;
  }
  .chip:hover{border-color:rgba(233,229,221,.3);color:var(--ink)}
  .chip.on{border-color:var(--ink);color:var(--ink)}
  .chip b{color:var(--ink);font-weight:600}
  .dot{width:6px;height:6px;border-radius:50%;flex:none;display:inline-block}

  .warn{margin:28px 0 0;padding:13px 16px;border-left:2px solid var(--signal);
    background:rgba(255,176,32,.05);color:var(--signal);font-size:11.5px}

  .block{margin-top:64px}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.3em;color:var(--dim);
    font-weight:500;margin:0 0 4px}
  .sub{color:var(--dim);font-size:11px;margin:0 0 22px}

  .row{
    display:grid;grid-template-columns:200px 1fr 96px;gap:22px;
    padding:20px 0;border-bottom:1px solid var(--line);align-items:start;
  }
  .row[hidden]{display:none}
  .row-id{display:flex;align-items:center;gap:9px;color:var(--ink);font-size:11.5px;
    letter-spacing:.02em;word-break:break-all}
  .claim{margin:0 0 7px;color:var(--ink);font-size:12.5px;line-height:1.5}
  .reason{margin:0 0 11px;font-size:11px;opacity:.92}
  .refs{display:flex;flex-wrap:wrap;gap:6px}
  .ref{font-size:10px;color:var(--dim);border:1px solid var(--line);padding:3px 8px}
  .ref em{font-style:normal;color:rgba(233,229,221,.72)}
  .ref.bad{border-color:rgba(255,68,56,.35)}
  .ref.bad em{color:var(--alarm)}
  .ref.muted{opacity:.6}
  .row-status{font-size:10px;text-transform:uppercase;letter-spacing:.18em;text-align:right;padding-top:2px}
  @media(max-width:760px){
    .row{grid-template-columns:1fr;gap:10px}
    .row-status{text-align:left}
  }

  .dangle{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;
    padding:11px 0;border-bottom:1px solid var(--line);font-size:11px;color:var(--dim)}
  .dangle em{font-style:normal;color:var(--ink)}
  .dangle code{color:var(--alarm)}

  footer{margin-top:72px;padding-top:22px;border-top:1px solid var(--line);
    color:var(--dim);font-size:10px;letter-spacing:.06em;
    display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
</style>
</head><body>
<div class="wrap">
  <header>
    <div class="eyebrow"><b>SHALL</b><span>spec conformance</span><span>${esc(generated)}</span></div>
    <div class="score">
      <div class="n">${score}<span>%</span></div>
      <div class="meta">
        <b>${counts.conformant} of ${report.total}</b> acceptance criteria are proven by a passing test and unchanged since they were last verified.
      </div>
    </div>
    <div class="bar">${barSegments}</div>
    <div class="chips">${legend}</div>
    ${warning}
  </header>

  <section class="block">
    <h2>Criteria</h2>
    <p class="sub">Every claim the specs make, and whether the code still honours it.</p>
    ${rows}
  </section>

  ${dangling}

  <footer>
    <span>shall verify &mdash; this repository against its own specification</span>
    <span>${esc(report.specs.map((s) => s.name).join(' &middot; '))}</span>
  </footer>
</div>
<script>
(function(){
  var active = null;
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var rows = Array.prototype.slice.call(document.querySelectorAll('.row'));
  chips.forEach(function(chip){
    chip.addEventListener('click', function(){
      var f = chip.getAttribute('data-filter');
      active = (active === f) ? null : f;
      chips.forEach(function(c){ c.classList.toggle('on', c.getAttribute('data-filter') === active); });
      rows.forEach(function(r){
        r.hidden = active !== null && r.getAttribute('data-status') !== active;
      });
    });
  });
})();
</script>
</body></html>`;
}
//# sourceMappingURL=html.js.map