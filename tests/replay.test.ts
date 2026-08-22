import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseShall } from '../dist/shall/lang/parser.js';
import { compileEnsemble } from '../dist/shall/compile/compiler.js';
import { readManifest, readRecording, writeRecording, writeManifest, describeRecording } from '../dist/shall/compile/recordings.js';

const program = parseShall(readFileSync('examples/word-count.shall', 'utf8'), 'examples/word-count.shall').program!;
const MODELS = [
  { id: 'fake:a', provider: 'fake', model: 'a', label: 'reader-a' },
  { id: 'fake:b', provider: 'fake', model: 'b', label: 'reader-b' },
];

function provider(reply = 'export function run(){ return 1; }') {
  const asked: string[] = [];
  return {
    asked,
    impl: {
      name: 'fake', isConfigured: () => true, listModels: async () => [],
      async complete(model: { id: string }) {
        asked.push(model.id);
        return { text: reply, model: model.id, usage: { input: 5, output: 5 }, ms: 1 };
      },
    },
  };
}

const temp = () => mkdtempSync(join(tmpdir(), 'shall-rec-'));

// @shall offline-replay/2.1
test('recording writes each reader and stamps it with a date', async () => {
  const root = temp();
  try {
    const p = provider();
    await compileEnsemble({
      program, ensemble: MODELS, provider: p.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'cache'), root, record: true, live: true, programName: 'examples/word-count.shall',
    });
    const manifest = readManifest(root);
    assert.equal(Object.keys(manifest.readers).length, 2);
    for (const r of Object.values(manifest.readers)) {
      assert.match(r.recordedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.label.startsWith('reader-'));
    }
    const info = describeRecording(manifest, 'examples/word-count.shall');
    assert.ok(info);
    assert.equal(info.readers.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @shall offline-replay/1.1
test('a recorded program replays without calling any model', async () => {
  const root = temp();
  try {
    const first = provider();
    await compileEnsemble({
      program, ensemble: MODELS, provider: first.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'cache'), root, record: true, live: true, programName: 'p',
    });
    assert.equal(first.asked.length, 2);

    const second = provider('export function run(){ return 999; }');
    const replay = await compileEnsemble({
      program, ensemble: MODELS, provider: second.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'cache-2'), root, programName: 'p',
    });
    assert.equal(second.asked.length, 0, 'a recorded reader must never be asked again');
    assert.ok(replay.candidates.every((c) => c.recorded === true));
    assert.equal(replay.usage.input + replay.usage.output, 0, 'a replay costs nothing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @shall offline-replay/1.3
test('--live ignores recordings and asks for real', async () => {
  const root = temp();
  try {
    const first = provider();
    await compileEnsemble({
      program, ensemble: MODELS, provider: first.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'c1'), root, record: true, live: true, programName: 'p',
    });
    const second = provider();
    await compileEnsemble({
      program, ensemble: MODELS, provider: second.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'c2'), root, live: true, programName: 'p',
    });
    assert.equal(second.asked.length, 2, '--live must re-ask');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @shall offline-replay/2.2
test('editing the specification invalidates its recording', async () => {
  const root = temp();
  try {
    const p1 = provider();
    await compileEnsemble({
      program, ensemble: MODELS, provider: p1.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'c'), root, record: true, live: true, programName: 'p',
    });

    const edited = parseShall(
      program.source.replace('count the words', 'tally the words'),
      'examples/word-count.shall',
    ).program!;
    const p2 = provider();
    await compileEnsemble({
      program: edited, ensemble: MODELS, provider: p2.impl as never, maxOutputTokens: 100,
      cacheDir: join(root, 'c2'), root, programName: 'p',
    });
    assert.equal(p2.asked.length, 2, 'a changed specification must never replay a stale answer');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @shall offline-replay/2.3
test('two programs sharing a name keep separate recordings', () => {
  const root = temp();
  try {
    const manifest = readManifest(root);
    manifest.programs['examples/a.shall'] = { recordedAt: '2026-01-01', readers: ['x'] };
    manifest.programs['examples/a.fixed.shall'] = { recordedAt: '2026-01-02', readers: ['y'] };
    writeManifest(root, manifest);

    const back = readManifest(root);
    assert.equal(describeRecording(back, 'examples/a.shall')?.recordedAt, '2026-01-01');
    assert.equal(describeRecording(back, 'examples/a.fixed.shall')?.recordedAt, '2026-01-02');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a damaged manifest reads as nothing recorded, never a crash', () => {
  const root = temp();
  try {
    writeRecording(root, 'abc', 'export function run(){}');
    writeFileSync(join(root, 'recordings', 'manifest.json'), '{ not json');
    const manifest = readManifest(root);
    assert.deepEqual(manifest.readers, {});
    assert.equal(readRecording(root, 'abc') !== null, true, 'the recording itself is still readable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ── cost visibility ───────────────────────────────────────────────────── */

// @shall offline-replay/3.1
// @shall offline-replay/3.2
test('a dry run reports reachability without spending anything', async () => {
  const { ProviderRegistry, resolveRoster } = await import('../dist/shall/provider/registry.js');
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  try {
    const roster = resolveRoster(
      [
        { id: 'openai:a', provider: 'openai', model: 'a', label: 'a' },
        { id: 'anthropic:b', provider: 'anthropic', model: 'b', label: 'b' },
      ],
      new ProviderRegistry(),
    );
    assert.equal(roster.usable.length, 1, 'reachable readers are counted');
    assert.equal(roster.dropped[0].label, 'b', 'an unreachable reader is named, not silently dropped');
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

// @shall offline-replay/1.2
test('a replay states that it is a replay and when it was recorded', () => {
  const manifest = readManifest(process.cwd());
  const info = describeRecording(manifest, 'examples/word-count.shall');
  assert.ok(info, 'the bundled example must be recorded');
  assert.match(info.recordedAt, /^\d{4}-\d{2}-\d{2}$/, 'the banner needs a real date to print');
  assert.ok(info.readers.length >= 2, 'and the readers it came from');
});

// @shall offline-replay/1.4
test('with no key and no recording, the bundled examples are named', () => {
  // The guidance a stranger hits first must point at something that works,
  // not merely report that nothing does.
  const cli = readFileSync('src/shall/cli.ts', 'utf8');
  const guidance = cli.slice(cli.indexOf('has no committed recording'), cli.indexOf('has no committed recording') + 400);
  assert.match(guidance, /examples\//, 'must name a path that replays for free');
  assert.match(guidance, /shall lint/, 'and the command that needs no model at all');

  const manifest = readManifest(process.cwd());
  const named = Object.keys(manifest.programs).filter((p) => guidance.includes(p));
  assert.ok(named.length > 0, 'every example it names must actually be recorded');
});
