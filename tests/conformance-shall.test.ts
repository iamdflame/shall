import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { programCriteria } from '../dist/shall/lang/types.js';
import { checkConformance, conformanceBlocks } from '../dist/shall/conform/check.js';
import { parseProposals } from '../dist/shall/conform/expectations.js';

const program = parseShall(readFileSync('examples/word-count.fixed.shall', 'utf8'), 'f.shall').program!;
const criteria = programCriteria(program);

/** Splits on whitespace, keeps tokens of 3+ characters. Matches the spec. */
const CORRECT = `
export function run({ text }) {
  return text.split(/\\s+/).filter((t) => t.length >= 3).length;
}`;

/** Agrees with itself, but silently drops tokens containing punctuation. */
const VIOLATES = `
export function run({ text }) {
  return text.split(/\\s+/).filter((t) => t.length >= 3 && /^[A-Za-z]+$/.test(t)).length;
}`;

const expect = (id: string, text: string, expected: unknown, why = 'derived') => ({
  criterionId: id, input: { text }, expected, why, agreement: 3,
});

test('a program satisfying every clause reports full conformance', () => {
  const agreed = [
    expect('1.1', 'well-known state-of-the-art', 2),
    expect('2.1', 'a ab abc', 1),
    expect('3.1', 'one two three', 3),
    expect('3.2', '', 0),
  ];
  const report = checkConformance(CORRECT, criteria, agreed, [], 500);
  assert.equal(report.score, 1);
  assert.equal(report.violations, 0);
  assert.equal(report.totalPassed, 4);
  assert.equal(conformanceBlocks(report), false);
  assert.ok(report.criteria.every((c) => c.status === 'satisfied'));
});

// @shall 5.3
test('THE POINT: agreement does not imply correctness', () => {
  // Both readers would return this program; it still contradicts clause 1.1,
  // which says punctuation must not affect tokenisation.
  const agreed = [expect('1.1', 'well-known state-of-the-art', 2, 'no matter which hyphens it contains')];
  const report = checkConformance(VIOLATES, criteria, agreed, [], 500);

  assert.equal(report.violations, 1);
  assert.equal(conformanceBlocks(report), true, 'a violated clause must block the build');

  const violated = report.criteria.find((c) => c.criterion.id === '1.1')!;
  assert.equal(violated.status, 'violated');
  assert.equal(violated.failures.length, 1);
  assert.deepEqual(violated.failures[0].input, { text: 'well-known state-of-the-art' });
  assert.equal(violated.failures[0].expected, 2);
  assert.match(violated.reason, /contradict the built program/);
});

// @shall 5.4
test('a clause the readers could not agree about is undetermined, not passed', () => {
  const disputed = [
    { criterionId: '2.1', input: { text: 'a-b' }, proposals: [{ value: 0, count: 1 }, { value: 1, count: 1 }] },
  ];
  const report = checkConformance(CORRECT, criteria, [], disputed, 500);

  const c = report.criteria.find((x) => x.criterion.id === '2.1')!;
  assert.equal(c.status, 'undetermined');
  assert.match(c.reason, /could not agree/);
  assert.equal(report.undetermined, criteria.length, 'no clause has evidence, so none is satisfied');
  assert.equal(report.score, 0, 'an unchecked clause must never count as satisfied');
});

test('a runtime error counts as a violation, not a pass', () => {
  const throwing = 'export function run(){ throw new Error("nope"); }';
  const report = checkConformance(throwing, criteria, [expect('3.1', 'a b c', 0)], [], 500);
  const c = report.criteria.find((x) => x.criterion.id === '3.1')!;
  assert.equal(c.status, 'violated');
  assert.equal(c.failures[0].actual.ok, false);
});

test('malformed criteria are excluded from the score rather than failing it', () => {
  const bad = parseShall(
    'program P\ninterface\n  input x: integer\n  output y: integer\nRequirement 1: R\n  the system should maybe work\n  THE SYSTEM SHALL return x\n',
    'p.shall',
  ).program!;
  const badCriteria = programCriteria(bad);
  const report = checkConformance(
    'export function run({x}){ return x; }',
    badCriteria,
    [{ criterionId: '1.2', input: { x: 5 }, expected: 5, why: '', agreement: 2 }],
    [],
    500,
  );
  assert.equal(report.criteria.find((c) => c.criterion.id === '1.1')!.status, 'malformed');
  assert.equal(report.criteria.find((c) => c.criterion.id === '1.2')!.status, 'satisfied');
  assert.equal(report.score, 1, 'the one checkable clause is satisfied');
});

test('proposals must match the declared interface to be counted', () => {
  const ok = JSON.stringify([{ input: { text: 'hi there' }, expected: 2, why: 'two tokens' }]);
  assert.equal(parseProposals(ok, program).length, 1);

  for (const bad of [
    JSON.stringify([{ input: {}, expected: 0 }]),
    JSON.stringify([{ input: { text: 'a', extra: 1 }, expected: 0 }]),
    JSON.stringify([{ input: { text: 'a' } }]),
    'not json',
  ]) {
    assert.equal(parseProposals(bad, program).length, 0, `should reject: ${bad}`);
  }
});

test('proposals wrapped in a markdown fence are still read', () => {
  const fenced = '```json\n[{"input":{"text":"a b"},"expected":0,"why":"both short"}]\n```';
  assert.equal(parseProposals(fenced, program).length, 1);
});
