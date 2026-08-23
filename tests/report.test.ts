import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { programCriteria } from '../dist/shall/lang/types.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential } from '../dist/shall/oracle/differential.js';
import { attribute, lintVagueness } from '../dist/shall/attribute/attribute.js';
import { renderAmbiguity, renderConformance } from '../dist/shall/report/terminal.js';
import { checkConformance } from '../dist/shall/conform/check.js';
import { deriveExpectations } from '../dist/shall/conform/expectations.js';
import { measureCoverage } from '../dist/shall/coverage/coverage.js';

const program = parseShall(readFileSync('examples/word-count.shall', 'utf8'), 'examples/word-count.shall').program!;

const SPLITS_HYPHENS = `
export function run({ text }) {
  return text.split(/[\\s-]+/).filter((t) => t.length >= 3).length;
}`;
const KEEPS_HYPHENS = `
export function run({ text }) {
  return text.split(/\\s+/).filter((t) => t.length >= 3).length;
}`;
/* Same behaviour as KEEPS_HYPHENS, written as differently as possible. */
const KEEPS_HYPHENS_REWRITTEN = `
export function run(args) {
  let n = 0;
  const parts = String(args.text).split(/\\s+/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "") continue;
    if (p.length > 2) n = n + 1;
  }
  return n;
}`;

// @shall shall-language/3.1
test('behaviour is compared, not source text', () => {
  const probes = structuralProbes(program, 40);

  const same = runDifferential(
    [
      { modelId: 'a', label: 'terse', source: KEEPS_HYPHENS },
      { modelId: 'b', label: 'verbose', source: KEEPS_HYPHENS_REWRITTEN },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.notEqual(KEEPS_HYPHENS.trim(), KEEPS_HYPHENS_REWRITTEN.trim(), 'sources must differ');
  assert.equal(same.groups.length, 1, 'identical behaviour is one program, whatever the code looks like');

  const different = runDifferential(
    [
      { modelId: 'a', label: 'splits', source: SPLITS_HYPHENS },
      { modelId: 'b', label: 'keeps', source: KEEPS_HYPHENS },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.equal(different.groups.length, 2, 'near-identical source with different behaviour is two programs');
});

function ambiguityReport(): string {
  const probes = structuralProbes(program, 40);
  const oracle = runDifferential(
    [
      { modelId: 'a', label: 'reader-alpha', source: SPLITS_HYPHENS },
      { modelId: 'b', label: 'reader-beta', source: KEEPS_HYPHENS },
      { modelId: 'c', label: 'reader-gamma', source: SPLITS_HYPHENS },
    ],
    { probes, executionTimeoutMs: 500 },
  );
  assert.ok(oracle.divergences.length > 0, 'fixture must actually diverge');
  return renderAmbiguity({
    program,
    oracle,
    coverage: measureCoverage(program, probes),
    attributions: attribute(program, oracle.divergences, probes),
    vagueness: lintVagueness(program),
    failures: [],
    reason: 'the ensemble split',
  });
}

// @shall shall-language/4.1
test('a rejected build reports the concrete input the readers differed on', () => {
  const text = ambiguityReport();
  assert.match(text, /WITNESS/);
  assert.match(text, /text = "/, 'the witness must show a real input value');
  assert.match(text, /examples\/word-count\.shall:\d+/, 'and the line to edit');
});

// @shall shall-language/4.2
test('a rejected build reports which reader produced which result', () => {
  const text = ambiguityReport();
  for (const reader of ['reader-alpha', 'reader-beta', 'reader-gamma']) {
    assert.ok(text.includes(reader), `report must name ${reader}`);
  }
  // Readers that agreed must be grouped together on one line.
  const line = text.split('\n').find((l) => l.includes('reader-alpha'))!;
  assert.ok(line.includes('reader-gamma'), 'readers that agreed appear together');
  assert.ok(!line.includes('reader-beta'), 'the dissenting reader appears separately');
});

// @shall shall-language/5.1
test('expectations are derived from every criterion, not just the first', async () => {
  const criteria = programCriteria(program);
  assert.ok(criteria.length >= 3);

  const seen: string[] = [];
  const provider = {
    name: 'fake',
    isConfigured: () => true,
    listModels: async () => ['a'],
    async complete(_m: unknown, req: { input: string }) {
      const which = criteria.find((c) => req.input.includes(c.raw))!;
      seen.push(which.id);
      return {
        text: JSON.stringify([{ input: { text: `case for ${which.id}` }, expected: 0, why: which.id }]),
        model: 'a', usage: { input: 1, output: 1 }, ms: 1,
      };
    },
  };

  const jurors = [
    { id: 'j:1', provider: 'fake', model: 'a', label: 'j1' },
    { id: 'j:2', provider: 'fake', model: 'a', label: 'j2' },
  ];
  const result = await deriveExpectations({
    program, criteria, jurors, provider: provider as never,
    maxOutputTokens: 200, minAgreement: 2,
  });

  const covered = new Set(seen);
  for (const c of criteria.filter((x) => x.pattern !== 'malformed')) {
    assert.ok(covered.has(c.id), `criterion ${c.id} must have expectations derived`);
  }
  assert.equal(result.agreed.length, criteria.filter((c) => c.pattern !== 'malformed').length);
});

test('the conformance report names the clause and shows the contradiction', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
  const criteria = programCriteria(program);
  const report = checkConformance(
    KEEPS_HYPHENS,
    criteria,
    [{ criterionId: criteria[0].id, input: { text: 'well-known thing' }, expected: 99, why: 'derived', agreement: 2 }],
    [],
    500,
  );
  const text = renderConformance(program, report);
  assert.match(text, /CONFORMANCE/);
  assert.match(text, /required 99/);
  assert.match(text, /built program gave/);
  assert.match(text, /contradicts the specification/);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
