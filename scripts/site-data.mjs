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
import { canonical, display } from '../dist/shall/execute/sandbox.js';

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

const data = {
  wordCount: analyse('examples/word-count.shall'),
  wordCountFixed: analyse('examples/word-count.fixed.shall'),
  dice: analyse('examples/dice-score.shall'),
  stats: {
    tests: 148,
    criteria: 50,
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
