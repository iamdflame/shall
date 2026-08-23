import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import {
  measureCoverage, engagedPaths, vocabulary, stem, terms, leaves,
} from '../dist/shall/coverage/coverage.js';

const load = (p: string) => parseShall(readFileSync(p, 'utf8'), p).program;

/* ── stemming ──────────────────────────────────────────────────────────── */

test('stemming unifies the plural a clause uses with the singular an input has', () => {
  // This is the exact miss the old lexical check had: `dice` as an input,
  // "each remaining die" in the clause, and no match between them.
  assert.equal(stem('dice'), stem('die'));
  assert.equal(stem('words'), stem('word'));
  assert.equal(stem('boxes'), stem('box'));
  assert.equal(stem('policies'), stem('policy'));
  assert.equal(stem('counted'), stem('count'));
});

test('stemming does not collapse words that merely end in s', () => {
  assert.notEqual(stem('address'), stem('addres'));
  assert.equal(stem('address'), 'address');
  assert.equal(stem('is'), 'is');
});

test('terms splits camelCase and snake_case, and drops filler', () => {
  const t = terms('couponPercent');
  assert.ok(t.has('coupon') && t.has('percent'), [...t].join(','));
  assert.ok(terms('order_total').has('total'));
  // "the system shall" carries no information about which input is involved.
  assert.equal(terms('THE SYSTEM SHALL').size, 0);
});

/* ── the learned vocabulary ────────────────────────────────────────────── */

test("a clause naming one input teaches its other nouns as that input's vocabulary", () => {
  const program = load('examples/word-count.shall');
  const vocab = vocabulary(program);
  // "THE SYSTEM SHALL count the words in the text" binds word to text.
  assert.deepEqual([...(vocab.get('word') ?? [])], ['text']);
});

test('the vocabulary lets a clause be engaged without naming an input at all', () => {
  const program = load('examples/word-count.shall');
  const probes = structuralProbes(program, 48);
  // "SHALL ignore words shorter than three letters" mentions no input by name.
  const clause = program.requirements
    .flatMap((r) => r.criteria)
    .find((c) => /ignore words/i.test(c.raw));
  assert.ok(clause, 'fixture clause missing');

  const withText = probes.find((p) => typeof p.input.text === 'string' && p.input.text.length > 0);
  assert.ok(withText, 'no non-empty text probe');
  assert.deepEqual(engagedPaths(clause, withText, program), ['text']);
});

test('a word two clauses bind to two different inputs is not treated as an alias', () => {
  const program = parseShall(
    [
      'program Two',
      '',
      'interface',
      '  input  alpha: integer',
      '  input  beta: integer',
      '  output result: integer',
      '',
      'Requirement 1: A',
      '  THE SYSTEM SHALL add the margin to alpha',
      '',
      'Requirement 2: B',
      '  THE SYSTEM SHALL add the margin to beta',
    ].join('\n'),
    'two.shall',
  ).program;
  // "margin" points at both, so it points at neither.
  assert.equal(vocabulary(program).has('margin'), false);
});

/* ── numbers ───────────────────────────────────────────────────────────── */

test('a threshold spelled in words engages the clause like a digit would', () => {
  const program = parseShall(
    [
      'program Fee', '',
      'interface',
      '  input  quantity: integer',
      '  output fee: integer', '',
      'Requirement 1: Bulk',
      '  IF the count is at least twelve THEN the system SHALL return 0',
    ].join('\n'),
    'fee.shall',
  ).program;
  const clause = program.requirements[0]!.criteria[0]!;
  const at = { input: { quantity: 12 }, rationale: 'boundary' } as never;
  const far = { input: { quantity: 4000 }, rationale: 'far' } as never;
  assert.deepEqual(engagedPaths(clause, at, program), ['quantity'], 'twelve should read as 12');
  assert.deepEqual(engagedPaths(clause, far, program), [], 'a distant value is not at the threshold');
});

/* ── records ───────────────────────────────────────────────────────────── */

test('coverage walks into records, so a clause naming a field is engaged', () => {
  const program = parseShall(
    [
      'program Ship', '',
      'interface',
      '  input  order: { weight: integer, express?: boolean }',
      '  output cost: integer', '',
      'Requirement 1: Weight',
      '  THE SYSTEM SHALL charge one unit per unit of weight',
    ].join('\n'),
    'ship.shall',
  ).program;
  const clause = program.requirements[0]!.criteria[0]!;
  const probe = { input: { order: { weight: 5, express: true } }, rationale: '' } as never;
  // The path names where the value lives, not just that something matched.
  assert.deepEqual(engagedPaths(clause, probe, program), ['order.weight']);
});

test('leaves reports a dotted path for every scalar inside a nested value', () => {
  const type = { record: [
    { name: 'id', type: 'string' as const, optional: false },
    { name: 'lines', type: { list: { record: [
      { name: 'qty', type: 'integer' as const, optional: false },
    ] } }, optional: false },
  ] };
  const found = leaves({ id: 'x', lines: [{ qty: 1 }, { qty: 2 }] }, type, 'order');
  assert.deepEqual(found.map((l) => l.path), ['order.id', 'order.lines[].qty', 'order.lines[].qty']);
  assert.deepEqual(found.map((l) => l.value), ['x', 1, 2]);
});

/* ── the report ────────────────────────────────────────────────────────── */

test('a clause no probe can reach is reported as unexercised, not as covered', () => {
  const program = parseShall(
    [
      'program Gap', '',
      'interface',
      '  input  amount: integer',
      '  output out: integer', '',
      'Requirement 1: Main',
      '  THE SYSTEM SHALL return the amount', '',
      'Requirement 2: Orbit',
      '  IF the lunar phase is waxing THEN the system SHALL return 42',
    ].join('\n'),
    'gap.shall',
  ).program;
  const report = measureCoverage(program, structuralProbes(program, 32));

  assert.equal(report.unexercised.length, 1, 'exactly one clause is unreachable');
  assert.match(report.unexercised[0]!.criterion.raw, /lunar phase/);
  assert.ok(report.score < 1, 'the score must not claim full coverage');
  assert.equal(report.covered, report.criteria.length - 1);
});

test('every criterion of the shipped examples is exercised', () => {
  // These are the specifications the README and the findings script quote.
  // If a probe generator regresses and stops reaching a clause, the examples
  // silently start proving less than they claim to - so assert it here.
  for (const path of ['examples/word-count.shall', 'examples/order-total.shall', 'examples/dice-score.shall']) {
    const program = load(path);
    const report = measureCoverage(program, structuralProbes(program, 96));
    assert.equal(
      report.unexercised.length, 0,
      `${path} leaves ${report.unexercised.map((u) => u.criterion.id).join(', ')} untested`,
    );
    assert.equal(report.score, 1);
  }
});

test('coverage counts probes, so the rate distinguishes a rare clause from a common one', () => {
  const program = load('examples/order-total.shall');
  const probes = structuralProbes(program, 96);
  const report = measureCoverage(program, probes);
  assert.equal(report.probes, probes.length);
  for (const row of report.criteria) {
    assert.ok(row.rate > 0 && row.rate <= 1, `${row.criterion.id} rate ${row.rate}`);
    assert.equal(row.engaged, Math.round(row.rate * probes.length));
  }
});

test('a malformed criterion is excluded rather than counted as a coverage failure', () => {
  const program = parseShall(
    [
      'program Bad', '',
      'interface',
      '  input  amount: integer',
      '  output out: integer', '',
      'Requirement 1: Fine',
      '  THE SYSTEM SHALL return the amount', '',
      'Requirement 2: Broken',
      '  the amount is probably fine',
    ].join('\n'),
    'bad.shall',
  ).program;
  const report = measureCoverage(program, structuralProbes(program, 16));
  // The parser already reports malformed lines; coverage must not double-report
  // them as untested, which would blame the author twice for one mistake.
  assert.equal(report.criteria.length, 1);
  assert.equal(report.score, 1);
});
