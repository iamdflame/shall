import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recorded ensembles.
 *
 * A conformance report nobody can reproduce is not evidence. Without this, the
 * only thing a reader without an API key could run was the static lint - a regex
 * scan showing a fraction of the product - and the headline result was something
 * they had to take on trust.
 *
 * A recording is the verbatim output of a real ensemble run, committed to the
 * repository and stamped with when it was made and which readers produced it.
 * Replaying one costs nothing and reproduces the original byte for byte.
 *
 * It is never presented as a live run. Every replay prints the date and the
 * readers it came from, and `--live` re-asks the models for real.
 */

export interface RecordedReader {
  key: string;
  modelId: string;
  label: string;
  recordedAt: string;
}

export interface Manifest {
  version: 1;
  /** Recorded readers, keyed by the same hash the live cache uses. */
  readers: Record<string, RecordedReader>;
  /** Source file path -> when that program was last recorded. */
  programs: Record<string, { recordedAt: string; readers: string[] }>;
}

export const RECORDINGS_DIR = 'recordings';

function manifestPath(root: string): string {
  return join(root, RECORDINGS_DIR, 'manifest.json');
}

export function readManifest(root: string): Manifest {
  const path = manifestPath(root);
  if (!existsSync(path)) return { version: 1, readers: {}, programs: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (parsed.version !== 1) return { version: 1, readers: {}, programs: {} };
    return parsed;
  } catch {
    // A damaged manifest means "nothing recorded", never a crash.
    return { version: 1, readers: {}, programs: {} };
  }
}

export function writeManifest(root: string, manifest: Manifest): void {
  mkdirSync(join(root, RECORDINGS_DIR), { recursive: true });
  writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function recordingPath(root: string, key: string): string {
  return join(root, RECORDINGS_DIR, `${key}.js`);
}

export function readRecording(root: string, key: string): string | null {
  const path = recordingPath(root, key);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function writeRecording(root: string, key: string, source: string): void {
  mkdirSync(join(root, RECORDINGS_DIR), { recursive: true });
  writeFileSync(recordingPath(root, key), source, 'utf8');
}

/** Human summary of a program's recording, for the replay banner. */
// @shall offline-replay/2.3
export function describeRecording(
  manifest: Manifest,
  sourcePath: string,
): { recordedAt: string; readers: string[] } | null {
  return manifest.programs[sourcePath] ?? null;
}
