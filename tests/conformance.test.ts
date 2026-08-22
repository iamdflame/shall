import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirementsDocument } from '../dist/ears/spec-reader.js';
import { buildReport, toLock } from '../dist/verify/conformance.js';
import { parseTap } from '../dist/verify/runner.js';
import { hashText } from '../dist/lock/lockfile.js';

const SPEC = `### Requirement 1: Verification

#### Acceptance Criteria

1. WHEN the suite runs THEN Keel SHALL join results to criteria
2. IF a bound test fails THEN Keel SHALL report the criterion as broken
3. IF nothing implements a criterion THEN Keel SHALL report an orphan
`;

const spec = () => parseRequirementsDocument(SPEC, 'verify', '/tmp/r.md');

const impl = (ref: string, hash = 'h1') => ({
  ref, kind: 'implementation' as const, file: 'src/x.ts', line: 10,
  anchorHash: hash, anchorPreview: '',
});
const proof = (ref: string, testName: string, hash = 'h2') => ({
  ref, kind: 'proof' as const, file: 'tests/x.test.ts', line: 4,
  testName, anchorHash: hash, anchorPreview: '',
});

test('TAP results are joined to the criteria that claim them as proof', () => {
  const tap = `
TAP version 13
ok 1 - joins results
not ok 2 - some other test
1..2
`;
  const results = parseTap(tap);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { name: 'joins results', passed: true, skipped: false });
  assert.equal(results[1].passed, false);

  const report = buildReport({
    specs: [spec()],
    bindings: [proof('1.1', 'joins results')],
    testResults: results,
    lock: null,
    testsRan: true,
  });
  const v = report.verdicts.find((x) => x.criterion.id === '1.1')!;
  assert.equal(v.status, 'conformant');
  assert.equal(v.proofs[0].found, true);
  assert.equal(v.proofs[0].passed, true);
});

test('TAP directives mark skipped tests, which are not proof', () => {
  const results = parseTap('ok 1 - a pending thing # SKIP not ready\n');
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].name, 'a pending thing');

  const report = buildReport({
    specs: [spec()],
    bindings: [proof('1.1', 'a pending thing')],
    testResults: results,
    lock: null,
    testsRan: true,
  });
  assert.equal(report.verdicts.find((v) => v.criterion.id === '1.1')!.status, 'unverified');
});

test('a failing bound test makes its criterion broken', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [impl('1.2'), proof('1.2', 'checks the thing')],
    testResults: [{ name: 'checks the thing', passed: false, skipped: false }],
    lock: null,
    testsRan: true,
  });
  const v = report.verdicts.find((x) => x.criterion.id === '1.2')!;
  assert.equal(v.status, 'broken');
  assert.match(v.reason, /does not do what the spec says/);
});

test('a criterion with no binding at all is an orphan', () => {
  const report = buildReport({
    specs: [spec()], bindings: [], testResults: [], lock: null, testsRan: true,
  });
  assert.equal(report.counts.orphan, 3);
  assert.match(report.verdicts[0].reason, /specified and never built/);
});

test('code with no passing test is unverified, not conformant', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [impl('1.1')],
    testResults: [],
    lock: null,
    testsRan: true,
  });
  const v = report.verdicts.find((x) => x.criterion.id === '1.1')!;
  assert.equal(v.status, 'unverified');
  assert.match(v.reason, /no test proves it/);
});

test('nothing is conformant when the suite did not run', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [impl('1.1'), proof('1.1', 'joins results')],
    testResults: [],
    lock: null,
    testsRan: false,
    testError: 'runner exploded',
  });
  assert.equal(report.counts.conformant, 0);
  assert.equal(report.conformance, 0);
  assert.equal(report.testsRan, false);
});

test('the report states the share of criteria that are proven', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [proof('1.1', 't1'), proof('1.2', 't2')],
    testResults: [
      { name: 't1', passed: true, skipped: false },
      { name: 't2', passed: true, skipped: false },
    ],
    lock: null,
    testsRan: true,
  });
  assert.equal(report.total, 3);
  assert.equal(report.counts.conformant, 2);
  assert.ok(Math.abs(report.conformance - 2 / 3) < 1e-9);
});

test('toLock snapshots criterion text and every bound anchor', () => {
  const report = buildReport({
    specs: [spec()],
    bindings: [impl('1.1', 'anchor-a')],
    testResults: [],
    lock: null,
    testsRan: true,
  });
  const lock = toLock(report);
  const entry = lock.criteria['verify/1.1'];
  assert.ok(entry);
  assert.equal(entry.anchors['src/x.ts:10'], 'anchor-a');
  assert.equal(entry.text, hashText(report.verdicts[0].criterion.raw));
});
