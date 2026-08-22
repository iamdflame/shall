import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { minimiseWitness } from '../dist/shall/oracle/minimise.js';
import { loadCandidate } from '../dist/shall/execute/sandbox.js';

const program = parseShall(readFileSync('examples/word-count.shall', 'utf8'), 'w.shall').program!;
const numeric = parseShall(readFileSync('examples/order-total.shall', 'utf8'), 'o.shall').program!;

const SPLITS_HYPHENS = 'export function run({ text }) { return text.split(/[\\s-]+/).filter(t => t.length >= 3).length; }';
const KEEPS_HYPHENS  = 'export function run({ text }) { return text.split(/\\s+/).filter(t => t.length >= 3).length; }';

const probe = (input: Record<string, unknown>) => ({ id: 'p', input, origin: 'structural' as const });

test('a long witness shrinks to the smallest input that still splits', () => {
  const result = minimiseWitness(
    program,
    probe({ text: 'well-known state-of-the-art' }),
    [{ source: SPLITS_HYPHENS }, { source: KEEPS_HYPHENS }],
    500,
  );
  assert.equal(result.smaller, true);
  const text = result.input.text as string;
  assert.ok(text.length < 'well-known state-of-the-art'.length);
  assert.ok(text.includes('-'), 'the hyphen is the cause and must survive');
  assert.ok(text.length <= 5, `expected a tiny witness, got ${JSON.stringify(text)}`);
});

test('the minimal witness genuinely still splits the readers', () => {
  const result = minimiseWitness(
    program, probe({ text: 'well-known state-of-the-art' }),
    [{ source: SPLITS_HYPHENS }, { source: KEEPS_HYPHENS }], 500,
  );
  
  const a = loadCandidate(SPLITS_HYPHENS).run(result.input, 500);
  const b = loadCandidate(KEEPS_HYPHENS).run(result.input, 500);
  assert.notDeepEqual(a, b, 'a minimised witness that no longer splits is worthless');
});

test('minimisation is skipped when fewer than two readers load', () => {
  const result = minimiseWitness(program, probe({ text: 'abc def' }), [{ source: KEEPS_HYPHENS }], 500);
  assert.equal(result.smaller, false);
  assert.deepEqual(result.input, { text: 'abc def' });
});

test('an already-minimal witness is left alone', () => {
  const result = minimiseWitness(
    program, probe({ text: 'a-a' }),
    [{ source: SPLITS_HYPHENS }, { source: KEEPS_HYPHENS }], 500,
  );
  assert.equal(result.input.text, 'a-a');
  assert.equal(result.smaller, false);
});

test('numbers shrink toward zero while the split survives', () => {
  const BELOW = 'export function run({ subtotal }) { return subtotal < 50 ? 1 : 0; }';
  const ATMOST = 'export function run({ subtotal }) { return subtotal <= 50 ? 1 : 0; }';
  const result = minimiseWitness(
    numeric, probe({ subtotal: 50, couponPercent: 37 }),
    [{ source: BELOW }, { source: ATMOST }], 500,
  );
  // Only subtotal === 50 distinguishes < from <=, so it must survive; the
  // irrelevant coupon should be driven to zero.
  assert.equal(result.input.subtotal, 50);
  assert.equal(result.input.couponPercent, 0, 'an input the split does not depend on should vanish');
});

test('minimisation terminates on a pathological input', () => {
  const result = minimiseWitness(
    program, probe({ text: 'x'.repeat(400) }),
    [{ source: SPLITS_HYPHENS }, { source: KEEPS_HYPHENS }], 200, 60,
  );
  assert.ok(result.steps <= 60, 'the step budget must be respected');
});
