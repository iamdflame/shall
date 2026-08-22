import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential } from '../dist/shall/oracle/differential.js';
import { attribute, lintVagueness } from '../dist/shall/attribute/attribute.js';

const program = parseShall(readFileSync('examples/order-total.shall', 'utf8'), 'examples/order-total.shall').program!;
const fixed = parseShall(readFileSync('examples/order-total.fixed.shall', 'utf8'), 'f.shall').program!;

const ON_ORIGINAL = `
export function run({ subtotal, couponPercent }) {
  const pct = Math.min(100, Math.max(0, couponPercent));
  const discounted = subtotal * (1 - pct / 100);
  const shipping = subtotal < 50 ? 6 : 0;
  return Math.round((discounted + shipping) * 1.08 * 100) / 100;
}`;
const ON_DISCOUNTED = `
export function run({ subtotal, couponPercent }) {
  const pct = Math.min(100, Math.max(0, couponPercent));
  const discounted = subtotal * (1 - pct / 100);
  const shipping = discounted < 50 ? 6 : 0;
  return Math.round((discounted + shipping) * 1.08 * 100) / 100;
}`;

function diverge() {
  const probes = structuralProbes(program, 96);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'reader-a', source: ON_ORIGINAL },
      { modelId: 'b', label: 'reader-b', source: ON_DISCOUNTED },
      { modelId: 'c', label: 'reader-c', source: ON_ORIGINAL },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  return { probes, oracle };
}

test('the top attribution is the clause that is actually ambiguous', () => {
  const { probes, oracle } = diverge();
  const results = attribute(program, oracle.divergences, probes);

  assert.ok(results.length > 0, 'expected at least one implicated clause');
  const top = results[0];
  assert.equal(top.criterion.id, '2.1', 'the shipping threshold clause is the ambiguous one');
  assert.match(top.criterion.raw, /IF the order is below 50/);
  assert.equal(top.vagueTerm, 'the order');
  assert.match(top.vagueWhy ?? '', /original subtotal or the amount after adjustments/);
});

// @shall 4.4
test('a clause engaged by everything is not ranked above the guilty one', () => {
  const { probes, oracle } = diverge();
  const results = attribute(program, oracle.divergences, probes);
  const taxIndex = results.findIndex((r) => r.criterion.id === '3.1');
  const shippingIndex = results.findIndex((r) => r.criterion.id === '2.1');

  assert.ok(shippingIndex >= 0);
  if (taxIndex >= 0) {
    assert.ok(
      shippingIndex < taxIndex,
      'the tax rule applies to every input, so correlation alone must not implicate it first',
    );
  }
});

test('attribution reports nothing when there is no divergence', () => {
  const probes = structuralProbes(program, 32);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'a', source: ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: ON_ORIGINAL },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.equal(oracle.unanimous, true);
  assert.deepEqual(attribute(program, oracle.divergences, probes), []);
});

test('every attribution carries countable evidence, not an assertion', () => {
  const { probes, oracle } = diverge();
  for (const r of attribute(program, oracle.divergences, probes)) {
    assert.match(r.evidence, /engaged by \d+\/\d+ disagreeing inputs but only \d+\/\d+ agreeing ones/);
    assert.ok(r.divergentRate >= 0 && r.divergentRate <= 1);
    assert.ok(r.agreeingRate >= 0 && r.agreeingRate <= 1);
  }
});

// @shall 4.3
test('the vagueness lint finds open wording without running anything', () => {
  const warnings = lintVagueness(program);
  const terms = warnings.map((w) => w.term.toLowerCase());
  assert.ok(terms.includes('the order'), 'must flag the ambiguous threshold subject');
  assert.ok(terms.some((t) => t.startsWith('round')), 'must flag rounding with no mode');
});

test('disambiguating the spec clears the lint warnings it was written to fix', () => {
  const before = lintVagueness(program).map((w) => w.term.toLowerCase());
  const after = lintVagueness(fixed).map((w) => w.term.toLowerCase());
  assert.ok(before.includes('the order'));
  assert.ok(!after.includes('the order'), 'the rewritten clause names which subtotal it means');
  assert.ok(after.length < before.length);
});

test('the lint is a warning, not a claim of ambiguity', () => {
  // "round" with no mode is flagged, but two readers may still agree on it.
  const probes = structuralProbes(program, 32);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'a', source: ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: ON_ORIGINAL },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.ok(lintVagueness(program).length > 0);
  assert.equal(oracle.unanimous, true, 'flagged wording does not imply the build must fail');
});
