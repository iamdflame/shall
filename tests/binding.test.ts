import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanBindings, isTestPath } from '../dist/binding/scanner.js';
import { parseRequirementsDocument } from '../dist/ears/spec-reader.js';
import { buildReport } from '../dist/verify/conformance.js';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'keel-'));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

const SPEC = `### Requirement 1: Binding

#### Acceptance Criteria

1. WHEN code is annotated THEN Keel SHALL bind it
2. IF nothing implements a criterion THEN Keel SHALL report an orphan
`;

test('an annotation binds a code region to its criterion', () => {
  const dir = fixture({
    'src/thing.ts': '// @shall 1.1\nexport function thing() {\n  return 1;\n}\n',
  });
  try {
    const bindings = scanBindings(dir);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].ref, '1.1');
    assert.equal(bindings[0].file, 'src/thing.ts');
    assert.equal(bindings[0].line, 1);
    assert.ok(bindings[0].anchorHash.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annotations in test files are recorded as proof, not implementation', () => {
  const dir = fixture({
    'src/thing.ts': '// @shall 1.1\nexport function thing() { return 1; }\n',
    'tests/thing.test.ts': "// @shall 1.1\ntest('proves the thing', () => {});\n",
  });
  try {
    const bindings = scanBindings(dir);
    const kinds = Object.fromEntries(bindings.map((b) => [b.file, b.kind]));
    assert.equal(kinds['src/thing.ts'], 'implementation');
    assert.equal(kinds['tests/thing.test.ts'], 'proof');

    const proof = bindings.find((b) => b.kind === 'proof');
    assert.equal(proof?.testName, 'proves the thing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('test-path detection covers common conventions', () => {
  assert.equal(isTestPath('tests/a.ts'), true);
  assert.equal(isTestPath('src/a.test.ts'), true);
  assert.equal(isTestPath('src/a.spec.tsx'), true);
  assert.equal(isTestPath('pkg/foo_test.go'), true);
  assert.equal(isTestPath('app/test_thing.py'), true);
  assert.equal(isTestPath('src/parser.ts'), false);
  assert.equal(isTestPath('src/contest/latest.ts'), false);
});

test('an annotation naming a nonexistent criterion is reported as dangling', () => {
  const spec = parseRequirementsDocument(SPEC, 'binding', '/tmp/r.md');
  const report = buildReport({
    specs: [spec],
    bindings: [
      { ref: '9.9', kind: 'implementation', file: 'src/x.ts', line: 3, anchorHash: 'a', anchorPreview: '' },
    ],
    testResults: [],
    lock: null,
    testsRan: true,
  });
  assert.equal(report.dangling.length, 1);
  assert.equal(report.dangling[0].binding.ref, '9.9');
  assert.match(report.dangling[0].reason, /no criterion/);
});

test('an ambiguous unqualified id is refused rather than guessed', () => {
  const a = parseRequirementsDocument(SPEC, 'alpha', '/tmp/a.md');
  const b = parseRequirementsDocument(SPEC, 'beta', '/tmp/b.md');
  const report = buildReport({
    specs: [a, b],
    bindings: [
      { ref: '1.1', kind: 'implementation', file: 'src/x.ts', line: 1, anchorHash: 'a', anchorPreview: '' },
    ],
    testResults: [],
    lock: null,
    testsRan: true,
  });
  assert.equal(report.dangling.length, 1);
  assert.match(report.dangling[0].reason, /ambiguous/);
  assert.match(report.dangling[0].reason, /alpha\/1\.1/);

  const qualified = buildReport({
    specs: [a, b],
    bindings: [
      { ref: 'beta/1.1', kind: 'implementation', file: 'src/x.ts', line: 1, anchorHash: 'a', anchorPreview: '' },
    ],
    testResults: [],
    lock: null,
    testsRan: true,
  });
  assert.equal(qualified.dangling.length, 0);
});

test('annotations are not scanned inside ignored directories', () => {
  const dir = fixture({
    'src/a.ts': '// @shall 1.1\nexport const a = 1;\n',
    'node_modules/pkg/b.ts': '// @shall 1.1\nexport const b = 2;\n',
    'dist/c.js': '// @shall 1.1\nexport const c = 3;\n',
  });
  try {
    const bindings = scanBindings(dir);
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].file, 'src/a.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
