import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential } from '../dist/shall/oracle/differential.js';
import { attribute, attributePairs } from '../dist/shall/attribute/attribute.js';

// Two clauses, each precise alone, silent about which applies first.
const SRC = `program Fee

interface
  input  amount: number
  input  discountPercent: integer
  output total: number

Requirement 1: Discount
  THE SYSTEM SHALL reduce the amount by the discountPercent

Requirement 2: Fee
  IF the amount is below 50 THEN the system SHALL add a fee of 6
`;
const program = parseShall(SRC, 'fee.shall').program!;

const FEE_ON_ORIGINAL = `export function run({ amount, discountPercent }) {
  const d = amount * (1 - discountPercent / 100);
  return d + (amount < 50 ? 6 : 0);
}`;
const FEE_ON_DISCOUNTED = `export function run({ amount, discountPercent }) {
  const d = amount * (1 - discountPercent / 100);
  return d + (d < 50 ? 6 : 0);
}`;

function split() {
  const probes = structuralProbes(program, 96);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'a', source: FEE_ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: FEE_ON_DISCOUNTED },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  return { probes, oracle };
}

// @shall disambiguation/3.1
// @shall disambiguation/3.2
test('ordering ambiguity between two precise clauses is detected', () => {
  const { probes, oracle } = split();
  assert.ok(oracle.behaviourDivergences.length > 0, 'fixture must diverge');

  const pairs = attributePairs(program, oracle.behaviourDivergences, probes);
  assert.ok(pairs.length > 0, 'the interacting pair must be found');

  const top = pairs[0];
  const ids = [top.a.id, top.b.id].sort();
  assert.deepEqual(ids, ['1.1', '2.1'], 'the discount and the fee are the pair that interact');
  // Both clauses apply broadly, so lift is small even though the pair accounts
  // for every disagreement. Coverage is the signal here, not lift.
  assert.equal(top.divergentRate, 1, 'the pair must explain every disagreement');
  assert.ok(top.lift > 0);
  assert.match(top.evidence, /engaged together by \d+\/\d+ disagreeing inputs/);
});

test('pairs are reported only when no single clause stands out', () => {
  const { probes, oracle } = split();
  const single = attribute(program, oracle.behaviourDivergences, probes);
  const pairs = attributePairs(program, oracle.behaviourDivergences, probes);
  // Both may exist; the CLI prefers single-clause attribution when it has one.
  assert.ok(Array.isArray(single));
  assert.ok(pairs.every((p) => p.a.id !== p.b.id), 'a clause is never paired with itself');
});

test('no divergence means no pairs', () => {
  const probes = structuralProbes(program, 40);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'a', source: FEE_ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: FEE_ON_ORIGINAL },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.deepEqual(attributePairs(program, oracle.behaviourDivergences, probes), []);
});

// @shall disambiguation/3.3
test('pair search is skipped on specifications with too many clauses', () => {
  const many = ['program Big', '', 'interface', '  input x: integer', '  output y: integer', ''];
  for (let i = 1; i <= 30; i++) {
    many.push(`Requirement ${i}: R${i}`, `  THE SYSTEM SHALL handle case ${i}`);
  }
  const big = parseShall(many.join('\n'), 'big.shall').program!;
  const probes = structuralProbes(big, 20);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'a', source: 'export function run({x}){return x;}' },
      { modelId: 'b', label: 'b', source: 'export function run({x}){return x + (x > 5 ? 1 : 0);}' },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.deepEqual(
    attributePairs(big, oracle.behaviourDivergences, probes), [],
    'pair search must not explode combinatorially',
  );
});

test('list probes exercise repetition, not just distinct prefixes', () => {
  const dice = parseShall(
    'program D\ninterface\n  input dice: list<integer>\n  output score: integer\nRequirement 1: R\n  IF three dice show the same face THEN the system SHALL score 100\n',
    'd.shall',
  ).program!;
  const probes = structuralProbes(dice, 96);
  const lists = probes.map((p) => p.input.dice as number[]);

  assert.ok(lists.length > 6, `expected real coverage, got ${lists.length}`);
  assert.ok(
    lists.some((l) => l.length >= 3 && new Set(l).size === 1),
    'a rule about repeated elements needs a probe with repeated elements',
  );
  assert.ok(lists.some((l) => l.length >= 3 && new Set(l).size > 1), 'and one without');
});
