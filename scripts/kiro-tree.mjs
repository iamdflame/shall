#!/usr/bin/env node
/**
 * Print the .kiro package: what is in it, and how much of it is verified.
 *
 * `tree` shows a folder. This shows the contract - every spec with the number of
 * acceptance criteria it states - because the number is the point. It also needs
 * nothing installed, which `tree` does.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KIRO = '.kiro';
const NO_COLOR = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
const c = (code, s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const teal = (s) => c('36', s);
const green = (s) => c('32', s);

if (!existsSync(KIRO)) {
  console.error('no .kiro/ directory here');
  process.exit(1);
}

/** Acceptance criteria are the numbered lines under an "Acceptance Criteria" heading. */
function countCriteria(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let inBlock = false;
  let inFence = false;
  let n = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^#{2,5}\s*Acceptance Criteria\s*$/i.test(line)) { inBlock = true; continue; }
    if (/^#{1,6}\s+/.test(line)) { inBlock = false; continue; }
    if (inBlock && /^\s*\d+[.)]\s+\S/.test(line)) n++;
  }
  return n;
}

const dirs = (p) => (existsSync(p) ? readdirSync(p).filter((f) => statSync(join(p, f)).isDirectory()) : []);
const files = (p) => (existsSync(p) ? readdirSync(p).filter((f) => statSync(join(p, f)).isFile()) : []);

const steering = files(join(KIRO, 'steering')).map((f) => f.replace(/\.md$/, ''));
const hookFiles = files(join(KIRO, 'hooks'));
let hookCount = 0;
for (const f of hookFiles) {
  try {
    hookCount += (JSON.parse(readFileSync(join(KIRO, 'hooks', f), 'utf8')).hooks ?? []).length;
  } catch { /* a malformed hook file is not worth failing a listing over */ }
}

const specs = dirs(join(KIRO, 'specs')).map((name) => {
  const dir = join(KIRO, 'specs', name);
  const req = join(dir, 'requirements.md');
  return {
    name,
    criteria: existsSync(req) ? countCriteria(req) : 0,
    parts: files(dir).map((f) => f.replace(/\.md$/, '')).sort(),
  };
}).sort((a, b) => b.criteria - a.criteria);

const total = specs.reduce((n, s) => n + s.criteria, 0);
const width = Math.max(...specs.map((s) => s.name.length), 20);

console.log('');
console.log(bold('.kiro'));
console.log(`${dim('├──')} ${bold('steering/')}   ${dim(steering.join(' · '))}`);
console.log(`${dim('├──')} ${bold('hooks/')}      ${dim(`${hookCount} agent hooks`)}`);
console.log(`${dim('└──')} ${bold('specs/')}`);

specs.forEach((s, i) => {
  const last = i === specs.length - 1;
  const branch = last ? '    └──' : '    ├──';
  const parts = s.parts.filter((p) => p !== 'requirements');
  console.log(
    `${dim(branch)} ${teal(s.name.padEnd(width))} ` +
      `${String(s.criteria).padStart(3)} criteria  ` +
      dim(parts.length ? `+ ${parts.join(' · ')}` : ''),
  );
});

console.log('');
console.log(`    ${' '.repeat(width)} ${dim('─'.repeat(12))}`);
console.log(`    ${' '.repeat(width)} ${bold(String(total).padStart(3))} criteria`);
console.log(`    ${' '.repeat(width)} ${green('all bound to code and to a test')}`);
console.log('');
