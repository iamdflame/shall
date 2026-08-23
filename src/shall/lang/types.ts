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

/** One field of a record. Optional fields may be absent from a value. */
export interface RecordField {
  name: string;
  type: ShallType;
  optional: boolean;
}

/**
 * Types nest. A specification about an order cannot be written with scalars
 * alone, and a language that can only describe flat inputs is not describing
 * the specifications people actually write.
 */
export type ShallType =
  | ScalarType
  | { list: ShallType }
  | { record: RecordField[] };

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

export function isListType(t: ShallType): t is { list: ShallType } {
  return typeof t === 'object' && 'list' in t;
}

export function isRecordType(t: ShallType): t is { record: RecordField[] } {
  return typeof t === 'object' && 'record' in t;
}

export function isScalarType(t: ShallType): t is ScalarType {
  return typeof t === 'string';
}

/** Render a type the way it is written in source, so errors quote it back. */
export function typeName(t: ShallType): string {
  if (isListType(t)) return `list<${typeName(t.list)}>`;
  if (isRecordType(t)) {
    return `{ ${t.record.map((f) => `${f.name}${f.optional ? '?' : ''}: ${typeName(f.type)}`).join(', ')} }`;
  }
  return t;
}

/** Every scalar type reachable inside a type, for probe-pool selection. */
export function scalarsWithin(t: ShallType): ScalarType[] {
  if (isScalarType(t)) return [t];
  if (isListType(t)) return scalarsWithin(t.list);
  return t.record.flatMap((f) => scalarsWithin(f.type));
}

/** Every criterion across every requirement, in declaration order. */
export function programCriteria(p: Program): Criterion[] {
  return p.requirements.flatMap((r) => r.criteria);
}
