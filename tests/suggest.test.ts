import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { programCriteria } from '../dist/shall/lang/types.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential } from '../dist/shall/oracle/differential.js';
import { suggestRewrites, cleanSentence, applyRewrite, buildSuggestInput } from '../dist/shall/suggest/suggest.js';

const program = parseShall(readFileSync('examples/word-count.shall', 'utf8'), 'examples/word-count.shall').program!;
const criterion = programCriteria(program)[0]!;

const SPLITS = 'export function run({ text }) { return text.split(/[\\s-]+/).filter(t => t.length >= 3).length; }';
const KEEPS  = 'export function run({ text }) { return text.split(/\\s+/).filter(t => t.length >= 3).length; }';

function split() {
  const probes = structuralProbes(program, 40);
  return runDifferential(
    [
      { modelId: 'a', label: 'reader-a', source: SPLITS },
      { modelId: 'b', label: 'reader-b', source: KEEPS },
      { modelId: 'c', label: 'reader-c', source: SPLITS },
    ],
    { probes, executionTimeoutMs: 500 },
  );
}

test('one rewrite is proposed per distinct reading', async () => {
  const oracle = split();
  const seen: string[] = [];
  const provider = {
    name: 'fake', isConfigured: () => true, listModels: async () => [],
    async complete(_m: unknown, req: { input: string }) {
      seen.push(req.input);
      return { text: 'THE SYSTEM SHALL do the pinned thing', model: 'f', usage: { input: 1, output: 1 }, ms: 1 };
    },
  };
  const suggestions = await suggestRewrites({
    program, criterion, groups: oracle.groups, divergences: oracle.behaviourDivergences,
    provider: provider as never, model: { id: 'f', provider: 'fake', model: 'f', label: 'f' },
    maxOutputTokens: 200,
  });

  assert.equal(suggestions.length, oracle.groups.length);
  assert.equal(seen.length, oracle.groups.length, 'each reading gets its own request');
  assert.deepEqual(suggestions[0].readers.sort(), ['reader-a', 'reader-c']);
  assert.deepEqual(suggestions[1].readers, ['reader-b']);
});

test('the example input and its output come from the same measurement', async () => {
  const oracle = split();
  const { loadCandidate } = await import('../dist/shall/execute/sandbox.js');
  const provider = {
    name: 'fake', isConfigured: () => true, listModels: async () => [],
    async complete() { return { text: 'x', model: 'f', usage: { input: 0, output: 0 }, ms: 0 }; },
  };
  const suggestions = await suggestRewrites({
    program, criterion, groups: oracle.groups, divergences: oracle.behaviourDivergences,
    provider: provider as never, model: { id: 'f', provider: 'fake', model: 'f', label: 'f' },
    maxOutputTokens: 100,
  });

  for (const s of suggestions) {
    const source = s.readers.includes('reader-b') ? KEEPS : SPLITS;
    const actual = loadCandidate(source).run(s.exampleInput, 500);
    assert.equal(
      String(actual.ok ? actual.value : 'error'), s.exampleOutput,
      `reading for ${s.readers.join(',')} must actually produce ${s.exampleOutput} on ${JSON.stringify(s.exampleInput)}`,
    );
  }
});

test('a failing proposal drops that reading rather than the whole run', async () => {
  const oracle = split();
  let calls = 0;
  const provider = {
    name: 'fake', isConfigured: () => true, listModels: async () => [],
    async complete() {
      calls++;
      if (calls === 1) throw new Error('model unavailable');
      return { text: 'THE SYSTEM SHALL do it', model: 'f', usage: { input: 0, output: 0 }, ms: 0 };
    },
  };
  const suggestions = await suggestRewrites({
    program, criterion, groups: oracle.groups, divergences: oracle.behaviourDivergences,
    provider: provider as never, model: { id: 'f', provider: 'fake', model: 'f', label: 'f' },
    maxOutputTokens: 100,
  });
  assert.equal(suggestions.length, oracle.groups.length - 1);
});

test('the request describes the reading with concrete inputs and outputs', () => {
  const oracle = split();
  const text = buildSuggestInput(program, criterion, oracle.groups[0], oracle.behaviourDivergences);
  assert.match(text, /THE CRITERION THAT IS READ SEVERAL WAYS/);
  assert.match(text, /input \{"text"/);
  assert.match(text, /->/);
  assert.ok(text.includes(criterion.raw));
});

test('a model answer is cleaned to a single sentence', () => {
  assert.equal(cleanSentence('```\nTHE SYSTEM SHALL do it\n```'), 'THE SYSTEM SHALL do it');
  assert.equal(cleanSentence('"THE SYSTEM SHALL do it"'), 'THE SYSTEM SHALL do it');
  assert.equal(cleanSentence('THE SYSTEM SHALL do it\n\nThis works because...'), 'THE SYSTEM SHALL do it');
  assert.equal(cleanSentence('  \n  THE SYSTEM SHALL do it  '), 'THE SYSTEM SHALL do it');
});

test('applying a rewrite preserves indentation and touches one line', () => {
  const before = program.source;
  const after = applyRewrite(before, criterion.line, 'THE SYSTEM SHALL count tokens');
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  assert.equal(beforeLines.length, afterLines.length);
  assert.equal(afterLines[criterion.line - 1], '  THE SYSTEM SHALL count tokens');
  for (let i = 0; i < beforeLines.length; i++) {
    if (i !== criterion.line - 1) assert.equal(afterLines[i], beforeLines[i], `line ${i + 1} must not change`);
  }
});

test('an out-of-range line leaves the source untouched', () => {
  assert.equal(applyRewrite(program.source, 9999, 'x'), program.source);
});
