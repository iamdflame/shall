import type { Criterion } from '../../ears/types.js';
import type { Program, ShallType, Field } from '../lang/types.js';
import { isListType, isRecordType, isScalarType } from '../lang/types.js';
import type { Probe } from '../oracle/probes.js';
import { programCriteria } from '../lang/types.js';
import { typePaths } from './coverage.js';
import { measureCoverage, referencedFields, referencedPaths, guardNumbers } from './coverage.js';

/**
 * Coverage-guided probe generation.
 *
 * Structural probes are built from the interface: they know the shape of the
 * inputs and nothing about what the clauses say. That is the right default, and
 * it is also why they miss things. "SHALL ignore words shorter than three
 * letters" is a statement about a boundary at three, and a probe set drawn from
 * a generic string pool may never place a word on either side of it.
 *
 * Coverage says which clauses were missed. This closes the loop: read the
 * clauses nothing reached, take the boundary each one states, and synthesise
 * the input that sits on it. Coverage-guided fuzzing does the same thing with
 * branch counters; here the counter is a requirement.
 *
 * The targeted probes are added to the run rather than replacing anything, so
 * they also participate in finding disagreement — and a boundary case is where
 * two readers are most likely to differ, which is the entire point.
 */

/** A probe built to engage one specific clause, with the reason recorded. */
export interface TargetedProbe extends Probe {
  /** The criterion this probe was synthesised to reach. */
  targets: string;
}

const MAX_PER_CRITERION = 8;

/** One boundary a clause states, and whether the probe set straddles it. */
export interface Boundary {
  criterion: Criterion;
  /** The position whose magnitude the boundary applies to, e.g. "parcel.lengthCm". */
  field: string;
  /** The stated value, e.g. 3 in "shorter than three letters". */
  at: number;
  below: boolean;
  on: boolean;
  above: boolean;
}

// @shall specification-coverage/4.3
export function isStraddled(b: Boundary): boolean {
  return b.below && b.on && b.above;
}

/**
 * Every boundary the specification states, checked against the probe set.
 *
 * Clause coverage asks whether a rule was ever exercised. This asks the sharper
 * question: was it exercised *where it changes*. "IF three or more dice show the
 * same face" can be engaged by ninety probes and still never be tested, if none
 * of them held exactly two matching dice and none held exactly three. Every
 * off-by-one an English specification can hide lives at that edge, and so does
 * most of the disagreement between readers.
 */
export function boundaries(program: Program, probes: Probe[]): Boundary[] {
  const out: Boundary[] = [];

  for (const criterion of programCriteria(program).filter((c) => c.pattern !== 'malformed')) {
    const bounds = guardNumbers(criterion);
    if (bounds.length === 0) continue;

    for (const target of referencedPaths(criterion, program)) {
      // A boundary is a statement about magnitude, so a type without one - a
      // bare boolean, a record carrying two numbers and no way to know which
      // the clause meant - has nothing to straddle and is not reported as a gap.
      if (magnitudeOf(neutral(target.type), target.type) === undefined) continue;

      const seen = probes
        .map((p) => magnitudeOf(readPath(p.input, target.path), target.type))
        .filter((m): m is number => m !== undefined);

      for (const at of bounds) {
        out.push({
          criterion,
          field: target.path,
          at,
          below: seen.some((m) => m < at),
          on: seen.some((m) => m === at),
          above: seen.some((m) => m > at),
        });
      }
    }
  }

  return out;
}

/**
 * The magnitude a boundary compares against.
 *
 * A number is its own magnitude; a string and a list are measured by length; a
 * record by the single numeric field it carries, when it carries exactly one,
 * because "IF the order is below 50" is about the amount and not the record.
 */
// @shall specification-coverage/4.4
// @shall specification-coverage/4.5
export function magnitudeOf(value: unknown, type: ShallType): number | undefined {
  if (isScalarType(type)) {
    if (type === 'integer' || type === 'number') {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
    if (type === 'string') return typeof value === 'string' ? value.length : undefined;
    return undefined;
  }
  if (isListType(type)) return Array.isArray(value) ? value.length : undefined;
  if (isRecordType(type)) {
    const numeric = type.record.filter(
      (f) => isScalarType(f.type) && (f.type === 'integer' || f.type === 'number'),
    );
    if (numeric.length !== 1 || !value || typeof value !== 'object') return undefined;
    return magnitudeOf((value as Record<string, unknown>)[numeric[0]!.name], numeric[0]!.type);
  }
  return undefined;
}

// @shall specification-coverage/5.1
// @shall specification-coverage/5.2
// @shall specification-coverage/5.3
// @shall specification-coverage/5.4
// @shall specification-coverage/5.6
// @shall specification-coverage/5.7
export function targetedProbes(
  program: Program,
  probes: Probe[],
  budget: number,
): TargetedProbe[] {
  if (budget <= 0) return [];

  const wanted: { criterion: Criterion; path: string; at: number; sides: number[] }[] = [];

  // Boundaries the probe set does not straddle: the sharpest gaps, so first.
  for (const b of boundaries(program, probes)) {
    const sides: number[] = [];
    if (!b.below) sides.push(b.at - 1);
    if (!b.on) sides.push(b.at);
    if (!b.above) sides.push(b.at + 1);
    if (sides.length > 0) wanted.push({ criterion: b.criterion, path: b.field, at: b.at, sides });
  }

  // Then clauses nothing engaged at all, which have no boundary to aim at and
  // are reached by making the positions they name non-default.
  for (const row of measureCoverage(program, probes).unexercised) {
    const paths = referencedPaths(row.criterion, program);
    for (const target of paths.length > 0
      ? paths
      : referencedFields(row.criterion, program).map((f) => ({ path: f }))) {
      wanted.push({ criterion: row.criterion, path: target.path, at: 1, sides: [1, 2] });
    }
  }

  const baseline = neutralInput(program);
  const seen = new Set(probes.map((p) => JSON.stringify(p.input)));
  const out: TargetedProbe[] = [];
  const perCriterion = new Map<string, number>();

  const positions = new Map(
    program.interface.inputs.flatMap((f) => typePaths(f.type, f.name).map((t) => [t.path, t.type] as const)),
  );
  for (const f of program.interface.inputs) positions.set(f.name, f.type);

  for (const want of wanted) {
    if (out.length >= budget) break;
    const type = positions.get(want.path);
    if (!type) continue;

    for (const size of want.sides) {
      if (out.length >= budget) break;
      const used = perCriterion.get(want.criterion.id) ?? 0;
      if (used >= MAX_PER_CRITERION) break;

      const value = atMagnitude(type, size);
      if (value === undefined) continue;

      // Vary only the position the boundary is about. Changing anything else
      // risks engaging a different clause and crediting this one for it.
      const input = writePath(baseline, want.path, value);
      if (input === undefined) continue;
      const key = JSON.stringify(input);
      if (seen.has(key)) continue;
      seen.add(key);
      perCriterion.set(want.criterion.id, used + 1);

      out.push({
        id: `t${out.length + 1}`,
        input,
        origin: 'structural',
        rationale: `criterion ${want.criterion.id} turns at ${want.at} on ${want.path}; this sits at ${size}`,
        targets: want.criterion.id,
      });
    }
  }

  return out;
}

/**
 * A value of this type whose "size" is n.
 *
 * Size means the obvious thing for each type: the number itself, the length of
 * a string or list, and for records the field that carries the magnitude. A
 * clause saying "shorter than three letters" is about length; one saying "at
 * least three dice" is about count. The same boundary, read through the type.
 */
function atMagnitude(type: ShallType, n: number): unknown {
  if (isScalarType(type)) {
    switch (type) {
      case 'integer': return Math.trunc(n);
      case 'number': return n;
      case 'boolean': return n > 0;
      case 'string': {
        if (n < 0) return undefined;
        if (n === 0) return '';
        // A single word of exactly this length, surrounded by words that are
        // clearly on the other side of any length rule.
        return `${'a'.repeat(n)} zzzzzzzz`;
      }
    }
  }
  if (isListType(type)) {
    if (n < 0) return undefined;
    // Identical elements: a rule about "the same face" needs them to match, and
    // a rule about count does not care either way.
    return Array.from({ length: Math.min(n, 24) }, () => atMagnitude(type.list, 1) ?? 1);
  }
  if (isRecordType(type)) {
    const record: Record<string, unknown> = {};
    for (const f of type.record) {
      const v = atMagnitude(f.type, n);
      if (v !== undefined) record[f.name] = v;
      else if (!f.optional) record[f.name] = atMagnitude(f.type, 0);
    }
    return record;
  }
  return undefined;
}

/* ── addressing a position inside an input ─────────────────────────────── */

/** Read the value at a dotted path, or undefined if the path is not present. */
function readPath(input: Record<string, unknown>, path: string): unknown {
  // A list segment has no single value to read; the list itself is the value
  // a length boundary compares against, so the walk stops there.
  const [head, ...rest] = path.split('.');
  let value: unknown = input[head!];
  for (const segment of rest) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** A copy of the input with one position replaced, creating records as needed. */
function writePath(
  input: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const segments = path.split('.');
  if (segments.some((s) => s.endsWith('[]'))) return undefined;  // no index to write to

  const root = structuredClone(input);
  let cursor: Record<string, unknown> = root;

  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]!] = value;
  return root;
}

/** The least interesting value of each input: the background a probe varies from. */
function neutralInput(program: Program): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of program.interface.inputs) input[field.name] = neutral(field.type);
  return input;
}

function neutral(type: ShallType): unknown {
  if (isScalarType(type)) {
    switch (type) {
      case 'integer': case 'number': return 0;
      case 'string': return '';
      case 'boolean': return false;
    }
  }
  if (isListType(type)) return [];
  if (isRecordType(type)) {
    const record: Record<string, unknown> = {};
    for (const f of type.record) if (!f.optional) record[f.name] = neutral(f.type);
    return record;
  }
  return null;
}
