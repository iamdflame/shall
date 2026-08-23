#!/usr/bin/env node
/**
 * Reproduce every documented finding, offline, from committed recordings.
 *
 * A finding stated in a README is an anecdote. A finding a stranger can re-run
 * in ten seconds, against the same reader outputs the author saw, is a result.
 * This script needs no API key and spends nothing.
 *
 * Exits non-zero if any finding fails to reproduce, so it is also a regression
 * test on the claims themselves.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { parseShall } from '../dist/shall/lang/parser.js';
import { buildCompilerInput } from '../dist/shall/compile/prompt.js';
import { readRecording, readManifest } from '../dist/shall/compile/recordings.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential, buildVerdict } from '../dist/shall/oracle/differential.js';
import { boundaries, isStraddled, targetedProbes } from '../dist/shall/coverage/targeted.js';

const ROOT = process.cwd();
const NO_COLOR = Boolean(process.env.NO_COLOR);
const c = (code, s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const green = (s) => c('32', s);
const red = (s) => c('31', s);
const amber = (s) => c('33', s);

const CROSS_GENERATION = [
  'openai:gpt-4o', 'openai:gpt-4.1', 'openai:o4-mini',
  'openai:gpt-5.2', 'openai:gpt-5.6-luna', 'openai:gpt-5.6-terra',
];
const SAME_FAMILY = [
  'openai:gpt-5/high', 'openai:gpt-5/low',
  'openai:gpt-5-mini/high', 'openai:gpt-5-mini/low', 'openai:gpt-5-nano',
];

function key(compilerInput, modelId) {
  return createHash('sha256')
    .update(['v1', modelId, compilerInput].join('\n---\n'))
    .digest('hex')
    .slice(0, 32);
}

function load(path, modelIds) {
  const program = parseShall(readFileSync(path, 'utf8'), path).program;
  const input = buildCompilerInput(program);
  const sources = [];
  for (const id of modelIds) {
    const k = key(input, id);
    const source = readRecording(ROOT, k);
    if (source === null) return { program, sources: null, missing: id };
    sources.push({ modelId: id, label: id.replace('openai:', ''), source, key: k });
  }
  return { program, sources };
}

function analyse(path, modelIds, probeCount) {
  const { program, sources, missing } = load(path, modelIds);
  if (!sources) throw new Error(`no recording for ${missing} on ${path} — run \`shall record ${path}\``);
  const probes = structuralProbes(program, probeCount);
  const result = runDifferential(sources, { probes, executionTimeoutMs: 1000 });
  return { program, probes, result, sources, verdict: buildVerdict(result, 2) };
}

/**
 * Say what is about to happen before doing it.
 *
 * Finding 2 executes tens of thousands of sandboxed calls and previously printed
 * nothing while it did, so a slow machine looked indistinguishable from a hang.
 * A line that names the work and then reports how long it took is enough.
 */
function step(label, fn) {
  const tty = Boolean(process.stdout.isTTY);
  // A carriage return only erases on a real terminal. When the output is piped
  // or captured - which is exactly what happens when someone records it - the
  // line has to be written once and left alone.
  if (tty) process.stdout.write(dim(`    … ${label}`));
  else console.log(dim(`    … ${label}`));

  const started = Date.now();
  const out = fn();
  const ms = Date.now() - started;

  if (tty) process.stdout.write(`\r${' '.repeat(label.length + 10)}\r`);
  if (ms > 1500) console.log(dim(`    (${(ms / 1000).toFixed(1)}s)`));
  return out;
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`    ${green('✓')} ${label}`);
  } else {
    failures++;
    console.log(`    ${red('✗')} ${label}${detail ? dim(` — ${detail}`) : ''}`);
  }
}

console.log('');
const SCRIPT_STARTED = Date.now();
console.log(bold('Reproducing the documented findings'));
console.log(dim('  from committed recordings — no API key, no spend'));
const manifest = readManifest(ROOT);
console.log(dim(`  ${Object.keys(manifest.readers).length} recorded readers across ${Object.keys(manifest.programs).length} programs`));
console.log('');

/* ── Finding 1 ─────────────────────────────────────────────────────────── */

console.log(bold('  FINDING 1  ') + 'An ensemble of one model family shares its blind spots');
console.log(dim('  Five same-generation variants call a specification unanimous — while two of'));
console.log(dim('  them write comments proving they noticed the ambiguity and picked a side.'));
console.log('');

{
  const { result, sources, verdict } = step('replaying 5 same-family readers', () =>
    analyse('examples/order-total.shall', SAME_FAMILY, 96));
  check(`5 same-family readers report one behaviour`, result.groups.length === 1,
    `got ${result.groups.length} groups`);
  check('the build is accepted', verdict.ok === true);

  const admissions = sources
    .map((s) => ({
      label: s.label,
      line: s.source.split('\n').find((l) => /\/\/.*(after|before).*(discount|coupon)/i.test(l)),
    }))
    .filter((a) => a.line);

  check(`at least one reader silently resolved the ambiguity in a comment`,
    admissions.length > 0, 'none found');
  for (const a of admissions) {
    console.log(`        ${dim(a.label.padEnd(16))} ${amber(a.line.trim())}`);
  }
}

console.log('');

/* ── Finding 2 ─────────────────────────────────────────────────────────── */

console.log(bold('  FINDING 2  ') + 'Human intuition about ambiguity is unreliable');
console.log(dim('  A clause humans read two ways ("IF the order is below 50") is unanimous across'));
console.log(dim('  six model generations at 5,000 probes. A mundane one ("count the words") is not.'));
console.log('');

{
  const coupon = step('running 6 readers against 5,000 probes', () =>
    analyse('examples/order-total.shall', CROSS_GENERATION, 5000));
  check(`the "ambiguous" coupon spec is unanimous at ${coupon.probes.length} probes`,
    coupon.result.behaviourDivergences.length === 0,
    `${coupon.result.behaviourDivergences.length} disagreements`);

  const words = step('running 6 readers against the word-count probes', () =>
    analyse('examples/word-count.shall', CROSS_GENERATION, 96));
  check(`the "obvious" word-count spec splits into ${words.result.groups.length} behaviours`,
    words.result.groups.length > 1, 'no split');
  check('and the split is witnessed by concrete inputs',
    words.result.behaviourDivergences.length > 0);

  const w = words.result.behaviourDivergences[0];
  if (w) {
    console.log(`        ${dim('witness')} ${JSON.stringify(w.probe.input)}`);
    for (const r of w.readings) {
      console.log(`        ${bold(String(r.display).padEnd(6))} ${dim(r.members.join(', '))}`);
    }
  }
}

console.log('');

/* ── Finding 3 ─────────────────────────────────────────────────────────── */

console.log(bold('  FINDING 3  ') + 'Some ensemble disagreement is arithmetic, not English');
console.log(dim('  Two readers that understood the specification identically can still differ, because'));
console.log(dim('  IEEE 754 is not associative. Reporting that as ambiguity blames an innocent clause.'));
console.log('');

{
  const program = parseShall(readFileSync('examples/order-total.shall', 'utf8'), 'x').program;
  const probes = structuralProbes(program, 200);
  const A = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1 - p) * 1.08;
  }`;
  const B = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1.08 * (1 - p));
  }`;
  const result = step('comparing two orderings of the same arithmetic', () =>
    runDifferential(
      [{ modelId: 'a', label: 'left-assoc', source: A }, { modelId: 'b', label: 'right-assoc', source: B }],
      { probes, executionTimeoutMs: 1000 },
    ));

  check('the two orderings differ numerically', result.numericDivergences.length > 0,
    'no float noise produced');
  check('but no genuine disagreement is reported', result.behaviourDivergences.length === 0,
    `${result.behaviourDivergences.length} false positives`);
  check('and the build is accepted', buildVerdict(result, 2).ok === true);

  const d = result.numericDivergences[0];
  if (d) {
    console.log(`        ${dim('example')} ${JSON.stringify(d.probe.input)}`);
    for (const r of d.readings) {
      console.log(`        ${bold(String(r.display).padEnd(24))} ${dim(r.members.join(', '))}`);
    }
  }
}

console.log('');

/* ── Finding 4 ─────────────────────────────────────────────────────────── */

console.log(bold('  FINDING 4  ') + 'Ambiguity hides between precise sentences, not only inside vague ones');
console.log(dim('  Every clause of the dice specification is precise on its own. The static lint'));
console.log(dim('  reports nothing. The readers still split, because two clauses do not say which'));
console.log(dim('  applies first - and only running them finds it.'));
console.log('');

{
  const { lintVagueness } = await import('../dist/shall/attribute/attribute.js');
  const { program, result } = step('replaying the dice specification', () =>
    analyse('examples/dice-score.shall', CROSS_GENERATION, 96));

  check('the static lint finds nothing to complain about',
    lintVagueness(program).length === 0,
    `${lintVagueness(program).length} warnings`);
  check('yet the readers still split', result.groups.length > 1,
    'no split - the list probes may have regressed');

  const w = result.behaviourDivergences[0];
  if (w) {
    console.log(`        ${dim('witness')} ${JSON.stringify(w.probe.input)}`);
    for (const r of w.readings) {
      console.log(`        ${bold(String(r.display).padEnd(6))} ${dim(r.members.join(', '))}`);
    }
  }

  // A hand-picked roll as well as the generated ones. Structural probes never
  // produce this exact hand, but it is the clearest illustration of the
  // interaction: three matching dice scored once as a set, or twice.
  const { loadCandidate, display: show } = await import('../dist/shall/execute/sandbox.js');
  const { sources } = load('examples/dice-score.shall', CROSS_GENERATION);
  const hand = { dice: [1, 1, 1, 2, 2] };
  const answers = new Map();
  for (const s of sources) {
    let out;
    try { out = show(loadCandidate(s.source).run(hand, 1000)); } catch { continue; }
    const entry = answers.get(out) ?? [];
    entry.push(s.label);
    answers.set(out, entry);
  }
  const ranked = [...answers.entries()].sort((a, b) => b[1].length - a[1].length);

  check('a hand of three matching dice splits them too', ranked.length > 1,
    'no split on [1,1,1,2,2]');
  console.log(`        ${dim('roll')}    ${JSON.stringify(hand.dice)}`);
  for (const [value, who] of ranked) {
    console.log(`        ${bold(String(value).padEnd(6))} ${dim(who.join(', '))}`);
  }
}

/* ── Finding 5 ─────────────────────────────────────────────────────────── */

console.log(bold('  FINDING 5  ') + 'The probes that find ambiguity are the ones the requirements ask for');
console.log(dim('  Probes derived from the interface know the shape of the inputs and nothing about'));
console.log(dim('  what the clauses say, so they can leave a stated boundary untouched. Reading the'));
console.log(dim('  boundary out of the requirement and probing it finds a split nothing else did.'));
console.log('');

{
  const path = 'examples/dice-score.shall';
  const program = parseShall(readFileSync(path, 'utf8'), path).program;
  const base = structuralProbes(program, 96);

  const five = boundaries(program, base).find((b) => b.at === 5 && b.field === 'dice');
  check('the specification states a boundary at five dice', Boolean(five));
  check('and no interface-derived probe ever goes above it',
    Boolean(five) && five.above === false,
    'a structural probe already holds six dice');

  const made = targetedProbes(program, base, 24);
  const six = made.find((p) => Array.isArray(p.input.dice) && p.input.dice.length === 6);
  check('so one probe is synthesised to sit just above it', Boolean(six),
    `${made.length} targeted probes, none with six dice`);

  const { loadCandidate, display: show } = await import('../dist/shall/execute/sandbox.js');
  const { sources } = load(path, CROSS_GENERATION);

  const readAt = (dice) => {
    const answers = new Map();
    for (const s of sources) {
      let out;
      try { out = show(loadCandidate(s.source).run({ dice }, 1000)); } catch { continue; }
      answers.set(out, [...(answers.get(out) ?? []), s.label]);
    }
    return [...answers.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  const atFive = readAt([1, 1, 1, 1, 1]);
  const atSix = readAt([1, 1, 1, 1, 1, 1]);

  check('five dice showing the same face: every reader agrees', atFive.length === 1,
    `${atFive.length} readings`);
  check('six dice showing the same face: they do not', atSix.length > 1,
    'no split at six');
  check('and the disagreement is three-way, not two', atSix.length >= 3,
    `${atSix.length} readings`);

  console.log('');
  for (const [dice, ranked] of [[[1, 1, 1, 1, 1], atFive], [[1, 1, 1, 1, 1, 1], atSix]]) {
    console.log(`        ${dim('roll')}    ${JSON.stringify(dice)}  ${ranked.length === 1 ? dim('unanimous') : amber(`${ranked.length} readings`)}`);
    for (const [value, who] of ranked) {
      console.log(`        ${bold(String(value).padEnd(6))} ${dim(who.join(', '))}`);
    }
  }
  console.log('');
  console.log(dim('  Nobody wrote that probe. The requirement did: "IF five dice show the same'));
  console.log(dim('  face" says where it turns, and the tool asked what happens one step past it.'));
}

console.log('');

if (failures > 0) {
  console.log(`  ${red(`${failures} finding(s) failed to reproduce`)}`);
  process.exit(1);
}
console.log(`  ${green('all findings reproduced')} ${dim(`— no API key, no spend, ${((Date.now() - SCRIPT_STARTED) / 1000).toFixed(0)}s`)}`);
console.log('');
