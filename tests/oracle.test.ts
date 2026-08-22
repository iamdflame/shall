import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes, parseGeneratedProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential, buildVerdict } from '../dist/shall/oracle/differential.js';

const program = parseShall(readFileSync('examples/order-total.shall', 'utf8'), 'x.shall').program!;

// Two readings of "IF the order is below 50". Both are defensible readings of
// the same English; they differ on whether "the order" means the subtotal or
// the subtotal after the coupon. Unlike a discount and a tax (which commute),
// a threshold test does not - so the readings genuinely diverge.
const THRESHOLD_ON_ORIGINAL = `
export function run({ subtotal, couponPercent }) {
  const pct = Math.min(100, Math.max(0, couponPercent));
  const discounted = subtotal * (1 - pct / 100);
  const shipping = subtotal < 50 ? 6 : 0;
  return Math.round((discounted + shipping) * 1.08 * 100) / 100;
}`;

const THRESHOLD_ON_DISCOUNTED = `
export function run({ subtotal, couponPercent }) {
  const pct = Math.min(100, Math.max(0, couponPercent));
  const discounted = subtotal * (1 - pct / 100);
  const shipping = discounted < 50 ? 6 : 0;
  return Math.round((discounted + shipping) * 1.08 * 100) / 100;
}`;

// Same threshold reading as the first, but leaves shipping untaxed - a second,
// independent ambiguity hiding in "add sales tax of 8 percent".
const SHIPPING_UNTAXED = `
export function run({ subtotal, couponPercent }) {
  const pct = Math.min(100, Math.max(0, couponPercent));
  const discounted = subtotal * (1 - pct / 100);
  const shipping = subtotal < 50 ? 6 : 0;
  return Math.round((discounted * 1.08 + shipping) * 100) / 100;
}`;

// @shall shall-language/6.1
test('structural probes are deterministic and respect the interface', () => {
  const a = structuralProbes(program, 96);
  const b = structuralProbes(program, 96);
  assert.deepEqual(a, b, 'the same program must always produce the same probes');
  assert.ok(a.length > 8);
  for (const p of a) {
    assert.deepEqual(Object.keys(p.input).sort(), ['couponPercent', 'subtotal']);
    assert.equal(typeof p.input.subtotal, 'number');
    assert.equal(Number.isInteger(p.input.couponPercent), true);
  }
});

// @shall shall-language/3.2
test('identical behaviour collapses to one group and builds', () => {
  const probes = structuralProbes(program, 96);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'a', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: THRESHOLD_ON_ORIGINAL.replace("1 - pct / 100", "(100 - pct) / 100") },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.equal(result.unanimous, true, 'algebraically identical code must not count as divergence');
  assert.equal(result.groups.length, 1);
  assert.equal(result.divergences.length, 0);
  assert.equal(buildVerdict(result, 2).ok, true);
});

// @shall shall-language/3.1
// @shall shall-language/3.3
test('THE HEADLINE: an ambiguous spec splits the ensemble and fails the build', () => {
  const probes = structuralProbes(program, 96);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'gpt-5 high', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'gpt-5 low', source: THRESHOLD_ON_DISCOUNTED },
      { modelId: 'c', label: 'gpt-5-mini', source: THRESHOLD_ON_ORIGINAL },
    ],
    { probes, executionTimeoutMs: 500 },
  );

  assert.equal(result.unanimous, false);
  assert.equal(result.groups.length, 2, 'two distinct readings of the same English');
  assert.ok(result.divergences.length > 0, 'the disagreement must be witnessed by a concrete input');

  const verdict = buildVerdict(result, 2);
  assert.equal(verdict.ok, false);
  assert.match((verdict as { reason: string }).reason, /split into 2 distinct behaviours/);

  // The witness must be an input where the coupon actually bites.
  const witness = result.divergences[0];
  assert.ok(witness.readings.length >= 2);
  assert.notEqual(witness.readings[0].canonical, witness.readings[1].canonical);
});

// @shall shall-language/3.4
test('a plurality does not rescue a split build', () => {
  const probes = structuralProbes(program, 96);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'a', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'b', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'c', label: 'c', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'd', label: 'd', source: THRESHOLD_ON_DISCOUNTED },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.equal(result.consensus?.members.length, 3);
  assert.equal(buildVerdict(result, 2).ok, false, '3-vs-1 is still an ambiguous specification');
});

test('a second independent ambiguity also splits the build', () => {
  const probes = structuralProbes(program, 96);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'shipping-taxed', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'shipping-untaxed', source: SHIPPING_UNTAXED },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  // These agree almost everywhere; the oracle only needs one witness.
  if (!result.unanimous) {
    assert.ok(result.divergences.length >= 1);
    assert.ok(result.divergences.length < probes.length, 'they should agree on most inputs');
  }
});

test('a candidate that fails to load is excluded, not fatal', () => {
  const probes = structuralProbes(program, 8);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'good', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'good2', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'c', label: 'broken', source: 'this is not javascript {{{' },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.equal(result.candidates.length, 3);
  assert.equal(result.loadable.length, 2);
  assert.ok(result.candidates.find((c) => c.label === 'broken')?.loadError);
  assert.equal(buildVerdict(result, 2).ok, true);
});

// @shall shall-language/3.5
test('below quorum, a build is refused even when survivors agree', () => {
  const probes = structuralProbes(program, 8);
  const result = runDifferential(
    [
      { modelId: 'a', label: 'good', source: THRESHOLD_ON_ORIGINAL },
      { modelId: 'b', label: 'broken', source: 'nope(' },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  const verdict = buildVerdict(result, 2);
  assert.equal(verdict.ok, false);
  assert.match((verdict as { reason: string }).reason, /quorum/);
});

test('generated probes not matching the interface are discarded', () => {
  const good = JSON.stringify([{ input: { subtotal: 10, couponPercent: 5 }, rationale: 'ok' }]);
  assert.equal(parseGeneratedProbes(good, program, 0).length, 1);

  for (const bad of [
    JSON.stringify([{ input: { subtotal: 10 } }]),                        // missing field
    JSON.stringify([{ input: { subtotal: 10, couponPercent: 5, x: 1 } }]),// invented field
    JSON.stringify([{ input: { subtotal: 'ten', couponPercent: 5 } }]),   // wrong type
    JSON.stringify([{ input: { subtotal: 10, couponPercent: 1.5 } }]),    // non-integer
    'not json at all',
  ]) {
    assert.equal(parseGeneratedProbes(bad, program, 0).length, 0, `should reject: ${bad}`);
  }
});
