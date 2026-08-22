#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

import { join, resolve, basename } from 'node:path';
import { parseShall, hasFatal } from './lang/parser.js';
import { loadShallConfig } from './config.js';
import { OpenAIProvider } from './provider/openai.js';
import { ProviderRegistry, resolveRoster } from './provider/registry.js';
import { compileEnsemble } from './compile/compiler.js';
import { structuralProbes, parseGeneratedProbes, PROBE_INSTRUCTIONS } from './oracle/probes.js';
import { runDifferential, buildVerdict } from './oracle/differential.js';
import { minimiseWitness } from './oracle/minimise.js';
import { canonical as canonicalOutcome, display as displayOutcome } from './execute/sandbox.js';
import { suggestRewrites, applyRewrite } from './suggest/suggest.js';
import { writeFileSync as writeFile } from 'node:fs';
import { attribute, attributePairs, lintVagueness } from './attribute/attribute.js';
import { renderAmbiguity, renderSuccess, renderVaguenessOnly, renderConformance, renderSuggestions } from './report/terminal.js';
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
  suggest <file>  Propose a rewrite for each reading the readers found, then
                  verify the chosen one compiles. --apply <n> writes it.
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
  --dry-run       Show what a run would cost and which readers are reachable.
  --apply <n>     With 'suggest': write reading <n> into the file and re-check.
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
  dryRun: boolean;
  update: boolean;
  verbose: boolean;
  noConform: boolean;
  noCache: boolean;
  json: boolean;
  probes?: number;
  out?: string;
  input?: string;
  apply?: number;
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
    dryRun: argv.includes('--dry-run'),
    record: argv.includes('--record'),
    update: argv.includes('--update'),
    verbose: argv.includes('--verbose') || argv.includes('-v'),
    noConform: argv.includes('--no-conform'),
    noCache: argv.includes('--no-cache'),
    json: argv.includes('--json'),
    ...(probes ? { probes: Number(probes) } : {}),
    ...(value('--out') ? { out: value('--out') } : {}),
    ...(value('--input') ? { input: value('--input') } : {}),
    ...(value('--apply') ? { apply: Number(value('--apply')) } : {}),
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
  const provider = new ProviderRegistry();
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
      // @shall offline-replay/1.4
    throw new CliError(
      'OPENAI_API_KEY is not set, and this program has no committed recording.\n' +
        '  Try one of the bundled examples, which replay for free:\n' +
        '    shall check examples/word-count.shall\n' +
        '  Or run `shall lint`, which needs no model at all.',
    );
  }

  // @shall offline-replay/1.2
  if (fullyRecorded && !flags.json) {
    const info = describeRecording(manifest, file);
    const when = info ? info.recordedAt : 'a previous run';
    process.stderr.write(
      `  replaying ${config.ensemble.length} recorded readers (${when}) - --live to re-ask\n`,
    );
  }

  // Drop readers whose vendor has no key, and say what independence remains.
  const roster = resolveRoster(config.ensemble, provider);
  if (!flags.json && !fullyRecorded) {
    if (roster.dropped.length > 0) {
      process.stderr.write(
        `  skipping  ${roster.dropped.map((m) => m.label).join(', ')} (no key for ${[...new Set(roster.dropped.map((m) => m.provider))].join(', ')})\n`,
      );
    }
    // @shall multi-vendor-ensemble/2.2
    if (roster.singleVendor && roster.usable.length > 0) {
      process.stderr.write(
        `  note      all ${roster.usable.length} readers are ${roster.vendors[0]} - same-vendor readers share blind spots\n`,
      );
    }
  }

  const probeLimit = flags.probes ?? config.probeCount;
  let probes = structuralProbes(program, probeLimit);

  // Adversarial probes need a model; structural probes alone still work offline.
  if (!flags.offline && !fullyRecorded && provider.isConfigured()) {
    try {
      const result = await provider.complete(roster.usable[0] ?? config.ensemble[0]!, {
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
    ensemble: fullyRecorded ? config.ensemble : (roster.usable.length ? roster.usable : config.ensemble),
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

  // Shrink each reported witness to the smallest input that still splits the
  // readers. Probes are microseconds; this costs nothing and the output reads
  // very differently when the witness has nothing spare in it.
  for (const divergence of oracle.behaviourDivergences.slice(0, 3)) {
    const minimal = minimiseWitness(program, divergence.probe, oracle.loadable, config.executionTimeoutMs);
    if (!minimal.smaller) continue;
    divergence.minimalInput = minimal.input;

    // Re-group the readers by what they return for the SHRUNK input. Reusing
    // the probe's readings here would pair an input with outputs measured
    // somewhere else, which is a report that is simply wrong.
    // @shall disambiguation/1.2
    const grouped = new Map<string, { display: string; members: string[] }>();
    minimal.outcomes.forEach((outcome, i) => {
      const key = canonicalOutcome(outcome);
      const entry = grouped.get(key) ?? { display: displayOutcome(outcome), members: [] };
      entry.members.push(oracle.loadable[i]!.label);
      grouped.set(key, entry);
    });
    divergence.minimalReadings = [...grouped.entries()]
      .map(([canonical, v]) => ({ canonical, ...v }))
      .sort((a, b) => b.members.length - a.members.length);
  }

  const verdict = buildVerdict(oracle, config.quorum);
  const vagueness = lintVagueness(program);
  // Arithmetic artefacts must never implicate a clause.
  const attributions = attribute(program, oracle.behaviourDivergences, probes);
  // Ambiguity often lives between two precise clauses rather than inside one
  // vague clause. A named vague phrase is strong evidence and wins outright;
  // a weak statistical association does not, and should not suppress a pair
  // that accounts for every disagreement.
  const topAttribution = attributions[0];
  const weakSingleClause =
    topAttribution !== undefined && topAttribution.vagueTerm === undefined && topAttribution.lift < 0.15;
  const pairs =
    attributions.length === 0 || weakSingleClause
      ? attributePairs(program, oracle.behaviourDivergences, probes)
      : [];

  return { program, config, oracle, verdict, vagueness, attributions, pairs, compiled, root };
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
      provider: new ProviderRegistry(),
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
  const { program, config, oracle, verdict, vagueness, attributions, pairs, compiled, root } =
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
        program, oracle, attributions, pairs, vagueness,
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

// @shall shall-language/6.4
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
/**
 * Propose a disambiguating rewrite for each reading the readers produced.
 *
 * The proposal is a model call and is untrusted. The verification that it works
 * is the existing deterministic oracle - so `--apply` writes the sentence and
 * immediately re-runs the check, and reports what actually happened rather than
 * what was hoped for.
 */
/**
 * What a run would cost, before it costs it.
 *
 * A reader running `check` for the first time has no idea what they are about
 * to spend, and an unreachable model currently degrades into a smaller quorum
 * silently - which can change a verdict for a reason the user cannot see. Both
 * are surfaced here.
 */
// @shall offline-replay/3.1
// @shall offline-replay/3.2
async function cmdDryRun(file: string, flags: Flags): Promise<number> {
  const program = loadProgram(file);
  const root = process.cwd();
  const config = loadShallConfig(root);
  const registry = new ProviderRegistry();
  const roster = resolveRoster(config.ensemble, registry);

  const compilerInput = buildCompilerInput(program);
  const recorded = config.ensemble.filter(
    (m) => readRecording(root, recordingKeyFor(compilerInput, m.id)) !== null,
  );

  // A rough token estimate: every reader receives the same input, and emits a
  // module of roughly the size the examples produce.
  const inputTokens = Math.ceil(compilerInput.length / 4) + 220;
  const outputTokens = 700;
  const readersToAsk = flags.live ? roster.usable.length : roster.usable.length - recorded.length;
  const willAsk = Math.max(0, readersToAsk);

  const out: string[] = [''];
  out.push(`  ${program.name}  ${file}`);
  out.push('');
  out.push(`  ensemble       ${config.ensemble.length} readers across ${new Set(config.ensemble.map((m) => m.provider)).size} vendor(s)`);
  out.push(`  reachable      ${roster.usable.length} (${roster.vendors.join(', ') || 'none - no key set'})`);
  if (roster.dropped.length > 0) {
    out.push(`  unreachable    ${roster.dropped.map((m) => m.label).join(', ')}`);
  }
  out.push(`  recorded       ${recorded.length}/${config.ensemble.length} replay free`);
  out.push(`  probes         ${config.probeCount} structural (free)`);
  out.push('');
  if (willAsk === 0) {
    out.push(`  this run costs nothing - every reader replays from recordings/`);
  } else {
    const totalIn = willAsk * inputTokens;
    const totalOut = willAsk * outputTokens;
    out.push(`  would ask      ${willAsk} reader(s)`);
    out.push(`  estimated      ~${totalIn.toLocaleString()} input + ~${totalOut.toLocaleString()} output tokens`);
    out.push(`  ${dimText('a rough estimate from input length; actual usage is reported after a real run')}`);
  }
  if (roster.singleVendor && roster.usable.length > 1) {
    out.push('');
    out.push(`  note           all reachable readers are ${roster.vendors[0]} - same-vendor readers share blind spots`);
  }
  out.push('');
  process.stdout.write(out.join('\n'));
  return 0;
}

function dimText(s: string): string {
  return process.env.NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`;
}

async function cmdSuggest(file: string, flags: Flags): Promise<number> {
  const { program, config, oracle, verdict, attributions } = await analyse(file, flags);

  if (verdict.ok) {
    process.stdout.write(`\n  ${program.name} is already unambiguous - nothing to suggest.\n\n`);
    return 0;
  }
  const target = attributions[0];
  if (!target) {
    throw new CliError('the readers disagreed, but no single clause is responsible - nothing to rewrite', 1);
  }

  const provider = new ProviderRegistry();
  if (!provider.isConfigured()) {
    throw new CliError('proposing a rewrite needs a model key; the check itself does not');
  }

  process.stderr.write(`  proposing rewrites for ${oracle.groups.length} readings...\n`);
  const suggestions = await suggestRewrites({
    program,
    criterion: target.criterion,
    groups: oracle.groups,
    divergences: oracle.behaviourDivergences,
    provider,
    model: config.ensemble[0]!,
    maxOutputTokens: 600,
  });

  // @shall disambiguation/2.4
  if (flags.apply !== undefined) {
    const chosen = suggestions[flags.apply - 1];
    if (!chosen) throw new CliError(`no reading ${flags.apply} - there are ${suggestions.length}`);

    const updated = applyRewrite(program.source, target.criterion.line, chosen.rewrite);
    writeFile(resolve(file), updated, 'utf8');
    process.stdout.write(`\n  wrote reading ${flags.apply} into ${file}:${target.criterion.line}\n`);
    process.stdout.write(`    ${chosen.rewrite}\n\n  re-checking...\n`);

    // The proposal was untrusted; this is the part that is not.
    return cmdBuild(file, { ...flags, apply: undefined, live: true }, false);
  }

  process.stdout.write(renderSuggestions(program, target.criterion, suggestions));
  return 1;
}

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
  const provider = new ProviderRegistry();
  if (!provider.isConfigured()) throw new CliError('no provider key is set (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, ...)');

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
      case 'build':  process.exitCode = flags.dryRun
        ? await cmdDryRun(file, flags)
        : await cmdBuild(file, flags, true); break;
      case 'check':  process.exitCode = flags.dryRun
        ? await cmdDryRun(file, flags)
        : await cmdBuild(file, flags, false); break;
      case 'lint':   process.exitCode = cmdLint(file); break;
      case 'suggest': process.exitCode = await cmdSuggest(file, flags); break;
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
