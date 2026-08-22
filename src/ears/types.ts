/**
 * Core domain model for Keel.
 *
 * A spec is a contract. Every acceptance criterion in that contract is a claim
 * about the system's behaviour, written in EARS (Easy Approach to Requirements
 * Syntax). Keel's job is to decide, for each claim, whether it is still true.
 */

/** The five canonical EARS patterns, plus the compound form. */
export type EarsPattern =
  | 'ubiquitous'   // THE SYSTEM SHALL <response>
  | 'event'        // WHEN <trigger> THEN THE SYSTEM SHALL <response>
  | 'state'        // WHILE <state> THE SYSTEM SHALL <response>
  | 'unwanted'     // IF <condition> THEN THE SYSTEM SHALL <response>
  | 'optional'     // WHERE <feature> THE SYSTEM SHALL <response>
  | 'complex'      // WHILE <state> WHEN <trigger> THEN THE SYSTEM SHALL <response>
  | 'malformed';   // present in the doc, but not valid EARS

/** The clause decomposition of a single criterion. */
export interface EarsClauses {
  /** WHEN … — the triggering event. */
  trigger?: string;
  /** IF … — the guard condition (typically an unwanted/edge case). */
  condition?: string;
  /** WHILE … — the sustained state during which the behaviour holds. */
  state?: string;
  /** WHERE … — the feature/context in which the behaviour applies. */
  context?: string;
  /** The subject bound by SHALL. Defaults to "the system". */
  subject: string;
  /** The obligation itself — everything after SHALL. */
  response: string;
  /** True for `SHALL NOT` — a prohibition rather than an obligation. */
  negated: boolean;
}

/** A single acceptance criterion: one testable claim. */
export interface Criterion {
  /** Stable dotted identity, e.g. "3.2" — requirement 3, criterion 2. */
  id: string;
  /** Fully-qualified across specs, e.g. "spec-conformance-engine/3.2". */
  qualifiedId: string;
  /** Owning requirement number. */
  requirement: number;
  /** Ordinal within the requirement. */
  ordinal: number;
  /** Raw source line, verbatim. */
  raw: string;
  pattern: EarsPattern;
  clauses: EarsClauses;
  /** 1-indexed line number in requirements.md, for editor jump-to. */
  line: number;
  /** Why the line failed to parse, when pattern is 'malformed'. */
  diagnostic?: string;
}

/** A user story and its acceptance criteria. */
export interface Requirement {
  number: number;
  title: string;
  userStory?: { role: string; want: string; benefit: string };
  criteria: Criterion[];
  line: number;
}

/** One parsed `.kiro/specs/<name>/requirements.md`. */
export interface Spec {
  /** Directory name under .kiro/specs/ — the spec's identity. */
  name: string;
  path: string;
  introduction?: string;
  requirements: Requirement[];
}

export function criterionCount(spec: Spec): number {
  return spec.requirements.reduce((n, r) => n + r.criteria.length, 0);
}
