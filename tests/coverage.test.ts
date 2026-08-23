import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import {
  measureCoverage, engagedPaths, engagementMatrix, vocabulary, isFallback,
  referencedFields, stem, terms, leaves,
} from '../dist/shall/coverage/coverage.js';

const load = (p: string) => parseShall(readFileSync(p, 'utf8'), p).program;

/* ── stemming ──────────────────────────────────────────────────────────── */

// @shall specification-coverage/2.1
test('stemming unifies the plural a clause uses with the singular an input has', () => {
  // This is the exact miss the old lexical check had: `dice` as an input,
  // "each remaining die" in the clause, and no match between them.
  assert.equal(stem('dice'), stem('die'));
  assert.equal(stem('words'), stem('word'));
  assert.equal(stem('boxes'), stem('box'));
  assert.equal(stem('policies'), stem('policy'));
  assert.equal(stem('counted'), stem('count'));
});

// @shall specification-coverage/2.1
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

// @shall specification-coverage/2.2
test("a clause naming one input teaches its other nouns as that input's vocabulary", () => {
  const program = load('examples/word-count.shall');
  const vocab = vocabulary(program);
  // "THE SYSTEM SHALL count the words in the text" binds word to text.
  assert.deepEqual([...(vocab.get('word') ?? [])], ['text']);
});

// @shall specification-coverage/2.2
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

// @shall specification-coverage/2.4
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

// @shall specification-coverage/2.6
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

// @shall specification-coverage/2.6
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

// @shall specification-coverage/1.1
// @shall specification-coverage/1.2
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

// @shall specification-coverage/1.1
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

// @shall specification-coverage/1.1
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

// @shall specification-coverage/1.4
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

/* ── vocabulary hygiene ────────────────────────────────────────────────── */

// @shall specification-coverage/2.3
test('a response verb never becomes vocabulary for an input', () => {
  // "SHALL return the amount" would otherwise teach that "return" means
  // `amount` - and then every clause saying "return" looks engaged, reporting
  // 100% coverage on a specification nothing had tested.
  const program = parseShall(
    [
      'program Verb', '',
      'interface', '  input  amount: integer', '  output out: integer', '',
      'Requirement 1: Main', '  THE SYSTEM SHALL return the amount', '',
      'Requirement 2: Orbit',
      '  IF the lunar phase is waxing THEN the system SHALL return 42',
    ].join('\n'),
    'verb.shall',
  ).program;

  assert.equal(vocabulary(program).has('return'), false);

  const report = measureCoverage(program, structuralProbes(program, 32));
  const orbit = report.criteria.find((r) => /lunar/.test(r.criterion.raw));
  assert.ok(orbit?.unexercised, 'the unreachable clause must not be credited');
});

// @shall specification-coverage/2.5
test('an input whose name is too short to stem is still matched', () => {
  // `terms` drops words of two characters or fewer as noise, which is right for
  // prose and wrong for identifiers.
  const program = parseShall(
    [
      'program Short', '',
      'interface', '  input  n: integer', '  output out: integer', '',
      'Requirement 1: R', '  IF n is at least 10 THEN the system SHALL return 1',
    ].join('\n'),
    'short.shall',
  ).program;
  const clause = program.requirements[0]!.criteria[0]!;
  assert.deepEqual(referencedFields(clause, program), ['n']);
  assert.deepEqual(engagedPaths(clause, { input: { n: 10 }, rationale: '' } as never, program), ['n']);
});

/* ── fallbacks ─────────────────────────────────────────────────────────── */

const fallbackSpec = parseShall(
  [
    'program Fall', '',
    'interface', '  input  amount: integer', '  output out: integer', '',
    'Requirement 1: Big', '  IF the amount is above 100 THEN the system SHALL return 2', '',
    'Requirement 2: Rest', '  IF no rule above applies THEN the system SHALL return 0',
  ].join('\n'),
  'fall.shall',
).program;

// @shall specification-coverage/3.1
test('a guard saying no other rule applies marks the clause a fallback', () => {
  const [big, rest] = [
    fallbackSpec.requirements[0]!.criteria[0]!,
    fallbackSpec.requirements[1]!.criteria[0]!,
  ];
  assert.equal(isFallback(rest), true);
  assert.equal(isFallback(big), false);

  // The other spellings requirements actually use.
  const phrasings = [
    'IF none of the above match THEN the system SHALL return 0',
    'IF otherwise THEN the system SHALL return 0',
    'IF no other requirement applies THEN the system SHALL return 0',
  ];
  for (const line of phrasings) {
    const p = parseShall(
      ['program F', '', 'interface', '  input  a: integer', '  output o: integer', '',
        'Requirement 1: R', `  ${line}`].join('\n'),
      'f.shall',
    ).program;
    assert.equal(isFallback(p.requirements[0]!.criteria[0]!), true, line);
  }
});

// @shall specification-coverage/3.2
test('a fallback is engaged by exactly the probes no other clause engages', () => {
  const probes = [
    { id: 'a', input: { amount: 500 }, origin: 'structural' as const },  // "above 100" applies
    { id: 'b', input: { amount: 0 }, origin: 'structural' as const },    // nothing applies
  ];
  const matrix = engagementMatrix(fallbackSpec, probes);
  assert.deepEqual(matrix.get('1.1')!.engaged, [true, false]);
  // Exactly the complement, which is what "no rule above applies" means.
  assert.deepEqual(matrix.get('2.1')!.engaged, [false, true]);

  // And so a lexical check that could never match it does not call it untested.
  const report = measureCoverage(fallbackSpec, probes);
  assert.equal(report.unexercised.length, 0);
});

// @shall specification-coverage/3.3
test('coverage and attribution read engagement from the same result', () => {
  const program = load('examples/dice-score.shall');
  const probes = structuralProbes(program, 96);
  const matrix = engagementMatrix(program, probes);
  const report = measureCoverage(program, probes);

  for (const row of report.criteria) {
    assert.equal(
      row.engaged,
      matrix.get(row.criterion.id)!.engaged.filter(Boolean).length,
      `${row.criterion.id} disagrees between the report and the matrix`,
    );
  }
});
