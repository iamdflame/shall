import { spawn } from 'node:child_process';

/**
 * Test-runner adapter.
 *
 * Keel needs one thing from a test suite: a map of test name -> passed. It gets
 * that from TAP, which node:test, tap, ava, and (via reporters) vitest and jest
 * all emit. Parsing TAP rather than integrating with a specific runner keeps
 * Keel runner-agnostic and dependency-free, which matters because Keel must
 * install and run for a judge with no API keys and no per-framework setup.
 */

export interface TestResult {
  name: string;
  passed: boolean;
  /** TAP directives — skipped/todo tests are not evidence of conformance. */
  skipped: boolean;
}

export interface RunOutcome {
  results: TestResult[];
  exitCode: number;
  /** Combined stdout+stderr, retained for diagnostics when parsing finds nothing. */
  output: string;
  ran: boolean;
  error?: string;
}

const TAP_LINE = /^\s*(not\s+ok|ok)\s+(\d+)\s*-?\s*(.*)$/;
const TAP_DIRECTIVE = /\s+#\s*(SKIP|TODO)\b/i;

export function parseTap(output: string): TestResult[] {
  const results: TestResult[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(TAP_LINE);
    if (!match) continue;

    const rawName = match[3]!.trim();
    const skipped = TAP_DIRECTIVE.test(rawName);
    // Strip the directive *and* its reason text: "ok 1 - thing # SKIP not ready"
    // must yield "thing", or the name will never match its binding.
    const name = rawName.replace(/\s+#.*$/, '').trim();
    if (!name) continue;

    // node:test emits both the subtest and its parent file as TAP lines; the
    // first occurrence of a name is the real test, later ones are roll-ups.
    const key = `${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ name, passed: !match[1]!.startsWith('not'), skipped });
  }

  return results;
}

export function runTests(command: string, cwd: string, timeoutMs = 120_000): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        results: [],
        exitCode: -1,
        output,
        ran: false,
        error: `test command exceeded ${Math.round(timeoutMs / 1000)}s and was killed`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ results: [], exitCode: -1, output, ran: false, error: err.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ results: parseTap(output), exitCode: code ?? -1, output, ran: true });
    });
  });
}
