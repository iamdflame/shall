import type { Criterion } from '../../ears/types.js';
import type { Program } from '../lang/types.js';
import type { BehaviourGroup, Divergence } from '../oracle/differential.js';
import type { CompilerModel, Provider } from '../provider/types.js';

/**
 * Proposing the fix.
 *
 * Until now SHALL was a critic: it proved a sentence was underdetermined and
 * stopped, leaving the author to work out which of several behaviours they
 * meant and how to say so. But the ensemble has already done most of that work.
 * When readers split, each group *is* a coherent reading of the English, and
 * the divergent probes show exactly what distinguishes them.
 *
 * So a rewrite is proposed per reading. The proposal is a model call and is
 * therefore untrusted - but the check that it works is the existing
 * deterministic oracle. Suggestion is cheap and fallible; proof is not. That
 * split is the same one the rest of the design rests on.
 */

export interface Suggestion {
  /** Which behaviour group this rewrite would pin the specification to. */
  readingIndex: number;
  readers: string[];
  /** How this reading behaves on the witness input. */
  exampleInput: Record<string, unknown>;
  exampleOutput: string;
  /** The proposed replacement for the criterion's line. */
  rewrite: string;
}

export const SUGGEST_INSTRUCTIONS = `You rewrite a single acceptance criterion so that it can only be read one way.

You are given a criterion that several independent engineers read differently, and one specific reading to pin down - described by concrete inputs and the outputs that reading produces.

Rules:
- Return ONE sentence: the replacement for that criterion, in EARS form, keeping SHALL.
- It must force the described reading and exclude every other reading.
- Name the rule explicitly. Do not write "correctly", "appropriately", or "as expected".
- Do not add behaviour the original criterion did not cover.
- Return only the sentence. No markdown, no quotes, no explanation.`;

export function buildSuggestInput(
  program: Program,
  criterion: Criterion,
  group: BehaviourGroup,
  divergences: Divergence[],
): string {
  const examples = divergences
    .slice(0, 6)
    .map((d) => {
      const input = d.minimalInput ?? d.probe.input;
      const readings = d.minimalInput ? (d.minimalReadings ?? d.readings) : d.readings;
      const reading = readings.find((r) => r.members.some((m) => group.members.some((g) => g.label === m)));
      return `  input ${JSON.stringify(input)} -> ${reading ? reading.display : '?'}`;
    })
    .join('\n');

  return `PROGRAM: ${program.name}

THE CRITERION THAT IS READ SEVERAL WAYS:

  ${criterion.raw}

THE READING TO PIN DOWN, shown as inputs and the outputs it produces:

${examples}

Rewrite the criterion so only this reading is possible.`;
}

export interface SuggestOptions {
  program: Program;
  criterion: Criterion;
  groups: BehaviourGroup[];
  divergences: Divergence[];
  provider: Provider;
  model: CompilerModel;
  maxOutputTokens: number;
}

/** One proposed rewrite per distinct reading, largest cohort first. */
// @shall disambiguation/2.1
// @shall disambiguation/2.2
// @shall disambiguation/2.3
export async function suggestRewrites(options: SuggestOptions): Promise<Suggestion[]> {
  const { program, criterion, groups, divergences, provider, model, maxOutputTokens } = options;

  const results = await Promise.all(
    groups.map(async (group, index): Promise<Suggestion | null> => {
      const witness = divergences[0];
      // Read the input and its outputs from the same measurement.
      const readings = witness?.minimalReadings ?? witness?.readings;
      const reading = readings?.find((r) =>
        r.members.some((m) => group.members.some((g) => g.label === m)),
      );
      try {
        const result = await provider.complete(model, {
          instructions: SUGGEST_INSTRUCTIONS,
          input: buildSuggestInput(program, criterion, group, divergences),
          maxOutputTokens,
        });
        return {
          readingIndex: index,
          readers: group.members.map((m) => m.label),
          exampleInput: witness ? (witness.minimalInput ?? witness.probe.input) : {},
          exampleOutput: reading?.display ?? '?',
          rewrite: cleanSentence(result.text),
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is Suggestion => r !== null);
}

/** Strip quoting and fencing a model may add despite instructions. */
export function cleanSentence(text: string): string {
  let out = text.trim();
  const fenced = out.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (fenced) out = fenced[1]!.trim();
  out = out.replace(/^["'`]|["'`]$/g, '').trim();
  // Keep only the first sentence-like line; a stray explanation is not the rewrite.
  const firstLine = out.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine;
}

/** Replace one criterion's line in the source, preserving its indentation. */
export function applyRewrite(source: string, line: number, rewrite: string): string {
  const lines = source.split(/\r?\n/);
  const target = lines[line - 1];
  if (target === undefined) return source;
  const indent = target.match(/^\s*/)?.[0] ?? '';
  lines[line - 1] = indent + rewrite;
  return lines.join('\n');
}
