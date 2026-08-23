#!/usr/bin/env node
/**
 * Generate site/data.json from the committed recordings.
 *
 * The site's witness explorer shows real measurements, not a mock-up, so the
 * data behind it has to come from the same recordings the CLI replays. Running
 * this after re-recording keeps the page honest; nothing here calls a model.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { parseShall } from '../dist/shall/lang/parser.js';
import { buildCompilerInput } from '../dist/shall/compile/prompt.js';
import { readRecording, readManifest } from '../dist/shall/compile/recordings.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { runDifferential } from '../dist/shall/oracle/differential.js';
import { minimiseWitness } from '../dist/shall/oracle/minimise.js';
import { canonical, display, loadCandidate } from '../dist/shall/execute/sandbox.js';
import { targetedProbes, boundaries, isStraddled } from '../dist/shall/coverage/targeted.js';
import { readdirSync } from 'node:fs';
import { loadSpecs } from '../dist/ears/spec-reader.js';

const ROOT = process.cwd();
const ENSEMBLE = [
  'openai:gpt-4o', 'openai:gpt-4.1', 'openai:o4-mini',
  'openai:gpt-5.2', 'openai:gpt-5.6-luna', 'openai:gpt-5.6-terra',
];

const key = (input, model) =>
  createHash('sha256').update(['v1', model, input].join('\n---\n')).digest('hex').slice(0, 32);

/**
 * What convention a witness puts at stake.
 *
 * Derived from the input rather than hand-assigned, so the labels stay true if
 * the recordings are refreshed and different probes end up divergent.
 */
function conventionAtStake(text) {
  if (typeof text !== 'string') return 'edge case';
  if (/^[^A-Za-z0-9]+$/.test(text)) return 'is punctuation a word?';
  if (/[A-Za-z]-[A-Za-z]/.test(text)) return 'does a hyphen split a word?';
  if (/['’]/.test(text)) return 'does an apostrophe split a token?';
  if (/[,;:.!?]/.test(text)) return 'does punctuation separate words?';
  if (/[^\x00-\x7F]/.test(text)) return 'are accented characters letters?';
  if (/\d/.test(text)) return 'can digits be words?';
  return 'edge case';
}

function analyse(path, probeCount = 96, limit = 6) {
  const program = parseShall(readFileSync(path, 'utf8'), path).program;
  const input = buildCompilerInput(program);

  const sources = ENSEMBLE.map((id) => ({
    modelId: id,
    label: id.replace('openai:', ''),
    source: readRecording(ROOT, key(input, id)),
  }));
  if (sources.some((s) => !s.source)) {
    throw new Error(`missing recordings for ${path} — run \`shall record ${path}\``);
  }

  const probes = structuralProbes(program, probeCount);
  const result = runDifferential(sources, { probes, executionTimeoutMs: 1000 });

  const seen = new Set();
  const divergences = [];

  for (const d of result.behaviourDivergences) {
    const minimal = minimiseWitness(program, d.probe, result.loadable, 1000);
    const useMinimal = minimal.smaller;
    const chosen = useMinimal ? minimal.input : d.probe.input;

    // Several probes often shrink to the same witness; showing it twice would
    // make the explorer look padded.
    const id = JSON.stringify(chosen);
    if (seen.has(id)) continue;
    seen.add(id);

    // Outcomes must be read from the same measurement as the input.
    const outcomes = useMinimal
      ? minimal.outcomes
      : result.loadable.map((c) => c.outcomes[result.probes.indexOf(d.probe)]);

    const grouped = new Map();
    outcomes.forEach((outcome, i) => {
      const k = canonical(outcome);
      const entry = grouped.get(k) ?? { value: display(outcome), readers: [] };
      entry.readers.push(result.loadable[i].label);
      grouped.set(k, entry);
    });

    divergences.push({
      input: chosen,
      original: d.probe.input,
      minimised: useMinimal,
      label: conventionAtStake(Object.values(d.probe.input)[0]),
      readings: [...grouped.values()].sort((a, b) => b.readers.length - a.readers.length),
    });
    if (divergences.length >= limit) break;
  }

  return {
    name: program.name,
    path,
    readers: result.loadable.map((c) => c.label),
    probes: result.probes.length,
    groups: result.groups.length,
    unanimous: result.unanimous,
    divergences,
  };
}

/** Every `test(` in the suite, counted from source rather than remembered. */
function countTests() {
  return readdirSync('tests')
    .filter((f) => f.endsWith('.test.ts'))
    .reduce((n, f) => n + (readFileSync(`tests/${f}`, 'utf8').match(/^test\(/gm) ?? []).length, 0);
}

/** Every well-formed acceptance criterion across the .kiro specs. */
function countCriteria() {
  return loadSpecs(`${ROOT}/.kiro`)
    .flatMap((spec) => spec.requirements)
    .flatMap((requirement) => requirement.criteria)
    .filter((c) => c.pattern !== 'malformed').length;
}

/**
 * Finding 5, measured rather than described.
 *
 * The specification states a boundary at five dice. No interface-derived probe
 * goes above it, so the tool writes one - and the readers split three ways on
 * an input nothing else would have produced.
 */
function boundaryFinding(path) {
  const program = parseShall(readFileSync(path, 'utf8'), path).program;
  const base = structuralProbes(program, 96);
  const gap = boundaries(program, base).find((b) => !isStraddled(b));
  const made = targetedProbes(program, base, 16);
  if (!gap || made.length === 0) return null;

  const input = buildCompilerInput(program);
  const sources = ENSEMBLE.map((id) => ({
    label: id.replace('openai:', ''),
    source: readRecording(ROOT, key(input, id)),
  })).filter((s) => s.source);
  const readAt = (input) => {
    const grouped = new Map();
    for (const s of sources) {
      let out;
      try { out = display(loadCandidate(s.source).run(input, 1000)); } catch { continue; }
      grouped.set(out, [...(grouped.get(out) ?? []), s.label]);
    }
    return [...grouped.entries()]
      .map(([value, readers]) => ({ value, readers }))
      .sort((a, b) => b.readers.length - a.readers.length);
  };

  const onIt = { dice: Array.from({ length: gap.at }, () => 1) };
  const past = made[0].input;

  return {
    criterion: gap.criterion.id,
    clause: gap.criterion.raw,
    field: gap.field,
    at: gap.at,
    rationale: made[0].rationale,
    onBoundary: { input: onIt, readings: readAt(onIt) },
    pastBoundary: { input: past, readings: readAt(past) },
  };
}

const data = {
  wordCount: analyse('examples/word-count.shall'),
  wordCountFixed: analyse('examples/word-count.fixed.shall'),
  dice: analyse('examples/dice-score.shall'),
  boundary: boundaryFinding('examples/dice-score.shall'),
  // Counted rather than typed in. The hardcoded pair went stale within a day of
  // being written, and a number on a project page that nobody re-derives is a
  // number that will be wrong.
  stats: {
    tests: countTests(),
    criteria: countCriteria(),
    recordings: Object.keys(readManifest(ROOT).readers).length,
  },
};

writeFileSync('site/data.json', `${JSON.stringify(data, null, 1)}\n`);

console.log('');
console.log('  site/data.json written');
console.log(`    word-count : ${data.wordCount.groups} behaviours, ${data.wordCount.divergences.length} witnesses`);
console.log(`    fixed      : ${data.wordCountFixed.unanimous ? 'unanimous' : 'SPLIT'}`);
console.log(`    dice       : ${data.dice.groups} behaviours`);
console.log('');
for (const d of data.wordCount.divergences) {
  const answers = d.readings.map((r) => `${r.value} x${r.readers.length}`).join('  vs  ');
  console.log(`    ${JSON.stringify(d.input).padEnd(20)} ${d.label.padEnd(36)} ${answers}`);
}
console.log('');
