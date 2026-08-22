import { createContext, Script } from 'node:vm';

/**
 * Candidate execution.
 *
 * Compiled candidates are model-generated code that has never been reviewed, so
 * they run in a fresh `node:vm` context with no Node globals at all — no
 * require, no process, no fs, no fetch, no timers. The context gets JavaScript
 * intrinsics and nothing else.
 *
 * Synchronous execution is a requirement, not a simplification: `vm`'s timeout
 * can only interrupt synchronous code, and the compiler prompt demands
 * deterministic, side-effect-free functions. A candidate that tries to be async
 * fails to load, which is the correct outcome.
 */

export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface LoadedCandidate {
  run(input: Record<string, unknown>, timeoutMs: number): Outcome;
}

export class LoadError extends Error {}

/**
 * Convert an ES module into an expression yielding `run`.
 *
 * Full ESM evaluation inside `vm` requires the experimental modules API and
 * gains nothing here: candidates are forbidden imports, so the only meaningful
 * ESM syntax is the export itself.
 */
function toScriptSource(moduleSource: string): string {
  let src = moduleSource
    .replace(/^\s*export\s+default\s+(?=function\s+run\b)/gm, '')
    .replace(/^\s*export\s+(?=(?:async\s+)?function\s+)/gm, '')
    .replace(/^\s*export\s+(?=(?:const|let|var|class)\s+)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  if (/^\s*(import|require)\b/m.test(src)) {
    throw new LoadError('candidate uses imports, which the compiler forbids');
  }
  src += '\n;typeof run === "function" ? run : null;';
  return src;
}

// @shall 6.2
/** Compiled once. Recompiling this on every call was wasted work. */
const CALL = new Script('__run(__input)');

export function loadCandidate(moduleSource: string): LoadedCandidate {
  const script = new Script(toScriptSource(moduleSource));

  // Load once, into a throwaway context, only to reject candidates that cannot
  // produce a callable `run` at all.
  try {
    const probe = script.runInContext(
      createContext(Object.create(null) as object),
      { timeout: 2000 },
    );
    if (typeof probe !== 'function') {
      throw new LoadError('candidate does not export a function named `run`');
    }
  } catch (err) {
    if (err instanceof LoadError) throw err;
    throw new LoadError(`candidate failed to load: ${(err as Error).message}`);
  }

  return {
    run(input, timeoutMs) {
      // A FRESH context per call, not one per candidate.
      //
      // Reusing a single context let a candidate carry state between probes - a
      // memo table, a counter, a lazily-built lookup - which made its behaviour
      // vector a function of probe *order*. That silently breaks the invariant
      // the entire oracle rests on: the same input always produces the same
      // output. The compiler prompt forbids randomness and clocks, but no prompt
      // can forbid a global, so isolation is enforced structurally rather than
      // requested politely.
      const context = createContext(Object.create(null) as object);
      try {
        const fn = script.runInContext(context, { timeout: timeoutMs });
        if (typeof fn !== 'function') {
          return { ok: false, error: 'candidate did not produce a callable `run`' };
        }
        Object.assign(context as Record<string, unknown>, {
          __run: fn,
          __input: structuredClone(input),
        });
        // @shall 6.3
        const value = CALL.runInContext(context, { timeout: timeoutMs });
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: (err as Error).message || String(err) };
      }
    },
  };
}

/**
 * Canonical form of an outcome, used to decide agreement.
 *
 * Two candidates agree when their canonical forms are byte-identical. Errors
 * are compared as a class, not by message: the specification never dictates
 * wording, so two candidates that both refuse an input have agreed about the
 * behaviour even if they phrase the refusal differently. A candidate that
 * returns where another throws has genuinely diverged.
 */
export function canonical(outcome: Outcome): string {
  if (!outcome.ok) return '!error';
  return canonicalValue(outcome.value);
}

export function canonicalValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
    // -0 and 0 are indistinguishable to a user reading a total; treat as equal.
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v)}`);
    return `{${entries.join(',')}}`;
  }
  return `<${typeof value}>`;
}

/** Short display form for report tables. */
export function display(outcome: Outcome, max = 28): string {
  const text = outcome.ok ? canonicalValue(outcome.value) : `error: ${outcome.error}`;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Are two numbers equal to within a few units in the last place?
 *
 * This is a relative-epsilon test scaled by magnitude, not a bit-exact ULP
 * count - close enough for the question being asked, and honest about being an
 * approximation. Signs are never bridged: -0.0 and 0.0 compare equal via the
 * `a === b` fast path, but a genuinely negative result is never called
 * equivalent to a positive one.
 */
export function withinUlps(a: unknown, b: unknown, ulps = 4): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.sign(a) !== Math.sign(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * Number.EPSILON * ulps;
}

export type Agreement = 'identical' | 'numerically-equivalent' | 'divergent';

/**
 * How two outcomes relate.
 *
 * The middle class exists because IEEE 754 is not English. A reader that
 * computes `0.1 + 0.2` and one that computes `0.3` understood the
 * specification identically and differ only in operation order. Reporting that
 * as an ambiguous specification points at an innocent clause, and an author
 * sent to edit correct prose stops trusting the tool.
 */
export function agreement(a: Outcome, b: Outcome, ulps = 4): Agreement {
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return 'identical';
  if (a.ok && b.ok && withinUlps(a.value, b.value, ulps)) return 'numerically-equivalent';
  return 'divergent';
}
