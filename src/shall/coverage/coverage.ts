import type { Criterion } from '../../ears/types.js';
import type { Program, ShallType } from '../lang/types.js';
import { programCriteria, isListType, isRecordType } from '../lang/types.js';
import type { Probe } from '../oracle/probes.js';

/**
 * Specification coverage.
 *
 * Code coverage answers "which lines ran". Nothing answers the same question
 * about a specification, and the answer matters more: a criterion that no probe
 * ever engaged has not been verified by anything. The readers may have agreed
 * unanimously on every probe and still never once exercised clause 3.2, in
 * which case "unambiguous" says nothing at all about clause 3.2.
 *
 * That is the difference between a build that was checked and a build that
 * merely passed. Reporting it is what stops a green result from overclaiming.
 *
 * Engagement is deliberately conservative. A clause is counted as engaged only
 * when a probe plausibly makes it applicable — it names an input that the probe
 * set to a non-default value, or the probe sits at a threshold the clause
 * states. Over-counting would inflate coverage and defeat the point.
 */

export interface CriterionCoverage {
  criterion: Criterion;
  /** Probes that plausibly engage this clause. */
  engaged: number;
  /** Share of all probes that engage it, 0..1. */
  rate: number;
  /** True when no probe engaged it, so nothing verified it. */
  unexercised: boolean;
  /** Input paths the clause appears to reference, e.g. "order.subtotal". */
  references: string[];
}

export interface CoverageReport {
  criteria: CriterionCoverage[];
  probes: number;
  /** Criteria engaged by at least one probe. */
  covered: number;
  /** Criteria that no probe engaged. */
  unexercised: CriterionCoverage[];
  /** covered / checkable, 0..1. */
  score: number;
}

/* ── word matching ─────────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'system', 'shall', 'when', 'if', 'then', 'while', 'where',
  'is', 'are', 'be', 'to', 'of', 'and', 'or', 'not', 'it', 'that', 'by', 'as',
  'with', 'for', 'in', 'on', 'at', 'this', 'its', 'was', 'has', 'have', 'than',
]);

/**
 * A crude stem, sufficient for matching a clause's nouns to an input's name.
 *
 * The engagement check used to compare words literally, so a clause saying
 * "die" never matched an input called `dice` and a clause about "words" never
 * matched an input called `word`. That silently dropped real clauses out of
 * both attribution and coverage — and a coverage number that quietly ignores
 * the clauses it cannot match is worse than no number.
 *
 * Irregulars are listed because English will not be stemmed into behaving.
 */
const IRREGULAR: Record<string, string> = {
  dice: 'die', die: 'die', mice: 'mouse', people: 'person', children: 'child',
  feet: 'foot', teeth: 'tooth', men: 'man', women: 'woman', indices: 'index',
  matrices: 'matrix', vertices: 'vertex', criteria: 'criterion',
};

// @shall specification-coverage/2.1
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w]!;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && (w.endsWith('ses') || w.endsWith('xes') || w.endsWith('zes'))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

/** Split an identifier or phrase into stemmed, meaningful words. */
export function terms(text: string): Set<string> {
  return new Set(
    text
      // camelCase and snake_case both carry meaning worth splitting on.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem),
  );
}

/**
 * Specifications spell small numbers out. "shorter than three letters" states a
 * threshold every bit as much as "shorter than 3 letters", and a digit-only
 * scan would miss the clause entirely.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, fifty: 50,
  hundred: 100, thousand: 1000,
};

function numbersIn(text: string): number[] {
  const digits = [...text.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((m) => Number(m[0]))
    .filter((n) => Number.isFinite(n));
  const spelled = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((w) => NUMBER_WORDS[w])
    .filter((n): n is number => n !== undefined);
  return [...digits, ...spelled];
}

/* ── the specification's own vocabulary ────────────────────────────────── */

/**
 * A specification names things the interface does not.
 *
 * WordCount declares one input, `text`, and then requirement 2 says "ignore
 * words shorter than three letters". Nothing in that sentence is called `text`,
 * so a purely lexical check finds no input and declares the clause unexercised
 * — which is false, and a false alarm in a coverage report is worse than no
 * report, because it trains the reader to ignore it.
 *
 * But the specification already told us what a "word" is: requirement 1 says
 * "count the words in the text", binding the two in one sentence. A clause that
 * names exactly one input teaches its other nouns as aliases for that input.
 * The vocabulary is learned from the document rather than supplied by us, so
 * it costs no domain knowledge and works for orders and dice as well as text.
 *
 * Only single-input clauses teach. A clause naming two inputs cannot say which
 * of them its other nouns belong to, and guessing would spread the vocabulary
 * across unrelated fields.
 */
/**
 * The verbs this specification uses to state a response.
 *
 * EARS puts the response after SHALL, so the word following it is a verb by
 * construction — "return", "count", "ignore", "charge". Those describe what the
 * system does, not what an input is, and letting them become aliases links
 * every clause to every input: "SHALL return the amount" would teach that
 * "return" means `amount`, and then every other clause saying "return" looks
 * engaged. Coverage would read 100% on a specification nothing had tested.
 *
 * Derived from the document rather than hand-listed, so it holds for domains
 * whose verbs we have never seen.
 */
// @shall specification-coverage/2.3
function responseVerbs(program: Program): Set<string> {
  const verbs = new Set<string>();
  for (const criterion of programCriteria(program)) {
    for (const m of criterion.raw.matchAll(/\bshall\s+(?:not\s+)?([A-Za-z]+)/gi)) {
      verbs.add(stem(m[1]!));
    }
  }
  return verbs;
}

// @shall specification-coverage/2.2
// @shall specification-coverage/2.4
export function vocabulary(program: Program): Map<string, Set<string>> {
  const inputNames = program.interface.inputs.map((f) => ({ field: f.name, words: terms(f.name) }));
  const verbs = responseVerbs(program);
  const aliases = new Map<string, Set<string>>();

  for (const criterion of programCriteria(program)) {
    const clause = terms(criterion.raw);
    const named = inputNames.filter((i) => namesField(criterion.raw, i.field));
    if (named.length !== 1) continue;

    const field = named[0]!;
    for (const word of clause) {
      if (field.words.has(word)) continue;
      if (verbs.has(word)) continue;
      if (NUMBER_WORDS[word] !== undefined) continue;
      const set = aliases.get(word) ?? new Set<string>();
      set.add(field.field);
      aliases.set(word, set);
    }
  }

  // A word taught by two different clauses as belonging to two different inputs
  // is not an alias, it is a coincidence. Drop it rather than link both.
  for (const [word, fields] of aliases) if (fields.size > 1) aliases.delete(word);
  return aliases;
}

/**
 * Does this clause name this input?
 *
 * Term overlap handles the ordinary case, including plurals and camelCase. But
 * `terms` drops words of two characters or fewer as noise, which is right for
 * prose and wrong for identifiers: an input legitimately called `n` or `id`
 * would be invisible to every check built on top of it. A declared name is
 * never noise, so it is also matched directly as a whole word.
 */
// @shall specification-coverage/2.5
export function namesField(clause: string, field: string): boolean {
  const clauseTerms = terms(clause);
  if ([...terms(field)].some((t) => clauseTerms.has(t))) return true;
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(field)}(?:$|[^A-Za-z0-9_])`, 'i').test(clause);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── walking values ────────────────────────────────────────────────────── */

export interface Leaf {
  /** Dotted path, e.g. "order.subtotal" or "dice[]". */
  path: string;
  /** The final path segment, which is what a clause usually names. */
  name: string;
  value: unknown;
}

/**
 * Every scalar reachable in a probe's inputs, with the path that reached it.
 *
 * Records made this necessary: a clause naming "subtotal" must engage when
 * `order.subtotal` varies, and a check that only inspected top-level input
 * names would never see it.
 */
// @shall specification-coverage/2.6
export function leaves(value: unknown, type: ShallType, path: string): Leaf[] {
  if (isRecordType(type)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    return type.record.flatMap((f) =>
      f.name in record ? leaves(record[f.name], f.type, `${path}.${f.name}`) : [],
    );
  }
  if (isListType(type)) {
    if (!Array.isArray(value)) return [];
    // Elements share one path: a clause names the collection, not an index.
    return value.flatMap((v) => leaves(v, type.list, `${path}[]`));
  }
  const name = path.split(/[.[]/).filter(Boolean).pop() ?? path;
  return [{ path, name, value }];
}

/** Is a value at its least interesting? Used to mean "this clause is idle". */
function isDefault(value: unknown): boolean {
  return value === 0 || value === '' || value === false ||
    (Array.isArray(value) && value.length === 0);
}

/**
 * The part of a criterion that constrains the input.
 *
 * EARS separates the guard (WHEN / IF / WHILE / WHERE) from the response that
 * follows SHALL. When a criterion has no guard at all - a plain ubiquitous
 * "THE SYSTEM SHALL ..." - the response is the only text there is, and it does
 * describe which inputs the rule applies to, so it is used.
 */
export function guardOf(criterion: Criterion): string {
  const { trigger, condition, state, context, response } = criterion.clauses;
  const guards = [trigger, condition, state, context].filter(Boolean) as string[];
  return guards.length > 0 ? guards.join(' ') : response;
}

/* ── engagement ────────────────────────────────────────────────────────── */

/**
 * Does this probe plausibly make this clause applicable?
 *
 * Two signals, both conservative: the clause names an input the probe set to
 * something other than its default, or the probe carries a value within one
 * unit of a threshold the clause states.
 */
export function engages(
  criterion: Criterion,
  probe: Probe,
  program: Program,
  vocab?: Map<string, Set<string>>,
): boolean {
  return engagedPaths(criterion, probe, program, vocab).length > 0;
}

/** Which input paths caused this clause to be engaged by this probe. */
export function engagedPaths(
  criterion: Criterion,
  probe: Probe,
  program: Program,
  vocab: Map<string, Set<string>> = vocabulary(program),
): string[] {
  const clauseTerms = terms(criterion.raw);
  // Only the guard states a condition on the input. A number in the response
  // is a result: "SHALL return 42" says nothing about which inputs reach it,
  // and treating 42 as a threshold would mark the clause engaged by every
  // probe that happened to carry a 42 - which is coverage the run never had.
  const thresholds = numbersIn(guardOf(criterion));
  const hits: string[] = [];

  // Inputs this clause reaches through the specification's learned vocabulary
  // rather than by name — "words" standing for `text`.
  const viaVocab = new Set<string>();
  for (const term of clauseTerms) {
    for (const field of vocab.get(term) ?? []) viaVocab.add(field);
  }

  for (const field of program.interface.inputs) {
    for (const leaf of leaves(probe.input[field.name], field.type, field.name)) {
      const named = [...terms(leaf.name)].some((t) => clauseTerms.has(t)) ||
        namesField(criterion.raw, leaf.name) ||
        namesField(criterion.raw, field.name) ||
        viaVocab.has(field.name);

      if (named && !isDefault(leaf.value)) {
        hits.push(leaf.path);
        continue;
      }
      if (typeof leaf.value === 'number') {
        if (thresholds.some((t) => Math.abs(leaf.value as number - t) <= 1)) hits.push(leaf.path);
      }
    }
  }

  return [...new Set(hits)];
}

/**
 * Comparison wording, which is what turns a number into a boundary.
 *
 * Placed before the number ("shorter than three") or after it ("three or
 * more"). Both forms are common in requirements and both mean the same thing.
 */
const BEFORE = String.raw`(?:at\s+least|at\s+most|no\s+(?:more|less|fewer)\s+than|more\s+than|less\s+than|fewer\s+than|greater\s+than|shorter\s+than|longer\s+than|larger\s+than|smaller\s+than|up\s+to|below|above|under|over|beyond|exceeds?|exceeding|minimum\s+of|maximum\s+of|>=?|<=?)`;
const AFTER = String.raw`(?:or\s+(?:more|fewer|less|greater|higher|lower)|and\s+(?:above|below|over|under))`;
const NUM = String.raw`(-?\d+(?:\.\d+)?|[a-z]+)`;

/**
 * The boundaries a clause states.
 *
 * Every number in a guard is one: a guard exists to say when the rule applies,
 * so "IF five dice show the same face" turns at five. Outside a guard, only a
 * number wearing comparison wording qualifies. "SHALL ignore words shorter than
 * three letters" states a boundary at three even though it has no IF; "SHALL
 * score each die showing one as fifty points" states none, because the fifty is
 * what it pays out. Treating that fifty as a threshold would send probe
 * generation chasing a fifty-element list to satisfy a rule about one die.
 */
// @shall specification-coverage/4.1
// @shall specification-coverage/4.2
export function guardNumbers(criterion: Criterion): number[] {
  const { trigger, condition, state, context, response } = criterion.clauses;
  const guard = [trigger, condition, state, context].filter(Boolean).join(' ');

  const found = numbersIn(guard);
  for (const re of [
    new RegExp(`${BEFORE}\\s+${NUM}`, 'gi'),
    new RegExp(`${NUM}\\s+${AFTER}`, 'gi'),
  ]) {
    for (const m of `${guard} ${response}`.matchAll(re)) {
      const token = m[1]!;
      const value = /^-?\d/.test(token) ? Number(token) : NUMBER_WORDS[token.toLowerCase()];
      if (value !== undefined && Number.isFinite(value)) found.push(value);
    }
  }

  return [...new Set(found)];
}

/**
 * Which top-level inputs a clause refers to, by name or through the learned
 * vocabulary. Used to decide what a targeted probe should vary.
 */
export function referencedFields(
  criterion: Criterion,
  program: Program,
  vocab: Map<string, Set<string>> = vocabulary(program),
): string[] {
  const clauseTerms = terms(criterion.raw);
  const hits = new Set<string>();

  for (const field of program.interface.inputs) {
    if (namesField(criterion.raw, field.name)) hits.add(field.name);
    // Field names inside a record are part of how a clause can name an input.
    for (const inner of fieldNames(field.type)) {
      if ([...terms(inner)].some((t) => clauseTerms.has(t))) hits.add(field.name);
    }
  }
  for (const term of clauseTerms) {
    for (const field of vocab.get(term) ?? []) hits.add(field);
  }

  return [...hits];
}

function fieldNames(type: ShallType): string[] {
  if (isRecordType(type)) return type.record.flatMap((f) => [f.name, ...fieldNames(f.type)]);
  if (isListType(type)) return fieldNames(type.list);
  return [];
}

/* ── fallback clauses ──────────────────────────────────────────────────── */

/**
 * "IF no rule above applies THEN the system SHALL return 0".
 *
 * A fallback names no input, states no threshold, and is not vague — it is
 * precise, and it is about the other clauses rather than about the data. No
 * lexical check can ever engage it, so a naive coverage report calls the
 * catch-all untested on every specification that has one. That is the most
 * common shape in EARS and the alarm would fire constantly.
 *
 * Its meaning gives the answer: a fallback applies exactly when nothing else
 * does. So it is engaged by precisely the probes that engage no other clause,
 * which is a stronger statement than lexical matching could make anyway.
 */
// @shall specification-coverage/3.1
export function isFallback(criterion: Criterion): boolean {
  const { trigger, condition, state, context } = criterion.clauses;
  const guard = [trigger, condition, state, context].filter(Boolean).join(' ');
  return /\b(?:no|none|neither)\b[^.]{0,30}\b(?:rule|requirement|criteri\w*|condition|case)\b/i.test(guard)
    || /\botherwise\b/i.test(guard)
    || /\bnone of the above\b/i.test(guard)
    || /\ball other (?:cases|inputs|values)\b/i.test(guard);
}

/**
 * Engagement for every criterion against every probe, with fallbacks resolved.
 *
 * Shared by coverage and attribution so the two can never disagree about which
 * clauses a run exercised.
 */
// @shall specification-coverage/3.2
// @shall specification-coverage/3.3
export function engagementMatrix(
  program: Program,
  probes: Probe[],
): Map<string, { engaged: boolean[]; references: string[] }> {
  const criteria = programCriteria(program).filter((c) => c.pattern !== 'malformed');
  const vocab = vocabulary(program);
  const rows = new Map<string, { engaged: boolean[]; references: string[] }>();

  const ordinary = criteria.filter((c) => !isFallback(c));
  for (const criterion of ordinary) {
    const refs = new Set<string>();
    const engaged = probes.map((probe) => {
      const paths = engagedPaths(criterion, probe, program, vocab);
      paths.forEach((path) => refs.add(path));
      return paths.length > 0;
    });
    rows.set(criterion.id, { engaged, references: [...refs].sort() });
  }

  for (const criterion of criteria.filter(isFallback)) {
    // Engaged wherever no ordinary clause was. With no ordinary clauses at all
    // the fallback is the only rule, so it applies everywhere.
    const engaged = probes.map((_, i) => ordinary.every((c) => !rows.get(c.id)!.engaged[i]));
    rows.set(criterion.id, { engaged, references: [] });
  }

  return rows;
}

/* ── the report ────────────────────────────────────────────────────────── */

// @shall specification-coverage/1.1
// @shall specification-coverage/1.4
export function measureCoverage(program: Program, probes: Probe[]): CoverageReport {
  const criteria = programCriteria(program).filter((c) => c.pattern !== 'malformed');
  const matrix = engagementMatrix(program, probes);

  const rows: CriterionCoverage[] = criteria.map((criterion) => {
    const row = matrix.get(criterion.id)!;
    const engaged = row.engaged.filter(Boolean).length;
    return {
      criterion,
      engaged,
      rate: probes.length ? engaged / probes.length : 0,
      unexercised: engaged === 0,
      references: row.references,
    };
  });

  const unexercised = rows.filter((r) => r.unexercised);

  return {
    criteria: rows,
    probes: probes.length,
    covered: rows.length - unexercised.length,
    unexercised,
    score: rows.length ? (rows.length - unexercised.length) / rows.length : 1,
  };
}
