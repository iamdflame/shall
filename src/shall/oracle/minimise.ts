import type { Program, ShallType } from '../lang/types.js';
import { isListType } from '../lang/types.js';
import type { Probe } from './probes.js';
import { loadCandidate, canonical, type Outcome } from '../execute/sandbox.js';

/**
 * Witness minimisation.
 *
 * A compiler error points at the smallest input that reproduces the problem.
 * `"well-known state-of-the-art"` proves readers disagree; `"a-b"` proves it and
 * leaves nothing else in the input to blame. The second is dramatically more
 * persuasive for the same underlying fact, because the reader can see at a
 * glance that no other feature of the string could be responsible.
 *
 * Probes are microseconds and readers are already loaded, so hundreds of shrink
 * steps per divergence cost nothing measurable. This is delta debugging with the
 * shrink candidates chosen per type.
 */

export interface Minimised {
  input: Record<string, unknown>;
  /** How many shrink steps were accepted. */
  steps: number;
  /** True when the minimal witness differs from the one originally found. */
  smaller: boolean;
  /**
   * What each reader returns for `input`, in the order the sources were given.
   *
   * Returned alongside the input because they must be read together: pairing a
   * shrunk witness with outputs measured on the original probe produces a
   * report that is simply wrong.
   */
  outcomes: Outcome[];
}

type Runner = (input: Record<string, unknown>) => Outcome[];

/** Does this input still split the readers the same way? */
function stillSplits(outcomes: Outcome[]): boolean {
  const distinct = new Set(outcomes.map(canonical));
  return distinct.size > 1;
}

/** Shrink candidates for one value, ordered simplest-first. */
function shrinkValue(value: unknown, type: ShallType): unknown[] {
  if (isListType(type)) {
    if (!Array.isArray(value) || value.length === 0) return [];
    const out: unknown[] = [[]];
    if (value.length > 1) {
      out.push(value.slice(0, Math.floor(value.length / 2)));
      out.push(value.slice(Math.floor(value.length / 2)));
      for (let i = 0; i < value.length; i++) {
        out.push([...value.slice(0, i), ...value.slice(i + 1)]);
      }
    }
    return out;
  }

  if (typeof value === 'string') {
    if (value.length === 0) return [];
    const out: unknown[] = [''];
    if (value.length > 1) {
      out.push(value.slice(0, Math.ceil(value.length / 2)));
      out.push(value.slice(Math.floor(value.length / 2)));
      // Drop one character at a time; this is what reduces a long phrase to "a-b".
      for (let i = 0; i < value.length; i++) {
        out.push(value.slice(0, i) + value.slice(i + 1));
      }
      // Collapse runs of the same character.
      const collapsed = value.replace(/(.)\1+/g, '$1');
      if (collapsed !== value) out.push(collapsed);

      // Simplifying characters matters as much as deleting them. Deletion alone
      // gets stuck at a local minimum like "ell-kno", which is short but still
      // full of irrelevant detail. Flattening every alphanumeric to 'a' leaves
      // only the structure that actually causes the split - "a-a" says "the
      // hyphen is the problem" in a way "ell-kno" does not.
      const flattened = value.replace(/[A-Za-z0-9]/g, 'a');
      if (flattened !== value) out.push(flattened);

      for (let i = 0; i < value.length; i++) {
        if (/[A-Za-z0-9]/.test(value[i]!) && value[i] !== 'a') {
          out.push(`${value.slice(0, i)}a${value.slice(i + 1)}`);
        }
      }
    }
    return out;
  }

  if (typeof value === 'number') {
    if (value === 0) return [];
    const out: unknown[] = [0];
    if (!Number.isInteger(value)) out.push(Math.trunc(value));
    if (Math.abs(value) > 1) {
      out.push(Math.trunc(value / 2));
      out.push(value > 0 ? value - 1 : value + 1);
    }
    if (value < 0) out.push(-value);
    return out;
  }

  if (typeof value === 'boolean') return value ? [false] : [];
  return [];
}

/**
 * Greedily shrink a witness while the readers still disagree on it.
 *
 * Each field is shrunk in turn and the pass repeats until nothing improves, so
 * reductions that only become possible after another field shrinks are still
 * found.
 */
export function minimiseWitness(
  program: Program,
  probe: Probe,
  sources: { source: string }[],
  timeoutMs: number,
  maxSteps = 400,
): Minimised {
  const candidates = sources
    .map((s) => {
      try {
        return loadCandidate(s.source);
      } catch {
        return null;
      }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length < 2) {
    return { input: probe.input, steps: 0, smaller: false, outcomes: [] };
  }

  const run: Runner = (input) => candidates.map((c) => c.run(input, timeoutMs));

  let current = { ...probe.input };
  let steps = 0;
  let improved = true;

  while (improved && steps < maxSteps) {
    improved = false;
    for (const field of program.interface.inputs) {
      for (const shrunk of shrinkValue(current[field.name], field.type)) {
        if (steps >= maxSteps) break;
        steps++;
        const attempt = { ...current, [field.name]: shrunk };
        if (stillSplits(run(attempt))) {
          current = attempt;
          improved = true;
          break;
        }
      }
    }
  }

  const smaller = JSON.stringify(current) !== JSON.stringify(probe.input);
  return { input: current, steps, smaller, outcomes: run(current) };
}
