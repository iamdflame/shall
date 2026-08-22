import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Program } from '../lang/types.js';
import type { CompilerModel, Provider } from '../provider/types.js';
import { ProviderError } from '../provider/types.js';
import { COMPILER_INSTRUCTIONS, buildCompilerInput, extractModule } from './prompt.js';

/**
 * The ensemble compiler.
 *
 * Every member receives byte-identical instructions and byte-identical input.
 * That is the experimental control: any difference in what comes back is
 * attributable to the reader, not to the question. Members run concurrently and
 * in isolation, and none is told that others exist - a member that knew it was
 * being compared would hedge toward the obvious reading, which is precisely the
 * bias the ensemble is built to measure.
 *
 * A member that fails is recorded and dropped rather than aborting the compile.
 * A degraded ensemble still detects ambiguity; it simply detects less of it, and
 * the report says so rather than pretending to a confidence it does not have.
 */

/** Bump when the prompt changes, so stale cached candidates are not reused. */
const PROMPT_VERSION = 'v1';

export interface Candidate {
  modelId: string;
  label: string;
  source: string;
  cached: boolean;
  usage: { input: number; output: number };
  ms: number;
}

export interface CompileFailure {
  modelId: string;
  label: string;
  reason: string;
  kind: string;
}

export interface CompileResult {
  candidates: Candidate[];
  failures: CompileFailure[];
  /** Total tokens actually purchased on this run (cache hits excluded). */
  usage: { input: number; output: number };
}

/**
 * The cache key covers everything that could change what a reader was asked:
 * the prompt version, the reader's identity, and the exact compiler input.
 *
 * The input is passed in rather than recomputed per member. Recomputing it made
 * the key depend on a second evaluation of a function whose result must be
 * byte-identical for the cache to be sound - a fragility with no upside.
 */
function cacheKey(compilerInput: string, model: CompilerModel): string {
  return createHash('sha256')
    .update([PROMPT_VERSION, model.id, compilerInput].join('\n---\n'))
    .digest('hex')
    .slice(0, 32);
}

export interface CompileOptions {
  program: Program;
  ensemble: CompilerModel[];
  provider: Provider;
  maxOutputTokens: number;
  cacheDir: string;
  /** Ignore cached candidates and recompile every member. */
  noCache?: boolean;
  onProgress?: (event: { modelId: string; label: string; state: 'start' | 'done' | 'cached' | 'failed' }) => void;
}

// @shall 2.1
export async function compileEnsemble(options: CompileOptions): Promise<CompileResult> {
  const { program, ensemble, provider, maxOutputTokens, cacheDir, noCache, onProgress } = options;
  mkdirSync(cacheDir, { recursive: true });

  const input = buildCompilerInput(program);

  const settled = await Promise.all(
    ensemble.map(async (model): Promise<Candidate | CompileFailure> => {
      const key = cacheKey(input, model);
      const cachePath = join(cacheDir, `${key}.js`);

      // @shall 2.4
      if (!noCache && existsSync(cachePath)) {
        onProgress?.({ modelId: model.id, label: model.label, state: 'cached' });
        return {
          modelId: model.id,
          label: model.label,
          source: readFileSync(cachePath, 'utf8'),
          cached: true,
          usage: { input: 0, output: 0 },
          ms: 0,
        };
      }

      onProgress?.({ modelId: model.id, label: model.label, state: 'start' });
      try {
        const result = await provider.complete(model, {
          instructions: COMPILER_INSTRUCTIONS,
          input,
          maxOutputTokens,
        });
        const source = extractModule(result.text);
        if (!source) {
          throw new ProviderError(`${model.id} produced no module body`, 'unknown', model.id);
        }
        writeFileSync(cachePath, source, 'utf8');
        onProgress?.({ modelId: model.id, label: model.label, state: 'done' });
        return {
          modelId: model.id,
          label: model.label,
          source,
          cached: false,
          usage: result.usage,
          ms: result.ms,
        };
      // @shall 2.3
      } catch (err) {
        onProgress?.({ modelId: model.id, label: model.label, state: 'failed' });
        const kind = err instanceof ProviderError ? err.kind : 'unknown';
        return {
          modelId: model.id,
          label: model.label,
          reason: (err as Error).message,
          kind,
        };
      }
    }),
  );

  const candidates = settled.filter((r): r is Candidate => 'source' in r);
  const failures = settled.filter((r): r is CompileFailure => 'reason' in r);

  return {
    candidates,
    failures,
    usage: candidates.reduce(
      (acc, c) => ({ input: acc.input + c.usage.input, output: acc.output + c.usage.output }),
      { input: 0, output: 0 },
    ),
  };
}
