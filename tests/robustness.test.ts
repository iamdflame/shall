import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCandidate, agreement, withinUlps } from '../dist/shall/execute/sandbox.js';
import { parseShall } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential, buildVerdict } from '../dist/shall/oracle/differential.js';

const program = parseShall(readFileSync('examples/order-total.shall', 'utf8'), 'o.shall').program!;

/* ── sandbox isolation ─────────────────────────────────────────────────── */

test('a candidate cannot carry state between probes', () => {
  const stateful = loadCandidate(
    'export function run(){ if (typeof memo === "undefined") { memo = 0; } memo = memo + 1; return memo; }',
  );
  const results = [1, 2, 3].map(() => stateful.run({}, 500));
  assert.deepEqual(results.map((r) => r.value), [1, 1, 1],
    'a global written on one probe must not survive into the next');
});

test('behaviour vectors do not depend on probe order', () => {
  const source = 'export function run({ subtotal }) { if (typeof seen === "undefined") { seen = 0; } seen++; return subtotal + seen; }';
  const probes = structuralProbes(program, 24);

  const forward = runDifferential([{ modelId: 'a', label: 'a', source }], { probes, executionTimeoutMs: 500 });
  const reversed = runDifferential([{ modelId: 'a', label: 'a', source }], {
    probes: probes.slice().reverse(), executionTimeoutMs: 500,
  });

  const f = forward.candidates[0].outcomes.map((o) => JSON.stringify(o));
  const r = reversed.candidates[0].outcomes.slice().reverse().map((o) => JSON.stringify(o));
  assert.deepEqual(f, r, 'the same probe must give the same answer whenever it runs');
});

test('a candidate mutating its input cannot affect a later probe', () => {
  const c = loadCandidate('export function run(o){ o.subtotal = 999; return o.subtotal; }');
  const input = { subtotal: 1, couponPercent: 0 };
  c.run(input, 500);
  assert.equal(input.subtotal, 1);
});

/* ── numeric equivalence ───────────────────────────────────────────────── */

test('IEEE 754 noise is not a disagreement about English', () => {
  assert.equal(withinUlps(0.1 + 0.2, 0.3), true);
  assert.equal(withinUlps(1e-9, 0), false, 'do not bridge zero');
  assert.equal(withinUlps(1.0, 1.1), false, 'a real difference is still a difference');
  assert.equal(withinUlps(-1.0, 1.0), false, 'signs are never bridged');
  assert.equal(withinUlps(NaN, NaN), false);
  assert.equal(withinUlps('a', 'a'), false, 'non-numbers are never numerically equivalent');
});

test('agreement() separates identical, equivalent and divergent', () => {
  assert.equal(agreement({ ok: true, value: 0.3 }, { ok: true, value: 0.3 }), 'identical');
  assert.equal(agreement({ ok: true, value: 0.1 + 0.2 }, { ok: true, value: 0.3 }), 'numerically-equivalent');
  assert.equal(agreement({ ok: true, value: 1 }, { ok: true, value: 2 }), 'divergent');
  assert.equal(agreement({ ok: true, value: 1 }, { ok: false, error: 'x' }), 'divergent');
});

test('THE FALSE POSITIVE: arithmetic order does not fail a build', () => {
  const probes = structuralProbes(program, 60);
  // Same reading of the English; different order of the same operations.
  const A = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1 - p) * 1.08;
  }`;
  // Associativity only. Deliberately NOT `big - big*p`, which is catastrophic
  // cancellation: that produces genuinely different numbers relative to a tiny
  // result, and calling it "equivalent" would be the tool lying.
  const B = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1.08 * (1 - p));
  }`;

  const result = runDifferential(
    [{ modelId: 'a', label: 'reader-a', source: A }, { modelId: 'b', label: 'reader-b', source: B }],
    { probes, executionTimeoutMs: 500 },
  );

  assert.ok(result.numericDivergences.length > 0, 'fixture must actually produce float noise');
  assert.equal(result.behaviourDivergences.length, 0, 'no genuine disagreement exists here');

  const verdict = buildVerdict(result, 2);
  assert.equal(verdict.ok, true, 'a build must not fail because of IEEE 754');
});

test('a genuine disagreement is still rejected when float noise is also present', () => {
  const probes = structuralProbes(program, 60);
  const A = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1 - p) * 1.08;
  }`;
  const C = `export function run({ subtotal, couponPercent }) {
    const p = Math.min(100, Math.max(0, couponPercent)) / 100;
    return subtotal * (1 - p) * 1.08 + (subtotal < 50 ? 6 : 0);
  }`;
  const result = runDifferential(
    [{ modelId: 'a', label: 'a', source: A }, { modelId: 'c', label: 'c', source: C }],
    { probes, executionTimeoutMs: 500 },
  );
  assert.ok(result.behaviourDivergences.length > 0);
  assert.equal(buildVerdict(result, 2).ok, false);
});

/* ── determinism ───────────────────────────────────────────────────────── */

test('the full offline pipeline is byte-identical across runs', () => {
  const source = 'export function run({ subtotal, couponPercent }) { return subtotal - couponPercent; }';
  const snapshot = () => {
    const probes = structuralProbes(program, 96);
    const r = runDifferential([{ modelId: 'a', label: 'a', source }], { probes, executionTimeoutMs: 500 });
    return JSON.stringify({
      probes: r.probes,
      behaviour: r.candidates[0].behaviour,
      groups: r.groups.length,
      divergences: r.divergences.length,
    });
  };
  assert.equal(snapshot(), snapshot(), 'a reproducible report is the whole claim');
});
