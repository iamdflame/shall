import type { Criterion } from '../../ears/types.js';
import type { Program } from '../lang/types.js';
import { programCriteria } from '../lang/types.js';
import type { Divergence } from '../oracle/differential.js';
import type { Probe } from '../oracle/probes.js';
import { engagementMatrix } from '../coverage/coverage.js';

/**
 * Attribution: which English sentence failed to determine the behaviour?
 *
 * A compile error that says only "the ensemble disagreed" is not usable. The
 * author needs the clause to edit. Attribution here is deterministic and
 * evidential rather than model-generated, for the same reason the oracle is:
 * a guess about which sentence caused a divergence is worth much less than a
 * measurement, and a wrong guess sends the author to edit correct prose.
 *
 * The measurement is a contrast. For each criterion we compare how often it is
 * engaged by the inputs that provoked disagreement against how often it is
 * engaged by the inputs everyone agreed on. A clause engaged by nearly every
 * divergent probe and almost no agreeing probe is implicated; a clause engaged
 * uniformly by both is merely common, and is not reported.
 */

export interface Attribution {
  criterion: Criterion;
  /** Share of divergent probes that engage this criterion, 0..1. */
  divergentRate: number;
  /** Share of agreeing probes that engage this criterion, 0..1. */
  agreeingRate: number;
  /** divergentRate - agreeingRate. Higher means more specifically implicated. */
  lift: number;
  /** Plain-language statement of the evidence. */
  evidence: string;
  /**
   * The specific open wording in this clause, when the lint found any.
   *
   * This is the strongest available signal and it dominates the ranking. A
   * statistical association says only that disagreement co-occurs with a
   * clause; a named vague phrase says *what* is underdetermined and gives the
   * author something to edit. Correlation alone routinely implicates innocent
   * clauses that merely apply everywhere - a tax rule, for instance, is engaged
   * by every input, so it correlates with every failure.
   */
  vagueTerm?: string;
  vagueWhy?: string;
}

/**
 * Engagement is shared with the coverage module rather than duplicated here.
 *
 * Two copies of "does this probe engage this clause" would drift, and then
 * coverage and attribution would quietly disagree about which clauses a run
 * actually exercised. One implementation, stem-aware and record-aware, is used
 * by both.
 */

export function attribute(
  program: Program,
  divergences: Divergence[],
  allProbes: Probe[],
): Attribution[] {
  const vagueByCriterion = new Map<string, VaguenessWarning>();
  for (const w of lintVagueness(program)) {
    if (!vagueByCriterion.has(w.criterion.id)) vagueByCriterion.set(w.criterion.id, w);
  }

  if (divergences.length === 0) return [];

  const divergentIds = new Set(divergences.map((d) => d.probe.id));
  const divergentProbes = divergences.map((d) => d.probe);
  const agreeingProbes = allProbes.filter((p) => !divergentIds.has(p.id));

  const results: Attribution[] = [];
  // One matrix over all probes, so a clause is judged the same way here as it is
  // in the coverage report, including fallbacks whose engagement is defined by
  // the complement of every other clause.
  const matrix = engagementMatrix(program, allProbes);
  const engagedIds = new Map<string, Set<string>>();
  for (const [id, row] of matrix) {
    engagedIds.set(id, new Set(allProbes.filter((_, i) => row.engaged[i]).map((p) => p.id)));
  }
  const hit = (criterionId: string, probe: Probe): boolean =>
    engagedIds.get(criterionId)?.has(probe.id) ?? false;

  for (const criterion of programCriteria(program)) {
    const divergentHits = divergentProbes.filter((p) => hit(criterion.id, p)).length;
    const agreeingHits = agreeingProbes.filter((p) => hit(criterion.id, p)).length;

    const divergentRate = divergentProbes.length ? divergentHits / divergentProbes.length : 0;
    const agreeingRate = agreeingProbes.length ? agreeingHits / agreeingProbes.length : 0;
    const lift = divergentRate - agreeingRate;

    if (divergentHits === 0) continue;

    const vague = vagueByCriterion.get(criterion.id);

    results.push({
      criterion,
      divergentRate,
      agreeingRate,
      lift,
      evidence:
        `engaged by ${divergentHits}/${divergentProbes.length} disagreeing inputs ` +
        `but only ${agreeingHits}/${agreeingProbes.length} agreeing ones`,
      ...(vague ? { vagueTerm: vague.term, vagueWhy: vague.why } : {}),
    });
  }

  // A named vague phrase outranks any statistical association. Within each
  // tier, rank by how specifically the disagreements concentrate on the clause.
  return results
    .filter((r) => r.vagueTerm !== undefined || r.lift > 0.05)
    .sort((a, b) => {
      const aVague = a.vagueTerm ? 1 : 0;
      const bVague = b.vagueTerm ? 1 : 0;
      return bVague - aVague || b.lift - a.lift || b.divergentRate - a.divergentRate;
    });
}

/**
 * Criteria whose prose contains words known to leave behaviour open.
 *
 * This is a static lint, independent of any divergence: it fires on a clause
 * whether or not the ensemble happened to split on it. It is a warning, never
 * an error - plenty of correct specifications use these words unambiguously,
 * and reporting them as failures would train authors to ignore the tool.
 */
const VAGUE_TERMS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bwords?\b/i, why: 'a "word" is undefined until the specification states how text is split - hyphens, apostrophes and digits are all conventions' },
  { pattern: /\bletters?\b/i, why: '"letters" may or may not include digits, accents and punctuation' },
  { pattern: /\bsort(s|ed|ing)?\b(?!.*\b(stable|ascending|descending|tie)\b)/i, why: 'sorting is stated without an order or a tie-break rule' },
  { pattern: /\bbetween\b(?!.*\b(inclusive|exclusive)\b)/i, why: '"between" does not say whether the bounds are included' },
  { pattern: /\bfirst\s+\w+\b(?!.*\bif fewer\b)/i, why: 'taking the first N does not say what happens when fewer than N exist' },
  { pattern: /\baverage|\bmean\b/i, why: 'an average is undefined for an empty collection unless the specification says so' },
  { pattern: /\bthe order\b/i, why: '"the order" may mean the original subtotal or the amount after adjustments' },
  { pattern: /\bappropriate(ly)?\b/i, why: '"appropriate" states a judgement, not a behaviour' },
  { pattern: /\breasonabl[ey]\b/i, why: '"reasonable" states a judgement, not a behaviour' },
  { pattern: /\bvalid\b/i, why: '"valid" is undefined unless the specification says what validity means' },
  { pattern: /\bhandle[sd]?\b/i, why: '"handle" does not say what the system actually does' },
  { pattern: /\bproperly\b|\bcorrectly\b/i, why: '"properly" restates the goal without defining it' },
  { pattern: /\bround(s|ed|ing)?\b(?!.*\b(half|away|toward|up\b|down\b|nearest)\b)/i, why: 'rounding is stated without a rounding mode' },
  { pattern: /\bif necessary\b|\bas needed\b/i, why: 'the condition under which this applies is unstated' },
  { pattern: /\bsupported\b|\bsuitable\b/i, why: 'the set this refers to is never enumerated' },
  { pattern: /\betc\.?\b|\band so on\b/i, why: 'an open-ended list cannot be implemented' },
  { pattern: /\blarge\b|\bsmall\b|\bquickly\b|\bslow\b/i, why: 'a relative term with no stated threshold' },
];

export interface VaguenessWarning {
  criterion: Criterion;
  term: string;
  why: string;
}

// @shall shall-language/4.3
export function lintVagueness(program: Program): VaguenessWarning[] {
  const warnings: VaguenessWarning[] = [];
  for (const criterion of programCriteria(program)) {
    for (const { pattern, why } of VAGUE_TERMS) {
      const match = criterion.raw.match(pattern);
      if (match) warnings.push({ criterion, term: match[0], why });
    }
  }
  return warnings;
}

/**
 * When no single clause is responsible, look at pairs.
 *
 * Reporting "no single clause is clearly responsible" is a dead end for an
 * author: it is true, and there is nothing to do about it. But ambiguity very
 * often lives *between* two precise sentences rather than inside one vague one -
 * two rules that are each unambiguous alone, and silent about which applies
 * first. Half the probe budget is already reserved for input interactions, so
 * the evidence for this is already collected.
 *
 * Only pairs are considered. Triples and beyond explode combinatorially and,
 * with the probe counts involved here, would mostly report noise.
 */
export interface PairAttribution {
  a: Criterion;
  b: Criterion;
  /** Share of disagreeing inputs that engage BOTH clauses. */
  divergentRate: number;
  /** Share of agreeing inputs that engage both. */
  agreeingRate: number;
  lift: number;
  evidence: string;
}

const MAX_CLAUSES_FOR_PAIRS = 24;

// @shall disambiguation/3.1
// @shall disambiguation/3.2
// @shall disambiguation/3.3
export function attributePairs(
  program: Program,
  divergences: Divergence[],
  allProbes: Probe[],
): PairAttribution[] {
  if (divergences.length === 0) return [];

  const criteria = programCriteria(program).filter((c) => c.pattern !== 'malformed');
  if (criteria.length < 2 || criteria.length > MAX_CLAUSES_FOR_PAIRS) return [];

  const divergentIds = new Set(divergences.map((d) => d.probe.id));
  const divergentProbes = divergences.map((d) => d.probe);
  const agreeingProbes = allProbes.filter((p) => !divergentIds.has(p.id));
  if (divergentProbes.length === 0) return [];

  // Engagement is computed once per clause rather than once per pair.
  const matrix = engagementMatrix(program, allProbes);
  const engagement = new Map<string, { divergent: Set<string>; agreeing: Set<string> }>();
  for (const criterion of criteria) {
    const row = matrix.get(criterion.id);
    const engaged = new Set(allProbes.filter((_, i) => row?.engaged[i]).map((p) => p.id));
    engagement.set(criterion.id, {
      divergent: new Set(divergentProbes.filter((p) => engaged.has(p.id)).map((p) => p.id)),
      agreeing: new Set(agreeingProbes.filter((p) => engaged.has(p.id)).map((p) => p.id)),
    });
  }

  const results: PairAttribution[] = [];
  for (let i = 0; i < criteria.length; i++) {
    for (let j = i + 1; j < criteria.length; j++) {
      const a = criteria[i]!;
      const b = criteria[j]!;
      const ea = engagement.get(a.id)!;
      const eb = engagement.get(b.id)!;

      const bothDivergent = [...ea.divergent].filter((id) => eb.divergent.has(id)).length;
      if (bothDivergent === 0) continue;
      const bothAgreeing = [...ea.agreeing].filter((id) => eb.agreeing.has(id)).length;

      const divergentRate = bothDivergent / divergentProbes.length;
      const agreeingRate = agreeingProbes.length ? bothAgreeing / agreeingProbes.length : 0;
      const lift = divergentRate - agreeingRate;

      // Coverage first, lift second. A pair of broadly-applicable clauses has a
      // small lift even when it accounts for every disagreement, because both
      // are also engaged by most agreeing inputs. What identifies an ordering
      // ambiguity is that the pair explains essentially ALL of the divergence,
      // so that is the primary filter and lift only breaks ties.
      if (divergentRate < 0.8) continue;
      if (lift <= 0.02) continue;

      results.push({
        a, b, divergentRate, agreeingRate, lift,
        evidence:
          `engaged together by ${bothDivergent}/${divergentProbes.length} disagreeing inputs ` +
          `but only ${bothAgreeing}/${agreeingProbes.length} agreeing ones`,
      });
    }
  }

  return results
    .sort((x, y) => y.divergentRate - x.divergentRate || y.lift - x.lift)
    .slice(0, 3);
}
