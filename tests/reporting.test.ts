import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirementsDocument } from '../dist/ears/spec-reader.js';
import { buildReport } from '../dist/verify/conformance.js';
import { renderReport, exitCodeFor } from '../dist/report/terminal.js';
import { renderHtml } from '../dist/report/html.js';

const SPEC = `### Requirement 1: Reporting

#### Acceptance Criteria

1. WHEN a check completes THEN Keel SHALL report conformance
2. IF anything is broken THEN Keel SHALL exit non-zero
3. WHERE strict mode is on Keel SHALL fail on orphans
`;
const spec = () => parseRequirementsDocument(SPEC, 'reporting', '/tmp/r.md');

const proof = (ref: string, name: string) => ({
  ref, kind: 'proof' as const, file: 'tests/a.test.ts', line: 2,
  testName: name, anchorHash: 'h', anchorPreview: '',
});

function report(opts: { failing?: boolean; bindAll?: boolean } = {}) {
  const bindings = opts.bindAll
    ? [proof('1.1', 't1'), proof('1.2', 't2'), proof('1.3', 't3')]
    : [proof('1.1', 't1')];
  return buildReport({
    specs: [spec()],
    bindings,
    testResults: ['t1', 't2', 't3'].map((name) => ({
      name, passed: !(opts.failing && name === 't1'), skipped: false,
    })),
    lock: null,
    testsRan: true,
  });
}

test('a broken criterion produces a non-zero exit code', () => {
  assert.equal(exitCodeFor(report({ failing: true, bindAll: true }), false), 1);
  assert.equal(exitCodeFor(report({ bindAll: true }), false), 0);
});

test('strict mode also fails on orphans that lenient mode tolerates', () => {
  const partial = report();               // 1.1 proven, 1.2 and 1.3 orphaned
  assert.equal(partial.counts.orphan, 2);
  assert.equal(exitCodeFor(partial, false), 0, 'lenient mode tolerates orphans');
  assert.equal(exitCodeFor(partial, true), 1, 'strict mode does not');
});

test('a dangling annotation fails the check even in lenient mode', () => {
  const r = buildReport({
    specs: [spec()],
    bindings: [{ ref: '7.7', kind: 'implementation', file: 'src/x.ts', line: 1, anchorHash: 'h', anchorPreview: '' }],
    testResults: [], lock: null, testsRan: true,
  });
  assert.equal(exitCodeFor(r, false), 1);
});

test('the terminal report leads with conformance and names what is wrong', () => {
  const text = renderReport(report({ failing: true, bindAll: true }), { verbose: true });
  assert.match(text, /CONFORMANCE/);
  assert.match(text, /reporting\/1\.1/);
  assert.match(text, /BROKEN/);
  assert.match(text, /tests\/a\.test\.ts:2/);
  assert.match(text, /\.kiro\/specs\/reporting\/requirements\.md:/);
});

test('the terminal report is legible with colour disabled', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const text = renderReport(report({ bindAll: true }));
    // eslint-disable-next-line no-control-regex
    assert.equal(/\x1b\[/.test(text), false, 'expected no ANSI escapes under NO_COLOR');
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test('the HTML report is self-contained and makes no network requests', () => {
  const html = renderHtml(report({ failing: true, bindAll: true }));

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /reporting\/1\.1/);
  assert.match(html, /broken/);

  for (const forbidden of [/<script[^>]+src=/i, /<link[^>]+href=["']https?:/i, /@import\s+url/i, /fonts\.googleapis/i, /https?:\/\/(?!www\.w3\.org)/i]) {
    assert.equal(forbidden.test(html), false, `HTML must not reference ${forbidden}`);
  }
});

test('HTML output escapes content that would otherwise inject markup', () => {
  const hostile = `### Requirement 1: XSS

#### Acceptance Criteria

1. WHEN a user submits <script>alert("x")</script> THEN Keel SHALL escape it
`;
  const html = renderHtml(
    buildReport({
      specs: [parseRequirementsDocument(hostile, 'x', '/tmp/r.md')],
      bindings: [], testResults: [], lock: null, testsRan: true,
    }),
  );
  assert.equal(html.includes('<script>alert'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('an empty spec set reports zero criteria instead of dividing by zero', () => {
  const r = buildReport({ specs: [], bindings: [], testResults: [], lock: null, testsRan: true });
  assert.equal(r.total, 0);
  assert.equal(r.conformance, 0);
  assert.match(renderReport(r), /No acceptance criteria found/);
  assert.equal(exitCodeFor(r, true), 0);
});
