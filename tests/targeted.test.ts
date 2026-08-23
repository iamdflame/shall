import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { guardNumbers, measureCoverage } from '../dist/shall/coverage/coverage.js';
import {
  boundaries, isStraddled, targetedProbes, magnitudeOf,
} from '../dist/shall/coverage/targeted.js';

const load = (p: string) => parseShall(readFileSync(p, 'utf8'), p).program;
const spec = (body: string[]) => parseShall(body.join('\n'), 't.shall').program;

/* ── what counts as a boundary ─────────────────────────────────────────── */

// @shall specification-coverage/4.1
test('every number in a guard is a boundary', () => {
  const program = spec([
    'program G', '', 'interface', '  input  n: integer', '  output out: integer', '',
    'Requirement 1: R', '  IF five items are present THEN the system SHALL return 1',
  ]);
  assert.deepEqual(guardNumbers(program.requirements[0]!.criteria[0]!), [5]);
});

// @shall specification-coverage/4.2
test('a number in a response is a payout, not a boundary', () => {
  // "score each die showing one as fifty points" - reading fifty as a threshold
  // would send probe generation chasing a fifty-element list.
  const program = spec([
    'program P', '', 'interface', '  input  dice: list<integer>', '  output score: integer', '',
    'Requirement 1: R', '  THE SYSTEM SHALL score each die showing one as fifty points',
  ]);
  assert.deepEqual(guardNumbers(program.requirements[0]!.criteria[0]!), []);
});

// @shall specification-coverage/4.2
test('a response number wearing comparison wording is still a boundary', () => {
  const program = spec([
    'program W', '', 'interface', '  input  text: string', '  output count: integer', '',
    'Requirement 1: R', '  THE SYSTEM SHALL ignore words shorter than three letters',
  ]);
  assert.deepEqual(guardNumbers(program.requirements[0]!.criteria[0]!), [3]);
});

// @shall specification-coverage/4.2
test('comparison wording is recognised after the number as well as before it', () => {
  const program = spec([
    'program A', '', 'interface', '  input  n: integer', '  output out: integer', '',
    'Requirement 1: R', '  THE SYSTEM SHALL apply a discount when 12 or more are ordered',
  ]);
  assert.deepEqual(guardNumbers(program.requirements[0]!.criteria[0]!), [12]);
});

/* ── magnitude ─────────────────────────────────────────────────────────── */

// @shall specification-coverage/4.4
test('magnitude reads a number directly and a string or list by length', () => {
  assert.equal(magnitudeOf(7, 'integer'), 7);
  assert.equal(magnitudeOf('abcd', 'string'), 4);
  assert.equal(magnitudeOf([1, 2, 3], { list: 'integer' }), 3);
  assert.equal(magnitudeOf(true, 'boolean'), undefined, 'a boolean has no magnitude to straddle');
});

// @shall specification-coverage/4.4
// @shall specification-coverage/4.5
test('a record is measured by its single numeric field, and only then', () => {
  const one = { record: [
    { name: 'id', type: 'string' as const, optional: false },
    { name: 'amount', type: 'integer' as const, optional: false },
  ] };
  assert.equal(magnitudeOf({ id: 'x', amount: 42 }, one), 42);

  const two = { record: [
    { name: 'width', type: 'integer' as const, optional: false },
    { name: 'height', type: 'integer' as const, optional: false },
  ] };
  // Two numbers and no way to know which the clause means: report nothing
  // rather than pick one and probe the wrong axis.
  assert.equal(magnitudeOf({ width: 1, height: 2 }, two), undefined);
});

/* ── straddling ────────────────────────────────────────────────────────── */

// @shall specification-coverage/4.3
test('a boundary is straddled only when probes sit below, on and above it', () => {
  const program = spec([
    'program B', '', 'interface', '  input  n: integer', '  output out: integer', '',
    'Requirement 1: R', '  IF n is at least 10 THEN the system SHALL return 1',
  ]);
  const at = (ns: number[]) => ns.map((n, i) => ({ id: `p${i}`, input: { n }, origin: 'structural' as const }));

  const [full] = boundaries(program, at([9, 10, 11]));
  assert.ok(full && isStraddled(full));

  const [partial] = boundaries(program, at([0, 1, 2]));
  assert.ok(partial && !isStraddled(partial), 'nothing at or above 10');
  assert.equal(partial.below, true);
  assert.equal(partial.on, false);
  assert.equal(partial.above, false);
});

/* ── generation ────────────────────────────────────────────────────────── */

// @shall specification-coverage/5.1
// @shall specification-coverage/5.4
test('an unstraddled boundary produces probes on the missing sides only', () => {
  const program = spec([
    'program B', '', 'interface', '  input  n: integer', '  output out: integer', '',
    'Requirement 1: R', '  IF n is at least 10 THEN the system SHALL return 1',
  ]);
  const existing = [0, 1, 2].map((n, i) => ({ id: `p${i}`, input: { n }, origin: 'structural' as const }));
  const made = targetedProbes(program, existing, 16);

  const values = made.map((p) => p.input.n).sort((a, b) => (a as number) - (b as number));
  assert.deepEqual(values, [10, 11], 'below was already covered');
  assert.ok(made.every((p) => p.targets === '1.1'));
  assert.match(made[0]!.rationale!, /turns at 10/);
});

// @shall specification-coverage/5.1
test('a straddled boundary produces nothing', () => {
  const program = spec([
    'program B', '', 'interface', '  input  n: integer', '  output out: integer', '',
    'Requirement 1: R', '  IF n is at least 10 THEN the system SHALL return 1',
  ]);
  const existing = [9, 10, 11].map((n, i) => ({ id: `p${i}`, input: { n }, origin: 'structural' as const }));
  assert.deepEqual(targetedProbes(program, existing, 16), []);
});

// @shall specification-coverage/5.3
test('a targeted probe varies only the field its boundary is about', () => {
  const program = spec([
    'program M', '', 'interface',
    '  input  quantity: integer', '  input  label: string', '  output out: integer', '',
    'Requirement 1: R', '  IF the quantity is above 4 THEN the system SHALL return 1',
  ]);
  const made = targetedProbes(program, [], 16);
  assert.ok(made.length > 0);
  // Changing `label` too could engage a different clause and credit this one.
  assert.ok(made.every((p) => p.input.label === ''), JSON.stringify(made.map((p) => p.input)));
});

// @shall specification-coverage/5.7
test('generation respects its budget', () => {
  const program = load('examples/dice-score.shall');
  assert.equal(targetedProbes(program, [], 3).length <= 3, true);
  assert.equal(targetedProbes(program, [], 0).length, 0);
});

// @shall specification-coverage/5.6
test('targeted probes never duplicate one the run already has', () => {
  const program = load('examples/dice-score.shall');
  const base = structuralProbes(program, 96);
  const made = targetedProbes(program, base, 24);
  const existing = new Set(base.map((p) => JSON.stringify(p.input)));
  for (const p of made) {
    assert.equal(existing.has(JSON.stringify(p.input)), false, `duplicate ${JSON.stringify(p.input)}`);
  }
  assert.equal(new Set(made.map((p) => JSON.stringify(p.input))).size, made.length, 'internally unique');
});

/* ── the whole point ───────────────────────────────────────────────────── */

// @shall specification-coverage/5.1
// @shall specification-coverage/5.5
test('the dice specification has a boundary its structural probes never reach', () => {
  // "IF five dice show the same face" turns at five, and the interface-derived
  // probes top out below six - so nothing ever asks what happens with six. The
  // recorded ensemble splits three ways on that input. This asserts the gap is
  // found; findings.mjs asserts the split it exposes.
  const program = load('examples/dice-score.shall');
  const base = structuralProbes(program, 96);

  const five = boundaries(program, base).find((b) => b.at === 5 && b.field === 'dice');
  assert.ok(five, 'the boundary at five must be detected');
  assert.equal(five.above, false, 'no structural probe holds more than five dice');

  const made = targetedProbes(program, base, 24);
  const sixes = made.filter((p) => Array.isArray(p.input.dice) && p.input.dice.length === 6);
  assert.equal(sixes.length, 1, 'exactly one probe should fill the gap');
  assert.deepEqual(sixes[0]!.input.dice, [1, 1, 1, 1, 1, 1], 'and the faces must match to engage the rule');
});

// @shall specification-coverage/5.2
test('a clause nothing engaged gets a probe that makes its inputs non-default', () => {
  const program = spec([
    'program Reach', '',
    'interface', '  input  label: string', '  output out: integer', '',
    'Requirement 1: R', '  THE SYSTEM SHALL return the length of the label',
  ]);
  // Only the empty string, so the clause is engaged by nothing: `isDefault`
  // treats "" as the input sitting idle.
  const idle = [{ id: 'p0', input: { label: '' }, origin: 'structural' as const }];
  assert.equal(measureCoverage(program, idle).unexercised.length, 1);

  const made = targetedProbes(program, idle, 8);
  assert.ok(made.length > 0, 'the gap must be filled');
  assert.ok(made.every((p) => p.input.label !== ''), 'and filled with something non-default');
  assert.equal(measureCoverage(program, [...idle, ...made]).unexercised.length, 0);
});
