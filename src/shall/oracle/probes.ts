import type { Field, Program, RecordField, ScalarType, ShallType } from '../lang/types.js';
import { isListType, isRecordType, scalarsWithin } from '../lang/types.js';

/**
 * Probe generation.
 *
 * A probe is one input the whole ensemble is run against. Probes come from two
 * sources, and the split matters:
 *
 *  - *Structural* probes are derived from the type signature alone. They are
 *    deterministic, free, need no model, and concentrate on the values where
 *    specifications are habitually silent — zero, negative, empty, and the
 *    decimal midpoints where rounding rules diverge.
 *  - *Generated* probes come from a model reading the spec adversarially, and
 *    find the domain-specific edges structure cannot know about.
 *
 * The structural set alone is enough to detect most real ambiguity, which is why
 * `shall check --offline` is useful without an API key at all.
 */

export interface Probe {
  id: string;
  input: Record<string, unknown>;
  origin: 'structural' | 'generated';
  /** Why this input is interesting. Shown in the divergence report. */
  rationale?: string;
}

/** Values chosen because specifications routinely fail to determine them. */
const INTERESTING: Record<ScalarType, unknown[]> = {
  integer: [0, 1, -1, 2, 7, 100, -100, 101, 1000],
  // 1.005 / 2.675 are the classic binary-floating-point rounding traps.
  number: [0, 1, -1, 0.5, 1.005, 2.675, 19.99, -0.5, 100.5, 33.333],
  // String conventions are where independent readers most often differ:
  // hyphenation, apostrophes, digits-as-words, repeated and exotic whitespace,
  // and punctuation attached to a token are all decided by convention rather
  // than by any specification that does not mention them explicitly.
  string: [
    '', 'a', 'ab', 'abc', 'Hello world', '  padded  ', 'MiXeD CaSe',
    'well-known state-of-the-art', "it's don't o'clock", 'a1 22 333 4444',
    'one,two;three', 'end.', 'multiple   spaces   here', 'tab\tseparated',
    'new\nline', 'ß Ünïcode naïve', 'a-b', 'x', 'the cat sat on the mat',
    '...', '- - -', 'CAFE\u0301 combining', 'emoji \u{1F600} here',
  ],
  boolean: [true, false],
};

/**
 * Interesting values for a type.
 *
 * Recursive, because types are. A record contributes a baseline value plus one
 * variant per field, and an optional field additionally contributes a value
 * with that field absent — a specification that never says what happens when a
 * field is missing is exactly the kind that readers resolve differently.
 */
function valuesFor(
  type: ShallType,
  extraNumbers: number[] = [],
  sweep: { real: number[]; int: number[] } = { real: [], int: [] },
): unknown[] {
  if (isRecordType(type)) return recordValues(type.record, extraNumbers, sweep);
  if (isListType(type)) return listValues(valuesFor(type.list, extraNumbers, sweep), extraNumbers);

  const base = INTERESTING[type];
  if (type === 'integer') {
    return dedupe([...base, ...extraNumbers.filter(Number.isInteger), ...sweep.int]);
  }
  if (type === 'number') {
    return dedupe([...base, ...extraNumbers, ...sweep.real]);
  }
  return base;
}

/**
 * Record values: a baseline, then one variant per field, then each optional
 * field dropped. Not the cartesian product — that explodes with field count,
 * and the interaction walk over the whole input already covers combinations.
 */
function recordValues(
  fields: RecordField[],
  extraNumbers: number[],
  sweep: { real: number[]; int: number[] },
): unknown[] {
  const pools = fields.map((f) => valuesFor(f.type, extraNumbers, sweep));

  const baseline: Record<string, unknown> = {};
  fields.forEach((f, i) => { baseline[f.name] = pools[i]![0]; });

  const out: unknown[] = [baseline];

  fields.forEach((f, i) => {
    for (const value of pools[i]!.slice(1, 6)) {
      out.push({ ...baseline, [f.name]: value });
    }
    if (f.optional) {
      const without = { ...baseline };
      delete without[f.name];
      out.push(without);
    }
  });

  return dedupe(out.map((v) => JSON.stringify(v))).map((v) => JSON.parse(v as string));
}

/**
 * Interesting lists.
 *
 * Rules about collections almost always turn on repetition and length — "three
 * or more dice show the same face", "if several players share a score" — and a
 * list of distinct ascending values exercises neither. Lengths come from the
 * specification's own literals where possible, since a rule saying "three or
 * more" is only interesting at two, three and four.
 */
/** Sort key for list elements: small positives first, zero and negatives last. */
function rank(v: unknown): number {
  if (typeof v === 'number') {
    if (v > 0 && Number.isInteger(v) && v <= 12) return v;      // 1..12 first
    if (v > 0) return 100 + v;
    if (v === 0) return 900;
    return 1000 - v;
  }
  if (typeof v === 'string') return v.length === 0 ? 900 : 50;
  return 500;
}

function listValues(inner: unknown[], literals: number[]): unknown[] {
  // Lead with a small positive element rather than the scalar pool's default.
  // Collections are usually counts, faces or scores, and a list of zeros is
  // degenerate for almost every rule about them — "three dice show the same
  // face" is barely exercised by [0,0,0], and the witness that results reads
  // as a curiosity rather than as the rule being tested.
  const ordered = [...inner].sort((a, b) => rank(a) - rank(b));
  const out: unknown[] = [[], [ordered[0]]];
  const first = ordered[0];
  const second = ordered[1] ?? ordered[0];
  const third = ordered[2] ?? ordered[0];

  const lengths = new Set<number>([2, 3, 5]);
  for (const n of literals) {
    if (Number.isInteger(n) && n >= 1 && n <= 12) {
      lengths.add(n);
      if (n > 1) lengths.add(n - 1);
      lengths.add(n + 1);
    }
  }

  for (const len of [...lengths].sort((a, b) => a - b).slice(0, 8)) {
    out.push(Array.from({ length: len }, () => first));
    if (len >= 3) {
      out.push([...Array.from({ length: len - 1 }, () => first), second]);
      out.push([
        ...Array.from({ length: Math.ceil(len / 2) }, () => first),
        ...Array.from({ length: Math.floor(len / 2) }, () => second),
      ]);
    }
    out.push(Array.from({ length: len }, (_, i) => inner[i % inner.length]));
    if (len >= 4) {
      out.push([first, first, second, second, ...Array.from({ length: len - 4 }, () => third)]);
    }
  }

  return dedupe(out.map((v) => JSON.stringify(v))).map((v) => JSON.parse(v as string));
}

function dedupe(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = String(v);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A stride co-prime to `total`, so repeatedly adding it visits every
 * combination exactly once before repeating. Starting near the golden-ratio
 * fraction spreads early samples across the space instead of clustering them.
 */
/**
 * Numbers the specification itself mentions, plus the values immediately either
 * side of them.
 *
 * A threshold is only interesting near where it trips. "IF the order is below
 * 50" cannot be probed by a value pool that never approaches 50, and a generic
 * pool never will - which would leave the offline oracle blind to exactly the
 * clauses most likely to be ambiguous. Mining the literals out of the English
 * makes the probe set specification-aware while staying fully deterministic.
 */
function specLiterals(program: Program): number[] {
  const text = program.requirements
    .flatMap((r) => r.criteria.map((c) => c.raw))
    .join(' ');

  const found = new Set<number>();
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value) || Math.abs(value) > 1e6) continue;
    found.add(value);
    // The boundary itself is rarely where implementations differ; the values
    // either side of it are.
    found.add(value - 1);
    found.add(value + 1);
    found.add(Number((value - 0.01).toFixed(2)));
    found.add(Number((value + 0.01).toFixed(2)));
  }
  return [...found];
}

/**
 * A dense numeric sweep, used when the probe budget is large.
 *
 * Readers disagree at *intermediate* values as often as at input boundaries -
 * two candidates that round with `toFixed` and with `Math.round` are identical
 * everywhere except at a half-cent midpoint that only some inputs produce. A
 * handful of hand-chosen edge values will never land on one.
 *
 * Probes are effectively free (a sandbox call is microseconds) while readers
 * cost money, so the oracle's search should scale on the cheap axis. This sweep
 * walks a wide range at fine granularity, deterministically.
 */
function denseSweep(count: number, integral: boolean): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    // Interleave three scales so coverage is broad and fine at once.
    const band = i % 3;
    const step = Math.floor(i / 3);
    if (integral) {
      values.push(band === 0 ? step : band === 1 ? step * 7 - 50 : step * 13);
    } else {
      const v = band === 0 ? step * 0.01 : band === 1 ? step * 0.5 + 0.005 : step * 1.005;
      values.push(Number(v.toFixed(4)));
    }
  }
  return values;
}

function coprimeStride(total: number): number {
  if (total <= 2) return 1;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let stride = Math.max(1, Math.floor(total * 0.6180339887));
  for (let i = 0; i < total; i++) {
    const candidate = stride + i;
    if (candidate < total && gcd(candidate, total) === 1) return candidate;
  }
  return 1;
}

function baseline(fields: Field[], literals: number[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const f of fields) input[f.name] = valuesFor(f.type, literals)[0];
  return input;
}

/**
 * One-at-a-time variation from a baseline, then seeded random combinations.
 *
 * A full cartesian product explodes with field count; one-at-a-time finds
 * single-field edges reliably, and the random combinations catch interactions
 * between fields that single variation misses.
 */
// @shall shall-language/6.1
export function structuralProbes(program: Program, limit: number): Probe[] {
  const fields = program.interface.inputs;
  const literals = specLiterals(program);

  // Scale the value pool with the budget, so a large --probes actually explores
  // a larger space instead of exhausting a fixed cartesian product.
  const numericFields = fields.filter((f) =>
    scalarsWithin(f.type).some((t) => t === 'number' || t === 'integer'),
  ).length;
  const sweepSize =
    numericFields > 0 && limit > 200
      ? Math.ceil(Math.pow(limit * 4, 1 / Math.max(1, numericFields)))
      : 0;
  const sweepReal = sweepSize ? denseSweep(sweepSize, false) : [];
  const sweepInt = sweepSize ? denseSweep(sweepSize, true) : [];
  const probes: Probe[] = [];
  const seen = new Set<string>();

  const push = (input: Record<string, unknown>, rationale: string) => {
    const key = JSON.stringify(input);
    if (seen.has(key)) return;
    seen.add(key);
    probes.push({
      id: `s${probes.length + 1}`,
      input,
      origin: 'structural',
      rationale,
    });
  };

  const base = baseline(fields, literals);
  push(base, 'baseline: first interesting value of every input');

  // Interaction coverage must be budgeted, not left as leftovers. With a rich
  // value pool, single-field variation alone will consume the entire budget -
  // and it can never witness an ambiguity that requires two inputs to move
  // together, which is the most common kind. Half the budget is reserved.
  const singleFieldBudget = Math.max(1, Math.floor(limit * 0.5));

  outer: for (const field of fields) {
    for (const value of valuesFor(field.type, literals, { real: sweepReal, int: sweepInt }).slice(1)) {
      if (probes.length >= singleFieldBudget) break outer;
      push({ ...base, [field.name]: value }, `${field.name} = ${JSON.stringify(value)}`);
    }
  }

  // Interaction coverage. One-at-a-time variation cannot find ambiguity that
  // only appears when two inputs combine - "a 100% coupon on a large order"
  // is exactly such a case, and it is where real specifications break. We walk
  // the cartesian product with a stride co-prime to its size, which visits
  // well-separated combinations in a fixed order rather than clustering the way
  // sampling does, and is reproducible without a PRNG.
  const options = fields.map((f) => valuesFor(f.type, literals, { real: sweepReal, int: sweepInt }));
  const total = options.reduce((n, o) => n * o.length, 1);
  const stride = coprimeStride(total);

  for (let k = 0; k < total && probes.length < limit; k++) {
    let index = (k * stride) % total;
    const input: Record<string, unknown> = {};
    for (let f = 0; f < fields.length; f++) {
      const choices = options[f]!;
      input[fields[f]!.name] = choices[index % choices.length];
      index = Math.floor(index / choices.length);
    }
    push(input, 'input interaction');
  }

  return probes;
}

/** Parse probes a model proposed, keeping only those matching the interface. */
export function parseGeneratedProbes(raw: string, program: Program, offset: number): Probe[] {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : raw).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const names = new Set(program.interface.inputs.map((f) => f.name));
  const probes: Probe[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { input?: unknown; rationale?: unknown };
    const input = record.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;

    const candidate = input as Record<string, unknown>;
    // Reject probes that do not match the declared interface exactly: a probe
    // with a missing or invented field tests nothing the program promised.
    const keys = Object.keys(candidate);
    if (keys.length !== names.size || !keys.every((k) => names.has(k))) continue;
    if (!program.interface.inputs.every((f) => matchesType(candidate[f.name], f.type))) continue;

    probes.push({
      id: `g${offset + probes.length + 1}`,
      input: candidate,
      origin: 'generated',
      ...(typeof record.rationale === 'string' ? { rationale: record.rationale } : {}),
    });
  }

  return probes;
}

/** Does a JSON value conform to a declared type? Recursive, like the types. */
function matchesType(value: unknown, type: ShallType): boolean {
  if (isRecordType(type)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const known = new Set(type.record.map((f) => f.name));
    // An invented field means the probe is testing something the interface
    // never promised, so it is not a probe of this program.
    if (Object.keys(record).some((k) => !known.has(k))) return false;
    return type.record.every((f) =>
      f.name in record ? matchesType(record[f.name], f.type) : f.optional,
    );
  }
  if (isListType(type)) {
    return Array.isArray(value) && value.every((v) => matchesType(v, type.list));
  }
  return matchesScalar(value, type);
}

function matchesScalar(value: unknown, type: ScalarType): boolean {
  switch (type) {
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number':  return typeof value === 'number' && Number.isFinite(value);
    case 'string':  return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
  }
}

export const PROBE_INSTRUCTIONS = `You design adversarial test inputs for a specification.

Your goal is to find inputs where two competent engineers, reading the same specification, could reasonably implement DIFFERENT behaviour — because the specification does not actually determine what happens.

Focus on:
- boundaries the specification mentions but does not bound precisely
- orderings the specification leaves unstated (which operation applies first)
- values at the exact edge of a stated condition
- inputs the specification does not mention at all

Return ONLY a JSON array. Each element: {"input": {...}, "rationale": "one short sentence"}.
The "input" object must contain exactly the declared input fields, with correctly typed values. No markdown, no prose.`;
