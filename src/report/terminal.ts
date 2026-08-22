import type { Report, Status, CriterionVerdict } from '../verify/conformance.js';
import { SEVERITY } from '../verify/conformance.js';

/**
 * Terminal reporting.
 *
 * The report leads with the number that matters and then explains only what is
 * wrong. A conformance tool that prints a wall of green is a tool people stop
 * reading; passing criteria are summarised, failing ones are itemised with the
 * file and line needed to act on them.
 */

/**
 * Evaluated per call, not captured at module load: NO_COLOR must be honoured
 * however late it is set, and library consumers may toggle it between renders.
 */
function useColor(): boolean {
  return !process.env.NO_COLOR && process.stdout.isTTY !== false;
}

const c = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);

const dim = c('2');
const bold = c('1');
const red = c('31');
const amber = c('33');
const green = c('32');
const cyan = c('36');
const grey = c('90');

const STATUS_STYLE: Record<Status, { label: string; paint: (s: string) => string; glyph: string }> = {
  broken:     { label: 'BROKEN',     paint: red,   glyph: 'x' },
  drifted:    { label: 'DRIFTED',    paint: amber, glyph: '~' },
  malformed:  { label: 'MALFORMED',  paint: amber, glyph: '?' },
  orphan:     { label: 'ORPHAN',     paint: cyan,  glyph: 'o' },
  unverified: { label: 'UNVERIFIED', paint: grey,  glyph: '.' },
  conformant: { label: 'CONFORMANT', paint: green, glyph: '+' },
};

function bar(report: Report, width = 48): string {
  if (report.total === 0) return dim('-'.repeat(width));
  const segments: string[] = [];
  let used = 0;
  const present = SEVERITY.slice().reverse().filter((s) => report.counts[s] > 0);
  present.forEach((status, i) => {
    const n = report.counts[status];
    const isLast = i === present.length - 1;
    const cells = isLast ? Math.max(0, width - used) : Math.max(1, Math.round((n / report.total) * width));
    used += cells;
    segments.push(STATUS_STYLE[status].paint('█'.repeat(cells)));
  });
  return segments.join('');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function headline(report: Report): string {
  const score = pct(report.conformance);
  const painted =
    report.conformance === 1 ? green(score) : report.conformance >= 0.8 ? amber(score) : red(score);
  return `${bold('CONFORMANCE')}  ${painted}  ${dim(`${report.counts.conformant}/${report.total} criteria proven`)}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function renderVerdict(v: CriterionVerdict, indent = '  '): string[] {
  const style = STATUS_STYLE[v.status];
  const lines: string[] = [];
  const spec = v.criterion.qualifiedId.split('/')[0];

  lines.push(
    `${indent}${style.paint(style.glyph)} ${bold(v.criterion.qualifiedId.padEnd(28))} ${style.paint(style.label)}`,
  );
  lines.push(`${indent}  ${dim(truncate(v.criterion.raw, 96))}`);
  lines.push(`${indent}  ${style.paint('->')} ${v.reason}`);

  for (const b of v.bindings.slice(0, 3)) {
    const tag = b.kind === 'proof' ? 'test' : 'impl';
    lines.push(`${indent}    ${grey(`${tag}  ${b.file}:${b.line}`)}`);
  }
  lines.push(`${indent}    ${grey(`spec  .kiro/specs/${spec}/requirements.md:${v.criterion.line}`)}`);
  lines.push('');
  return lines;
}

export function renderReport(report: Report, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [];
  const rule = dim('-'.repeat(64));

  out.push('');
  out.push(`${bold('shall verify')} ${dim('- this repository against its own specification')}`);
  out.push(rule);
  out.push('');

  if (report.total === 0) {
    out.push(`  ${amber('No acceptance criteria found.')}`);
    out.push(`  ${dim('Expected .kiro/specs/<name>/requirements.md with EARS criteria.')}`);
    out.push('');
    return out.join('\n');
  }

  out.push(`  ${headline(report)}`);
  out.push(`  ${bar(report)}`);
  out.push('');

  const legend = SEVERITY.filter((s) => report.counts[s] > 0)
    .map((s) => `${STATUS_STYLE[s].paint(STATUS_STYLE[s].glyph)} ${report.counts[s]} ${dim(STATUS_STYLE[s].label.toLowerCase())}`)
    .join('   ');
  out.push(`  ${legend}`);
  out.push('');

  if (!report.testsRan) {
    out.push(`  ${amber('!')} ${report.testError ?? 'test suite did not run'} ${dim('- criteria cannot be proven without it')}`);
    out.push('');
  }

  const actionable = report.verdicts.filter(
    (v) => v.status !== 'conformant' && (opts.verbose || v.status !== 'unverified'),
  );
  const ordered = actionable.sort(
    (a, b) =>
      SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status) ||
      a.criterion.qualifiedId.localeCompare(b.criterion.qualifiedId),
  );

  if (ordered.length > 0) {
    out.push(rule);
    out.push('');
    for (const v of ordered) out.push(...renderVerdict(v));
  }

  if (report.dangling.length > 0) {
    out.push(rule);
    out.push('');
    out.push(`  ${bold('DANGLING ANNOTATIONS')} ${dim('- code referencing criteria that do not exist')}`);
    out.push('');
    for (const d of report.dangling) {
      out.push(`  ${red('x')} ${d.binding.file}:${d.binding.line}  ${dim(`@shall ${d.binding.ref}`)}`);
      out.push(`      ${d.reason}`);
    }
    out.push('');
  }

  const hidden = report.verdicts.filter((v) => v.status === 'unverified').length;
  if (!opts.verbose && hidden > 0) {
    out.push(`  ${dim(`${hidden} unverified criteria hidden - run with --verbose to list them`)}`);
    out.push('');
  }

  return out.join('\n');
}

/** Exit non-zero only for states that represent a broken contract. */
export function exitCodeFor(report: Report, strict: boolean): number {
  if (report.counts.broken > 0 || report.counts.drifted > 0) return 1;
  if (report.dangling.length > 0) return 1;
  if (strict && (report.counts.orphan > 0 || report.counts.malformed > 0 || report.counts.unverified > 0)) {
    return 1;
  }
  return 0;
}
