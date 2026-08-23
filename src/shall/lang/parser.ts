import { parseEars } from '../../ears/parser.js';
import type { Criterion } from '../../ears/types.js';
import type {
  Field, Interface, ParseDiagnostic, ParsedProgram, Program,
  ShallRequirement, ShallType,
} from './types.js';
import { parseType, TypeError as TypeParseError } from './type-parser.js';

/**
 * Parser for `.shall` source.
 *
 * The grammar is deliberately tiny. Only the interface is formal; requirement
 * bodies are handed to the EARS parser and otherwise left as English. A parser
 * that tried to understand the prose would be re-implementing the compiler —
 * and the compiler is a language model, on purpose.
 */

const PROGRAM = /^program\s+([A-Za-z][A-Za-z0-9_]*)\s*$/;
const INTERFACE = /^interface\s*$/;
const FIELD = /^(input|output)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/;
const REQUIREMENT = /^Requirement\s+(\d+)\s*:\s*(.+?)\s*$/i;
const COMMENT = /^\s*(#|\/\/)/;

/**
 * Read a type expression, converting a parse failure into a diagnostic that
 * points at the column where it went wrong.
 */
function readType(raw: string, line: number, diagnostics: ParseDiagnostic[]): ShallType | null {
  try {
    return parseType(raw);
  } catch (err) {
    const e = err as TypeParseError;
    diagnostics.push({
      line,
      message: `${e.message}${typeof e.column === 'number' ? ` (at "${raw.trim()}")` : ''}`,
      fatal: true,
    });
    return null;
  }
}

export function parseShall(source: string, path: string): ParsedProgram {
  const lines = source.split(/\r?\n/);
  const diagnostics: ParseDiagnostic[] = [];

  let name: string | null = null;
  let nameLine = 0;
  const descriptionLines: string[] = [];
  const inputs: Field[] = [];
  const outputs: Field[] = [];
  const requirements: ShallRequirement[] = [];

  type Section = 'preamble' | 'description' | 'interface' | 'requirement';
  let section: Section = 'preamble';
  let current: ShallRequirement | null = null;

  const flush = () => {
    if (current) requirements.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    const lineNo = i + 1;

    if (!line || COMMENT.test(raw)) continue;

    const programMatch = line.match(PROGRAM);
    if (programMatch) {
      if (name !== null) {
        diagnostics.push({ line: lineNo, message: 'a file declares exactly one program', fatal: true });
        continue;
      }
      name = programMatch[1]!;
      nameLine = lineNo;
      section = 'description';
      continue;
    }

    if (INTERFACE.test(line)) {
      flush();
      section = 'interface';
      continue;
    }

    const reqMatch = line.match(REQUIREMENT);
    if (reqMatch) {
      flush();
      section = 'requirement';
      current = {
        number: Number(reqMatch[1]),
        title: reqMatch[2]!.trim(),
        criteria: [],
        line: lineNo,
      };
      continue;
    }

    if (section === 'interface') {
      const fieldMatch = line.match(FIELD);
      if (!fieldMatch) {
        diagnostics.push({
          line: lineNo,
          message: `expected "input <name>: <type>" or "output <name>: <type>", got "${line}"`,
          fatal: true,
        });
        continue;
      }
      const [, kind, fieldName, typeText] = fieldMatch;
      const type = readType(typeText!, lineNo, diagnostics);
      if (!type) continue;

      const target = kind === 'input' ? inputs : outputs;
      if (target.some((f) => f.name === fieldName)) {
        diagnostics.push({ line: lineNo, message: `duplicate ${kind} "${fieldName}"`, fatal: true });
        continue;
      }
      target.push({ name: fieldName!, type, line: lineNo });
      continue;
    }

    if (section === 'requirement' && current) {
      const { pattern, clauses, diagnostic } = parseEars(line);
      const ordinal = current.criteria.length + 1;
      const id = `${current.number}.${ordinal}`;
      const criterion: Criterion = {
        id,
        qualifiedId: `${name ?? 'program'}/${id}`,
        requirement: current.number,
        ordinal,
        raw: line,
        pattern,
        clauses,
        line: lineNo,
        ...(diagnostic ? { diagnostic } : {}),
      };
      current.criteria.push(criterion);

      if (pattern === 'malformed') {
        diagnostics.push({
          line: lineNo,
          message: `criterion ${id} is not valid EARS: ${diagnostic}`,
          fatal: false,
        });
      }
      continue;
    }

    if (section === 'description') {
      descriptionLines.push(line);
      continue;
    }

    diagnostics.push({
      line: lineNo,
      message: `unexpected line outside any section: "${line}"`,
      fatal: false,
    });
  }

  flush();

  if (name === null) {
    diagnostics.push({ line: 1, message: 'no program declaration — expected "program <Name>"', fatal: true });
    return { program: null, diagnostics };
  }
  // @shall shall-language/1.2
  if (inputs.length === 0) {
    diagnostics.push({ line: nameLine, message: 'the interface declares no inputs — nothing can be tested', fatal: true });
  }
  if (outputs.length === 0) {
    diagnostics.push({ line: nameLine, message: 'the interface declares no outputs — nothing can be compared', fatal: true });
  }
  // @shall shall-language/1.3
  if (outputs.length > 1) {
    diagnostics.push({
      line: outputs[1]!.line,
      message: 'a program declares exactly one output; wrap multiple values in a single field',
      fatal: true,
    });
  }
  if (requirements.length === 0) {
    diagnostics.push({ line: nameLine, message: 'the program states no requirements — there is nothing to compile', fatal: true });
  }

  const iface: Interface = { inputs, outputs };
  const program: Program = {
    name,
    ...(descriptionLines.length ? { description: descriptionLines.join(' ') } : {}),
    interface: iface,
    requirements,
    path,
    source,
  };

  return { program, diagnostics };
}

export function hasFatal(diagnostics: ParseDiagnostic[]): boolean {
  return diagnostics.some((d) => d.fatal);
}
