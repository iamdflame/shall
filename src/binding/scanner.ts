import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Binding scanner.
 *
 * A criterion is bound to code by an explicit annotation:
 *
 *   // @shall shall-language/1.2                  — this code implements criterion 1.2
 *   // @shall keel-core/1.2        — fully qualified, when several specs exist
 *
 * Explicit annotation is deliberate. Keel could guess bindings by matching
 * criterion prose against symbol names, and it offers that as a *suggestion*
 * (see resolver.ts), but a guess must never be reported as proof. The whole
 * value of a conformance report is that it is trustworthy; an inferred link
 * that silently goes stale is worse than no link at all.
 */

export type BindingKind = 'proof' | 'implementation';

export interface Binding {
  /** Criterion id as written in the annotation — may be unqualified. */
  ref: string;
  kind: BindingKind;
  /** Repo-relative path, POSIX separators. */
  file: string;
  /** 1-indexed line of the annotation. */
  line: number;
  /**
   * Name of the test this annotation labels, when the annotation sits directly
   * above a test(...)/it(...) call. This is what lets Keel join a static
   * annotation to a runtime pass/fail result.
   */
  testName?: string;
  /**
   * Hash of the code region the annotation governs. If this changes while the
   * criterion text does not, the implementation moved out from under the spec
   * and the binding needs re-verification.
   */
  anchorHash: string;
  /** The source lines that were hashed, for display in reports. */
  anchorPreview: string;
}

/**
 * A criterion reference is always `<n>.<m>`, optionally qualified by a spec
 * name. Matching anything word-shaped instead would bind English prose: the
 * phrase "@shall annotations." in a doc comment would resolve to a criterion
 * called "annotations." and be reported as a dangling reference.
 */
const ANNOTATION = /@shall\s+((?:[A-Za-z0-9._-]+\/)?\d+\.\d+)(?![\w.])/;

/**
 * Continuation and opening lines of a block comment. Documentation that
 * *describes* the annotation syntax lives here; real annotations sit on their
 * own line directly above the code they govern.
 */
const DOC_COMMENT_LINE = /^\s*(\/\*|\*)/;
const TEST_CALL = /^\s*(?:await\s+)?(?:test|it)(?:\.\w+)*\s*\(\s*(['"`])(.*?)\1/;

const DEFAULT_IGNORES = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', '.next',
  'out', 'vendor', 'target', '__pycache__', '.venv', 'venv',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.java', '.rb', '.kt', '.swift', '.cs', '.php',
]);

const TEST_PATH = /(^|[\/\\])(tests?|__tests__|spec)([\/\\]|$)|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go|rs)$|test_[^\/\\]*\.py$/i;

/** Does this path look like a test file? Decides proof vs implementation. */
export function isTestPath(relPath: string): boolean {
  return TEST_PATH.test(relPath);
}

/**
 * Character ranges occupied by string literals on a line.
 *
 * Annotations inside string literals are data, not code: test fixtures embed
 * `// @shall shall-language/1.1` in sample sources, and help text quotes the syntax. Binding
 * those would attach real criteria to fictional code regions and produce
 * spurious drift when the fixture is edited.
 */
function stringSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\') { i++; continue; }
    if (quote === null && (ch === "'" || ch === '"' || ch === '`')) {
      quote = ch;
      start = i;
    } else if (ch === quote) {
      spans.push([start, i]);
      quote = null;
    }
  }
  if (quote !== null) spans.push([start, line.length]);
  return spans;
}

function insideString(line: string, index: number): boolean {
  return stringSpans(line).some(([a, b]) => index > a && index < b);
}

function* walk(dir: string, root: string, ignores: Set<string>): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (ignores.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full, root, ignores);
    } else {
      const dot = entry.lastIndexOf('.');
      if (dot > 0 && SOURCE_EXTENSIONS.has(entry.slice(dot))) yield full;
    }
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Determine the region an annotation governs.
 *
 * We take the annotated line plus the following block, closing on brace balance
 * for C-family languages and on dedent for indentation-based ones. The region
 * is capped so that an unbalanced file cannot hash the entire source.
 */
function anchorRegion(lines: string[], startIdx: number): { text: string; preview: string } {
  const MAX = 80;
  const first = lines[startIdx + 1] ?? '';
  const baseIndent = first.match(/^\s*/)?.[0].length ?? 0;
  const braceStyle = /[{(]\s*$/.test(first) || first.includes('{');

  const collected: string[] = [];
  let depth = 0;
  let opened = false;

  for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 1 + MAX); i++) {
    const line = lines[i]!;
    collected.push(line);

    if (braceStyle) {
      for (const ch of line) {
        if (ch === '{' || ch === '(') { depth++; opened = true; }
        else if (ch === '}' || ch === ')') depth--;
      }
      if (opened && depth <= 0) break;
    } else {
      if (collected.length > 1 && line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= baseIndent) {
        collected.pop();
        break;
      }
    }
  }

  const text = collected.join('\n');
  // Hash on structure, not formatting: reindentation is not drift.
  const normalized = text.replace(/\s+/g, ' ').trim();
  return { text: normalized, preview: collected.slice(0, 3).join('\n') };
}

export function scanBindings(root: string, extraIgnores: string[] = []): Binding[] {
  const ignores = new Set([...DEFAULT_IGNORES, ...extraIgnores]);
  const bindings: Binding[] = [];

  for (const file of walk(root, root, ignores)) {
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!source.includes('@shall')) continue;

    const rel = relative(root, file).split(sep).join('/');
    const lines = source.split(/\r?\n/);
    const kind: BindingKind = isTestPath(rel) ? 'proof' : 'implementation';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (DOC_COMMENT_LINE.test(line)) continue;
      const match = line.match(ANNOTATION);
      if (!match) continue;
      if (insideString(line, match.index ?? 0)) continue;

      const { text, preview } = anchorRegion(lines, i);

      // If the next non-blank line declares a test, capture its name so the
      // static binding can be joined to the runtime result.
      let testName: string | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const candidate = lines[j]!;
        if (!candidate.trim()) continue;
        // Several criteria are often proven by one test, stacked above it.
        // Stopping at the first non-blank line bound only the last annotation
        // and silently left every criterion above it unverified.
        if (ANNOTATION.test(candidate)) continue;
        const testMatch = candidate.match(TEST_CALL);
        if (testMatch) testName = testMatch[2];
        break;
      }

      bindings.push({
        ref: match[1]!,
        kind,
        file: rel,
        line: i + 1,
        ...(testName ? { testName } : {}),
        anchorHash: sha256(text),
        anchorPreview: preview,
      });
    }
  }

  return bindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
