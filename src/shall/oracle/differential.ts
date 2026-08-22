import { loadCandidate, canonical, display, agreement, LoadError, type Outcome } from '../execute/sandbox.js';
import type { Probe } from './probes.js';

/**
 * Differential execution - the oracle at the centre of SHALL.
 *
 * Candidates are never compared as source code. Two correct implementations of
 * the same requirement routinely share no lines at all, and two implementations
 * that differ by one operator can behave identically on every input that matters.
 * What is compared is behaviour: each candidate is run against every probe, and
 * its results concatenate into a *behaviour vector*.
 *
 * Candidates with identical vectors are the same program as far as the
 * specification can tell. If every candidate lands in one group, the English
 * determined the behaviour. If they split, the English did not - and the probes
 * where they split are precisely the evidence of what it failed to say.
 */

export interface CandidateResult {
  modelId: string;
  label: string;
  source: string;
  /** Present when the candidate could not be loaded; it is then excluded. */
  loadError?: string;
  outcomes: Outcome[];
  behaviour: string;
}

export interface BehaviourGroup {
  behaviour: string;
  members: CandidateResult[];
}

export interface Divergence {
  probe: Probe;
  /** Distinct observed behaviours on this probe, largest cohort first. */
  readings: { canonical: string; display: string; members: string[] }[];
  /**
   * `numeric` when every reading is the same number to within a few ULPs.
   *
   * These are arithmetic artefacts, not disagreements about the English, and
   * they are reported separately so that an author is never sent to edit a
   * clause that is already correct.
   */
  kind: 'behaviour' | 'numeric';
  /**
   * The smallest input that still splits the readers, when one was found.
   *
   * A compiler error points at the smallest thing that reproduces the problem.
   * "a-b" proves a hyphen is undefined and leaves nothing else to blame.
   */
  minimalInput?: Record<string, unknown>;
  /** Readings measured AT `minimalInput`, never carried over from the probe. */
  minimalReadings?: { canonical: string; display: string; members: string[] }[];
}

export interface OracleResult {
  probes: Probe[];
  candidates: CandidateResult[];
  loadable: CandidateResult[];
  groups: BehaviourGroup[];
  divergences: Divergence[];
  /** The largest behaviour group, or null when nothing loaded. */
  consensus: BehaviourGroup | null;
  /** True when every loadable candidate agreed on every probe. */
  unanimous: boolean;
  /** Divergences that are genuine disagreements about the specification. */
  behaviourDivergences: Divergence[];
  /** Divergences explained entirely by floating-point arithmetic. */
  numericDivergences: Divergence[];
}

export interface RunOptions {
  probes: Probe[];
  executionTimeoutMs: number;
}

// @shall 3.1
export function runDifferential(
  sources: { modelId: string; label: string; source: string }[],
  options: RunOptions,
): OracleResult {
  const { probes, executionTimeoutMs } = options;

  const candidates: CandidateResult[] = sources.map((s) => {
    try {
      const loaded = loadCandidate(s.source);
      const outcomes = probes.map((p) => loaded.run(p.input, executionTimeoutMs));
      return {
        ...s,
        outcomes,
        behaviour: outcomes.map(canonical).join(' '),
      };
    } catch (err) {
      const message =
        err instanceof LoadError ? err.message : `unexpected load failure: ${(err as Error).message}`;
      return { ...s, loadError: message, outcomes: [], behaviour: '' };
    }
  });

  const loadable = candidates.filter((c) => !c.loadError);

  const byBehaviour = new Map<string, CandidateResult[]>();
  for (const c of loadable) {
    const list = byBehaviour.get(c.behaviour) ?? [];
    list.push(c);
    byBehaviour.set(c.behaviour, list);
  }

  const groups: BehaviourGroup[] = [...byBehaviour.entries()]
    .map(([behaviour, members]) => ({ behaviour, members }))
    .sort((a, b) => b.members.length - a.members.length);

  const divergences: Divergence[] = [];
  for (let i = 0; i < probes.length; i++) {
    const byReading = new Map<string, { display: string; members: string[] }>();
    for (const c of loadable) {
      const outcome = c.outcomes[i]!;
      const key = canonical(outcome);
      const entry = byReading.get(key) ?? { display: display(outcome), members: [] };
      entry.members.push(c.label);
      byReading.set(key, entry);
    }
    if (byReading.size <= 1) continue;

    // If every pair of outcomes here is numerically equivalent, the readers
    // agree about the behaviour and differ only in arithmetic.
    const outcomes = loadable.map((c) => c.outcomes[i]!);
    let numeric = outcomes.length > 1;
    for (let x = 0; x < outcomes.length && numeric; x++) {
      for (let y = x + 1; y < outcomes.length; y++) {
        if (agreement(outcomes[x]!, outcomes[y]!) === 'divergent') {
          numeric = false;
          break;
        }
      }
    }

    divergences.push({
      probe: probes[i]!,
      readings: [...byReading.entries()]
        .map(([canonicalForm, v]) => ({ canonical: canonicalForm, ...v }))
        .sort((a, b) => b.members.length - a.members.length),
      kind: numeric ? 'numeric' : 'behaviour',
    });
  }

  const behaviourDivergences = divergences.filter((d) => d.kind === 'behaviour');
  const numericDivergences = divergences.filter((d) => d.kind === 'numeric');

  return {
    probes,
    candidates,
    loadable,
    groups,
    divergences,
    consensus: groups[0] ?? null,
    unanimous: groups.length === 1,
    behaviourDivergences,
    numericDivergences,
  };
}

/**
 * Whether a build may be emitted.
 *
 * Unanimity is the normal bar. A split ensemble is a compile error even when a
 * clear plurality exists, because the plurality is not evidence about the
 * specification - it is evidence about which reading is more popular, which is
 * exactly the thing a specification is supposed to settle.
 */
// @shall 3.2
// @shall 3.3
// @shall 3.4
// @shall 3.5
export function buildVerdict(
  result: OracleResult,
  quorum: number,
): { ok: true; group: BehaviourGroup } | { ok: false; reason: string } {
  if (result.loadable.length === 0) {
    return { ok: false, reason: 'no candidate compiled to loadable code' };
  }
  if (result.loadable.length < quorum) {
    return {
      ok: false,
      reason: `only ${result.loadable.length} candidate(s) loaded; quorum is ${quorum} - ambiguity cannot be ruled out`,
    };
  }
  if (result.behaviourDivergences.length > 0) {
    return {
      ok: false,
      reason: `the ensemble split into ${result.groups.length} distinct behaviours across ${result.behaviourDivergences.length} probe(s)`,
    };
  }
  // Only arithmetic separates the readers. That is a warning about the spec's
  // silence on rounding, not evidence that the English is ambiguous.
  return { ok: true, group: result.consensus! };
}
