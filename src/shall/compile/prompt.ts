import type { Program } from '../lang/types.js';
import { typeName } from '../lang/types.js';

/**
 * The compiler prompt.
 *
 * The single most important property of this prompt is what it does NOT say.
 *
 * It never tells a member how to resolve an unclear requirement — no "make
 * reasonable assumptions", no "use standard conventions", no worked examples of
 * edge cases. Any such instruction would push every member toward the *same*
 * resolution, and the ensemble would report consensus on a sentence that is
 * genuinely ambiguous. The whole apparatus depends on each member reading the
 * English as it actually is and implementing what it actually believes.
 *
 * Members are likewise never told they are one of several, nor that their output
 * will be compared. A member that knows it is being diffed will hedge toward the
 * obvious reading, which is exactly the bias we are trying to measure.
 */

// @shall shall-language/2.2
export const COMPILER_INSTRUCTIONS = `You are a compiler. You translate a specification written in English into a JavaScript module.

Output requirements:
- Emit ONE JavaScript ES module and nothing else. No markdown fences, no prose, no explanation.
- The module must export a single function named \`run\`.
- \`run\` takes one argument: an object whose keys are the declared inputs.
- \`run\` returns the declared output value directly (not wrapped in an object).
- The module must be self-contained: no imports, no require, no I/O, no network, no randomness, no reliance on the current date or time.
- The function must be deterministic: the same input always produces the same output.

Implement precisely what the specification states. Do not add behaviour it does not describe, and do not omit behaviour it does describe.`;

export function buildCompilerInput(program: Program): string {
  const inputs = program.interface.inputs
    .map((f) => `  ${f.name}: ${typeName(f.type)}`)
    .join('\n');
  const output = program.interface.outputs[0]!;

  const requirements = program.requirements
    .map((r) => {
      const criteria = r.criteria.map((c) => `  ${c.id}. ${c.raw}`).join('\n');
      return `Requirement ${r.number}: ${r.title}\n${criteria}`;
    })
    .join('\n\n');

  return `PROGRAM: ${program.name}
${program.description ? `\n${program.description}\n` : ''}
INPUTS (the keys of the object passed to \`run\`):
${inputs}

OUTPUT (the value \`run\` returns):
  ${output.name}: ${typeName(output.type)}

SPECIFICATION:

${requirements}

Emit the JavaScript module now.`;
}

/** Strip markdown fences a member may add despite instructions. */
export function extractModule(text: string): string {
  const fenced = text.match(/```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : text).trim();
  return body;
}
