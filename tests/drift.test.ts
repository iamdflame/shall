import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRequirementsDocument } from '../dist/ears/spec-reader.js';
import { buildReport, toLock } from '../dist/verify/conformance.js';
import { readLock, writeLock, hashText, emptyLock } from '../dist/lock/lockfile.js';

const SPEC = `### Requirement 1: Drift

#### Acceptance Criteria

1. WHEN code moves THEN Keel SHALL notice
`;
const EDITED_SPEC = `### Requirement 1: Drift

#### Acceptance Criteria

1. WHEN code moves THEN Keel SHALL notice immediately
`;

const spec = (src = SPEC) => parseRequirementsDocument(src, 'drift', '/tmp/r.md');

const binding = (anchorHash: string) => ({
  ref: '1.1', kind: 'implementation' as const, file: 'src/x.ts', line: 10,
  anchorHash, anchorPreview: '',
});
const provingTest = {
  ref: '1.1', kind: 'proof' as const, file: 'tests/x.test.ts', line: 2,
  testName: 'notices', anchorHash: 'test-anchor', anchorPreview: '',
};
const passing = [{ name: 'notices', passed: true, skipped: false }];

/** Verify once, snapshot the baseline, then verify again against it. */
function baseline(anchorHash: string) {
  const first = buildReport({
    specs: [spec()], bindings: [binding(anchorHash), provingTest],
    testResults: passing, lock: null, testsRan: true,
  });
  return toLock(first);
}

test('verification records the criterion text and every bound anchor', () => {
  const lock = baseline('anchor-v1');
  const entry = lock.criteria['drift/1.1'];
  assert.ok(entry, 'expected a lockfile entry for drift/1.1');
  assert.equal(entry.status, 'conformant');
  assert.equal(entry.anchors['src/x.ts:10'], 'anchor-v1');
  assert.equal(entry.text, hashText('WHEN code moves THEN Keel SHALL notice'));
});

test('code changing under an unchanged criterion is reported as drift', () => {
  const lock = baseline('anchor-v1');

  const after = buildReport({
    specs: [spec()],
    bindings: [binding('anchor-v2'), provingTest],
    testResults: passing,
    lock,
    testsRan: true,
  });

  const v = after.verdicts[0];
  assert.equal(v.status, 'drifted');
  assert.equal(v.drift?.kind, 'code-changed');
  assert.match(v.reason, /moved out from under the spec/);
});

test('editing the criterion text invalidates its previous verification', () => {
  const lock = baseline('anchor-v1');

  const after = buildReport({
    specs: [spec(EDITED_SPEC)],
    bindings: [binding('anchor-v1'), provingTest],
    testResults: passing,
    lock,
    testsRan: true,
  });

  const v = after.verdicts[0];
  assert.equal(v.status, 'drifted');
  assert.equal(v.drift?.kind, 'spec-changed');
});

test('with no baseline recorded, nothing is reported as drift', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [binding('anything'), provingTest],
    testResults: passing,
    lock: null,
    testsRan: true,
  });
  assert.equal(report.counts.drifted, 0);
  assert.equal(report.verdicts[0].status, 'conformant');
});

test('an unchanged codebase stays conformant across runs', () => {
  const lock = baseline('anchor-v1');
  const after = buildReport({
    specs: [spec()], bindings: [binding('anchor-v1'), provingTest],
    testResults: passing, lock, testsRan: true,
  });
  assert.equal(after.verdicts[0].status, 'conformant');
  assert.equal(after.conformance, 1);
});

test('a failing test outranks drift — a proven violation is the worse fact', () => {
  const lock = baseline('anchor-v1');
  const after = buildReport({
    specs: [spec()], bindings: [binding('anchor-v2'), provingTest],
    testResults: [{ name: 'notices', passed: false, skipped: false }],
    lock, testsRan: true,
  });
  assert.equal(after.verdicts[0].status, 'broken');
});

test('an unreadable baseline degrades to no baseline instead of crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keel-lock-'));
  try {
    const path = join(dir, 'keel.lock.json');

    writeFileSync(path, '{ this is not json', 'utf8');
    assert.equal(readLock(path), null);

    writeFileSync(path, JSON.stringify({ version: 999, criteria: {} }), 'utf8');
    assert.equal(readLock(path), null, 'a future lockfile version must not be trusted');

    assert.equal(readLock(join(dir, 'absent.json')), null);

    const lock = emptyLock();
    lock.criteria['drift/1.1'] = { text: 'x', anchors: {}, status: 'conformant', verifiedAt: 'now' };
    writeLock(path, lock);
    assert.deepEqual(readLock(path)?.criteria['drift/1.1']?.text, 'x');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
