import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseEars } from './parser.js';
import type { Criterion, Requirement, Spec } from './types.js';

/**
 * Reads Kiro's native spec layout:
 *
 *   .kiro/specs/<spec-name>/requirements.md
 *                          /design.md
 *                          /tasks.md
 *
 * Only requirements.md carries verifiable claims, so that is what we parse.
 * design.md and tasks.md are read elsewhere for context and coverage reporting.
 */

const REQUIREMENT_HEADING = /^#{2,4}\s*Requirement\s+(\d+)\s*[:.\-–]?\s*(.*)$/i;
/** Tolerate plain numbered headings — hand-written specs often drop the word. */
const NUMBERED_HEADING = /^#{2,4}\s*(\d+)[.)]\s+(.+)$/;
const USER_STORY = /^\s*\*{0,2}User Story:?\*{0,2}\s*(.+)$/i;
const USER_STORY_BODY = /^As an?\s+(.+?),\s*I want\s+(.+?),\s*so that\s+(.+?)\.?$/i;
const ACCEPTANCE_HEADING = /^#{2,5}\s*Acceptance Criteria\s*$/i;
const OTHER_HEADING = /^#{1,6}\s+/;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+(.+)$/;

/** Lines that look like criteria but are template placeholders, not claims. */
function isPlaceholder(text: string): boolean {
  return /\[(specific event or trigger|condition or state|ongoing condition|context or location|system name|specific system response|required behavior|continuous behavior|contextual behavior)\]/i.test(
    text,
  );
}

export function parseRequirementsDocument(source: string, specName: string, path: string): Spec {
  const lines = source.split(/\r?\n/);
  const requirements: Requirement[] = [];
  const introLines: string[] = [];

  let current: Requirement | null = null;
  let inAcceptance = false;
  let inIntroduction = false;
  let inFence = false;

  const flush = () => {
    if (current) requirements.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Never parse inside fenced code — examples of EARS are not EARS.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const headingMatch = line.match(REQUIREMENT_HEADING) ?? line.match(NUMBERED_HEADING);
    if (headingMatch) {
      flush();
      inAcceptance = false;
      inIntroduction = false;
      current = {
        number: Number(headingMatch[1]),
        title: (headingMatch[2] ?? '').trim() || `Requirement ${headingMatch[1]}`,
        criteria: [],
        line: i + 1,
      };
      continue;
    }

    if (ACCEPTANCE_HEADING.test(line)) {
      inAcceptance = true;
      continue;
    }

    if (/^#{1,6}\s*Introduction\s*$/i.test(line)) {
      inIntroduction = true;
      continue;
    }

    // Any other heading closes the acceptance-criteria block.
    if (OTHER_HEADING.test(line)) {
      if (inAcceptance) inAcceptance = false;
      if (inIntroduction) inIntroduction = false;
      continue;
    }

    if (inIntroduction && line.trim()) {
      introLines.push(line.trim());
      continue;
    }

    if (current && !current.userStory) {
      const storyMatch = line.match(USER_STORY);
      if (storyMatch) {
        const body = storyMatch[1]!.trim().match(USER_STORY_BODY);
        if (body) {
          current.userStory = {
            role: body[1]!.trim(),
            want: body[2]!.trim(),
            benefit: body[3]!.trim(),
          };
        }
        continue;
      }
    }

    if (inAcceptance && current) {
      const item = line.match(LIST_ITEM);
      if (!item) continue;
      const text = item[1]!.trim();
      if (!text || isPlaceholder(text)) continue;

      const ordinal = current.criteria.length + 1;
      const { pattern, clauses, diagnostic } = parseEars(text);
      const id = `${current.number}.${ordinal}`;
      const criterion: Criterion = {
        id,
        qualifiedId: `${specName}/${id}`,
        requirement: current.number,
        ordinal,
        raw: text,
        pattern,
        clauses,
        line: i + 1,
        ...(diagnostic ? { diagnostic } : {}),
      };
      current.criteria.push(criterion);
    }
  }

  flush();

  return {
    name: specName,
    path,
    ...(introLines.length ? { introduction: introLines.join(' ') } : {}),
    requirements,
  };
}

/** Discover and parse every spec under a `.kiro/specs` directory. */
export function loadSpecs(kiroDir: string): Spec[] {
  const specsDir = join(kiroDir, 'specs');
  if (!existsSync(specsDir)) return [];

  const specs: Spec[] = [];
  for (const entry of readdirSync(specsDir)) {
    const dir = join(specsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const reqPath = join(dir, 'requirements.md');
    if (!existsSync(reqPath)) continue;
    specs.push(parseRequirementsDocument(readFileSync(reqPath, 'utf8'), basename(dir), reqPath));
  }
  return specs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Flatten every criterion across every spec, in stable order. */
export function allCriteria(specs: Spec[]): Criterion[] {
  return specs.flatMap((s) => s.requirements.flatMap((r) => r.criteria));
}
