import type { Criterion } from '../../ears/types.js';
import { loadCandidate, canonicalValue, display, type Outcome } from '../execute/sandbox.js';
import type { ExpectedCase, DisputedCase } from './expectations.js';

/**
 * Run the built program against the expectations derived from each criterion.
 *
 * This is the second half of a build. Consensus establishes that readers agreed;
 * conformance establishes that what they agreed on is what was asked for.
 */

export type CriterionStatus =
  | 'satisfied'     // every agreed expectation holds
  | 'violated'      // the built program contradicts the criterion
  | 'undetermined'  // readers could not agree what this clause requires
  | 'malformed';    // not valid EARS, so nothing can be derived

export interface Failure {
  input: Record<string, unknown>;
  expected: unknown;
  actual: Outcome;
  why: string;
}

export interface CriterionReport {
  criterion: Criterion;
  status: CriterionStatus;
  checked: number;
  passed: number;
  failures: Failure[];
  /** Inputs whose required output the readers themselves disputed. */
  disputed: DisputedCase[];
  reason: string;
}

export interface ConformanceReport {
  criteria: CriterionReport[];
  totalChecked: number;
  totalPassed: number;
  /** Share of non-malformed criteria that are satisfied, 0..1. */
  score: number;
  violations: number;
  undetermined: number;
}

export function checkConformance(
  source: string,
  criteria: Criterion[],
  agreed: ExpectedCase[],
  disputed: DisputedCase[],
  timeoutMs: number,
): ConformanceReport {
  const program = loadCandidate(source);

  const casesByCriterion = new Map<string, ExpectedCase[]>();
  for (const c of agreed) {
    const list = casesByCriterion.get(c.criterionId) ?? [];
    list.push(c);
    casesByCriterion.set(c.criterionId, list);
  }

  const disputesByCriterion = new Map<string, DisputedCase[]>();
  for (const d of disputed) {
    const list = disputesByCriterion.get(d.criterionId) ?? [];
    list.push(d);
    disputesByCriterion.set(d.criterionId, list);
  }

  const reports: CriterionReport[] = criteria.map((criterion) => {
    const disputes = disputesByCriterion.get(criterion.id) ?? [];

    if (criterion.pattern === 'malformed') {
      return {
        criterion, status: 'malformed', checked: 0, passed: 0, failures: [], disputed: disputes,
        reason: criterion.diagnostic ?? 'not valid EARS',
      };
    }

    const cases = casesByCriterion.get(criterion.id) ?? [];
    // @shall shall-language/5.4
    if (cases.length === 0) {
      return {
        criterion, status: 'undetermined', checked: 0, passed: 0, failures: [], disputed: disputes,
        reason: disputes.length
          ? `readers proposed ${disputes.length} case(s) but could not agree what this clause requires`
          : 'no reader could state a case this clause alone determines',
      };
    }

    const failures: Failure[] = [];
    let passed = 0;

    for (const testCase of cases) {
      const outcome = program.run(testCase.input, timeoutMs);
      const actual = outcome.ok ? canonicalValue(outcome.value) : '!error';
      const wanted = canonicalValue(testCase.expected);

      if (actual === wanted) passed++;
      else failures.push({ input: testCase.input, expected: testCase.expected, actual: outcome, why: testCase.why });
    }

    return {
      criterion,
      status: failures.length > 0 ? 'violated' : 'satisfied',
      checked: cases.length,
      passed,
      failures,
      disputed: disputes,
      reason:
        failures.length > 0
          ? `${failures.length} of ${cases.length} derived case(s) contradict the built program`
          : `${passed} derived case(s) hold`,
    };
  });

  const checkable = reports.filter((r) => r.status !== 'malformed');
  const satisfied = reports.filter((r) => r.status === 'satisfied').length;

  return {
    criteria: reports,
    totalChecked: reports.reduce((n, r) => n + r.checked, 0),
    totalPassed: reports.reduce((n, r) => n + r.passed, 0),
    score: checkable.length ? satisfied / checkable.length : 0,
    violations: reports.filter((r) => r.status === 'violated').length,
    undetermined: reports.filter((r) => r.status === 'undetermined').length,
  };
}

/** A build is rejected when the program contradicts a clause it claims to implement. */
// @shall shall-language/5.3
export function conformanceBlocks(report: ConformanceReport): boolean {
  return report.violations > 0;
}

export { display };
