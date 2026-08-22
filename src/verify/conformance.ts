import type { Criterion, Spec } from '../ears/types.js';
import { allCriteria } from '../ears/spec-reader.js';
import type { Binding } from '../binding/scanner.js';
import type { TestResult } from './runner.js';
import { hashText, type Lockfile, type LockedCriterion } from '../lock/lockfile.js';

/**
 * The conformance join.
 *
 * Four inputs — parsed criteria, static bindings, runtime test results, and the
 * previous lockfile — collapse into one verdict per criterion. Severity order
 * is deliberate: a criterion the tests actively disprove is worse than one
 * nobody implemented, because the former is a documented lie while the latter
 * is merely an omission.
 */

export type Status =
  | 'broken'      // a bound test fails: the system provably violates the spec
  | 'drifted'     // bound code or spec text changed since the last verification
  | 'malformed'   // not valid EARS, so not checkable at all
  | 'orphan'      // no code claims to implement it
  | 'unverified'  // implemented, but nothing proves it
  | 'conformant'; // proven by a passing test, unchanged since

export const SEVERITY: Status[] = [
  'broken', 'drifted', 'malformed', 'orphan', 'unverified', 'conformant',
];

export interface CriterionVerdict {
  criterion: Criterion;
  status: Status;
  bindings: Binding[];
  /** Test names bound to this criterion, with their outcome. */
  proofs: { name: string; passed: boolean; skipped: boolean; found: boolean }[];
  /** Human-readable explanation of why this status, not another. */
  reason: string;
  /** Populated for 'drifted': what specifically moved. */
  drift?: { kind: 'spec-changed' | 'code-changed'; detail: string };
}

/** An @shall annotation pointing at a criterion that does not exist. */
export interface DanglingBinding {
  binding: Binding;
  reason: string;
}

export interface Report {
  specs: Spec[];
  verdicts: CriterionVerdict[];
  dangling: DanglingBinding[];
  counts: Record<Status, number>;
  total: number;
  /** Share of criteria that are proven and unchanged, 0..1. */
  conformance: number;
  testsRan: boolean;
  testError?: string;
  generatedAt: string;
}

/** Resolve an annotation ref ("1.2" or "spec/1.2") to a criterion. */
function resolveRef(ref: string, byQualified: Map<string, Criterion>, byId: Map<string, Criterion[]>) {
  if (ref.includes('/')) {
    const hit = byQualified.get(ref);
    return hit ? { criterion: hit } : { error: `no criterion "${ref}" in any spec` };
  }
  const candidates = byId.get(ref) ?? [];
  if (candidates.length === 1) return { criterion: candidates[0]! };
  if (candidates.length === 0) return { error: `no criterion "${ref}" in any spec` };
  return {
    error: `"${ref}" is ambiguous across ${candidates.length} specs (${candidates
      .map((c) => c.qualifiedId)
      .join(', ')}) — qualify it`,
  };
}

export interface BuildReportInput {
  specs: Spec[];
  bindings: Binding[];
  testResults: TestResult[];
  lock: Lockfile | null;
  testsRan: boolean;
  testError?: string;
}

export function buildReport(input: BuildReportInput): Report {
  const { specs, bindings, testResults, lock, testsRan, testError } = input;
  const criteria = allCriteria(specs);

  const byQualified = new Map(criteria.map((c) => [c.qualifiedId, c]));
  const byId = new Map<string, Criterion[]>();
  for (const c of criteria) {
    const list = byId.get(c.id) ?? [];
    list.push(c);
    byId.set(c.id, list);
  }

  const bound = new Map<string, Binding[]>();
  const dangling: DanglingBinding[] = [];

  for (const binding of bindings) {
    const resolved = resolveRef(binding.ref, byQualified, byId);
    if ('error' in resolved) {
      dangling.push({ binding, reason: resolved.error! });
      continue;
    }
    const key = resolved.criterion.qualifiedId;
    const list = bound.get(key) ?? [];
    list.push(binding);
    bound.set(key, list);
  }

  const testsByName = new Map<string, TestResult>();
  for (const r of testResults) if (!testsByName.has(r.name)) testsByName.set(r.name, r);

  const verdicts = criteria.map((criterion) =>
    judge(criterion, bound.get(criterion.qualifiedId) ?? [], testsByName, lock, testsRan),
  );

  const counts = Object.fromEntries(SEVERITY.map((s) => [s, 0])) as Record<Status, number>;
  for (const v of verdicts) counts[v.status]++;

  return {
    specs,
    verdicts,
    dangling,
    counts,
    total: verdicts.length,
    conformance: verdicts.length ? counts.conformant / verdicts.length : 0,
    testsRan,
    ...(testError ? { testError } : {}),
    generatedAt: new Date().toISOString(),
  };
}

function judge(
  criterion: Criterion,
  bindings: Binding[],
  testsByName: Map<string, TestResult>,
  lock: Lockfile | null,
  testsRan: boolean,
): CriterionVerdict {
  const proofs = bindings
    .filter((b) => b.kind === 'proof' && b.testName)
    .map((b) => {
      const result = testsByName.get(b.testName!);
      return {
        name: b.testName!,
        passed: result?.passed ?? false,
        skipped: result?.skipped ?? false,
        found: Boolean(result),
      };
    });

  const base = { criterion, bindings, proofs };

  if (criterion.pattern === 'malformed') {
    return {
      ...base,
      status: 'malformed',
      reason: criterion.diagnostic ?? 'not valid EARS, so nothing can be verified',
    };
  }

  if (bindings.length === 0) {
    return {
      ...base,
      status: 'orphan',
      reason: 'no code or test claims this criterion — it was specified and never built',
    };
  }

  // A failing bound test is the strongest possible signal: the spec is a lie.
  const failing = proofs.filter((p) => p.found && !p.passed && !p.skipped);
  if (failing.length > 0) {
    return {
      ...base,
      status: 'broken',
      reason: `the test bound to this criterion fails (${failing[0]!.name}) — the system does not do what the spec says it SHALL`,
    };
  }

  const drift = detectDrift(criterion, bindings, lock);
  if (drift) {
    return { ...base, status: 'drifted', reason: drift.detail, drift };
  }

  const passing = proofs.filter((p) => p.found && p.passed && !p.skipped);
  if (passing.length > 0) {
    return {
      ...base,
      status: 'conformant',
      reason: `proven by ${passing.length} passing test${passing.length > 1 ? 's' : ''}`,
    };
  }

  if (proofs.length > 0) {
    const skipped = proofs.filter((p) => p.skipped);
    if (skipped.length > 0) {
      return { ...base, status: 'unverified', reason: 'the only test bound to this criterion is skipped' };
    }
    return {
      ...base,
      status: 'unverified',
      reason: testsRan
        ? 'a test claims to prove this criterion, but no test of that name ran'
        : 'the test suite did not run, so no proof was collected',
    };
  }

  return {
    ...base,
    status: 'unverified',
    reason: `implemented in ${bindings.length} place${bindings.length > 1 ? 's' : ''}, but no test proves it`,
  };
}

function detectDrift(
  criterion: Criterion,
  bindings: Binding[],
  lock: Lockfile | null,
): { kind: 'spec-changed' | 'code-changed'; detail: string } | undefined {
  if (!lock) return undefined;
  const locked: LockedCriterion | undefined = lock.criteria[criterion.qualifiedId];
  if (!locked) return undefined;

  if (locked.text !== hashText(criterion.raw)) {
    return {
      kind: 'spec-changed',
      detail: 'the criterion text was edited since it was last verified — its bindings may no longer mean what they did',
    };
  }

  for (const binding of bindings) {
    const key = `${binding.file}:${binding.line}`;
    const previous = locked.anchors[key];
    if (previous && previous !== binding.anchorHash) {
      return {
        kind: 'code-changed',
        detail: `${binding.file}:${binding.line} changed since this criterion was last verified, but the criterion did not — the implementation moved out from under the spec`,
      };
    }
  }

  return undefined;
}

/** Snapshot the current verified state for the next run to compare against. */
export function toLock(report: Report): Lockfile {
  const criteria: Record<string, LockedCriterion> = {};
  for (const v of report.verdicts) {
    const anchors: Record<string, string> = {};
    for (const b of v.bindings) anchors[`${b.file}:${b.line}`] = b.anchorHash;
    criteria[v.criterion.qualifiedId] = {
      text: hashText(v.criterion.raw),
      anchors,
      status: v.status,
      verifiedAt: report.generatedAt,
    };
  }
  return { version: 1, generatedAt: report.generatedAt, criteria };
}
