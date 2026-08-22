import type { Program } from '../lang/types.js';
import type { OracleResult, Divergence } from '../oracle/differential.js';
import type { Attribution, VaguenessWarning, PairAttribution } from '../attribute/attribute.js';
import type { CompileFailure } from '../compile/compiler.js';

/**
 * Terminal reporting for SHALL.
 *
 * The report is written as a compiler diagnostic, because that is what it is.
 * It points at a line of English, underlines the phrase, says what is wrong, and
 * shows the evidence: a concrete input and the different answers it produced.
 * An author should be able to read it and know which words to change.
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

const RULE = '─'.repeat(66);

function sourceLine(program: Program, line: number): string {
  return program.source.split(/\r?\n/)[line - 1] ?? '';
}

/** Underline a phrase within a source line, in caret style. */
function underline(text: string, phrase: string): string | null {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return null;
  return `${' '.repeat(index)}${'~'.repeat(Math.max(1, phrase.length))}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function formatInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ');
}

function diagnostic(
  program: Program,
  attribution: Attribution,
  vagueness: VaguenessWarning[],
  witness: Divergence | undefined,
): string[] {
  const out: string[] = [];
  const { criterion } = attribution;
  const line = criterion.line;
  const text = sourceLine(program, line);
  // Prefer the attribution's own lint evidence; fall back to a lookup so the
  // renderer still works for attributions built without it.
  const term = attribution.vagueTerm ?? vagueness.find((v) => v.criterion.id === criterion.id)?.term;
  const why = attribution.vagueWhy ?? vagueness.find((v) => v.criterion.id === criterion.id)?.why;

  out.push(`  ${grey(`${program.path}:${line}`)}`);
  out.push('');
  out.push(`   ${grey('│')}  ${text.trim()}`);

  if (term && why) {
    const marks = underline(text.trimStart(), term);
    if (marks) out.push(`   ${grey('│')}  ${amber(marks)}`);
    out.push(`   ${grey('│')}`);
    out.push(`   ${grey('└─')} ${amber(why)}`);
  } else {
    out.push(`   ${grey('│')}`);
    out.push(`   ${grey('└─')} ${amber('the disagreements concentrate on this clause')}`);
  }

  out.push(`      ${dim(attribution.evidence)}`);
  out.push('');

  // @shall shall-language/4.1
  // @shall shall-language/4.2
  if (witness) {
    const minimal = witness.minimalInput;
    out.push(`   ${bold('WITNESS')}  ${cyan(formatInput(minimal ?? witness.probe.input))}`);
    if (minimal) {
      out.push(`   ${dim('  also')}  ${dim(formatInput(witness.probe.input))}`);
    }
    // Structural probes describe themselves by their own input, which the line
    // above already shows; only a distinct rationale is worth a second line.
    const rationale = witness.probe.rationale;
    if (rationale && rationale !== formatInput(witness.probe.input)) {
      out.push(`            ${dim(rationale)}`);
    }
    out.push('');
    for (const reading of witness.minimalReadings ?? witness.readings) {
      const who = reading.members.join(', ');
      out.push(`     ${bold(reading.display.padEnd(16))} ${grey(who)}`);
    }
    out.push('');
  }

  return out;
}

export interface AmbiguityReportInput {
  program: Program;
  oracle: OracleResult;
  attributions: Attribution[];
  pairs?: PairAttribution[];
  vagueness: VaguenessWarning[];
  failures: CompileFailure[];
  reason: string;
}

export function renderAmbiguity(input: AmbiguityReportInput): string {
  const { program, oracle, attributions, pairs = [], vagueness, failures, reason } = input;
  const out: string[] = [];

  out.push('');
  out.push(`${bold(red('AMBIGUOUS SPECIFICATION'))}  ${dim(program.name)}`);
  out.push(dim(RULE));
  out.push('');
  out.push(`  ${reason}.`);
  out.push(
    `  ${dim(`${oracle.loadable.length} readers, ${oracle.probes.length} probes, ${oracle.behaviourDivergences.length} disagreements`)}`,
  );
  out.push('');

  // Pair each implicated clause with the divergence that best demonstrates it.
  const used = new Set<string>();
  const shown = attributions.slice(0, 3);

  for (const attribution of shown) {
    const witness =
      oracle.behaviourDivergences.find((d) => !used.has(d.probe.id)) ?? oracle.behaviourDivergences[0];
    if (witness) used.add(witness.probe.id);
    out.push(dim(RULE));
    out.push('');
    out.push(...diagnostic(program, attribution, vagueness, witness));
  }

  if (pairs.length > 0) {
    for (const pair of pairs.slice(0, 2)) {
      out.push(dim(RULE));
      out.push('');
      out.push(`  ${amber('No single clause is responsible - these two interact')}`);
      out.push(`      ${dim(pair.evidence)}`);
      out.push('');
      out.push(`   ${grey(`${program.path}:${pair.a.line}`)}  ${pair.a.raw}`);
      out.push(`   ${grey(`${program.path}:${pair.b.line}`)}  ${pair.b.raw}`);
      out.push('');
      out.push(`   ${amber('Neither says which applies first.')}`);
      out.push('');
      const w = oracle.behaviourDivergences[0];
      if (w) {
        out.push(`   ${bold('WITNESS')}  ${cyan(formatInput(w.minimalInput ?? w.probe.input))}`);
        for (const reading of w.minimalReadings ?? w.readings) {
          out.push(`     ${bold(reading.display.padEnd(16))} ${grey(reading.members.join(', '))}`);
        }
        out.push('');
      }
    }
  } else if (attributions.length === 0 && oracle.behaviourDivergences.length > 0) {
    out.push(dim(RULE));
    out.push('');
    out.push(`  ${amber('The readers disagreed, but no single clause is clearly responsible.')}`);
    out.push(`  ${dim('The disagreement may come from an interaction between requirements.')}`);
    out.push('');
    const w = oracle.behaviourDivergences[0]!;
    out.push(`   ${bold('WITNESS')}  ${cyan(formatInput(w.probe.input))}`);
    out.push('');
    for (const reading of w.readings) {
      out.push(`     ${bold(reading.display.padEnd(16))} ${grey(reading.members.join(', '))}`);
    }
    out.push('');
  }

  if (failures.length > 0) {
    out.push(dim(RULE));
    out.push('');
    out.push(`  ${bold('ENSEMBLE DEGRADED')} ${dim('- these readers did not report')}`);
    for (const f of failures) {
      out.push(`    ${red('x')} ${f.label.padEnd(18)} ${dim(f.reason)}`);
    }
    out.push('');
  }

  out.push(dim(RULE));
  out.push('');
  out.push(`  ${dim('Edit the clause so every reader must reach the same behaviour, then rebuild.')}`);
  out.push('');

  return out.join('\n');
}

export interface SuccessReportInput {
  program: Program;
  oracle: OracleResult;
  vagueness: VaguenessWarning[];
  failures: CompileFailure[];
  outputPath: string;
  cachedCount: number;
  usage: { input: number; output: number };
}

export function renderSuccess(input: SuccessReportInput): string {
  const { program, oracle, vagueness, failures, outputPath, cachedCount, usage } = input;
  const out: string[] = [];

  out.push('');
  out.push(`${bold(green('UNAMBIGUOUS'))}  ${dim(program.name)}`);
  out.push(dim(RULE));
  out.push('');
  out.push(
    `  ${oracle.loadable.length} independent readers produced the same behaviour on all ${oracle.probes.length} probes.`,
  );
  out.push('');

  for (const candidate of oracle.loadable) {
    out.push(`    ${green('=')} ${candidate.label}`);
  }
  out.push('');

  if (vagueness.length > 0) {
    out.push(dim(RULE));
    out.push('');
    out.push(`  ${amber('WARNINGS')} ${dim('- open wording the readers happened to agree on')}`);
    out.push('');
    for (const w of vagueness.slice(0, 5)) {
      out.push(`    ${amber('!')} ${grey(`${program.path}:${w.criterion.line}`)}  ${bold(w.term)}`);
      out.push(`      ${dim(w.why)}`);
    }
    out.push('');
  }

  if (oracle.numericDivergences.length > 0) {
    out.push(dim(RULE));
    out.push('');
    out.push(`  ${amber('FLOATING-POINT DIVERGENCE')}`);
    out.push(
      `  ${dim(`readers agree on the behaviour; they differ by a few ULPs at ${oracle.numericDivergences.length} probe(s).`)}`,
    );
    out.push(`  ${dim('This is IEEE 754, not your English. State a rounding mode to remove it.')}`);
    out.push('');
    const d = oracle.numericDivergences[0]!;
    out.push(`   ${bold('EXAMPLE')}  ${cyan(formatInput(d.probe.input))}`);
    for (const reading of d.readings) {
      out.push(`     ${bold(reading.display.padEnd(24))} ${grey(reading.members.join(', '))}`);
    }
    out.push('');
  }

  if (failures.length > 0) {
    out.push(dim(RULE));
    out.push('');
    out.push(`  ${bold('ENSEMBLE DEGRADED')} ${dim('- agreement is over fewer readers than configured')}`);
    for (const f of failures) {
      out.push(`    ${red('x')} ${f.label.padEnd(18)} ${dim(f.reason)}`);
    }
    out.push('');
  }

  out.push(dim(RULE));
  out.push('');
  out.push(`  ${bold('built')}  ${outputPath}`);
  const purchased = usage.input + usage.output;
  out.push(
    `  ${dim(
      cachedCount > 0
        ? `${cachedCount}/${oracle.candidates.length} readers served from cache; ${purchased} tokens purchased`
        : `${purchased} tokens purchased`,
    )}`,
  );
  out.push('');

  return out.join('\n');
}

export function renderVaguenessOnly(program: Program, vagueness: VaguenessWarning[]): string {
  const out: string[] = [];
  out.push('');
  out.push(`${bold('shall lint')}  ${dim(program.name)}`);
  out.push(dim(RULE));
  out.push('');

  if (vagueness.length === 0) {
    out.push(`  ${green('No open wording found.')}`);
    out.push(`  ${dim('This is a lint, not a proof - run `shall check` to test for real ambiguity.')}`);
    out.push('');
    return out.join('\n');
  }

  for (const w of vagueness) {
    const text = sourceLine(program, w.criterion.line);
    out.push(`  ${grey(`${program.path}:${w.criterion.line}`)}  ${dim(`criterion ${w.criterion.id}`)}`);
    out.push(`   ${grey('│')}  ${text.trim()}`);
    const marks = underline(text.trimStart(), w.term);
    if (marks) out.push(`   ${grey('│')}  ${amber(marks)}`);
    out.push(`   ${grey('└─')} ${amber(w.why)}`);
    out.push('');
  }

  out.push(dim(`  ${vagueness.length} warning(s). These are heuristics, not proof of ambiguity.`));
  out.push('');
  return out.join('\n');
}

/* ── conformance ─────────────────────────────────────────────────────────── */

import type { ConformanceReport, CriterionStatus } from '../conform/check.js';
import { display as displayOutcome } from '../execute/sandbox.js';

const CONFORM_STYLE: Record<CriterionStatus, { mark: string; paint: (s: string) => string }> = {
  satisfied:    { mark: '+', paint: green },
  violated:     { mark: 'x', paint: red },
  undetermined: { mark: '?', paint: amber },
  malformed:    { mark: '!', paint: amber },
};

/**
 * Conformance is reported per clause, because that is the unit an author can
 * act on. A violated clause shows the derived case that contradicts it: the
 * input, what the criterion required, and what the built program actually did.
 */
export function renderConformance(program: Program, report: ConformanceReport): string {
  const out: string[] = [];

  out.push(dim(RULE));
  out.push('');
  const pct = `${(report.score * 100).toFixed(0)}%`;
  const painted = report.violations > 0 ? red(pct) : report.undetermined > 0 ? amber(pct) : green(pct);
  out.push(`  ${bold('CONFORMANCE')}  ${painted}  ${dim(`${report.totalPassed}/${report.totalChecked} derived cases hold`)}`);
  out.push('');

  for (const r of report.criteria) {
    const style = CONFORM_STYLE[r.status];
    out.push(
      `    ${style.paint(style.mark)} ${bold(r.criterion.id.padEnd(5))} ${dim(truncate(r.criterion.raw, 72))}`,
    );
    if (r.status === 'satisfied') continue;
    out.push(`        ${style.paint(r.reason)}`);

    for (const f of r.failures.slice(0, 2)) {
      out.push(`        ${grey(formatInput(f.input))}`);
      out.push(
        `          required ${bold(JSON.stringify(f.expected))}` +
          `   built program gave ${red(displayOutcome(f.actual))}`,
      );
      if (f.why) out.push(`          ${dim(truncate(f.why, 84))}`);
    }
    out.push('');
  }

  if (report.violations > 0) {
    out.push('');
    out.push(`  ${red('The readers agreed on a program that contradicts the specification.')}`);
    out.push(`  ${dim('Consensus is not correctness - this is why both are checked.')}`);
    out.push('');
  }

  return out.join('\n');
}

/* ── suggestions ─────────────────────────────────────────────────────────── */

import type { Suggestion } from '../suggest/suggest.js';
import type { Criterion } from '../../ears/types.js';

/**
 * Each behaviour group the readers formed is a coherent reading of the English.
 * Presenting them side by side turns "this is ambiguous" into a decision the
 * author can actually make, with the consequence of each choice made concrete.
 */
export function renderSuggestions(
  program: Program,
  criterion: Criterion,
  suggestions: Suggestion[],
): string {
  const out: string[] = [];
  out.push('');
  out.push(`${bold('AMBIGUOUS')}  ${dim(`${program.path}:${criterion.line}`)}`);
  out.push(dim(RULE));
  out.push('');
  out.push(`   ${grey('│')}  ${criterion.raw}`);
  out.push('');
  out.push(`  This clause splits the readers ${suggestions.length} ways. Each rewrite below would`);
  out.push(`  compile. Pick the behaviour you meant.`);
  out.push('');

  suggestions.forEach((s, i) => {
    out.push(dim(RULE));
    out.push('');
    out.push(
      `  ${bold(`[${i + 1}]`)}  ${cyan(`${s.readers.length} reader${s.readers.length === 1 ? '' : 's'}`)}` +
        `  ${dim(s.readers.join(', '))}`,
    );
    if (Object.keys(s.exampleInput).length > 0) {
      out.push(`       ${dim(`${formatInput(s.exampleInput)}  ->  ${s.exampleOutput}`)}`);
    }
    out.push('');
    out.push(`       ${s.rewrite}`);
    out.push('');
  });

  out.push(dim(RULE));
  out.push('');
  out.push(`  ${dim(`shall suggest ${program.path} --apply <n>   writes it and re-checks`)}`);
  out.push('');
  return out.join('\n');
}
