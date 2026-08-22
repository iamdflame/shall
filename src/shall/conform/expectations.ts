import type { Criterion } from '../../ears/types.js';
import type { Program } from '../lang/types.js';
import { typeName } from '../lang/types.js';
import type { CompilerModel, Provider } from '../provider/types.js';

/**
 * Conformance: does the agreed program do what the specification asked?
 *
 * Consensus and conformance answer different questions, and a build needs both.
 * Consensus asks whether independent readers understood the English the same
 * way. It is silent on whether that shared understanding is the one the author
 * wrote down - six readers can agree on a behaviour the specification never
 * requested, and the oracle would happily call that unambiguous.
 *
 * So each criterion is turned back into test cases, derived from that one
 * clause alone, and the built program is run against them.
 *
 * The expectations are themselves untrustworthy on their own - a model asked
 * what a clause requires can be as wrong as a model asked to implement it. They
 * are therefore filtered by the same principle as everything else here: several
 * readers propose expectations independently, and only cases where they agree
 * on the expected value are kept. A case that readers cannot agree on is not
 * evidence about the program; it is more evidence about the prose.
 */

export interface ExpectedCase {
  criterionId: string;
  input: Record<string, unknown>;
  expected: unknown;
  why: string;
  /** How many independent readers proposed this exact expectation. */
  agreement: number;
}

export interface DisputedCase {
  criterionId: string;
  input: Record<string, unknown>;
  /** Distinct expected values proposed, with how many readers proposed each. */
  proposals: { value: unknown; count: number }[];
}

export const EXPECTATION_INSTRUCTIONS = `You derive test cases from a single acceptance criterion.

You are given one criterion and a program interface. Produce test cases that the criterion ALONE determines - cases where you can state the required output with certainty by reading only that criterion.

Rules:
- If the criterion does not determine the output for an input, do not include that input.
- Do not invent behaviour from other criteria, from convention, or from what a reasonable program would probably do.
- Prefer inputs that exercise the exact condition the criterion states.

Return ONLY a JSON array. Each element: {"input": {...}, "expected": <value>, "why": "<short reason quoting the criterion>"}.
The "input" object must contain exactly the declared input fields with correctly typed values. The "expected" value must match the declared output type. No markdown, no prose.`;

export function buildExpectationInput(program: Program, criterion: Criterion): string {
  const inputs = program.interface.inputs
    .map((f) => `  ${f.name}: ${typeName(f.type)}`)
    .join('\n');
  const output = program.interface.outputs[0]!;

  return `PROGRAM: ${program.name}

INPUTS:
${inputs}

OUTPUT:
  ${output.name}: ${typeName(output.type)}

THE SINGLE CRITERION TO DERIVE CASES FROM:

  ${criterion.raw}

Produce the test cases now.`;
}

/** Stable key for grouping proposals about the same input. */
function inputKey(input: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(input)
      .sort()
      .map((k) => [k, input[k]]),
  );
}

function valueKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

interface RawProposal {
  input: Record<string, unknown>;
  expected: unknown;
  why: string;
}

export function parseProposals(raw: string, program: Program): RawProposal[] {
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
  const out: RawProposal[] = [];

  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as { input?: unknown; expected?: unknown; why?: unknown };
    if (!rec.input || typeof rec.input !== 'object' || Array.isArray(rec.input)) continue;
    if (!('expected' in rec)) continue;

    const input = rec.input as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.length !== names.size || !keys.every((k) => names.has(k))) continue;

    out.push({
      input,
      expected: rec.expected,
      why: typeof rec.why === 'string' ? rec.why : '',
    });
  }
  return out;
}

export interface DeriveOptions {
  program: Program;
  criteria: Criterion[];
  jurors: CompilerModel[];
  provider: Provider;
  maxOutputTokens: number;
  /** Readers that must propose the same expectation for a case to be kept. */
  minAgreement: number;
  onProgress?: (criterionId: string) => void;
}

export interface DeriveResult {
  agreed: ExpectedCase[];
  disputed: DisputedCase[];
}

/**
 * Ask several readers, independently, what each criterion requires, and keep
 * only the expectations they agree on.
 */
// @shall shall-language/5.1
// @shall shall-language/5.2
export async function deriveExpectations(options: DeriveOptions): Promise<DeriveResult> {
  const { program, criteria, jurors, provider, maxOutputTokens, minAgreement, onProgress } = options;

  const agreed: ExpectedCase[] = [];
  const disputed: DisputedCase[] = [];

  for (const criterion of criteria) {
    if (criterion.pattern === 'malformed') continue;
    onProgress?.(criterion.id);

    const input = buildExpectationInput(program, criterion);

    const responses = await Promise.all(
      jurors.map(async (juror) => {
        try {
          const result = await provider.complete(juror, {
            instructions: EXPECTATION_INSTRUCTIONS,
            input,
            maxOutputTokens,
          });
          return parseProposals(result.text, program);
        } catch {
          return [] as RawProposal[];
        }
      }),
    );

    // Group by input, then by proposed value. One reader gets one vote per
    // input, so a reader repeating itself cannot manufacture agreement.
    const byInput = new Map<
      string,
      { input: Record<string, unknown>; votes: Map<string, { value: unknown; why: string; voters: Set<number> }> }
    >();

    responses.forEach((proposals, jurorIndex) => {
      const seenThisJuror = new Set<string>();
      for (const proposal of proposals) {
        const ik = inputKey(proposal.input);
        const vk = valueKey(proposal.expected);
        if (seenThisJuror.has(`${ik}|${vk}`)) continue;
        seenThisJuror.add(`${ik}|${vk}`);

        const bucket = byInput.get(ik) ?? { input: proposal.input, votes: new Map() };
        const vote = bucket.votes.get(vk) ?? { value: proposal.expected, why: proposal.why, voters: new Set<number>() };
        vote.voters.add(jurorIndex);
        if (!vote.why && proposal.why) vote.why = proposal.why;
        bucket.votes.set(vk, vote);
        byInput.set(ik, bucket);
      }
    });

    for (const bucket of byInput.values()) {
      const ranked = [...bucket.votes.values()].sort((a, b) => b.voters.size - a.voters.size);
      const top = ranked[0]!;

      // Readers disagreeing about what a clause requires is itself a finding.
      if (ranked.length > 1 || top.voters.size < minAgreement) {
        disputed.push({
          criterionId: criterion.id,
          input: bucket.input,
          proposals: ranked.map((r) => ({ value: r.value, count: r.voters.size })),
        });
        continue;
      }

      agreed.push({
        criterionId: criterion.id,
        input: bucket.input,
        expected: top.value,
        why: top.why,
        agreement: top.voters.size,
      });
    }
  }

  return { agreed, disputed };
}
