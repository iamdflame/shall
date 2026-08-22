import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCandidate, canonical, canonicalValue, LoadError } from '../dist/shall/execute/sandbox.js';

const MOD = 'export function run({ n }) { return n * 2; }';

test('loads an ES module and calls its run export', () => {
  const c = loadCandidate(MOD);
  assert.deepEqual(c.run({ n: 21 }, 500), { ok: true, value: 42 });
});

test('accepts const and default export forms', () => {
  assert.equal(loadCandidate('export const run = ({n}) => n + 1;').run({ n: 1 }, 500).value, 2);
  assert.equal(loadCandidate('export default function run({n}){return n+1;}').run({ n: 1 }, 500).value, 2);
  assert.equal(loadCandidate('function run({n}){return n+1;}\nexport { run };').run({ n: 1 }, 500).value, 2);
});

test('a module without run is rejected at load', () => {
  assert.throws(() => loadCandidate('export function nope() {}'), LoadError);
});

test('imports are refused — candidates must be self-contained', () => {
  assert.throws(() => loadCandidate('import fs from "fs";\nexport function run(){return 1;}'), LoadError);
});

// @shall 6.2
test('the sandbox has no host globals', () => {
  for (const probe of ['process', 'require', 'fetch', 'globalThis.process']) {
    const c = loadCandidate(`export function run() { return typeof ${probe}; }`);
    const out = c.run({}, 500);
    assert.ok(
      (out.ok && out.value === 'undefined') || !out.ok,
      `${probe} must not be reachable, got ${JSON.stringify(out)}`,
    );
  }
});

test('a runtime throw becomes an outcome, not an exception', () => {
  const c = loadCandidate('export function run(){ throw new Error("boom"); }');
  const out = c.run({}, 500);
  assert.equal(out.ok, false);
  assert.match((out as { error: string }).error, /boom/);
});

// @shall 6.3
test('an infinite loop is killed by the timeout', () => {
  const c = loadCandidate('export function run(){ while(true){} }');
  const out = c.run({}, 100);
  assert.equal(out.ok, false);
  assert.match((out as { error: string }).error, /timed out|Script execution/i);
});

test('input is cloned — a candidate cannot mutate the probe for the next one', () => {
  const c = loadCandidate('export function run(o){ o.n = 999; return o.n; }');
  const input = { n: 1 };
  c.run(input, 500);
  assert.equal(input.n, 1);
});

test('canonical form makes agreement an exact question', () => {
  assert.equal(canonicalValue(1.5), '1.5');
  assert.equal(canonicalValue(-0), '0', '-0 and 0 read identically to a user');
  assert.equal(canonicalValue(NaN), 'NaN');
  assert.equal(canonicalValue('a'), '"a"');
  assert.equal(canonicalValue([1, 'a']), '[1,"a"]');
  assert.equal(
    canonicalValue({ b: 1, a: 2 }),
    canonicalValue({ a: 2, b: 1 }),
    'key order is not divergence',
  );
});

test('two candidates that both throw are treated as agreeing', () => {
  const a = canonical({ ok: false, error: 'invalid input' });
  const b = canonical({ ok: false, error: 'bad argument' });
  assert.equal(a, b, 'the spec never dictates error wording');
});

test('returning where another throws is real divergence', () => {
  assert.notEqual(canonical({ ok: true, value: 0 }), canonical({ ok: false, error: 'x' }));
});

test('a candidate cannot see values left by a previous candidate', () => {
  const a = loadCandidate('export function run(){ this_is_leaked = 5; return 1; }');
  a.run({}, 500);
  const b = loadCandidate('export function run(){ return typeof this_is_leaked; }');
  const out = b.run({}, 500);
  assert.ok((out.ok && out.value === 'undefined') || !out.ok);
});
