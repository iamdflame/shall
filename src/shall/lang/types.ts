import type { Criterion } from '../../ears/types.js';

/**
 * The SHALL language.
 *
 * A `.shall` file is a program. Its source is English requirements written in
 * EARS. There is exactly one formal construct in the language — the interface —
 * because the compiler needs a signature it can generate inputs for and compare
 * outputs across. Everything else is prose, and prose is where ambiguity lives.
 *
 *     program FizzBuzz
 *
 *     interface
 *       input  n: integer
 *       output text: string
 *
 *     Requirement 1: Divisibility
 *       WHEN n is divisible by 3 and by 5 THEN the system SHALL return "FizzBuzz"
 *       IF n is divisible by neither THEN the system SHALL return n as a decimal string
 */

export type ScalarType = 'integer' | 'number' | 'string' | 'boolean';
export type ShallType = ScalarType | { list: ScalarType };

export interface Field {
  name: string;
  type: ShallType;
  /** 1-indexed line in the .shall source. */
  line: number;
}

export interface Interface {
  inputs: Field[];
  outputs: Field[];
}

export interface ShallRequirement {
  number: number;
  title: string;
  criteria: Criterion[];
  line: number;
}

export interface Program {
  name: string;
  /** Free prose beneath the program declaration. Context, not obligation. */
  description?: string;
  interface: Interface;
  requirements: ShallRequirement[];
  path: string;
  source: string;
}

export interface ParseDiagnostic {
  line: number;
  message: string;
  /** Fatal diagnostics prevent compilation; others are reported and tolerated. */
  fatal: boolean;
}

export interface ParsedProgram {
  program: Program | null;
  diagnostics: ParseDiagnostic[];
}

export function isListType(t: ShallType): t is { list: ScalarType } {
  return typeof t === 'object' && 'list' in t;
}

export function typeName(t: ShallType): string {
  return isListType(t) ? `list<${t.list}>` : t;
}

/** Every criterion across every requirement, in declaration order. */
export function programCriteria(p: Program): Criterion[] {
  return p.requirements.flatMap((r) => r.criteria);
}
