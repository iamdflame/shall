#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

import { join, resolve, basename } from 'node:path';
import { parseShall, hasFatal } from './lang/parser.js';
import { loadShallConfig } from './config.js';
import { OpenAIProvider } from './provider/openai.js';
import { compileEnsemble } from './compile/compiler.js';
import { structuralProbes, parseGeneratedProbes, PROBE_INSTRUCTIONS } from './oracle/probes.js';
import { runDifferential, buildVerdict } from './oracle/differential.js';
import { attribute, lintVagueness } from './attribute/attribute.js';
import { renderAmbiguity, renderSuccess, renderVaguenessOnly, renderConformance } from './report/terminal.js';
import { deriveExpectations } from './conform/expectations.js';
import { checkConformance, conformanceBlocks } from './conform/check.js';
import { programCriteria } from './lang/types.js';
import { createHash } from 'node:crypto';
import { buildCompilerInput } from './compile/prompt.js';
import type { Program } from './lang/types.js';
import { readManifest, readRecording, describeRecording } from './compile/recordings.js';
import { loadSpecs } from '../ears/spec-reader.js';
import { scanBindings } from '../binding/scanner.js';
import { runTests } from '../verify/runner.js';
import { buildReport, toLock } from '../verify/conformance.js';
import { readLock, writeLock } from '../lock/lockfile.js';
import { renderReport, exitCodeFor } from '../report/terminal.js';

const HELP = `
shall - a language whose source code is English

  Requirements are the program. The compiler is an ensemble of independent
  readers. If they disagree about what your English means, that is a compile
  error, and it points at the sentence.

USAGE
  shall <command> [file] [options]

COMMANDS
  build <file>    Compile a .shall program. Emits JavaScript, or fails with an
                  ambiguity report naming the clause responsible.
  check <file>    Same analysis, but emit nothing. For CI.
  lint <file>     Static scan for open wording. No model calls, no API key.
  record <file>   Ask the readers for real and commit the result to recordings/
                  so anyone can replay the same run for free.
  run <file>      Build (using cache) and execute against one input.
  verify          Check this repository against its own .kiro specification.
  models          List models this account can actually reach.
  help            Show this message.

OPTIONS
  --input <json>  Input object for 'run', e.g. '{"subtotal":51,"couponPercent":6}'
  --live          Re-ask every reader for real. Costs money.
  --offline       Never call a model, even if nothing is recorded.
  --no-conform    Skip the conformance pass (consensus only).
  --no-cache      Recompile every reader, ignoring cache.
  --probes <n>    Structural probe count (default from config).
  --out <path>    Output path for 'build'.
  --json          Machine-readable result.
  --update        Record the current state as the drift baseline ('verify').

EXIT CODES
  0  the specification is unambiguous
  1  the specification is ambiguous, or the program is invalid
  2  shall could not run
`;

interface Flags {
  offline: boolean;
  live: boolean;
  record: boolean;
  update: boolean;
  verbose: boolean;
  noConform: boolean;
  noCache: boolean;
  json: boolean;
  probes?: number;
  out?: string;
  input?: string;
}

function parseFlags(argv: string[]): Flags {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const probes = value('--probes');
  return {
    offline: argv.includes('--offline'),
    live: argv.includes('--live'),
    record: argv.includes('--record'),
    update: argv.includes('--update'),
    verbose: argv.includes('--verbose') || argv.includes('-v'),
    noConform: argv.includes('--no-conform'),
    noCache: argv.includes('--no-cache'),
    json: argv.includes('--json'),
    ...(probes ? { probes: Number(probes) } : {}),
    ...(value('--out') ? { out: value('--out') } : {}),
    ...(value('--input') ? { input: value('--input') } : {}),
  };
}

/**
 * Load `.env` from the working directory if present.
 *
 * Keys belong in a file the repository ignores, not in a shell history or a
 * committed config. `process.loadEnvFile` is built into Node, so this costs no
 * dependency. An existing environment variable always wins, so CI and one-off
 * overrides are never clobbered by a stale local file.
 */
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  const had = process.env.OPENAI_API_KEY;
  try {
    process.loadEnvFile(path);
  } catch {
    // A malformed .env must not stop a command that needs no key at all.
    return;
  }
  if (had) process.env.OPENAI_API_KEY = had;
}

/** The recording key must match the compiler's cache key exactly. */
function recordingKeyFor(compilerInput: string, modelId: string): string {
  return createHash('sha256')
    .update(['v1', modelId, compilerInput].join('\n---\n'))
    .digest('hex')
    .slice(0, 32);
}

class CliError extends Error {
  constructor(message: string, readonly code = 2) {
    super(message);
  }
}

function loadProgram(file: string): Program {
  if (!file) throw new CliError('no input file - usage: shall <command> <file.shall>');
  const path = resolve(file);
  if (!existsSync(path)) throw new CliError(`no such file: ${file}`);

  const { program, diagnostics } = parseShall(readFileSync(path, 'utf8'), file);

  const fatal = diagnostics.filter((d) => d.fatal);
  if (fatal.length > 0 || !program) {
    const lines = fatal.map((d) => `  ${file}:${d.line}  ${d.message}`);
    throw new CliError(`the program is not valid:\n${lines.join('\n')}`, 1);
  }
  for (const d of diagnostics) {
    process.stderr.write(`  warning  ${file}:${d.line}  ${d.message}\n`);
  }
  return program;
}

async function analyse(file: string, flags: Flags) {
  const program = loadProgram(file);
  const root = process.cwd();
  const config = loadShallConfig(root);
  const provider = new OpenAIProvider();
  const cacheDir = join(root, config.buildDir, 'cache');

  // Does a committed recording cover this exact program for every reader?
  const manifest = readManifest(root);
  const compilerInput = buildCompilerInput(program);
  const fullyRecorded =
    !flags.live &&
    config.ensemble.every((model) =>
      readRecording(root, recordingKeyFor(compilerInput, model.id)) !== null,
    );

  if (!fullyRecorded && !flags.offline && !provider.isConfigured()) {
    throw new CliError(
      'OPENAI_API_KEY is not set, and this program has no committed recording.\n' +
        '  Try one of the bundled examples, which replay for free:\n' +
        '    shall check examples/word-count.shall\n' +
        '  Or run `shall lint`, which needs no model at all.',
    );
  }

  if (fullyRecorded && !flags.json) {
    const info = describeRecording(manifest, file);
    const when = info ? info.recordedAt : 'a previous run';
    process.stderr.write(
      `  replaying ${config.ensemble.length} recorded readers (${when}) - --live to re-ask\n`,
    );
  }

  const probeLimit = flags.probes ?? config.probeCount;
  let probes = structuralProbes(program, probeLimit);

  // Adversarial probes need a model; structural probes alone still work offline.
  if (!flags.offline && !fullyRecorded && provider.isConfigured()) {
    try {
      const result = await provider.complete(config.ensemble[0]!, {
        instructions: PROBE_INSTRUCTIONS,
        input: buildCompilerInput(program),
        maxOutputTokens: 2000,
      });
      probes = [...probes, ...parseGeneratedProbes(result.text, program, probes.length)];
    } catch {
      // A probe-generation failure weakens the search but never blocks a build.
    }
  }

  const compiled = await compileEnsemble({
    program,
    ensemble: config.ensemble,
    provider,
    maxOutputTokens: config.maxOutputTokens,
    cacheDir,
    root,
    live: flags.live,
    record: flags.record,
    programName: file,
    noCache: flags.noCache,
    onProgress: flags.json
      ? undefined
      : (e) => {
          if (e.state === 'start') process.stderr.write(`  reading   ${e.label}...\n`);
          if (e.state === 'cached') process.stderr.write(`  cached    ${e.label}\n`);
          if (e.state === 'recorded') process.stderr.write(`  recorded  ${e.label}\n`);
        },
  });

  if (compiled.candidates.length === 0) {
    throw new CliError(
      flags.offline
        ? 'nothing recorded or cached for this program, and --offline forbids asking'
        : 'no reader produced a candidate for this program',
    );
  }

  const oracle = runDifferential(compiled.candidates, {
    probes,
    executionTimeoutMs: config.executionTimeoutMs,
  });

  const verdict = buildVerdict(oracle, config.quorum);
  const vagueness = lintVagueness(program);
  // Arithmetic artefacts must never implicate a clause.
  const attributions = attribute(program, oracle.behaviourDivergences, probes);

  return { program, config, oracle, verdict, vagueness, attributions, compiled, root };
}

/**
 * Derive expectations from each clause and test the built program against them.
 *
 * Results are cached alongside the compiled candidates, keyed by the program and
 * the jurors, so re-running a build costs nothing. Returns null when the pass
 * cannot run - offline, disabled, or no expectation survived agreement - rather
 * than blocking a build on a check that never happened.
 */
async function runConformance(
  program: Program,
  source: string,
  config: ReturnType<typeof loadShallConfig>,
  flags: Flags,
  root: string,
) {
  if (flags.noConform) return null;
  if (flags.offline && !existsSync(join(root, config.buildDir, 'cache'))) return null;

  const criteria = programCriteria(program);
  const jurors = config.ensemble.slice(0, Math.min(3, config.ensemble.length));
  const cacheDir = join(root, config.buildDir, 'cache');
  const key = createHash('sha256')
    .update(['expect-v1', jurors.map((j) => j.id).join(','), buildCompilerInput(program)].join('\n---\n'))
    .digest('hex')
    .slice(0, 32);
  const cachePath = join(cacheDir, `expect-${key}.json`);

  let derived: Awaited<ReturnType<typeof deriveExpectations>> | null = null;

  if (!flags.noCache && existsSync(cachePath)) {
    try {
      derived = JSON.parse(readFileSync(cachePath, 'utf8'));
      process.stderr.write('  cached   expectations\n');
    } catch {
      derived = null;
    }
  }

  if (!derived) {
    if (flags.offline) return null;
    derived = await deriveExpectations({
      program,
      criteria,
      jurors,
      provider: new OpenAIProvider(),
      maxOutputTokens: 2000,
      minAgreement: 2,
      onProgress: (id) => process.stderr.write(`  deriving ${id}...\n`),
    });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(derived, null, 2), 'utf8');
  }

  if (derived.agreed.length === 0 && derived.disputed.length === 0) return null;

  return checkConformance(source, criteria, derived.agreed, derived.disputed, config.executionTimeoutMs);
}

async function cmdBuild(file: string, flags: Flags, emit: boolean): Promise<number> {
  const { program, config, oracle, verdict, vagueness, attributions, compiled, root } =
    await analyse(file, flags);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          program: program.name,
          unambiguous: verdict.ok,
          readers: oracle.loadable.length,
          probes: oracle.probes.length,
          divergences: oracle.behaviourDivergences.map((d) => ({
            input: d.probe.input,
            readings: d.readings.map((r) => ({ value: r.display, readers: r.members })),
          })),
          numericDivergences: oracle.numericDivergences.map((d) => ({
            input: d.probe.input,
            readings: d.readings.map((r) => ({ value: r.display, readers: r.members })),
          })),
          implicated: attributions.map((a) => ({
            criterion: a.criterion.id,
            line: a.criterion.line,
            text: a.criterion.raw,
            lift: Number(a.lift.toFixed(3)),
          })),
          warnings: vagueness.map((w) => ({ line: w.criterion.line, term: w.term, why: w.why })),
        },
        null,
        2,
      )}\n`,
    );
    return verdict.ok ? 0 : 1;
  }

  if (!verdict.ok) {
    process.stdout.write(
      renderAmbiguity({
        program, oracle, attributions, vagueness,
        failures: compiled.failures,
        reason: verdict.reason,
      }),
    );
    return 1;
  }

  // Consensus established. Now the second question: is what they agreed on
  // actually what the specification asked for?
  const conformance = await runConformance(program, verdict.group.members[0]!.source, config, flags, root);
  const blocked = conformance !== null && conformanceBlocks(conformance);

  const outPath = resolve(
    root,
    flags.out ?? join(config.buildDir, `${basename(file).replace(/\.shall$/, '')}.js`),
  );

  if (emit && !blocked) {
    mkdirSync(resolve(outPath, '..'), { recursive: true });
    const header =
      `// Generated by shall from ${program.path}\n` +
      `// ${oracle.loadable.length} independent readers agreed on all ${oracle.probes.length} probes.\n` +
      `// Do not edit: edit the .shall specification and rebuild.\n\n`;
    writeFileSync(outPath, header + verdict.group.members[0]!.source + '\n', 'utf8');
  }

  process.stdout.write(
    renderSuccess({
      program, oracle, vagueness,
      failures: compiled.failures,
      outputPath: blocked
        ? '(blocked: the program contradicts the specification)'
        : emit
          ? outPath
          : '(check only, nothing written)',
      cachedCount: compiled.candidates.filter((c) => c.cached).length,
      usage: compiled.usage,
    }),
  );

  // Conformance follows consensus, because it only means anything once the
  // readers have agreed on which program is being judged.
  if (conformance) process.stdout.write(renderConformance(program, conformance));

  return blocked ? 1 : 0;
}

// @shall 6.4
function cmdLint(file: string): number {
  const program = loadProgram(file);
  const warnings = lintVagueness(program);
  process.stdout.write(renderVaguenessOnly(program, warnings));
  return warnings.length > 0 ? 1 : 0;
}

async function cmdRun(file: string, flags: Flags): Promise<number> {
  if (!flags.input) throw new CliError("'run' needs --input '<json>'");

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(flags.input) as Record<string, unknown>;
  } catch (err) {
    throw new CliError(`--input is not valid JSON: ${(err as Error).message}`);
  }

  const { config, oracle, verdict } = await analyse(file, flags);
  if (!verdict.ok) {
    throw new CliError(`refusing to run an ambiguous specification: ${verdict.reason}`, 1);
  }

  const { loadCandidate } = await import('./execute/sandbox.js');
  const outcome = loadCandidate(verdict.group.members[0]!.source).run(input, config.executionTimeoutMs);
  void oracle;

  if (!outcome.ok) {
    process.stderr.write(`  runtime error: ${outcome.error}\n`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(outcome.value)}\n`);
  return 0;
}

/**
 * Verify this repository against the Kiro specification it was built from.
 *
 * SHALL compiles English into programs; this command turns the same discipline
 * on SHALL itself. `.kiro/specs/**\/requirements.md` states what this codebase
 * must do, every clause is bound to the code and the test that satisfies it, and
 * the test suite decides whether those claims still hold. A specification
 * nothing verifies is a wish.
 */
async function cmdVerify(flags: Flags): Promise<number> {
  const root = process.cwd();
  const kiroDir = join(root, '.kiro');
  if (!existsSync(kiroDir)) throw new CliError('no .kiro/ directory in this repository');

  const specs = loadSpecs(kiroDir);
  const bindings = ['src', 'tests'].flatMap((dir) => {
    const target = join(root, dir);
    if (!existsSync(target)) return [];
    return scanBindings(target).map((b) => ({ ...b, file: `${dir}/${b.file}` }));
  });

  const tests = await runTests('npm test', root, 300_000);
  const ran = tests.ran && tests.results.length > 0;

  const report = buildReport({
    specs,
    bindings,
    testResults: tests.results,
    lock: readLock(join(root, '.shall', 'spec.lock.json')),
    testsRan: ran,
    ...(ran ? {} : { testError: tests.error ?? 'the test suite produced no readable TAP output' }),
  });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return exitCodeFor(report, false);
  }

  process.stdout.write(renderReport(report, { verbose: flags.verbose }));

  if (flags.update) {
    writeLock(join(root, '.shall', 'spec.lock.json'), toLock(report));
    process.stdout.write('  baseline recorded in .shall/spec.lock.json\n\n');
    return 0;
  }
  return exitCodeFor(report, false);
}

async function cmdModels(): Promise<number> {
  const provider = new OpenAIProvider();
  if (!provider.isConfigured()) throw new CliError('OPENAI_API_KEY is not set');

  const ids = await provider.listModels();
  const config = loadShallConfig(process.cwd());
  const available = new Set(ids);

  process.stdout.write('\n  CONFIGURED ENSEMBLE\n\n');
  for (const m of config.ensemble) {
    const ok = available.has(m.model);
    process.stdout.write(`    ${ok ? '+' : 'x'}  ${m.label.padEnd(20)} ${m.model}${ok ? '' : '  (not available)'}\n`);
  }
  process.stdout.write(`\n  ${ids.length} models reachable. Set "ensemble" in shall.config.json to change.\n\n`);
  return 0;
}

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  const command = positional[0] ?? 'help';
  const file = positional[1] ?? '';
  const flags = parseFlags(argv);

  try {
    switch (command) {
      case 'build':  process.exitCode = await cmdBuild(file, flags, true); break;
      case 'check':  process.exitCode = await cmdBuild(file, flags, false); break;
      case 'lint':   process.exitCode = cmdLint(file); break;
      case 'record': process.exitCode = await cmdBuild(file, { ...flags, live: true, record: true }, false); break;
      case 'run':    process.exitCode = await cmdRun(file, flags); break;
      case 'verify': process.exitCode = await cmdVerify(flags); break;
      case 'models': process.exitCode = await cmdModels(); break;
      case 'help':   process.stdout.write(HELP); process.exitCode = 0; break;
      default:
        process.stderr.write(`unknown command: ${command}\n${HELP}`);
        process.exitCode = 2;
    }
  } catch (err) {
    const e = err as CliError;
    process.stderr.write(`\n  shall: ${e.message}\n\n`);
    process.exitCode = e.code ?? 2;
  }
}

void main();
