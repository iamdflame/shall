import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseShall } from '../dist/shall/lang/parser.js';
import { compileEnsemble } from '../dist/shall/compile/compiler.js';
import { COMPILER_INSTRUCTIONS, extractModule } from '../dist/shall/compile/prompt.js';
import { deriveExpectations } from '../dist/shall/conform/expectations.js';
import { lintVagueness } from '../dist/shall/attribute/attribute.js';
import { ProviderError } from '../dist/shall/provider/types.js';

const program = parseShall(readFileSync('examples/word-count.shall', 'utf8'), 'w.shall').program!;

const MODELS = [
  { id: 'fake:a', provider: 'fake', model: 'a', label: 'reader-a' },
  { id: 'fake:b', provider: 'fake', model: 'b', label: 'reader-b' },
];

/** Records exactly what each reader was asked, so the control can be asserted. */
function recordingProvider(reply: (id: string) => string, fail = new Set<string>()) {
  const asked: { id: string; instructions: string; input: string }[] = [];
  return {
    asked,
    provider: {
      name: 'fake',
      isConfigured: () => true,
      listModels: async () => MODELS.map((m) => m.model),
      async complete(model: { id: string }, req: { instructions: string; input: string }) {
        asked.push({ id: model.id, instructions: req.instructions, input: req.input });
        if (fail.has(model.id)) throw new ProviderError('reader unavailable', 'transport', model.id);
        return { text: reply(model.id), model: model.id, usage: { input: 10, output: 20 }, ms: 1 };
      },
    },
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'shall-'));
}

// @shall 2.1
test('every reader is asked a byte-identical question', async () => {
  const dir = tempDir();
  try {
    const { provider, asked } = recordingProvider(() => 'export function run(){return 1;}');
    await compileEnsemble({
      program, ensemble: MODELS, provider: provider as never,
      maxOutputTokens: 100, cacheDir: dir,
    });
    assert.equal(asked.length, 2);
    assert.equal(asked[0].input, asked[1].input, 'inputs must be identical across readers');
    assert.equal(asked[0].instructions, asked[1].instructions);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// @shall 2.2
test('no reader is told that other readers exist', () => {
  const text = COMPILER_INSTRUCTIONS.toLowerCase();
  for (const leak of ['other model', 'ensemble', 'compared', 'agree', 'consensus', 'another reader']) {
    assert.equal(text.includes(leak), false, `instructions must not mention "${leak}"`);
  }
});

// @shall 2.3
test('a failing reader is recorded and the rest still compile', async () => {
  const dir = tempDir();
  try {
    const { provider } = recordingProvider(() => 'export function run(){return 1;}', new Set(['fake:b']));
    const result = await compileEnsemble({
      program, ensemble: MODELS, provider: provider as never,
      maxOutputTokens: 100, cacheDir: dir,
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].label, 'reader-b');
    assert.equal(result.failures[0].kind, 'transport');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// @shall 2.4
test('an unchanged program reuses cached answers instead of paying again', async () => {
  const dir = tempDir();
  try {
    const first = recordingProvider(() => 'export function run(){return 1;}');
    const a = await compileEnsemble({
      program, ensemble: MODELS, provider: first.provider as never,
      maxOutputTokens: 100, cacheDir: dir,
    });
    assert.equal(first.asked.length, 2);
    assert.equal(a.usage.input + a.usage.output, 60);
    assert.equal(readdirSync(dir).length, 2);

    const second = recordingProvider(() => 'export function run(){return 999;}');
    const b = await compileEnsemble({
      program, ensemble: MODELS, provider: second.provider as never,
      maxOutputTokens: 100, cacheDir: dir,
    });
    assert.equal(second.asked.length, 0, 'a cached reader must not be asked again');
    assert.ok(b.candidates.every((c) => c.cached));
    assert.equal(b.usage.input + b.usage.output, 0, 'cache hits cost nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--no-cache forces every reader to be asked again', async () => {
  const dir = tempDir();
  try {
    const a = recordingProvider(() => 'export function run(){return 1;}');
    await compileEnsemble({ program, ensemble: MODELS, provider: a.provider as never, maxOutputTokens: 100, cacheDir: dir });
    const b = recordingProvider(() => 'export function run(){return 1;}');
    await compileEnsemble({ program, ensemble: MODELS, provider: b.provider as never, maxOutputTokens: 100, cacheDir: dir, noCache: true });
    assert.equal(b.asked.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a markdown fence around the module is stripped', () => {
  assert.equal(extractModule('```javascript\nexport const run = () => 1;\n```'), 'export const run = () => 1;');
  assert.equal(extractModule('export const run = () => 1;'), 'export const run = () => 1;');
});

// @shall 5.2
test('an expectation only survives when independent readers propose the same value', async () => {
  const criteria = program.requirements.flatMap((r) => r.criteria).slice(0, 1);
  const jurors = [
    { id: 'j:1', provider: 'fake', model: '1', label: 'j1' },
    { id: 'j:2', provider: 'fake', model: '2', label: 'j2' },
    { id: 'j:3', provider: 'fake', model: '3', label: 'j3' },
  ];

  // Two jurors agree that "a b c" yields 0; the third disagrees about "x y".
  const replies: Record<string, string> = {
    'j:1': JSON.stringify([{ input: { text: 'a b c' }, expected: 0, why: 'all short' }, { input: { text: 'x y' }, expected: 0, why: '' }]),
    'j:2': JSON.stringify([{ input: { text: 'a b c' }, expected: 0, why: 'all short' }, { input: { text: 'x y' }, expected: 0, why: '' }]),
    'j:3': JSON.stringify([{ input: { text: 'x y' }, expected: 2, why: 'two tokens' }]),
  };
  const { provider } = recordingProvider((id) => replies[id] ?? '[]');

  const result = await deriveExpectations({
    program, criteria, jurors, provider: provider as never,
    maxOutputTokens: 500, minAgreement: 2,
  });

  const agreedInputs = result.agreed.map((c) => c.input.text);
  assert.deepEqual(agreedInputs, ['a b c'], 'only the unanimous case is kept');
  assert.equal(result.agreed[0].agreement, 2);
  assert.ok(result.disputed.some((d) => d.input.text === 'x y'), 'the contested case is reported, not silently dropped');
});

// @shall 6.4
test('open wording is found with no model and no API key', () => {
  const warnings = lintVagueness(program);
  assert.ok(warnings.length > 0);
  assert.ok(warnings.every((w) => w.why.length > 0), 'every warning must explain itself');
});
