import type { Criterion, EarsClauses, EarsPattern } from './types.js';

/**
 * EARS clause parser.
 *
 * EARS constrains a requirement to a small grammar so that it is unambiguous
 * and machine-checkable:
 *
 *   ubiquitous  THE SYSTEM SHALL <response>
 *   event       WHEN <trigger> THEN THE SYSTEM SHALL <response>
 *   state       WHILE <state> THE SYSTEM SHALL <response>
 *   unwanted    IF <condition> THEN THE SYSTEM SHALL <response>
 *   optional    WHERE <feature> THE SYSTEM SHALL <response>
 *   complex     WHILE <state> WHEN <trigger> THEN THE SYSTEM SHALL <response>
 *
 * We parse by locating keyword tokens and slicing the segments between them,
 * rather than with one monolithic regex. A single regex cannot express the
 * ordering constraints (WHILE precedes WHEN; THEN binds the nearest WHEN/IF)
 * without becoming unreadable and silently wrong on the compound form.
 */

const KEYWORDS = ['WHILE', 'WHERE', 'WHEN', 'IF', 'THEN', 'SHALL'] as const;
type Keyword = (typeof KEYWORDS)[number];

interface Token {
  kw: Keyword;
  start: number;
  end: number;
}

/**
 * When a clause segment runs directly into the subject with no THEN to separate
 * them ("WHILE the file uploads the system SHALL ..."), recover the subject as
 * a trailing noun phrase: an article-led phrase of one or two words, or a
 * capitalised proper name. Anything else is left with the clause, and the
 * subject falls back to "the system" — we would rather under-claim than invent
 * a subject that is not in the text.
 */
const TRAILING_SUBJECT = /\s+(the\s+[a-z][\w-]*(?:\s+[a-z][\w-]*)?|[A-Z][\w-]*)\s*$/;

/** Sentinel wrapping a masked inline-code span. Never appears in real prose. */
const MASK = '\u0001';

interface Normalized {
  text: string;
  /** Contents of masked inline-code spans, indexed by their mask number. */
  codes: string[];
}

/**
 * Strip list markers and emphasis, and mask inline code spans.
 *
 * Masking matters: `` `SHALL` `` inside a clause is a quoted literal, not the
 * EARS keyword. Stripping backticks naively would make it tokenize as a second
 * SHALL and the criterion would be wrongly rejected as unsplittable.
 */
function normalize(line: string): Normalized {
  const codes: string[] = [];
  const text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/`([^`]*)`/g, (_, inner: string) => {
      codes.push(inner);
      return `${MASK}${codes.length - 1}${MASK}`;
    })
    .replace(/\*\*/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, codes };
}

/** Put masked inline-code contents back into a parsed clause value. */
function restore(value: string, codes: string[]): string {
  return value.replace(
    new RegExp(`${MASK}(\\d+)${MASK}`, 'g'),
    (_, i: string) => codes[Number(i)] ?? '',
  );
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({
      kw: m[1]!.toUpperCase() as Keyword,
      start: m.index,
      end: m.index + m[1]!.length,
    });
  }
  return tokens;
}

function cleanSegment(s: string): string {
  return s.replace(/^[\s,;:]+|[\s,;:.]+$/g, '').trim();
}

function normalizeSubject(s: string): string {
  const cleaned = cleanSegment(s);
  if (!cleaned) return 'the system';
  // "THE SYSTEM" and "The System" are the same actor; keep proper names as-is.
  return /^the\s+system$/i.test(cleaned) ? 'the system' : cleaned;
}

export interface ParseResult {
  pattern: EarsPattern;
  clauses: EarsClauses;
  diagnostic?: string;
}

/** Parse one acceptance-criterion line into its EARS clauses. */
export function parseEars(rawLine: string): ParseResult {
  const { text, codes } = normalize(rawLine);
  const empty: EarsClauses = { subject: 'the system', response: '', negated: false };

  if (!text) {
    return { pattern: 'malformed', clauses: empty, diagnostic: 'empty criterion' };
  }

  const tokens = tokenize(text);
  const shall = tokens.filter((t) => t.kw === 'SHALL');

  if (shall.length === 0) {
    return {
      pattern: 'malformed',
      clauses: empty,
      diagnostic:
        'no SHALL: an acceptance criterion must state an obligation ("… SHALL …"), otherwise there is nothing to verify',
    };
  }
  if (shall.length > 1) {
    return {
      pattern: 'malformed',
      clauses: empty,
      diagnostic:
        'multiple SHALL clauses: split this into one criterion per obligation so each can pass or fail independently',
    };
  }

  const shallTok = shall[0]!;
  const head = text.slice(0, shallTok.start);
  let response = cleanSegment(text.slice(shallTok.end));

  // SHALL NOT expresses a prohibition; we record it so reporting can distinguish
  // "did not happen" (correct) from "did not happen" (unimplemented).
  let negated = false;
  const notMatch = response.match(/^NOT\b\s*/i);
  if (notMatch) {
    negated = true;
    response = cleanSegment(response.slice(notMatch[0].length));
  }

  if (!response) {
    return {
      pattern: 'malformed',
      clauses: { ...empty, negated },
      diagnostic: 'SHALL has no response clause — the obligation is missing',
    };
  }

  const headTokens = tokens.filter((t) => t.end <= shallTok.start);
  const clauses: EarsClauses = { subject: 'the system', response, negated };

  // Segment the head: each keyword owns the text up to the next keyword.
  const segments = headTokens.map((tok, i) => {
    const next = headTokens[i + 1];
    return { kw: tok.kw, value: cleanSegment(text.slice(tok.end, next ? next.start : shallTok.start)) };
  });

  let sawThen = false;
  let subjectFromThen: string | undefined;

  for (const seg of segments) {
    switch (seg.kw) {
      case 'WHILE':
        clauses.state = seg.value;
        break;
      case 'WHERE':
        clauses.context = seg.value;
        break;
      case 'WHEN':
        clauses.trigger = seg.value;
        break;
      case 'IF':
        clauses.condition = seg.value;
        break;
      case 'THEN':
        sawThen = true;
        subjectFromThen = seg.value;
        break;
      case 'SHALL':
        break;
    }
  }

  if (sawThen) {
    clauses.subject = normalizeSubject(subjectFromThen ?? '');
  } else if (segments.length === 0) {
    // Ubiquitous: everything before SHALL is the subject.
    clauses.subject = normalizeSubject(head);
  } else {
    // A clause ran straight into the subject with no THEN separator.
    const last = segments[segments.length - 1]!;
    const match = last.value.match(TRAILING_SUBJECT);
    if (match) {
      clauses.subject = normalizeSubject(match[1]!);
      const trimmed = cleanSegment(last.value.slice(0, match.index));
      switch (last.kw) {
        case 'WHILE': clauses.state = trimmed; break;
        case 'WHERE': clauses.context = trimmed; break;
        case 'WHEN': clauses.trigger = trimmed; break;
        case 'IF': clauses.condition = trimmed; break;
      }
    }
  }

  // A dangling THEN with no antecedent is a common hand-written slip.
  if (sawThen && !clauses.trigger && !clauses.condition) {
    return {
      pattern: 'malformed',
      clauses,
      diagnostic: 'THEN without a preceding WHEN or IF — the triggering event is unstated',
    };
  }

  // Put masked inline-code spans back before anything downstream reads them.
  for (const key of ['trigger', 'condition', 'state', 'context'] as const) {
    const v = clauses[key];
    if (v !== undefined) clauses[key] = restore(v, codes);
  }
  clauses.subject = restore(clauses.subject, codes);
  clauses.response = restore(clauses.response, codes);

  const pattern = classify(clauses);
  return { pattern, clauses };
}

function classify(c: EarsClauses): EarsPattern {
  const hasTrigger = Boolean(c.trigger);
  const hasCondition = Boolean(c.condition);
  const hasState = Boolean(c.state);
  const hasContext = Boolean(c.context);

  const clauseCount = [hasTrigger, hasCondition, hasState, hasContext].filter(Boolean).length;
  if (clauseCount === 0) return 'ubiquitous';
  if (clauseCount > 1) return 'complex';
  if (hasTrigger) return 'event';
  if (hasCondition) return 'unwanted';
  if (hasState) return 'state';
  return 'optional';
}

/**
 * A one-line human rendering of a criterion, used in reports where the raw
 * markdown would be noise.
 */
export function describe(c: EarsClauses): string {
  const parts: string[] = [];
  if (c.state) parts.push(`while ${c.state}`);
  if (c.context) parts.push(`where ${c.context}`);
  if (c.trigger) parts.push(`when ${c.trigger}`);
  if (c.condition) parts.push(`if ${c.condition}`);
  parts.push(`${c.subject} shall${c.negated ? ' not' : ''} ${c.response}`);
  return parts.join(', ');
}

export type { Criterion };
